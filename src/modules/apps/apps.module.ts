import { Module, Global } from '@nestjs/common';
import { AppsService } from './apps.service';

@Global()
@Module({
  providers: [AppsService],
  exports: [AppsService],
})
export class AppsModule {}