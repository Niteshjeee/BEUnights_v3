// File: src/services/plans.js
// Student-first source-catalog plans. An approved admin plan may narrow options,
// but no college needs manual !plan approval merely to register.
import { AcademicPlan } from '../db/models.js';
import { branchesForCollege, lookupSubject, subjectsForSemester } from './catalog.js';
export function planKey(college, branch, curriculum, semester) {
  return `${college}:${branch}:${curriculum}:${semester}`;
}
export function validatePlan({ collegeCode, branchCode, curriculum, semester, coreCodes, electiveGroups = [] }) {
  const sem = Number(semester);
  if (!['old', '2024', '2026'].includes(curriculum) || !Number.isInteger(sem) || sem < 1 || sem > 8)
    throw new Error('Invalid curriculum or semester');
  if (!branchesForCollege(collegeCode).some(x => x.code === String(branchCode)))
    throw new Error('College/branch not in supplied directory');
  const groups = electiveGroups.map(g => ({ name: String(g.name), choose: Number(g.choose), codes: g.codes.map(String) }));
  if (groups.some(g => !g.name || !Number.isInteger(g.choose) || g.choose < 0 || g.choose > g.codes.length))
    throw new Error('Invalid elective-group selection count');
  const all = [...coreCodes.map(String), ...groups.flatMap(g => g.codes)];
  if (!all.length || new Set(all).size !== all.length) throw new Error('Plan needs unique subject codes');
  for (const code of all) if (!lookupSubject(branchCode, code, curriculum, sem))
    throw new Error(`Subject ${code} not in BEU catalog for this branch/curriculum/semester`);
  return { coreCodes: coreCodes.map(String), electiveGroups: groups };
}
export async function approvedPlan(college, branch, curriculum, semester) {
  if (!branchesForCollege(college).some(b => b.code === String(branch))) return null;
  const candidates = subjectsForSemester(branch, curriculum, semester);
  if (!candidates.length) return null;
  // Self-selection uses the full source catalog. It does not claim an elective is verified for the college.
  return { key: planKey(college, branch, curriculum, semester), collegeCode: String(college),
    branchCode: String(branch), curriculum, semester: Number(semester), approved: true,
    version: 1, sourceKind: 'student-declared', coreCodes: [], electiveGroups: [
      { name: 'StudentSelectedSubjects', choose: 0, codes: candidates.map(s => s.code) }
    ] };
}
export async function saveApprovedPlan({ college, branch, curriculum, semester, coreCodes, electiveGroups, actor }) {
  const validated = validatePlan({ collegeCode: college, branchCode: branch, curriculum, semester, coreCodes, electiveGroups });
  const key = planKey(college, branch, curriculum, semester);
  const previous = await AcademicPlan.findOne({ key });
  return AcademicPlan.findOneAndUpdate({ key }, { $set: { collegeCode: String(college), branchCode: String(branch),
    curriculum, semester: Number(semester), ...validated, approved: true, updatedBy: actor,
    version: (previous?.version ?? 0) + 1 } }, { upsert: true, new: true });
}
