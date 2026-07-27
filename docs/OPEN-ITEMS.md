# Open items

State as of **2026-07-27**, after v2 shipped. Read
`docs/design/v2-design.md` first — particularly §3 (non-goals) and §18 (where
implementation diverged from the design) — so decisions already made are not
re-derived.

## Before changing anything

The extension is loaded **unpacked**. Pushing to GitHub does not change what a
browser is running: reload the extension at `chrome://extensions`, then reload
the Gmail tab, or you will be testing the old code.

```bash
node --test "test/*.test.js"   # 57 unit tests, no install
open test/browser/index.html   # 37 DOM tests, no install
npm install && npm run test:e2e # 14 end-to-end tests in a real browser
```

## 1. Three untested paths — highest value, needs a real mailbox

The end-to-end suite runs against a stand-in Gmail built from *our own
understanding* of the markup, which is exactly what was wrong four separate
times. These paths have never seen real mail:

- **Multi-party threads with CC lists.** Everything tested so far is two people
  with no CC. Recipient parsing is the least proven code in the project.
- **Forwarded chains.** `lib/clean.js` must keep forwarded content while
  removing quoted history. That branch has only synthetic coverage.
- **Non-English threads.** German, French and Chinese quote headers are
  implemented; none have been verified against real mail.

`docs/fixtures.md` has the capture-and-redact workflow. One capture per case
becomes a permanent regression test.

## 2. `adapters/gmail.js` is doing too much

At ~416 lines it handles thread identity, session-key acquisition, fetching,
header parsing, body extraction and attachment parsing. Several past bugs were
integration failures inside it. Splitting parsing from fetching is the obvious
cut. Not urgent, but it is the file most likely to hide the next bug.

## 3. Distribution

No tagged release or prebuilt zip yet — install is clone or **Download ZIP**. A
tagged release with an attached zip would make step 1 a single download.

Chrome Web Store submission is **deliberately deferred**: a store extension
auto-updates silently, and "what you read is what runs" is a large part of why
this is trustworthy. Revisit only as a conscious tradeoff.

## 4. Deliberate artifacts — do not silently "fix"

- **Signature images survive** as `[image: name]`, repeating on every message
  from a sender whose signature has a logo. Suppressing trailing images would
  also drop screenshots people meant to send.
- **The signature cut is conservative** — it will not cross a postscript, a
  question mark, or a tail over ~320 characters, so some signatures remain.
- **Inline replies inside quoted blocks are kept with their quotes.**

Each trades noise for never deleting content. That bias is intentional.

## 5. Not implemented, by design

- **No reply threading.** Output is a flat chronological list; a branching
  thread would be linearised. The print view likely cannot supply `In-Reply-To`.
- **No indication of which participant is the mailbox owner**, which an agent
  drafting a reply would benefit from.
- **No OCR, no PDF/Office parsing** — see §3 of the design doc.

## 6. Audit

`docs/AUDIT-BRIEF.md` is a self-contained prompt for an independent adversarial
review. It was written but the review had not been run when v2 shipped. Its
findings, when they arrive, supersede the priorities above.
