# Design: version 2.1

This document describes the code that currently ships. The earlier v2 proposal
mixed planned and implemented behavior; that made it unsuitable as a security
reference.

## Goal

Given the Gmail conversation already open in Chrome, produce a compact document
from which a human or LLM can answer:

> Who said what, when, to whom, and with which attachment?

The extension must use the browser’s existing Gmail session. It must not add a
Google OAuth flow, Gmail API credential, remote service, or extension account.

## Non-goals

- sending, modifying, labeling, or deleting mail;
- discovering mail that is not already open;
- identifying the mailbox owner;
- reconstructing branching `In-Reply-To` relationships;
- parsing PDF, Office, image, audio, or video contents;
- OCR;
- claiming completeness when Gmail markup was not understood.

## Trust model

Three inputs are untrusted:

1. email-controlled HTML, text, links, filenames, and metadata;
2. undocumented Gmail markup, which can change without notice;
3. messages crossing from the content script to the privileged service worker.

Gmail itself and Chrome’s installed extension runtime are trusted. The
repository contains all runtime code. Development dependencies do not ship.

The most important failure is a plausible-looking wrong or partial thread.
Identity therefore fails closed, while content cleanup is conservative: extra
noise is preferable to deleted mail.

## Data flow

```text
user action
    |
    v
content.js
    |
    +-- adapters/gmail.js
    |      snapshot open subject + thread id + account
    |      request same-origin Gmail print view
    |
    +-- adapters/gmail-parse.js
    |      validate subject
    |      parse messages, headers, bodies, attachments
    |
    +-- lib/attachments.js
    |      merge -> validate -> de-duplicate -> inline/download
    |
    +-- lib/format.js
           strict XML + Markdown-in-CDATA -> clipboard

save only:
content.js -> background.js -> repeat URL/path validation -> chrome.downloads
```

The browser session is the only authentication mechanism. Requests use the
signed-in Gmail tab and stay on `https://mail.google.com`.

## Module boundaries

The v2 adapter combined transport, parsing, identity, and live DOM discovery.
That made individually correct modules easy to connect incorrectly—for example,
print-view attachments were parsed but bypassed the attachment pipeline.

Version 2.1 uses explicit boundaries:

- `adapters/gmail.js` owns live-page identity, session-key discovery,
  same-origin transport, and the explicitly partial visible-page fallback.
- `adapters/gmail-parse.js` turns detached print-view HTML into a thread model.
  It performs no network request and reads no live document state.
- `lib/attachments.js` owns one canonical, thread-wide attachment list.
  Attribution is a `messageN` field, not a second attachment collection.
- `lib/security.js` is loaded by both the content script and service worker so
  URL/path policy cannot drift across the privilege boundary.
- `lib/format.js` consumes only the canonical thread model.

Every transition carries an explicit context:

```js
{
  threadId: "…",
  accountIndex: "0"
}
```

Attachment URLs cannot be normalized or downloaded without it.

## Thread identity

The adapter reads the subject heading `h2.hP`. It accepts a thread ID on that
heading or in a narrow ancestor walk that stops before Gmail’s `role="main"`
container. It never searches the whole main region, where inbox rows also carry
thread IDs.

The print-view title is compared with the open subject using Unicode NFKC,
localized reply-prefix removal, whitespace/punctuation normalization, and exact
equality. Missing subjects, substrings, and unrelated non-Latin subjects fail
closed.

If the subjects differ, no clipboard write occurs. The visible-page fallback is
not used for an identity mismatch.

## Capture and completeness

The preferred source is Gmail’s print view because it normally includes
collapsed messages. Every candidate `table.message` is counted. A candidate
with an unknown layout is skipped, but the result becomes partial.

Completeness has three independent booleans:

```js
completeness: {
  messages: true,
  headers: true,
  attachments: true
}
```

`complete` is derived from those values; callers cannot override it with a
single optimistic flag.

Examples:

- skipped message table → all three false, because its headers and attachments
  are also unknowable;
- sender, date, or recipient label not parsed → `headers=false`;
- icon-only attachment or live-only attachment → `attachments=false`;
- visible-page fallback → all three false.

Print-view output includes both the number of captured `<messages>` and the
number of `<message_candidates>` Gmail exposed. A partial parser result
therefore shows the size and position of a gap instead of silently renumbering
later messages.

Warnings have stable codes and human-readable messages. Both are copied into
the output.

## Header model

Each message records:

```js
{
  n,
  from: { name, email },
  to: [{ name, email }],
  cc: [{ name, email }],
  bcc: [{ name, email }],
  date,       // parsed ISO instant or null
  dateRaw,    // Gmail's displayed local value
  body
}
```

The address-list scanner respects quoted names, angle brackets, commas, and
semicolons. It does not split `"Doe, Jane" <jane@example.com>` into two people.
Recipient parsing is still dependent on Gmail’s labels and is therefore
included in the completeness contract.

Both timestamps are kept. `dateRaw` preserves the human-visible local time;
`date` is emitted only when the platform parser produces a plausible
1990–2100 instant. No timestamp is fabricated.

## Body conversion and cleanup

The rich-text converter preserves useful semantics:

- links, with Google redirect wrappers removed;
- data tables;
- ordered and unordered lists;
- bold, italic, inline code, and fenced code;
- block quotations that are not recognized reply history.

Markdown link text and destinations are escaped. Fence length grows beyond
backticks in the source.

Remote images are represented as inert text (`[image: alt]`). Active Markdown
images are not emitted because an LLM client could fetch a per-recipient
tracking URL after paste. Tiny/open-log images and Gmail interface icons are
dropped.

Quote removal has a DOM pass and a text pass. Recognized reply containers and
headers are removed. Substantial prose mixed with literal quote lines or beside
a nested quote is retained and flagged. Signature removal stops at postscripts,
questions, long tails, and any cut that would empty a message.

## Attachment model

There is one canonical array:

```js
{
  name,
  type,
  size,
  messageN, // null only when attribution cannot be verified
  content,
  path,
  status
}
```

Print-view and live-page discoveries are merged by a verified Gmail URL, then
normalized once. Duplicate filenames receive a globally unique target name,
including collisions with names that already contain suffixes.

An attachment capability is accepted only when all of these hold:

- HTTPS;
- exact origin `https://mail.google.com`;
- exact `/mail/u/<active account>/` endpoint;
- `view=att`;
- exact active thread ID;
- `attid` or `permmsgid`;
- no credentials or URL fragment.

The raw URL is not emitted.

Text-like files are fetched with same-origin credentials, redirects disabled,
bounded streaming, charset/BOM handling, 100 KB per-file and 300 KB aggregate
limits. Save mode also starts a Chrome download for text files.

The displayed Gmail size is used to skip a declared file over 25 MB. Gmail’s
normal attachment limit is itself 25 MB, but the extension cannot enforce a
server-side byte cap after handing a verified URL to `chrome.downloads`.

## Privileged download boundary

`background.js` accepts download messages only from this extension’s content
script in a Gmail tab. It derives the account index from `sender.tab.url`,
revalidates the attachment capability, and accepts only portable relative paths
under:

```text
gmail-threads/<subject>/<filename>
```

Backslashes, absolute paths, drive letters, control characters, empty segments,
and `.`/`..` segments are rejected. Chrome receives `conflictAction:
"uniquify"`.

The response says `download started`. It never equates an assigned download ID
with completed disk I/O. Paths are described relative to Chrome’s configured
download directory rather than hard-coding `~/Downloads`.

## Output grammar

The envelope is strict XML:

```xml
<email_thread format_version="3">
  <meta>…</meta>
  <attachments attribution="unknown">…</attachments>
  <message n="1" from="…" email="…" date="…" local="…">
    <to><recipient name="…" email="…"/></to>
    <body format="markdown"><![CDATA[…]]></body>
    <attachments>…</attachments>
  </message>
</email_thread>
```

Email bodies and inline attachment text are placed in CDATA. Any `]]>` sequence
is split into adjacent CDATA sections. All other text and attributes are
XML-escaped, and invalid XML control characters are replaced.

This prevents both opening-tag and closing-tag injection while keeping Markdown
readable. A constant `content_trust` marker labels email and attachment text as
untrusted data. Structured recipients and per-message attachments allow direct,
unambiguous attribution.

## User experience

Two adjacent in-page buttons and the popup expose the same actions. A global
busy guard prevents overlapping captures. Buttons disable as a group during
work. Warning states use an alert role and a visually distinct toast.

Success is shown only when the capture is complete and no download/attachment
operation failed or was skipped. Otherwise the toast directs the user to the
warnings in the pasted document.

Labels and paths do not assume one operating system. The controls are designed
for Chrome on macOS and Windows; Chrome owns shortcut remapping and the download
directory.

## Rejected alternatives

- **Gmail API/OAuth:** broader setup and a new credential surface; conflicts
  with using the already-open browser session.
- **MAIN-world injection:** unnecessary privilege and harder review.
- **Backend or cloud parser:** email would leave the browser.
- **Broad live-DOM thread-ID search:** previously selected inbox decoys.
- **Generic `href*=view=att` discovery:** email-controlled links could cross the
  privileged fetch/download boundary.
- **JSON:** mechanically safe, but multiline email becomes heavily escaped and
  less readable for humans.
- **YAML:** arbitrary email indentation and punctuation make it fragile.
- **Raw tag-delimited Markdown:** email text can forge message boundaries.
- **Bundled PDF/Office parsers:** large opaque runtime surface for a capability
  downstream LLM tools already provide.
- **Aggressive quote/signature deletion:** unacceptable risk of deleting inline
  answers.

The XML boundary is syntactic, not semantic. Email and attachment text can still
contain instructions aimed at an LLM. The extension preserves that content and
does not claim to solve prompt injection or a downstream provider’s data
handling.

## Verification boundary

Automated tests cover pure helpers, browser DOM behavior, strict XML parsing,
the installed extension, service-worker routing, the clipboard, completed test
downloads, wrong-thread refusal, partial captures, and blocked external
attachment requests.

They do not prove future Gmail compatibility. The remaining live-session checks
are documented in `docs/manual-test.md`. A file counts as a real-Gmail fixture
only when it has a reviewed ground-truth sidecar; synthetic fixtures use a
different prefix.
