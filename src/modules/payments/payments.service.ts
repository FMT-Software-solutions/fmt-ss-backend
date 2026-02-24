import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { PurchasesService } from '../purchases/purchases.service';
import { IssuesService } from '../issues/issues.service';
import { HubtelCheckoutRequestDto, HubtelConfigRequestDto, HubtelStatusRequestDto } from './dto/hubtel.dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly purchasesService: PurchasesService,
    private readonly issuesService: IssuesService,
    private readonly configService: ConfigService,
  ) { }

  private getPurchaseStatus(status?: string) {
    const normalized = status?.toLowerCase();
    if (!normalized) return 'pending';
    if (['paid', 'success', 'successful', 'completed'].includes(normalized)) return 'completed';
    if (['unpaid', 'failed', 'declined', 'canceled', 'cancelled', 'reversed'].includes(normalized)) return 'failed';
    return 'pending';
  }

  private normalizeSuccessPayload(payload?: any) {
    if (!payload) return { status: 'pending', paymentMethod: null, externalTransactionId: null };

    const dataObject = payload.data && typeof payload.data === 'object' ? payload.data : null;
    const statusCandidate = dataObject?.status || payload.status || null;
    const responseCode = payload.responseCode || payload.ResponseCode;
    const successStatus = payload.success === true ? 'paid' : undefined;
    const responseCodeStatus = responseCode === '0000' ? 'paid' : undefined;
    const status = this.getPurchaseStatus(statusCandidate || successStatus || responseCodeStatus);

    return {
      status,
      paymentMethod: dataObject?.paymentMethod || payload.paymentMethod || null,
      externalTransactionId: dataObject?.externalTransactionId || payload.externalTransactionId || null,
      clientSuccessPayload: payload,
    };
  }

  async handleHubtelCheckout(payload: HubtelCheckoutRequestDto) {
    const { clientReference, checkoutPayload, paymentResponse } = payload;
    const normalized = this.normalizeSuccessPayload(paymentResponse);

    if (!clientReference || !checkoutPayload?.billingDetails || !checkoutPayload?.items) {
      await this.issuesService.logIssue({
        issue_type: 'error',
        severity: 'low',
        category: 'payment',
        title: 'Hubtel Checkout Missing Fields',
        description: 'Missing required fields in Hubtel checkout payload',
        metadata: {
          clientReference,
          hasBillingDetails: !!checkoutPayload?.billingDetails,
          hasItems: !!checkoutPayload?.items
        }
      });
      throw new BadRequestException('Missing required fields');
    }

    if (normalized.status !== 'completed') {
      await this.issuesService.logIssue({
        issue_type: 'error',
        severity: 'medium',
        category: 'payment',
        title: 'Hubtel Payment Failed',
        description: `Payment status: ${normalized.status}`,
        metadata: {
          clientReference,
          responseCode: paymentResponse?.ResponseCode,
          status: normalized.status
        }
      });
      throw new BadRequestException(`Payment not completed: ${normalized.status}`);
    }

    const supabase: any = this.supabaseService.getServiceRoleClient();

    // Check existing purchase
    const { data: existingPurchase, error: existingError } = await supabase
      .from('purchases')
      .select('*')
      .eq('client_reference', clientReference) // Using client_reference based on my Database types
      .maybeSingle();

    if (existingError) {
      await this.issuesService.logDatabaseError(existingError.message, 'hubtel_checkout', 'purchases');
      throw new InternalServerErrorException('Failed to lookup purchase');
    }

    let purchaseRecord = existingPurchase;

    if (existingPurchase) {
      // Update existing
      if (existingPurchase.status !== 'completed') {
        const { data: updated, error: updateError } = await supabase
          .from('purchases')
          .update({
            status: 'completed',
            payment_provider: 'hubtel',
            payment_method: normalized.paymentMethod || existingPurchase.payment_method,
            external_transaction_id: normalized.externalTransactionId || existingPurchase.external_transaction_id,
            payment_details: {
              ...existingPurchase.payment_details,
              clientSuccess: normalized.clientSuccessPayload,
              updatedAt: new Date().toISOString()
            }
          })
          .eq('id', existingPurchase.id)
          .select()
          .single();

        if (updateError) throw new InternalServerErrorException(updateError.message);
        purchaseRecord = updated;
      }
    } else {
      // Create new
      const organizationId = await this.purchasesService.ensureOrganizationAndBillingAddress(
        checkoutPayload.billingDetails,
        checkoutPayload.isExistingOrg
      );

      purchaseRecord = await this.purchasesService.createPurchaseRecord({
        organizationId,
        clientReference,
        amount: checkoutPayload.total,
        status: 'completed',
        items: checkoutPayload.items,
        paymentProvider: 'hubtel',
        paymentMethod: normalized.paymentMethod,
        externalTransactionId: normalized.externalTransactionId,
        paymentDetails: {
          clientSuccess: normalized.clientSuccessPayload,
        }
      });
    }

    if (checkoutPayload.appProvisioningDetails) {
      await this.purchasesService.provisionApps(
        purchaseRecord.organization_id,
        checkoutPayload.billingDetails,
        checkoutPayload.appProvisioningDetails
      );
    }

    // Record app access in organization_apps table
    const organizationAppsData = checkoutPayload.items.map(item => ({
      organization_id: purchaseRecord.organization_id,
      app_id: item.productId,
      status: 'active',
      plan_type: 'paid',
      access_granted_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));

    if (organizationAppsData.length > 0) {
      const { error: accessError } = await supabase
        .from('organization_apps')
        .upsert(organizationAppsData, { onConflict: 'organization_id, app_id' });

      if (accessError) {
        console.error(`Failed to record paid access for org ${purchaseRecord.organization_id}:`, accessError);
        await this.issuesService.logIssue({
          issue_type: 'error',
          severity: 'critical',
          category: 'purchase',
          title: 'Failed to record paid app access (Hubtel)',
          description: `Failed to insert organization_apps records for purchase ${purchaseRecord.id}`,
          error_message: accessError.message,
          organization_id: purchaseRecord.organization_id,
          purchase_id: purchaseRecord.id,
          metadata: { items: checkoutPayload.items.map(i => i.productId) }
        });
      }
    }

    try {
      await this.purchasesService.sendPurchaseConfirmationEmail(
        {
          organizationName: checkoutPayload.billingDetails.organizationName,
          organizationEmail: checkoutPayload.billingDetails.organizationEmail
        },
        checkoutPayload.items,
        checkoutPayload.total
      );
    } catch (emailError) {
      console.error('Failed to send confirmation email (Hubtel):', emailError);
      await this.issuesService.logIssue({
        issue_type: 'error',
        severity: 'medium',
        category: 'notification',
        title: 'Purchase Confirmation Email Failed (Hubtel)',
        description: `Failed to send purchase confirmation email for ${checkoutPayload.billingDetails.organizationEmail}`,
        error_message: emailError.message,
        stack_trace: emailError.stack,
        organization_id: purchaseRecord.organization_id,
        purchase_id: purchaseRecord.id,
      });
    }

    return { success: true, purchase: purchaseRecord };
  }

  private normalizeCallbackPayload(payload: any) {
    if (!payload) return null;
    const dataObject = payload.data && typeof payload.data === 'object' ? payload.data : null;

    const clientReference = payload.clientReference || payload.ClientReference || dataObject?.clientReference || null;
    const responseCode = payload.responseCode || payload.ResponseCode || null;

    const statusCandidate = dataObject?.status || payload.status || null;
    const inferredStatus = responseCode === '0000' ? 'paid' : undefined;
    const status = this.getPurchaseStatus(statusCandidate || inferredStatus);

    return {
      clientReference,
      status,
      paymentMethod: dataObject?.paymentMethod || payload.paymentMethod || null,
      externalTransactionId: dataObject?.externalTransactionId || payload.externalTransactionId || null,
      rawPayload: payload
    };
  }

  async handleHubtelCallback(payload: any) {
    const normalized = this.normalizeCallbackPayload(payload);
    if (!normalized || !normalized.clientReference) {
      return { success: false, error: 'Invalid callback payload' };
    }

    const supabase: any = this.supabaseService.getServiceRoleClient();

    const { data: existingPurchase, error: existingError } = await supabase
      .from('purchases')
      .select('*')
      .eq('client_reference', normalized.clientReference)
      .maybeSingle();

    if (existingError || !existingPurchase) {
      await this.issuesService.logDatabaseError(
        existingError?.message || 'Purchase not found',
        'hubtel_callback',
        'purchases',
        undefined,
        { clientReference: normalized.clientReference }
      );
      return { success: false, error: 'Purchase not found' };
    }

    // Update status
    const newStatus = normalized.status === 'completed' ? 'completed' :
      normalized.status === 'failed' ? 'failed' : existingPurchase.status;

    if (existingPurchase.status !== 'completed' && newStatus === 'completed') {
      // Mark as completed
      const { data: updated, error: updateError } = await supabase
        .from('purchases')
        .update({
          status: 'completed',
          payment_details: {
            ...existingPurchase.payment_details,
            callbackPayload: normalized.rawPayload,
            updatedAt: new Date().toISOString()
          }
        })
        .eq('id', existingPurchase.id)
        .select()
        .single();

      if (updateError) {
        await this.issuesService.logDatabaseError(updateError.message, 'hubtel_callback_update', 'purchases');
        return { success: false, error: 'Failed to update purchase status' };
      }

      // Record app access in organization_apps table
      const items = existingPurchase.items as any[];
      if (items && Array.isArray(items)) {
        const organizationAppsData = items.map(item => ({
          organization_id: existingPurchase.organization_id,
          app_id: item.productId || item.appId,
          status: 'active',
          plan_type: 'paid',
          access_granted_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }));

        if (organizationAppsData.length > 0) {
          const { error: accessError } = await supabase
            .from('organization_apps')
            .upsert(organizationAppsData, { onConflict: 'organization_id, app_id' });

          if (accessError) {
            console.error(`Failed to record paid access for org ${existingPurchase.organization_id} via callback:`, accessError);
            await this.issuesService.logIssue({
              issue_type: 'error',
              severity: 'critical',
              category: 'purchase',
              title: 'Failed to record paid app access (Hubtel Callback)',
              description: `Failed to insert organization_apps records for purchase ${existingPurchase.id}`,
              error_message: accessError.message,
              organization_id: existingPurchase.organization_id,
              purchase_id: existingPurchase.id,
              metadata: { items: items.map(i => i.productId || i.appId) }
            });
          }
        }
      }
    }

    return { success: true };
  }

  private normalizePhoneNumber(phone: string): string | null {
    let cleaned = phone.replace(/[\s-]/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '233' + cleaned.substring(1);
    }
    if (cleaned.length === 12 && cleaned.startsWith('233')) {
      return cleaned;
    }
    if (cleaned.startsWith('+233')) {
      return cleaned.substring(1);
    }
    if (cleaned.length === 9) {
      return '233' + cleaned;
    }
    return null;
  }

  async handleHubtelConfig(payload: HubtelConfigRequestDto) {
    const { amount, purchaseDescription, customerPhoneNumber, clientReference } = payload;

    const normalizedPhone = this.normalizePhoneNumber(customerPhoneNumber);
    if (!normalizedPhone) {
      throw new BadRequestException('Invalid Ghana phone number');
    }

    const apiId = this.configService.get<string>('HUBTEL_API_ID');
    const apiKey = this.configService.get<string>('HUBTEL_API_KEY');
    const merchantAccountNumber = this.configService.get<string>('HUBTEL_MERCHANT_ACCOUNT');
    const merchantAccount = Number(merchantAccountNumber);

    if (!apiId || !apiKey || !merchantAccountNumber || Number.isNaN(merchantAccount)) {
      throw new InternalServerErrorException('Hubtel configuration is missing');
    }

    const baseUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const callbackUrl = `${baseUrl.replace(/\/$/, '')}/api/payments/hubtel/callback`;
    const basicAuth = Buffer.from(`${apiId}:${apiKey}`).toString('base64');

    return {
      clientReference,
      config: {
        merchantAccount,
        basicAuth,
        callbackUrl,
        integrationType: 'External',
      },
    };
  }

  async handleHubtelStatus(payload: HubtelStatusRequestDto) {
    const { clientReference } = payload;

    const apiId = this.configService.get<string>('HUBTEL_API_ID');
    const apiKey = this.configService.get<string>('HUBTEL_API_KEY');
    const merchantAccountNumber = this.configService.get<string>('HUBTEL_MERCHANT_ACCOUNT');
    const merchantAccount = Number(merchantAccountNumber);

    if (!apiId || !apiKey || !merchantAccountNumber || Number.isNaN(merchantAccount)) {
      throw new InternalServerErrorException('Hubtel configuration is missing');
    }

    const basicAuth = Buffer.from(`${apiId}:${apiKey}`).toString('base64');
    const statusUrl = `https://rmsc.hubtel.com/v1/merchantaccount/merchants/${merchantAccount}/transactions/status?clientReference=${encodeURIComponent(clientReference)}`;

    try {
      const response = await fetch(statusUrl, {
        headers: {
          Authorization: `Basic ${basicAuth}`,
        },
      });

      const dataText = await response.text();
      let data;
      try {
        data = JSON.parse(dataText);
      } catch {
        data = dataText;
      }

      if (!response.ok) {
        await this.issuesService.logApiError(
          'Hubtel status check failed',
          'hubtel_status',
          'POST',
          { clientReference, status: response.status, data }
        );
      }

      return {
        ok: response.ok,
        status: response.status,
        data,
      };
    } catch (error) {
      await this.issuesService.logApiError(
        error instanceof Error ? error.message : 'Hubtel status check error',
        'hubtel_status',
        'POST'
      );
      throw new BadRequestException('Invalid request payload or Hubtel error');
    }
  }
}
