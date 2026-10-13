// File: tests/registration-rules.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInternationalPhone, phoneJid } from '../src/services/phone.js';
import { collegeCodes, collegeLabel, branchesForCollege, subjectsForSemester, lookupSubject } from '../src/services/catalog.js';

test('college PDF names and complete menu coverage', () => {
  assert.equal(collegeCodes().length, 60);
  assert.match(collegeLabel('134'), /Banka/i);
  assert.equal(collegeCodes().filter(Boolean).length, new Set(collegeCodes()).size);
  assert.equal(branchesForCollege('134').some(b => b.code === '104'), true);
});
test('international number parser accepts readable +91 and +1 formats', () => {
  assert.equal(phoneJid('+91 88927 48754'), '918892748754@s.whatsapp.net');
  assert.equal(phoneJid('+1 (580) 258-5504'), '15802585504@s.whatsapp.net');
  assert.equal(phoneJid('+918892748754'), '918892748754@s.whatsapp.net');
  assert.equal(parseInternationalPhone('bob@example.com'), null);
  assert.equal(phoneJid('+00123456'), null);
  assert.equal(phoneJid('8892748754'), null);
});
test('semester subjects stay branch and curriculum specific', () => {
  const sem6 = subjectsForSemester('104', 'old', 6);
  assert.ok(sem6.some(s => s.code === '104602'));
  assert.equal(lookupSubject('105', '104602', 'old', 6), null);
  assert.equal(lookupSubject('104', '104602', 'old', 5), null);
});
