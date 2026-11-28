/** Looks like a phone, email or price — used only as a warning in mixed India–China chats, never to edit the message. */
export function looksSensitive(text: string) {
  const t = text.trim();
  if (!t) return false;
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(t)) return true;
  if (/(?:USD|INR|RMB|CNY|Rs\.?|₹|\$|¥)\s*\d[\d,]*(?:\.\d+)?/i.test(t)) return true;
  if (/\d[\d,]*(?:\.\d+)?\s*(?:USD|INR|RMB|CNY|yuan|rupees?)/i.test(t)) return true;
  if (/(?:\+\d{1,4}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d[\d\s\-()]{6,}\d/.test(t) && /\d{6,}/.test(t.replace(/\D/g, ''))) return true;
  return false;
}
