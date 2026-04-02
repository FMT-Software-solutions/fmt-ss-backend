export const normalizeGhanaPhoneNumber = (phone: string | null | undefined): string | null => {
  if (!phone) return null;

  // Remove all non-numeric characters (spaces, dashes, brackets, etc.) except +
  let cleaned = phone.replace(/[^\d+]/g, '');

  // Handle various formats for Ghana numbers

  // Case 1: Has +233
  if (cleaned.startsWith('+233')) {
      cleaned = cleaned.substring(1); // Remove the + and keep 233...
  }

  // Case 2: Starts with 0 (e.g., 054..., 024..., 020...)
  if (cleaned.startsWith('0') && cleaned.length === 10) {
      cleaned = '233' + cleaned.substring(1);
  }

  // Validation check: Ghana numbers without + should be exactly 12 digits starting with 233
  if (cleaned.startsWith('233') && cleaned.length === 12) {
      return cleaned;
  }

  return null; // Invalid or non-Ghana number
};
