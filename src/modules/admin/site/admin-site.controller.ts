import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../../../common/auth/admin-auth.guard';
import { AdminSiteService } from './admin-site.service';
import {
  MessagesQueryDto,
  PaginationQueryDto,
  PurchasesQueryDto,
  ReviewsQueryDto,
  StatusFilterQueryDto,
} from '../dto/pagination.dto';
import {
  UpdateIssueDto,
  UpdateMessageDto,
  UpdateQuoteDto,
  UpdateReviewDto,
} from './dto/update.dto';

@ApiTags('Admin — Website')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/site')
export class AdminSiteController {
  constructor(private readonly siteService: AdminSiteService) { }

  @Get('stats')
  @ApiOperation({ summary: 'Headline counts for the admin dashboard' })
  getStats() {
    return this.siteService.getStats();
  }

  @Get('messages')
  @ApiOperation({ summary: 'List contact form messages' })
  listMessages(@Query() query: MessagesQueryDto) {
    return this.siteService.listMessages(query);
  }

  @Patch('messages/:id')
  @ApiOperation({ summary: 'Mark a message read/unread or archived' })
  updateMessage(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateMessageDto) {
    return this.siteService.updateMessage(id, body);
  }

  @Get('quotes')
  @ApiOperation({ summary: 'List quote requests' })
  listQuotes(@Query() query: StatusFilterQueryDto) {
    return this.siteService.listQuotes(query);
  }

  @Patch('quotes/:id')
  @ApiOperation({ summary: 'Update a quote’s status' })
  updateQuote(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateQuoteDto) {
    return this.siteService.updateQuoteStatus(id, body.status);
  }

  @Get('purchases')
  @ApiOperation({ summary: 'List purchases with their organization' })
  listPurchases(@Query() query: PurchasesQueryDto) {
    return this.siteService.listPurchases(query);
  }

  @Get('purchases/:id')
  @ApiOperation({ summary: 'Purchase detail including billing address' })
  getPurchase(@Param('id', ParseUUIDPipe) id: string) {
    return this.siteService.getPurchase(id);
  }

  @Get('reviews')
  @ApiOperation({ summary: 'List reviews for moderation' })
  listReviews(@Query() query: ReviewsQueryDto) {
    return this.siteService.listReviews(query);
  }

  @Patch('reviews/:id')
  @ApiOperation({ summary: 'Approve, reject or feature a review' })
  updateReview(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateReviewDto) {
    return this.siteService.updateReview(id, body);
  }

  @Get('newsletter')
  @ApiOperation({ summary: 'List newsletter subscribers' })
  listSubscribers(@Query() query: PaginationQueryDto) {
    return this.siteService.listSubscribers(query);
  }

  @Delete('newsletter/:id')
  @ApiOperation({ summary: 'Remove a newsletter subscriber' })
  deleteSubscriber(@Param('id', ParseUUIDPipe) id: string) {
    return this.siteService.deleteSubscriber(id);
  }

  @Get('training-registrations')
  @ApiOperation({ summary: 'List standard and custom training registrations' })
  listTraining(@Query() query: StatusFilterQueryDto) {
    return this.siteService.listTrainingRegistrations(query);
  }

  @Get('issues')
  @ApiOperation({ summary: 'List logged issues' })
  listIssues(@Query() query: StatusFilterQueryDto) {
    return this.siteService.listIssues(query);
  }

  @Patch('issues/:id')
  @ApiOperation({ summary: 'Update an issue’s status' })
  updateIssue(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateIssueDto) {
    return this.siteService.updateIssue(id, body);
  }
}
