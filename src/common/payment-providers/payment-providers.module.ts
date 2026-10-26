import { Module } from '@nestjs/common';
import { PaymentProvidersService } from './payment-providers.service';

@Module({
  providers: [PaymentProvidersService],
  exports: [PaymentProvidersService],
})
export class PaymentProvidersModule { }
