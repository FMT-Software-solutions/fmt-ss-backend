import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { StorageController } from './storage.controller';
import { AppsModule } from '../apps/apps.module';

@Module({
  imports: [AppsModule],
  controllers: [StorageController],
  providers: [StorageService],
})
export class StorageModule {}
