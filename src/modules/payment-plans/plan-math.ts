/**
 * Payment-plan arithmetic. Pure functions so the schedule rules can be tested
 * without a database.
 *
 * A plan keeps one running total, amount_paid. Payments fill the schedule in
 * order, so what is due, what is overdue and when the plan finishes are all
 * derived from (schedule, amount_paid, today). Partial and early payments
 * need no special handling.
 */

export interface Installment {
  seq: number;
  due_date: string; // YYYY-MM-DD
  amount: number;
}

export type Frequency = 'weekly' | 'biweekly' | 'monthly';

export const round2 = (n: number) => Math.round(n * 100) / 100;

const DAY_MS = 86_400_000;

/** YYYY-MM-DD in Ghana time (UTC, no DST). */
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export const addDays = (date: string, days: number) =>
  isoDate(new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS));

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

function addMonths(date: string, months: number) {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  // Clamp 31 Jan + 1 month to 28/29 Feb rather than rolling into March.
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return isoDate(d);
}

export function totalWithSurcharge(basePrice: number, surchargePercent: number) {
  return round2(basePrice * (1 + surchargePercent / 100));
}

/**
 * Deposit (seq 0, due on startDate) plus `count` equal instalments, the first
 * one interval after the deposit. Rounding pennies go on the last instalment.
 */
export function buildSchedule(params: {
  total: number;
  deposit: number;
  count: number;
  frequency: Frequency;
  startDate: string;
}): Installment[] {
  const { total, deposit, count, frequency, startDate } = params;
  if (!(deposit > 0) || deposit > total) throw new Error('Deposit must be more than 0 and no more than the total');
  if (!Number.isInteger(count) || count < 0 || count > 36) throw new Error('Instalments must be between 0 and 36');
  const rest = round2(total - deposit);
  if (count === 0 && rest > 0) throw new Error('Add instalments, or make the deposit the full amount');

  const schedule: Installment[] = [{ seq: 0, due_date: startDate, amount: round2(deposit) }];
  if (count === 0) return schedule;

  const each = Math.floor((rest / count) * 100) / 100;
  for (let i = 1; i <= count; i++) {
    const due =
      frequency === 'monthly' ? addMonths(startDate, i) : addDays(startDate, i * (frequency === 'weekly' ? 7 : 14));
    const amount = i === count ? round2(rest - each * (count - 1)) : each;
    schedule.push({ seq: i, due_date: due, amount });
  }
  return schedule;
}

/** Checks a hand-edited schedule: deposit first, dates in order, sums to the total. */
export function validateSchedule(schedule: Installment[], total: number) {
  if (!schedule.length) throw new Error('The schedule is empty');
  const sorted = [...schedule].sort((a, b) => a.seq - b.seq);
  sorted.forEach((row, i) => {
    if (row.seq !== i) throw new Error('Instalments must be numbered from 0 without gaps');
    if (!(row.amount > 0)) throw new Error('Every instalment needs an amount');
    if (i > 0 && row.due_date < sorted[i - 1].due_date) throw new Error('Due dates must be in order');
  });
  const sum = round2(sorted.reduce((s, r) => s + Number(r.amount), 0));
  if (Math.abs(sum - total) > 0.009) throw new Error(`Instalments add up to ${sum}, not ${total}`);
  return sorted;
}

export interface PlanPosition {
  balance: number;
  /** What should have been paid by today and hasn't been. */
  dueNow: number;
  /** First instalment not fully covered, with what's left of it. */
  next: { seq: number; due_date: string; amount: number; remaining: number } | null;
  /** Days since the oldest unpaid instalment fell due (0 when nothing is late). */
  daysOverdue: number;
  overdueSince: string | null;
  rows: Array<Installment & { paid: number; status: 'paid' | 'partial' | 'due' | 'overdue' | 'upcoming' }>;
}

export function planPosition(schedule: Installment[], amountPaid: number, today: string): PlanPosition {
  const rows: PlanPosition['rows'] = [];
  let before = 0;
  let dueToDate = 0;
  let next: PlanPosition['next'] = null;
  let overdueSince: string | null = null;

  for (const row of [...schedule].sort((a, b) => a.seq - b.seq)) {
    const amount = Number(row.amount);
    const paid = round2(Math.min(amount, Math.max(0, amountPaid - before)));
    const remaining = round2(amount - paid);
    before = round2(before + amount);
    if (row.due_date <= today) dueToDate = round2(dueToDate + amount);

    let status: PlanPosition['rows'][number]['status'];
    if (remaining <= 0) status = 'paid';
    else if (row.due_date < today) status = 'overdue';
    else if (row.due_date === today) status = 'due';
    else status = paid > 0 ? 'partial' : 'upcoming';

    if (remaining > 0 && !next) next = { seq: row.seq, due_date: row.due_date, amount, remaining };
    if (remaining > 0 && row.due_date < today && !overdueSince) overdueSince = row.due_date;
    rows.push({ ...row, amount, paid, status });
  }

  const total = before;
  return {
    balance: round2(Math.max(0, total - amountPaid)),
    dueNow: round2(Math.max(0, dueToDate - amountPaid)),
    next,
    daysOverdue: overdueSince ? daysBetween(overdueSince, today) : 0,
    overdueSince,
    rows,
  };
}

/** Moves every due date by the same number of days (used when the deposit is paid late). */
export function shiftSchedule(schedule: Installment[], days: number): Installment[] {
  if (days <= 0) return schedule;
  return schedule.map((row) => ({ ...row, due_date: addDays(row.due_date, days) }));
}

export type ReminderKind = 'before' | 'due' | 'late3' | 'late7';

/**
 * Which reminder, if any, today calls for: 3 days before the next due date,
 * on it, and 3 and 7 days after it while it stays unpaid.
 */
export function reminderFor(position: PlanPosition, today: string): { kind: ReminderKind; seq: number; due_date: string } | null {
  const target = position.overdueSince
    ? position.rows.find((r) => r.due_date === position.overdueSince && r.status === 'overdue')
    : position.next;
  if (!target) return null;
  const offset = daysBetween(target.due_date, today);
  const kind: ReminderKind | null =
    offset === -3 ? 'before' : offset === 0 ? 'due' : offset === 3 ? 'late3' : offset === 7 ? 'late7' : null;
  return kind ? { kind, seq: target.seq, due_date: target.due_date } : null;
}
