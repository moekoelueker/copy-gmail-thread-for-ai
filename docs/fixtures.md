# Safely adding Gmail fixtures

Synthetic fixtures verify known cases. A reviewed, redacted capture from live
Gmail is needed to discover markup the implementation did not anticipate.

Real email is sensitive. Never commit a raw capture.

## 1. Capture the print view

Open the target conversation in Gmail. In that tab’s DevTools console, run:

```js
(async () => {
  const heading = document.querySelector("h2.hP");
  const id = heading?.getAttribute("data-legacy-thread-id") ||
    heading?.closest("[data-legacy-thread-id]")?.getAttribute("data-legacy-thread-id");
  if (!id) throw new Error("Open a conversation first.");

  const account = location.pathname.match(/\/mail\/u\/(\d+)/)?.[1] || "0";
  const ik = [...document.querySelectorAll('a[href*="ik="]')]
    .map((a) => {
      try {
        const url = new URL(a.getAttribute("href"), location.origin);
        return url.pathname.startsWith(`/mail/u/${account}/`)
          ? url.searchParams.get("ik")
          : null;
      } catch (_) {
        return null;
      }
    })
    .find(Boolean);

  const url = new URL(`/mail/u/${account}/`, location.origin);
  url.searchParams.set("view", "pt");
  url.searchParams.set("search", "all");
  url.searchParams.set("th", id);
  if (ik) url.searchParams.set("ik", ik);

  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`Gmail returned ${response.status}`);
  const blob = new Blob([await response.text()], { type: "text/html" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "gmail-printview-raw.html";
  link.click();
  URL.revokeObjectURL(link.href);
})();
```

The downloaded file contains the real conversation and may contain session
identifiers. Keep it outside the repository and delete it after review.

Useful capture cases include multiple recipients, Bcc, quoted names with commas,
forwarded and inline replies, non-English labels, attachments on several
messages, duplicate filenames, layout-heavy notifications, and long threads.

## 2. Run the redactor

```bash
npm install
npm run redact -- /path/to/gmail-printview-raw.html
```

The tool:

- opens the capture with page JavaScript disabled;
- blocks every network request before loading the HTML;
- removes scripts, executable attributes, comments, embeds, styles, forms, and
  request-capable attributes;
- pseudonymizes addresses, names, filenames, and prose in any script;
- replaces digit runs of five or more, plus telephone and government-identifier
  shapes, so account numbers, record numbers and dates of birth do not survive.
  Runs of four or fewer digits are deliberately kept so times, years and small
  quantities leave the capture parseable — which means a short identifier can
  still get through;
- replaces absolute and relative links, attachment capabilities, and
  `download_url` values;
- writes a non-identifying `real-capture-N.html` name without overwriting;
- writes `real-capture-N.expected.json` with counts and review state.

An explicit output path may be passed as a second argument. Existing output is
never overwritten.

## 3. Review manually

Mechanical redaction is not a privacy guarantee. Inspect the complete HTML for:

- names, organizations, addresses, phone numbers, and physical addresses;
- account, thread, message, attachment, and session identifiers;
- URLs, queries, fragments, relative paths, and encoded data;
- filenames, image metadata, comments, hidden text, and unusual attributes;
- business facts that remain identifying after names are removed.

Inspect the sidecar and set:

```json
{
  "manuallyReviewed": true,
  "expectedComplete": true
}
```

Set `expectedComplete` to the result actually correct for the captured markup.
Confirm `subject`, `messageCount`, and `attachmentCount` against the redacted
HTML and expected parser result. Add a non-sensitive review note for an
intentional partial case.

The suite rejects a `real-*.html` file with no sidecar, an unreviewed sidecar,
missing expected completeness, or mismatched counts. Files named
`synthetic-*.html` are never represented as live-Gmail coverage.

## 4. Verify

```bash
npm run test:e2e
npm run test:all
```

The real-fixture suite checks strict XML, exact expected counts, sender
attribution, expected completeness, and removal of known Gmail/tracker noise.

Delete the raw capture only after the reviewed redacted fixture is safely
stored.

## What fixtures cannot prove

A fixture is one historical HTML shape. It cannot verify the current Gmail UI,
Chrome shortcut registration, account expiration, themes, or real download
preferences. Use `manual-test.md` for those.
