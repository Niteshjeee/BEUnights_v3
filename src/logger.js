// File: src/logger.js
import pino from 'pino';
import { config } from './config.js';
export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: ['mongoUri', 'telegramToken', 'MONGODB_URI', 'TELEGRAM_BOT_TOKEN', 'password', 'auth', 'authorization', '*.token'],
    censor: '[REDACTED]'
  }
});
