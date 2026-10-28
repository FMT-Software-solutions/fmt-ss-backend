import { Injectable, Logger } from '@nestjs/common';
import { AppsService } from '../apps/apps.service';
import { SanityService } from '../../common/sanity/sanity.service';
import { SupabaseService } from '../../common/supabase/supabase.service';

/**
 * Locks and unlocks an instalment customer's app.
 *
 * The apps already lock an organization that hasn't purchased once its trial
 * date has passed, so suspension sets has_purchased = false with a trial end
 * date of now, and reinstating sets has_purchased back. That works on every
 * installed version today, with no app release.
 *
 * Plans store the Sanity product id; the app's database is found by matching
 * the product's provisioning URL against the backend's app registry.
 */
@Injectable()
export class PlanAccessService {
  private readonly logger = new Logger(PlanAccessService.name);

  constructor(
    private readonly apps: AppsService,
    private readonly sanity: SanityService,
    private readonly supabase: SupabaseService,
  ) { }

  private async appClientFor(productId: string) {
    const product = await this.sanity.fetch<{ appProvisioning?: { supabaseUrl?: string } } | null>(
      `*[_type == "premiumApp" && _id == $id][0]{ appProvisioning }`,
      { id: productId },
    );
    const client = this.apps.getClientForProjectUrl(product?.appProvisioning?.supabaseUrl);
    if (!client) {
      throw new Error('This app is not connected to the admin backend, so access must be changed in the app');
    }
    return client;
  }

  private async setAppAccess(productId: string, organizationId: string, purchased: boolean) {
    const client = await this.appClientFor(productId);
    const { error } = await client
      .from('organizations')
      .update({
        has_purchased: purchased,
        trial_end_date: purchased ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', organizationId);
    if (error) throw new Error(`Could not update the app: ${error.message}`);

    await this.supabase
      .getServiceRoleClient()
      .from('organization_apps')
      .update({ status: purchased ? 'active' : 'suspended', updated_at: new Date().toISOString() })
      .eq('organization_id', organizationId)
      .eq('app_id', productId);
  }

  suspend(productId: string, organizationId: string) {
    return this.setAppAccess(productId, organizationId, false);
  }

  reinstate(productId: string, organizationId: string) {
    return this.setAppAccess(productId, organizationId, true);
  }
}
