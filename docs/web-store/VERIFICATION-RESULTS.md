# Release verification results

## Version 2.2.2 — verified 5 September 2026

Fix release. A fresh Web Store install on another person's account refused
every copy with "Gmail returned a different conversation" while 2.2.1 worked on
the publisher's account. Cause: thread identity was read only from the
heading's legacy id attribute and sent to Gmail in the older `th=` form, and
Gmail is A/B testing how it exposes thread ids — on some accounts the attribute
is absent or the literal string `undefined`, which passed the id shape check.
The print view is now requested by Gmail's permanent thread id whenever the
heading carries one (the form Gmail's own **Print all** uses), the legacy form
is the fallback, placeholder values are rejected, two ids that disagree are
refused with the reload advice, and the refusal notice names both subjects.

- `npm test`: 138/138 passed.
- `npm run test:browser`: 115/115 passed in Chromium.
- `npm run test:e2e`: 43/43 runnable tests passed; one intentionally skipped
  real-thread fixture test. Four new regressions cover the permanent-id
  request, the `undefined` placeholder, conflicting ids, and a heading with no
  usable id; the wrong-conversation test now requires both subjects in the
  notice.
- `git diff --check`: passed.

Package: `copy-gmail-thread-for-ai-2.2.2.zip`, 73,261 bytes, 24 runtime
entries, SHA-256
`657766d92aa8fab442f0628b3756e30c5a3f62aed7699091c5f1813e6228e2f7`.
Permission boundary unchanged from 2.2.1. Still unverified live on the
reporting account; the notice now carries what a report needs.

## Version 2.2.1 — verified 27 August 2026

## Automated checks

- `npm ci`: completed; 0 known dependency vulnerabilities reported.
- `npm test`: 135/135 passed.
- `npm run test:browser`: 115/115 passed in Chromium.
- `npm run test:e2e`: 39/39 runnable tests passed; one intentionally skipped
  real-thread fixture test because the repository contains no reviewed real
  Gmail capture.
- `git diff --check`: passed.

The end-to-end suite includes regressions for a Gmail-rendered emoji in the
subject, print-view title decoration, genuinely mismatched conversations,
conversation changes during capture, unsent drafts, attachment security, and
installation from the built release archive.

## Prior live Gmail smoke test

Verified 25 August 2026 on macOS in the Zena Labs Chrome profile against the
current Gmail interface. This test used version 2.2.0; the version 2.2.1 package
has been covered by the expanded automated regression suite above:

- Version 2.2.0 loaded unpacked and injected its controls into an open Gmail
  conversation after the tab was reloaded.
- The in-page disclosure, **Copy thread**, and **Copy + save files** controls
  rendered beside the subject.
- **Copy thread** produced a complete format-version-3 document from a
  single-message, system-generated conversation. The root and closing tags,
  message count, subject, participant list, sender, sender email, recipient,
  parsed and displayed timestamps, Markdown body, content-trust marker, Gmail
  source URL, and all completeness fields were present.
- The capture reported all three completeness dimensions and overall
  completeness as `true`, with no capture warnings.
- The copied output contained no raw Gmail attachment capability URL and no
  Markdown remote-image embed.
- **Copy + save files** completed on the same no-attachment conversation,
  produced the same complete structure, and correctly started no download.
- The extension popup opened and displayed both actions, the Developer Preview
  notice, and the privacy, terms, and support links.
- No in-page copy controls appeared in the inbox when no conversation was open.

No mailbox content, email address, publisher-verification link, or other live
message data was saved to the repository or included in these results.

This was deliberately a smoke test, not completion of the full manual matrix.
Still unverified live: a multi-message/collapsed conversation, real text and
binary attachments, the popup-triggered copy action, global shortcut
registration, a second Gmail account, dark theme, explicit narrow-layout and
keyboard-focus passes, failure-mode scenarios, very long threads, and Windows.

## Package

- File: `copy-gmail-thread-for-ai-2.2.1.zip`
- Size: 71,542 bytes
- Runtime entries: 24
- SHA-256:
  `13d700b9f5599993602104820cd19a0cd1f3a05282a2e3d1b4d195091fe5f766`
- `manifest.json` is at the archive root.
- The archive contains only runtime code, icons, and the license/privacy/terms/
  support documents—no tests, fixtures, generated concepts, store artwork,
  dependencies, or development tools.

## Static privacy and permission audit

- Manifest V3.
- Required API permissions: `downloads`, `clipboardWrite`.
- Required host permission: `https://mail.google.com/*` only.
- Content script match: `https://mail.google.com/*` only.
- Runtime network code is confined to Gmail, plus user-initiated links from the
  popup to the public repository's privacy, terms, and support pages.
- No analytics, telemetry, ads, account system, OAuth, remote code, persistent
  identifiers, or extension storage.
- The popup and Gmail in-page controls both visibly disclose local handling
  before their copy actions.

## Secondary legal and identity review

- Public legal identity and copyright notice: **Zena Labs LLC** only.
- Developer Preview, no-professional-service, user-review, warranty,
  limitation-of-liability, narrow indemnification, severability, and
  non-affiliation language reviewed for internal consistency.
- Privacy language distinguishes local handling from publisher collection and
  describes clipboard/download retention accurately.
- Children language describes a general-audience tool without incorrectly
  claiming the extension handles no data locally.
- Mandatory consumer rights are expressly preserved; enforceability still
  depends on applicable law and should be assessed by qualified counsel before
  material monetization or broad commercial promotion.

## Store artwork

- Store icon: 128 × 128.
- Small promotional tile: 440 × 280.
- Optional marquee tile: 1400 × 560.
- Three screenshots: 1280 × 800 each.
- Icon comparison sheet: current production icon plus six original concepts.

## Checks that still require a person or external account

- Remaining live-Gmail cases in `docs/manual-test.md`, including attachments,
  multiple messages/accounts, popup and shortcut execution, themes, and failure
  behavior.
- Windows live pass, or continued disclosure that Windows is unverified.
- Publisher trader/contact/address/2-step-verification confirmation.
- Dashboard upload and validation.
- Final legal review if the release will be promoted, monetized, or used beyond
  the small Developer Preview.
- Explicit owner confirmation before **Submit for review**.
