import { Controller, Post, Body, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AdminAuthGuard } from '../../common/auth/admin-auth.guard';
import { PurchasesService } from './purchases.service';
import { GeneralPurchaseDto, ConfirmationEmailDto, AppProvisioningDto, TrialRequestDto, FreeAccessRequestDto } from './dto/purchase.dto';

@ApiTags('Purchases')
@Controller()
export class PurchasesController {
    constructor(private readonly purchasesService: PurchasesService) { }

    @Get('purchases/check-access')
    @UseGuards(ThrottlerGuard)
    @ApiOperation({ summary: 'Check if email has access to app' })
    @ApiQuery({ name: 'email', required: true })
    @ApiQuery({ name: 'productId', required: true })
    @ApiQuery({ name: 'mode', required: false })
    checkAppAccess(@Query('email') email: string, @Query('productId') productId: string, @Query('mode') mode?: 'buy' | 'trial') {
        return this.purchasesService.checkAppAccess(email, productId, mode);
    }

    @Post('purchases')
    @ApiBearerAuth()
    @UseGuards(AdminAuthGuard)
    @ApiOperation({ summary: 'Create a general purchase (admin only)' })
    processGeneralPurchase(@Body() payload: GeneralPurchaseDto) {
        return this.purchasesService.processGeneralPurchase(payload);
    }

    @Post('purchases/trial')
    @UseGuards(ThrottlerGuard)
    @ApiOperation({ summary: 'Request a trial access' })
    processTrialRequest(@Body() payload: TrialRequestDto) {
        return this.purchasesService.processTrialRequest(payload);
    }

    @Post('purchases/free-access')
    @UseGuards(ThrottlerGuard)
    @ApiOperation({ summary: 'Request free access for account-required apps' })
    processFreeAccessRequest(@Body() payload: FreeAccessRequestDto) {
        return this.purchasesService.processFreeAccessRequest(payload);
    }

    @Post('purchases/confirmation-email')
    @ApiBearerAuth()
    @UseGuards(AdminAuthGuard)
    @ApiOperation({ summary: 'Resend purchase confirmation email (admin only)' })
    async sendPurchaseConfirmationEmail(@Body() payload: ConfirmationEmailDto) {
        await this.purchasesService.sendPurchaseConfirmationEmail(
            payload.organizationDetails,
            payload.items,
            payload.total
        );
        return { success: true, message: 'Confirmation email sent successfully' };
    }

    @Post('app-provisioning')
    @ApiBearerAuth()
    @UseGuards(AdminAuthGuard)
    @ApiOperation({ summary: 'Provision apps (admin only)' })
    processAppProvisioning(@Body() payload: AppProvisioningDto) {
        return this.purchasesService.processAppProvisioning(payload);
    }
}
