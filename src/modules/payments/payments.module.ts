import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { StoreCheckoutService } from './store-checkout.service';
import { PurchasesModule } from '../purchases/purchases.module';
import { IssuesModule } from '../issues/issues.module';

@Module({
  imports: [PurchasesModule, IssuesModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, StoreCheckoutService],
})
export class PaymentsModule {}
