import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PaymentsService } from './payments.service';
import { HubtelCheckoutRequestDto, HubtelConfigRequestDto, HubtelStatusRequestDto } from './dto/hubtel.dto';
import { PaystackCheckoutDto, PaystackInitializeDto } from './dto/paystack.dto';
import { VerifySmsPurchaseDto } from './dto/verify-sms-purchase.dto';
import { InitializeSmsPurchaseDto } from './dto/initialize-sms-purchase.dto';

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
}
