import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SupabaseModule } from './common/supabase/supabase.module';
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
import { TestimonialsModule } from './modules/testimonials/testimonials.module';
import { ReviewsModule } from './modules/reviews/reviews.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 10,
    }]),
    SupabaseModule,
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
    TestimonialsModule,
    ReviewsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
