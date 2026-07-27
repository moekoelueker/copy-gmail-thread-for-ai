# Independent audit brief

> **Historical review input:** this brief describes the pre-2.1 implementation
> and the defects known at that time. It is retained so the audit remains
> reproducible; it is not current product documentation. See
> [`design/v2-design.md`](design/v2-design.md) for the implemented architecture
> and [`OPEN-ITEMS.md`](OPEN-ITEMS.md) for current limitations. Every file
> path, line count, test count and output sample below describes that older
> version and no longer matches the code; run `npm run test:all` for current
> figures.

A self-contained prompt for an AI agent or human reviewer asked to audit this
project. Everything needed to start is below; nothing is assumed from prior
conversation.

---

## Your task

Perform an independent, adversarial audit of a Chrome extension called **Copy
Gmail Thread for AI**.

**Repository:** https://github.com/moekoelueker/copy-gmail-thread-for-ai

```bash
git clone https://github.com/moekoelueker/copy-gmail-thread-for-ai.git
cd copy-gmail-thread-for-ai
node --test "test/*.test.js"    # 57 unit tests, no install needed
open test/browser/index.html    # 37 DOM tests, no install needed
npm install && npm run test:e2e # 14 end-to-end tests in a real browser
```

**Be adversarial and unbiased.** Do not defer to the design document or the
README — both were written by the same author as the code, and both have been
wrong before. Verify claims against the source. If a stated rationale does not
hold up, say so. If a design decision was wrong, say so plainly. A review that
finds nothing is not a good outcome; it means the review was too shallow or too
polite. Equally, do not invent problems to seem thorough — every finding should
come with a concrete failure scenario.

Where you disagree with a deliberate tradeoff listed under *Known tradeoffs*
below, argue the case rather than simply re-reporting it as a defect.

---

## What the tool is

A Chrome MV3 extension that copies an entire Gmail thread to the clipboard as
structured, LLM-ready text, so a user can paste a whole email conversation into
ChatGPT, Claude, or an agent without losing content.

**The problem it solves.** Copying a Gmail thread by hand means expanding every
collapsed message, drag-selecting across signatures and quoted reply chains, and
pasting something that has lost its hyperlinks, flattened its tables, and
repeats the same quoted history once per message. Attachments cannot come at
all. The result is an incomplete paste that a model then reasons over
confidently.

**Core design goals, in priority order:**

1. **Complete** — every message, including ones Gmail collapsed.
2. **Honest** — never report success when the result is partial. A silently
   wrong answer is treated as the worst possible outcome.
3. **Faithful** — links, tables, lists, code, senders, recipients, dates,
   attachments preserved.
4. **High signal** — no quoted chains duplicated N times, no signature blocks.
5. **Local only** — zero network egress beyond Gmail itself. No server, no
   analytics, no storage, no accounts.
6. **Auditable** — zero runtime dependencies, no build step, readable in a
   sitting. This is the project's central security claim.
7. **Installable by anyone** — four steps, no configuration.

---

## How it works

Gmail exposes a legacy **print view** (`?view=pt&th=<threadId>`). One
same-origin request with the user's existing session returns the entire
conversation as static HTML with every message fully expanded. The extension
fetches it, converts each body to markdown, strips quoted chains, extracts
attachments, and writes tagged output to the clipboard.

Pipeline:

```
adapters/gmail.js   locate thread → acquire session key → fetch print view → parse
lib/richtext.js     DOM subtree → markdown (links, tables, lists, code, images)
lib/clean.js        strip quoted chains and signatures
lib/format.js       thread object → tagged output
lib/attachments.js  classify, inline text, sanitise names, download binaries
content.js          orchestration, in-page button, toasts
background.js       keyboard commands, downloads
```

Output format — XML-style tags with markdown bodies:

```
<email_thread>
<meta>
<subject>…</subject><messages>28</messages>
<participants>Jane Doe (jane@acme.com); …</participants>
<date_range>…</date_range><attachment_count>5</attachment_count>
<source>print-view</source><complete>true</complete><url>…</url>
</meta>
<message n="1" date="2026-06-14T14:51:00.000Z" local="Sun, Jun 14, 2026 at 7:51 AM"
         from="Jane Doe" email="jane@acme.com">
<to>Moe Lueker (moelueker@gmail.com)</to>
<body>markdown…</body>
<attachments><attachment name="contract.pdf" type="application/pdf" size="153K"/></attachments>
</message>
</email_thread>
```

---

## Key decisions and why

Challenge any of these.

**Print view over the Gmail API.** OAuth would give structured JSON and
documented headers, but requires a Cloud project, consent screen, and Google
verification for restricted Gmail scopes. That destroys both the 30-second
install and the "nothing leaves your machine" claim. Rejected.

**Print view over raw RFC822 (`view=om`).** Would give authoritative headers and
MIME attachments, but costs one request per message plus a MIME parser handling
base64, quoted-printable, multipart boundaries and charsets — roughly 200 lines
that must be exactly right. Judged not worth it. *Is that the right call?*

**No PDF or Office parsing.** Bundling pdf.js would add 1–2 MB of vendored
minified code to an extension holding a Gmail session, destroying the
auditability claim. Both intended consumers already read PDFs natively.
Attachments are therefore *delivered*, not parsed.

**`scripting` permission removed.** v1 injected into Gmail's MAIN world to read
`window.GLOBALS[9]` (the `ik` session key). v2 reads the same value from the
isolated world via ordinary DOM access, so the extension no longer executes code
in Gmail's JavaScript context. See `findIk()` in `adapters/gmail.js`.

**Tagged output over markdown headings or JSON.** Email bodies contain `#`,
`---` and code fences, so markdown headings are ambiguous as message boundaries.
JSON escapes every newline into `\n` soup. YAML breaks on arbitrarily indented
email text.

**Escaping split by role.** Metadata (`subject`, `to`, `cc`, `participants`) is
fully escaped so structure can never be ambiguous; bodies get minimal escaping
so email discussing HTML or containing code is not mangled. See `escText` vs
`escBody` in `lib/format.js`.

**Both UTC and local timestamps.** An evening reply in a western timezone lands
on the next UTC day, so a twenty-minute turnaround reads as next-day. Both are
emitted.

**Theme handling avoids `prefers-color-scheme`.** That reports the OS theme,
while Gmail's dark theme is a Gmail setting. Button colours derive from
`currentColor` instead.

**Adapter seam, one implementation.** All Gmail specifics sit behind
`pageState` / `getThread` / `getAttachments` so another provider is a new
file. Deliberately no second provider was built.

---

## Bug history — where the weak spots have been

Every one of these shipped and was caught by running against a real mailbox, not
by tests. They indicate where to look hardest.

1. **Copied the wrong conversation.** `document.querySelector("[data-legacy-thread-id]")`
   matched an inbox list row instead of the open thread, and reported success.
2. **Attachments extracted then discarded** — computed into a local, then pushed
   as a hardcoded empty array, after the markup had already been stripped from
   the body.
3. **Recipients never parsed** — the header parser read only the first row; the
   print view puts recipients on a later one.
4. **Sender addresses corrupted** — `headerText` did not break on `<td>`, so an
   address absorbed the adjacent date cell (`jennifer@example.comSun`).
5. **Raw angle brackets in metadata** — recipients emitted as `Name <addr>` put
   what reads as an opening tag inside the document.
6. **Attachments never processed** — extraction populated each message but
   nothing routed those entries through the attachment pipeline, so the save
   action silently downloaded nothing.

A pattern worth weighing: several were *integration* failures between correct
units. Consider whether the module boundaries invite this.

---

## Known tradeoffs (argue with these, don't just list them)

- **Signature images survive** as `[image: name]`, repeating on every message.
  Suppressing trailing images would also drop screenshots people meant to send.
- **Signature text cut at a closing salutation**, guarded to never cross a
  postscript, a question mark, or a tail over ~320 characters. Some signatures
  therefore survive.
- **Inline replies inside quoted blocks are kept with their quotes** when the
  stripper detects real prose there — keeping noise over deleting a reply.
- **No reply threading.** Output is a flat chronological list; a branching
  thread would be linearised.
- **Attachment and recipient parsing depend on undocumented markup** that Google
  can change at any time.

---

## Files

All paths relative to the repository root.

**Extension (~2,000 lines, ships to users):**

| File | Lines | Role |
|---|---|---|
| `manifest.json` | 64 | MV3 manifest, permissions, commands |
| `adapters/gmail.js` | 416 | All Gmail specifics: thread id, `ik`, print view, header and attachment parsing |
| `content.js` | 248 | Orchestration, in-page button, toasts, clipboard |
| `background.js` | 68 | Service worker: keyboard commands, downloads |
| `lib/richtext.js` | 202 | DOM → markdown |
| `lib/attachments.js` | 179 | Classify, inline, sanitise, download |
| `lib/clean.js` | 166 | Quoted-chain and signature removal |
| `lib/text.js` | 161 | Dates, filename sanitising, URL and address handling |
| `lib/format.js` | 152 | Thread object → tagged output, escaping |
| `content.css` | 107 | Injected button and toast styling |
| `popup.html` / `popup.js` / `popup.css` | 250 | Discoverability surface |
| `icons/` | — | PNGs plus SVG sources |

**Tests (~1,100 lines, never ships):**

| File | Lines | Role |
|---|---|---|
| `test/text.test.js` | 125 | Sanitising, dates, addresses, URLs |
| `test/clean.test.js` | 174 | Quote and signature stripping |
| `test/format.test.js` | 182 | Output structure and escaping |
| `test/attachments.test.js` | 62 | Classification, dedup, path safety |
| `test/browser/index.html` | 232 | 37 DOM tests, opened directly in a browser |
| `test/e2e/harness.js` | 144 | Loads the real extension into Chromium, serves a stand-in Gmail at the real origin |
| `test/e2e/copy.test.js` | 146 | 14 end-to-end tests |
| `test/e2e/real-fixtures.test.js` | 110 | Property tests over redacted real captures |
| `test/e2e/fixtures/` | — | Synthetic Gmail page and print views |
| `tools/redact-fixture.js` | 187 | Turns a real capture into a committable fixture |

**Documentation:**

| File | Role |
|---|---|
| `README.md` | User-facing: install, format, permissions, limitations |
| `docs/design/v2-design.md` | Full design record, including rejected alternatives and where implementation diverged |
| `docs/manual-test.md` | Checklist for what automation cannot reach |
| `docs/fixtures.md` | How to capture and redact real threads as fixtures |

---

## What to examine

Cover all of the following. Depth matters more than breadth of headings.

**1. Security.** The extension holds a Gmail session key and reads mail. Verify
independently: is there genuinely no exfiltration path? Confirm the permission
set is minimal and that the README's claims are true of the code. Examine
filename sanitisation in `lib/text.js` (attachment names are attacker-controlled
— anyone can email a file called `../../.zshrc`), the download path guard in
`background.js`, the message listener's sender validation, and whether removing
`scripting` genuinely eliminated the MAIN-world capability. Look for XSS or
injection via hostile email content. Consider what a malicious sender could do.

**2. Correctness.** Given the bug history, hunt integration failures between
correct units. Trace data end to end. Where can a wrong answer be produced that
*looks* right? The project's stated worst-case is a silent wrong result — find
any remaining path to one.

**3. Architecture and code quality.** Are the module boundaries right? Is the
adapter seam real abstraction or decoration? Is `adapters/gmail.js` at 416 lines
doing too much? Are the pure/impure boundaries honest? Is anything
over-engineered, or under-engineered given its risk?

**4. Robustness.** Gmail's markup is undocumented and will change. How gracefully
does this degrade? Are failures loud where they must be? Consider edge cases the
tests miss: multi-party threads with large CC lists, forwarded chains,
right-to-left text, encrypted mail, calendar invites, very long threads,
conversation-view disabled, Spam and Trash, multiple signed-in accounts.

**5. Output format for LLM consumption.** You are a consumer of this format.
Read the example above and judge it honestly. Could you reliably answer "who
said what, when, to whom, with which attachment" from it? What is missing or
ambiguous? Is the tagged form the right choice, or would something else serve a
model better? Be specific.

**6. Usability.** Install flow, discoverability, error messages, the popup,
keyboard shortcuts, accessibility, dark mode, and behaviour off Gmail.

**7. Testing.** Do the tests test the right things, or do they encode the
implementation's assumptions? Where would a mutation survive? The DOM tests and
the mock Gmail were written by the same author as the parser — identify where
that circularity hides real risk.

**8. Documentation honesty.** Does the README overclaim? Are the stated
limitations complete? Is anything true of the docs but not the code?

---

## What to deliver

- **Findings ordered by severity**, each with: the file and line, a concrete
  failure scenario (specific inputs or conditions producing a wrong or harmful
  outcome), and a suggested fix.
- **Separate what is broken from what is merely improvable.** Do not inflate
  style preferences into defects.
- **An explicit verdict on the security claims**, since those are the reason a
  user would choose this over a Web Store extension.
- **Your honest assessment of the output format** as something you would have to
  read.
- **What you would build differently** if starting over, and whether that is
  worth the migration.

State your confidence for each finding, and say plainly which parts you could
not verify without a live Gmail session.
