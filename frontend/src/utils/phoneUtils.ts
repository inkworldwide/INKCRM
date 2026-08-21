/**
 * Utility helper to mask phone numbers for UI display while preserving call/chat functionality.
 */
export function maskPhoneNumber(phone?: string | number | null): string {
  if (phone === undefined || phone === null) return 'N/A';
  const str = String(phone).trim();
  if (!str || str === 'N/A' || str === 'undefined' || str === 'null') return 'N/A';
  return 'XXXXXXXXXX';
}
