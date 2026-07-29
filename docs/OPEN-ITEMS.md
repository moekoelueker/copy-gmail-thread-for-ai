# Open items

State as of version 2.1.

## Requires a live Gmail session

The automated browser harness intentionally has no Google credentials. Before a
release, verify the cases in `manual-test.md`, especially:

- current Gmail print-view markup on several real accounts;
- multiple To/Cc/Bcc recipients and localized labels;
- that recipient labels always carry a colon — the parser now requires one, and
  a colonless locale would degrade to an explicit partial header;
- senders whose display names begin with label words (Tobias, Tom, Andrea);
- inline replies created by Gmail, Outlook, and Apple Mail;
- attachments across multiple messages, including duplicate filenames;
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
can install without downloading the whole repository. There is still no
Chrome Web Store listing, and updates remain manual.

A Web Store listing would improve updates but introduces silent auto-update and
publisher-account considerations; that decision remains explicitly deferred.
`PRIVACY.md` exists and would satisfy the Web Store's mandatory privacy-policy
requirement if that decision is revisited.

## Known product limits

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
- Some signatures or quoted history remain when removal would risk deleting
  content.

## Future work worth considering

- add reviewed live-Gmail fixtures for the cases above;
- investigate whether Gmail exposes a stable mailbox-owner signal without
  adding OAuth or broader permissions;
- add localized recipient-label fixtures only after observing real markup.

Do not weaken exact thread/subject checks, attachment URL validation, or
partial-capture signaling in order to make an unusual thread appear successful.
