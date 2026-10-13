// File: src/services/contributions.js
import { createHash } from 'node:crypto';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { config } from '../config.js';
import { Pyq, Submission, SubjectGate, AdminAudit } from '../db/models.js';
import { hasEntitlement, canUseBot, gateKey } from './access.js';
import { lookupSubject } from './catalog.js';
import { documentMessage, safeFileName } from '../utils/message.js';
import { uploadPdf } from './telegram.js';
import { logger } from '../logger.js';
import { verifyMembership } from '../wa/membership.js';

const types = new Set(['regular', 'supplementary', 'practical']);
export function parsePaperArgs(parts, start = 1) {
  const subjectCode = parts[start]; const examYear = Number(parts[start + 1]);
  const examType = (parts[start + 2] ?? 'regular').toLowerCase();
  if (!/^\d{6}$/.test(subjectCode ?? '') || !Number.isInteger(examYear)
    || examYear < 2000 || examYear > new Date().getFullYear() || !types.has(examType))
    throw new Error('Use !submit SUBJECT_CODE YEAR [regular|supplementary|practical]');
  return { subjectCode, examYear, examType };
}
export async function submitPaper(sock, jid, user, message, parts) {
  if (!canUseBot(user) || !hasEntitlement(user, parts[1])) throw new Error('Only registered students may contribute papers belonging to their locked subjects.');
  if (await verifyMembership(sock, jid) !== 'verified') throw new Error('Group verification required.');
  const args = parsePaperArgs(parts);
  const valid = user.subjectEntitlements.find(s => s.code === args.subjectCode);
  const subject = lookupSubject(user.branchCode, args.subjectCode, user.curriculum, valid.semester);
  if (!subject) throw new Error('Subject not in your approved academic catalog.');
  const doc = documentMessage(message);
  if (!doc || doc.mimetype !== 'application/pdf') throw new Error('Attach a PDF with !submit caption.');
  if (Number(doc.fileLength || 0) > config.maxPdfBytes) throw new Error('PDF exceeds configured limit');
  const buffer = await downloadMediaMessage(message, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
  if (buffer.length > config.maxPdfBytes || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('Invalid PDF');
  const hash = createHash('sha256').update(buffer).digest('hex');
  if (await Submission.exists({ sha256: hash, status: { $in: ['pending', 'approved'] } }))
    throw new Error('This document was already submitted.');
  const filename = safeFileName(doc.fileName || `${args.subjectCode}_${args.examYear}.pdf`);
  const tg = await uploadPdf(buffer, filename);
  const submission = await Submission.create({ submitterJid: jid, branchCode: user.branchCode,
    subjectCode: args.subjectCode, curriculum: user.curriculum, examYear: args.examYear,
    examType: args.examType, label: subject.label, filename,
    sha256: hash, bytes: buffer.length, telegramFileId: tg.fileId, telegramMessageId: tg.messageId });
  await sock.sendMessage(jid, { text: `📤 Paper received for review.\n${args.subjectCode} — ${args.examYear}\nSubmission ID: ${submission._id}\n\nOnly admin approval will release this exact subject/year/type to other eligible students.` });
}
export async function approveSubmission(id, actor) {
  if (!/^[\da-fA-F]{24}$/.test(id)) throw new Error('Invalid submission ID');
  const submitted = await Submission.findById(id);
  if (!submitted || submitted.status !== 'pending') throw new Error('Submission missing or already reviewed');
  const key = gateKey(submitted);
  const docKey = { branchCode: submitted.branchCode, curriculum: submitted.curriculum,
    subjectCode: submitted.subjectCode, examYear: submitted.examYear, examType: submitted.examType };
  if (await Pyq.exists(docKey)) throw new Error('A PYQ already exists for this subject/year/type; review duplicates manually');
  await Pyq.create({ ...docKey, label: submitted.label, filename: submitted.filename,
    telegramFileId: submitted.telegramFileId, telegramMessageId: submitted.telegramMessageId,
    sha256: submitted.sha256, bytes: submitted.bytes, uploadedBy: submitted.submitterJid });
  submitted.status = 'approved'; submitted.reviewedBy = actor; submitted.reviewedAt = new Date();
  await submitted.save();
  await SubjectGate.findOneAndUpdate({ key }, { $set: { ...docKey, status: 'open', updatedBy: actor } }, { upsert: true });
  await AdminAudit.create({ actorJid: actor, targetJid: submitted.submitterJid,
    action: 'APPROVE_PYQ', detail: key });
  return submitted;
}
export async function rejectSubmission(id, actor) {
  if (!/^[\da-fA-F]{24}$/.test(id)) throw new Error('Invalid submission ID');
  const s = await Submission.findById(id);
  if (!s || s.status !== 'pending') throw new Error('Pending submission not found');
  s.status = 'rejected'; s.reviewedBy = actor; s.reviewedAt = new Date(); await s.save();
  await AdminAudit.create({ actorJid: actor, targetJid: s.submitterJid, action: 'REJECT_PYQ', detail: id });
  return s;
}
