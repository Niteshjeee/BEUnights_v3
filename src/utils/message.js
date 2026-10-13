// File: src/utils/message.js
export function unwrapMessage(message) {
  let data = message?.message;
  for (let i = 0; i < 4; i++) {
    if (data?.documentWithCaptionMessage?.message) data = data.documentWithCaptionMessage.message;
    else if (data?.ephemeralMessage?.message) data = data.ephemeralMessage.message;
    else if (data?.viewOnceMessage?.message) data = data.viewOnceMessage.message;
    else if (data?.viewOnceMessageV2?.message) data = data.viewOnceMessageV2.message;
    else break;
  }
  return data || {};
}
export function messageText(message) {
  const m = unwrapMessage(message);
  return (m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.documentMessage?.caption || '').trim();
}
export function documentMessage(message) { return unwrapMessage(message).documentMessage || null; }
export function contactNumbers(message) {
  const m = unwrapMessage(message);
  const contacts = [m.contactMessage, ...(m.contactsArrayMessage?.contacts ?? [])].filter(Boolean);
  const numbers = [];
  for (const contact of contacts) {
    // Match only phone fields inside a vCard; don't store the vCard or other people's contacts.
    const vcard = String(contact.vcard ?? '');
    for (const match of vcard.matchAll(/^TEL[^:]*:(.+)$/gim)) {
      const digits = match[1].replace(/\D/g, '');
      if (digits.length >= 8 && digits.length <= 15) numbers.push(digits);
    }
  }
  return numbers;
}
export function safeFileName(input) { return String(input || 'paper.pdf').replace(/[^\w. -]/g, '_').slice(0, 110); }
