// File: src/db/models.js
import mongoose from 'mongoose';

const subjectEntitlement = new mongoose.Schema({
  semester: { type: Number, required: true, min: 1, max: 8 },
  code: { type: String, required: true },
  label: String,
  type: { type: String, enum: ['core', 'elective', 'self_reported'], required: true },
  planVersion: Number
}, { _id: false });

const userSchema = new mongoose.Schema({
  jid: { type: String, unique: true, required: true, immutable: true },
  phoneJid: { type: String, index: true }, // only if explicitly provided by trusted WhatsApp metadata
  state: { type: String, default: 'START_PENDING' },
  collegeCode: String,
  branchCode: String,
  admissionBatch: Number,
  curriculum: String,
  semester: { type: Number, min: 1, max: 8 },
  pendingSemester: { type: Number, min: 1, max: 8 },
  electiveIndex: { type: Number, default: 0 },
  selectedElectives: { type: Map, of: String, default: {} },
  subjectEntitlements: { type: [subjectEntitlement], default: [] },
  profileLockedAt: Date,
  privacyAcceptedAt: Date,
  groupStatus: { type: String, default: 'unknown' },
  lastVerifiedAt: Date,
  contactConfirmedAt: Date, // receipt of bot's vCard, not proof number was saved
  optedOut: { type: Boolean, default: false },
  resumeState: String,
  moderation: { type: String, enum: ['none', 'hold', 'ban'], default: 'none' },
  moderationReason: String,
  pendingSubjectCode: String,
  pendingSubjectAt: Date
}, { timestamps: true });

const pyqSchema = new mongoose.Schema({
  branchCode: { type: String, required: true },
  subjectCode: { type: String, required: true },
  curriculum: { type: String, required: true, enum: ['old', '2024', '2026', 'all'] },
  examYear: { type: Number, required: true },
  examType: { type: String, required: true, enum: ['regular', 'supplementary', 'practical'] },
  label: { type: String, required: true },
  filename: { type: String, required: true },
  telegramFileId: { type: String, required: true },
  telegramMessageId: { type: Number, required: true },
  sha256: { type: String, required: true },
  bytes: { type: Number, required: true },
  uploadedBy: { type: String, required: true }
}, { timestamps: true });
pyqSchema.index({ branchCode: 1, subjectCode: 1, curriculum: 1, examYear: 1, examType: 1 }, { unique: true });

const planSchema = new mongoose.Schema({
  key: { type: String, unique: true, required: true },
  collegeCode: { type: String, required: true },
  branchCode: { type: String, required: true },
  curriculum: { type: String, enum: ['old', '2024', '2026'], required: true },
  semester: { type: Number, min: 1, max: 8, required: true },
  coreCodes: { type: [String], default: [] },
  electiveGroups: [{ name: String, choose: { type: Number, default: 1 }, codes: [String] }],
  approved: { type: Boolean, default: false },
  version: { type: Number, default: 1 },
  updatedBy: String
}, { timestamps: true });

const gateSchema = new mongoose.Schema({
  key: { type: String, unique: true, required: true },
  branchCode: String,
  subjectCode: String,
  curriculum: String,
  examYear: Number,
  examType: String,
  status: { type: String, enum: ['pending', 'open'], default: 'pending' },
  approvedSubmission: { type: mongoose.Schema.Types.ObjectId, ref: 'Submission' },
  updatedBy: String
}, { timestamps: true });

const submissionSchema = new mongoose.Schema({
  submitterJid: { type: String, required: true },
  branchCode: String, subjectCode: String, curriculum: String,
  examYear: Number, examType: String, label: String,
  filename: String, sha256: String, bytes: Number,
  telegramFileId: String, telegramMessageId: Number,
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  reviewedBy: String, reviewedAt: Date
}, { timestamps: true });

const restrictionSchema = new mongoose.Schema({
  jid: { type: String, unique: true, required: true },
  phoneJid: String,
  status: { type: String, enum: ['hold', 'ban'], required: true },
  updatedBy: String,
  updatedAt: { type: Date, default: Date.now }
});

const promotionSchema = new mongoose.Schema({
  key: { type: String, unique: true, required: true },
  admissionBatch: Number, fromSemester: Number,
  open: { type: Boolean, default: false },
  updatedBy: String
}, { timestamps: true });

const auditSchema = new mongoose.Schema({
  actorJid: String,
  targetJid: String,
  action: { type: String, required: true },
  detail: String,
  at: { type: Date, default: Date.now }
});

const deliverySchema = new mongoose.Schema({
  requestId: { type: String, unique: true, required: true },
  jid: { type: String, required: true },
  pyqId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pyq', required: true },
  status: { type: String, enum: ['pending', 'preparing', 'sending', 'accepted', 'uncertain', 'failed', 'cancelled'], default: 'pending' },
  acceptedMessageId: String,
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  errorCode: String, attemptedAt: Date
}, { timestamps: true });
deliverySchema.index({ status: 1, createdAt: 1 });

const activitySchema = new mongoose.Schema({
  jid: { type: String, required: true },
  action: { type: String, enum: ['registered', 'requested', 'accepted', 'denied'] },
  subjectCode: String,
  occurredAt: { type: Date, default: Date.now, expires: 30 * 24 * 60 * 60 }
});
const inboundSchema = new mongoose.Schema({
  eventKey: { type: String, unique: true, required: true },
  receivedAt: { type: Date, default: Date.now, expires: 7 * 24 * 60 * 60 }
});

export const User = mongoose.model('User', userSchema);
export const Pyq = mongoose.model('Pyq', pyqSchema);
export const AcademicPlan = mongoose.model('AcademicPlan', planSchema);
export const SubjectGate = mongoose.model('SubjectGate', gateSchema);
export const Submission = mongoose.model('Submission', submissionSchema);
export const PromotionWindow = mongoose.model('PromotionWindow', promotionSchema);
export const Restriction = mongoose.model('Restriction', restrictionSchema);
export const AdminAudit = mongoose.model('AdminAudit', auditSchema);
export const Delivery = mongoose.model('Delivery', deliverySchema);
export const Activity = mongoose.model('Activity', activitySchema);
export const Inbound = mongoose.model('Inbound', inboundSchema);
