# Hardening progress (audit remediation)

Working record for the fixes that followed the 2026-07-27 adversarial audit.
Delete this file once the work is merged; it is scaffolding, not documentation.

Baseline before this work: `npm test` 72 pass, `npm run test:browser` 51 pass,
`npm run test:e2e` 19 pass + 1 skip.

## Checklist

- [x] **B1 — attachment duplication (BLOCKER).** `content.js` runs a live-DOM
      attachment scan even when the print view already produced a complete,
      attributed list, and merges the two by exact resolved-URL string equality.
      Real Gmail's live chip URL and print-view URL for the same file differ
      (`ui`, `ik`, `permmsgid`, `realattid`), so one attachment becomes 2-4
      entries, `completeness.attachments` flips to false, two spurious warnings
      fire, and save mode downloads the file twice.
      Fix: (a) collapse the live scan to one candidate per chip container;
      (b) match supplemental against primary by capability key
      (`realattid` > `permmsgid|attid` > `attid`) and then by a
      (name, size) multiset, not by full href.

- [x] **B2 — worker boundary untested (BLOCKER).** Deleting the sender gate in
      `background.js`, or replacing `S.resolveAttachmentUrl(msg.url, context)`
      with raw `msg.url`, leaves all 143 tests green.
      Fix: move the whole authorization decision into
      `S.authorizeDownload(msg, sender, runtimeId)` so it is exhaustively
      unit-testable with forged senders, and add an e2e test that proves
      `background.js` really calls it (account switches mid-capture -> the
      worker must refuse the download even though the content script already
      validated the URL).

- [x] **H3 — forged attachment metadata.** `ATTACH_ICON` in
      `adapters/gmail-parse.js` matches `img[src*="/icons/mail/images/"]` on any
      origin, so an email body can inject a fabricated attachment entry.
      Fix: origin-anchor the icon test via a shared `T.isGmailUiIcon()` helper;
      use the same helper in `lib/richtext.js`, whose identical substring test
      also silently drops legitimate third-party images.

- [x] **H4 — hostile `h2.hP` disables the extension.** An email body containing
      its own `h2.hP` makes `subjectEl()` ambiguous, so no controls attach and
      the popup wrongly says "No thread open".
      Fix: exclude candidates inside message bodies, and report ambiguity as its
      own state with an accurate message instead of "open a thread first".

- [x] **M5 — redactor leaks PII.** `LETTERS = /[A-Za-zÀ-ɏ]{2,}/g` leaves every
      digit and every non-Latin script verbatim (SSN, IBAN, account/routing
      numbers, DOB, MRN, full CJK/Cyrillic/Arabic/Greek sentences).
      Fix: `\p{L}{2,}` with `/gu`, scrub long digit runs and known PII shapes
      while keeping dates parseable, correct `docs/fixtures.md`.

- [x] **M6 — derived ISO timestamp.** `toIso` reinterprets Gmail's
      timezone-less string in the browser timezone. Emit the capture timezone so
      the derivation is auditable, and document the assumption.

- [x] **L7 — `findIk` caches `null` for the page lifetime.** Track stale keys
      instead, so a later valid `ik` can still be found.

- [x] **L8 — fixture PII.** Replace the author's real address and the plausible
      real counterparty in `test/e2e/fixtures/` with `example.com` identities.

- [x] **D9 — docs honesty.** Qualify the macOS/Windows claim in `README.md`,
      correct the redactor claim in `docs/fixtures.md`, note the stale counts in
      `docs/AUDIT-BRIEF.md`.

- [x] **P10 — packaging.** Add `npm run package` producing a ZIP of runtime
      files only, with a test asserting the archive's file list.

- [x] **P11 — privacy policy.** Add `PRIVACY.md` and link it from `README.md`.

- [x] **V12 — verification.** `npm ci`, `npm run test:all`, `git diff --check`,
      re-run the B2 mutations and confirm they now FAIL, restore `background.js`,
      confirm `git status --short` matches the baseline.

## Constraints that must not be broken

- Zero runtime dependencies, no build step, no remote code, no `eval`, no
  analytics, no server. Playwright stays a devDependency.
- No OAuth, no API key, no extension account. Existing Gmail session only.
- Permissions stay exactly `["downloads","clipboardWrite"]` plus
  `https://mail.google.com/*`.
- Never weaken thread/subject identity checks, attachment URL validation, or
  partial-capture signaling to make an unusual thread look successful.

## Cannot be fixed from here

A live-Gmail pass and a Windows pass remain **Unverified**. They need real
credentials and a real Windows machine. `docs/manual-test.md` is the checklist.


## Status: complete

`npm run test:all` — 83 unit, 51 browser, 31 e2e (1 skipped: no reviewed
live-Gmail capture exists). `npm ci` reports 0 vulnerabilities.
`git diff --check` clean.

Mutation battery: 18 of 18 caught, including the two that previously survived
(worker sender gate, worker URL revalidation).

Found and fixed during the follow-up adversarial pass, not in the original
audit: **the live attachment-chip scan read the whole document, so a message
body containing chip markup could add attacker-named attachments to the thread**
(`adapters/gmail.js`, now scoped out of `MESSAGE_BODY`; regression test
"a sender cannot inject attachment chips through a message body").

Also removed during that pass: a chip-container dedup in `getAttachments` that
no realistic input could distinguish from the existing key dedup. Unreachable
defensive code is a liability in a codebase whose central claim is auditability.

Still **Unverified** and not fixable without hardware/credentials:
a live-Gmail pass and a Windows pass. See `docs/manual-test.md`, which now has a
Windows-specific section.

Delete this file once the work is merged.
