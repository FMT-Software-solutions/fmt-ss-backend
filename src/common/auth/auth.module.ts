import { Global, Module } from '@nestjs/common';
import { AdminAuthGuard } from './admin-auth.guard';

@Global()
@Module({
  providers: [AdminAuthGuard],
  exports: [AdminAuthGuard],
})
export class AuthModule { }
