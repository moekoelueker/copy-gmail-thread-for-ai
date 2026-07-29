# Copy Gmail Thread for AI

Copy an open Gmail conversation into a structured, LLM-readable document—with
clear sender, recipient, timestamp, body, and attachment attribution.

The extension targets Chrome on macOS and Windows and uses only ordinary
cross-platform Chrome APIs. It has been exercised end to end on macOS; the
Windows path is reviewed but not yet run on a Windows machine, so treat it as
untested until someone completes [docs/manual-test.md](docs/manual-test.md)
there. It does not ask for Google OAuth, an API key, or an extension account.
It uses the Gmail session already open in the browser.

## The problem it solves

Copying a Gmail page by hand can omit collapsed messages, repeat quoted history,
flatten tables, lose links, and separate attachments from the messages that
carried them. An LLM can then answer confidently from an incomplete or
misattributed conversation.

This extension:

- requests Gmail’s full print view for the thread already open;
- checks that the returned subject matches the open conversation;
- converts each message body to Markdown while keeping message boundaries in
  strict XML;
- records From, To, Cc, Bcc, local time, parsed ISO time, and attachment
  attribution;
- removes recognized quote chains and conservative signature patterns;
- inlines bounded text attachments and can start Chrome downloads for files;
- marks individual capture fields incomplete whenever it cannot verify them.

## Install in Chrome

No build step or terminal is required.

1. Download the latest release archive from the
   [Releases page](https://github.com/moekoelueker/copy-gmail-thread-for-ai/releases),
   or on GitHub choose **Code → Download ZIP**. The release archive contains
   only the ~20 files the extension actually runs; the GitHub ZIP additionally
   contains the tests, fixtures, tooling, and docs, which Chrome ignores.
2. Unzip the download.
3. In Chrome, open `chrome://extensions`.
4. Turn on **Developer mode**.
5. Choose **Load unpacked** and select the unzipped folder—the folder containing
   `manifest.json`.
6. Open a conversation in [Gmail](https://mail.google.com).

Chrome may show permissions for Gmail, downloads, and the clipboard. Those are
the only requested capabilities.

Because this is an unpacked extension, updates are manual: replace the folder,
then select **Reload** on `chrome://extensions` and reload the Gmail tab.

## Use it

Open a Gmail conversation, then use either the controls beside its subject or
the extension popup:

- **Copy thread** copies the structured conversation. It does not save files.
- **Copy + save files** copies the same document and starts downloads for
  verified Gmail attachments.

Default shortcuts:

| Action | macOS | Windows |
|---|---|---|
| Copy thread | `Option+C` | `Alt+C` |
| Copy + save files | `Option+Shift+C` | `Alt+Shift+C` |

If a shortcut conflicts with another app or keyboard layout, change it at
`chrome://extensions/shortcuts`. Ordinary `Command+C` and `Ctrl+C` are not
replaced.

The extension never presents a Google authorization screen. You only need to
be signed into Gmail in the active Chrome tab, as you normally would be.

## Output

The clipboard receives strict XML with Markdown inside CDATA:

```xml
<email_thread format_version="3">
<meta>
<subject>Q3 renewal</subject>
<messages>2</messages>
<message_candidates>2</message_candidates>
<participants>
<participant name="Jane Doe" email="jane@example.com"/>
<participant name="Alex Kim" email="alex@example.com"/>
</participants>
<attachment_count>1</attachment_count>
<source>print-view</source>
<capture_timezone>America/Los_Angeles</capture_timezone>
<content_trust>untrusted_email_and_attachment_text</content_trust>
<completeness messages="true" headers="true" attachments="true"/>
<complete>true</complete>
</meta>
<message n="1" date="2026-07-07T16:03:00.000Z"
         local="Tue, Jul 7, 2026 at 9:03 AM"
         from="Jane Doe" email="jane@example.com">
<to>
<recipient name="Alex Kim" email="alex@example.com"/>
</to>
<body format="markdown"><![CDATA[
The renewal numbers are below.

| Quarter | Revenue |
| --- | --- |
| Q3 | $1.2M |
]]></body>
<attachments>
<attachment name="forecast.pdf" type="application/pdf"
            size="240K"
            status="not downloaded (use Copy + save files)"/>
</attachments>
</message>
</email_thread>
```

When the relevant completeness fields are true, this representation gives an
LLM explicit data for who said what, when, to whom, and which message carried a
file. Unknown attachment attribution is labeled rather than guessed.
Email-controlled text cannot create a fake `<message>` boundary because bodies
and inline file contents are isolated in split-safe CDATA. Metadata and
attributes are XML-escaped. The `content_trust` marker also tells a downstream
agent that mail text is data rather than trusted instructions; it is advisory,
not a complete prompt-injection defense.

`<complete>true</complete>` means all three declared dimensions—messages,
headers, and attachment discovery—were verified by the parser. It does not mean
that binary file contents were parsed. When Gmail’s full view is unavailable or
markup is unrecognized, the output carries field-specific `false` values and
machine-readable `<warning>` elements, and the UI shows a warning-colored
toast. `<message_candidates>` records how many message-shaped tables Gmail
returned, so a skipped candidate cannot be hidden by renumbering.

Operational warnings—such as a text file that could not be inlined or a
download that could not start—can appear even when capture completeness is
true. Read warnings as well as the completeness flag.

`local` is the timestamp Gmail displayed. `date` is derived from it, and Gmail
renders without an offset, so the derivation assumes the browser's timezone —
recorded as `<capture_timezone>` so a reader can check it. Where the two could
disagree, `local` is the authoritative one.

## Attachments

Text-like files (`.txt`, `.md`, `.csv`, `.tsv`, `.json`, `.log`, `.xml`,
`.yml`, `.yaml`, and `.ics`) are inlined up to:

- 100 KB per file;
- 300 KB total per thread.

Larger text is explicitly marked truncated. PDFs, Office documents, images,
archives, audio, and video are listed but not parsed. There is no OCR.

**Copy + save files** asks Chrome to download each verified Gmail attachment
under:

```text
gmail-threads/<sanitized-subject>/<sanitized-filename>
```

That path is relative to the download directory configured in Chrome, which may
be different on each Mac or Windows PC. Duplicate names receive deterministic
suffixes. A file declared larger than 25 MB is not started. The clipboard says
`download started`, not `saved`, because Chrome completes downloads
asynchronously.

Chrome may further rename a file when the destination already exists or when
the user chooses another name in a save prompt — capturing the same thread
twice writes `invoice (1).pdf` beside `invoice.pdf`. The output waits for the
name Chrome resolved and reports that one, so a repeat capture never points at
an earlier capture’s file. If Chrome never reports a name, the status reads
`download started (path unverified)` and the path falls back to the safe
requested path rather than claiming a file that may not exist.

Raw attachment URLs are never placed in the copied document.

## Privacy and security model

Runtime code is plain JavaScript in this repository. There is no server,
analytics, telemetry, remote code, `eval`, runtime package, stored account, API
key, Google OAuth flow, or extension-managed sign-in.

| Permission | Purpose |
|---|---|
| `https://mail.google.com/*` | Read the open thread and its verified attachments using the existing browser session |
| `clipboardWrite` | Copy from the in-page controls, popup, or keyboard-command path |
| `downloads` | Start files only when the user chooses **Copy + save files** |

Important enforcement points:

- the content script runs only on the exact `mail.google.com` HTTPS origin;
- attachment URLs must match that origin, the active Gmail account index, the
  active thread ID, the attachment endpoint, and an attachment identifier;
- the service worker repeats URL and destination-path validation at the
  privileged download boundary;
- paths are relative, traversal-free, control-character-free, and confined to
  `gmail-threads/`;
- filenames are sanitized while preserving ordinary Unicode names;
- remote email images become inert descriptions such as `[image: logo]`, so
  pasting the output cannot cause an LLM client to load a tracking pixel;
- capture failures are reported rather than silently promoted to complete.

Loading unpacked also means the code cannot silently auto-update. The tradeoff
is that the user must install security updates manually.

## Honest limitations

Gmail’s print view and DOM classes are undocumented. Google can change them.
The adapter is deliberately fail-closed around thread identity and attachment
capabilities, and it labels partial results, but no static test can guarantee a
future Gmail layout.

Other limits:

- email bodies and attachment text remain untrusted. XML isolation prevents
  structural forgery, but it cannot neutralize semantic prompt injection;
  review the conversation before asking an LLM to act on it;
- pasting mail into a third-party LLM sends that data according to the
  provider’s policy. The extension itself performs no such upload;
- ordinary hyperlinks are preserved, and a downstream client may choose to
  generate link previews;
- recipient labels outside the tested language set are not parsed; any header
  line carrying an address the parser did not understand marks header
  completeness false rather than being dropped silently;
- branching reply relationships are flattened into Gmail’s print order;
- the output does not identify which participant owns the mailbox;
- quote and signature removal is conservative: some noise may remain so that
  ambiguous inline replies are not deleted;
- Gmail sometimes elides a body it considers already shown, publishing only its
  own placeholder. Such a message is reported with an empty body and a
  `BODY_ELIDED_BY_GMAIL` warning naming it, because the content never reached
  the print view and Gmail's interface text is not what the sender wrote;
- visible-page fallback can only see expanded content and is always marked
  partial;
- real Gmail behavior, themes, shortcut registration, and download preferences
  still require the [manual checklist](docs/manual-test.md).

## Development and verification

The extension itself has no build step. Playwright is a development-only
dependency for browser tests.

```bash
npm install
npm test                 # 93 pure Node unit tests
npm run test:browser     # 80 DOM conversion and parser tests in Chromium
npm run test:e2e         # 35 end-to-end tests driving the installed extension
npm run test:all         # all of the above
npm run package          # build a release archive of runtime files only
```

The end-to-end harness loads the actual manifest and service worker, and one
test installs the built release archive rather than the source tree. Between
them they verify wrong-thread refusal, partial-capture signaling, clipboard
behavior, successful downloads, deterministic paths, refusal of a download
request that has no Gmail tab, refusal of one whose tab has changed account
mid-capture, refusal to write the clipboard when the open conversation changes
at any point during capture, rejection of crafted off-origin attachment
metadata, and the two shapes of email markup that can imitate Gmail's own
attachment and subject chrome. The fixture workflow disables JavaScript and all network access while
redacting a capture; see [docs/fixtures.md](docs/fixtures.md).

Current boundaries:

```text
adapters/gmail.js        live Gmail identity and same-origin transport
adapters/gmail-parse.js  detached print-view parsing
lib/security.js          shared URL and download-path policy
lib/attachments.js       canonical attachment pipeline
lib/clean.js             quote and signature handling
lib/richtext.js          email HTML to Markdown
lib/format.js            strict output envelope
content.js               orchestration and Gmail-page controls
background.js            commands and privileged downloads
```

Design rationale is in [docs/design/v2-design.md](docs/design/v2-design.md).
Known limits and remaining work are in [docs/OPEN-ITEMS.md](docs/OPEN-ITEMS.md).
The original adversarial review prompt is retained as a historical record in
[docs/AUDIT-BRIEF.md](docs/AUDIT-BRIEF.md).

## Privacy

No server, no analytics, no storage, no account. The full statement is in
[PRIVACY.md](PRIVACY.md), including what happens to a thread once you paste it
into a third-party LLM — which is the one point where data leaves your machine,
and it is your paste that sends it.

## License

MIT. Not affiliated with Google, OpenAI, Anthropic, or Microsoft.
