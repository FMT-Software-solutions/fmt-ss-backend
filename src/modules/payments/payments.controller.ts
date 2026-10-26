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
import { StoreCheckoutService } from './store-checkout.service';
import { ConfirmStoreOrderDto, CreateStoreOrderDto } from './dto/store-order.dto';
import { VerifySmsPurchaseDto } from './dto/verify-sms-purchase.dto';
import { InitializeSmsPurchaseDto } from './dto/initialize-sms-purchase.dto';
import { InitializeStoragePurchaseDto } from './dto/initialize-storage-purchase.dto';
import { VerifyStoragePurchaseDto } from './dto/verify-storage-purchase.dto';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
    constructor(
        private readonly paymentsService: PaymentsService,
        private readonly storeCheckout: StoreCheckoutService,
    ) { }

    // ---------------------------------------------------------------- store
    // Website orders. The server prices the order and issues the reference;
    // every confirmation path asks the provider and checks the amount.

    @Post('orders')
    @UseGuards(ThrottlerGuard)
    @ApiOperation({ summary: 'Start a website order (server-priced)' })
    createStoreOrder(@Body() payload: CreateStoreOrderDto) {
        return this.storeCheckout.createOrder(payload);
    }

    @Get('orders/:reference')
    @UseGuards(ThrottlerGuard)
    @ApiOperation({ summary: 'Order status; re-checks pending orders with the provider' })
    getStoreOrder(@Param() params: ConfirmStoreOrderDto) {
        return this.storeCheckout.pollOrder(params.reference);
    }

    @Post('paystack/checkout')
    @UseGuards(ThrottlerGuard)
    @ApiOperation({ summary: 'Confirm a Paystack website order by reference' })
    confirmPaystackOrder(@Body() payload: ConfirmStoreOrderDto) {
        return this.storeCheckout.confirmPaystack(payload.reference);
    }

    /**
     * Hubtel server callback. The payload is only used to find the
     * reference; payment is confirmed by asking Hubtel's status API.
     */
    @Post('hubtel/callback')
    @ApiExcludeEndpoint()
    async handleHubtelCallback(@Body() payload: any) {
        const reference = payload?.Data?.ClientReference ?? payload?.data?.clientReference ?? payload?.ClientReference;
        if (typeof reference !== 'string' || !(await this.storeCheckout.isStoreReference(reference))) {
            return { received: true, handled: false };
        }
        try {
            const order = await this.storeCheckout.confirmHubtel(reference);
            return { received: true, handled: true, status: order.status };
        } catch (error) {
            return { received: true, handled: false, error: (error as Error).message };
        }
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

        const reference = req.body?.data?.reference;
        if (req.body?.event === 'charge.success' && typeof reference === 'string' && (await this.storeCheckout.isStoreReference(reference))) {
            try {
                const order = await this.storeCheckout.confirmPaystack(reference);
                return { received: true, handled: true, status: order.status };
            } catch (error) {
                return { received: true, handled: false, error: (error as Error).message };
            }
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
