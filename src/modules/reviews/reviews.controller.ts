import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';

@ApiTags('Reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Submit a review' })
  @ApiResponse({ status: 201, description: 'Review submitted successfully' })
  create(@Body() createReviewDto: CreateReviewDto) {
    return this.reviewsService.create(createReviewDto);
  }

  @Get('featured')
  @ApiOperation({ summary: 'Get featured reviews' })
  @ApiResponse({ status: 200, description: 'List of featured reviews' })
  findAllFeatured() {
    return this.reviewsService.findAllFeatured();
  }
}
