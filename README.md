# Copy Gmail Thread for AI

**A Chrome extension that copies a whole Gmail thread to your clipboard as
clean markdown for ChatGPT, Claude, or any LLM — including messages Gmail
collapsed, and including attachments.**

One keystroke. No server, no analytics, no account. Nothing leaves your
browser.

---

## The problem

You want to hand an email conversation to an AI assistant. Today that means:
scroll to the top, click every collapsed message open one at a time,
drag-select across signatures and legal disclaimers and
`On Tue, Jul 7, 2026 at 4:03 PM ... wrote:` headers, and paste. What arrives is
a wall of text with every hyperlink destroyed, every table flattened into
newline soup, and the same quoted reply chain repeated once per message.
Attachments can't come at all.

So you paste something incomplete, the model reasons over it confidently, and
you don't notice what was missing.

This does the one thing: **press a key, get the whole thread, correctly.**

## What you get

```
<email_thread>
<meta>
<subject>Q3 renewal terms</subject>
<messages>6</messages>
<participants>Jane Doe (jane@acme.com); You (you@example.com)</participants>
<date_range>2026-07-07T16:03:00.000Z to 2026-07-19T09:12:00.000Z</date_range>
<attachment_count>2</attachment_count>
<source>print-view</source>
<complete>true</complete>
<url>https://mail.google.com/mail/u/0/#all/…</url>
</meta>
<message n="1" date="2026-07-07T16:03:00.000Z" local="Mon, Jul 7, 9:03 AM"
         from="Jane Doe" email="jane@acme.com">
<to>you@example.com</to>
<body>
Numbers for the renewal are below.

| Quarter | Revenue |
| --- | --- |
| Q3 | $1.2M |

Full detail is in [the deck](https://example.com/deck).
</body>
<attachments>
<attachment name="Q3-forecast.pdf" type="application/pdf" size="240K"/>
</attachments>
</message>
</email_thread>
```

Tagged structure with markdown bodies. Email text routinely contains `#`,
`---` and code fences, so markdown headings are ambiguous as message
boundaries — tags aren't. JSON would escape every newline into `\n` soup; YAML
breaks on arbitrarily indented email. This form stays readable to you and
parses reliably for a model.

Three details exist specifically because a model reading the output got them
wrong without them:

- **`local` alongside the UTC `date`.** An evening reply in a western timezone
  lands on the *next* UTC day, so "she replied twenty minutes later" reads as
  "she replied the next day". Both stamps are given.
- **Sender on the message tag**, not a child element, so one line identifies
  who wrote what and when — and survives truncation.
- **`participants` and `attachment_count` up front**, so a reader knows who is
  involved and whether files exist without first reading the whole thread.

**Every message is included**, including the ones Gmail collapsed, because the
extension reads Gmail's own print view rather than scraping what happens to be
on screen.

## Install

No build step, no dependencies, no account.

1. Download this repository (**Code → Download ZIP**, then unzip) or
   `git clone https://github.com/moekoelueker/copy-gmail-thread-for-ai.git`
2. Open `chrome://extensions`
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked** and select the folder

Open a Gmail thread and press **Option+C** (**Alt+C** on Windows and Linux), or
click **Copy Email Thread** next to the subject line.

## Shortcuts

| Action | Default |
|---|---|
| Copy the thread | `Alt+C` / `Option+C` |
| Copy and save attachments | `Alt+Shift+C` |

Both are remappable at **`chrome://extensions/shortcuts`** — there is no
settings page because Chrome already provides a better one. Chrome intercepts
these before the page sees them, so your normal copy is untouched and Option+C
does not type a `ç`.

## Attachments

Attachments are **delivered, not parsed.**

- **Text-like files** (`.txt` `.md` `.csv` `.tsv` `.json` `.log` `.xml` `.yml`
  `.yaml` `.ics`) are read and inlined directly into the copied text.
- **Everything else** — PDFs, Word, Excel, images — is listed in the output
  with its name, type and size. Press `Alt+Shift+C` to also save the files to
  `~/Downloads/gmail-threads/<subject>/`, and the output references those paths.

There is deliberately no PDF or Office parsing. Doing it would mean bundling
roughly one to two megabytes of third-party minified code inside an extension
that reads your mail, which would destroy the one property that makes this
trustworthy: that you can read all of it yourself. Both places this output goes
already read PDFs natively — Claude Code from disk, chat assistants as uploads.

Note that browsers cannot place a PDF on the clipboard as a *file*. That is a
platform limit, not an oversight; any tool claiming otherwise is downloading to
disk or uploading to a server.

## How it works

Gmail still has a print view (`?view=pt&th=<threadId>`). One same-origin
request with your existing session returns the whole conversation as static
HTML — every message, fully expanded. The extension fetches it, converts each
body to markdown, strips the quoted chains, and writes the result to your
clipboard.

No scrolling, no clicking messages open, no UI changes, one request.

If Google ever removes the print view, there's a fallback that reads the
visible page — and it says so, loudly, because a partial copy that looks
complete is the worst thing this tool could do to you.

## Privacy and permissions

**There is no server.** No analytics, no telemetry, no accounts, no API keys,
no remote code, no `eval`, no `innerHTML`, no build step, and zero runtime
dependencies. Exactly one network request per copy, to Gmail, same-origin.

| Permission | Why it's needed |
|---|---|
| `mail.google.com` | Read the thread you have open. The only site this extension can touch. |
| `downloads` | Save attachments. Can only write inside your Downloads folder. |
| `clipboardWrite` | Write the thread to your clipboard from the keyboard shortcut. |

**Not requested:** `storage` (nothing is ever persisted), `tabs`, `cookies`,
`<all_urls>`, and — deliberately — `scripting`. An earlier approach injected
code into Gmail's own JavaScript context to read a session token; this reads
the same value with ordinary DOM access instead, so that capability is gone
entirely.

Because it's loaded unpacked, it cannot silently auto-update. What you read is
what runs.

## Limitations

Stated plainly, because you should know these before trusting it:

- **Recipients are best-effort.** `To` and `Cc` are parsed from the print
  view's header text, whose layout Google does not document.
- **Attachment detection relies on Gmail's print-view markup.** Attachments are
  attributed to the message that carried them, read from the print view rather
  than the live page. If Google changes that markup, files will show up as
  leftover text in the body instead of as structured attachments.
- **Inline replies inside quoted text are kept along with their quotes.** When
  the quote-stripper detects real prose inside a quoted block it keeps the
  whole thing. Keeping noise beats deleting someone's reply.
- **Scanned PDFs and images are not read.** No OCR. They're delivered as files.
- **Images are described rather than linked when Gmail proxies them.** Gmail
  rewrites remote images through a session-gated `googleusercontent` URL that
  nothing downstream can fetch and that runs to hundreds of characters. Where
  the real address can be recovered it is kept; otherwise you get `[image: alt]`
  rather than a long dead link. Tracking pixels are dropped outright.
- **It depends on Gmail's internals** and will eventually break when Google
  changes them. It fails loudly rather than silently.

## Development

**The extension itself has zero runtime dependencies and no build step.** What
you clone is what Chrome runs. The tooling below is for tests only and never
ships.

```bash
node --test "test/*.test.js"   # 57 unit tests — parsing, cleaning, formatting, sanitising
open test/browser/index.html   # 37 DOM tests — the HTML→markdown converter, no install needed

npm install                    # only for the end-to-end suite
npm run test:e2e               # 13 tests — the real extension in a real browser
npm run test:all               # everything
```

The end-to-end suite loads the actual extension into Chromium and serves a
stand-in Gmail **at the real origin**, so the manifest match pattern, the
same-origin print-view fetch, the service worker, the clipboard and the
downloads API all behave exactly as in production — without touching a mailbox.
It covers the regressions unit tests missed: copying the wrong conversation,
attachments being extracted and then dropped, partial captures reported as
complete.

Run it headed to watch: `HEADED=1 npm run test:e2e`.

Two implementation notes, both learned the hard way. It uses Playwright's
Chromium rather than your system Chrome, because Chrome 137+ removed
`--load-extension` and a stock Chrome silently starts with no extension loaded.
And it runs the full browser in `--headless=new` rather than Playwright's
`headless: true`, because the latter selects the headless *shell* binary, which
cannot run extensions at all.

To test against your own mail safely, see **[docs/fixtures.md](docs/fixtures.md)**:
capture a thread's print view, run `npm run redact` to strip everything
identifying while preserving the structure, and it becomes a permanent
regression test.

Layout:

```
adapters/gmail.js     everything Gmail-specific, behind a 3-method interface
lib/text.js           dates, filename sanitising, URL handling
lib/richtext.js       DOM → markdown (links, tables, lists, code)
lib/clean.js          quoted-chain and signature removal
lib/format.js         thread → tagged output
lib/attachments.js    classify, inline, sanitise, download
content.js            orchestration and in-page UI
background.js         shortcuts and downloads
```

Everything provider-specific lives in `adapters/`, so supporting another mail
service is a new file rather than a rewrite.

## License

MIT — see [LICENSE](LICENSE). Copyright © 2026 Moe Lueker / Zena Labs LLC.

Not affiliated with Google or Anthropic.
