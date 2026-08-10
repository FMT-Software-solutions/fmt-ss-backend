import { Injectable, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { bytesForAmount, creditsForAmount } from './pricing';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { AppsService } from '../apps/apps.service';
import { PurchasesService } from '../purchases/purchases.service';
import { ResendService } from '../../common/resend/resend.service';
import { IssuesService } from '../issues/issues.service';
import { HubtelCheckoutRequestDto, HubtelConfigRequestDto, HubtelStatusRequestDto } from './dto/hubtel.dto';
import { PaystackCheckoutDto, PaystackInitializeDto } from './dto/paystack.dto';
import { VerifySmsPurchaseDto } from './dto/verify-sms-purchase.dto';
import { InitializeSmsPurchaseDto } from './dto/initialize-sms-purchase.dto';
import { InitializeStoragePurchaseDto } from './dto/initialize-storage-purchase.dto';
import { VerifyStoragePurchaseDto } from './dto/verify-storage-purchase.dto';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly purchasesService: PurchasesService,
    private readonly appsService: AppsService,
    private readonly issuesService: IssuesService,
    private readonly resendService: ResendService,
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

  async handlePaystackInitialize(payload: PaystackInitializeDto) {
    const { customerPhoneNumber, clientReference } = payload;

    const normalizedPhone = this.normalizePhoneNumber(customerPhoneNumber);
    if (!normalizedPhone) {
      throw new BadRequestException('Invalid Ghana phone number');
    }

    const publicKey = this.configService.get<string>('PAYSTACK_PUBLIC_KEY');
    if (!publicKey) {
      throw new InternalServerErrorException('Paystack configuration is missing');
    }

    return {
      reference: clientReference,
      publicKey,
    };
  }

  async verifyPaystackTransaction(reference: string) {
    const secretKey = this.configService.get<string>('PAYSTACK_SECRET_KEY');
    if (!secretKey) {
      throw new InternalServerErrorException('Paystack secret key is missing');
    }

    try {
      const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${secretKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Paystack API returned ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      await this.issuesService.logApiError(
        error instanceof Error ? error.message : 'Paystack verification failed',
        'paystack_verification',
        'GET',
        { reference }
      );
      throw new BadRequestException('Payment verification failed');
    }
  }

  async handlePaystackCheckout(payload: PaystackCheckoutDto) {
    const { reference, checkoutPayload } = payload;

    if (!reference || !checkoutPayload?.billingDetails || !checkoutPayload?.items) {
      await this.issuesService.logIssue({
        issue_type: 'error',
        severity: 'low',
        category: 'payment',
        title: 'Paystack Checkout Missing Fields',
        description: 'Missing required fields in Paystack checkout payload',
        metadata: {
          reference,
          hasBillingDetails: !!checkoutPayload?.billingDetails,
          hasItems: !!checkoutPayload?.items
        }
      });
      throw new BadRequestException('Missing required fields');
    }

    // Verify transaction
    const verification = await this.verifyPaystackTransaction(reference);

    if (!verification.status || verification.data.status !== 'success') {
      await this.issuesService.logIssue({
        issue_type: 'error',
        severity: 'medium',
        category: 'payment',
        title: 'Paystack Payment Failed',
        description: `Payment status: ${verification.data.status}`,
        metadata: {
          reference,
          status: verification.data.status,
          gatewayResponse: verification.data.gateway_response
        }
      });
      throw new BadRequestException(`Payment not completed: ${verification.data.status}`);
    }

    const supabase: any = this.supabaseService.getServiceRoleClient();

    // Check existing purchase
    const { data: existingPurchase, error: existingError } = await supabase
      .from('purchases')
      .select('*')
      .eq('client_reference', reference)
      .maybeSingle();

    if (existingError) {
      await this.issuesService.logDatabaseError(existingError.message, 'paystack_checkout', 'purchases');
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
            payment_provider: 'paystack',
            payment_method: verification.data.channel,
            external_transaction_id: String(verification.data.id),
            payment_details: {
              ...existingPurchase.payment_details,
              paystackResponse: verification.data,
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
        clientReference: reference,
        amount: checkoutPayload.total,
        status: 'completed',
        items: checkoutPayload.items,
        paymentProvider: 'paystack',
        paymentMethod: verification.data.channel,
        externalTransactionId: String(verification.data.id),
        paymentDetails: {
          paystackResponse: verification.data,
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
          title: 'Failed to record paid app access (Paystack)',
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
      console.error('Failed to send confirmation email (Paystack):', emailError);
      await this.issuesService.logIssue({
        issue_type: 'error',
        severity: 'medium',
        category: 'notification',
        title: 'Purchase Confirmation Email Failed (Paystack)',
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

  async initializeSmsPurchase(dto: InitializeSmsPurchaseDto) {
    const { amountGhs, email, callbackUrl, organizationId, organizationName, userId, appId, appName } = dto;
    const secretKey = this.configService.get<string>('PAYSTACK_SECRET_KEY');

    if (!secretKey) {
      throw new InternalServerErrorException('Paystack secret key is missing');
    }

    // Derived here, never taken from the request. dto.creditsPurchased is
    // accepted for backwards compatibility with older clients but ignored.
    const creditsPurchased = creditsForAmount(amountGhs);
    if (creditsPurchased <= 0) {
      throw new BadRequestException('Purchase amount is too small to buy any credits');
    }

    try {
      const response = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          amount: amountGhs * 100, // Paystack expects pesewas
          callback_url: callbackUrl,
          // Written by US and handed back verbatim on the webhook, so the
          // webhook can credit the right org in the right app's database
          // without the client being involved at all.
          metadata: {
            organizationId,
            organizationName,
            userId,
            appId,
            appName,
            creditsPurchased,
            amountGhs,
            purchaseType: 'sms',
          },
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.status) {
        throw new BadRequestException(data.message || 'Failed to initialize Paystack transaction');
      }

      const reference = data.data.reference as string;

      // Park a pending row so the desktop app can poll this reference, and so
      // abandoned checkouts leave a trail.
      await this.recordPendingSmsPurchase({
        appId,
        organizationId,
        userId,
        reference,
        amountGhs,
        creditsPurchased,
      });

      return { authorizationUrl: data.data.authorization_url, reference, creditsPurchased };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new InternalServerErrorException('An unexpected error occurred during Paystack initialization');
    }
  }

  private async recordPendingSmsPurchase(params: {
    appId: string;
    organizationId: string;
    userId: string;
    reference: string;
    amountGhs: number;
    creditsPurchased: number;
  }) {
    try {
      const supabase = this.appsService.getSupabaseClient(params.appId);
      const { error } = await supabase.from('payment_records').insert({
        organization_id: params.organizationId,
        user_id: params.userId,
        amount_paid: params.amountGhs,
        credits_purchased: params.creditsPurchased,
        gateway_reference: params.reference,
        status: 'pending',
      });
      if (error) {
        // Non-fatal: the webhook upserts on this reference anyway. Losing the
        // pending row costs polling visibility, not the purchase.
        this.logger.warn(`Could not record pending payment ${params.reference}: ${error.message}`);
      }
    } catch (err) {
      this.logger.warn(`Could not record pending payment ${params.reference}: ${(err as Error)?.message}`);
    }
  }

  /**
   * Verifies a reference with Paystack and credits it.
   *
   * This is now only an ACCELERATOR for the redirect flow — the Paystack
   * webhook is the source of truth and will credit the same reference whether
   * or not this is ever called. Both paths funnel into creditSmsPurchase,
   * which is idempotent on gateway_reference, so whichever arrives first wins
   * and the second is a no-op.
   *
   * dto.creditsPurchased is accepted (older clients still send it) but IGNORED:
   * credits are derived from the amount Paystack confirms was charged.
   */
  async verifySmsPurchase(dto: VerifySmsPurchaseDto) {
    this.logger.log(`Starting SMS purchase verification for reference: ${dto.reference}, appId: ${dto.appId}, orgId: ${dto.organizationId}`);
    const { organizationId, organizationName, userId, reference, appId, appName } = dto;

    const verified = await this.verifyPaystackReference(reference);

    return this.creditSmsPurchase({
      appId,
      appName,
      organizationId,
      organizationName,
      userId,
      reference,
      amountGhs: verified.amountGhs,
      source: 'verify',
    });
  }

  /**
   * Confirms a reference really was paid, and returns the amount Paystack says
   * was actually charged. Everything downstream prices off THIS number, never
   * off anything the caller supplied.
   */
  private async verifyPaystackReference(reference: string): Promise<{ amountGhs: number; raw: any }> {
    const paystackSecret = this.configService.get<string>('PAYSTACK_SECRET_KEY');
    if (!paystackSecret) {
      this.logger.error('Paystack secret key is missing in environment variables');
      throw new InternalServerErrorException('Paystack secret key is missing');
    }

    const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${paystackSecret}` },
    });
    const verifyData = await verifyResponse.json();

    if (!verifyResponse.ok || !verifyData.status || verifyData.data?.status !== 'success') {
      this.logger.error(`Paystack verification failed for ${reference}. Data status: ${verifyData.data?.status}`);
      throw new BadRequestException('Payment verification failed');
    }

    return { amountGhs: verifyData.data.amount / 100, raw: verifyData.data };
  }

  /**
   * Grants SMS credits for a CONFIRMED payment. The single place credits are
   * ever added — called by both the webhook and the verify endpoint.
   *
   * Idempotent on payment_records.gateway_reference: a reference already marked
   * success returns early without touching the balance.
   */
  private async creditSmsPurchase(params: {
    appId: string;
    appName?: string;
    organizationId: string;
    organizationName?: string;
    userId: string;
    reference: string;
    amountGhs: number;
    source: 'webhook' | 'verify';
  }) {
    const { appId, appName, organizationId, organizationName, userId, reference, amountGhs, source } = params;

    // Priced server-side from the verified amount.
    const creditsPurchased = creditsForAmount(amountGhs);
    if (creditsPurchased <= 0) {
      throw new BadRequestException('Payment amount is too small to buy any credits');
    }

    const supabase = this.appsService.getSupabaseClient(appId);

    try {
      // Idempotency. A pending row from initialize is expected and gets
      // upgraded; a success row means someone got here first.
      const { data: existingRecord, error: checkExistingError } = await supabase
        .from('payment_records')
        .select('id, status')
        .eq('gateway_reference', reference)
        .maybeSingle();

      if (checkExistingError) {
        this.logger.error(`Error checking existing payment record: ${checkExistingError.message}`, checkExistingError);
      }

      if (existingRecord?.status === 'success') {
        this.logger.log(`Payment ${reference} already credited (via ${source} path). No-op.`);
        return { success: true, message: 'Payment already processed', alreadyProcessed: true };
      }

      if (existingRecord) {
        const { error: updateError } = await supabase
          .from('payment_records')
          .update({
            status: 'success',
            amount_paid: amountGhs,
            credits_purchased: creditsPurchased,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingRecord.id);
        if (updateError) {
          this.logger.error(`Failed to promote pending payment record: ${updateError.message}`, updateError);
          throw new InternalServerErrorException('Failed to record payment');
        }
      } else {
        const { error: paymentError } = await supabase
          .from('payment_records')
          .insert({
            organization_id: organizationId,
            user_id: userId,
            amount_paid: amountGhs,
            credits_purchased: creditsPurchased,
            gateway_reference: reference,
            status: 'success',
          });
        if (paymentError) {
          this.logger.error(`Failed to insert payment record: ${paymentError.message}`, paymentError);
          throw new InternalServerErrorException('Failed to record payment');
        }
      }

      // Add credits + write the ledger entry atomically via RPC (avoids the
      // read-modify-write race). Falls back to the legacy non-atomic path for
      // app databases that don't have the RPC yet.
      let creditsRecorded = false;
      let newBalance: number | null = null;
      const purchaseDescription = `Purchased ${creditsPurchased} credits via Paystack`;
      try {
        const { data: addData, error: addError } = await supabase.rpc('add_sms_credits', {
          p_org_id: organizationId,
          p_credits: creditsPurchased,
          p_description: purchaseDescription,
          p_metadata: { reference, amountGhs, source },
        });
        if (addError) throw addError;
        creditsRecorded = true;
        newBalance = (addData as { new_balance?: number } | null)?.new_balance ?? null;
        this.logger.log(`Atomically added ${creditsPurchased} credits for org ${organizationId} (${source})`);
      } catch (rpcErr) {
        this.logger.warn(
          `add_sms_credits RPC unavailable, falling back to non-atomic update: ${(rpcErr as Error)?.message}`,
        );
      }

      if (!creditsRecorded) {
        const { data: currentBalance, error: getBalanceError } = await supabase
          .from('organization_sms_balances')
          .select('credit_balance')
          .eq('organization_id', organizationId)
          .single();

        if (getBalanceError && getBalanceError.code !== 'PGRST116') { // PGRST116 is "No rows found"
          this.logger.error(`Failed to retrieve current SMS balance: ${getBalanceError.message}`, getBalanceError);
        }

        newBalance = (currentBalance?.credit_balance || 0) + creditsPurchased;

        const { error: balanceError } = await supabase
          .from('organization_sms_balances')
          .upsert({
            organization_id: organizationId,
            credit_balance: newBalance,
            updated_at: new Date().toISOString(),
          });

        if (balanceError) {
          this.logger.error(`Failed to update SMS balance: ${balanceError.message}`, balanceError);
          throw new InternalServerErrorException('Failed to update SMS balance');
        }

        const { error: txError } = await supabase
          .from('sms_credit_transactions')
          .insert({
            organization_id: organizationId,
            type: 'purchase',
            amount: creditsPurchased,
            description: purchaseDescription,
            metadata: { reference, amountGhs, source },
          });

        if (txError) {
          this.logger.error(`Failed to insert transaction ledger entry: ${txError.message}`, txError);
        }
      }

      await this.notifyAdminsOfSmsPurchase({
        organizationId,
        organizationName,
        appId,
        appName,
        creditsPurchased,
        amountGhs,
        reference,
      });

      this.logger.log(`SMS purchase ${reference} credited successfully via ${source}.`);
      return { success: true, newBalance, creditsPurchased, alreadyProcessed: false };
    } catch (error) {
      this.logger.error(`Error crediting SMS purchase ${reference}: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new InternalServerErrorException('An unexpected error occurred while crediting the purchase');
    }
  }

  private async notifyAdminsOfSmsPurchase(params: {
    organizationId: string;
    organizationName?: string;
    appId: string;
    appName?: string;
    creditsPurchased: number;
    amountGhs: number;
    reference: string;
  }) {
    try {
      const adminEmailsString = this.configService.get<string>('ADMIN_EMAILS');
      if (!adminEmailsString) return;

      const adminEmails = adminEmailsString.split(',').map(e => e.trim()).filter(e => e.length > 0);
      if (adminEmails.length === 0) return;

      const orgName = params.organizationName || params.organizationId;
      const htmlContent = `
        <h2>New SMS Credit Purchase</h2>
        <p>Organization <strong>${orgName}</strong> has purchased SMS credits.</p>
        <ul>
          <li><strong>App:</strong> ${params.appName || params.appId}</li>
          <li><strong>Credits Purchased:</strong> ${params.creditsPurchased}</li>
          <li><strong>Amount Paid:</strong> GHS ${params.amountGhs}</li>
          <li><strong>Reference:</strong> ${params.reference}</li>
        </ul>
      `;

      await this.resendService.sendEmail({
        from: 'FMT Software Solutions <noreply@fmtsoftware.com>',
        to: adminEmails,
        subject: `[FMT Software Solutions] New SMS Credit Purchase: ${orgName}`,
        html: htmlContent,
      });
      this.logger.log(`Admin notification email sent for SMS purchase ${params.reference}`);
    } catch (emailError) {
      // Never let a mail failure fail a paid purchase.
      this.logger.error(`Failed to send SMS purchase notification email: ${(emailError as Error)?.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Paystack webhook — the source of truth for crediting
  //
  // Crediting used to depend on the browser coming back to the app and calling
  // /verify-sms-purchase. That never worked in the packaged desktop app (its
  // callback URL is a file:// path Paystack cannot redirect to, so Paystack
  // fell back to the dashboard default and the app never saw the reference),
  // and it silently failed on the web whenever someone closed the tab after
  // paying. Either way the money was taken and no credits were granted.
  //
  // Paystack calls this endpoint server-to-server regardless of what the client
  // does, so it works identically for web, desktop and mobile.
  // ---------------------------------------------------------------------------

  /**
   * Verifies the webhook really came from Paystack.
   *
   * The signature is an HMAC-SHA512 of the RAW request body keyed with the
   * secret key, so it must be computed over the exact bytes received — a
   * re-serialised JSON.stringify of the parsed body will not match.
   */
  verifyPaystackSignature(rawBody: Buffer | string | undefined, signature: string | undefined): boolean {
    const secretKey = this.configService.get<string>('PAYSTACK_SECRET_KEY');
    if (!secretKey || !signature || !rawBody) return false;

    const expected = createHmac('sha512', secretKey)
      .update(typeof rawBody === 'string' ? rawBody : Buffer.from(rawBody))
      .digest('hex');

    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /**
   * Handles a verified Paystack event. Routes on the metadata WE wrote at
   * initialize time, so the correct app database and organisation are credited
   * without trusting anything from a client.
   *
   * Always resolves — never throws back at Paystack for a payload we simply
   * don't handle, or Paystack will retry it forever.
   */
  async handlePaystackWebhook(event: any) {
    const eventType = event?.event;

    if (eventType !== 'charge.success') {
      this.logger.log(`Ignoring Paystack webhook event: ${eventType}`);
      return { received: true, handled: false };
    }

    const data = event.data ?? {};
    const metadata = data.metadata ?? {};
    const reference = data.reference as string;
    const amountGhs = (data.amount ?? 0) / 100;
    const { organizationId, organizationName, userId, appId, appName, purchaseType } = metadata;

    if (!reference || !organizationId || !appId || !userId) {
      // A payment initiated outside these flows (e.g. the website store) —
      // acknowledge so Paystack stops retrying, but don't try to credit.
      this.logger.warn(`Paystack webhook ${reference} has no SMS/storage metadata; ignoring.`);
      return { received: true, handled: false };
    }

    try {
      if (purchaseType === 'storage') {
        const result = await this.creditStoragePurchase({
          appId,
          appName,
          organizationId,
          organizationName,
          userId,
          reference,
          amountGhs,
          source: 'webhook',
        });
        return { received: true, handled: true, ...result };
      }

      const result = await this.creditSmsPurchase({
        appId,
        appName,
        organizationId,
        organizationName,
        userId,
        reference,
        amountGhs,
        source: 'webhook',
      });
      return { received: true, handled: true, ...result };
    } catch (error) {
      // Log loudly but return 200: Paystack retries on non-2xx, and a poison
      // payload would otherwise be redelivered indefinitely. The pending
      // payment_record row is the recovery trail.
      this.logger.error(
        `Failed to process Paystack webhook for ${reference}: ${(error as Error)?.message}`,
        (error as Error)?.stack,
      );
      return { received: true, handled: false, error: (error as Error)?.message };
    }
  }

  /**
   * Status of a purchase by reference — what the desktop app polls while the
   * user completes payment in their system browser.
   */
  async getPurchaseStatusByReference(reference: string, appId: string) {
    const supabase = this.appsService.getSupabaseClient(appId);

    const { data, error } = await supabase
      .from('payment_records')
      .select('status, credits_purchased, amount_paid')
      .eq('gateway_reference', reference)
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to look up purchase ${reference}: ${error.message}`);
      throw new InternalServerErrorException('Failed to look up purchase status');
    }

    if (!data) return { status: 'unknown' as const };

    // Deliberately no organization_id: this endpoint is public (anyone holding
    // a reference can call it, including the hosted payment-complete page), so
    // it returns only what a payer already knows about their own transaction.
    return {
      status: data.status as 'pending' | 'success' | 'failed',
      creditsPurchased: data.credits_purchased,
      amountGhs: data.amount_paid,
    };
  }

  // ---------------------------------------------------------------------------
  // Storage credit purchases
  //
  // Same Paystack redirect+verify pattern as SMS credits: `initializeStoragePurchase`
  // returns the Paystack authorization URL for a redirect; `verifyStoragePurchase`
  // is called on return, verifies the reference server-side, and grants the
  // storage bytes to the org (via the `grant_storage` RPC in the app's Supabase).
  // Idempotent by `gateway_reference` (unique on storage_purchases).
  // ---------------------------------------------------------------------------

  async initializeStoragePurchase(dto: InitializeStoragePurchaseDto) {
    const { amountGhs, email, callbackUrl, organizationId, organizationName, userId, appId, appName } = dto;
    const secretKey = this.configService.get<string>('PAYSTACK_SECRET_KEY');

    if (!secretKey) {
      throw new InternalServerErrorException('Paystack secret key is missing');
    }

    // Derived here, never taken from the request (see pricing.ts).
    const bytesPurchased = bytesForAmount(amountGhs);
    if (bytesPurchased <= 0) {
      throw new BadRequestException('Purchase amount does not cover any storage tier');
    }

    try {
      const response = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          amount: amountGhs * 100, // Paystack expects pesewas
          callback_url: callbackUrl,
          metadata: {
            organizationId,
            organizationName,
            userId,
            appId,
            appName,
            bytesPurchased,
            amountGhs,
            purchaseType: 'storage',
          },
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.status) {
        throw new BadRequestException(data.message || 'Failed to initialize Paystack transaction');
      }

      return { authorizationUrl: data.data.authorization_url, reference: data.data.reference };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new InternalServerErrorException('An unexpected error occurred during Paystack initialization');
    }
  }

  /**
   * Accelerator for the redirect flow, mirroring verifySmsPurchase. The webhook
   * credits the same reference independently; both funnel into
   * creditStoragePurchase, which is idempotent on gateway_reference.
   *
   * dto.bytesPurchased is accepted for backwards compatibility but IGNORED —
   * bytes are derived from the amount Paystack confirms was charged.
   */
  async verifyStoragePurchase(dto: VerifyStoragePurchaseDto) {
    this.logger.log(`Starting storage purchase verification for reference: ${dto.reference}, appId: ${dto.appId}, orgId: ${dto.organizationId}`);
    const { organizationId, organizationName, userId, reference, appId, appName } = dto;

    const verified = await this.verifyPaystackReference(reference);

    return this.creditStoragePurchase({
      appId,
      appName,
      organizationId,
      organizationName,
      userId,
      reference,
      amountGhs: verified.amountGhs,
      source: 'verify',
    });
  }

  /**
   * Grants storage for a CONFIRMED payment. The single place bytes are ever
   * granted — called by both the webhook and the verify endpoint.
   */
  private async creditStoragePurchase(params: {
    appId: string;
    appName?: string;
    organizationId: string;
    organizationName?: string;
    userId: string;
    reference: string;
    amountGhs: number;
    source: 'webhook' | 'verify';
  }) {
    const { appId, appName, organizationId, organizationName, userId, reference, amountGhs, source } = params;

    const bytesPurchased = bytesForAmount(amountGhs);
    if (bytesPurchased <= 0) {
      throw new BadRequestException('Payment amount does not cover any storage tier');
    }

    const supabase = this.appsService.getSupabaseClient(appId);

    try {
      // Idempotency (storage_purchases.gateway_reference is UNIQUE)
      const { data: existingRecord } = await supabase
        .from('storage_purchases')
        .select('id, status')
        .eq('gateway_reference', reference)
        .maybeSingle();

      if (existingRecord?.status === 'success') {
        this.logger.log(`Storage purchase ${reference} already granted (via ${source}). No-op.`);
        return { success: true, message: 'Payment already processed', alreadyProcessed: true };
      }

      if (existingRecord) {
        const { error: updateError } = await supabase
          .from('storage_purchases')
          .update({
            status: 'success',
            bytes_purchased: bytesPurchased,
            amount_ghs: amountGhs,
            metadata: { reference, amountGhs, appId, appName, source },
          })
          .eq('id', existingRecord.id);
        if (updateError) {
          this.logger.error(`Failed to promote pending storage purchase: ${updateError.message}`, updateError);
          throw new InternalServerErrorException('Failed to record payment');
        }
      } else {
        const { error: purchaseError } = await supabase
          .from('storage_purchases')
          .insert({
            organization_id: organizationId,
            user_id: userId,
            bytes_purchased: bytesPurchased,
            amount_ghs: amountGhs,
            gateway_reference: reference,
            status: 'success',
            metadata: { reference, amountGhs, appId, appName, source },
          });
        if (purchaseError) {
          this.logger.error(`Failed to insert storage_purchases: ${purchaseError.message}`, purchaseError);
          throw new InternalServerErrorException('Failed to record payment');
        }
      }

      // Grant bytes to the org (RPC increments quota_bytes atomically)
      const { error: grantError } = await supabase.rpc('grant_storage', {
        org_id: organizationId,
        bytes: bytesPurchased,
      });
      if (grantError) {
        this.logger.error(`grant_storage failed: ${grantError.message}`, grantError);
        throw new InternalServerErrorException('Failed to grant storage');
      }

      // Read the resulting quota so the client can update UI immediately
      const { data: quotaRow } = await supabase
        .from('organization_storage')
        .select('quota_bytes, used_bytes')
        .eq('organization_id', organizationId)
        .maybeSingle();

      try {
        const adminEmailsString = this.configService.get<string>('ADMIN_EMAILS');
        if (adminEmailsString) {
          const adminEmails = adminEmailsString.split(',').map(e => e.trim()).filter(e => e.length > 0);
          if (adminEmails.length > 0) {
            const orgName = organizationName || organizationId;
            const gib = (bytesPurchased / (1024 * 1024 * 1024)).toFixed(2);
            await this.resendService.sendEmail({
              from: 'FMT Software Solutions <noreply@fmtsoftware.com>',
              to: adminEmails,
              subject: `[FMT Software Solutions] New Storage Purchase: ${orgName}`,
              html: `
                <h2>New Storage Purchase</h2>
                <p>Organization <strong>${orgName}</strong> has purchased storage.</p>
                <ul>
                  <li><strong>App:</strong> ${appName || appId}</li>
                  <li><strong>Storage Purchased:</strong> ${gib} GiB (${bytesPurchased} bytes)</li>
                  <li><strong>Amount Paid:</strong> GHS ${amountGhs}</li>
                  <li><strong>Reference:</strong> ${reference}</li>
                </ul>
              `,
            });
          }
        }
      } catch (emailError) {
        this.logger.error(`Failed to send storage purchase notification email: ${(emailError as Error)?.message}`);
      }

      this.logger.log(`Storage purchase ${reference} granted successfully via ${source}.`);
      return {
        success: true,
        bytesPurchased,
        quotaBytes: quotaRow?.quota_bytes ?? null,
        usedBytes: quotaRow?.used_bytes ?? null,
        alreadyProcessed: false,
      };
    } catch (error) {
      this.logger.error(`Error granting storage purchase ${reference}: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new InternalServerErrorException('An unexpected error occurred while granting storage');
    }
  }
}
