import { Controller, Post, Body, UseGuards, BadRequestException, InternalServerErrorException, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PurchasesService } from '../purchases/purchases.service';
import { IssuesService } from '../issues/issues.service';
import { ManualPurchaseDto, AppProvisioningDto, ConfirmationEmailDto } from '../purchases/dto/purchase.dto';

@ApiTags('Admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly purchasesService: PurchasesService,
    private readonly issuesService: IssuesService,
  ) { }

  private buildManualReference(provided?: string) {
    if (provided && provided.trim().length > 0) {
      return provided.trim();
    }
    return `FMT_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  }

  @Post('manual-purchases/create')
  @UseGuards(ThrottlerGuard) // Should probably also have AuthGuard here!
  @ApiOperation({ summary: 'Create a manual purchase' })
  @ApiResponse({ status: 201, description: 'Purchase created successfully' })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 500, description: 'Internal Server Error' })
  async createManualPurchase(@Body() payload: ManualPurchaseDto) {
    try {
      const clientReference = this.buildManualReference(payload.clientReference);

      const organizationId = await this.purchasesService.ensureOrganizationAndBillingAddress(
        payload.billingDetails,
        payload.isExistingOrg ?? false,
      );

      const createdPurchase = await this.purchasesService.createPurchaseRecord({
        organizationId,
        clientReference,
        amount: payload.total,
        status: payload.status ?? 'completed',
        items: payload.items,
        paymentProvider: 'manual',
        paymentMethod: 'manual',
        externalTransactionId: clientReference,
        paymentDetails: {
          manualEntry: true,
          enteredBy: 'admin',
        },
      });

      const productIds = payload.items.map((item) => item.productId);
      const apps = await this.purchasesService.fetchProvisioningAppsByIds(productIds);
      const provisioningDrafts = this.purchasesService.buildProvisioningDrafts(
        apps,
        payload.billingDetails
      );

      return {
        success: true,
        purchase: createdPurchase,
        organizationId,
        clientReference,
        items: payload.items,
        provisioningDrafts,
        apps: apps.map((app) => ({ id: app._id, title: app.title })),
      };

    } catch (error) {
      console.error('Error creating manual purchase:', error);

      await this.issuesService.logApiError(
        error,
        '/admin/manual-purchases/create',
        'POST',
        payload,
        undefined,
        500
      );

      throw new InternalServerErrorException(error.message || 'Failed to create manual purchase');
    }
  }

  @Post('manual-purchases/provision')
  @ApiOperation({ summary: 'Provision apps for manual purchase' })
  async provisionManualPurchase(@Body() payload: AppProvisioningDto) {
    try {
      const result = await this.purchasesService.processAppProvisioning(payload);
      return result;
    } catch (error) {
      await this.issuesService.logApiError(error, '/admin/manual-purchases/provision', 'POST', payload);
      throw new InternalServerErrorException(error.message || 'Failed to provision app');
    }
  }

  @Post('manual-purchases/email')
  @ApiOperation({ summary: 'Send confirmation email for manual purchase' })
  async sendManualPurchaseEmail(@Body() payload: ConfirmationEmailDto) {
    try {
      await this.purchasesService.sendPurchaseConfirmationEmail(
        payload.organizationDetails,
        payload.items,
        payload.total
      );
      return { success: true, message: 'Email sent successfully' };
    } catch (error) {
      await this.issuesService.logApiError(error, '/admin/manual-purchases/email', 'POST', payload);
      throw new InternalServerErrorException(error.message || 'Failed to send email');
    }
  }

  @Get('manual-purchases/apps')
  @ApiOperation({ summary: 'Get all premium apps' })
  async getManualPurchaseApps() {
    try {
      const apps = await this.purchasesService.fetchAllPremiumApps();
      const summaries = apps.map((app) => ({
        id: app._id,
        title: app.title,
        price: app.price ?? 0,
      }));
      return { apps: summaries };
    } catch (error) {
      throw new InternalServerErrorException(error.message || 'Failed to load apps');
    }
  }
}
