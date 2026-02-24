import { Injectable, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { IssuesService } from '../issues/issues.service';
import { SanityService } from '../../common/sanity/sanity.service';
import { ResendService } from '../../common/resend/resend.service';
import { BillingDetailsDto, PurchaseItemDto, TrialRequestDto, FreeAccessRequestDto, GeneralPurchaseDto } from './dto/purchase.dto';
import { Database } from '../../common/supabase/database.types';

type OrganizationInsert = Database['public']['Tables']['organizations']['Insert'];
type PurchaseInsert = Database['public']['Tables']['purchases']['Insert'];

export interface ProvisioningAppDetail {
  _id: string;
  title: string;
  platforms?: Record<string, any>;
  appProvisioning?: Record<string, any>;
}

@Injectable()
export class PurchasesService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly sanityService: SanityService,
    private readonly resendService: ResendService,
    private readonly issuesService: IssuesService,
  ) { }

  private generateEmailTemplate(title: string, content: string) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f9fafb; }
          .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); margin-top: 40px; margin-bottom: 40px; }
          .header { background-color: #0f172a; color: #ffffff; padding: 30px; text-align: center; }
          .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
          .content { padding: 40px 30px; }
          .footer { background-color: #f1f5f9; padding: 20px; text-align: center; font-size: 12px; color: #64748b; }
          .button { display: inline-block; background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; margin-top: 20px; }
          .info-box { background-color: #eff6ff; border: 1px solid #dbeafe; border-radius: 6px; padding: 15px; margin: 20px 0; }
          .info-label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
          .info-value { font-size: 16px; font-weight: 500; color: #1e293b; font-family: monospace; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${title}</h1>
          </div>
          <div class="content">
            ${content}
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} FMT Software Solutions. All rights reserved.</p>
            <p>Accra, Ghana</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private generateTemporalPassword() {
    const length = 8;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let password = '';
    password += charset.substring(52, 62).charAt(Math.floor(Math.random() * 10)); // Add a number
    password += charset.substring(0, 52).charAt(Math.floor(Math.random() * 52)); // Add a letter
    for (let i = 2; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * charset.length);
      password += charset[randomIndex];
    }
    return password.split('').sort(() => Math.random() - 0.5).join('');
  }

  async provisionApps(
    organizationId: string,
    billingDetails: BillingDetailsDto,
    appProvisioningDetails: Record<string, any>,
    mode: 'buy' | 'trial' | 'free' = 'buy'
  ) {

    const results = [];
    const provisioningSecret = this.configService.get<string>('PROVISIONING_SECRET');

    for (const [productId, appDetails] of Object.entries(appProvisioningDetails)) {
      try {
        if (!appDetails.supabaseUrl || !appDetails.edgeFunctionName || !appDetails.supabaseAnonKey) {
          console.warn(`Missing provisioning config for app ${productId}`);
          results.push({ productId, success: false, error: 'Missing provisioning configuration' });
          continue;
        }

        const userPassword = this.generateTemporalPassword();
        const userEmail = appDetails.useSameEmailAsAdmin || (!appDetails.useSameEmailAsAdmin && !appDetails.userEmail)
          ? billingDetails.organizationEmail
          : appDetails.userEmail;

        const provisioningData = {
          organizationDetails: {
            id: organizationId,
            name: billingDetails.organizationName,
            email: billingDetails.organizationEmail,
            phone: billingDetails.phoneNumber,
            address: billingDetails.address
              ? `${billingDetails.address.street || ''}, ${billingDetails.address.city || ''}, ${billingDetails.address.state || ''}, ${billingDetails.address.country || ''}`
              : ''
          },
          userDetails: {
            firstName: 'Admin',
            lastName: 'User',
            email: userEmail,
            password: userPassword,
          },
          productId,
          appName: appDetails.name,
          provisioningSecret,
        };

        // Call Edge Function
        const response = await fetch(`${appDetails.supabaseUrl}/functions/v1/${appDetails.edgeFunctionName}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${appDetails.supabaseAnonKey}`,
            'apikey': appDetails.supabaseAnonKey
          },
          body: JSON.stringify(provisioningData)
        });

        if (!response.ok) {
          const text = await response.text();
          console.error(`Edge function failed for ${productId}: ${response.status} ${text}`);
          await this.logPurchaseIssue({
            title: `Provisioning Edge Function Failed: ${appDetails.name}`,
            description: `Edge function returned status ${response.status}`,
            errorMessage: text,
            organizationId,
            severity: 'high',
            metadata: {
              productId,
              edgeFunction: appDetails.edgeFunctionName,
              statusCode: response.status
            }
          });
          results.push({ productId, success: false, error: `Edge function failed: ${response.status}` });
          continue;
        }

        // Send Email
        const subject = mode === 'trial'
          ? `${appDetails.name} - Free Trial Started`
          : mode === 'free'
            ? `${appDetails.name} - App Access Granted`
            : `${appDetails.name} - Purchase Complete`;

        await this.resendService.sendEmail({
          from: 'FMT Software Solutions <provisioning@fmtsoftware.com>',
          to: billingDetails.organizationEmail,
          subject,
          html: this.generateEmailTemplate(subject, `
            <p>Hello <strong>${billingDetails.organizationName}</strong>,</p>
            <p>Your access to <strong>${appDetails.name}</strong> has been provisioned successfully.</p>
            
            <div class="info-box">
              <div class="info-label">Login Email</div>
              <div class="info-value">${userEmail}</div>
            </div>
            
            <div class="info-box">
              <div class="info-label">Temporary Password</div>
              <div class="info-value">${userPassword}</div>
            </div>
            
            <p>Please log in and change your password immediately to secure your account.</p>
            
            <a href="https://fmtsoftware.com/login" class="button">Log In Now</a>
          `),
        });

        results.push({ productId, success: true });

      } catch (error) {
        console.error(`Provisioning error for ${productId}:`, error);
        await this.logPurchaseIssue({
          title: `Provisioning Error: ${appDetails.name}`,
          description: `Exception during provisioning for ${appDetails.name}`,
          errorMessage: error.message,
          stackTrace: error.stack,
          organizationId,
          severity: 'high',
          metadata: { productId }
        });
        results.push({ productId, success: false, error: error.message });
      }
    }
    return results;
  }

  async sendPurchaseConfirmationEmail(
    organizationDetails: { organizationName: string; organizationEmail: string },
    items: any[],
    total: number
  ) {
    await this.resendService.sendEmail({
      from: 'FMT Software Solutions <purchase@fmtsoftware.com>',
      to: organizationDetails.organizationEmail,
      subject: 'Purchase Confirmation - FMT Software Solutions',
      html: this.generateEmailTemplate('Purchase Confirmation', `
          <p>Thank you for your purchase, <strong>${organizationDetails.organizationName}</strong>!</p>
          <p>We have received your payment and your order is being processed.</p>
          
          <div class="info-box">
            <div class="info-label">Total Amount</div>
            <div class="info-value">GHS ${total.toFixed(2)}</div>
          </div>
          
          <h3>Order Details</h3>
          <ul style="list-style: none; padding: 0;">
            ${items.map(item => `
              <li style="border-bottom: 1px solid #e2e8f0; padding: 10px 0;">
                <span style="font-weight: 500;">${item.title || item.productId}</span> 
                <span style="color: #64748b; float: right;">x${item.quantity} - GHS ${(item.price || 0).toFixed(2)}</span>
              </li>
            `).join('')}
          </ul>
          
          <p style="margin-top: 20px;">If you have any questions, please reply to this email.</p>
      `),
    });
  }

  buildPurchaseItems(items: PurchaseItemDto[]) {
    return items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      price: item.price ?? 0,
      appId: item.productId, // Fallback if no specific logic needed
    }));
  }

  async ensureOrganizationAndBillingAddress(
    billingDetails: BillingDetailsDto,
    isExistingOrg: boolean,
  ): Promise<string> {
    const adminSupabase: any = this.supabaseService.getServiceRoleClient();

    let organizationId = '';

    // Always try to find the organization first by email
    const { data: existingOrg, error: orgLookupError } = await adminSupabase
      .from('organizations')
      .select('id, name, email, phone')
      .eq('email', billingDetails.organizationEmail)
      .maybeSingle();

    if (orgLookupError) {
      throw new Error(orgLookupError.message);
    }

    if (existingOrg?.id) {
      organizationId = existingOrg.id;

      if (isExistingOrg) {
        const updates: Record<string, any> = {};
        if (billingDetails.organizationName !== existingOrg.name) updates.name = billingDetails.organizationName;
        if (billingDetails.phoneNumber && billingDetails.phoneNumber !== existingOrg.phone) updates.phone = billingDetails.phoneNumber;

        if (Object.keys(updates).length > 0) {
          await adminSupabase.from('organizations').update(updates).eq('id', organizationId);
        }
      }
    }

    if (!organizationId) {
      const insertData: OrganizationInsert = {
        name: billingDetails.organizationName,
        email: billingDetails.organizationEmail,
        phone: billingDetails.phoneNumber,
        status: 'active',
      };

      const { data: newOrg, error: orgCreateError } = await adminSupabase
        .from('organizations')
        .insert(insertData)
        .select()
        .single();

      if (orgCreateError) {
        if (orgCreateError.message.includes('unique constraint') || orgCreateError.code === '23505') {
          // Fallback: If race condition occurred and it was created just now by someone else
          const { data: retryOrg } = await adminSupabase
            .from('organizations')
            .select('id')
            .eq('email', billingDetails.organizationEmail)
            .maybeSingle();

          if (retryOrg?.id) {
            organizationId = retryOrg.id;
          } else {
            throw new BadRequestException(`An account with the email ${billingDetails.organizationEmail} already exists. Please sign in or use a different email.`);
          }
        } else {
          throw new Error(orgCreateError.message);
        }
      } else {
        organizationId = newOrg.id;
      }
    }

    if (organizationId && billingDetails.address && billingDetails.address.street && billingDetails.address.city && billingDetails.address.state && billingDetails.address.country) {
      const { data: existingAddresses } = await adminSupabase
        .from('billing_addresses')
        .select('*')
        .eq('organization_id', organizationId);

      const addressExists = existingAddresses?.some(
        (addr: any) =>
          addr.street === billingDetails.address?.street &&
          addr.city === billingDetails.address?.city &&
          addr.state === billingDetails.address?.state &&
          addr.country === billingDetails.address?.country &&
          addr.postalCode === billingDetails.address?.postalCode
      );

      if (!addressExists) {
        await adminSupabase.from('billing_addresses').insert({
          organization_id: organizationId,
          street: billingDetails.address.street,
          city: billingDetails.address.city,
          state: billingDetails.address.state,
          country: billingDetails.address.country,
          postalCode: billingDetails.address.postalCode,
          isDefault: !existingAddresses || existingAddresses.length === 0,
        });
      }
    }

    return organizationId;
  }

  async createPurchaseRecord(params: {
    organizationId: string;
    clientReference: string;
    amount: number;
    status: string;
    items: PurchaseItemDto[];
    paymentProvider?: string;
    paymentMethod?: string;
    externalTransactionId?: string;
    paymentDetails?: Record<string, any>;
  }) {
    const adminSupabase: any = this.supabaseService.getServiceRoleClient();

    const insertData: PurchaseInsert = {
      organization_id: params.organizationId,
      client_reference: params.clientReference,
      amount: params.amount,
      status: params.status,
      items: this.buildPurchaseItems(params.items),
      payment_provider: params.paymentProvider || 'manual',
      payment_method: params.paymentMethod || 'manual',
      external_transaction_id: params.externalTransactionId,
      payment_details: params.paymentDetails,
      payment_reference: params.clientReference,
    };

    const { data: createdPurchase, error: purchaseError } = await adminSupabase
      .from('purchases')
      .insert(insertData)
      .select('id, status, organization_id, items, amount')
      .single();

    if (purchaseError) {
      throw new Error(purchaseError.message);
    }

    return createdPurchase;
  }

  async fetchProvisioningAppsByIds(productIds: string[]) {
    if (productIds.length === 0) {
      return [];
    }

    const query = `*[_type == "premiumApp" && _id in $ids && isPublished == true] {
      _id,
      title,
      platforms {
        desktop {
          windows {
            available,
            downloadUrl
          },
          macos {
            available,
            downloadUrl
          },
          linux {
            available,
            downloadUrl
          }
        },
        mobile {
          android {
            available,
            playStoreUrl,
            apkUrl
          },
          ios {
            available,
            appStoreUrl
          }
        },
        web {
          available,
          webAppUrl
        }
      },
      appProvisioning {
        supabaseUrl,
        supabaseAnonKey,
        edgeFunctionName
      }
    }`;

    return this.sanityService.fetch<ProvisioningAppDetail[]>(query, { ids: productIds });
  }

  async fetchAllPremiumApps() {
    const query = `*[_type == "premiumApp" && isPublished == true] {
      _id,
      title,
      price
    }`;
    return this.sanityService.fetch<Array<{ _id: string; title: string; price?: number }>>(query);
  }

  buildProvisioningDrafts(
    apps: ProvisioningAppDetail[],
    billingDetails: BillingDetailsDto
  ) {
    return apps.reduce((acc: Record<string, any>, app) => {
      acc[app._id] = {
        productId: app._id,
        name: app.title,
        useSameEmailAsAdmin: true,
        userEmail: billingDetails.organizationEmail,
      };
      return acc;
    }, {});
  }

  async processTrialRequest(payload: TrialRequestDto) {
    const { organizationDetails, productId } = payload;

    // 1. Get App details (to check title/price/provisioning)
    const apps = await this.fetchProvisioningAppsByIds([productId]);
    if (!apps || apps.length === 0) {
      throw new BadRequestException('Product not found');
    }
    const app = apps[0];

    // 2. Ensure Organization exists
    const organizationId = await this.ensureOrganizationAndBillingAddress(organizationDetails, false);

    // Check if organization already has access to this app
    const accessCheckSupabase: any = this.supabaseService.getServiceRoleClient();
    const { data: existingAccess } = await accessCheckSupabase
      .from('organization_apps')
      .select('status')
      .eq('organization_id', organizationId)
      .eq('app_id', productId)
      .maybeSingle();

    if (existingAccess && (existingAccess.status === 'active' || existingAccess.status === 'trial')) {
      throw new BadRequestException('You already have access (or a trial) for this application.');
    }

    // 3. Provision App (Trial Mode)
    // We need to construct appProvisioningDetails in the format provisionApps expects
    const appProvisioningDetails = {
      [productId]: {
        productId,
        name: app.title,
        useSameEmailAsAdmin: true,
        userEmail: organizationDetails.organizationEmail,
        supabaseUrl: app.appProvisioning?.supabaseUrl,
        supabaseAnonKey: app.appProvisioning?.supabaseAnonKey,
        edgeFunctionName: app.appProvisioning?.edgeFunctionName,
      }
    };

    // If app doesn't have provisioning config, we can't provision, but maybe we just record the trial?
    // Assuming all "Premium Apps" have provisioning config if they need it.
    if (app.appProvisioning) {
      await this.provisionApps(organizationId, organizationDetails, appProvisioningDetails, 'trial');
    }

    // Record app access in organization_apps table
    const adminSupabase: any = this.supabaseService.getServiceRoleClient();
    const { error: accessError } = await adminSupabase
      .from('organization_apps')
      .upsert({
        organization_id: organizationId,
        app_id: productId,
        status: 'trial',
        plan_type: 'trial',
        access_granted_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'organization_id, app_id' });

    if (accessError) {
      console.error(`Failed to record trial access for org ${organizationId} app ${productId}:`, accessError);
      await this.logPurchaseIssue({
        title: 'Failed to record trial app access',
        description: `Failed to insert organization_apps record for trial`,
        errorMessage: accessError.message,
        organizationId,
        severity: 'medium',
        metadata: { productId }
      });
      // We might not want to fail the whole request if provisioning succeeded, but it's important data.
    }

    return {
      success: true,
      message: 'Trial started successfully',
      organizationId,
      // purchaseId: purchase.id // No purchase ID anymore
    };
  }

  async processFreeAccessRequest(payload: FreeAccessRequestDto) {
    const { organizationDetails, productId } = payload;

    // 1. Get App details (to check title/price/provisioning)
    const apps = await this.fetchProvisioningAppsByIds([productId]);
    if (!apps || apps.length === 0) {
      throw new BadRequestException('Product not found');
    }
    const app = apps[0];

    // 2. Ensure Organization exists (reuses existing if email matches)
    const organizationId = await this.ensureOrganizationAndBillingAddress(organizationDetails, false);

    // Check if organization already has access to this app
    const adminSupabase: any = this.supabaseService.getServiceRoleClient();
    const { data: existingAccess } = await adminSupabase
      .from('organization_apps')
      .select('status')
      .eq('organization_id', organizationId)
      .eq('app_id', productId)
      .maybeSingle();

    if (existingAccess && existingAccess.status === 'active') {
      throw new BadRequestException('You already have access to this application.');
    }

    // 3. Provision App (Free Mode)
    const appProvisioningDetails = {
      [productId]: {
        productId,
        name: app.title,
        useSameEmailAsAdmin: true,
        userEmail: organizationDetails.organizationEmail,
        supabaseUrl: app.appProvisioning?.supabaseUrl,
        supabaseAnonKey: app.appProvisioning?.supabaseAnonKey,
        edgeFunctionName: app.appProvisioning?.edgeFunctionName,
      }
    };

    if (app.appProvisioning) {
      await this.provisionApps(organizationId, organizationDetails, appProvisioningDetails, 'free');
    }

    // Record app access
    const { error: accessError } = await adminSupabase
      .from('organization_apps')
      .upsert({
        organization_id: organizationId,
        app_id: productId,
        status: 'active',
        plan_type: 'free',
        access_granted_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'organization_id, app_id' });

    if (accessError) {
      console.error(`Failed to record free access for org ${organizationId} app ${productId}:`, accessError);
      await this.logPurchaseIssue({
        title: 'Failed to record free app access',
        description: `Failed to insert organization_apps record for free access`,
        errorMessage: accessError.message,
        organizationId,
        severity: 'medium',
        metadata: { productId }
      });
    }

    return {
      success: true,
      message: 'Free access granted successfully',
      organizationId,
    };
  }

  async logPurchaseIssue(params: {
    title: string;
    description: string;
    errorMessage?: string;
    stackTrace?: string;
    organizationId?: string;
    purchaseId?: string;
    severity?: 'low' | 'medium' | 'high' | 'critical';
    metadata?: any;
    component?: string;
  }) {
    return this.issuesService.logIssue({
      issue_type: 'error',
      severity: params.severity || 'high',
      category: 'purchase',
      title: params.title,
      description: params.description,
      error_message: params.errorMessage,
      stack_trace: params.stackTrace,
      organization_id: params.organizationId,
      purchase_id: params.purchaseId,
      component: params.component || 'PurchasesService',
      metadata: params.metadata,
      user_action: 'purchase_process',
    });
  }

  async processGeneralPurchase(payload: GeneralPurchaseDto) {
    const { organizationDetails, items, total, payment_reference, status, paymentProvider, paymentMethod, paymentDetails } = payload;
    const adminSupabase: any = this.supabaseService.getServiceRoleClient();

    const organizationId = await this.ensureOrganizationAndBillingAddress(organizationDetails, false);

    const purchase = await this.createPurchaseRecord({
      organizationId,
      clientReference: payment_reference,
      amount: total,
      status: status || 'completed',
      items,
      paymentProvider: paymentProvider || 'manual',
      paymentMethod: paymentMethod || 'manual',
      paymentDetails: paymentDetails,
    });

    // Record app access in organization_apps table for each purchased item
    if (items && items.length > 0) {
      const organizationAppsData = items.map(item => ({
        organization_id: organizationId,
        app_id: item.productId,
        status: 'active',
        plan_type: 'paid',
        access_granted_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      const { error: accessError } = await adminSupabase
        .from('organization_apps')
        .upsert(organizationAppsData, { onConflict: 'organization_id, app_id' });

      if (accessError) {
        console.error(`Failed to record paid access for org ${organizationId}:`, accessError);
        await this.logPurchaseIssue({
          title: 'Failed to record paid app access',
          description: `Failed to insert organization_apps records for purchase ${purchase.id}`,
          errorMessage: accessError.message,
          organizationId,
          purchaseId: purchase.id,
          severity: 'critical',
          metadata: { items: items.map(i => i.productId) }
        });
      }
    }

    const temporaryPassword = this.generateTemporalPassword();
    const { error: userError } = await adminSupabase.auth.admin.createUser({
      email: organizationDetails.organizationEmail,
      password: temporaryPassword,
      email_confirm: true,
    });

    if (userError) {
      // If user exists, that's fine, we just skip creation.
      // But if it's another error, we should log it.
      if (!userError.message.includes('already registered')) {
        console.error('Failed to create user account:', userError);
        await this.logPurchaseIssue({
          title: 'Failed to create user account',
          description: `Failed to create auth user for ${organizationDetails.organizationEmail}`,
          errorMessage: userError.message,
          organizationId,
          purchaseId: purchase.id,
          severity: 'high',
        });
      }
    }

    // Provision apps
    // 1. Get provisioning config for all purchased apps
    const productIds = items?.map(i => i.productId) || [];
    const apps = await this.fetchProvisioningAppsByIds(productIds);

    // 2. Construct provisioning details
    const appProvisioningDetails: Record<string, any> = {};
    apps.forEach(app => {
      if (app.appProvisioning) {
        appProvisioningDetails[app._id] = {
          productId: app._id,
          name: app.title,
          useSameEmailAsAdmin: true,
          userEmail: organizationDetails.organizationEmail,
          supabaseUrl: app.appProvisioning.supabaseUrl,
          supabaseAnonKey: app.appProvisioning.supabaseAnonKey,
          edgeFunctionName: app.appProvisioning.edgeFunctionName,
        };
      }
    });

    // 3. Call provisionApps if there are apps to provision
    if (Object.keys(appProvisioningDetails).length > 0) {
      await this.provisionApps(organizationId, organizationDetails, appProvisioningDetails, 'buy');
    }

    // Send confirmation email
    try {
      await this.sendPurchaseConfirmationEmail(
        {
          organizationName: organizationDetails.organizationName,
          organizationEmail: organizationDetails.organizationEmail
        },
        items || [],
        total
      );
    } catch (emailError) {
      console.error('Failed to send confirmation email:', emailError);
      await this.logPurchaseIssue({
        title: 'Failed to send confirmation email',
        description: `Failed to send purchase confirmation email to ${organizationDetails.organizationEmail}`,
        errorMessage: emailError.message,
        stackTrace: emailError.stack,
        organizationId,
        purchaseId: purchase.id,
        severity: 'medium',
      });
    }

    return {
      success: true,
      message: 'Purchase processed successfully',
      purchaseId: purchase.id,
      organizationId,
    };
  }

  async processAppProvisioning(payload: {
    organizationId: string;
    billingDetails: BillingDetailsDto;
    appProvisioningDetails: Record<string, any>;
    mode?: 'buy' | 'trial' | 'free';
  }) {
    const { organizationId, billingDetails, appProvisioningDetails, mode } = payload;

    if (!organizationId || !billingDetails || !appProvisioningDetails) {
      throw new BadRequestException('Missing required fields');
    }

    const results = await this.provisionApps(organizationId, billingDetails, appProvisioningDetails, mode);

    const emailConfirmationDetails = results.map(result => ({
      appId: result.productId,
      appName: appProvisioningDetails[result.productId]?.name || 'Unknown App',
      emailSent: result.success,
      emailSentAt: result.success ? new Date().toISOString() : undefined,
      emailError: result.error
    }));

    const adminSupabase: any = this.supabaseService.getServiceRoleClient();

    await adminSupabase
      .from('purchases')
      .update({
        confirmation_email_details: emailConfirmationDetails,
        updated_at: new Date().toISOString()
      })
      .eq('organization_id', organizationId);

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    return {
      success: failed.length === 0,
      results: successful,
      errors: failed,
      summary: {
        total: results.length,
        successful: successful.length,
        failed: failed.length
      }
    };
  }

  async checkAppAccess(email: string, productId: string) {
    if (!email || !productId) {
      throw new BadRequestException('Email and Product ID are required');
    }

    const adminSupabase: any = this.supabaseService.getServiceRoleClient();

    // 1. Find organization by email
    const { data: organization, error: orgError } = await adminSupabase
      .from('organizations')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (orgError) {
      throw new InternalServerErrorException(`Error finding organization: ${orgError.message}`);
    }

    if (!organization) {
      return { hasAccess: false };
    }

    // 2. Check organization_apps table
    const { data: access, error: accessError } = await adminSupabase
      .from('organization_apps')
      .select('id, status')
      .eq('organization_id', organization.id)
      .eq('app_id', productId)
      .maybeSingle();

    if (accessError) {
      throw new InternalServerErrorException(`Error checking access: ${accessError.message}`);
    }

    const hasAccess = !!access && (access.status === 'active' || access.status === 'trial');
    return { hasAccess };
  }
}
