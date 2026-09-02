/**
 * Utility helper to mask phone numbers for UI display while preserving call/chat functionality.
 */
export function maskPhoneNumber(phone?: string | number | null): string {
  if (phone === undefined || phone === null) return 'N/A';
  const str = String(phone).trim();
  if (!str || str === 'N/A' || str === 'undefined' || str === 'null') return 'N/A';
  return 'XXXXXXXXXX';
}

/**
 * Safe Phone Dialer trigger that uses a dynamic invisible anchor tag
 * instead of mutating window.location.href directly.
 * Preventing main window location mutation stops Chrome/Edge from triggering a page unload,
 * keeping React state and active campaign views 100% stable for all users.
 */
export function triggerPhoneCall(phone?: string | number | null): void {
  if (!phone) return;
  const cleanPhone = String(phone).replace(/[^\d+]/g, '').trim();
  if (!cleanPhone) return;

  const link = document.createElement('a');
  link.href = `tel:${cleanPhone}`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  setTimeout(() => {
    if (document.body.contains(link)) {
      document.body.removeChild(link);
    }
  }, 500);
}

/**
 * Safe WhatsApp Chat trigger opening in a new tab without interrupting page flow.
 */
export function openWhatsAppChat(phone?: string | number | null): void {
  if (!phone) return;
  let cleanPhone = String(phone).replace(/\D/g, '').trim();
  if (!cleanPhone) return;

  if (cleanPhone.length === 10) {
    cleanPhone = `91${cleanPhone}`;
  }

  const link = document.createElement('a');
  link.href = `https://wa.me/${cleanPhone}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  setTimeout(() => {
    if (document.body.contains(link)) {
      document.body.removeChild(link);
    }
  }, 500);
}
