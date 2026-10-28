import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { StoreCheckoutService } from './store-checkout.service';
import { PurchasesModule } from '../purchases/purchases.module';
import { IssuesModule } from '../issues/issues.module';
import { PaymentProvidersModule } from '../../common/payment-providers/payment-providers.module';
import { PaymentPlansModule } from '../payment-plans/payment-plans.module';
import { DiscountsModule } from '../discounts/discounts.module';

@Module({
  imports: [PurchasesModule, IssuesModule, PaymentProvidersModule, PaymentPlansModule, DiscountsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, StoreCheckoutService],
})
export class PaymentsModule {}
