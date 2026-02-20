import { Module } from '@nestjs/common';
import { IssuesService } from './issues.service';

@Module({
  providers: [IssuesService],
  exports: [IssuesService],
})
export class IssuesModule {}
