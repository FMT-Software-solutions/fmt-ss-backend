import { Controller, Post, Get, Param, UploadedFile, UseInterceptors, Body, Res, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { FilesService } from './files.service';
import { Express } from 'express';
import 'multer';

@ApiTags('Files')
@Controller()
export class FilesController {
  constructor(private readonly filesService: FilesService) { }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        bucketName: {
          type: 'string',
        },
        fileName: {
          type: 'string',
        },
      },
    },
  })
  @ApiOperation({ summary: 'Upload a file to R2' })
  async uploadFile(
    @UploadedFile() file: any,
    @Body('bucketName') bucketName: string,
    @Body('fileName') fileName: string,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    if (!bucketName) {
      throw new BadRequestException('Bucket name is required');
    }
    return this.filesService.uploadFile(file, bucketName, fileName);
  }

  @Get('files/:bucket/*')
  @ApiOperation({ summary: 'Proxy file from R2' })
  async getFile(
    @Param('bucket') bucket: string,
    @Param() params: any,
    @Res() res: Response,
  ) {
    const key = params[0]; // Captures the wildcard part
    if (!key) {
      throw new BadRequestException('File path is required');
    }

    const file = await this.filesService.getFile(bucket, key);

    res.set({
      'Content-Type': file.contentType,
      'Content-Length': file.contentLength,
      'Cache-Control': 'public, max-age=31536000',
    });

    file.stream.pipe(res);
  }
}
