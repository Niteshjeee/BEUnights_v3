// File: src/services/admin.js
import { createHash } from 'node:crypto';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { User, Pyq, SubjectGate, Submission, PromotionWindow, AdminAudit, Delivery, Restriction } from '../db/models.js';
import { lookupSubject, subjectCandidates } from './catalog.js';
import { saveApprovedPlan, planKey } from './plans.js';
import { parseInternationalPhone, phoneJid } from './phone.js';
import { uploadPdf } from './telegram.js';
import { makeOverviewPdf } from './report.js';
import { resetUser, adminPromote } from './registration.js';
import { approveSubmission, rejectSubmission } from './contributions.js';
import { gateKey } from './access.js';
import { documentMessage, safeFileName } from '../utils/message.js';

const help = `🔐 *BEUnights admin commands*\n\n!groups · !overview · !pending\n!upload CODE YEAR [BRANCH] [CURRICULUM] [TYPE] + PDF\n!plan COLLEGE BRANCH CURRICULUM SEM CORE_CODES [GROUP=CODE|CODE]\n!gate CODE YEAR BRANCH CURRICULUM [TYPE]\n!approve SUBMISSION_ID · !reject SUBMISSION_ID\n!ban [NUMBER] · !hold [NUMBER] · !unban [NUMBER] · !reset [NUMBER] · !status [NUMBER]\n!promote [NUMBER] · !graduate [NUMBER]\n!promotion-open BATCH SEM · !promotion-close BATCH SEM\n!promote-batch BATCH SEM\n!grant-backlog NUMBER SEM CODE\n\nNo number: only in a student's private chat from the linked bot account.\nElse: supply +country-code phone number (spaces allowed).`;
const adminOps = new Set(['!ban', '!hold', '!unban', '!reset', '!status', '!promote', '!graduate']);
function parseUpload(text) {
  const p = text.trim().split(/\s+/);
  if (!/^\d{6}$/.test(p[1] || '')) throw new Error('Subject code must be 6 digits');
  const year = Number(p[2]);
  if (!Number.isInteger(year) || year < 2000 || year > new Date().getFullYear() + 1) throw new Error('Invalid exam year');
  if (p.length > 6) throw new Error('Too many parameters');
  const candidates = subjectCandidates(p[1]);
  const branches = [...new Set(candidates.map(s => s.branchCode))];
  const branch = p[3] || (branches.length === 1 ? branches[0] : null);
  if (!branch) throw new Error('Ambiguous code: specify branch');
  let curriculum = p[4];
  if (!curriculum) {
    const versions = [...new Set(candidates.filter(c => c.branchCode === branch).flatMap(c => c.curricula))];
    if (versions.length !== 1) throw new Error('Specify old, 2024, 2026 or all curriculum');
    curriculum = versions[0];
  }
  if (!['old', '2024', '2026', 'all'].includes(curriculum)) throw new Error('Invalid curriculum');
  const found = lookupSubject(branch, p[1], curriculum === 'all' ? '2024' : curriculum)
    || (curriculum === 'all' ? candidates.find(c => c.branchCode === branch && c.curricula.includes('all')) : null);
  if (!found || (curriculum === 'all' && !found.curricula.includes('all'))) throw new Error('Subject not in chosen branch/curriculum');
  const type = p[5] || 'regular';
  if (!['regular', 'supplementary', 'practical'].includes(type)) throw new Error('Invalid exam type');
  return { subjectCode: p[1], examYear: year, branchCode: branch, curriculum, examType: type, label: found.label };
}
function targetFromContext(context, arg) {
  if (arg.trim()) {
    const digits = parseInternationalPhone(arg);
    if (!digits) throw new Error('Expected international number, e.g. +91 88927 48754');
    return phoneJid(digits);
  }
  // The bot owner typed in a student's 1:1 chat.
  if (context.fromMe && !context.isGroup && !context.selfChat) return context.chatJid;
  throw new Error('Specify the target number, e.g. !ban +918892748754');
}
async function findTarget(jid) {
  return User.findOne({ $or: [{ jid }, { phoneJid: jid }] });
}
async function audit(actor, target, action, detail = '') {
  await AdminAudit.create({ actorJid: actor, targetJid: target, action, detail });
}
async function handleModeration(op, arg, context) {
  const targetJid = targetFromContext(context, arg);
  const user = await findTarget(targetJid);
  if (op === '!status') {
    return user ? `Status: ${user.state}\nBatch: ${user.admissionBatch || '-'}\nCollege/Branch: ${user.collegeCode || '-'} / ${user.branchCode || '-'}\nSemester: ${user.semester || '-'}\nRestriction: ${user.moderation || 'none'}\nContact step: ${user.contactConfirmedAt ? 'Yes' : 'No'}`
      : 'No registered profile found for that number; LID-only profiles may need an explicit trusted phone mapping.';
  }
  if (!user && op === '!unban') {
    const result = await Restriction.deleteOne({ $or: [{ jid: targetJid }, { phoneJid: targetJid }] });
    if (!result.deletedCount) throw new Error('No restriction found for this number');
    await audit(context.actor, targetJid, 'UNBAN');
    return '✅ Restriction cleared. Student may register again.';
  }
  if (!user) throw new Error('Registered student not found. Never guess a WhatsApp LID from a phone number.');
  if (op === '!reset') {
    await resetUser(user.jid);
    await audit(context.actor, user.jid, 'RESET');
    return 'Academic registration reset. Moderation restrictions remain unchanged.';
  }
  if (op === '!hold' || op === '!ban' || op === '!unban') {
    user.moderation = op === '!unban' ? 'none' : op.slice(1);
    await user.save();
    if (op === '!unban') await Restriction.deleteMany({ $or: [{ jid: user.jid }, { phoneJid: user.phoneJid || targetJid }] });
    else await Restriction.findOneAndUpdate({ jid: user.jid }, { $set: {
      status: user.moderation, phoneJid: user.phoneJid || (targetJid.endsWith('@s.whatsapp.net') ? targetJid : undefined),
      updatedBy: context.actor, updatedAt: new Date() } }, { upsert: true });
    if (op !== '!unban') await Delivery.updateMany({ jid: user.jid, status: { $in: ['pending', 'preparing'] } },
      { $set: { status: 'cancelled', errorCode: 'ADMIN_RESTRICTED' } });
    await audit(context.actor, user.jid, op.slice(1).toUpperCase());
    return `${op.slice(1).toUpperCase()} completed. Academic lock was not changed.`;
  }
  if (op === '!promote') {
    await adminPromote(user);
    await audit(context.actor, user.jid, 'PROMOTE_REQUEST', `to semester ${user.pendingSemester}`);
    return `Next semester verification opened for the student (semester ${user.pendingSemester}). They must approve subjects/electives.`;
  }
  if (op === '!graduate') {
    if (user.semester !== 8 || !user.profileLockedAt) throw new Error('Student must have completed confirmed Semester 8');
    user.state = 'GRADUATED_HOLD'; await user.save();
    await audit(context.actor, user.jid, 'GRADUATED_HOLD');
    return 'Graduated hold enabled. Existing eligible/backlog PYQs remain available; moderation bans remain separate.';
  }
  return 'Unknown moderation action';
}
function parsePlan(parts) {
  if (parts.length < 6) throw new Error('Usage: !plan COLLEGE BRANCH CURRICULUM SEM CORE_CSV [NAME=CODE|CODE]');
  const [college, branch, curriculum, semester, cores, ...groups] = parts.slice(1);
  const coreCodes = cores === '-' ? [] : cores.split(',');
  const electiveGroups = groups.map(item => {
    const at = item.indexOf('=');
    if (at <= 0) throw new Error('Group format: PE1=104607|100614 or PE:2=104705|104710');
    const spec = item.slice(0, at).match(/^([A-Za-z0-9_-]+)(?::([1-9][0-9]*))?$/);
    if (!spec) throw new Error('Invalid elective group name/count');
    return { name: spec[1], choose: Number(spec[2] || 1), codes: item.slice(at + 1).split('|') };
  });
  return { college, branch, curriculum, semester, coreCodes, electiveGroups };
}
async function uploadAdminPaper(sock, jid, message, text, actor) {
  const meta = parseUpload(text);
  const document = documentMessage(message);
  if (!document || document.mimetype !== 'application/pdf') throw new Error('Attach a PDF with !upload caption');
  if (Number(document.fileLength || 0) > config.maxPdfBytes) throw new Error('File too large');
  const key = { branchCode: meta.branchCode, subjectCode: meta.subjectCode,
    curriculum: meta.curriculum, examYear: meta.examYear, examType: meta.examType };
  if (await Pyq.exists(key)) throw new Error('Paper already indexed for this subject/year/type');
  const buffer = await downloadMediaMessage(message, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
  if (buffer.length > config.maxPdfBytes || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('Invalid PDF');
  const hash = createHash('sha256').update(buffer).digest('hex');
  const filename = safeFileName(document.fileName || `${meta.subjectCode}_${meta.examYear}.pdf`);
  const tg = await uploadPdf(buffer, filename);
  await Pyq.create({ ...meta, filename, sha256: hash, bytes: buffer.length,
    telegramFileId: tg.fileId, telegramMessageId: tg.messageId, uploadedBy: actor });
  await SubjectGate.findOneAndUpdate({ key: gateKey(meta) }, {
    $set: { ...key, status: 'open', updatedBy: actor } }, { upsert: true });
  await audit(actor, jid, 'ADMIN_UPLOAD', gateKey(meta));
  return `✅ Approved paper indexed: ${meta.subjectCode} / ${meta.examYear} / ${meta.examType} / branch ${meta.branchCode}. Only this subject/year/type was released.`;
}
export async function handleAdmin(sock, chatJid, message, text, context = {}) {
  const parts = text.trim().split(/\s+/);
  const cmd = (parts[0] || '').toLowerCase();
  const actor = context.actor || chatJid;
  const ctx = { ...context, chatJid, actor };
  if (!cmd.startsWith('!')) return false;
  const respondJid = context.isGroup ? (context.fromMe ? context.selfJid : actor)
    : (context.fromMe && !context.selfChat ? context.selfJid : chatJid);
  const reply = async (out) => sock.sendMessage(respondJid, { text: out });
  try {
    if (cmd === '!helpadmin') { await reply(help); return true; }
    if (cmd === '!groups') {
      const groups = await sock.groupFetchAllParticipating();
      const list = Object.values(groups).slice(0, 60).map((g, i) => `${i + 1}. ${g.subject}: ${g.id}`);
      await reply(`🎓 *BEUnights | Groups*\n\n${list.join('\n') || 'No groups accessible.'}`); return true;
    }
    if (cmd === '!overview') {
      const pdf = await makeOverviewPdf();
      await sock.sendMessage(respondJid, { document: pdf, mimetype: 'application/pdf', fileName: 'BEUnights_Overview.pdf' });
      return true;
    }
    if (adminOps.has(cmd)) { await reply(await handleModeration(cmd, text.slice(parts[0].length).trim(), ctx)); return true; }
    if (cmd === '!plan') {
      const plan = parsePlan(parts);
      const saved = await saveApprovedPlan({ ...plan, actor });
      await audit(actor, '', 'PLAN_APPROVED', saved.key);
      await reply(`✅ Academic plan approved: ${saved.key} (version ${saved.version})\n${saved.coreCodes.length} core subjects + ${saved.electiveGroups.length} elective group(s).`);
      return true;
    }
    if (cmd === '!gate') {
      if (!/^\d{6}$/.test(parts[1] || '') || !/^20\d\d$/.test(parts[2] || '')) throw new Error('Usage !gate CODE YEAR BRANCH CURRICULUM [TYPE]');
      const [subjectCode, year, branchCode, curriculum, examType = 'regular'] = parts.slice(1);
      if (!['old', '2024', '2026', 'all'].includes(curriculum) || !['regular', 'supplementary', 'practical'].includes(examType)) throw new Error('Invalid type or curriculum');
      if (!lookupSubject(branchCode, subjectCode, curriculum === 'all' ? '2024' : curriculum)) throw new Error('Unrecognized branch subject');
      if (Number(year) > new Date().getFullYear()) throw new Error('Cannot gate future exam years');
      const doc = { subjectCode, examYear: Number(year), branchCode, curriculum, examType };
      const key = gateKey(doc);
      if (await Pyq.exists(doc)) throw new Error('A document already exists; do not lock published past papers');
      await SubjectGate.findOneAndUpdate({ key }, { $set: { ...doc, status: 'pending', updatedBy: actor } }, { upsert: true });
      await audit(actor, '', 'GATE_PENDING', key);
      await reply(`🔒 Contribution gate enabled only for ${key}. One approved PDF unlocks this subject only.`);
      return true;
    }
    if (cmd === '!pending') {
      const pending = await Submission.find({ status: 'pending' }).sort({ createdAt: 1 }).limit(15).lean();
      await reply(`📤 *Pending papers*\n\n${pending.map(s => `${s._id} — ${s.subjectCode}/${s.examYear}/${s.examType}`).join('\n') || 'None'}`);
      return true;
    }
    if (cmd === '!approve' || cmd === '!reject') {
      if (!parts[1]) throw new Error('Submission ID required');
      const result = cmd === '!approve' ? await approveSubmission(parts[1], actor) : await rejectSubmission(parts[1], actor);
      await reply(`${cmd === '!approve' ? '✅ Approved & subject unlocked' : '❌ Rejected'}: ${result.subjectCode} ${result.examYear} (submission ${result._id})`);
      return true;
    }
    if (cmd === '!promotion-open' || cmd === '!promotion-close') {
      const batch = Number(parts[1]), sem = Number(parts[2]);
      if (!Number.isInteger(batch) || !Number.isInteger(sem) || sem < 1 || sem >= 8) throw new Error('Usage: !promotion-open BATCH SEM (1–7)');
      const key = `${batch}:${sem}`, open = cmd === '!promotion-open';
      await PromotionWindow.findOneAndUpdate({ key }, { $set: { admissionBatch: batch, fromSemester: sem, open, updatedBy: actor } }, { upsert: true });
      await audit(actor, '', open ? 'PROMOTION_OPEN' : 'PROMOTION_CLOSE', key);
      await reply(`✅ Semester ${sem}→${sem + 1} window ${open ? 'opened' : 'closed'} for batch ${batch}.`); return true;
    }
    if (cmd === '!promote-batch') {
      const batch = Number(parts[1]), sem = Number(parts[2]);
      if (!Number.isInteger(batch) || !Number.isInteger(sem) || sem < 1 || sem >= 8) throw new Error('Usage: !promote-batch BATCH SEM');
      // No unsolicited notifications; students see updated state on their next incoming message.
      const users = await User.find({ admissionBatch: batch, semester: sem,
        state: 'ACTIVE', moderation: 'none', optedOut: false, profileLockedAt: { $exists: true } }).limit(500);
      let updated = 0;
      for (const user of users) { await adminPromote(user); updated++; }
      await audit(actor, '', 'BULK_PROMOTION', `${batch}:${sem}:${updated}`);
      await reply(`✅ ${updated} profile(s) queued for semester ${sem + 1} academic verification. Additional accounts (if over 500) require a second batch operation.`); return true;
    }
    if (cmd === '!grant-backlog') {
      if (parts.length < 4) throw new Error('Usage: !grant-backlog +COUNTRY_NUMBER SEM CODE');
      const code = parts.at(-1), sem = Number(parts.at(-2));
      const target = phoneJid(parts.slice(1, -2).join(' '));
      if (!target || !/^[1-8]$/.test(String(sem)) || !/^\d{6}$/.test(code)) throw new Error('Invalid target, semester or code');
      const user = await findTarget(target);
      if (!user || !user.profileLockedAt || sem > user.semester) throw new Error('Student missing or semester not eligible');
      const subject = lookupSubject(user.branchCode, code, user.curriculum, sem);
      if (!subject) throw new Error('Subject not valid for registered branch/curriculum');
      // Explicit audited admin exception for an old backlog subject that is
      // valid in this student's locked branch/curriculum/semester.
      if (!user.subjectEntitlements.some(x => x.code === code && x.semester === sem)) {
        user.subjectEntitlements.push({ code, label: subject.label, semester: sem,
          type: 'self_reported', planVersion: 1 });
        await user.save();
      }
      await audit(actor, user.jid, 'BACKLOG_GRANT', `${sem}:${code}`);
      await reply(`✅ Backlog entitlement added for semester ${sem}: ${code}. Moderation and group restrictions still apply.`); return true;
    }
    if (cmd === '!upload') { await reply(await uploadAdminPaper(sock, chatJid, message, text, actor)); return true; }
    await reply('Unknown admin command. Send !helpadmin.'); return true;
  } catch (error) {
    logger.warn({ command: cmd, reason: error.message }, 'Admin operation unsuccessful');
    await reply(`⚠️ ${error.message}`).catch(() => {});
    return true;
  }
}
