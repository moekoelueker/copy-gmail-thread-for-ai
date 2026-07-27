# Copy Gmail Thread for AI — v2 design

**Date:** 2026-07-26
**Status:** approved for planning
**Owner:** Moe Lueker / Zena Labs LLC

---

## 1. Problem

Getting an email conversation out of Gmail and into an LLM is manual and lossy. You
scroll, expand collapsed messages one at a time, drag-select across signatures and
legal disclaimers, and paste something that has lost its links, its tables, and half
its context. Attachments cannot come along at all.

The tool should do this in one keystroke, completely, faithfully, and without any
data leaving the machine.

## 2. Goals

1. **Complete.** Every message in the thread, including ones Gmail collapsed.
2. **Faithful.** Preserve links, tables, lists, code, sender, recipients, dates.
3. **High signal.** No quoted reply chains duplicated N times. No signatures.
4. **Attachments delivered.** Text-like ones inlined; everything else saved to disk
   and referenced by path.
5. **One action.** A single remappable shortcut, or one button.
6. **Local only.** Zero network egress. No server, no analytics, no storage, no accounts.
7. **Honest.** Never report success when the result is partial. Every failure mode
   produces a specific, actionable message.
8. **Auditable.** Zero runtime dependencies. No build step. Readable in one sitting.
9. **Installable by anyone.** Four steps, no configuration.

## 3. Non-goals (explicit YAGNI)

These are deliberately excluded. Each has a reason, so we do not relitigate them.

| Excluded | Reason |
|---|---|
| Gmail API / OAuth | Needs a Cloud project, consent screen, and Google verification for Gmail scopes. Destroys both the 30-second install and the local-only story. |
| Bundling pdf.js / docx parsers | ~1–2 MB of vendored minified code inside an extension holding a Gmail session. Destroys auditability, which is the project's main security claim. Both target consumers (Claude Code, claude.ai) already read PDFs natively. |
| Raw RFC822 (`view=om`) extraction | Better header fidelity, but costs one request per message plus a MIME parser handling base64, quoted-printable, multipart boundaries and charsets. Not worth ~200 lines that must be exactly right. |
| Other mail providers (Outlook, Proton…) | Out of scope for v2. The adapter seam exists so this is one new file later, not a refactor. |
| Options page / `chrome.storage` | The only setting people want to change is the shortcut, and `chrome://extensions/shortcuts` already provides it. Adds a permission and persistent state for no gain. |
| Drag-out file affordance | Real technique (`dataTransfer.items.add(new File(...))`), but mid-drag tab switching is finicky. The Save action plus a drag from Finder covers the same need with less code. |
| Chrome Web Store submission | Deferred to a separate decision. The GitHub release is the v2 distribution channel. |
| i18n | English only. |

## 4. Architecture

### 4.1 Substrate decision

Keep Gmail's print view (`?ik=<ik>&view=pt&search=all&th=<threadId>`) as the primary
extraction path. One same-origin request returns every message with full bodies,
including collapsed ones, with no UI manipulation. Alternatives were considered and
rejected in §3.

### 4.2 Module layout

```
adapters/gmail.js     detect thread, acquire ik, fetch print view, enumerate attachments
lib/richtext.js       DOM subtree -> markdown (links, tables, lists, code, images)
lib/clean.js          strip quoted chains and signatures, with a safety valve
lib/format.js         thread object -> tagged output, with escaping
lib/attachments.js    classify, inline text, sanitize names, request downloads
content.js            orchestration, button, toast, keyboard entry
background.js         commands, downloads, ik fallback (only if §4.4 requires it)
popup.html / popup.js discoverability surface and off-Gmail explainer
test/                 node --test, redacted fixtures, zero dependencies
```

`lib/*` are pure functions: input string or DOM node, output data. No network, no
`chrome.*`, no globals beyond their own namespace. This is what makes them testable
in Node without a browser or a dependency.

### 4.3 Adapter interface

`adapters/gmail.js` implements exactly three methods. Ship Gmail only; the interface
exists so a second provider is additive.

```js
{
  isThreadOpen()   -> boolean
  getThread()      -> Promise<Thread | {error: ErrorCode}>
  getAttachments() -> Promise<AttachmentMeta[]>
}
```

`Thread` shape:

```js
{
  subject: string,
  url: string,
  source: 'print-view' | 'dom-fallback',
  complete: boolean,          // false when dom-fallback may have missed messages
  quotedTrimmed: boolean,
  messages: [{
    n: number,
    from: {name: string, email: string},
    to: string[], cc: string[],
    date: string|null,        // ISO 8601 UTC
    dateRaw: string,          // always the original string
    body: string,             // markdown
    attachments: AttachmentMeta[]
  }]
}
```

### 4.4 Session key acquisition — implementation step one

Today the extension holds the `scripting` permission and injects into Gmail's MAIN
world solely to read `window.GLOBALS[9]`. That is its most sensitive capability:
running code inside Gmail's own JavaScript context.

The value is very likely reachable from the isolated world with plain DOM access.
Try, in order, and stop at the first that works:

1. Parse `ik=` out of an existing Gmail link `href` in the DOM.
2. Regex `GLOBALS=[...]` out of inline `<script>` text via `document.scripts`.
3. Test whether the print view responds correctly with `ik` omitted entirely.
4. Only if 1–3 all fail: keep the MAIN-world injection as today.

**If any of 1–3 succeeds, remove the `scripting` permission and the MAIN-world
injection from the shipped extension.** This must be verified against a live Gmail
session before the manifest is finalised. Record which rung worked in the README's
permissions table.

## 5. Output format

XML-style tags with markdown bodies. Rationale: email bodies routinely contain `#`,
`---`, and code fences, so markdown headings are ambiguous as message boundaries.
JSON would escape every newline into `\n` soup. YAML breaks on arbitrarily indented
email text. Tagged structure gives unambiguous boundaries, stays readable, survives
truncation, and is what Claude is tuned to parse.

```
<email_thread>
<meta>
<subject>Q3 renewal terms</subject>
<messages>6</messages>
<source>print-view</source>
<complete>true</complete>
<url>https://mail.google.com/mail/u/0/#inbox/FMfcgz…</url>
</meta>
<message n="1" date="2026-07-07T16:03:00Z">
<from name="Jane Doe" email="jane@acme.com"/>
<to>bob@acme.com, you@example.com</to>
<body>
Body as markdown, with [links](https://example.com) and tables preserved.
</body>
</message>
</email_thread>
```

Rules:

- `<source>` is `print-view` or `dom-fallback`, matching `Thread.source` in §4.3.
- `<complete>` is `false` whenever the DOM fallback ran. The model reading the output
  must be able to tell that messages may be missing — warning only in the toast is not
  enough, since the toast is gone by the time the text is pasted.
- Omit `<to>`, `<cc>`, and `<attachments>` entirely when empty. Do not emit empty tags.
- `<from>` uses attributes because email addresses contain `<` and `>`, which would
  otherwise break the structure.
- **Attribute escaping:** `&` → `&amp;`, `"` → `&quot;`, `<` → `&lt;`.
- **Body escaping:** escape *only* sequences that could be misread as one of our own
  closing tags (`</body>`, `</message>`, `</email_thread>`, case-insensitive) by
  replacing the `<` with `&lt;`. Do not escape all `<`, which would mangle emails
  discussing HTML or containing code.
- **Dates:** normalise to ISO 8601 UTC in `date`. If parsing fails, omit `date` and
  emit `date_raw="<original string>"`. Never fabricate a date.
- Messages are ordered oldest first, and `n` is assigned after ordering.

## 6. Rich text extraction (`lib/richtext.js`)

Replaces the current `textOf`, which discards links and flattens tables.

| Element | Output |
|---|---|
| `<a href>` | `[text](url)`; bare url if text equals href |
| Gmail redirect wrapper | Unwrap `google.com/url?q=<real>` to the real target |
| `<a>` with `data:` or `javascript:` href | Render text only, drop the href |
| `<img src="http(s)">` | `![alt](src)` |
| `<img src="data:">` or `cid:` | `[inline image: alt or filename]` — never inline base64 |
| `<table>` | Markdown table; `<th>` row as header, else synthesise a separator; newlines inside cells collapse to spaces |
| `<ul>` / `<ol>` / `<li>` | `- ` / `1. `, indented by nesting depth |
| `<pre>`, `<code>` | Fenced block / inline backticks |
| `<b>`, `<strong>` / `<i>`, `<em>` | `**` / `*` |
| `<blockquote>` not `.gmail_quote` | `> ` prefix |
| `<br>` | newline |
| Block elements | trailing newline |
| `<hr>` | `---` |
| `<style>`, `<script>`, `<head>` | dropped entirely |

Three or more consecutive newlines collapse to two. Output is always produced with
`textContent`-level primitives; `innerHTML` is never used anywhere in the codebase.

## 7. Quote and signature stripping (`lib/clean.js`)

The current code copies each message's full body including its quoted reply chain, so
an n-message thread carries roughly O(n²) text. This is the single largest quality
defect.

**Remove:** `blockquote.gmail_quote`, `div.gmail_quote`, `.gmail_extra > blockquote`,
`div.gmail_signature`, Outlook's `div#appendonsend` and its following siblings, and a
trailing `On <date>, <name> wrote:` line when it introduces removed content.

**Cut at:** a line consisting of exactly `--` or `-- ` (signature delimiter).

**Never remove:** `---------- Forwarded message ---------` blocks. Forwarded content is
real content, not quoted history.

**Safety valve.** Inline replies written *inside* a quoted block are the known hard
case. If stripping would remove more than 90% of the body's characters *and* leave
fewer than 30 characters, discard the strip and keep the original body. Stripping must
never turn a non-empty body into an empty one. Set `quotedTrimmed` on the thread when
any trimming occurred so the UI can say so.

## 8. Attachments (`lib/attachments.js`)

**Discovery.** Parse attachment metadata from the print view HTML. Whether the print
view exposes filenames and download URLs must be verified empirically against a real
thread; if it does not, fall back to the live DOM and construct `view=att` URLs from
the thread id and attachment id.

**Inline (copy action).** Extension allowlist: `.txt .md .csv .tsv .json .log .xml
.yml .yaml .ics`. Fetch same-origin, decode UTF-8, inline into the output. Cap at
100 KB per file and 300 KB total; on exceeding, truncate and append an explicit
`[truncated: N of M bytes]` marker.

**Download (save action only).** Everything else goes to
`gmail-threads/<subject-slug>/` via `chrome.downloads`, and is listed in the output
with its path, type, and size. Files over 25 MB are skipped and noted.

Downloads happen **only** on the explicit Save action, never on a plain copy —
otherwise every keystroke litters the Downloads folder.

**Filename sanitisation (security).** Attachment filenames are attacker-controlled;
anyone can email a file named `../../.zshrc` or one containing control characters.
`chrome.downloads` rejects `..`, but we do not rely on that. Sanitiser: strip path
separators and control characters, strip leading dots, allow only
`[A-Za-z0-9._ -]`, collapse repeated separators, truncate to 100 characters while
preserving the extension, and de-duplicate collisions with ` (2)`. The same sanitiser
produces the subject-derived folder name, falling back to the thread id when the
subject sanitises to empty.

## 9. Shortcuts and clipboard

Remove the double-⌘C listener entirely. It hijacks the clipboard, depends on a 450 ms
timing window, and cannot be remapped.

Use the `commands` API:

| Command | Default | Action |
|---|---|---|
| `copy-thread` | `Alt+C` (Option+C on macOS) | Copy thread to clipboard |
| `save-thread` | `Alt+Shift+C` | Copy, plus download binary attachments |

Chrome consumes these before the page sees them, so Option+C types no `ç` and normal
copy is untouched. Users remap at `chrome://extensions/shortcuts` — this is why no
options page is needed.

**Clipboard write path.** Since Chrome 107 a command-triggered
`navigator.clipboard.writeText()` can raise a clipboard permission dialog. Therefore:

- Button click (has transient user activation) → `navigator.clipboard.writeText`.
- Command-triggered → hidden `<textarea>` + `document.execCommand('copy')`, which the
  `clipboardWrite` permission covers without a gesture.

Verify empirically; if the async API proves clean from the command path, prefer it and
delete the fallback.

## 10. UI

**Gmail button.** Keep placement next to the subject. Add: a
`prefers-color-scheme: dark` variant (current CSS hardcodes `#fef3e2` / `#92400e` and
will look broken in Gmail's dark theme, which is widely used), a `:focus-visible`
ring, and an `aria-label`.

**Toast.** `role="status"` and `aria-live="polite"` so it is announced. Text set with
`textContent` only.

**MutationObserver.** Currently fires `attachButton` on every Gmail DOM mutation.
Debounce on a 250 ms trailing edge. Keep the existing context-death disconnect.

**Popup** (`popup.html`, no new permissions). On Gmail: Copy button, Save button, the
current shortcut, and a link to `chrome://extensions/shortcuts`. Off Gmail: "Open a
Gmail thread to use this." This is the discoverability surface for users who will not
read a README, and it is what makes the extension self-explanatory.

## 11. Error handling

Every `catch (_) {}` is replaced. All failures log `console.warn('[copy-gmail-thread]', …)`
with detail and surface a specific toast.

| Code | Toast |
|---|---|
| `NOT_ON_THREAD` | Open an email thread first. |
| `NO_IK` | Couldn't read Gmail's session key — reload Gmail and retry. |
| `NOT_LOGGED_IN` | Gmail session expired — reload and sign in. |
| `FETCH_FAILED` | Gmail returned {status} — reload and retry. |
| `PARSE_EMPTY` | Print view returned no messages — using visible messages instead. |
| `FALLBACK_PARTIAL` | ⚠ Copied N visible messages — collapsed messages may be missing. |
| `CLIPBOARD_BLOCKED` | Clipboard blocked — click the page and try again. |
| `DOWNLOAD_FAILED` | Saved N of M attachments; see console for details. |
| success | ✓ Copied N messages · M attachments · quoted text trimmed |

**Login-page detection:** if `resp.url` contains `accounts.google.com` or
`ServiceLogin`, raise `NOT_LOGGED_IN` rather than parsing a sign-in page as a thread.

**Never report success when partial.** `FALLBACK_PARTIAL` is a distinct, visibly
different message from success. This is the fix for the current silent-partial-copy
behaviour, which is the most damaging existing defect because it looks like success.

**Size guard.** Above 400 KB or 150 messages, copy anyway but state the size in the
toast. No modal dialogs — they block the extension's own event loop.

## 12. Edge cases

Handled explicitly, each with a test or a documented behaviour:

1. Inbox list view, not a thread → `NOT_ON_THREAD`.
2. Multiple accounts (`/u/0`, `/u/1`, no `/u/` segment) → derive index, default `0`.
3. Conversation view disabled in Gmail settings → single-message threads still work.
4. Threads in Spam or Trash → `search=all` may not cover; fall back to the DOM path.
5. Draft messages inside a thread → excluded, noted in output if present.
6. **Attachment-only or image-only message with an empty body** → currently dropped
   silently by `if (body)`. Must be retained with an explicit `[no text content]`
   body so the message is not invisible.
7. Very long threads → size guard.
8. Inline base64 images → never inlined (§6).
9. Non-Latin scripts, RTL text, emoji, zero-width characters → preserved verbatim.
10. Calendar invites (`text/calendar`) → inlined as text via the `.ics` allowlist.
11. Encrypted / S-MIME bodies → not decrypted; noted as unreadable.
12. Gmail confidential mode → print view unavailable; expect fallback.
13. Print view removed by Google → DOM fallback plus `FALLBACK_PARTIAL`.
14. Session expired mid-use → `NOT_LOGGED_IN`.
15. Offline → `FETCH_FAILED`.
16. Extension reloaded while Gmail is open → existing context-death path removes UI.
17. Malicious attachment filename → sanitiser (§8).
18. Malicious HTML in a body → `innerHTML` is never used; invariant covered by a test.

## 13. Security model

| Permission | Why | Change |
|---|---|---|
| `host: mail.google.com` | Read the open thread | unchanged |
| `scripting` | MAIN-world `ik` read | **removed if §4.4 rungs 1–3 succeed** |
| `downloads` | Save attachments | **new** — writes only inside the Downloads folder |
| `clipboardWrite` | Write from the command path | **new** |
| `commands` | Remappable shortcuts | new manifest key, not a permission |

Unchanged invariants: no `storage`, no `<all_urls>`, no host beyond
`mail.google.com`, no analytics, no remote code, no `eval`, no `innerHTML`, no build
step, zero runtime dependencies. Exactly one network request per copy, same-origin.

Net effect: the extension gains the ability to write files into the Downloads folder
and, if §4.4 succeeds, loses the ability to execute code in Gmail's own context. That
is a favourable trade.

## 14. Testing

`node --test` with Node's built-in runner. Zero dependencies. A ~15-line `node:vm`
loader evaluates the browser-global `lib/*` modules into a sandbox so they can be
tested without a browser.

Fixtures are **synthetic or hand-redacted**. Real email is never committed.

| Fixture | Asserts |
|---|---|
| Single message | Baseline parse |
| 8-message nested quoting | No duplication; output size is O(n) not O(n²) |
| Inline reply inside a quote | Safety valve keeps the body |
| Tables, lists, links, code | Markdown fidelity |
| Gmail redirect-wrapped links | Unwrapped to the real target |
| Attachment-only, empty body | Message retained, not dropped |
| Body containing `</message>` | Escaped; structure intact |
| RTL, emoji, non-Latin | Preserved byte-for-byte |
| Filename `../../.zshrc` | Sanitised |
| Sign-in page HTML | Detected as `NOT_LOGGED_IN`, not parsed |
| Unparseable date | `date_raw` emitted, no fabricated ISO date |

Browser-only surfaces (shortcut delivery, clipboard, downloads, dark mode, popup) get
a manual checklist in `docs/manual-test.md` rather than a browser harness, which would
add the dependency the project is avoiding.

## 15. Icons

Redesign at 16, 48, and 128 px. Authored as SVG, rasterised with `rsvg-convert`
(verified present) to transparent PNGs at exact sizes.

The mark is the universal copy glyph — two overlapping rounded squares, outlined,
with no interior detail. Interior detail is precisely what destroys legibility at
a distance, which an earlier "document with text rules" draft proved: it read as
"files" rather than "copy". This is the same form Lucide, Anthropic, ChatGPT and
Vercel's Geist all converge on, so it is instantly recognisable.

Off-white (`#F7F6F0`) on near-black (`#0B0D0E`–`#23272C`) gives roughly 17:1
contrast. A luminous rim at 22% opacity stops the tile merging into a dark
browser toolbar. The house twist is that the back square is a frosted glass panel
rather than a plain outline; that supplies the depth without blurs or noise,
neither of which survive downscaling.

16 px is a separate drawing. The gradient, sheen and back-square stroke all
disappear or turn to mud at that size, so the tile goes flat and the geometry is
retuned to keep the front square's interior open rather than closing into a dot.
The front square keeps its outline there — filling it makes the mark read as
generic "layers" instead of "copy".

## 16. Repository and documentation

- `git init`; `.gitignore` for `.DS_Store` and `node_modules`.
- `LICENSE`: MIT, `Copyright (c) 2026 Moe Lueker / Zena Labs LLC`.
- `README.md`: complete rewrite. Structure — the problem; what it does; four-step
  install; how it works; a permissions table with a justification per line; shortcuts
  and how to remap; honest limitations; running the tests; licence.
- `STORE_LISTING.md`: removed. Web Store submission is out of scope for v2, and the
  file names a different extension.
- Distribution: tagged GitHub release with a prebuilt zip, so non-technical users
  download one file, while the source remains the audit trail.

## 17. Resolved inputs

1. **GitHub handle** — `moekoelueker`.
2. **Repository name** — `copy-gmail-thread-for-ai`.

## 18. Where implementation diverged from this design

Recorded so the document stays honest about the shipped code.

**The quote-stripping safety valve was rebuilt (§7).** As specified it triggered
on "the remainder is short", which a test proved wrong: a one-line reply such as
"Sounds good." sitting above a long quoted chain looked exactly like a failed
strip, so the valve fired and kept the entire chain — reintroducing the very
quadratic blow-up the feature exists to prevent. It now judges the *removed
tail* instead: if that tail contains more than 80 characters of unquoted prose
it is treated as an inline reply and kept, otherwise the cut stands regardless
of how short the remainder is.

**A whitespace bug was found by the DOM tests.** The final cleanup pass in
`lib/richtext.js` collapsed runs of spaces everywhere, including leading
indentation, which silently flattened nested markdown lists. It now anchors on a
preceding non-space character so indentation survives.

**`targetPath()` now sanitises its own filename.** It previously trusted callers,
which was safe in practice because `normalise()` sanitises first, but left the
last function before the downloads API unsafe on its own terms.

**Attachments are thread-level, not per-message (§8).** Gmail exposes attachment
chips conversation-wide. Attributing each to a specific message would have meant
guessing, so `format.js` emits them once for the thread and the README states
the limitation.

**The headless-Chrome test runner was dropped (§14).** Chrome would not run
headless reliably in the development environment, and shipping an unverified
script is worse than shipping none. `test/browser/index.html` is opened directly
in a browser instead; it prints `PASS n/n` and lists failures. It loads the
library files with a cache-buster, because a stale cached module reported a
false pass during development.

**Not yet verified against live Gmail.** §4.4 (the `ik` acquisition ladder),
print-view recipient parsing, and attachment discovery all depend on Gmail's
current markup and are unverified. `docs/manual-test.md` covers them.
