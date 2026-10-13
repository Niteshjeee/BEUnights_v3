// File: tests/academic-auto.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { branchesForCollege, subjectsForSemester } from '../src/services/catalog.js';
import { parseSubjectNumbers, selectionsAreEligible } from '../src/services/subject-selection.js';

const courses = subjectsForSemester('104', 'old', 7);
test('GEC Banka ECE has ten source-listed Semester 7 options', () => {
  assert.ok(branchesForCollege('134').some(b => b.code === '104'));
  assert.equal(courses.length, 10);
  assert.ok(courses.some(s => s.code === '104701'));
  assert.ok(courses.some(s => s.code === '104711'));
});
test('valid multi-choice formats produce exactly selected subjects', () => {
  const a = parseSubjectNumbers('1 2 3 4 8 9 10', courses);
  const b = parseSubjectNumbers('1,2,3,4,8,9,10', courses);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.deepEqual(a.selected.map(s => s.code), b.selected.map(s => s.code));
  assert.equal(a.selected.length, 7);
  assert.equal(a.selected.at(-1).code, courses[9].code); // 10 is NOT option 1 and 0.
  assert.ok(selectionsAreEligible(a.selected, courses));
});
test('duplicate, extra and arbitrary code choices are rejected', () => {
  for (const input of ['1 1 2', '1,11', '0 1', '104601', '1&2', '1 -2', '', '1,,2']) {
    assert.equal(parseSubjectNumbers(input, courses).ok, false, input);
  }
  assert.equal(selectionsAreEligible([{ code: '105601' }], courses), false);
  assert.equal(selectionsAreEligible([{ code: '104701' }, { code: '104701' }], courses), false);
});
test('old ECE Semester 6 candidates include 104602 and no other-branch code', () => {
  const list = subjectsForSemester('104', 'old', 6);
  assert.equal(list.length, 7);
  assert.equal(list.some(s => s.code === '104602'), true);
  assert.equal(list.some(s => s.code === '105601'), false);
});
test('college directory fixes confirmed from uploaded PDF', () => {
  assert.equal(branchesForCollege('136').some(b => b.code === '101'), true);
  assert.equal(branchesForCollege('122').some(b => b.code === '102'), true);
});
