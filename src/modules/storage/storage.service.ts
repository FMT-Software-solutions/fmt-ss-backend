import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
  PayloadTooLargeException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { randomUUID } from 'crypto';
import { AppsService } from '../apps/apps.service';

interface Member {
  userId: string;
  role: string;
}

/**
 * Per-org file storage on Cloudflare R2 with quota accounting recorded in each
 * app's own Supabase project.
 *
 * Invariants:
 *  - Every mutating call verifies the caller's Supabase JWT AND active org
 *    membership (the backend is otherwise unauthenticated).
 *  - Quota is reserved atomically in Postgres (`reserve_storage`) BEFORE the R2
 *    PUT, and released on failure or delete — so `used_bytes` never drifts or
 *    oversubscribes under concurrency.
 *  - R2 objects are private; downloads are streamed back through the API.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private s3Client: S3Client | null = null;
  private readonly bucket: string;
  // Hard cap per file regardless of remaining quota (defends the API/R2).
  private readonly maxFileBytes = 100 * 1024 * 1024; // 100 MB

  constructor(
    private readonly configService: ConfigService,
    private readonly appsService: AppsService,
  ) {
    const endpoint = this.configService.get<string>('CLOUDFLARE_R2_ENDPOINT');
    const accessKeyId = this.configService.get<string>('CLOUDFLARE_R2_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('CLOUDFLARE_R2_SECRET_ACCESS_KEY');
    this.bucket =
      this.configService.get<string>('CLOUDFLARE_R2_BUCKET') || 'fmt-software-solutions';

    if (endpoint && accessKeyId && secretAccessKey) {
      this.s3Client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
      });
    }
  }

  private client() {
    if (!this.s3Client) {
      throw new InternalServerErrorException('Storage (R2) is not configured');
    }
    return this.s3Client;
  }

  /**
   * Verify the bearer token against the app's Supabase project and confirm the
   * user is an active member of the target organization. Returns their role.
   */
  private async verifyMember(appId: string, token: string, orgId: string): Promise<Member> {
    if (!token) throw new UnauthorizedException('Authorization token required');
    const supabase: any = this.appsService.getSupabaseClient(appId);

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      throw new UnauthorizedException('Invalid or expired session');
    }
    const userId = userData.user.id as string;

    const { data: membership, error: memberError } = await supabase
      .from('user_organizations')
      .select('role')
      .eq('user_id', userId)
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .maybeSingle();

    if (memberError) {
      throw new InternalServerErrorException('Failed to verify membership');
    }
    if (!membership) {
      throw new ForbiddenException('You are not a member of this organization');
    }
    return { userId, role: membership.role };
  }

  private sanitizeName(name: string): string {
    return (name || 'file')
      .replace(/[^\w.\-]+/g, '_')
      .replace(/_{2,}/g, '_')
      .slice(0, 120);
  }

  async uploadFile(params: {
    appId: string;
    token: string;
    organizationId: string;
    scope?: string;
    file: { originalname: string; buffer: Buffer; mimetype: string; size: number };
  }) {
    const { appId, token, organizationId, file } = params;
    const scope = params.scope || 'job_artwork';

    if (!file) throw new BadRequestException('File is required');
    if (file.size > this.maxFileBytes) {
      throw new PayloadTooLargeException(
        `File exceeds the ${Math.round(this.maxFileBytes / 1024 / 1024)}MB per-file limit`,
      );
    }

    const member = await this.verifyMember(appId, token, organizationId);
    const supabase: any = this.appsService.getSupabaseClient(appId);

    // 1. Reserve quota atomically (returns false if it would exceed the quota).
    const { data: reserved, error: reserveError } = await supabase.rpc('reserve_storage', {
      org_id: organizationId,
      bytes: file.size,
    });
    if (reserveError) {
      this.logger.error(`reserve_storage failed: ${reserveError.message}`);
      throw new InternalServerErrorException('Failed to reserve storage');
    }
    if (reserved === false) {
      throw new PayloadTooLargeException(
        'Not enough storage remaining. Free space or purchase more storage.',
      );
    }

    // 2. Upload to R2 under a collision-proof, tenant-namespaced key.
    const key = `${appId}/${organizationId}/${scope}/${randomUUID()}-${this.sanitizeName(file.originalname)}`;
    try {
      await this.client().send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
          ContentLength: file.size,
        }),
      );
    } catch (error) {
      // Roll back the reservation so a failed upload doesn't consume quota.
      await supabase.rpc('release_storage', { org_id: organizationId, bytes: file.size });
      this.logger.error(`R2 upload failed: ${(error as Error).message}`);
      throw new InternalServerErrorException('Failed to upload file');
    }

    // 3. Record the file (source of truth for the Storage Manager).
    const { data: row, error: insertError } = await supabase
      .from('storage_files')
      .insert({
        organization_id: organizationId,
        scope,
        bucket: this.bucket,
        r2_key: key,
        filename: file.originalname,
        mime_type: file.mimetype,
        size_bytes: file.size,
        uploaded_by: member.userId,
      })
      .select()
      .single();

    if (insertError) {
      // Best-effort cleanup: remove the orphaned object + release quota.
      await this.client()
        .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
        .catch(() => undefined);
      await supabase.rpc('release_storage', { org_id: organizationId, bytes: file.size });
      this.logger.error(`storage_files insert failed: ${insertError.message}`);
      throw new InternalServerErrorException('Failed to record file');
    }

    return {
      id: row.id,
      filename: row.filename,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      scope: row.scope,
      createdAt: row.created_at,
    };
  }

  async deleteFile(params: {
    appId: string;
    token: string;
    organizationId: string;
    fileId: string;
  }) {
    const { appId, token, organizationId, fileId } = params;
    await this.verifyMember(appId, token, organizationId);
    const supabase: any = this.appsService.getSupabaseClient(appId);

    const { data: fileRow, error: loadError } = await supabase
      .from('storage_files')
      .select('*')
      .eq('id', fileId)
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .maybeSingle();

    if (loadError) throw new InternalServerErrorException('Failed to load file');
    if (!fileRow) throw new NotFoundException('File not found');

    // Remove the physical object first; a leftover DB row is safer than a
    // leftover (billed) R2 object, so we delete R2 → DB → release quota.
    try {
      await this.client().send(
        new DeleteObjectCommand({ Bucket: fileRow.bucket, Key: fileRow.r2_key }),
      );
    } catch (error) {
      this.logger.warn(`R2 delete failed (continuing): ${(error as Error).message}`);
    }

    await supabase
      .from('storage_files')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', fileId);

    // Flag any artwork rows pointing at this file as physically deleted (audit
    // metadata is retained on the artwork row itself).
    await supabase
      .from('job_artworks')
      .update({ file_deleted: true, deleted_at: new Date().toISOString() })
      .eq('storage_file_id', fileId);

    await supabase.rpc('release_storage', {
      org_id: organizationId,
      bytes: fileRow.size_bytes,
    });

    return { success: true };
  }

  async getDownload(params: {
    appId: string;
    token: string;
    organizationId: string;
    fileId: string;
  }) {
    const { appId, token, organizationId, fileId } = params;
    await this.verifyMember(appId, token, organizationId);
    const supabase: any = this.appsService.getSupabaseClient(appId);

    const { data: fileRow, error } = await supabase
      .from('storage_files')
      .select('*')
      .eq('id', fileId)
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Failed to load file');
    if (!fileRow) throw new NotFoundException('File not found');

    const response = await this.client().send(
      new GetObjectCommand({ Bucket: fileRow.bucket, Key: fileRow.r2_key }),
    );
    if (!response.Body) throw new NotFoundException('File not found in storage');

    return {
      stream: response.Body as Readable,
      contentType: fileRow.mime_type || response.ContentType || 'application/octet-stream',
      filename: fileRow.filename,
      contentLength: fileRow.size_bytes,
    };
  }
}
