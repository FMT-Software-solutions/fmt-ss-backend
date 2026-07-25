/**
 * SMS segment / credit calculation.
 *
 * Industry-standard GSM-03.38 segmentation:
 *   - GSM-7 message:   ≤160 chars = 1 part, else 153 chars/segment (UDH header).
 *   - Unicode (UCS-2): ≤70  units = 1 part, else 67  units/segment.
 *   - GSM-7 "extended" chars (^ { } \ [ ~ ] | €) occupy TWO GSM-7 slots.
 *
 * This is the authoritative calculation; the frontend mirrors it
 * (print-calc-pro: src/shared-packages/communication/utils/sms-cost.ts).
 */

// Typographic Unicode → GSM-7-safe ASCII. These characters have identical-
// looking ASCII twins but are NOT in GSM-03.38, so a single one of them forces
// the WHOLE message into UCS-2 (70 chars/segment instead of 160) — tripling the
// credit cost for no visible difference. The usual culprits sneak in from
// copy-pasted text, word processors, and Intl.DateTimeFormat (which puts a
// narrow no-break space before AM/PM). We only remap look-alikes with a safe
// twin; genuine non-Latin content is left alone so it still sends as Unicode.
//
// Built from numeric code points ([replacement, ...codePoints]) on purpose:
// several of these (the various spaces) are visually indistinguishable, so
// literal-character object keys silently collapse into duplicates in source.
const GSM7_TRANSLITERATION_GROUPS: Array<[string, number[]]> = [
  ['-', [0x2013, 0x2014, 0x2015, 0x2011, 0x2212, 0x2022, 0x00b7, 0x2027]], // dashes, bullet, middle/hyphenation dots
  ["'", [0x2018, 0x2019, 0x201a, 0x201b, 0x2032]], // single curly quotes, prime
  ['"', [0x201c, 0x201d, 0x201e, 0x2033]], // double curly quotes, double prime
  ['...', [0x2026]], // horizontal ellipsis
  ['x', [0x00d7]], // multiplication sign
  [
    ' ',
    [
      0x00a0, 0x202f, 0x2007, 0x2009, 0x200a, 0x2002, 0x2003, 0x2004, 0x2005,
      0x2006, 0x2008, 0x205f, 0x3000,
    ],
  ], // no-break / typographic spaces
  ['', [0x200b, 0xfeff, 0x200c, 0x200d]], // zero-width spaces / BOM / joiners
];

const GSM7_TRANSLITERATIONS = new Map<string, string>();
for (const [replacement, codePoints] of GSM7_TRANSLITERATION_GROUPS) {
  for (const cp of codePoints)
    GSM7_TRANSLITERATIONS.set(String.fromCodePoint(cp), replacement);
}

/**
 * Replaces GSM-7 look-alike characters with their ASCII twins so a message
 * stays in the 160-char (1-credit) GSM-7 encoding instead of silently
 * upgrading to 70-char UCS-2. Idempotent. Apply before both counting and
 * sending so the deducted cost matches the text that actually goes out.
 */
export function normalizeGsm7(text: string): string {
  if (!text) return text;
  let out = '';
  for (const ch of text) out += GSM7_TRANSLITERATIONS.get(ch) ?? ch;
  return out;
}

// GSM 03.38 basic character set (includes \n, \r, and the ESC 0x1B marker).
const GSM7_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1BÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'.split(
    '',
  ),
);
// Chars that require an escape (count as two GSM-7 slots).
const GSM7_EXTENDED = new Set('^{}\\[~]|€'.split(''));

function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!GSM7_BASIC.has(ch) && !GSM7_EXTENDED.has(ch)) return false;
  }
  return true;
}

/** Effective GSM-7 length (extended chars count double). */
function gsm7Length(text: string): number {
  let len = 0;
  for (const ch of text) len += GSM7_EXTENDED.has(ch) ? 2 : 1;
  return len;
}

export function getSmsParts(text: string): number {
  if (!text) return 0;

  // Count the text as it will actually be sent (see sendSms, which normalizes
  // the outbound message the same way) so the estimate can't over-count a
  // message that normalization would keep in GSM-7.
  text = normalizeGsm7(text);

  if (isGsm7(text)) {
    const len = gsm7Length(text);
    if (len <= 160) return 1;
    return Math.ceil(len / 153);
  }

  // Unicode / UCS-2 — count UTF-16 code units (surrogate pairs = 2 units).
  const len = text.length;
  if (len <= 70) return 1;
  return Math.ceil(len / 67);
}

export function calculateTotalSmsCost(
  message: string,
  recipients: any[],
  isTemplate: boolean,
): number {
  if (!recipients || recipients.length === 0) return 0;

  if (!isTemplate) {
    const parts = getSmsParts(message);
    return parts * recipients.length;
  }

  let totalCost = 0;
  // Extract all unique variables e.g. {first_name}
  const expectedVariables = [
    ...new Set([...message.matchAll(/\{([^}]+)\}/g)].map((match) => match[1])),
  ];

  for (const recipient of recipients) {
    let actualMessage = message;
    for (const variable of expectedVariables) {
      const value =
        recipient[variable] !== undefined && recipient[variable] !== null
          ? String(recipient[variable])
          : '';
      actualMessage = actualMessage.replace(
        new RegExp(`\\{${variable}\\}`, 'g'),
        value,
      );
    }
    totalCost += getSmsParts(actualMessage);
  }

  return totalCost;
}
