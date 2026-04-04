export function getSmsParts(text: string): number {
  if (!text) return 0;
  // Standard GSM-7 encoding calculation
  // 1 part = 160 chars. Multipart = 153 chars per part.
  if (text.length <= 160) {
    return 1;
  }
  return Math.ceil(text.length / 153);
}

export function calculateTotalSmsCost(
  message: string,
  recipients: any[],
  isTemplate: boolean
): number {
  if (!recipients || recipients.length === 0) return 0;

  if (!isTemplate) {
    const parts = getSmsParts(message);
    return parts * recipients.length;
  }

  let totalCost = 0;
  // Extract all unique variables e.g. {first_name}
  const expectedVariables = [...new Set([...message.matchAll(/\{([^}]+)\}/g)].map(match => match[1]))];

  for (const recipient of recipients) {
    let actualMessage = message;
    for (const variable of expectedVariables) {
      const value = recipient[variable] !== undefined && recipient[variable] !== null ? String(recipient[variable]) : '';
      // Replace all occurrences of the variable
      actualMessage = actualMessage.replace(new RegExp(`\\{${variable}\\}`, 'g'), value);
    }
    totalCost += getSmsParts(actualMessage);
  }

  return totalCost;
}