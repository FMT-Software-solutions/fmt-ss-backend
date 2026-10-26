import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { PaymentProvidersService } from '../../common/payment-providers/payment-providers.service';
import { PlanAccessService } from './plan-access.service';
import { ghs, PlanNotificationsService } from './plan-notifications.service';
import { isoDate, planPosition, reminderFor, type ReminderKind } from './plan-math';

const LINES: Record<ReminderKind, (amount: string, date: string) => string> = {
  before: (a, d) => `${a} is due on ${d}.`,
  due: (a) => `${a} is due today.`,
  late3: (a, d) => `${a} was due on ${d} and is now 3 days late.`,
  late7: (a, d) => `${a} was due on ${d} and is now 7 days late.`,
};

/**
 * Daily sweep at 08:00 Accra time over active and suspended plans:
 *   - reminders 3 days before, on, and 3 and 7 days after a due date
 *   - suspends plans more than grace_days behind
 *
 * Every send is recorded as a plan event with a dedupe key first, so a rerun
 * (or two instances) never sends the same reminder twice.
 *
 * Disabled unless PAYMENT_PLAN_JOBS_ENABLED is 'true', so a developer running
 * the backend locally never texts or locks out real customers.
 */
@Injectable()
export class PlanJobsService {
  private readonly logger = new Logger(PlanJobsService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly config: ConfigService,
    private readonly access: PlanAccessService,
    private readonly notifications: PlanNotificationsService,
    private readonly providers: PaymentProvidersService,
  ) { }

  private get db(): any {
    return this.supabaseService.getServiceRoleClient();
  }

  @Cron('0 8 * * *', { name: 'payment-plan-sweep', timeZone: 'Africa/Accra' })
  async scheduled() {
    if (this.config.get<string>('PAYMENT_PLAN_JOBS_ENABLED') !== 'true') {
      this.logger.log('Payment plan sweep skipped (PAYMENT_PLAN_JOBS_ENABLED is not "true")');
      return;
    }
    await this.sweep();
  }

  /** Claims a dedupe key; false when this exact action already happened. */
  private async claim(planId: string, type: string, key: string, summary: string, details: Record<string, unknown> = {}) {
    const { error } = await this.db
      .from('payment_plan_events')
      .insert({ plan_id: planId, type, summary, details, dedupe_key: key, actor: 'system' });
    if (!error) return true;
    if (error.code === '23505') return false;
    throw new Error(error.message);
  }

  async sweep(today = isoDate(new Date())) {
    const { data: plans, error } = await this.db
      .from('payment_plans')
      .select('*, payment_plan_installments(seq, due_date, amount)')
      .in('status', ['active', 'suspended']);
    if (error) throw new Error(error.message);

    const result = { checked: 0, reminders: 0, suspended: 0, failed: 0 };
    for (const { payment_plan_installments: schedule, ...plan } of plans ?? []) {
      result.checked += 1;
      try {
        const position = planPosition(schedule ?? [], Number(plan.amount_paid), today);
        if (position.balance <= 0) continue;
        const link = plan.link_token ? `${this.providers.siteOrigin()}/plan/${plan.link_token}` : undefined;
        const name = plan.customer_name?.split(' ')[0];

        if (plan.status === 'active' && position.daysOverdue > plan.grace_days && plan.organization_id) {
          if (await this.claim(plan.id, 'suspended', `suspend:${position.overdueSince}`, `Suspended: ${position.daysOverdue} days overdue`)) {
            await this.access.suspend(plan.app_id, plan.organization_id);
            await this.db
              .from('payment_plans')
              .update({ status: 'suspended', suspended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
              .eq('id', plan.id);
            await this.notifications.notify(plan, {
              subject: `${plan.app_title} access paused`,
              paragraphs: [
                `Hi${name ? ` ${this.notifications.html(name)}` : ''}, your ${this.notifications.html(plan.app_title)} payment of ${ghs(position.dueNow)} is ${position.daysOverdue} days overdue, so access has been paused.`,
                'Pay what is due and access comes back straight away. Your data is safe.',
              ],
              sms: `FMT: ${plan.app_title} access paused. ${ghs(position.dueNow)} is ${position.daysOverdue} days overdue. Pay to restore access${link ? `: ${link}` : '.'}`,
              action: link ? { label: 'Pay now', url: link } : undefined,
            });
            result.suspended += 1;
          }
          continue;
        }

        const reminder = reminderFor(position, today);
        if (!reminder) continue;
        const amount = ghs(reminder.kind === 'before' || reminder.kind === 'due' ? (position.next?.remaining ?? position.dueNow) : position.dueNow);
        const line = LINES[reminder.kind](amount, reminder.due_date);
        if (!(await this.claim(plan.id, 'reminder', `reminder:${reminder.seq}:${reminder.kind}`, `Reminder: ${line}`, reminder))) continue;

        const graceLine =
          reminder.kind === 'late3' || reminder.kind === 'late7'
            ? `Access is paused after ${plan.grace_days} days overdue.`
            : '';
        await this.notifications.notify(plan, {
          subject: `${plan.app_title} payment ${reminder.kind === 'before' ? 'coming up' : reminder.kind === 'due' ? 'due today' : 'overdue'}`,
          paragraphs: [
            `Hi${name ? ` ${this.notifications.html(name)}` : ''}, your ${this.notifications.html(plan.app_title)} instalment: ${line}`,
            graceLine,
          ].filter(Boolean),
          sms: `FMT: ${plan.app_title} instalment ${line} ${graceLine}${link ? ` Pay: ${link}` : ''}`.trim(),
          action: link ? { label: 'Pay now', url: link } : undefined,
        });
        result.reminders += 1;
      } catch (err) {
        result.failed += 1;
        this.logger.warn(`Plan ${plan.id}: ${(err as Error).message}`);
      }
    }
    this.logger.log(`Payment plan sweep: ${JSON.stringify(result)}`);
    return result;
  }
}
