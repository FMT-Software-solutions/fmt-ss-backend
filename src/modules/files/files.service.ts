import { Injectable, BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { Express } from 'express';

@Injectable()
export class FilesService {
  private s3Client: S3Client;
  private bucketName: string = 'fmt-software-solutions'; // Default or from env

  constructor(private configService: ConfigService) {
    const endpoint = this.configService.get<string>('CLOUDFLARE_R2_ENDPOINT');
    const accessKeyId = this.configService.get<string>('CLOUDFLARE_R2_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('CLOUDFLARE_R2_SECRET_ACCESS_KEY');

    if (endpoint && accessKeyId && secretAccessKey) {
      this.s3Client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
    }
  }

  async uploadFile(file: any, bucket?: string, fileName?: string) {
    if (!this.s3Client) {
      throw new InternalServerErrorException('Storage configuration missing');
    }

    const targetBucket = bucket || this.bucketName;
    const key = fileName || file.originalname;

    try {
      const command = new PutObjectCommand({
        Bucket: targetBucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ContentLength: file.size,
      });

      await this.s3Client.send(command);

      const baseUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
      const fileUrl = `${baseUrl}/api/files/${targetBucket}/${key}`;

      return {
        success: true,
        fileUrl,
        key,
        bucket: targetBucket,
      };
    } catch (error) {
      console.error('Upload error:', error);
      throw new InternalServerErrorException('Failed to upload file');
    }
  }

  async getFile(bucket: string, key: string) {
    if (!this.s3Client) {
      throw new InternalServerErrorException('Storage configuration missing');
    }

    try {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      const response = await this.s3Client.send(command);

      if (!response.Body) {
        throw new NotFoundException('File not found');
      }

      // Convert stream to buffer or streamable file
      // NestJS StreamableFile can handle Readable stream
      const stream = response.Body as Readable;

      return {
        stream,
        contentType: response.ContentType || 'application/octet-stream',
        contentLength: response.ContentLength,
      };
    } catch (error) {
      console.error('File fetch error:', error);
      if (error.name === 'NoSuchKey') {
        throw new NotFoundException('File not found');
      }
      throw new InternalServerErrorException('Failed to fetch file');
    }
  }
}
