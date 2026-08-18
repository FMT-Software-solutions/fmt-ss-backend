import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import {
  buildSearchFilter,
  paginated,
  parseSort,
  toRange,
  type PaginatedResult,
} from '../../../common/utils/paginate';
import type {
  DateRangeQueryDto,
  MessagesQueryDto,
  PaginationQueryDto,
  PurchasesQueryDto,
  ReviewsQueryDto,
  StatusFilterQueryDto,
} from '../dto/pagination.dto';

// These tables are read with the service-role client: RLS on the main project
// is written for the public site (anon inserts), not for admin reads.
@Injectable()
export class AdminSiteService {
  constructor(private readonly supabaseService: SupabaseService) { }

  private get db() {
    return this.supabaseService.getServiceRoleClient();
  }

  private fail(context: string, error: { message?: string } | null): never {
    throw new InternalServerErrorException(
      `Failed to load ${context}${error?.message ? `: ${error.message}` : ''}`,
    );
  }

  private applyDateRange<T>(query: T, from?: string, to?: string): T {
    let next = query as any;
    if (from) next = next.gte('created_at', from);
    if (to) next = next.lte('created_at', to);
    return next as T;
  }

  async listMessages(params: MessagesQueryDto): Promise<PaginatedResult<unknown>> {
    const { page = 1, limit = 25, search, sort, from, to, state } = params;
    const order = parseSort(sort, ['created_at', 'name', 'email'], {
      column: 'created_at',
      ascending: false,
    });
    const [start, end] = toRange(page, limit);

    let query = this.db.from('messages').select('*', { count: 'exact' });
    query = this.applyDateRange(query, from, to);

    if (state === 'unread') query = query.is('read_at', null).is('archived_at', null);
    if (state === 'read') query = query.not('read_at', 'is', null).is('archived_at', null);
    if (state === 'archived') query = query.not('archived_at', 'is', null);

    if (search) query = query.or(buildSearchFilter(search, ['name', 'email', 'message']));

    const { data, error, count } = await query
      .order(order.column, { ascending: order.ascending })
      .range(start, end);

    if (error) this.fail('messages', error);
    return paginated(data, count, page, limit);
  }

  async updateMessage(id: string, patch: { read?: boolean; archived?: boolean }) {
    const update: Record<string, string | null> = {};
    if (patch.read !== undefined) update.read_at = patch.read ? new Date().toISOString() : null;
    if (patch.archived !== undefined) {
      update.archived_at = patch.archived ? new Date().toISOString() : null;
    }

    const { data, error } = await this.db
      .from('messages')
      .update(update)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) this.fail('message', error);
    if (!data) throw new NotFoundException('Message not found');
    return data;
  }

  async listQuotes(params: StatusFilterQueryDto): Promise<PaginatedResult<unknown>> {
    const { page = 1, limit = 25, search, sort, from, to, status } = params;
    const order = parseSort(sort, ['created_at', 'first_name', 'budget'], {
      column: 'created_at',
      ascending: false,
    });
    const [start, end] = toRange(page, limit);

    let query = this.db.from('quotes').select('*', { count: 'exact' });
    query = this.applyDateRange(query, from, to);
    if (status) query = query.eq('status', status);
    if (search) {
      query = query.or(
        buildSearchFilter(search, ['first_name', 'last_name', 'email', 'company', 'service_type']),
      );
    }

    const { data, error, count } = await query
      .order(order.column, { ascending: order.ascending })
      .range(start, end);

    if (error) this.fail('quotes', error);
    return paginated(data, count, page, limit);
  }

  async updateQuoteStatus(id: string, status: string) {
    const { data, error } = await this.db
      .from('quotes')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) this.fail('quote', error);
    if (!data) throw new NotFoundException('Quote not found');
    return data;
  }

  async listPurchases(params: PurchasesQueryDto): Promise<PaginatedResult<unknown>> {
    const { page = 1, limit = 25, search, sort, from, to, status, provider } = params;
    const order = parseSort(sort, ['created_at', 'amount', 'status'], {
      column: 'created_at',
      ascending: false,
    });
    const [start, end] = toRange(page, limit);

    let query = this.db
      .from('purchases')
      .select('*, organizations(id, name, email, phone)', { count: 'exact' });
    query = this.applyDateRange(query, from, to);
    if (status) query = query.eq('status', status);
    if (provider) query = query.eq('payment_provider', provider);
    if (search) {
      query = query.or(
        buildSearchFilter(search, [
          'payment_reference',
          'client_reference',
          'external_transaction_id',
        ]),
      );
    }

    const { data, error, count } = await query
      .order(order.column, { ascending: order.ascending })
      .range(start, end);

    if (error) this.fail('purchases', error);
    return paginated(data, count, page, limit);
  }

  async getPurchase(id: string) {
    const { data, error } = await this.db
      .from('purchases')
      .select('*, organizations(*, billing_addresses(*))')
      .eq('id', id)
      .maybeSingle();

    if (error) this.fail('purchase', error);
    if (!data) throw new NotFoundException('Purchase not found');
    return data;
  }

  async listReviews(params: ReviewsQueryDto): Promise<PaginatedResult<unknown>> {
    const { page = 1, limit = 25, search, sort, from, to, status, featured, type } = params;
    const order = parseSort(sort, ['created_at', 'rating', 'status'], {
      column: 'created_at',
      ascending: false,
    });
    const [start, end] = toRange(page, limit);

    let query = this.db.from('reviews').select('*', { count: 'exact' });
    query = this.applyDateRange(query, from, to);
    if (status) query = query.eq('status', status);
    if (type) query = query.eq('type', type);
    if (featured !== undefined) query = query.eq('is_featured', featured === 'true');
    if (search) {
      query = query.or(buildSearchFilter(search, ['name', 'email', 'company', 'content']));
    }

    const { data, error, count } = await query
      .order(order.column, { ascending: order.ascending })
      .range(start, end);

    if (error) this.fail('reviews', error);
    return paginated(data, count, page, limit);
  }

  async updateReview(id: string, patch: { status?: string; is_featured?: boolean }) {
    const { data, error } = await this.db
      .from('reviews')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) this.fail('review', error);
    if (!data) throw new NotFoundException('Review not found');
    return data;
  }

  async listSubscribers(params: PaginationQueryDto): Promise<PaginatedResult<unknown>> {
    const { page = 1, limit = 25, search, sort } = params;
    const order = parseSort(sort, ['created_at', 'email', 'subscribedAt'], {
      column: 'created_at',
      ascending: false,
    });
    const [start, end] = toRange(page, limit);

    let query = this.db
      .from('newsletter_subscribers')
      .select('id, email, subscribedAt, created_at', { count: 'exact' });
    if (search) query = query.ilike('email', `%${search.replace(/[,()*]/g, '')}%`);

    const { data, error, count } = await query
      .order(order.column, { ascending: order.ascending })
      .range(start, end);

    if (error) this.fail('subscribers', error);
    return paginated(data, count, page, limit);
  }

  async deleteSubscriber(id: string) {
    const { error } = await this.db.from('newsletter_subscribers').delete().eq('id', id);
    if (error) this.fail('subscriber', error);
    return { success: true };
  }

  /**
   * Standard and custom training registrations live in separate tables with
   * different shapes, so they are normalised into one list with a `kind`
   * discriminator. Paging is applied after the merge.
   */
  async listTrainingRegistrations(params: StatusFilterQueryDto): Promise<PaginatedResult<unknown>> {
    const { page = 1, limit = 25, search, status } = params;

    const [standard, custom] = await Promise.all([
      this.db.from('training_registrations').select('*'),
      this.db.from('custom_training_registrations').select('*'),
    ]);

    if (standard.error) this.fail('training registrations', standard.error);
    if (custom.error) this.fail('custom training registrations', custom.error);

    const normalise = (row: any, kind: 'standard' | 'custom') => ({
      id: row.id,
      kind,
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email,
      phone: row.phone,
      company: row.company ?? null,
      training_slug: row.training_slug,
      training_id: row.training_id,
      status: row.status,
      message: row.message ?? null,
      details: row.details ?? null,
      payment_method: row.payment_method ?? null,
      created_at: row.created_at,
    });

    let rows = [
      ...(standard.data ?? []).map((row) => normalise(row, 'standard')),
      ...(custom.data ?? []).map((row) => normalise(row, 'custom')),
    ];

    if (status) rows = rows.filter((row) => row.status === status);
    if (search) {
      const term = search.toLowerCase();
      rows = rows.filter((row) =>
        [row.first_name, row.last_name, row.email, row.company, row.training_slug]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term)),
      );
    }

    rows.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));

    const start = (page - 1) * limit;
    return paginated(rows.slice(start, start + limit), rows.length, page, limit);
  }

  async listIssues(params: StatusFilterQueryDto): Promise<PaginatedResult<unknown>> {
    const { page = 1, limit = 25, search, sort, from, to, status } = params;
    const order = parseSort(sort, ['created_at', 'severity', 'status'], {
      column: 'created_at',
      ascending: false,
    });
    const [start, end] = toRange(page, limit);

    let query = this.db.from('issues').select('*', { count: 'exact' });
    query = this.applyDateRange(query, from, to);
    if (status) query = query.eq('status', status);
    if (search) {
      query = query.or(
        buildSearchFilter(search, ['title', 'description', 'error_message', 'component', 'url']),
      );
    }

    const { data, error, count } = await query
      .order(order.column, { ascending: order.ascending })
      .range(start, end);

    if (error) this.fail('issues', error);
    return paginated(data, count, page, limit);
  }

  async updateIssue(id: string, patch: { status?: string; resolution_notes?: string }) {
    const update: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
    if (patch.status === 'resolved') update.resolved_at = new Date().toISOString();

    const { data, error } = await this.db
      .from('issues')
      .update(update)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) this.fail('issue', error);
    if (!data) throw new NotFoundException('Issue not found');
    return data;
  }

  /** Headline counts for the dashboard cards. */
  async getStats() {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const headCount = { count: 'exact', head: true } as const;

    const [unreadMessages, pendingQuotes, pendingReviews, subscribers, openIssues, recentPurchases] =
      await Promise.all([
        this.db
          .from('messages')
          .select('id', headCount)
          .is('read_at', null)
          .is('archived_at', null),
        this.db.from('quotes').select('id', headCount).eq('status', 'requested'),
        this.db.from('reviews').select('id', headCount).eq('status', 'pending'),
        this.db.from('newsletter_subscribers').select('id', headCount),
        this.db.from('issues').select('id', headCount).eq('status', 'open'),
        this.db.from('purchases').select('amount, status').gte('created_at', since),
      ]);

    // A failed count would otherwise surface as a confident "0" on the
    // dashboard, which is worse than showing nothing.
    const failed = [
      ['messages', unreadMessages.error],
      ['quotes', pendingQuotes.error],
      ['reviews', pendingReviews.error],
      ['newsletter subscribers', subscribers.error],
      ['issues', openIssues.error],
      ['purchases', recentPurchases.error],
    ].find(([, error]) => error) as [string, { message?: string }] | undefined;

    if (failed) this.fail(`${failed[0]} statistics`, failed[1]);

    const completed = (recentPurchases.data ?? []).filter((row) => row.status === 'completed');
    const revenue30d = completed.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);

    return {
      unreadMessages: unreadMessages.count ?? 0,
      pendingQuotes: pendingQuotes.count ?? 0,
      pendingReviews: pendingReviews.count ?? 0,
      subscribers: subscribers.count ?? 0,
      openIssues: openIssues.count ?? 0,
      revenue30d,
      purchases30d: completed.length,
    };
  }
}
