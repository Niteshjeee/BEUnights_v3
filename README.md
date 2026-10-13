# BEUnights v3 — WhatsApp PYQ backend (Student Subject Selection)

**Backend only. No web frontend. No HTTP port.** The code is a runnable candidate, not a production certification. The source was checked statically; real pairing, group verification, MongoDB, and Telegram integration require Termux testing. Baileys is an unofficial WhatsApp client; no rate limit or educational purpose guarantees against account restrictions.

## What changed since v2.1

- **Student-controlled course choice:** batch → full college directory → college's branch list → semester (1–8) → all BEU branch/curriculum/semester source-listed subjects in **one WhatsApp message** → reply `1 2 3 4` or `1,2,3,4` → review → *confirm and lock*. No `!plan` admin approval is required. Subject names and numbered options are formatted bold for WhatsApp.
- Students may select only source-listed subjects for their current locked branch/curriculum/semester. The bot **does not know** if their college actually assigned that elective; choices are their own declaration. Students should check their timetable/senior's subject list. We do not label college-specific options independently verified.
- Only confirmed subjects are saved in `subjectEntitlements`. **No automatic entitlement to previous semesters:** previous semesters get access once confirmed during use/promotion or through explicit audited admin `!grant-backlog`.
- One confirmed semester's choices remain locked when promoted, so students can still access backlog papers. Next semester requires a new, separate choice and confirmation. Semester 8 can enter `GRADUATED_HOLD` through `!graduate` and keep eligible backlog access.
- Download workers re-check academic entitlement, group membership and admin hold/ban **immediately before sending** a document. A student cannot download another branch's paper by guessing a code.
- **Community upload:** admin `!gate` flags one exact subject + branch + curriculum + exam year + exam type, then an approved paper unlocks **only that combination**, never the entire semester. Students may submit permitted subject PDFs with `!submit` captions; admins inspect with `!pending` and approve/reject.
- Admin `!reset`, `!ban`, `!hold`, `!unban`, `!status` work with explicit internationally formatted number from admin chats (including group commands), or by sending the command from the linked bot account in a student's private chat. Admin permissions remain strict. Self-chat never guesses the target.
- Compulsory BEUPYQ group membership verification **before** sending the bot contact-card prompt; only the bot's own vCard is accepted, which does **not** actually prove the phone number was saved. Group metadata identity matching can be unavailable with mixed phone/LID identifiers; in that case downloads remain unavailable pending retry. Do not share other participants' data.

## Important academic limitations

The attached BEU subject-code PDF contains **catalog options**, not the elective that an individual college actually allocated to a cohort. Students self-declare the correct selections, so a dishonest student could choose an unused same-branch elective. This is not the same as college-verified enrollment. All cross-branch codes are still rejected. Curriculum resolution by admission year (`old` before 2024, `2024` for 2024–25, `2026` starting 2026) is a provisional mapping; verify with BEU/college documents if your cohort differs. The directory contains 60 coded colleges; some have no verified branches in the supplied PDF. Those need manual data correction; the bot does not invent branches.

## Installation in Termux — install separately first

1. **Stop ALL existing bot instances** using `Ctrl+C` (not `Ctrl+Z`). Check `ps -ef | grep '[n]ode'`. A single WhatsApp credential directory must not be used by two running processes.
2. Unzip v3 into a **new folder**, separate from the stable v2.1 installation. Do not overwrite your working project. Preserve backups of `.env`, `private/wa-auth`, and MongoDB.
3. Copy your existing, private `.env` into the new folder; adjust relative paths if needed. `.env.example` is a sample only, not working secrets. To reuse your already-linked WhatsApp session, stop the old instance completely and copy the existing `private/wa-auth` directory into the new folder (or point `AUTH_DIR` to the same absolute path after making a backup). **Never delete a functioning session just to upgrade.**
4. Install and verify:

```bash
npm install
npm run check
npm start
```

No server listens on port 3000/3001. `pino` hides the verbose Baileys handshake/history logs, but important application connection errors are logged. `@whiskeysockets/baileys` is pinned to `6.7.24` to match your previously successful version; updates might require migration.

## Required `.env` configuration

`MONGODB_URI`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `BOT_NUMBER` (country prefix, digits only), `ADMIN_NUMBERS` (comma-separated country-prefix numbers), `WHATSAPP_GROUP_JID` and `WHATSAPP_GROUP_INVITE`.

Other settings: `AUTH_DIR=./private/wa-auth`, `MAX_PDF_MB=15`, `MAX_FILES_PER_REQUEST=5`, `LOG_LEVEL=info`. Keep `.env` private and do not put secrets in chat. Use `node scripts/find-groups.js` only when the main bot is stopped.

## Student WhatsApp commands

`HI` → welcome/register; numeric choices → batch, college, branch, semester, then subjects; `BACK` navigates before academic lock; confirm selected subjects with `1`; `VERIFY` verifies BEUPYQ; send only the *bot's own contact vCard*; `SUBJECTS` lists saved choices; send a six-digit selected subject code (e.g. `104602`) → years and PDF options; `PROMOTE` during an admin-opened window; `HELP`, `PRIVACY`, `STOP`, `START`, `DELETE`; `!submit 104602 2026 regular` with a PDF → admin review. **Students cannot use `!reset`.**

If you previously got `Academic verification pending`, you can send `HI` again after upgrading; the older pending plan state is migrated to student selection automatically. Existing locked records remain preserved. A genuine incorrect locked choice needs an admin `!reset` or audited `!grant-backlog` after validation.

## Admin WhatsApp commands

- `!helpadmin`, `!groups`, `!overview`, `!pending`
- `!upload 104602 2026 104 old regular` attached to a PDF → immediately store and publish.
- `!gate 104602 2026 104 old regular` → gate exact paper until an approved contribution.
- `!approve <24-character-submission-id>`, `!reject <id>`
- `!hold +91 88927 48754`, `!ban +1 (580) 258-5504`, `!unban +918892748754`, `!reset +918892748754`, `!status +918892748754`
- When typing **from the linked bot account inside a student's private chat**: `!hold`, `!unban`, `!reset` with no target number act on that chat. The student will see the outgoing command text, but confirmation is returned to the bot owner's self-chat. Other admin chats and group chats require an explicit number. Unknown LIDs are never mapped by guessing.
- `!promotion-open 2024 5` / `!promotion-close 2024 5`; student can send `PROMOTE` during the open window.
- `!promote +918892748754`; `!promote-batch 2024 5` → next semester selection pending, not an instant unlock. Bulk promotion doesn't broadcast messages.
- `!graduate +918892748754` after Semester 8 → `GRADUATED_HOLD` (not ban/hold).
- `!grant-backlog +918892748754 4 104401` → explicitly audited admin grant for previously completed semester and catalog-listed branch subject.
- `!plan` remains for recording a verified college plan in DB for future reference; v3 registration does NOT assume that plan overrides a student's own selections.

## Safe operation

The queue rate is for load management, **not anti-detection**. Only send files when students explicitly request them; respect opt-outs. Baileys access can be restricted by WhatsApp, so consider official WhatsApp Business Platform options for sustained production use. Telegram Bot API file download limits apply; keep legally authorized PDF backups. Audit submission content and rights before approving public redistribution. No registration number needed. A `DELETE` request removes a student's profile and activity records, and creates/retains a minimal admin-review hold linked to the WhatsApp identifier to prevent immediately bypassing the branch lock; an administrator must clear it before re-registration (as disclosed in the privacy notice).

## Tests to perform on real accounts before production

1. One bot instance, valid MongoDB credentials, WhatsApp connects. Verify group ID with admin `!groups`.
2. Unregistered student `HI` → batch → college 134 → ECE 104 → Semester 7. See 10 **numbered bold** BEU options. Reply `1 2 3 4 8 9 10`; verify exactly 7 selected. Send `2` to revise, then `1` to lock. `HI` must never let the student switch branches afterward.
3. Without joining BEUPYQ `VERIFY` denies. After joining, verification should lead to contact card step; send wrong card (reject), correct bot card (activate).
4. `104602` must be denied if it isn't locked; codes from other branches always denied. Approved locked papers download only if stored in Telegram.
5. Gate a previously completed test exam, submit an authorized PDF for a selected subject, approve, and verify only that subject/year/type gate opens.
6. Test hold/ban/unban/reset from owner in student private chat AND explicit number in self-chat; test `STOP`/`START` cannot bypass academic lock and `DELETE` cannot bypass restrictions.
7. Open promotion window, promote Semester 6→7, select/confirm new subjects; older locked semester access must remain. After admin `!graduate`, only saved eligible backlog subjects remain accessible.

**Tests here verify code structure and pure catalog/selection logic, not real WhatsApp network behavior or 100% curriculum correctness.**
