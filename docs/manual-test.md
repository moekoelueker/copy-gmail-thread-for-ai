# Manual release checklist

Automated tests have no real Google credential. Run this checklist after changes
to the manifest, Gmail adapter, content UI, popup, clipboard path, or downloads.
Use non-sensitive test mail where possible.

## Install and permissions

- [ ] In Chrome, open `chrome://extensions`, enable Developer mode, and choose
      **Load unpacked** on the folder containing `manifest.json`.
- [ ] Confirm access is limited to `mail.google.com`, clipboard writing, and
      downloads.
- [ ] Confirm there is no Google OAuth screen, extension login, API key, or
      consent flow. Normal Gmail sign-in in the tab is the only authentication.
- [ ] Reload the Gmail tab after loading or reloading the extension.

Repeat platform-specific checks on current Chrome for both macOS and Windows
before a public release.

## Identity and completeness

- [ ] Open a conversation from the middle of an inbox containing other rows.
- [ ] Use **Copy thread**. The pasted `<subject>` exactly matches the open
      conversation.
- [ ] `<messages>` equals Gmail’s full count, including messages collapsed on
      screen.
- [ ] Output begins `<email_thread format_version="3">` and ends
      `</email_thread>`.
- [ ] For a normal print-view capture, all three `<completeness>` attributes and
      `<complete>` are `true`.
- [ ] Open a second signed-in Gmail account (`/mail/u/1/` or later) and repeat.
      No data or attachment may cross account indexes.
- [ ] Test a non-Latin subject. It must copy the same subject or refuse; a
      merely similar subject must not pass.

## Attribution and content

- [ ] Every message has the correct `n`, `from`, `email`, `date`, and `local`.
- [ ] To, Cc, and Bcc recipients are under the correct message. Include a
      display name containing a comma.
- [ ] Each attachment appears exactly once under its message, or under
      `attribution="unknown"` with a warning.
- [ ] Links and data tables remain useful.
- [ ] Remote images appear only as inert `[image: …]` descriptions; no
      `![…](https://…)` tracker remains.
- [ ] Recognized history is removed without deleting a point-by-point answer.
- [ ] Forwarded content is retained.
- [ ] A body containing `<message>`, `</message>`, and `]]>` produces parseable
      XML with the original text inside `<body>`.

## Clipboard and controls

- [ ] **Copy thread** beside the subject works.
- [ ] The popup’s **Copy thread** action produces the same output.
- [ ] Both actions disable together while work is running; repeated clicks do
      not overlap.
- [ ] `Option+C` works on macOS and `Alt+C` works on Windows.
- [ ] Remapping at `chrome://extensions/shortcuts` works.
- [ ] Normal `Command+C`/`Ctrl+C` remains unchanged.
- [ ] Keyboard and popup paths do not show a clipboard permission prompt.
- [ ] Light theme, dark theme, keyboard focus, and a narrow window remain
      legible and usable.

## Attachments and paths

- [ ] **Copy thread** inlines a small text file, lists a PDF, and starts no
      download.
- [ ] **Copy + save files** downloads both the text file and PDF.
- [ ] Output says `download started`, never `saved`.
- [ ] Files land under `gmail-threads/<sanitized-subject>/` inside Chrome’s
      configured download directory.
- [ ] Test duplicate filenames, including an existing `file (2).pdf`; no file
      is overwritten or ambiguously referenced.
- [ ] Test spaces, Unicode, emoji, and a very long filename.
- [ ] Change Chrome’s download directory and repeat. No hard-coded
      `~/Downloads` or Windows path should appear.
- [ ] With “Ask where to save each file” enabled, verify Chrome’s normal prompt
      and that the extension remains responsive.

## Failure behavior

- [ ] Inbox with no conversation open → “Open an email thread first.”
- [ ] Signed-out/expired session → explicit error and no clipboard replacement.
- [ ] Offline or blocked print-view request → visible-page fallback only when
      visible messages exist.
- [ ] Fallback output has all completeness fields `false`, a
      `VISIBLE_PAGE_FALLBACK` warning, and a warning-colored toast.
- [ ] Alter a saved print-view title to another subject → copy is refused and
      the clipboard remains unchanged.
- [ ] Add an unrecognized `table.message` to a fixture → parsed messages remain,
      but `messages=false` and `MESSAGE_SKIPPED` are present.
- [ ] Reload the extension while Gmail remains open. Stale controls disappear;
      reloading Gmail restores them without console errors.
- [ ] A very long thread (100+ messages) completes and leaves Chrome responsive.

## Security spot checks

- [ ] An ordinary email link containing `view=att` on another origin is neither
      fetched nor downloaded.
- [ ] An attachment link for another thread or account is rejected.
- [ ] No raw attachment capability URL appears in the clipboard.
- [ ] DevTools shows only Gmail requests initiated by a copy—no analytics,
      telemetry, or third-party request.
- [ ] `chrome://extensions` shows no unexpected permission after the change.

## Windows-specific pass

Nothing in this project has been executed on Windows. The path, filename and
shortcut logic is written to be portable and is unit-tested against Windows
rules, but until this section is completed on a real Windows machine, Windows
support is **unverified**, not supported.

- [ ] Install from the release archive on Windows 10 and Windows 11, current
      Chrome, via `chrome://extensions` → Developer mode → **Load unpacked**.
- [ ] `Alt+C` and `Alt+Shift+C` register and fire. Confirm neither collides with
      a system or vendor shortcut on the test machine's keyboard layout.
- [ ] Attachments land under `gmail-threads\<subject>\<file>` inside the
      configured download folder, with backslash separators shown by Explorer.
- [ ] Change the download folder to a non-default path, including one on a
      second drive, and repeat.
- [ ] Send yourself files named `CON.txt`, `NUL.pdf`, `COM1.csv`, `PRN.docx`,
      `LPT1.txt`, `report .pdf` (trailing space) and `report..pdf`. Each must
      download with a safe rewritten name and none may fail silently.
- [ ] Send two files whose names differ only in case (`Report.pdf`,
      `report.pdf`). NTFS is case-insensitive: confirm neither overwrites the
      other and both appear in the output with distinct paths.
- [ ] Send a file already named `invoice (2).pdf` alongside `invoice.pdf` and
      confirm the collision suffixes do not collide with each other.
- [ ] Send a file with a very long Unicode name and confirm the result stays
      inside the Windows path limit and still opens.
- [ ] Confirm the copied output contains no drive letter, backslash path, or
      `~/Downloads`, only the relative `gmail-threads/...` form.
- [ ] Paste into Notepad and into a browser textarea: line endings must be
      readable in both, and the XML must still parse.
- [ ] Repeat the identity, attribution and failure-behavior sections above.

Record Chrome version, operating system, Gmail account type, and any failed case
with a safely redacted fixture.
