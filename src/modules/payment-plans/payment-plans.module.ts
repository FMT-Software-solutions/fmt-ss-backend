import { Module } from '@nestjs/common';
import { PurchasesModule } from '../purchases/purchases.module';
import { ArkeselModule } from '../../common/arkesel/arkesel.module';
import { PaymentProvidersModule } from '../../common/payment-providers/payment-providers.module';
import { PaymentPlansController } from './payment-plans.controller';
import { AdminPaymentPlansController } from './admin-payment-plans.controller';
import { PaymentPlansService } from './payment-plans.service';
import { PlanAccessService } from './plan-access.service';
import { PlanJobsService } from './plan-jobs.service';
import { PlanNotificationsService } from './plan-notifications.service';

@Module({
  imports: [PurchasesModule, ArkeselModule, PaymentProvidersModule],
  controllers: [PaymentPlansController, AdminPaymentPlansController],
  providers: [PaymentPlansService, PlanAccessService, PlanJobsService, PlanNotificationsService],
  exports: [PaymentPlansService],
})
export class PaymentPlansModule { }
