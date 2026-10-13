# File: scripts/build_catalog.py
# File: scripts/build_catalog.py
"""Extract a reviewable subject catalog from the supplied BEU subject PDF.

The source is a student-maintained code reference, not verified official truth.
Preserves the raw subject names and edition markers without guessing a rename.
"""
from pathlib import Path
import json
import re
import sys
import fitz

SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('BEU_SubjectCodes_Sem_1_2_3_4_5_6_7_8.pdf')
OUTPUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path('data/subjects.json')

def versions(label: str):
    has_old = bool(re.search(r'\(OLD\)', label, re.I))
    has_24 = '(24)' in label or '(24+26)' in label
    has_26 = '(26)' in label or '(24+26)' in label
    # An untagged newer alias following an OLD name means the modern cohorts can also use it.
    modern_untagged = has_old and any(not re.search(r'\(OLD\)|\(24\)|\(26\)|\(24\+26\)', part, re.I) for part in label.split(' / ')[1:])
    if not (has_old or has_24 or has_26):
        return ['all']
    result = []
    if has_old:
        result.append('old')
    if has_24 or modern_untagged:
        result.append('2024')
    if has_26 or modern_untagged:
        result.append('2026')
    return result

sem = None
branch = None
rows = []
current = None
skip_prefix = ('BEU Previous Year Question Paper', 'Note:', 'Contact us on Telegram:',
               't.me/', 'telegram.me/', 'Code', 'Subject Name(s)')
for page_index, page in enumerate(fitz.open(SOURCE), 1):
    for line in page.get_text('text').splitlines():
        line = line.strip()
        if not line:
            continue
        if 'Disclaimer:' in line or 'website.After 2024 session' in line:
            if current is not None:
                rows.append(current)
                current = None
            break
        match = re.fullmatch(r'SEMESTER\s*-\s*(\d+)', line)
        if match:
            sem = int(match.group(1))
            continue
        match = re.fullmatch(r'Branch:\s*(.*?)\s*\((\d+)\)', line)
        if match:
            if current is not None:
                rows.append(current)
                current = None
            branch = {'name': match.group(1), 'code': match.group(2)}
            continue
        if line.startswith(skip_prefix):
            continue
        if re.fullmatch(r'\d{6}', line):
            if current is not None:
                rows.append(current)
            current = {'semester': sem, 'branchCode': branch['code'] if branch else None,
                       'code': line, 'label': '', 'sourcePage': page_index}
        elif current is not None:
            current['label'] = (current['label'] + ' ' + line).strip()
if current is not None:
    rows.append(current)
for row in rows:
    row['curricula'] = versions(row['label'])
rows = [row for row in rows if row['code'] and row['label'] and row['branchCode'] and row['semester']]
rows.sort(key=lambda x: (x['semester'], int(x['branchCode']), x['code']))
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
print(f'Wrote {len(rows)} entries across {len(set(r["branchCode"] for r in rows))} branches to {OUTPUT}')
