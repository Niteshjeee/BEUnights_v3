// File: src/services/access.js
import { SubjectGate } from '../db/models.js';
import { verifyMembership } from '../wa/membership.js';
import { lookupSubject } from './catalog.js';

export const availableAcademicStates = new Set(['ACTIVE', 'GRADUATED_HOLD']);
export function hasEntitlement(user, code, semester = null) {
  return Boolean(user?.profileLockedAt && user.subjectEntitlements?.some(x =>
    x.code === String(code) && (semester == null || x.semester === Number(semester))));
}
export function canUseBot(user) {
  return Boolean(user && !user.optedOut && user.moderation === 'none'
    && availableAcademicStates.has(user.state) && user.profileLockedAt
    && user.contactConfirmedAt && user.privacyAcceptedAt);
}
export function gateKey(doc) {
  return `${doc.branchCode}:${doc.curriculum}:${doc.subjectCode}:${doc.examYear}:${doc.examType}`;
}
export async function gateOpen(doc, studentCurriculum) {
  const candidates = await SubjectGate.find({ subjectCode: doc.subjectCode,
    branchCode: doc.branchCode, examYear: doc.examYear, examType: doc.examType,
    curriculum: { $in: [...new Set([studentCurriculum, doc.curriculum, 'all'])] } }).lean();
  return candidates.every(x => x.status === 'open');
}
export async function eligibility(user, doc, sock, { checkGroup = true } = {}) {
  if (!canUseBot(user)) return { ok: false, reason: 'PROFILE_LOCKED_OR_RESTRICTED' };
  if (String(doc.branchCode) !== String(user.branchCode)
    || !['all', user.curriculum].includes(doc.curriculum)
    || !hasEntitlement(user, doc.subjectCode)) return { ok: false, reason: 'SUBJECT_NOT_ALLOWED' };
  // Only a student-confirmed code and its original branch/curriculum/semester are valid.
  const valid = user.subjectEntitlements.some(ent => ent.code === doc.subjectCode
    && lookupSubject(user.branchCode, ent.code, user.curriculum, ent.semester));
  if (!valid) return { ok: false, reason: 'SUBJECT_NOT_IN_CATALOG' };
  if (!(await gateOpen(doc, user.curriculum))) return { ok: false, reason: 'PAPER_PENDING_CONTRIBUTION' };
  if (checkGroup) {
    const group = await verifyMembership(sock, user.jid, user.phoneJid ? [user.phoneJid] : []);
    if (group !== 'verified') return { ok: false, reason: group === 'not_member' ? 'JOIN_REQUIRED' : 'VERIFY_UNAVAILABLE' };
  }
  return { ok: true };
}
