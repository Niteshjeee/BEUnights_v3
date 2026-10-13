// File: src/wa/identity.js
// Do not infer that @lid numeric identifiers equal telephone numbers.
export function normalizedJid(jid) {
  if (typeof jid !== 'string') return null;
  const clean = jid.trim().toLowerCase().replace(/:\d+(?=@)/, '');
  return /^\d+@(s\.whatsapp\.net|lid)$/.test(clean) ? clean : null;
}
export function isPrivateStudentJid(jid) { return Boolean(normalizedJid(jid)); }
export function isAdmin(jid, adminJids) {
  const normalized = normalizedJid(jid);
  return normalized?.endsWith('@s.whatsapp.net') && adminJids.has(normalized);
}
