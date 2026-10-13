// File: src/wa/connection.js
import pino from 'pino';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import PQueue from 'p-queue';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { Inbound, User } from '../db/models.js';
import { isPrivateStudentJid, normalizedJid, isAdmin } from './identity.js';
import { messageText, documentMessage, contactNumbers } from '../utils/message.js';
import { handleAdmin } from '../services/admin.js';
import { handleStudent } from '../services/student.js';

const incomingQueue = new PQueue({ concurrency: 1 });
let currentSocket = null;
let reconnectTimer = null;
let pairingTimer = null;
let connecting = false;
let stopped = false;
let retryDelay = 3000;
export function getSocket() { return currentSocket; }
export function stopWhatsApp() {
  stopped = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (pairingTimer) clearTimeout(pairingTimer);
  incomingQueue.pause();
  currentSocket = null;
}
function ownNumberMatches(sock) {
  const ids = [sock.user?.id, sock.authState?.creds?.me?.id];
  return ids.some(x => normalizedJid(x) === `${config.botNumber}@s.whatsapp.net`);
}
async function authorized(sock, msg, actor, alt) {
  // fromMe is set by WhatsApp for messages sent from the connected account.
  if (msg.key.fromMe) return ownNumberMatches(sock);
  if (isAdmin(actor, config.admins) || (alt && isAdmin(alt, config.admins))) return true;
  // Only use real trusted LID → PN mappings. LID digits are not phone numbers.
  if (actor?.endsWith('@lid')) {
    try {
      const map = sock.signalRepository?.lidMapping;
      if (typeof map?.getPNForLID === 'function') {
        const pn = await map.getPNForLID(actor);
        return isAdmin(pn, config.admins);
      }
    } catch (e) { logger.warn({ reason: e.message }, 'Admin identity lookup failed'); }
  }
  return false;
}
async function processIncoming(sock, message) {
  if (!message?.key?.remoteJid || !message.key.id) return;
  const chatJidRaw = message.key.remoteJid;
  const isGroup = chatJidRaw.endsWith('@g.us');
  const chatJid = isGroup ? chatJidRaw : normalizedJid(chatJidRaw);
  if (!chatJid) return;
  const actor = message.key.fromMe ? normalizedJid(sock.user?.id) : normalizedJid(
    isGroup ? message.key.participant : chatJidRaw);
  const alternate = normalizedJid(isGroup ? message.key.participantAlt : message.key.remoteJidAlt);
  const text = messageText(message);
  if (!text && !documentMessage(message) && !contactNumbers(message).length) return;
  const admin = await authorized(sock, message, actor, alternate);
  if (isGroup && !(admin && text.startsWith('!'))) return;
  if (message.key.fromMe && !(admin && text.startsWith('!'))) return;
  const eventKey = createHash('sha256').update(
    `${chatJid}:${actor || 'unknown'}:${message.key.id}:${message.key.fromMe ? 1 : 0}`).digest('hex');
  try {
    const inserted = await Inbound.updateOne({ eventKey }, { $setOnInsert: { eventKey } }, { upsert: true });
    if (!inserted.upsertedCount) return;
  } catch (error) {
    logger.error({ message: error.message }, 'Inbound dedup unavailable'); return;
  }
  if (!isGroup && !message.key.fromMe && alternate?.endsWith('@s.whatsapp.net')) {
    // Save only a trusted WhatsApp-supplied alternate phone identity to support admin targeting.
    await User.updateOne({ jid: chatJid }, { $set: { phoneJid: alternate } }).catch(() => {});
  }
  if (!isGroup && !message.key.fromMe && chatJid.endsWith('@s.whatsapp.net')) {
    await User.updateOne({ jid: chatJid }, { $set: { phoneJid: chatJid } }).catch(() => {});
  }
  try {
    if (admin && text.startsWith('!')) {
      const selfJid = normalizedJid(sock.user?.id) || `${config.botNumber}@s.whatsapp.net`;
      const selfChat = !isGroup && (chatJid === selfJid || chatJid === `${config.botNumber}@s.whatsapp.net`);
      if (await handleAdmin(sock, chatJid, message, text, {
        actor: actor || selfJid, fromMe: Boolean(message.key.fromMe),
        isGroup, selfChat, selfJid
      })) return;
    }
    if (isGroup || message.key.fromMe || !isPrivateStudentJid(chatJid)) return;
    await handleStudent(sock, chatJid, message, text);
  } catch (error) {
    logger.error({ reason: error.message }, 'Message handler failed');
    if (!isGroup && !message.key.fromMe) await sock.sendMessage(chatJid, {
      text: 'Temporary error. Please try again later.' }).catch(() => {});
  }
}
function scheduleReconnect() {
  if (stopped || reconnectTimer) return;
  const delay = retryDelay;
  retryDelay = Math.min(retryDelay * 2, 60000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null; void initializeWhatsAppConnection();
  }, delay);
  logger.warn({ delayMs: delay }, 'WhatsApp reconnect scheduled');
}
export async function initializeWhatsAppConnection() {
  if (stopped || connecting) return;
  connecting = true;
  try {
    await mkdir(config.authDir, { recursive: true, mode: 0o700 });
    const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
    // Preserve the known-working minimal Baileys pairing configuration.
    const sock = makeWASocket({ auth: state, printQRInTerminal: false, logger: pino({ level: 'silent' }) });
    let pairingRequested = false;
    let socketClosed = false;
    sock.ev.on('creds.update', () => { void saveCreds().catch(e =>
      logger.error({ message: e.message }, 'Saving WhatsApp credentials failed')); });
    sock.ev.on('messages.upsert', event => {
      if (event.type !== 'notify') return; // Never replay historic messages or admin actions.
      for (const msg of event.messages ?? []) void incomingQueue.add(() => processIncoming(sock, msg))
        .catch(e => logger.error({ message: e.message }, 'Incoming message failed'));
    });
    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
      if (connection === 'open') {
        if (pairingTimer) clearTimeout(pairingTimer);
        currentSocket = sock; retryDelay = 3000;
        logger.info('WhatsApp session connected');
      } else if (connection === 'close') {
        socketClosed = true;
        if (pairingTimer) clearTimeout(pairingTimer);
        if (currentSocket === sock) currentSocket = null;
        const code = lastDisconnect?.error?.output?.statusCode;
        logger.warn({ statusCode: code ?? null, reason: lastDisconnect?.error?.message }, 'WhatsApp socket closed');
        if (code !== DisconnectReason.loggedOut) scheduleReconnect();
        else logger.error('WhatsApp logged out. Manual session review required.');
      }
    });
    if (!state.creds.registered) pairingTimer = setTimeout(async () => {
      if (pairingRequested || stopped || socketClosed) return;
      pairingRequested = true;
      try {
        const code = await sock.requestPairingCode(config.botNumber.replace(/\D/g, ''));
        console.log(`PAIRING CODE (PRIVATE): ${code}`);
      } catch (e) { logger.warn({ message: e.message }, 'Pairing unavailable'); }
    }, 5000);
  } catch (error) {
    logger.error({ message: error.message }, 'WhatsApp connection initialization failed');
    scheduleReconnect();
  } finally { connecting = false; }
}
