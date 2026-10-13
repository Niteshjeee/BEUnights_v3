// File: src/services/student.js
import { config } from '../config.js';
import { Pyq, Activity, SubjectGate } from '../db/models.js';
import { newUser, resetUser, registrationStep, recordMembership, registerContact, requestPromotion, privacyNotice } from './registration.js';
import { lookupSubject } from './catalog.js';
import { canUseBot, hasEntitlement, eligibility } from './access.js';
import { enqueueDocuments } from './delivery.js';
import { contactNumbers, documentMessage } from '../utils/message.js';
import { submitPaper } from './contributions.js';

const help = `🎓 *BEUnights | Help*\n\nHI — Registration/help\nVERIFY — Recheck official group membership\nSUBJECT_CODE — Request your approved PYQs\nPROMOTE — Request next semester after admin opens promotion\nSUBJECTS — View your locked subjects\n!submit CODE YEAR [TYPE] — Share a paper for admin review (attach PDF)\nPRIVACY — Read privacy notice\nSTOP — Opt out\nDELETE — Delete profile and personal activity\n\n🔐 !reset, !ban, !hold, !unban and other admin commands are admin-only.`;
const reply = (sock, jid, text) => sock.sendMessage(jid, { text });
async function queueSelection(sock, jid, user, inboundId, docs) {
  const eligible = [];
  let blocked = null;
  for (const doc of docs) {
    const verdict = await eligibility(user, doc, sock);
    if (verdict.ok) eligible.push(doc);
    else blocked = verdict.reason;
  }
  if (!eligible.length) return reply(sock, jid,
    blocked === 'PAPER_PENDING_CONTRIBUTION' ? '🔒 This subject/year exam campaign is waiting for a verified question-paper contribution. If you have the paper, send it as PDF with caption: !submit CODE YEAR. Admin approval releases only this subject.'
      : blocked === 'JOIN_REQUIRED' ? `🔒 Join BEUPYQ and reply VERIFY:\n${config.groupInvite}`
      : blocked === 'VERIFY_UNAVAILABLE' ? 'Membership verification temporarily unavailable; please try later.'
      : blocked === 'SUBJECT_NOT_ALLOWED' ? 'That subject is not part of your locked academic profile.'
      : 'No eligible papers can be sent right now.');
  const limited = eligible.sort((a, b) => b.examYear - a.examYear).slice(0, config.maxFilesPerRequest);
  const queued = await enqueueDocuments(jid, inboundId, limited);
  if (queued) await Activity.create({ jid, action: 'requested', subjectCode: limited[0].subjectCode }).catch(() => {});
  return reply(sock, jid, queued ? `✅ ${queued} eligible PDF(s) queued. Please wait for delivery.` : 'This request was already processed.');
}
async function requestCode(sock, jid, user, rawCode, incomingId) {
  const practical = rawCode.endsWith('P');
  const code = rawCode.slice(0, 6);
  const ent = user.subjectEntitlements.find(x => x.code === code);
  if (!ent || !hasEntitlement(user, code)) return reply(sock, jid, '🔒 Only subjects confirmed for your registered college, branch and academic profile are available.');
  const subject = lookupSubject(user.branchCode, code, user.curriculum, ent.semester);
  if (!subject) return reply(sock, jid, 'Subject not verified in your curriculum. Contact an admin.');
  const docs = await Pyq.find({ branchCode: user.branchCode, subjectCode: code,
    curriculum: { $in: [user.curriculum, 'all'] },
    ...(practical ? { examType: 'practical' } : { examType: { $ne: 'practical' } }) }).lean();
  const gates = await SubjectGate.find({ branchCode: user.branchCode, subjectCode: code,
    curriculum: { $in: [user.curriculum, 'all'] }, status: 'pending' }).lean();
  const pending = gates.map(g => `${g.examYear} (${g.examType})`).join(', ');
  if (!docs.length) return reply(sock, jid, `📚 ${code} — ${subject.label}\n\n${pending ? `🔒 Awaiting one approved paper for: ${pending}.` : 'No papers indexed yet.'}\nIf you have the paper, attach it with caption: !submit ${code} YEAR`);
  if (docs.length === 1) return queueSelection(sock, jid, user, incomingId, docs);
  user.pendingSubjectCode = rawCode; user.pendingSubjectAt = new Date(); await user.save();
  const years = [...new Set(docs.map(d => d.examYear))].sort((a, b) => b - a);
  return reply(sock, jid, `🎓 *${code} — ${subject.label}*\n\nAvailable years: ${years.join(', ')}${pending ? `\n🔒 Latest papers awaiting contributions: ${pending}` : ''}\n\nReply with a year, or ALL (maximum ${config.maxFilesPerRequest} PDFs).`);
}
export async function handleStudent(sock, jid, incoming, text) {
  const input = String(text || '').trim(); const upper = input.toUpperCase();
  // Stop and delete remain accessible even if a student is held or banned.
  if (upper === 'DELETE') {
    await resetUser(jid, { fullDelete: true });
    return reply(sock, jid, 'Your academic registration and personal activity records were deleted. A minimal WhatsApp identifier is retained to prevent immediate registration-lock bypass; contact admin for re-registration review. Already-sending media cannot be recalled.');
  }
  let user = await newUser(jid);
  if (upper === 'STOP') {
    user.resumeState = user.state; user.optedOut = true; user.state = 'OPTED_OUT'; await user.save();
    return reply(sock, jid, 'Automated messages stopped. Send START to begin again later.');
  }
  if (user.optedOut || user.state === 'OPTED_OUT') {
    if (upper !== 'START') return;
    user.optedOut = false;
    const next = user.resumeState || 'START_PENDING';
    user.state = user.profileLockedAt && user.contactConfirmedAt
      ? (next === 'GRADUATED_HOLD' ? 'GRADUATED_HOLD' : 'ACTIVE')
      : (['START_PENDING', 'BATCH_PENDING', 'COLLEGE_PENDING', 'BRANCH_PENDING',
          'SEMESTER_PENDING', 'SUBJECTS_MISSING', 'SUBJECT_PICK_PENDING', 'PLAN_PENDING', 'ELECTIVE_PENDING',
          'SUBJECT_CONFIRM_PENDING', 'GROUP_PENDING', 'VERIFY_PENDING', 'CONTACT_PENDING'].includes(next)
        ? next : 'START_PENDING');
    user.resumeState = undefined; await user.save();
    return ['ACTIVE', 'GRADUATED_HOLD'].includes(user.state)
      ? reply(sock, jid, '✅ Messaging enabled again. Your locked academic profile is unchanged.')
      : registrationStep(sock, jid, user, 'HI');
  }
  if (upper === 'PRIVACY') return reply(sock, jid, privacyNotice);
  if (upper === 'HELP') return reply(sock, jid, help);
  if (user.moderation !== 'none') return reply(sock, jid, '⛔ BEUnights account access is restricted. Contact the admin for a review.');
  if (upper.startsWith('!') && !upper.startsWith('!SUBMIT'))
    return reply(sock, jid, 'This is an admin-only command or unsupported input. Send HELP for student commands.');
  if (user.state === 'CONTACT_PENDING' && contactNumbers(incoming).length)
    return registerContact(sock, jid, user, incoming);
  if (!['ACTIVE', 'GRADUATED_HOLD'].includes(user.state))
    return registrationStep(sock, jid, user, input);
  if (upper === 'VERIFY') {
    const status = await recordMembership(user, sock, jid);
    return reply(sock, jid, status === 'verified' ? '✅ BEUPYQ membership verified.'
      : status === 'not_member' ? `Join BEUPYQ:\n${config.groupInvite}` : 'Could not verify membership; retry later.');
  }
  if (upper === 'PROMOTE') return requestPromotion(sock, jid, user);
  if (upper === 'SUBJECTS') {
    const lines = [...user.subjectEntitlements].sort((a, b) => a.semester - b.semester)
      .map(s => `Sem ${s.semester}: ${s.code} — ${s.label}${s.type === 'elective' ? ' [Elective]' : s.type === 'self_reported' ? ' [Student selected]' : ''}`);
    return reply(sock, jid, `🎓 *Your locked subjects*\n\n${lines.join('\n') || 'No subjects recorded.'}`);
  }
  if (upper.startsWith('!SUBMIT')) {
    try { return await submitPaper(sock, jid, user, incoming, input.split(/\s+/)); }
    catch (error) { return reply(sock, jid, `Submission not completed: ${error.message}`); }
  }
  if (!canUseBot(user)) return reply(sock, jid, 'Complete academic and contact verification first.');
  if (user.pendingSubjectCode && user.pendingSubjectAt && Date.now() - user.pendingSubjectAt.getTime() < 10 * 60_000
    && (upper === 'ALL' || /^20\d\d$/.test(upper))) {
    const pending = user.pendingSubjectCode;
    user.pendingSubjectCode = undefined; user.pendingSubjectAt = undefined; await user.save();
    const docs = await Pyq.find({ branchCode: user.branchCode, subjectCode: pending.slice(0, 6),
      curriculum: { $in: [user.curriculum, 'all'] },
      ...(pending.endsWith('P') ? { examType: 'practical' } : { examType: { $ne: 'practical' } }),
      ...(upper === 'ALL' ? {} : { examYear: Number(upper) }) }).lean();
    return docs.length ? queueSelection(sock, jid, user, incoming.key.id, docs)
      : reply(sock, jid, 'No matching paper for that year.');
  }
  if (/^\d{6}P?$/.test(upper)) return requestCode(sock, jid, user, upper, incoming.key.id);
  if (upper === 'HI') return reply(sock, jid, 'Welcome back to BEUnights! Send SUBJECTS to see your confirmed subjects or HELP for commands.');
  return reply(sock, jid, 'Send a registered 6-digit subject code, SUBJECTS, or HELP.');
}
