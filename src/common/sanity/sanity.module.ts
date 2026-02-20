import { Global, Module } from '@nestjs/common';
import { SanityService } from './sanity.service';

@Global()
@Module({
  providers: [SanityService],
  exports: [SanityService],
})
export class SanityModule {}
