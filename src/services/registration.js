// File: src/services/registration.js
// Student-owned subject selection; locked entitlements persist through promotion.
import { User, Activity, Delivery, PromotionWindow, Restriction } from '../db/models.js';
import { branchesForCollege, collegeCodes, curriculumForAdmission, isCollege, lookupSubject, subjectsForSemester } from './catalog.js';
import { verifyMembership } from '../wa/membership.js';
import { contactNumbers } from '../utils/message.js';
import { parseSubjectNumbers, selectionsAreEligible } from './subject-selection.js';
import { config } from '../config.js';
import * as msg from './messages.js';

export const privacyNotice = msg.privacyNotice;
const reply = (sock, jid, text) => sock.sendMessage(jid, { text });
const getOptions = user => subjectsForSemester(user.branchCode, user.curriculum, user.pendingSemester);
function selectionFromUser(user) {
  const codes = String(user.selectedElectives?.get('StudentSelectedSubjects') || '').split('|').filter(Boolean);
  const catalog = getOptions(user);
  if (!codes.length || codes.length > 24) return null;
  const list = codes.map(code => catalog.find(s => s.code === code));
  return list.every(Boolean) && selectionsAreEligible(list, catalog) ? list : null;
}
export async function newUser(jid) {
  const user = await User.findOneAndUpdate({ jid }, { $setOnInsert: { jid, state: 'START_PENDING' } },
    { upsert: true, new: true });
  const restriction = await Restriction.findOne({ $or: [{ jid }, { phoneJid: user.phoneJid || 'missing' }] });
  const nextModeration = restriction?.status || 'none';
  if (user.moderation !== nextModeration) { user.moderation = nextModeration; await user.save(); }
  if (user.state === 'ACTIVE' && (!user.profileLockedAt || !user.subjectEntitlements.length)) {
    user.state = 'START_PENDING'; await user.save();
  }
  return user;
}
export async function resetUser(jid, { fullDelete = false } = {}) {
  await Delivery.updateMany({ jid, status: { $in: ['pending', 'preparing'] } },
    { $set: { status: 'cancelled', errorCode: 'RESET' } });
  const user = await User.findOne({ jid });
  if (!user) return;
  if (fullDelete) {
    // Deleting the academic profile must not let students immediately bypass
    // its irreversible branch lock. Keep only a minimal admin-review hold.
    // Existing bans must never be downgraded by a deletion request.
    const existingRestriction = await Restriction.findOne({ jid });
    if (!existingRestriction) await Restriction.findOneAndUpdate({ jid }, { $setOnInsert: {
      jid, phoneJid: current.phoneJid, status: 'hold', updatedBy: 'SELF_DELETE_REVIEW', updatedAt: new Date()
    } }, { upsert: true });
    await User.deleteOne({ jid });
    await Activity.deleteMany({ jid });
    await Delivery.deleteMany({ jid, status: { $ne: 'sending' } });
    // Moderation record intentionally survives profile deletion.
    return;
  }
  user.state = user.optedOut ? 'OPTED_OUT' : 'START_PENDING';
  user.collegeCode = undefined; user.branchCode = undefined;
  user.admissionBatch = undefined; user.curriculum = undefined;
  user.semester = undefined; user.pendingSemester = undefined;
  user.profileLockedAt = undefined; user.contactConfirmedAt = undefined;
  user.lastVerifiedAt = undefined; user.groupStatus = 'unknown';
  user.selectedElectives = new Map(); user.subjectEntitlements = [];
  user.pendingSubjectCode = undefined; user.pendingSubjectAt = undefined;
  await user.save();
}
export async function recordMembership(user, sock, jid) {
  const status = await verifyMembership(sock, jid, user.phoneJid ? [user.phoneJid] : []);
  user.groupStatus = status;
  if (status === 'verified') user.lastVerifiedAt = new Date();
  await user.save();
  return status;
}
async function selectSubjects(sock, jid, user) {
  const options = getOptions(user);
  if (!options.length) {
    user.state = 'SUBJECTS_MISSING';
    await user.save();
    return reply(sock, jid, msg.subjectMissing(user));
  }
  user.state = 'SUBJECT_PICK_PENDING';
  user.selectedElectives = new Map();
  await user.save();
  return reply(sock, jid, msg.subjectMenu(user, options));
}
async function verifyGroup(sock, jid, user) {
  const status = await recordMembership(user, sock, jid);
  if (status === 'verified') {
    user.state = 'CONTACT_PENDING'; await user.save();
    return reply(sock, jid, msg.contactPrompt());
  }
  user.state = status === 'not_member' ? 'GROUP_PENDING' : 'VERIFY_PENDING';
  await user.save();
  return reply(sock, jid, status === 'not_member'
    ? `🔒 *BEUnights | Membership required*\n\nPlease join BEUPYQ:\n${config.groupInvite}\n\nThen send *VERIFY*.`
    : '⏳ *Group verification unavailable*\n\nWe could not check membership right now. No PDF access was granted. Please send VERIFY later.');
}
export async function registerContact(sock, jid, user, message) {
  if (user.state !== 'CONTACT_PENDING') return false;
  const numbers = contactNumbers(message);
  if (!numbers.length) return false;
  if (!numbers.includes(config.botNumber)) {
    await reply(sock, jid, '❌ *Wrong contact card*\n\nPlease send only the BEUnights bot contact, not another person’s contact.');
    return true;
  }
  if (await recordMembership(user, sock, jid) !== 'verified') {
    user.state = 'VERIFY_PENDING'; await user.save();
    await reply(sock, jid, '🔒 Group membership must be verified again. Send VERIFY when you are in BEUPYQ.');
    return true;
  }
  user.contactConfirmedAt = new Date(); user.state = 'ACTIVE';
  await user.save();
  await Activity.create({ jid, action: 'registered' }).catch(() => {});
  await reply(sock, jid, msg.finished(user));
  return true;
}
export async function requestPromotion(sock, jid, user) {
  if (user.state === 'GRADUATED_HOLD' || user.semester >= 8)
    return reply(sock, jid, '🎓 Semester 8 completed. Your old/backlog PYQs remain available. There is no Semester 9.');
  if (user.state !== 'ACTIVE' || !user.profileLockedAt)
    return reply(sock, jid, 'Complete your registration first.');
  const window = await PromotionWindow.findOne({ key: `${user.admissionBatch}:${user.semester}`, open: true });
  if (!window) return reply(sock, jid, '⏳ Promotion window is not open for your batch and semester yet.');
  user.state = 'PROMOTION_CONFIRM_PENDING'; await user.save();
  return reply(sock, jid, msg.promotionPrompt(user, user.semester + 1));
}
export async function adminPromote(user) {
  if (!user.profileLockedAt || user.semester >= 8 || user.state !== 'ACTIVE')
    throw new Error('Student is not eligible for Semester 1–7 promotion');
  user.pendingSemester = user.semester + 1;
  user.selectedElectives = new Map();
  user.state = 'SUBJECT_PICK_PENDING';
  await user.save();
}
function cancelOrBack(user) {
  if (user.profileLockedAt) {
    user.pendingSemester = undefined;
    user.selectedElectives = new Map();
    user.state = 'ACTIVE';
    return true;
  }
  user.state = 'SEMESTER_PENDING';
  user.selectedElectives = new Map();
  return false;
}
export async function registrationStep(sock, jid, user, text) {
  const input = String(text || '').trim();
  const upper = input.toUpperCase();
  if (user.state === 'START_PENDING') {
    if (input === '2') {
      user.state = 'OPTED_OUT'; user.optedOut = true; await user.save();
      return reply(sock, jid, 'Registration cancelled. Send START when you want to begin.');
    }
    if (input !== '1') return reply(sock, jid, msg.welcome());
    user.optedOut = false; user.privacyAcceptedAt = new Date(); user.state = 'BATCH_PENDING';
    await user.save(); return reply(sock, jid, msg.batchMenu());
  }
  if (user.state === 'BATCH_PENDING') {
    if (upper === 'BACK') { user.state = 'START_PENDING'; await user.save(); return reply(sock, jid, msg.welcome()); }
    const n = Number(input);
    const year = /^\d+$/.test(input) ? (msg.batchYears[n - 1] ?? (msg.batchYears.includes(n) ? n : null)) : null;
    if (!year) return reply(sock, jid, `⚠️ Invalid batch.\n\n${msg.batchMenu()}`);
    user.admissionBatch = year; user.curriculum = curriculumForAdmission(year);
    user.state = 'COLLEGE_PENDING'; await user.save(); return reply(sock, jid, msg.collegeMenu());
  }
  if (user.state === 'COLLEGE_PENDING') {
    if (upper === 'BACK') { user.state = 'BATCH_PENDING'; await user.save(); return reply(sock, jid, msg.batchMenu()); }
    const list = collegeCodes();
    const college = /^\d+$/.test(input) ? (list[Number(input) - 1] ?? (isCollege(input) ? input : null)) : null;
    if (!college) return reply(sock, jid, `⚠️ Invalid college.\n\n${msg.collegeMenu()}`);
    user.collegeCode = college; user.state = 'BRANCH_PENDING'; await user.save();
    return reply(sock, jid, msg.branchMenu(college));
  }
  if (user.state === 'BRANCH_PENDING') {
    if (upper === 'BACK') { user.state = 'COLLEGE_PENDING'; await user.save(); return reply(sock, jid, msg.collegeMenu()); }
    const list = branchesForCollege(user.collegeCode);
    if (!list.length) return reply(sock, jid, `⚠️ No verified branch listing for this college. Contact admin or reply BACK.\n\n${msg.branchMenu(user.collegeCode)}`);
    const branch = /^\d+$/.test(input) ? (list[Number(input) - 1]?.code ?? list.find(x => x.code === input)?.code) : null;
    if (!branch) return reply(sock, jid, `⚠️ Invalid branch.\n\n${msg.branchMenu(user.collegeCode)}`);
    user.branchCode = branch; user.state = 'SEMESTER_PENDING'; await user.save();
    return reply(sock, jid, msg.semesterMenu());
  }
  if (user.state === 'SEMESTER_PENDING' || user.state === 'SUBJECTS_MISSING') {
    if (upper === 'BACK') {
      if (user.profileLockedAt) { cancelOrBack(user); await user.save(); return reply(sock, jid, '✅ Promotion cancelled. Your locked profile remains unchanged.'); }
      user.state = 'BRANCH_PENDING'; await user.save(); return reply(sock, jid, msg.branchMenu(user.collegeCode));
    }
    if (user.state === 'SUBJECTS_MISSING' && upper === 'HI') return reply(sock, jid, msg.subjectMissing(user));
    if (!/^[1-8]$/.test(input)) return reply(sock, jid, `⚠️ Invalid semester.\n\n${msg.semesterMenu()}`);
    user.pendingSemester = Number(input); await user.save();
    return selectSubjects(sock, jid, user);
  }
  // Migrate v2.1 incomplete academic states, which used admin/template electives.
  if (['PLAN_PENDING', 'ELECTIVE_PENDING'].includes(user.state)) return selectSubjects(sock, jid, user);
  if (user.state === 'SUBJECT_PICK_PENDING') {
    if (upper === 'BACK') {
      const locked = cancelOrBack(user); await user.save();
      return reply(sock, jid, locked ? '↩️ Semester change cancelled; original subjects are still locked.' : msg.semesterMenu());
    }
    const options = getOptions(user);
    if (!options.length) { user.state = 'SUBJECTS_MISSING'; await user.save(); return reply(sock, jid, msg.subjectMissing(user)); }
    if (upper === 'HI') return reply(sock, jid, msg.subjectMenu(user, options));
    const result = parseSubjectNumbers(input, options);
    if (!result.ok) return reply(sock, jid, `⚠️ *${result.reason}*\n\n${msg.subjectMenu(user, options)}`);
    user.selectedElectives.set('StudentSelectedSubjects', result.selected.map(s => s.code).join('|'));
    user.state = 'SUBJECT_CONFIRM_PENDING'; await user.save();
    return reply(sock, jid, msg.subjectReview(user, result.selected));
  }
  if (user.state === 'SUBJECT_CONFIRM_PENDING') {
    const selected = selectionFromUser(user);
    if (!selected) return selectSubjects(sock, jid, user);
    if (input === '2') {
      user.state = 'SUBJECT_PICK_PENDING'; await user.save();
      return reply(sock, jid, msg.subjectMenu(user, getOptions(user)));
    }
    if (input === '3') {
      const locked = cancelOrBack(user); await user.save();
      return reply(sock, jid, locked ? '↩️ Promotion cancelled. Your previous semester remains locked.' : msg.semesterMenu());
    }
    if (input !== '1') return reply(sock, jid, msg.subjectReview(user, selected));
    const sem = user.pendingSemester;
    if (!Number.isInteger(sem) || sem < 1 || sem > 8) return reply(sock, jid, 'Semester missing; ask an admin to review your registration.');
    // Lock exactly what was confirmed. Never auto-add earlier semesters or other electives.
    const kept = user.subjectEntitlements.filter(x => x.semester !== sem);
    const confirmed = selected.map(s => ({ semester: sem, code: s.code, label: s.label,
      type: 'self_reported', planVersion: 1 }));
    user.subjectEntitlements = [...kept, ...confirmed];
    user.semester = sem; user.pendingSemester = undefined;
    if (!user.profileLockedAt) user.profileLockedAt = new Date();
    user.selectedElectives = new Map();
    if (user.contactConfirmedAt) {
      user.state = 'ACTIVE'; await user.save();
      return reply(sock, jid, `${msg.finished(user)}\n\n✅ Your previously locked semester subjects remain available for backlogs.`);
    }
    user.state = 'GROUP_PENDING'; await user.save();
    return reply(sock, jid, msg.joinGroup());
  }
  if (user.state === 'PROMOTION_CONFIRM_PENDING') {
    if (input === '2') { user.state = 'ACTIVE'; await user.save(); return reply(sock, jid, '↩️ Promotion cancelled; academic profile unchanged.'); }
    if (input !== '1') return reply(sock, jid, msg.promotionPrompt(user, user.semester + 1));
    user.pendingSemester = user.semester + 1;
    return selectSubjects(sock, jid, user);
  }
  if (user.state === 'GROUP_PENDING' || user.state === 'VERIFY_PENDING') {
    return upper === 'VERIFY' || input === '1' ? verifyGroup(sock, jid, user) : reply(sock, jid, msg.joinGroup());
  }
  if (user.state === 'CONTACT_PENDING') return reply(sock, jid, msg.contactPrompt());
  return reply(sock, jid, msg.welcome());
}
