# Manual test checklist

The automated suites cover parsing, cleaning, formatting, sanitising and the
HTML→markdown conversion. What they cannot cover is anything that needs a real
Gmail session, a real clipboard, or Chrome's own UI. Work through this after
any change to `content.js`, `background.js`, `adapters/gmail.js`, the manifest,
or the popup.

## Setup

1. `chrome://extensions` → Developer mode → **Load unpacked**
2. Confirm the details page lists **exactly** these permissions: read and
   change your data on `mail.google.com`, manage downloads. Anything more is a
   regression.
3. Open a Gmail thread with at least 5 messages, some collapsed.

## Core

- [ ] **The pasted `<subject>` matches the thread you actually had open.** Check
      this first, every time. A wrong-thread bug shipped once already: an
      unscoped `[data-legacy-thread-id]` lookup matched an inbox list row, so the
      extension fetched an unrelated conversation and reported success. There is
      now a subject-match guard, but this is the check that catches its cousins.
- [ ] Open a thread from the middle of a long inbox, not the top one — that is
      the case where a list-row mix-up would be visible.
- [ ] `Alt+C` copies. Toast reads `✓ Copied N messages`, and N matches the real
      thread length including collapsed messages.
- [ ] Paste somewhere. Output starts `<email_thread>` and ends
      `</email_thread>`, and `<complete>` is `true`.
- [ ] Quoted chains are gone: the oldest message's text appears exactly once in
      the whole paste, not once per reply.
- [ ] Hyperlinks survive as `[text](url)`, not bare text.
- [ ] A thread containing a table produces a markdown table.
- [ ] The **Copy for LLM** button next to the subject does the same thing.
- [ ] A single `Cmd+C`/`Ctrl+C` still performs a normal copy — the extension
      must never shadow it.

## Shortcuts

- [ ] `chrome://extensions/shortcuts` lists both commands.
- [ ] Remap copy to something else; the new binding works and the old one stops.
- [ ] On macOS, `Option+C` does not type `ç` into the page.
- [ ] No clipboard permission prompt appears when using the keyboard shortcut.

## Attachments

- [ ] Thread with a PDF: `Alt+C` lists it under `<attachments>` with
      `status="not saved…"` and does **not** download anything.
- [ ] `Alt+Shift+C`: the file lands in `~/Downloads/gmail-threads/<subject>/`
      and the output carries the path.
- [ ] Thread with a `.csv` or `.txt`: content is inlined into the paste.
- [ ] A file with an awkward name (spaces, umlauts, emoji) saves with a sane
      filename.

## Failure modes — each must be visibly distinct

- [ ] Inbox list, no thread open → "Open an email thread first."
- [ ] Signed out in another tab, then copy → "Gmail session expired."
- [ ] Offline → a fetch error, not a silent failure or an empty clipboard.
- [ ] Reload the extension with Gmail still open → the button disappears rather
      than throwing.
- [ ] Very long thread (100+) → still copies, toast reports the size.

## Partial capture

This is the most important case, because the failure looks like success.

- [ ] Force the fallback (block `view=pt` in DevTools' network conditions, or
      temporarily break `printViewUrl`).
- [ ] Toast is **orange** and reads `⚠ … collapsed messages may be missing`.
- [ ] Output contains `<complete>false</complete>` and a `<note>` explaining it.

## Appearance

- [ ] Gmail light theme: button looks native next to the subject.
- [ ] Gmail dark theme: button and toast are both legible.
- [ ] Tab to the button: a visible focus ring appears.
- [ ] Popup on Gmail: both actions work.
- [ ] Popup on a non-Gmail page: explains itself, offers "Open Gmail".
- [ ] Popup shows current shortcuts; "Change shortcuts" opens Chrome's page.
