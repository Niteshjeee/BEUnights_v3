// File: index.js
import mongoose from 'mongoose';
import { config } from './src/config.js';
import { logger } from './src/logger.js';
import { initializeWhatsAppConnection, getSocket, stopWhatsApp } from './src/wa/connection.js';
import { startDeliveryWorker, stopDeliveryWorker } from './src/services/delivery.js';

let shuttingDown = false;
async function main() {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 20000, maxPoolSize: 10 });
  logger.info('MongoDB connected');
  await startDeliveryWorker(getSocket);
  await initializeWhatsAppConnection();
}
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  stopDeliveryWorker(); stopWhatsApp();
  await mongoose.disconnect();
  process.exit(0);
}
process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
main().catch((error) => {
  logger.fatal({ message: error.message }, 'Startup failed');
  process.exitCode = 1;
});
