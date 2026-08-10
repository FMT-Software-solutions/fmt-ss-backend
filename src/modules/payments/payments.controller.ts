import {
    Controller,
    Post,
    Get,
    Body,
    Param,
    Query,
    Req,
    Headers,
    BadRequestException,
    UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiExcludeEndpoint } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';
import { HubtelCheckoutRequestDto, HubtelConfigRequestDto, HubtelStatusRequestDto } from './dto/hubtel.dto';
import { PaystackCheckoutDto, PaystackInitializeDto } from './dto/paystack.dto';
import { VerifySmsPurchaseDto } from './dto/verify-sms-purchase.dto';
import { InitializeSmsPurchaseDto } from './dto/initialize-sms-purchase.dto';
import { InitializeStoragePurchaseDto } from './dto/initialize-storage-purchase.dto';
import { VerifyStoragePurchaseDto } from './dto/verify-storage-purchase.dto';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
    constructor(private readonly paymentsService: PaymentsService) { }

    @Post('hubtel/config')
    @ApiOperation({ summary: 'Get Hubtel payment configuration' })
    handleHubtelConfig(@Body() payload: HubtelConfigRequestDto) {
        return this.paymentsService.handleHubtelConfig(payload);
    }

    @Post('hubtel/status')
    @ApiOperation({ summary: 'Check Hubtel payment status' })
    handleHubtelStatus(@Body() payload: HubtelStatusRequestDto) {
        return this.paymentsService.handleHubtelStatus(payload);
    }

    @Post('hubtel/checkout')
    @UseGuards(ThrottlerGuard)
    @ApiOperation({ summary: 'Record Hubtel checkout' })
    @ApiResponse({ status: 201, description: 'Purchase recorded' })
    @ApiResponse({ status: 400, description: 'Bad Request' })
    handleHubtelCheckout(@Body() payload: HubtelCheckoutRequestDto) {
        return this.paymentsService.handleHubtelCheckout(payload);
    }

    @Post('hubtel/callback')
    @ApiOperation({ summary: 'Handle Hubtel callback' })
    handleHubtelCallback(@Body() payload: any) {
        return this.paymentsService.handleHubtelCallback(payload);
    }

    @Post('paystack/config')
    @ApiOperation({ summary: 'Get Paystack payment configuration' })
    handlePaystackConfig(@Body() payload: PaystackInitializeDto) {
        return this.paymentsService.handlePaystackInitialize(payload);
    }

    @Post('paystack/checkout')
    @UseGuards(ThrottlerGuard)
    @ApiOperation({ summary: 'Record Paystack checkout' })
    @ApiResponse({ status: 201, description: 'Purchase recorded' })
    @ApiResponse({ status: 400, description: 'Bad Request' })
    handlePaystackCheckout(@Body() payload: PaystackCheckoutDto) {
        return this.paymentsService.handlePaystackCheckout(payload);
    }

    @Post('initialize-sms-purchase')
    @UseGuards(ThrottlerGuard)
    @ApiOperation({ summary: 'Initialize Paystack SMS credit purchase for redirect' })
    @ApiResponse({ status: 201, description: 'Purchase initialized, returns authorization_url' })
    @ApiResponse({ status: 400, description: 'Bad Request' })
    initializeSmsPurchase(@Body() payload: InitializeSmsPurchaseDto) {
        return this.paymentsService.initializeSmsPurchase(payload);
    }

    @Post('verify-sms-purchase')
    @UseGuards(ThrottlerGuard)
    @ApiOperation({ summary: 'Verify and record Paystack SMS credit purchase' })
    @ApiResponse({ status: 201, description: 'SMS Purchase verified and recorded' })
    @ApiResponse({ status: 400, description: 'Bad Request or Verification Failed' })
    verifySmsPurchase(@Body() payload: VerifySmsPurchaseDto) {
        return this.paymentsService.verifySmsPurchase(payload);
    }

    @Post('initialize-storage-purchase')
    @UseGuards(ThrottlerGuard)
    @ApiOperation({ summary: 'Initialize Paystack storage purchase for redirect' })
    @ApiResponse({ status: 201, description: 'Purchase initialized, returns authorization_url' })
    @ApiResponse({ status: 400, description: 'Bad Request' })
    initializeStoragePurchase(@Body() payload: InitializeStoragePurchaseDto) {
        return this.paymentsService.initializeStoragePurchase(payload);
    }

    @Post('verify-storage-purchase')
    @UseGuards(ThrottlerGuard)
    @ApiOperation({ summary: 'Verify and record Paystack storage purchase' })
    @ApiResponse({ status: 201, description: 'Storage purchase verified and recorded' })
    @ApiResponse({ status: 400, description: 'Bad Request or Verification Failed' })
    verifyStoragePurchase(@Body() payload: VerifyStoragePurchaseDto) {
        return this.paymentsService.verifyStoragePurchase(payload);
    }

    /**
     * Paystack server-to-server webhook — the source of truth for crediting
     * SMS credits and storage. Fires regardless of whether the customer's
     * browser ever returns to the app, which is what makes purchases work from
     * the packaged desktop app (whose file:// callback URL Paystack cannot
     * redirect to) and survive a closed tab on the web.
     *
     * Public by necessity; authenticated by the x-paystack-signature HMAC over
     * the raw body, so `rawBody: true` must stay enabled in main.ts.
     *
     * Always answers 200 once the signature checks out: a non-2xx makes
     * Paystack retry, and a payload we can't process would be redelivered
     * forever. Processing failures are logged and left in payment_records.
     */
    @Post('paystack/webhook')
    @ApiExcludeEndpoint()
    async handlePaystackWebhook(
        @Req() req: RawBodyRequest<Request>,
        @Headers('x-paystack-signature') signature: string,
    ) {
        const isValid = this.paymentsService.verifyPaystackSignature(req.rawBody, signature);
        if (!isValid) {
            // 400, not 200: an unsigned caller is not Paystack, and we do not
            // want to pretend we accepted it.
            throw new BadRequestException('Invalid signature');
        }

        return this.paymentsService.handlePaystackWebhook(req.body);
    }

    @Get('purchase-status/:reference')
    @UseGuards(ThrottlerGuard)
    @ApiOperation({
        summary: 'Poll the status of a purchase by Paystack reference',
        description:
            'Used by the desktop app while the customer completes payment in their system browser.',
    })
    getPurchaseStatus(
        @Param('reference') reference: string,
        @Query('appId') appId: string,
    ) {
        if (!appId) {
            throw new BadRequestException('appId query parameter is required');
        }
        return this.paymentsService.getPurchaseStatusByReference(reference, appId);
    }
}
