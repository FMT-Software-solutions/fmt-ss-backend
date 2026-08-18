import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import type { Request } from 'express';
import type { User } from '@supabase/supabase-js';
import { SupabaseService } from '../supabase/supabase.service';

export interface AdminRequest extends Request {
  adminUser: User;
}

// Verified tokens are cached briefly so burst navigation in the admin UI
// doesn't turn into one auth round-trip per request. Kept short so session
// revocation still bites within a minute.
const CACHE_TTL_MS = 60_000;

@Injectable()
export class AdminAuthGuard implements CanActivate {
  private cache = new Map<string, { user: User; expiresAt: number }>();

  constructor(private readonly supabaseService: SupabaseService) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const user = await this.resolveUser(token);

    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (user.app_metadata?.fmt_admin !== true) {
      throw new ForbiddenException('Not an admin account');
    }

    request.adminUser = user;
    return true;
  }

  private extractBearerToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header) return null;
    const [scheme, token] = header.split(' ');
    return scheme === 'Bearer' && token ? token : null;
  }

  private async resolveUser(token: string): Promise<User | null> {
    const key = createHash('sha256').update(token).digest('hex');
    const now = Date.now();

    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.user;
    }

    const { data, error } = await this.supabaseService
      .getServiceRoleClient()
      .auth.getUser(token);

    if (error || !data.user) {
      this.cache.delete(key);
      return null;
    }

    this.pruneExpired(now);
    this.cache.set(key, { user: data.user, expiresAt: now + CACHE_TTL_MS });
    return data.user;
  }

  private pruneExpired(now: number) {
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }
}
