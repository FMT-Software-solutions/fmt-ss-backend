import { Module } from '@nestjs/common';
import { AdminDiscountsController } from './admin-discounts.controller';
import { DiscountsService } from './discounts.service';

@Module({
  controllers: [AdminDiscountsController],
  providers: [DiscountsService],
  exports: [DiscountsService],
})
export class DiscountsModule { }
