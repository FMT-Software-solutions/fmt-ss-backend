import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PaymentsService } from './payments.service';
import { HubtelCheckoutRequestDto, HubtelConfigRequestDto, HubtelStatusRequestDto } from './dto/hubtel.dto';

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
}
