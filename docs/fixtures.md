# Capturing test fixtures from real threads

The automated suites cover a lot, but they can only test against markup we
already understand. Every serious bug this extension has had came from Gmail's
print view being shaped differently than assumed — recipients on a second header
row, filenames in a different table cell than the icon, adjacent cells running
together. No amount of synthetic fixtures finds those, because a synthetic
fixture encodes the same assumption the parser does.

Real captures break that circle. One capture becomes a permanent regression test
that runs in seconds, forever, with no mailbox involved.

## 1. Capture

Open a Gmail thread and paste this into the browser console. It downloads the
raw print view for that thread.

```js
(async () => {
  const id = document.querySelector('h2.hP')?.getAttribute('data-legacy-thread-id');
  if (!id) throw new Error('Open a thread first.');
  const ik = [...document.querySelectorAll('a[href*="ik="]')]
    .map(a => (a.getAttribute('href').match(/[?&]ik=([A-Za-z0-9_-]{4,})/) || [])[1])
    .find(Boolean);
  const base = location.pathname.match(/\/mail\/u\/\d+/)?.[0] || '/mail/u/0';
  const r = await fetch(`${base}/?view=pt&search=all&th=${id}${ik ? '&ik=' + ik : ''}`,
                        { credentials: 'include' });
  const blob = new Blob([await r.text()], { type: 'text/html' });
  Object.assign(document.createElement('a'),
    { href: URL.createObjectURL(blob), download: `printview-${id}.html` }).click();
})();
```

**The download is your real, unredacted email.** Do not commit it. Step 2 exists
for exactly this reason.

### Threads worth capturing

Coverage comes from variety, not volume. Each of these exercises a path nothing
else does:

- **Many participants with CCs** — the only way to test recipient lists properly.
  Everything so far has been two people.
- **A forwarded chain** — the quote-stripper must keep forwarded content while
  removing quoted history. That branch is currently untested against real mail.
- **A marketing or notification email** — layout tables, tracking pixels, proxied
  images, spacer cells.
- **Non-English** — German, Chinese and French quote headers are handled; none
  have been seen in the wild here.
- **Several attachments across different messages** — per-message attribution.
- **A very long thread** — 50+ messages.

## 2. Redact

```bash
npm run redact -- ~/Downloads/printview-19ec69dc5c88b132.html
```

This writes `test/e2e/fixtures/real-<name>.html` with:

- every address replaced by a consistent `personN@example.com`
- display names and body prose replaced with filler of similar shape
- attachment filenames replaced, extensions kept
- URL query strings stripped (they carry session tokens and account ids)
- remote images stubbed

and deliberately **preserves** everything the parser depends on: tag structure,
classes, table shape, quote blocks, Gmail's attachment icons, and all dates.
Dates survive intact because scrubbing month names would turn
`Sun, Jun 14, 2026` into noise and silently void every timestamp assertion.

**Read the output before committing.** Redaction is mechanical. It cannot know
that a phone number in a signature, or a company name written without an `@`,
is sensitive.

## 3. Run

```bash
npm run test:e2e
```

Every `real-*.html` fixture is picked up automatically by
`test/e2e/real-fixtures.test.js` and checked against invariants rather than
exact content — structure balanced, every message attributed, no markup leaking
into metadata elements, no fabricated timestamps, no Gmail noise surviving. One
set of rules covers any thread of any shape.

## What the harness cannot cover

`test/e2e/harness.js` loads the real extension into a real browser and serves a
stand-in Gmail at the real origin, so content-script injection, the same-origin
fetch, the service worker, the clipboard and downloads all behave normally.

Two things remain manual, and `docs/manual-test.md` covers them:

- **The keyboard shortcut itself.** Chrome binds commands at the browser level,
  so a synthetic keypress cannot fire `chrome.commands`. The tests drive the
  message the command dispatches, which covers everything downstream of the key
  binding but not the binding.
- **Anything requiring a live session** — a real Gmail login, actual attachment
  downloads, Gmail's own theming.
