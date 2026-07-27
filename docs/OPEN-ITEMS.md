# Open items

State as of version 2.1.

## Requires a live Gmail session

The automated browser harness intentionally has no Google credentials. Before a
release, verify the cases in `manual-test.md`, especially:

- current Gmail print-view markup on several real accounts;
- multiple To/Cc/Bcc recipients and localized labels;
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
shipped artifact is exercised rather than the source tree. There is still no
signed package or Chrome Web Store listing, and updates remain manual.

A Web Store listing would improve updates but introduces silent auto-update and
publisher-account considerations; that decision remains explicitly deferred.
`PRIVACY.md` exists and would satisfy the Web Store's mandatory privacy-policy
requirement if that decision is revisited.

## Known product limits

- Gmail internals are undocumented and can break the adapter.
- Recipient localization is incomplete.
- The mailbox owner is not identified.
- Branching reply relationships are flattened into print order.
- Binary attachments are delivered, not parsed; there is no OCR.
- Chrome download completion is not known at clipboard-build time, so output
  truthfully says `download started`.
- `date` is derived by reinterpreting Gmail's offset-less timestamp in the
  browser's timezone, which `<capture_timezone>` records. `local` is the
  authoritative rendering.
- Windows has never been executed against; see the Windows section of
  `manual-test.md`.
- Some signatures or quoted history remain when removal would risk deleting
  content.

## Future work worth considering

- add reviewed live-Gmail fixtures for the cases above;
- publish tagged release archives so users stop installing the whole repository;
- investigate whether Gmail exposes a stable mailbox-owner signal without
  adding OAuth or broader permissions;
- add localized recipient-label fixtures only after observing real markup.

Do not weaken exact thread/subject checks, attachment URL validation, or
partial-capture signaling in order to make an unusual thread appear successful.
