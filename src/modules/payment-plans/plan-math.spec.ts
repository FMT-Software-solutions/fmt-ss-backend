import { buildSchedule, planPosition, reminderFor, shiftSchedule, totalWithSurcharge, validateSchedule } from './plan-math';

describe('payment plan maths', () => {
  const schedule = buildSchedule({ total: 3500, deposit: 1000, count: 3, frequency: 'monthly', startDate: '2026-01-31' });

  it('builds a deposit plus equal monthly instalments that add up to the total', () => {
    expect(schedule.map((r) => r.due_date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(schedule.map((r) => r.amount)).toEqual([1000, 833.33, 833.33, 833.34]);
    expect(schedule.reduce((s, r) => s + r.amount, 0)).toBeCloseTo(3500, 2);
  });

  it('applies a surcharge to the total', () => {
    expect(totalWithSurcharge(3500, 10)).toBe(3850);
    expect(totalWithSurcharge(3500, 0)).toBe(3500);
  });

  it('rejects deposits above the total and schedules that do not add up', () => {
    expect(() => buildSchedule({ total: 100, deposit: 150, count: 2, frequency: 'monthly', startDate: '2026-01-01' })).toThrow();
    expect(() => validateSchedule([{ seq: 0, due_date: '2026-01-01', amount: 50 }], 100)).toThrow(/add up/);
  });

  it('fills the schedule in order, partial payments included', () => {
    const p = planPosition(schedule, 1500, '2026-03-01');
    expect(p.balance).toBe(2000);
    expect(p.rows.map((r) => r.status)).toEqual(['paid', 'overdue', 'upcoming', 'upcoming']);
    expect(p.rows[1].paid).toBe(500);
    expect(p.dueNow).toBeCloseTo(333.33, 2);
    expect(p.overdueSince).toBe('2026-02-28');
    expect(p.daysOverdue).toBe(1);
  });

  it('treats early payments as covering later instalments', () => {
    const p = planPosition(schedule, 2700, '2026-02-01');
    expect(p.dueNow).toBe(0);
    expect(p.next).toMatchObject({ seq: 3, remaining: 800 });
    expect(p.daysOverdue).toBe(0);
  });

  it('is fully paid once the total is reached, even with overpayment', () => {
    const p = planPosition(schedule, 3600, '2026-05-30');
    expect(p.balance).toBe(0);
    expect(p.next).toBeNull();
  });

  it('crosses the 7-day grace period on day 8', () => {
    expect(planPosition(schedule, 1000, '2026-03-07').daysOverdue).toBe(7);
    expect(planPosition(schedule, 1000, '2026-03-08').daysOverdue).toBe(8);
  });

  it('reminds 3 days before, on the day, and 3 and 7 days late', () => {
    const at = (d: string) => reminderFor(planPosition(schedule, 1000, d), d)?.kind ?? null;
    expect(at('2026-02-25')).toBe('before');
    expect(at('2026-02-26')).toBeNull();
    expect(at('2026-02-28')).toBe('due');
    expect(at('2026-03-03')).toBe('late3');
    expect(at('2026-03-07')).toBe('late7');
  });

  it('shifts every date when the deposit is paid late', () => {
    expect(shiftSchedule(schedule, 5).map((r) => r.due_date)).toEqual(['2026-02-05', '2026-03-05', '2026-04-05', '2026-05-05']);
  });
});
