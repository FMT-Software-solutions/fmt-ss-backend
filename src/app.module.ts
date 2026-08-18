import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SupabaseModule } from './common/supabase/supabase.module';
import { AuthModule } from './common/auth/auth.module';
import { ResendModule } from './common/resend/resend.module';
import { SanityModule } from './common/sanity/sanity.module';
import { ContactModule } from './modules/contact/contact.module';
import { NewsletterModule } from './modules/newsletter/newsletter.module';
import { TrainingModule } from './modules/training/training.module';
import { PurchasesModule } from './modules/purchases/purchases.module';
import { IssuesModule } from './modules/issues/issues.module';
import { AdminModule } from './modules/admin/admin.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { FilesModule } from './modules/files/files.module';
import { StorageModule } from './modules/storage/storage.module';
import { TestimonialsModule } from './modules/testimonials/testimonials.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { SmsModule } from './modules/sms/sms.module';
import { AppsModule } from './modules/apps/apps.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 10,
    }]),
    ScheduleModule.forRoot(),
    AppsModule,
    SupabaseModule,
    AuthModule,
    ResendModule,
    SanityModule,
    ContactModule,
    NewsletterModule,
    TrainingModule,
    PurchasesModule,
    IssuesModule,
    AdminModule,
    PaymentsModule,
    FilesModule,
    StorageModule,
    TestimonialsModule,
    ReviewsModule,
    QuotesModule,
    SmsModule,
    AnalyticsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
