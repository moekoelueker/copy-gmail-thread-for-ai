# Thread save layout and capture fidelity

Design date: 2026-08-04. Supersedes nothing; extends the v2 design.

This spec came out of a manual testing campaign against real Gmail threads.
Two of its five items are save-layout work; three are output-fidelity defects
that the campaign exposed and that are fixed here because they change the same
files.

## Motivation

A capture of thread `19fcc80bb250daf4` was compared against the same thread
read back through the Gmail API. The capture was correct about the subject,
the sender, both links, and — unlike Gmail's own "to me, influencer" summary —
about the To/Cc split. It was wrong in three ways, and the save layout it would
have used had it carried attachments was wrong in a fourth.

## Decisions

### 1. Folder identity includes the thread

Attachments currently land in `gmail-threads/<subject-slug>/`. The slug is
derived only from the subject, so two different conversations that share a
subject share a folder, and Chrome's `uniquify` then renames the second
thread's `invoice.pdf` to `invoice (1).pdf` inside the first thread's folder.
The manifest path is then ambiguous about which conversation a file came from.

This is not hypothetical in the target mailbox: recurring calendar updates
("Updated invitation: … @ Wed Aug 5, 2026 8am") arrive as separate threads with
byte-identical subjects.

New layout:

```
gmail-threads/<subject-slug>-<threadkey>/
```

`threadkey` is the Gmail thread ID reduced to `[A-Za-z0-9]`, lowercased, last
8 characters. The reduction is required, not cosmetic: Gmail thread IDs can
take the form `thread-f:1234…`, and `safeDownloadPath` rejects `:`, so a raw ID
would fail the path check and the download would never start.

`slugify`'s length cap drops from 60 to 50 so the composed folder name stays
under 60 characters, preserving the Windows path budget.

No fallback is needed when the thread ID is absent. `validThreadId` already
gates attachment URL resolution, so a capture without a usable thread ID starts
no downloads at all.

Re-capture behavior is unchanged: `conflictAction: "uniquify"` still applies,
so a second capture of the same thread writes `invoice (1).pdf` beside
`invoice.pdf` in the same folder, and `settle()` still reports the name Chrome
actually chose. This is deliberate. An extension cannot read the filesystem,
and `chrome.downloads.search()` sees only Chrome's own download history, which
the user can clear and which does not know whether a file was moved or deleted.
"Skip if already present" is therefore not reliably implementable and is not
attempted.

### 2. Save mode writes the transcript into the folder

Today "Copy + save files" downloads attachments and puts the transcript on the
clipboard only. The folder on disk carries no record of which conversation
produced it, and is orphaned as soon as the clipboard is reused.

Save mode now also writes `thread.xml` — byte-identical to the clipboard
document — into the same folder.

The delivery mechanism is constrained. A blob URL created in the content script
belongs to `mail.google.com`'s origin, not the extension's, and
`URL.createObjectURL` does not exist in an MV3 service worker. The transcript
is therefore delivered as a `data:` URL built **by the service worker**.

The content script sends `{type: "download-thread", text, path}` and never
sends a URL. The worker base64-encodes `text` itself. A compromised content
script has no URL to supply, so this path cannot be turned into a fetch of
anything.

Authorization is a separate function from `authorizeDownload`, deliberately
narrower:

| Check | Rule |
|---|---|
| Message type | `"download-thread"`, a distinct type rather than an overload |
| Sender | identical to attachments: extension ID, `frameId === 0`, Gmail tab |
| Path | passes `safeDownloadPath` **and** basename is exactly `thread.xml` |
| URL | not accepted from the message; constructed by the worker |
| Size | text capped at 5 MB |

Worst case under full content-script compromise: a non-executable `.xml` file
of bounded size is written into a `gmail-threads/` subfolder. No arbitrary URL,
no arbitrary filename, no path outside the download root.

A failure to write `thread.xml` must not fail the capture. The clipboard is the
primary product; a transcript-write failure is reported as a warning.

### 3. Signature blocks are segregated, not deleted

`stripQuoteNodes` removes every `div.gmail_signature`. In the observed thread
that div contained a substantive legal disclaimer — the sender's liaison
relationship, an explicit statement that they do not represent the named brand,
instructions for verifying the offer, and a support address. All of it was
deleted, reported only as a generic `QUOTED_TEXT_TRIMMED`, while a Mailtrack
tracking table and a 0×0 tracking pixel survived into the output.

The project's stated bias is to under-remove (`OPEN-ITEMS.md`: "Some signatures
or quoted history remain when removal would risk deleting content"). Deleting a
disclaimer while keeping a tracker inverts that bias.

Signature content is now extracted rather than removed, and emitted as a
sibling of `<body>`:

```xml
<body format="markdown"><![CDATA[ …Best regards, Charie Mae ]]></body>
<signature><![CDATA[ Notice: This email contains privileged information… ]]></signature>
```

The body stays clean, nothing is lost, and a reader can weight the two
differently. Signature extraction no longer counts toward `quotedTrimmed`,
because nothing was trimmed — so `QUOTED_TEXT_TRIMMED` now means only what it
says, and its message drops the "and signatures" clause.

`format_version` goes 3 → 4. The change is additive — a consumer that ignores
`<signature>` sees exactly what it saw before, since that content was
previously deleted outright — but a strict schema consumer would reject an
unknown element, and the version is cheap to bump.

### 4. Paragraphs render as paragraphs

`P` shares the single-`\n` block path with `DIV` in `richtext.js`, so six
`<p>` elements render as one run-on Markdown block. A single newline in
Markdown is a soft wrap, not a paragraph break.

`P` now closes with `\n\n`. `DIV` is untouched, so the paragraph-per-`div`
reflow that the existing comment warns about cannot occur. `renderList` already
collapses `\n{2,}` inside list items, so a `<p>` inside an `<li>` is unaffected,
and the existing `\n{3,}` → `\n\n` pass prevents over-spacing.

### 5. Platform scope

macOS is verified by execution. Windows path defenses (reserved device names,
trailing dot and space rules, separator and drive-letter rejection, length
budget) are kept and unit-tested, but Windows remains **designed for and not
verified** until someone runs the Windows section of `manual-test.md` on real
hardware. Documentation must not imply otherwise.

## Testing

Two arms, split by what genuinely requires a live Gmail session.

**Automated.** Folder naming and thread-key derivation, including a `thread-f:`
style ID and the reserved-name and length interactions. `authorizeThreadDocument`
against forged senders, wrong message types, non-`thread.xml` basenames, paths
outside the download root, and oversized payloads. Paragraph rendering.
Signature extraction and `<signature>` emission. An end-to-end run against the
packaged archive asserting that the folder, the attachment bytes, and
`thread.xml` all land.

**Manual.** Six real threads, ordered by what they stress: a two-message thread
with the reply's quoted history; a five-message chain with three levels of `On …
wrote:` nesting; a thread with real attachments; a thread carrying multiple To
recipients plus a `mailer-daemon` bounce whose subject differs from the thread's;
a bracketed `[Contact]` subject; and a calendar invite whose `.ics` exercises the
inline path rather than the download path. Each capture is diffed against the
same thread read back through the Gmail API.

Two filesystem checks cannot be automated and are done by hand: capturing one
thread twice and confirming the same folder with `(1)` suffixes and a correct
manifest; and capturing two threads that share a subject and confirming they now
land in different folders.

## Explicitly not done

- No "skip if already downloaded" — not reliably implementable, see above.
- No snapshot-per-capture subfolder — rejected as unnecessary nesting against a
  Windows path budget we are keeping.
- No overwrite-on-recapture — would destroy a file the user had annotated.
- No Chrome Web Store listing; that decision remains deferred.
