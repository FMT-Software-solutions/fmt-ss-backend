import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { buildSearchFilter, paginated, toRange } from '../../common/utils/paginate';
import { discountFor, DiscountRejected, normalizeCode, type DiscountCodeRow, type PricedLine } from './discount-math';
import type { DiscountCodeInputDto } from './dto/discount-code.dto';

export interface AppliedDiscount {
  codeId: string;
  code: string;
  amount: number;
  description: string | null;
}

/**
 * Discount codes for website orders. The browser only sends the code; the
 * amount is worked out here from the server-priced order, and limits are
 * counted from redemptions written when an order is paid.
 */
@Injectable()
export class DiscountsService {
  private readonly logger = new Logger(DiscountsService.name);

  constructor(private readonly supabaseService: SupabaseService) { }

  private get db(): any {
    return this.supabaseService.getServiceRoleClient();
  }

  /** Validates `code` for this order and buyer; throws a 400 with the reason. */
  async apply(code: string, lines: PricedLine[], email: string | undefined): Promise<AppliedDiscount> {
    const row = await this.findByCode(code);
    if (!row) throw new BadRequestException('That discount code is not valid');

    let amount: number;
    try {
      amount = discountFor(row, lines);
    } catch (error) {
      if (error instanceof DiscountRejected) throw new BadRequestException(error.message);
      throw error;
    }

    if (row.max_uses != null) {
      const { count } = await this.db
        .from('discount_redemptions')
        .select('id', { count: 'exact', head: true })
        .eq('discount_code_id', row.id);
      if ((count ?? 0) >= row.max_uses) throw new BadRequestException('This code has been fully used');
    }

    if (email) {
      const normalized = email.trim().toLowerCase();
      const { count } = await this.db
        .from('discount_redemptions')
        .select('id', { count: 'exact', head: true })
        .eq('discount_code_id', row.id)
        .eq('email', normalized);
      if ((count ?? 0) >= row.per_customer_limit) throw new BadRequestException("You've already used this code");

      if (row.first_purchase_only) {
        const { data: org } = await this.db.from('organizations').select('id').eq('email', normalized).maybeSingle();
        if (org) {
          const { count: paid } = await this.db
            .from('purchases')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', org.id)
            .eq('status', 'completed');
          if ((paid ?? 0) > 0) throw new BadRequestException('This code is for first purchases only');
        }
      }
    }

    return { codeId: row.id, code: row.code, amount, description: row.description };
  }

  /** Records a use once the order is paid. Idempotent per purchase. */
  async recordRedemption(params: { codeId: string; purchaseId: string; organizationId: string; email: string; amount: number }) {
    const { error } = await this.db.from('discount_redemptions').upsert(
      {
        discount_code_id: params.codeId,
        purchase_id: params.purchaseId,
        organization_id: params.organizationId,
        email: params.email.trim().toLowerCase(),
        amount: params.amount,
      },
      { onConflict: 'purchase_id', ignoreDuplicates: true },
    );
    if (error) this.logger.error(`Could not record discount redemption for ${params.purchaseId}: ${error.message}`);
  }

  private async findByCode(code: string): Promise<DiscountCodeRow | null> {
    const normalized = normalizeCode(code);
    if (!/^[A-Z0-9_-]{2,40}$/.test(normalized)) return null;
    const { data, error } = await this.db.from('discount_codes').select('*').eq('code', normalized).maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    return data as DiscountCodeRow | null;
  }

  // ---------------------------------------------------------------- admin

  async list(params: { page?: number; limit?: number; search?: string; status?: string }) {
    const page = Number(params.page) || 1;
    const limit = Math.min(Number(params.limit) || 25, 100);
    const [from, to] = toRange(page, limit);
    let query = this.db.from('discount_codes').select('*, discount_redemptions(amount)', { count: 'exact' });
    if (params.search) query = query.or(buildSearchFilter(params.search, ['code', 'description']));
    if (params.status === 'active') query = query.eq('is_active', true);
    if (params.status === 'inactive') query = query.eq('is_active', false);
    const { data, count, error } = await query.order('created_at', { ascending: false }).range(from, to);
    if (error) throw new InternalServerErrorException(error.message);
    const rows = (data ?? []).map(({ discount_redemptions, ...row }: any) => ({
      ...row,
      uses: discount_redemptions?.length ?? 0,
      total_discounted: Math.round((discount_redemptions ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0) * 100) / 100,
    }));
    return paginated(rows, count, page, limit);
  }

  async create(dto: DiscountCodeInputDto, actor?: User) {
    const { data, error } = await this.db
      .from('discount_codes')
      .insert({ ...this.toRow(dto), created_by: actor?.email ?? null })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') throw new BadRequestException('A code with that name already exists');
      throw new InternalServerErrorException(error.message);
    }
    return data;
  }

  async update(id: string, dto: Partial<DiscountCodeInputDto>) {
    const { data, error } = await this.db
      .from('discount_codes')
      .update({ ...this.toRow(dto), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) {
      if (error.code === '23505') throw new BadRequestException('A code with that name already exists');
      throw new InternalServerErrorException(error.message);
    }
    if (!data) throw new NotFoundException('Discount code not found');
    return data;
  }

  private toRow(dto: Partial<DiscountCodeInputDto>) {
    const row: Record<string, unknown> = {};
    if (dto.code !== undefined) row.code = normalizeCode(dto.code);
    if (dto.description !== undefined) row.description = dto.description?.trim() || null;
    if (dto.valueType !== undefined) row.value_type = dto.valueType;
    if (dto.value !== undefined) row.value = dto.value;
    if (dto.appIds !== undefined) row.app_ids = dto.appIds;
    if (dto.minTotal !== undefined) row.min_total = dto.minTotal;
    if (dto.maxDiscount !== undefined) row.max_discount = dto.maxDiscount;
    if (dto.startsAt !== undefined) row.starts_at = dto.startsAt;
    if (dto.endsAt !== undefined) row.ends_at = dto.endsAt;
    if (dto.maxUses !== undefined) row.max_uses = dto.maxUses;
    if (dto.perCustomerLimit !== undefined) row.per_customer_limit = dto.perCustomerLimit;
    if (dto.firstPurchaseOnly !== undefined) row.first_purchase_only = dto.firstPurchaseOnly;
    if (dto.isActive !== undefined) row.is_active = dto.isActive;
    if (row.value_type === 'percent' && Number(row.value) > 100) throw new BadRequestException('A percentage can be at most 100');
    return row;
  }
}
