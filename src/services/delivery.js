// File: src/services/delivery.js
import { createHash } from 'node:crypto';
import PQueue from 'p-queue';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { User, Delivery, Pyq, Activity } from '../db/models.js';
import { getPdf } from './telegram.js';
import { eligibility } from './access.js';
import { safeFileName } from '../utils/message.js';

const sendQueue = new PQueue({ concurrency: 1, intervalCap: 1, interval: 2500,
  carryoverConcurrencyCount: true });
let timer = null;
let checking = false;
let socketGetter = () => null;

function makeRequestId(jid, inboundMessageId, pyqId) {
  return createHash('sha256').update([jid, inboundMessageId, String(pyqId)].join('|')).digest('hex');
}
export async function enqueueDocuments(jid, inboundMessageId, documents) {
  let queued = 0;
  for (const doc of documents.slice(0, config.maxFilesPerRequest)) {
    const requestId = makeRequestId(jid, inboundMessageId, doc._id);
    const result = await Delivery.updateOne({ requestId }, {
      $setOnInsert: { requestId, jid, pyqId: doc._id, status: 'pending' }
    }, { upsert: true });
    if (result.upsertedCount) queued++;
  }
  return queued;
}
async function processOne() {
  const claim = await Delivery.findOneAndUpdate({ status: 'pending',
    nextAttemptAt: { $lte: new Date() } },
  { $set: { status: 'preparing', attemptedAt: new Date() }, $inc: { attempts: 1 } },
  { sort: { createdAt: 1 }, new: true });
  if (!claim) return false;
  let stage = 'preparing';
  try {
    const sock = socketGetter();
    if (!sock) throw new Error('SOCKET_OFFLINE');
    const user = await User.findOne({ jid: claim.jid });
    const doc = await Pyq.findById(claim.pyqId);
    if (!doc) {
      await Delivery.updateOne({ _id: claim._id }, { status: 'failed', errorCode: 'PDF_NOT_FOUND' });
      return true;
    }
    const firstCheck = await eligibility(user, doc, sock);
    if (!firstCheck.ok) {
      await Delivery.updateOne({ _id: claim._id }, {
        status: 'cancelled', errorCode: firstCheck.reason });
      return true;
    }
    const pdf = await getPdf(doc.telegramFileId);
    // Critical boundary: after setting 'sending', a failure might mean WhatsApp received it.
    // Never auto-retry uncertain sends; doing so could duplicate messages.
    // Re-check restriction, group and academic eligibility right before sending.
    const latestUser = await User.findOne({ jid: claim.jid });
    const finalCheck = await eligibility(latestUser, doc, sock);
    if (!finalCheck.ok) {
      await Delivery.updateOne({ _id: claim._id, status: 'preparing' }, {
        status: 'cancelled', errorCode: finalCheck.reason });
      return true;
    }
    const moved = await Delivery.updateOne({ _id: claim._id, status: 'preparing' }, { status: 'sending' });
    if (!moved.modifiedCount) return true; // reset/deletion cancelled this job
    stage = 'sending';
    const reply = await sock.sendMessage(claim.jid, {
      document: pdf, mimetype: 'application/pdf', fileName: safeFileName(doc.filename),
      caption: `${doc.subjectCode} • ${doc.examYear} • ${doc.examType}`
    });
    await Delivery.updateOne({ _id: claim._id }, {
      status: 'accepted', acceptedMessageId: reply?.key?.id || ''
    });
    await Activity.create({ jid: claim.jid, action: 'accepted', subjectCode: doc.subjectCode }).catch(() => {});
  } catch (error) {
    logger.warn({ jobId: String(claim._id), stage, reason: error.message }, 'PDF job could not finish');
    if (stage === 'sending') {
      await Delivery.updateOne({ _id: claim._id }, { status: 'uncertain', errorCode: 'SEND_RESULT_UNKNOWN' });
    } else if (claim.attempts < 3) {
      const seconds = 15 * 2 ** (claim.attempts - 1);
      await Delivery.updateOne({ _id: claim._id }, {
        status: 'pending', nextAttemptAt: new Date(Date.now() + seconds * 1000),
        errorCode: 'PRE_SEND_FAILURE'
      });
    } else {
      await Delivery.updateOne({ _id: claim._id }, { status: 'failed', errorCode: 'PRE_SEND_FAILURE' });
    }
  }
  return true;
}
async function poll() {
  // Offline sockets are normal: leave jobs pending until WhatsApp reconnects.
  if (!socketGetter() || checking || sendQueue.size + sendQueue.pending >= 1) return;
  checking = true;
  try {
    const exists = await Delivery.exists({ status: 'pending', nextAttemptAt: { $lte: new Date() } });
    if (exists) void sendQueue.add(processOne).catch((e) => logger.error({ message: e.message }, 'Worker failure'));
  } catch (error) { logger.warn({ message: error.message }, 'Delivery poll failed'); }
  finally { checking = false; }
}
export async function startDeliveryWorker(getSocket) {
  socketGetter = getSocket;
  // An interrupted preparation can be repeated; an interrupted send cannot safely be repeated.
  await Delivery.updateMany({ status: 'preparing' }, { $set: { status: 'pending' } });
  await Delivery.updateMany({ status: 'sending' }, { $set: { status: 'uncertain', errorCode: 'PROCESS_RESTART' } });
  timer = setInterval(() => { void poll(); }, 4000);
  timer.unref();
  await poll();
}
export function stopDeliveryWorker() {
  if (timer) clearInterval(timer);
  sendQueue.pause();
}
