// File: src/wa/membership.js
import { config } from '../config.js';
import { normalizedJid } from './identity.js';

// Exact trusted participant matching; do not infer PN from LID digits.
export async function verifyMembership(sock, requesterJid, trustedAlternates = []) {
  const ids = [requesterJid, ...trustedAlternates].map(normalizedJid).filter(Boolean);
  if (!ids.length || !sock) return 'unavailable';
  try {
    const metadata = await sock.groupMetadata(config.groupJid);
    if (metadata.id !== config.groupJid || !Array.isArray(metadata.participants)) return 'unavailable';
    const roster = metadata.participants.flatMap(p =>
      [p.id, p.lid, p.phoneNumber, p.phoneNumberJid].map(normalizedJid).filter(Boolean));
    if (ids.some(id => roster.includes(id))) return 'verified';
    const domains = new Set(roster.map(id => id.split('@')[1]));
    if (!ids.some(id => domains.has(id.split('@')[1]))) return 'unavailable';
    // A mixed PN/LID roster can omit alternate identifiers; do not falsely deny.
    if (domains.size !== 1) return 'unavailable';
    return 'not_member';
  } catch { return 'unavailable'; }
}
