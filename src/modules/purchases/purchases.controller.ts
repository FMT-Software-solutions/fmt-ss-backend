import { Controller, Post, Body, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { PurchasesService } from './purchases.service';
import { GeneralPurchaseDto, ConfirmationEmailDto, AppProvisioningDto, TrialRequestDto, FreeAccessRequestDto } from './dto/purchase.dto';

@ApiTags('Purchases')
@Controller()
export class PurchasesController {
    constructor(private readonly purchasesService: PurchasesService) { }

    @Get('purchases/check-access')
    @ApiOperation({ summary: 'Check if email has access to app' })
    @ApiQuery({ name: 'email', required: true })
    @ApiQuery({ name: 'productId', required: true })
    checkAppAccess(@Query('email') email: string, @Query('productId') productId: string) {
        return this.purchasesService.checkAppAccess(email, productId);
    }

    @Post('purchases')
    @ApiOperation({ summary: 'Create a general purchase' })
    processGeneralPurchase(@Body() payload: GeneralPurchaseDto) {
        return this.purchasesService.processGeneralPurchase(payload);
    }

    @Post('purchases/trial')
    @ApiOperation({ summary: 'Request a trial access' })
    processTrialRequest(@Body() payload: TrialRequestDto) {
        return this.purchasesService.processTrialRequest(payload);
    }

    @Post('purchases/free-access')
    @ApiOperation({ summary: 'Request free access for account-required apps' })
    processFreeAccessRequest(@Body() payload: FreeAccessRequestDto) {
        return this.purchasesService.processFreeAccessRequest(payload);
    }

    @Post('purchases/confirmation-email')
    @ApiOperation({ summary: 'Resend purchase confirmation email' })
    async sendPurchaseConfirmationEmail(@Body() payload: ConfirmationEmailDto) {
        await this.purchasesService.sendPurchaseConfirmationEmail(
            payload.organizationDetails,
            payload.items,
            payload.total
        );
        return { success: true, message: 'Confirmation email sent successfully' };
    }

    @Post('app-provisioning')
    @ApiOperation({ summary: 'Provision apps' })
    processAppProvisioning(@Body() payload: AppProvisioningDto) {
        return this.purchasesService.processAppProvisioning(payload);
    }
}
