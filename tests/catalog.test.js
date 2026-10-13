// File: tests/catalog.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupSubject, isCollege, branchesForCollege, curriculumForAdmission, catalogStats } from '../src/services/catalog.js';
import { normalizedJid, isAdmin } from '../src/wa/identity.js';

test('source PDF extracted into the catalog', () => {
  const stats = catalogStats();
  assert.ok(stats.entries >= 1400);
  assert.equal(stats.colleges >= 50, true);
  assert.ok(stats.branches >= 35);
});
test('ECE 6th semester Digital Communication is mapped correctly', () => {
  const subject = lookupSubject('104', '104602', 'old');
  assert.equal(subject.semester, 6);
  assert.match(subject.label, /Digital Communication/i);
});
test('subject code is not globally unique by subject name', () => {
  const eceOld = lookupSubject('104', '100104', 'old');
  const mechanical2024 = lookupSubject('102', '100104', '2024');
  assert.match(eceOld.label, /Programming for Problem Solving/i);
  assert.match(mechanical2024.label, /Engineering Graphics/i);
  assert.equal(lookupSubject('104', '100104', '2024'), null);
});
test('college branch mapping and curriculum years', () => {
  assert.ok(isCollege('102'));
  assert.ok(branchesForCollege('102').some((b) => b.code === '104'));
  assert.equal(curriculumForAdmission(2023), 'old');
  assert.equal(curriculumForAdmission(2024), '2024');
  assert.equal(curriculumForAdmission(2026), '2026');
});
test('phone JIDs are never inferred from LID identifiers', () => {
  assert.equal(normalizedJid('919000000000:8@s.whatsapp.net'), '919000000000@s.whatsapp.net');
  assert.equal(normalizedJid('123456@lid'), '123456@lid');
  assert.equal(isAdmin('123456@lid', new Set(['123456@s.whatsapp.net'])), false);
  assert.equal(normalizedJid('bad@g.us'), null);
});
