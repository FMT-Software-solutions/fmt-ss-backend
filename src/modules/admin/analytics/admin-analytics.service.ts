import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../../common/supabase/supabase.service';

interface RangeParams {
  from?: string;
  to?: string;
}

interface PageViewRow {
  path: string;
  country: string | null;
  referrer_host: string | null;
  device: string | null;
  browser: string | null;
  visitor_hash: string | null;
  session_id: string | null;
  occurred_at: string;
}

/** Counts occurrences of a key, returning the biggest first. */
function tally<T extends string | null>(
  values: T[],
  limit = 10,
  fallback = 'Unknown',
): { key: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value ?? fallback;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

@Injectable()
export class AdminAnalyticsService {
  private readonly logger = new Logger(AdminAnalyticsService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) { }

  private get db() {
    return this.supabaseService.getServiceRoleClient();
  }

  get retentionDays(): number {
    return Number(this.configService.get('ANALYTICS_RETENTION_DAYS') ?? 90);
  }

  private range(params: RangeParams) {
    const to = params.to ? new Date(params.to) : new Date();
    const from = params.from
      ? new Date(params.from)
      : new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
    return { from, to };
  }

  /**
   * Pulls the raw rows for a window once, then derives every breakdown from
   * them. Cheaper and more consistent than six separate aggregate queries, and
   * the volume for a marketing site comfortably fits in memory.
   */
  private async fetchRows(params: RangeParams): Promise<{ rows: PageViewRow[]; unavailable: boolean }> {
    const { from, to } = this.range(params);

    const { data, error } = await this.db
      .from('page_views')
      .select('path, country, referrer_host, device, browser, visitor_hash, session_id, occurred_at')
      .gte('occurred_at', from.toISOString())
      .lte('occurred_at', to.toISOString())
      .order('occurred_at', { ascending: true })
      .limit(100000);

    if (error) {
      if (/could not find the table|does not exist/i.test(error.message)) {
        return { rows: [], unavailable: true };
      }
      throw new InternalServerErrorException(`Failed to load analytics: ${error.message}`);
    }

    return { rows: (data ?? []) as PageViewRow[], unavailable: false };
  }

  async getReport(params: RangeParams) {
    const { from, to } = this.range(params);
    const { rows, unavailable } = await this.fetchRows(params);

    if (unavailable) {
      return {
        unavailable: true as const,
        from: from.toISOString(),
        to: to.toISOString(),
        summary: { views: 0, uniques: 0, sessions: 0, countries: 0, viewsPerSession: 0 },
        timeseries: [],
        pages: [],
        countries: [],
        referrers: [],
        devices: [],
        browsers: [],
      };
    }

    const uniques = new Set(rows.map((row) => row.visitor_hash).filter(Boolean)).size;
    const sessions = new Set(rows.map((row) => row.session_id).filter(Boolean)).size;

    // Views and unique visitors per day.
    const byDay = new Map<string, { date: string; views: number; visitors: Set<string> }>();
    for (const row of rows) {
      const date = row.occurred_at.slice(0, 10);
      const entry = byDay.get(date) ?? { date, views: 0, visitors: new Set<string>() };
      entry.views += 1;
      if (row.visitor_hash) entry.visitors.add(row.visitor_hash);
      byDay.set(date, entry);
    }

    const timeseries = [...byDay.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((entry) => ({ date: entry.date, views: entry.views, uniques: entry.visitors.size }));

    return {
      unavailable: false as const,
      from: from.toISOString(),
      to: to.toISOString(),
      summary: {
        views: rows.length,
        uniques,
        sessions,
        countries: new Set(rows.map((row) => row.country).filter(Boolean)).size,
        viewsPerSession: sessions ? Number((rows.length / sessions).toFixed(1)) : 0,
      },
      timeseries,
      pages: tally(rows.map((row) => row.path), 15),
      countries: tally(rows.map((row) => row.country), 12),
      referrers: tally(
        rows.map((row) => row.referrer_host),
        10,
        'Direct',
      ),
      devices: tally(rows.map((row) => row.device), 5),
      browsers: tally(rows.map((row) => row.browser), 6),
    };
  }

  /**
   * Rolls a day's raw rows into analytics_daily so history survives the purge.
   * Idempotent: re-running a day replaces its rows.
   */
  async rollupDay(day: Date): Promise<{ paths: number; views: number }> {
    const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const dayKey = start.toISOString().slice(0, 10);

    const { data, error } = await this.db
      .from('page_views')
      .select('path, country, referrer_host, device, visitor_hash')
      .gte('occurred_at', start.toISOString())
      .lt('occurred_at', end.toISOString());

    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const byPath = new Map<
      string,
      { views: number; visitors: Set<string>; countries: string[]; referrers: string[]; devices: string[] }
    >();

    for (const row of rows) {
      const entry =
        byPath.get(row.path) ??
        { views: 0, visitors: new Set<string>(), countries: [], referrers: [], devices: [] };
      entry.views += 1;
      if (row.visitor_hash) entry.visitors.add(row.visitor_hash);
      entry.countries.push(row.country ?? 'Unknown');
      entry.referrers.push(row.referrer_host ?? 'Direct');
      entry.devices.push(row.device ?? 'Unknown');
      byPath.set(row.path, entry);
    }

    const toJson = (values: string[]) =>
      Object.fromEntries(tally(values, 50).map(({ key, count }) => [key, count]));

    const records = [...byPath.entries()].map(([path, entry]) => ({
      day: dayKey,
      path,
      views: entry.views,
      uniques: entry.visitors.size,
      country_json: toJson(entry.countries) as never,
      referrer_json: toJson(entry.referrers) as never,
      device_json: toJson(entry.devices) as never,
    }));

    if (records.length) {
      const { error: upsertError } = await this.db
        .from('analytics_daily')
        .upsert(records, { onConflict: 'day,path' });
      if (upsertError) throw new Error(upsertError.message);
    }

    return { paths: records.length, views: rows.length };
  }

  /** Drops raw rows past the retention window; rollups keep the history. */
  async purgeOldRows(): Promise<number> {
    const cutoff = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000);
    const { data, error } = await this.db
      .from('page_views')
      .delete()
      .lt('occurred_at', cutoff.toISOString())
      .select('id');

    if (error) throw new Error(error.message);
    return (data ?? []).length;
  }
}
