// File: src/config.js
import 'dotenv/config';
import { resolve } from 'node:path';

function required(key) {
  const value = process.env[key]?.trim();
  if (!value || /^(YOUR_|REPLACE_ME|91X+)/i.test(value)) throw new Error(`Missing/placeholder ${key}`);
  return value;
}
function positiveInteger(key, fallback) {
  const n = Number(process.env[key] ?? fallback);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`Invalid ${key}`);
  return n;
}
const normalizeDigits = (value) => value.replace(/\D/g, '');
const rawAdmins = required('ADMIN_NUMBERS').split(',').map(normalizeDigits).filter(Boolean);
if (!rawAdmins.length || rawAdmins.some((n) => n.length < 10)) throw new Error('ADMIN_NUMBERS must contain country-code phone numbers');
const botNumber = normalizeDigits(required('BOT_NUMBER'));
if (botNumber.length < 10) throw new Error('BOT_NUMBER requires the country code');

export const config = Object.freeze({
  mongoUri: required('MONGODB_URI'),
  telegramToken: required('TELEGRAM_BOT_TOKEN'),
  telegramChatId: required('TELEGRAM_CHAT_ID'),
  admins: new Set(rawAdmins.map((number) => `${number}@s.whatsapp.net`)),
  botNumber,
  groupJid: required('WHATSAPP_GROUP_JID'),
  groupInvite: required('WHATSAPP_GROUP_INVITE'),
  authDir: resolve(process.env.AUTH_DIR || './private/wa-auth'),
  maxPdfBytes: positiveInteger('MAX_PDF_MB', 15) * 1024 * 1024,
  maxFilesPerRequest: positiveInteger('MAX_FILES_PER_REQUEST', 5),
  minAdmissionYear: positiveInteger('MIN_ADMISSION_YEAR', 2018),
  logLevel: process.env.LOG_LEVEL || 'info'
});
if (!/^\S+@g\.us$/.test(config.groupJid)) throw new Error('WHATSAPP_GROUP_JID must end with @g.us');
if (!/^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+$/.test(config.groupInvite)) throw new Error('WHATSAPP_GROUP_INVITE must be an official HTTPS group invite');
if (config.maxPdfBytes > 20 * 1024 * 1024) throw new Error('MAX_PDF_MB must be <= 20 (Telegram Bot getFile limit)');
if (config.maxFilesPerRequest > 10) throw new Error('MAX_FILES_PER_REQUEST must be <= 10');
