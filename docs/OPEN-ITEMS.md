# Open items

State as of version 2.1.

Output is `format_version="4"`. Version 4 adds `<signature>`; a consumer that
ignores the element sees exactly what version 3 gave it, because that content
was previously deleted outright.

## Requires a live Gmail session

The automated browser harness intentionally has no Google credentials. Before a
release, verify the cases in `manual-test.md`, especially:

- current Gmail print-view markup on several real accounts;
- multiple To/Cc/Bcc recipients and localized labels;
- that recipient labels always carry a colon — the parser now requires one, and
  a colonless locale would degrade to an explicit partial header;
- senders whose display names begin with label words (Tobias, Tom, Andrea);
- inline replies created by Gmail, Outlook, and Apple Mail;
- attachments across multiple messages, including duplicate filenames, and
  specifically an attachment on a message other than the first;
- an unsent draft sitting in a thread. Every message carries `delivery="sent"`
  or `delivery="unconfirmed"`, and an unconfirmed one raises
  `MESSAGE_NOT_CONFIRMED_SENT` alone — not also `HEADER_INCOMPLETE` — and does
  not pull the capture to `complete="false"`. A draft is common, and flipping
  the completeness flag on every thread holding one taught a reader to ignore
  the flag that catches real breakage.

  **Known cost, accepted deliberately:** a *sent* message whose recipient
  labels this parser cannot read is indistinguishable from a draft here, and so
  also no longer affects completeness. It is still reported, in a warning that
  names both readings. Two attempts to separate them by reasoning about the
  markup were both wrong — whatever Gmail prints for a draft is neither an
  absent recipient row nor a recognisable label. **Capture a real print view of
  a thread containing a draft** (`fixtures.md`) before trying again; with that
  markup, `unconfirmed` can become a positive `draft` and the locale case can
  get its `HEADER_INCOMPLETE` back;
- two distinct threads sharing a subject, which must now reach distinct folders;
- that `thread.xml` is written beside the attachments and matches the clipboard;
- Chrome’s real download preferences on macOS and Windows;
- light, dark, and narrow Gmail layouts;
- actual shortcut registration.

Reviewed redacted captures should be added using `fixtures.md`. At present, the
repository contains synthetic fixtures but does not claim a reviewed live-Gmail
fixture.

## Distribution

`npm run package` builds a release archive containing only the ~20 runtime
files, and an end-to-end test installs that archive and drives it, so the
shipped artifact is exercised rather than the source tree. Tagged release
archives are published on the GitHub Releases page (first: v2.1.1), so users
can install without downloading the whole repository. Version 2.2 adds an
upload-ready Web Store package plus listing, privacy, reviewer, legal, and
graphic-asset materials under `docs/web-store/` and `store-assets/`.

The item still must be uploaded, reviewed, and published from the verified
Zena Labs LLC publisher account. Until that happens, updates for unpacked
installs remain manual.

## Known product limits

- Thread identity is read from the subject heading's two id attributes. Gmail
  writes the permanent id (`thread-f:<digits>`) and the legacy hex id on the
  same element, and they are one number in two bases. Gmail is A/B testing how
  it exposes thread ids: on some accounts an attribute is missing or holds the
  literal string `undefined`, which passed the id shape check, went to Gmail as
  `th=undefined`, and had every copy on that account refused as "a different
  conversation" while the same build worked elsewhere. Each attribute is now
  validated on its own, the print view is requested by `permthid=` whenever a
  permanent id is present (the legacy `th=` form is the fallback), the legacy
  id is derived from the permanent one when Gmail withholds it, and two ids
  that disagree are refused with the reload advice. A `thread-a:` id — a
  thread that so far exists only in this client — has no legacy form, so such
  a capture carries no `<url>`. The refusal toast now names both subjects, so
  a report of "a different conversation" is actionable.
- Attachment links are scoped by account, not by thread. `th` on a Gmail
  attachment URL names the *message* carrying the file; a thread id is its
  first message's id, so the two coincide only for message 1. Requiring
  equality refused every attachment after the first — save mode saved nothing
  on any thread with a reply — and it was never the protection it appeared to
  be, because at the service-worker boundary `context.threadId` arrives in the
  same message as the URL. What scopes an attachment now is the account index,
  derived from the sender's own tab and never from the message, plus the fact
  that a link must be rendered as Gmail's own attachment markup to be
  discovered. `resolveAttachmentUrl` still accepts `exactThread: true` for a
  caller that can supply a trustworthy thread id.
- Gmail internals are undocumented and can break the adapter.
- Recipient localization is incomplete. A header line carrying an address the
  parser does not understand (an unsupported locale's label, a wrapped list)
  marks headers partial instead of being dropped silently; Reply-To is the one
  header recognized and deliberately not carried.
- The mailbox owner is not identified.
- Branching reply relationships are flattened into print order.
- Binary attachments are delivered, not parsed; there is no OCR.
- Chrome download completion is not known at clipboard-build time, so output
  truthfully says `download started`.
- `chrome.downloads` requests are invisible to Playwright's `context.route`,
  so the e2e harness resolves `mail.google.com` to a local HTTPS stand-in and
  blackholes every other host at the resolver. Without it those downloads
  reached the real Google, saved its sign-in HTML, and still passed a test
  that only checked for `complete`. Attachment bytes are now asserted.
  `openssl` is required to generate the throwaway certificate.
- `date` is derived by reinterpreting Gmail's offset-less timestamp in the
  browser's timezone, which `<capture_timezone>` records. `local` is the
  authoritative rendering.
- Windows has never been executed against; see the Windows section of
  `manual-test.md`.
- Some quoted history remains when removal would risk deleting content.
- Signature blocks are no longer deleted. Whatever Gmail marked
  `div.gmail_signature` is carried in `<signature>`, because a real capture lost
  a sender's legal disclaimer — who they do and do not represent, and how to
  verify an offer — while a tracking table in the same message survived. The
  heuristic text-level signature trim in `trimQuotedText` is unchanged and can
  still cut a sign-off it judges boilerplate.

## Future work worth considering

- add reviewed live-Gmail fixtures for the cases above;
- investigate whether Gmail exposes a stable mailbox-owner signal without
  adding OAuth or broader permissions;
- add localized recipient-label fixtures only after observing real markup.

Do not weaken exact thread/subject checks, attachment URL validation, or
partial-capture signaling in order to make an unusual thread appear successful.
