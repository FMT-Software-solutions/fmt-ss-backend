import { Injectable, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { SanityService } from '../../common/sanity/sanity.service';
import { ResendService } from '../../common/resend/resend.service';
import { BillingDetailsDto, PurchaseItemDto } from './dto/purchase.dto';
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
    private readonly sanityService: SanityService,
    private readonly resendService: ResendService,
    private readonly configService: ConfigService,
  ) { }

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
            address: `${billingDetails.address.street}, ${billingDetails.address.city}, ${billingDetails.address.state}, ${billingDetails.address.country}`
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
          html: `
            <h1>${subject}</h1>
            <p>Hello ${billingDetails.organizationName},</p>
            <p>Your access to <strong>${appDetails.name}</strong> has been provisioned.</p>
            <p><strong>Login Email:</strong> ${userEmail}</p>
            <p><strong>Temporary Password:</strong> ${userPassword}</p>
            <p>Please log in and change your password immediately.</p>
          `,
        });

        results.push({ productId, success: true });

      } catch (error) {
        console.error(`Provisioning error for ${productId}:`, error);
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
      html: `
          <h1>Purchase Confirmation</h1>
          <p>Thank you for your purchase, ${organizationDetails.organizationName}!</p>
          <p><strong>Total:</strong> ${total}</p>
          <ul>
            ${items.map(item => `<li>${item.title || item.productId} (x${item.quantity}) - ${item.price}</li>`).join('')}
          </ul>
        `,
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

    if (isExistingOrg) {
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
        const updates: Record<string, any> = {};

        if (billingDetails.organizationName !== existingOrg.name) {
          updates.name = billingDetails.organizationName;
        }

        if (billingDetails.organizationEmail !== existingOrg.email) {
          updates.email = billingDetails.organizationEmail;
        }

        if (billingDetails.phoneNumber && billingDetails.phoneNumber !== existingOrg.phone) {
          updates.phone = billingDetails.phoneNumber;
        }

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
        throw new Error(orgCreateError.message);
      }

      organizationId = newOrg.id;
    }

    if (organizationId) {
      const { data: existingAddresses } = await adminSupabase
        .from('billing_addresses')
        .select('*')
        .eq('organization_id', organizationId);

      const addressExists = existingAddresses?.some(
        (addr: any) =>
          addr.street === billingDetails.address.street &&
          addr.city === billingDetails.address.city &&
          addr.state === billingDetails.address.state &&
          addr.country === billingDetails.address.country &&
          addr.postalCode === billingDetails.address.postalCode
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

  async processGeneralPurchase(payload: {
    organizationDetails: BillingDetailsDto;
    items: PurchaseItemDto[];
    total: number;
    payment_reference: string;
  }) {
    const { organizationDetails, items, total, payment_reference } = payload;
    const adminSupabase: any = this.supabaseService.getServiceRoleClient();

    const organizationId = await this.ensureOrganizationAndBillingAddress(organizationDetails, false);

    const purchase = await this.createPurchaseRecord({
      organizationId,
      clientReference: payment_reference,
      amount: total,
      status: 'completed',
      items,
      paymentProvider: 'manual',
      paymentMethod: 'manual',
    });

    const temporaryPassword = this.generateTemporalPassword();
    const { error: userError } = await adminSupabase.auth.admin.createUser({
      email: organizationDetails.organizationEmail,
      password: temporaryPassword,
      email_confirm: true,
    });

    if (userError) {
      if (!userError.message.includes('already registered')) {
        throw new BadRequestException(`Error creating user account: ${userError.message}`);
      }
    }

    try {
      await this.sendPurchaseConfirmationEmail(
        {
          organizationName: organizationDetails.organizationName,
          organizationEmail: organizationDetails.organizationEmail
        },
        items,
        total
      );
    } catch (emailError) {
      console.error('Error sending confirmation email:', emailError);
    }

    return {
      id: purchase.id,
      organization_id: organizationId,
      productId: items[0]?.productId,
      purchaseDate: new Date().toISOString(),
      amount: total,
      status: 'completed',
      temporaryPassword,
      organizationDetails,
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
}
