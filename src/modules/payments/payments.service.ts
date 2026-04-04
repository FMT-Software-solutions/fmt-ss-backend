import { Injectable, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { AppsService } from '../apps/apps.service';
import { PurchasesService } from '../purchases/purchases.service';
import { ResendService } from '../../common/resend/resend.service';
import { IssuesService } from '../issues/issues.service';
import { HubtelCheckoutRequestDto, HubtelConfigRequestDto, HubtelStatusRequestDto } from './dto/hubtel.dto';
import { PaystackCheckoutDto, PaystackInitializeDto } from './dto/paystack.dto';
import { VerifySmsPurchaseDto } from './dto/verify-sms-purchase.dto';
import { InitializeSmsPurchaseDto } from './dto/initialize-sms-purchase.dto';

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
    const { amountGhs, email, callbackUrl, organizationId, organizationName, userId, appId, appName, creditsPurchased } = dto;
    const secretKey = this.configService.get<string>('PAYSTACK_SECRET_KEY');

    if (!secretKey) {
      throw new InternalServerErrorException('Paystack secret key is missing');
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
            creditsPurchased,
            amountGhs,
          },
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.status) {
        throw new BadRequestException(data.message || 'Failed to initialize Paystack transaction');
      }

      // Return the authorization_url to redirect the user
      return { authorizationUrl: data.data.authorization_url, reference: data.data.reference };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new InternalServerErrorException('An unexpected error occurred during Paystack initialization');
    }
  }

  async verifySmsPurchase(dto: VerifySmsPurchaseDto) {
    this.logger.log(`Starting SMS purchase verification for reference: ${dto.reference}, appId: ${dto.appId}, orgId: ${dto.organizationId}`);
    const { organizationId, organizationName, userId, reference, amountGhs, creditsPurchased, appId, appName } = dto;
    const paystackSecret = this.configService.get<string>('PAYSTACK_SECRET_KEY');

    if (!paystackSecret) {
      this.logger.error('Paystack secret key is missing in environment variables');
      throw new InternalServerErrorException('Paystack secret key is missing');
    }

    // Initialize app-specific supabase client
    const supabase = this.appsService.getSupabaseClient(appId);

    try {
      // 1. Verify the transaction with Paystack
      this.logger.log(`Verifying transaction with Paystack...`);
      const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
        headers: {
          Authorization: `Bearer ${paystackSecret}`,
        },
      });

      const verifyData = await verifyResponse.json();

      if (!verifyResponse.ok || !verifyData.status || verifyData.data.status !== 'success') {
        this.logger.error(`Paystack verification failed. Status: ${verifyData.status}, Data status: ${verifyData.data?.status}`);
        throw new BadRequestException('Payment verification failed');
      }

      this.logger.log(`Paystack verification successful.`);

      // Check if amount matches (Paystack returns amount in pesewas)
      const paystackAmountGhs = verifyData.data.amount / 100;
      if (paystackAmountGhs !== amountGhs) {
        this.logger.error(`Payment amount mismatch. Expected: ${amountGhs}, Actual: ${paystackAmountGhs}`);
        throw new BadRequestException('Payment amount mismatch');
      }

      // 2. Check if we already processed this reference
      const { data: existingRecord, error: checkExistingError } = await supabase
        .from('payment_records')
        .select('id')
        .eq('gateway_reference', reference)
        .maybeSingle();

      if (checkExistingError) {
        this.logger.error(`Error checking existing payment record: ${checkExistingError.message}`, checkExistingError);
      }

      if (existingRecord) {
        this.logger.log(`Payment already processed. Existing record ID: ${existingRecord.id}`);
        return { success: true, message: 'Payment already processed' };
      }

      // 3. Create the payment record
      this.logger.log(`Inserting new payment record...`);
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

      // 4. Update the organization's SMS balance
      this.logger.log(`Retrieving current SMS balance for orgId: ${organizationId}`);
      const { data: currentBalance, error: getBalanceError } = await supabase
        .from('organization_sms_balances')
        .select('credit_balance')
        .eq('organization_id', organizationId)
        .single();

      if (getBalanceError && getBalanceError.code !== 'PGRST116') { // PGRST116 is "No rows found"
        this.logger.error(`Failed to retrieve current SMS balance: ${getBalanceError.message}`, getBalanceError);
      }

      const newBalance = (currentBalance?.credit_balance || 0) + creditsPurchased;
      this.logger.log(`Updating SMS balance to: ${newBalance}`);

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

      // 5. Create the transaction ledger entry
      this.logger.log(`Inserting sms_credit_transactions ledger entry...`);
      const { error: txError } = await supabase
        .from('sms_credit_transactions')
        .insert({
          organization_id: organizationId,
          type: 'purchase',
          amount: creditsPurchased,
          description: `Purchased ${creditsPurchased} credits via Paystack`,
          metadata: { reference, amountGhs },
        });

      if (txError) {
        this.logger.error(`Failed to insert transaction ledger entry: ${txError.message}`, txError);
      }

      // 6. Send Email Notification to Admins
      try {
        const adminEmailsString = this.configService.get<string>('ADMIN_EMAILS');
        if (adminEmailsString) {
          const adminEmails = adminEmailsString.split(',').map(e => e.trim()).filter(e => e.length > 0);
          if (adminEmails.length > 0) {
            const orgName = organizationName || organizationId;
            const subject = `[FMT Software Solutions] New SMS Credit Purchase: ${orgName}`;

            const htmlContent = `
              <h2>New SMS Credit Purchase</h2>
              <p>Organization <strong>${orgName}</strong> has purchased SMS credits.</p>
              <ul>
                <li><strong>App:</strong> ${appName || appId}</li>
                <li><strong>Credits Purchased:</strong> ${creditsPurchased}</li>
                <li><strong>Amount Paid:</strong> GHS ${amountGhs}</li>
                <li><strong>Reference:</strong> ${reference}</li>
              </ul>
            `;

            await this.resendService.sendEmail({
              from: 'FMT Software Solutions <noreply@fmtsoftware.com>',
              to: adminEmails,
              subject,
              html: htmlContent,
            });
            this.logger.log(`Admin notification email sent for SMS purchase ${reference}`);
          }
        }
      } catch (emailError) {
        this.logger.error(`Failed to send SMS purchase notification email: ${emailError.message}`);
        // Do not throw error here to ensure the purchase flow completes successfully for the user
      }

      this.logger.log(`SMS purchase verification completed successfully.`);
      return { success: true, newBalance };
    } catch (error) {
      this.logger.error(`Error during SMS purchase verification: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new InternalServerErrorException('An unexpected error occurred during verification');
    }
  }
}
