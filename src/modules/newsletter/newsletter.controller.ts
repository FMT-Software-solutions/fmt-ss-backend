import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { NewsletterService } from './newsletter.service';
import { SubscribeDto } from './dto/subscribe.dto';
import { UnsubscribeDto } from './dto/unsubscribe.dto';

@ApiTags('Newsletter')
@Controller('newsletter')
export class NewsletterController {
  constructor(private readonly newsletterService: NewsletterService) {}

  @Post('subscribe')
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Subscribe to newsletter' })
  @ApiResponse({ status: 201, description: 'Subscribed successfully' })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  subscribe(@Body() subscribeDto: SubscribeDto) {
    return this.newsletterService.subscribe(subscribeDto);
  }

  @Post('unsubscribe')
  @ApiOperation({ summary: 'Unsubscribe from newsletter' })
  @ApiResponse({ status: 200, description: 'Unsubscribed successfully' })
  @ApiResponse({ status: 404, description: 'Invalid token' })
  unsubscribe(@Body() unsubscribeDto: UnsubscribeDto) {
    return this.newsletterService.unsubscribe(unsubscribeDto.token);
  }

  @Post('unsubscribe-by-email')
  @ApiOperation({ summary: 'Unsubscribe from newsletter by email' })
  @ApiResponse({ status: 200, description: 'Unsubscribed successfully' })
  @ApiResponse({ status: 404, description: 'Email not found' })
  unsubscribeByEmail(@Body() body: { email: string }) {
    return this.newsletterService.unsubscribeByEmail(body.email);
  }
}
