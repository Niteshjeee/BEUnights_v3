// File: src/services/telegram.js
import { Blob } from 'node:buffer';
import { config } from '../config.js';

const botApi = `https://api.telegram.org/bot${config.telegramToken}`;
const fileApi = `https://api.telegram.org/file/bot${config.telegramToken}`;

async function telegramCall(method, init) {
  const response = await fetch(`${botApi}/${method}`, { ...init, signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`Telegram ${method} HTTP ${response.status}`);
  const body = await response.json();
  if (!body.ok || !body.result) throw new Error(`Telegram ${method} returned an error`);
  return body.result;
}

export async function uploadPdf(buffer, filename) {
  if (!Buffer.isBuffer(buffer) || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-')))
    throw new Error('Not a valid PDF header');
  if (buffer.length > config.maxPdfBytes) throw new Error('PDF exceeds configured limit');
  const body = new FormData();
  body.set('chat_id', config.telegramChatId);
  body.set('document', new Blob([buffer], { type: 'application/pdf' }), filename);
  const result = await telegramCall('sendDocument', { method: 'POST', body });
  if (!result.document?.file_id || !result.message_id) throw new Error('Telegram did not return document metadata');
  return { fileId: result.document.file_id, messageId: result.message_id };
}

export async function getPdf(fileId) {
  const info = await telegramCall('getFile', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file_id: fileId })
  });
  if (!info.file_path) throw new Error('Telegram file path unavailable');
  if (info.file_size > config.maxPdfBytes) throw new Error('Telegram PDF exceeds configured limit');
  const response = await fetch(`${fileApi}/${info.file_path}`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Telegram file download HTTP ${response.status}`);
  const announced = Number(response.headers.get('content-length') || 0);
  if (announced > config.maxPdfBytes) throw new Error('PDF exceeds configured limit');
  // Strictly bound memory even if response omits Content-Length.
  let total = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > config.maxPdfBytes) {
      await response.body.cancel().catch(() => {});
      throw new Error('PDF exceeded maximum size while downloading');
    }
    chunks.push(Buffer.from(chunk));
  }
  const pdf = Buffer.concat(chunks, total);
  if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('Downloaded data is not a PDF');
  return pdf;
}
