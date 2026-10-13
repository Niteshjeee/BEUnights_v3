// File: src/services/phone.js
// This is a strict format parser, not a full international numbering plan validator.
export function parseInternationalPhone(value) {
  const raw = String(value ?? '').trim();
  if (!/^\+?[\d ()-]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, '');
  // A bare 10-digit national number is ambiguous: require +CC or a supplied country prefix.
  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null;
  if (!raw.startsWith('+') && digits.length < 11) return null;
  return digits;
}
export function phoneJid(number) {
  const parsed = parseInternationalPhone(number);
  return parsed ? `${parsed}@s.whatsapp.net` : null;
}
