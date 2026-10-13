// File: scripts/find-groups.js
// Stop the main bot first: only one process may use a Baileys authentication directory.
import 'dotenv/config';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState } from '@whiskeysockets/baileys';

const dir = process.env.AUTH_DIR || './private/wa-auth';
const { state, saveCreds } = await useMultiFileAuthState(dir);
if (!state.creds.registered) {
  console.error('WhatsApp is not linked. Pair the main bot first.');
  process.exit(1);
}
const sock = makeWASocket({ auth: state, printQRInTerminal: false, logger: pino({ level: 'silent' }) });
sock.ev.on('creds.update', () => { void saveCreds(); });
let complete = false;
const end = (code, text = '') => {
  if (complete) return;
  complete = true;
  clearTimeout(timeout);
  if (text) console.log(text);
  sock.end(new Error('Finished group discovery'));
  setTimeout(() => process.exit(code), 100);
};
const timeout = setTimeout(() => end(1, 'Group lookup timed out.'), 45000);
sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
  if (complete) return;
  if (connection === 'close') return end(1, `Disconnected: ${lastDisconnect?.error?.message || 'unknown'}`);
  if (connection !== 'open') return;
  void (async () => {
    try {
      const groups = Object.values(await sock.groupFetchAllParticipating());
      end(0, groups.length ? `GROUP NAME => GROUP JID\n\n${groups.map(g => `${g.subject} => ${g.id}`).join('\n')}` : 'No groups found.');
    } catch (error) { end(1, `Unable to list groups: ${error.message}`); }
  })();
});
