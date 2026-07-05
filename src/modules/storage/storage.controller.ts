import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  Query,
  Body,
  Headers,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  Res,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiConsumes, ApiBearerAuth } from '@nestjs/swagger';
import type { Response } from 'express';
import 'multer';
import { StorageService } from './storage.service';
import { UploadFileDto, FileActionDto } from './dto/storage.dto';

function extractToken(authHeader?: string): string {
  if (!authHeader) throw new UnauthorizedException('Authorization header required');
  return authHeader.replace(/^Bearer\s+/i, '').trim();
}

@ApiTags('Storage')
@ApiBearerAuth()
@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('upload')
  @UseGuards(ThrottlerGuard)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a file to R2 (quota-checked)' })
  async upload(
    @UploadedFile() file: any,
    @Body() body: UploadFileDto,
    @Headers('authorization') authHeader: string,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.storageService.uploadFile({
      appId: body.appId,
      token: extractToken(authHeader),
      organizationId: body.organizationId,
      scope: body.scope,
      file,
    });
  }

  @Delete('files/:id')
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Delete a file from R2 and free its storage' })
  async remove(
    @Param('id') id: string,
    @Body() body: FileActionDto,
    @Headers('authorization') authHeader: string,
  ) {
    return this.storageService.deleteFile({
      appId: body.appId,
      token: extractToken(authHeader),
      organizationId: body.organizationId,
      fileId: id,
    });
  }

  @Get('files/:id/download')
  @ApiOperation({ summary: 'Stream a private file from R2' })
  async download(
    @Param('id') id: string,
    @Query('appId') appId: string,
    @Query('organizationId') organizationId: string,
    @Headers('authorization') authHeader: string,
    @Res() res: Response,
  ) {
    const { stream, contentType, filename, contentLength } =
      await this.storageService.getDownload({
        appId,
        token: extractToken(authHeader),
        organizationId,
        fileId: id,
      });

    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
      ...(contentLength ? { 'Content-Length': String(contentLength) } : {}),
      'Cache-Control': 'private, max-age=3600',
    });
    stream.pipe(res);
  }
}
