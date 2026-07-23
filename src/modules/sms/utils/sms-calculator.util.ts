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

// GSM 03.38 basic character set (includes \n, \r, and the ESC 0x1B marker).
const GSM7_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1BÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'.split(''),
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
      actualMessage = actualMessage.replace(new RegExp(`\\{${variable}\\}`, 'g'), value);
    }
    totalCost += getSmsParts(actualMessage);
  }

  return totalCost;
}
