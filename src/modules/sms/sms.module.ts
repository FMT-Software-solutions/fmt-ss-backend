import { Module } from '@nestjs/common';
import { SmsController } from './sms.controller';
import { SmsService } from './sms.service';
import { ArkeselModule } from '../../common/arkesel/arkesel.module';

@Module({
  imports: [ArkeselModule],
  controllers: [SmsController],
  providers: [SmsService],
})
export class SmsModule {}
