import { Module } from '@nestjs/common';
import { TestimonialsService } from './testimonials.service';
import { TestimonialsController } from './testimonials.controller';
import { SanityModule } from '../../common/sanity/sanity.module';
import { ReviewsModule } from '../reviews/reviews.module';

@Module({
  imports: [SanityModule, ReviewsModule],
  controllers: [TestimonialsController],
  providers: [TestimonialsService],
  exports: [TestimonialsService],
})
export class TestimonialsModule {}
