import {
  BadRequestException,
  GoneException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@supabase/supabase-js';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { SanityService } from '../../common/sanity/sanity.service';
import { PaymentProvidersService } from '../../common/payment-providers/payment-providers.service';
import { normalizeGhanaPhoneNumber } from '../../common/utils/phone.utils';
import { buildSearchFilter, paginated, toRange } from '../../common/utils/paginate';
import { PurchasesService } from '../purchases/purchases.service';
import type { BillingDetailsDto } from '../purchases/dto/purchase.dto';
import { effectivePrice } from '../payments/store-checkout.service';
import { PlanAccessService } from './plan-access.service';
import { ghs, PlanNotificationsService } from './plan-notifications.service';
import {
  buildSchedule,
  daysBetween,
  type Installment,
  isoDate,
  planPosition,
  round2,
  shiftSchedule,
  totalWithSurcharge,
  validateSchedule,
} from './plan-math';
import type {
  CreatePlanDto,
  CreatePlanRequestDto,
  PayPlanDto,
  RecordManualPaymentDto,
} from './dto/payment-plans.dto';

/**
 * Instalment plans for marketplace apps.
 *
 *   request  → a customer asks (email or phone) from the app page
 *   plan     → an admin prices it and builds a schedule (private to them)
 *   link     → sent by email/SMS; opening it needs a one-time code sent to
 *              that same contact
 *   accept   → the customer enters their organization details
 *   pay      → any amount between what's due and the balance; the server
 *              confirms with Paystack/Hubtel and adds what was paid
 *   deposit  → the first payment provisions the app as a paid organization
 *
 * Plans more than grace_days behind are suspended by PlanJobsService and
 * reinstated here as soon as a payment brings them back within grace.
 */

export const PLAN_STATUSES = ['draft', 'sent', 'active', 'suspended', 'completed', 'cancelled'] as const;
type PlanStatus = (typeof PLAN_STATUSES)[number];

export interface PlanRow {
  id: string;
  request_id: string | null;
  app_id: string;
  app_title: string;
  contact: string;
  contact_type: 'email' | 'phone';
  customer_name: string | null;
  organization_name: string | null;
  billing_details: BillingDetailsDto | null;
  organization_id: string | null;
  base_price: number;
  surcharge_percent: number;
  total_amount: number;
  amount_paid: number;
  currency: string;
  grace_days: number;
  notes: string | null;
  status: PlanStatus;
  link_token: string | null;
  link_sent_at: string | null;
  accepted_at: string | null;
  activated_at: string | null;
  suspended_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface PaymentRow {
  id: string;
  plan_id: string;
  reference: string;
  provider: 'paystack' | 'hubtel' | 'manual';
  amount: number;
  amount_paid: number | null;
  status: 'pending' | 'completed' | 'failed';
  method: string | null;
  confirmed_at: string | null;
  created_at: string;
  recorded_by: string | null;
  details: any;
}

const CODE_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 2 * 60 * 60_000;
const MAX_CODES_PER_HOUR = 5;
const MAX_CODE_ATTEMPTS = 5;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const today = () => isoDate(new Date());
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Email or Ghana phone, normalized; throws on anything else. */
export function parseContact(raw: string): { contact: string; contact_type: 'email' | 'phone' } {
  const value = raw.trim();
  if (EMAIL_RE.test(value)) return { contact: value.toLowerCase(), contact_type: 'email' };
  const phone = normalizeGhanaPhoneNumber(value);
  if (phone) return { contact: phone, contact_type: 'phone' };
  throw new BadRequestException('Enter a valid email address or Ghana phone number');
}

export function maskContact(contact: string, type: 'email' | 'phone') {
  if (type === 'phone') return `+${contact.slice(0, 3)} ••• ••• ${contact.slice(-3)}`;
  const [user, domain] = contact.split('@');
  return `${user.slice(0, 2)}••••@${domain}`;
}

@Injectable()
export class PaymentPlansService {
  private readonly logger = new Logger(PaymentPlansService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly sanity: SanityService,
    private readonly config: ConfigService,
    private readonly providers: PaymentProvidersService,
    private readonly purchases: PurchasesService,
    private readonly access: PlanAccessService,
    private readonly notifications: PlanNotificationsService,
  ) { }

  private get db(): any {
    return this.supabaseService.getServiceRoleClient();
  }

  linkFor(token: string) {
    return `${this.providers.siteOrigin()}/plan/${token}`;
  }

  // ================================================================ requests

  async createRequest(dto: CreatePlanRequestDto) {
    const { contact, contact_type } = parseContact(dto.contact);
    const app = await this.publishedApp(dto.appId);

    // A second click shouldn't make a second request.
    const { data: open } = await this.db
      .from('payment_plan_requests')
      .select('id')
      .eq('app_id', app._id)
      .eq('contact', contact)
      .eq('status', 'new')
      .maybeSingle();
    if (open) return { received: true };

    const { error } = await this.db.from('payment_plan_requests').insert({
      app_id: app._id,
      app_title: app.title,
      contact,
      contact_type,
      name: dto.name?.trim() || null,
      organization_name: dto.organizationName?.trim() || null,
      message: dto.message?.trim() || null,
    });
    if (error) throw new InternalServerErrorException(error.message);

    const h = this.notifications.html;
    await this.notifications.notifyAdmins(`Payment plan request: ${app.title}`, [
      `<strong>${h(dto.name?.trim() || 'Someone')}</strong>${dto.organizationName ? ` (${h(dto.organizationName)})` : ''} asked to pay for <strong>${h(app.title)}</strong> in instalments.`,
      `Contact: ${h(contact_type === 'phone' ? `+${contact}` : contact)}`,
      ...(dto.message ? [`“${h(dto.message)}”`] : []),
    ]);
    return { received: true };
  }

  async listRequests(params: { page?: number; limit?: number; status?: string; search?: string }) {
    const page = Number(params.page) || 1;
    const limit = Math.min(Number(params.limit) || 25, 100);
    const [from, to] = toRange(page, limit);
    let query = this.db.from('payment_plan_requests').select('*', { count: 'exact' });
    if (params.status) query = query.eq('status', params.status);
    if (params.search) query = query.or(buildSearchFilter(params.search, ['contact', 'name', 'organization_name', 'app_title']));
    const { data, count, error } = await query.order('created_at', { ascending: false }).range(from, to);
    if (error) throw new InternalServerErrorException(error.message);
    return paginated(data, count, page, limit);
  }

  async updateRequest(id: string, status: 'new' | 'planned' | 'declined') {
    const { data, error } = await this.db
      .from('payment_plan_requests')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Request not found');
    return data;
  }

  // ================================================================ admin: plans

  private async publishedApp(appId: string) {
    const app = await this.sanity.fetch<any>(
      `*[_type == "premiumApp" && _id == $id && isPublished == true][0]{ _id, title, price, isFree, promotion }`,
      { id: appId },
    );
    if (!app) throw new BadRequestException('This app is not available');
    if (app.isFree) throw new BadRequestException(`${app.title} is free`);
    return app as { _id: string; title: string; price?: number; isFree?: boolean; promotion?: any };
  }

  /** Current price for the create form. */
  async quote(appId: string) {
    const app = await this.publishedApp(appId);
    return { appId: app._id, title: app.title, listPrice: Number(app.price ?? 0), price: effectivePrice(app) };
  }

  async createPlan(dto: CreatePlanDto, actor?: User) {
    const app = await this.publishedApp(dto.appId);
    const { contact, contact_type } = parseContact(dto.contact);
    const basePrice = round2(dto.basePrice ?? effectivePrice(app));
    if (!(basePrice > 0)) throw new BadRequestException(`${app.title} has no price set`);
    const surcharge = dto.surchargePercent ?? 0;
    const total = totalWithSurcharge(basePrice, surcharge);

    let schedule: Installment[];
    try {
      schedule = dto.schedule?.length
        ? validateSchedule(dto.schedule, total)
        : buildSchedule({ total, deposit: dto.deposit, count: dto.count, frequency: dto.frequency, startDate: today() });
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const { data: plan, error } = await this.db
      .from('payment_plans')
      .insert({
        request_id: dto.requestId ?? null,
        app_id: app._id,
        app_title: app.title,
        contact,
        contact_type,
        customer_name: dto.customerName?.trim() || null,
        organization_name: dto.organizationName?.trim() || null,
        base_price: basePrice,
        surcharge_percent: surcharge,
        total_amount: total,
        grace_days: dto.graceDays ?? 7,
        notes: dto.notes?.trim() || null,
        created_by: actor?.email ?? null,
      })
      .select()
      .single();
    if (error) throw new InternalServerErrorException(error.message);

    const { error: scheduleError } = await this.db
      .from('payment_plan_installments')
      .insert(schedule.map((row) => ({ plan_id: plan.id, seq: row.seq, due_date: row.due_date, amount: row.amount })));
    if (scheduleError) {
      await this.db.from('payment_plans').delete().eq('id', plan.id);
      throw new InternalServerErrorException(scheduleError.message);
    }

    if (dto.requestId) {
      await this.db
        .from('payment_plan_requests')
        .update({ status: 'planned', plan_id: plan.id, updated_at: new Date().toISOString() })
        .eq('id', dto.requestId);
    }
    await this.event(plan.id, 'created', `Plan created: ${ghs(total)} over ${schedule.length} payments`, {}, actor?.email);
    return this.adminPlan(plan.id);
  }

  async listPlans(params: { page?: number; limit?: number; status?: string; search?: string }) {
    const page = Number(params.page) || 1;
    const limit = Math.min(Number(params.limit) || 25, 100);
    const [from, to] = toRange(page, limit);
    let query = this.db
      .from('payment_plans')
      .select('*, payment_plan_installments(seq, due_date, amount)', { count: 'exact' });
    if (params.status === 'overdue') query = query.in('status', ['active', 'suspended']);
    else if (params.status) query = query.eq('status', params.status);
    if (params.search) {
      query = query.or(buildSearchFilter(params.search, ['contact', 'customer_name', 'organization_name', 'app_title']));
    }
    const { data, count, error } = await query.order('created_at', { ascending: false }).range(from, to);
    if (error) throw new InternalServerErrorException(error.message);

    const now = today();
    let rows = (data ?? []).map(({ payment_plan_installments, link_token, ...plan }: any) => {
      const position = planPosition(payment_plan_installments ?? [], Number(plan.amount_paid), now);
      return {
        ...plan,
        balance: position.balance,
        due_now: position.dueNow,
        next_due_date: position.next?.due_date ?? null,
        days_overdue: position.daysOverdue,
      };
    });
    if (params.status === 'overdue') rows = rows.filter((r: any) => r.days_overdue > 0);
    return paginated(rows, params.status === 'overdue' ? rows.length : count, page, limit);
  }

  async summary() {
    const { data, error } = await this.db
      .from('payment_plans')
      .select('status, total_amount, amount_paid, grace_days, payment_plan_installments(seq, due_date, amount)')
      .in('status', ['sent', 'active', 'suspended']);
    if (error) throw new InternalServerErrorException(error.message);
    const { count: newRequests } = await this.db
      .from('payment_plan_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'new');
    const now = today();
    let outstanding = 0;
    let dueNow = 0;
    let overdue = 0;
    let active = 0;
    for (const plan of data ?? []) {
      const position = planPosition(plan.payment_plan_installments ?? [], Number(plan.amount_paid), now);
      if (plan.status !== 'sent') {
        active += 1;
        outstanding += position.balance;
        dueNow += position.dueNow;
        if (position.daysOverdue > 0) overdue += 1;
      }
    }
    return { newRequests: newRequests ?? 0, active, overdue, outstanding: round2(outstanding), dueNow: round2(dueNow) };
  }

  async adminPlan(id: string) {
    const plan = await this.planById(id);
    const [schedule, payments, events] = await Promise.all([
      this.schedule(plan.id),
      this.db.from('payment_plan_payments').select('*').eq('plan_id', plan.id).order('created_at', { ascending: false }),
      this.db.from('payment_plan_events').select('*').eq('plan_id', plan.id).order('created_at', { ascending: false }).limit(100),
    ]);
    const position = planPosition(schedule, Number(plan.amount_paid), today());
    return {
      plan: { ...plan, link: plan.link_token ? this.linkFor(plan.link_token) : null },
      position,
      payments: payments.data ?? [],
      events: events.data ?? [],
    };
  }

  /** (Re)issues the link and delivers it. Returns the link so it can also be shared by hand. */
  async sendLink(id: string, via: 'email' | 'sms' | 'both' | 'none' | undefined, actor?: User) {
    const plan = await this.planById(id);
    if (plan.status === 'cancelled' || plan.status === 'completed') {
      throw new BadRequestException(`This plan is ${plan.status}`);
    }
    const token = plan.link_token ?? randomBytes(18).toString('base64url');
    const link = this.linkFor(token);
    const { error } = await this.db
      .from('payment_plans')
      .update({
        link_token: token,
        link_sent_at: new Date().toISOString(),
        status: plan.status === 'draft' ? 'sent' : plan.status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) throw new InternalServerErrorException(error.message);

    const channel = via ?? (plan.contact_type === 'email' ? 'email' : 'sms');
    const name = plan.customer_name?.split(' ')[0];
    const h = this.notifications.html;
    let email = false;
    let sms = false;
    if (channel !== 'none') {
      const { emails, phones } = this.notifications.channels(plan);
      if (channel === 'email' || channel === 'both') {
        email = await this.notifications.email(
          emails,
          `Your payment plan for ${plan.app_title}`,
          [
            `Hi${name ? ` ${h(name)}` : ''},`,
            `Your payment plan for <strong>${h(plan.app_title)}</strong> is ready: ${ghs(plan.total_amount)} in instalments.`,
            'Open it to see the schedule and pay your first instalment. Your app is set up as soon as that payment goes through.',
          ],
          { label: 'View my plan', url: link },
        );
      }
      if (channel === 'sms' || channel === 'both') {
        sms = await this.notifications.sms(
          phones,
          `Hi${name ? ` ${name}` : ''}, your ${plan.app_title} payment plan is ready (${ghs(plan.total_amount)}). View and pay: ${link}`,
        );
      }
    }
    await this.event(id, 'link_sent', `Link ${channel === 'none' ? 'copied' : `sent by ${channel}`}`, { email, sms }, actor?.email);
    return { link, delivered: { email, sms } };
  }

  async recordManualPayment(id: string, dto: RecordManualPaymentDto, actor?: User) {
    let plan = await this.planById(id);
    if (!['sent', 'active', 'suspended', 'draft'].includes(plan.status)) {
      throw new BadRequestException(`This plan is ${plan.status}`);
    }
    if (!plan.billing_details) {
      if (!dto.billingDetails) {
        throw new BadRequestException('The customer has not accepted the plan yet. Add their organization details.');
      }
      plan = await this.saveBilling(plan, dto.billingDetails);
    }
    const position = planPosition(await this.schedule(id), Number(plan.amount_paid), today());
    if (dto.amount > position.balance + 0.009) {
      throw new BadRequestException(`The balance is ${ghs(position.balance)}`);
    }

    const reference = this.newReference('M');
    const { error } = await this.db.from('payment_plan_payments').insert({
      plan_id: id,
      reference,
      provider: 'manual',
      amount: dto.amount,
      method: dto.method?.trim() || 'manual',
      recorded_by: actor?.email ?? null,
      details: { note: dto.note ?? null },
    });
    if (error) throw new InternalServerErrorException(error.message);
    await this.claimAndApply(reference, { paid: true, amountGhs: dto.amount, method: dto.method || 'manual', raw: { manual: true } }, actor?.email);
    return this.adminPlan(id);
  }

  async changeStatus(id: string, action: 'suspend' | 'reinstate' | 'cancel', reason: string | undefined, actor?: User) {
    const plan = await this.planById(id);
    const now = new Date().toISOString();
    if (action === 'suspend') {
      if (plan.status !== 'active' || !plan.organization_id) throw new BadRequestException('Only active plans can be suspended');
      await this.access.suspend(plan.app_id, plan.organization_id);
      await this.db.from('payment_plans').update({ status: 'suspended', suspended_at: now, updated_at: now }).eq('id', id);
      await this.event(id, 'suspended', reason || 'Suspended by an admin', {}, actor?.email);
    } else if (action === 'reinstate') {
      if (plan.status !== 'suspended' || !plan.organization_id) throw new BadRequestException('Only suspended plans can be reinstated');
      await this.access.reinstate(plan.app_id, plan.organization_id);
      await this.db.from('payment_plans').update({ status: 'active', suspended_at: null, updated_at: now }).eq('id', id);
      await this.event(id, 'reinstated', reason || 'Reinstated by an admin', {}, actor?.email);
    } else {
      if (['completed', 'cancelled'].includes(plan.status)) throw new BadRequestException(`This plan is ${plan.status}`);
      await this.db.from('payment_plans').update({ status: 'cancelled', cancelled_at: now, updated_at: now }).eq('id', id);
      await this.event(id, 'cancelled', reason || 'Cancelled by an admin', {}, actor?.email);
    }
    return this.adminPlan(id);
  }

  // ================================================================ customer: link + code

  private async planByToken(token: string) {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new NotFoundException('This link is not valid');
    const { data, error } = await this.db.from('payment_plans').select('*').eq('link_token', token).maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data || data.status === 'draft') throw new NotFoundException('This link is not valid');
    if (data.status === 'cancelled') throw new GoneException('This payment plan was cancelled');
    return data as PlanRow;
  }

  /** What the link page shows before the code: nothing beyond the app and a masked contact. */
  async linkSummary(token: string) {
    const plan = await this.planByToken(token);
    return {
      appTitle: plan.app_title,
      contactType: plan.contact_type,
      maskedContact: maskContact(plan.contact, plan.contact_type),
    };
  }

  async sendCode(token: string) {
    const plan = await this.planByToken(token);
    const hourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const { count } = await this.db
      .from('payment_plan_otps')
      .select('id', { count: 'exact', head: true })
      .eq('plan_id', plan.id)
      .gte('created_at', hourAgo);
    if ((count ?? 0) >= MAX_CODES_PER_HOUR) {
      throw new BadRequestException('Too many codes requested. Try again in an hour.');
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const { error } = await this.db.from('payment_plan_otps').insert({
      plan_id: plan.id,
      code_hash: sha256(`${plan.id}:${code}`),
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    });
    if (error) throw new InternalServerErrorException(error.message);

    // Only to the contact the plan was created for: that's what proves it's them.
    const sent =
      plan.contact_type === 'email'
        ? await this.notifications.email([plan.contact], `${code} is your FMT verification code`, [
          `Your code to open your ${this.notifications.html(plan.app_title)} payment plan is:`,
          `<span style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</span>`,
          'It expires in 10 minutes. If you did not request it, ignore this email.',
        ])
        : await this.notifications.sms([plan.contact], `Your FMT payment plan code is ${code}. It expires in 10 minutes.`);
    if (!sent) throw new InternalServerErrorException('We could not send the code. Please try again.');
    return { sent: true, maskedContact: maskContact(plan.contact, plan.contact_type) };
  }

  async verifyCode(token: string, code: string) {
    const plan = await this.planByToken(token);
    const { data: otp } = await this.db
      .from('payment_plan_otps')
      .select('*')
      .eq('plan_id', plan.id)
      .is('verified_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!otp) throw new BadRequestException('This code has expired. Request a new one.');
    if (otp.attempts >= MAX_CODE_ATTEMPTS) throw new BadRequestException('Too many attempts. Request a new code.');

    await this.db.from('payment_plan_otps').update({ attempts: otp.attempts + 1 }).eq('id', otp.id);
    const expected = Buffer.from(otp.code_hash, 'hex');
    const actual = Buffer.from(sha256(`${plan.id}:${code}`), 'hex');
    if (!timingSafeEqual(expected, actual)) throw new BadRequestException('That code is not correct');

    const session = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await this.db
      .from('payment_plan_otps')
      .update({ verified_at: new Date().toISOString(), session_hash: sha256(session), session_expires_at: expiresAt })
      .eq('id', otp.id);
    await this.event(plan.id, 'verified', 'Customer opened the plan');
    return { session, expiresAt };
  }

  private async planForSession(token: string, session: string | undefined) {
    const plan = await this.planByToken(token);
    if (!session) throw new UnauthorizedException('Verify with the code first');
    const { data } = await this.db
      .from('payment_plan_otps')
      .select('id')
      .eq('plan_id', plan.id)
      .eq('session_hash', sha256(session))
      .gt('session_expires_at', new Date().toISOString())
      .maybeSingle();
    if (!data) throw new UnauthorizedException('Your session has expired. Verify again.');
    return plan;
  }

  // ================================================================ customer: plan

  async customerPlan(token: string, session: string | undefined) {
    const plan = await this.planForSession(token, session);
    return this.customerView(plan);
  }

  private async customerView(plan: PlanRow) {
    const schedule = await this.schedule(plan.id);
    const position = planPosition(schedule, Number(plan.amount_paid), today());
    const { data: payments } = await this.db
      .from('payment_plan_payments')
      .select('reference, amount_paid, method, provider, confirmed_at')
      .eq('plan_id', plan.id)
      .eq('status', 'completed')
      .order('confirmed_at', { ascending: false });
    const activated = ['active', 'suspended', 'completed'].includes(plan.status);
    const deposit = Number(schedule[0]?.amount ?? 0);
    const minimum = activated
      ? round2(Math.min(1, position.balance))
      : round2(Math.max(0, deposit - Number(plan.amount_paid)));
    const suggested = activated
      ? round2(position.dueNow > 0 ? position.dueNow : (position.next?.remaining ?? 0))
      : minimum;
    return {
      appTitle: plan.app_title,
      customerName: plan.customer_name,
      organizationName: plan.billing_details?.organizationName ?? plan.organization_name,
      status: plan.status,
      accepted: !!plan.billing_details,
      billingDetails: plan.billing_details,
      contactType: plan.contact_type,
      contact: plan.contact,
      total: Number(plan.total_amount),
      basePrice: Number(plan.base_price),
      surchargePercent: Number(plan.surcharge_percent),
      amountPaid: Number(plan.amount_paid),
      graceDays: plan.grace_days,
      deposit,
      balance: position.balance,
      dueNow: position.dueNow,
      daysOverdue: position.daysOverdue,
      next: position.next,
      schedule: position.rows,
      minimum,
      suggested: round2(Math.min(Math.max(suggested, minimum), position.balance)),
      payments: payments ?? [],
    };
  }

  async accept(token: string, session: string | undefined, billing: BillingDetailsDto) {
    const plan = await this.planForSession(token, session);
    if (!['sent', 'active', 'suspended'].includes(plan.status)) throw new BadRequestException(`This plan is ${plan.status}`);
    if (plan.status !== 'sent') throw new BadRequestException('This plan is already active');
    const saved = await this.saveBilling(plan, billing);
    await this.event(plan.id, 'accepted', `Accepted by ${billing.organizationName}`);
    return this.customerView(saved);
  }

  private async saveBilling(plan: PlanRow, billing: BillingDetailsDto) {
    const now = new Date().toISOString();
    const { data, error } = await this.db
      .from('payment_plans')
      .update({
        billing_details: { ...billing, organizationEmail: billing.organizationEmail.toLowerCase() },
        accepted_at: plan.accepted_at ?? now,
        updated_at: now,
      })
      .eq('id', plan.id)
      .select()
      .single();
    if (error) throw new InternalServerErrorException(error.message);
    return data as PlanRow;
  }

  async startPayment(token: string, session: string | undefined, dto: PayPlanDto) {
    const plan = await this.planForSession(token, session);
    if (!['sent', 'active', 'suspended'].includes(plan.status)) throw new BadRequestException(`This plan is ${plan.status}`);
    if (!plan.billing_details) throw new BadRequestException('Accept the plan first');
    const view = await this.customerView(plan);
    if (view.balance <= 0) throw new BadRequestException('This plan is fully paid');
    const amount = round2(dto.amount);
    if (amount + 0.009 < view.minimum) throw new BadRequestException(`Pay at least ${ghs(view.minimum)}`);
    if (amount > view.balance + 0.009) throw new BadRequestException(`The balance is ${ghs(view.balance)}`);

    const reference = this.newReference();
    const { error } = await this.db.from('payment_plan_payments').insert({
      plan_id: plan.id,
      reference,
      provider: dto.provider,
      amount,
    });
    if (error) throw new InternalServerErrorException(error.message);

    const billing = plan.billing_details;
    if (dto.provider === 'paystack') {
      return { provider: 'paystack' as const, reference, amount, currency: 'GHS', email: billing.organizationEmail };
    }
    const link = this.linkFor(token);
    const checkoutUrl = await this.providers.initiateHubtel({
      reference,
      amount,
      description: `${plan.app_title} instalment`,
      returnUrl: `${link}?reference=${reference}`,
      cancellationUrl: link,
      payee: { name: billing.organizationName, phone: billing.phoneNumber, email: billing.organizationEmail },
    });
    return { provider: 'hubtel' as const, reference, amount, currency: 'GHS', checkoutUrl };
  }

  // ================================================================ confirmation

  isPlanReference(reference: string) {
    return /^FMP[A-Z0-9]{8,40}$/.test(reference);
  }

  private newReference(kind = '') {
    return `FMP${kind}${Date.now().toString(36)}${randomBytes(5).toString('hex')}`.toUpperCase();
  }

  private async payment(reference: string) {
    const { data, error } = await this.db.from('payment_plan_payments').select('*').eq('reference', reference).maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    return data as PaymentRow | null;
  }

  /** Webhook, Hubtel callback and the customer's polling all land here. */
  async confirmPayment(reference: string) {
    const payment = await this.payment(reference);
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status === 'pending' && payment.provider !== 'manual') {
      const confirmation = await this.providers.check(payment.provider, reference);
      if (confirmation.paid && confirmation.amountGhs > 0) {
        await this.claimAndApply(reference, confirmation);
      }
    }
    return this.paymentStatus(reference);
  }

  async paymentStatus(reference: string) {
    const payment = await this.payment(reference);
    if (!payment) throw new NotFoundException('Payment not found');
    const { data: plan } = await this.db.from('payment_plans').select('status').eq('id', payment.plan_id).single();
    return {
      reference,
      status: payment.status,
      amount: Number(payment.amount),
      amountPaid: payment.amount_paid != null ? Number(payment.amount_paid) : null,
      planStatus: plan?.status as PlanStatus,
    };
  }

  /**
   * Credits a confirmed payment once (the RPC claims pending → completed and
   * adds to amount_paid in one transaction), then activates, reinstates or
   * completes the plan as the new total calls for.
   */
  private async claimAndApply(
    reference: string,
    confirmation: { paid: boolean; amountGhs: number; method?: string; externalId?: string; raw: unknown },
    actor?: string,
  ) {
    const { data, error } = await this.db.rpc('claim_payment_plan_payment', {
      p_reference: reference,
      p_amount_paid: round2(confirmation.amountGhs),
      p_method: confirmation.method ?? null,
      p_external_id: confirmation.externalId ?? null,
      p_details: { confirmation: confirmation.raw ?? null },
    });
    if (error) throw new InternalServerErrorException(error.message);
    const plan = (Array.isArray(data) ? data[0] : data) as PlanRow | undefined;
    if (!plan) return; // already credited by another caller

    const amount = round2(confirmation.amountGhs);
    await this.event(plan.id, 'payment', `${ghs(amount)} received${actor ? ` (recorded by ${actor})` : ''}`, { reference, amount }, actor);

    try {
      await this.applyPayment(plan, amount);
    } catch (error) {
      this.logger.error(`Plan ${plan.id} payment ${reference} credited but follow-up failed: ${(error as Error).message}`);
      await this.purchases.logPurchaseIssue({
        title: 'Payment plan: payment credited but follow-up failed',
        description: `Plan ${plan.id}, payment ${reference}: ${(error as Error).message}`,
        organizationId: plan.organization_id ?? undefined,
        severity: 'critical',
        component: 'PaymentPlansService',
      });
    }
  }

  private async applyPayment(plan: PlanRow, amount: number) {
    let schedule = await this.schedule(plan.id);
    const now = new Date().toISOString();

    if (plan.status === 'sent' || plan.status === 'draft') {
      const deposit = Number(schedule[0]?.amount ?? 0);
      if (Number(plan.amount_paid) + 0.009 < deposit) {
        await this.receipt(plan, amount, schedule);
        return; // deposit not complete yet; nothing to activate
      }
      plan = await this.activate(plan);
      schedule = await this.schedule(plan.id);
    }

    const position = planPosition(schedule, Number(plan.amount_paid), today());
    if (plan.status === 'suspended' && position.daysOverdue <= plan.grace_days && plan.organization_id) {
      await this.access.reinstate(plan.app_id, plan.organization_id);
      await this.db.from('payment_plans').update({ status: 'active', suspended_at: null, updated_at: now }).eq('id', plan.id);
      await this.event(plan.id, 'reinstated', 'Access restored after payment');
      plan = { ...plan, status: 'active' };
    }
    if (position.balance <= 0 && plan.status !== 'completed') {
      await this.db.from('payment_plans').update({ status: 'completed', completed_at: now, updated_at: now }).eq('id', plan.id);
      if (plan.organization_id) {
        await this.db
          .from('organization_apps')
          .update({ plan_type: 'paid', updated_at: now })
          .eq('organization_id', plan.organization_id)
          .eq('app_id', plan.app_id);
      }
      await this.event(plan.id, 'completed', 'Paid in full');
      plan = { ...plan, status: 'completed' };
    }
    await this.receipt(plan, amount, schedule);
  }

  /** Deposit complete: create the organization, provision the app as paid, start the clock. */
  private async activate(plan: PlanRow): Promise<PlanRow> {
    const billing = plan.billing_details;
    if (!billing) throw new Error('Plan has no organization details');
    const organizationId = await this.purchases.ensureOrganizationAndBillingAddress(billing, false);

    const apps = await this.purchases.fetchProvisioningAppsByIds([plan.app_id]);
    const app = apps[0];
    if (app?.appProvisioning) {
      const results = await this.purchases.provisionApps(
        organizationId,
        billing,
        {
          [app._id]: {
            productId: app._id,
            name: app.title,
            useSameEmailAsAdmin: true,
            userEmail: billing.organizationEmail,
            supabaseUrl: app.appProvisioning.supabaseUrl,
            supabaseAnonKey: app.appProvisioning.supabaseAnonKey,
            edgeFunctionName: app.appProvisioning.edgeFunctionName,
          },
        },
        'buy',
      );
      const failed = results.filter((r: any) => !r.success);
      if (failed.length) {
        await this.purchases.logPurchaseIssue({
          title: 'Payment plan deposit paid but provisioning failed',
          description: `Plan ${plan.id}: ${failed.map((f: any) => f.error).join('; ')}`,
          organizationId,
          severity: 'critical',
          component: 'PaymentPlansService',
        });
      }
    }
    await this.purchases.recordAppAccess(organizationId, [plan.app_id], 'buy');
    await this.db
      .from('organization_apps')
      .update({ plan_type: 'installment' })
      .eq('organization_id', organizationId)
      .eq('app_id', plan.app_id);

    // A deposit paid late moves the whole schedule, so nobody starts out overdue.
    const schedule = await this.schedule(plan.id);
    const lateBy = schedule.length ? daysBetween(schedule[0].due_date, today()) : 0;
    if (lateBy > 0) {
      for (const row of shiftSchedule(schedule, lateBy)) {
        await this.db.from('payment_plan_installments').update({ due_date: row.due_date }).eq('plan_id', plan.id).eq('seq', row.seq);
      }
    }

    const now = new Date().toISOString();
    const { data, error } = await this.db
      .from('payment_plans')
      .update({ status: 'active', organization_id: organizationId, activated_at: now, updated_at: now })
      .eq('id', plan.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    await this.event(plan.id, 'activated', `${plan.app_title} set up for ${billing.organizationName}`, { organizationId, shiftedDays: lateBy });
    return data as PlanRow;
  }

  private async receipt(plan: PlanRow, amount: number, schedule: Installment[]) {
    const position = planPosition(schedule, Number(plan.amount_paid), today());
    const link = plan.link_token ? this.linkFor(plan.link_token) : undefined;
    const nextLine =
      position.balance <= 0
        ? 'Your plan is fully paid. Thank you!'
        : position.next
          ? `Next: ${ghs(position.next.remaining)} due ${position.next.due_date}.`
          : '';
    await this.notifications.notify(plan, {
      subject: `Payment received: ${plan.app_title}`,
      paragraphs: [
        `We received <strong>${ghs(amount)}</strong> for your ${this.notifications.html(plan.app_title)} payment plan.`,
        `Paid so far: ${ghs(plan.amount_paid)} of ${ghs(plan.total_amount)}. Balance: ${ghs(position.balance)}.`,
        nextLine,
      ].filter(Boolean),
      sms: `FMT: ${ghs(amount)} received for ${plan.app_title}. Balance ${ghs(position.balance)}. ${nextLine}`.trim(),
      action: link && position.balance > 0 ? { label: 'View my plan', url: link } : undefined,
    });
  }

  // ================================================================ helpers

  async planById(id: string) {
    const { data, error } = await this.db.from('payment_plans').select('*').eq('id', id).maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Plan not found');
    return data as PlanRow;
  }

  async schedule(planId: string): Promise<Installment[]> {
    const { data, error } = await this.db
      .from('payment_plan_installments')
      .select('seq, due_date, amount')
      .eq('plan_id', planId)
      .order('seq');
    if (error) throw new InternalServerErrorException(error.message);
    return (data ?? []).map((r: any) => ({ ...r, amount: Number(r.amount) }));
  }

  private async event(planId: string, type: string, summary: string, details: Record<string, unknown> = {}, actor?: string) {
    const { error } = await this.db
      .from('payment_plan_events')
      .insert({ plan_id: planId, type, summary, details, actor: actor ?? null });
    if (error) this.logger.warn(`Could not record plan event ${type}: ${error.message}`);
  }
}
