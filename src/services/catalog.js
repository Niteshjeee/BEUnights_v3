// File: src/services/catalog.js
import { readFileSync } from 'node:fs';

function read(relative) {
  return JSON.parse(readFileSync(new URL(`../../data/${relative}`, import.meta.url), 'utf8'));
}
const subjects = read('subjects.json');
const branches = read('branches.json');
const collegeBranches = read('college-branches.json');
const colleges = read('colleges.json');

export function collegeCodes() { return Object.keys(colleges).sort((a, b) => Number(a) - Number(b)); }
export function collegeLabel(code) { return colleges[String(code)] ?? null; }
export function isCollege(code) { return Object.hasOwn(colleges, String(code)); }
export function branchesForCollege(code) {
  return (collegeBranches[String(code)] ?? [])
    .map((c) => ({ code: String(c), name: branches[String(c)] }))
    .filter((x) => x.name);
}
export function branchLabel(code) { return branches[String(code)] || `Branch ${code}`; }
export function curriculumForAdmission(batch) {
  if (batch >= 2026) return '2026';
  if (batch >= 2024) return '2024';
  return 'old';
}
export function lookupSubject(branchCode, code, curriculum, semester = null) {
  return subjects.find((s) => s.branchCode === String(branchCode) && s.code === String(code)
    && (semester === null || s.semester === Number(semester))
    && (s.curricula.includes('all') || s.curricula.includes(curriculum))) ?? null;
}
export function subjectsForSemester(branchCode, curriculum, semester) {
  const candidates = subjects.filter((s) => s.branchCode === String(branchCode)
    && s.semester === Number(semester) && (s.curricula.includes('all') || s.curricula.includes(curriculum)));
  return [...new Map(candidates.map((s) => [s.code, s])).values()].sort((a, b) => a.code.localeCompare(b.code));
}
export function subjectCandidates(code) { return subjects.filter((s) => s.code === code); }
export function catalogStats() {
  return { entries: subjects.length, branches: new Set(subjects.map((s) => s.branchCode)).size,
    colleges: collegeCodes().length };
}
