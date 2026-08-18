import { createHash, randomBytes } from 'crypto';
import type { Request } from 'express';

/**
 * Country resolution, cheapest source first.
 *
 * Every major CDN puts the visitor's country in a header, which is free and
 * accurate. A local database (geoip-lite) is only needed when the API is not
 * behind one — it is loaded lazily and treated as optional, because the
 * package carries a ~110MB dataset that most deployments do not need.
 * Install it with `npm i geoip-lite` and this starts working automatically.
 */
const GEO_HEADERS = [
  'cf-ipcountry', // Cloudflare
  'x-vercel-ip-country', // Vercel
  'x-nf-client-country', // Netlify
  'x-country-code',
  'x-appengine-country', // Google
  'cloudfront-viewer-country', // AWS
];

const REGION_HEADERS = [
  'x-vercel-ip-country-region',
  'cloudfront-viewer-country-region',
  'x-appengine-region',
];

let geoLookup: ((ip: string) => { country?: string; region?: string } | null) | null | undefined;

function getGeoLookup() {
  if (geoLookup !== undefined) return geoLookup;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const geoip = require('geoip-lite');
    geoLookup = (ip: string) => geoip.lookup(ip);
  } catch {
    geoLookup = null;
  }
  return geoLookup;
}

export function resolveClientIp(request: Request): string | null {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    // Left-most entry is the original client.
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length) {
    return forwarded[0].split(',')[0].trim();
  }
  return request.ip ?? request.socket?.remoteAddress ?? null;
}

export function resolveGeo(request: Request, ip: string | null) {
  for (const header of GEO_HEADERS) {
    const value = request.headers[header];
    const country = Array.isArray(value) ? value[0] : value;
    if (country && country.length === 2 && country !== 'XX') {
      const regionHeader = REGION_HEADERS.map((name) => request.headers[name]).find(Boolean);
      const region = Array.isArray(regionHeader) ? regionHeader[0] : regionHeader;
      return { country: country.toUpperCase(), region: region ?? null };
    }
  }

  const lookup = getGeoLookup();
  if (lookup && ip) {
    const result = lookup(ip);
    if (result?.country) {
      return { country: result.country.toUpperCase(), region: result.region ?? null };
    }
  }

  return { country: null, region: null };
}

/**
 * The salt rotates daily and lives only in memory, so a visitor is countable
 * within a day but the hash cannot be linked across days or reversed to an IP.
 */
let saltDay = '';
let dailySalt = '';

function currentSalt(): string {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== saltDay) {
    saltDay = today;
    dailySalt = randomBytes(32).toString('hex');
  }
  return dailySalt;
}

export function hashVisitor(ip: string | null, userAgent: string | null): string | null {
  if (!ip) return null;
  return createHash('sha256')
    .update(`${currentSalt()}:${ip}:${userAgent ?? ''}`)
    .digest('hex');
}

const BOT_PATTERN =
  /bot|crawler|spider|crawling|slurp|facebookexternalhit|whatsapp|telegram|preview|lighthouse|pingdom|uptime|headless|curl|wget|python-requests|axios|postman/i;

export function isBot(userAgent: string | null): boolean {
  return !userAgent || BOT_PATTERN.test(userAgent);
}

/**
 * Deliberately coarse. Enough to answer "mobile or desktop, which browser",
 * without shipping a full UA-parsing dependency.
 */
export function classifyUserAgent(userAgent: string | null) {
  if (!userAgent) return { device: null, browser: null, os: null };
  const ua = userAgent.toLowerCase();

  const device = /ipad|tablet|playbook|silk/.test(ua)
    ? 'tablet'
    : /mobi|iphone|ipod|android.*mobile|windows phone/.test(ua)
      ? 'mobile'
      : 'desktop';

  const browser = /edg\//.test(ua)
    ? 'Edge'
    : /opr\/|opera/.test(ua)
      ? 'Opera'
      : /samsungbrowser/.test(ua)
        ? 'Samsung Internet'
        : /chrome|crios/.test(ua)
          ? 'Chrome'
          : /firefox|fxios/.test(ua)
            ? 'Firefox'
            : /safari/.test(ua)
              ? 'Safari'
              : 'Other';

  const os = /windows/.test(ua)
    ? 'Windows'
    : /android/.test(ua)
      ? 'Android'
      : /iphone|ipad|ipod|ios/.test(ua)
        ? 'iOS'
        : /mac os x|macintosh/.test(ua)
          ? 'macOS'
          : /linux/.test(ua)
            ? 'Linux'
            : 'Other';

  return { device, browser, os };
}

/** Only same-site relative paths are recorded, normalised and length-capped. */
export function normalisePath(path: string): string | null {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return null;
  const withoutQuery = path.split('?')[0].split('#')[0];
  const trimmed =
    withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, '') || '/' : withoutQuery;
  return trimmed.slice(0, 300);
}

export function referrerHost(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).host || null;
  } catch {
    return null;
  }
}
