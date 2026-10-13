// File: src/services/subject-selection.js
// Pure functions: no network, database, or WhatsApp side effects.
export function parseSubjectNumbers(input, options, { max = 24 } = {}) {
  const raw = String(input ?? '').trim();
  if (!raw || /[,;|]\s*[,;|]/.test(raw) || !/^\d+(?:[\s,;|]+\d+)*$/.test(raw))
    return { ok: false, reason: 'Reply with numbers separated by spaces or commas, e.g. 1 2 3 5.' };
  const tokens = raw.split(/[\s,;|]+/);
  if (tokens.length > max) return { ok: false, reason: `Select at most ${max} subjects.` };
  const seen = new Set();
  const indexes = [];
  for (const token of tokens) {
    const index = Number(token);
    if (!Number.isSafeInteger(index) || index < 1 || index > options.length)
      return { ok: false, reason: `Option ${token} is not in the list (1–${options.length}).` };
    if (seen.has(index)) return { ok: false, reason: `Option ${index} was selected twice.` };
    seen.add(index);
    indexes.push(index);
  }
  const selected = indexes.map(i => options[i - 1]);
  if (selected.length === 0 || new Set(selected.map(x => x.code)).size !== selected.length)
    return { ok: false, reason: 'Invalid or repeated subjects.' };
  return { ok: true, selected };
}

export const selectionsAreEligible = (selected, catalog) => {
  const allowed = new Set(catalog.map(s => String(s.code)));
  return Array.isArray(selected) && selected.length > 0
    && selected.every(s => allowed.has(String(s.code)))
    && new Set(selected.map(s => String(s.code))).size === selected.length;
};
