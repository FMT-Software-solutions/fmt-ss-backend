import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { PurchasesModule } from '../purchases/purchases.module';
import { IssuesModule } from '../issues/issues.module';

@Module({
  imports: [PurchasesModule, IssuesModule],
  controllers: [AdminController],
})
export class AdminModule {}
