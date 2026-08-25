# Release verification results

Verified 25 August 2026 against version 2.2.0.

## Automated checks

- `npm ci`: completed; 0 known dependency vulnerabilities reported.
- `npm test`: 104/104 passed.
- `npm run test:browser`: 80/80 passed in Chromium.
- `npm run test:e2e`: 37/37 runnable tests passed; one intentionally skipped
  real-thread fixture test because the repository contains no reviewed real
  Gmail capture.
- `git diff --check`: passed.

## Package

- File: `copy-gmail-thread-for-ai-2.2.0.zip`
- Size: 64,872 bytes
- Runtime entries: 24
- SHA-256:
  `9bce18b9b3f6f884c2eb2fea80342268e470edddd6480678c9c510929c1ecf92`
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

- Live-Gmail manual checklist on the current Chrome/Gmail interface.
- Windows live pass, or continued disclosure that Windows is unverified.
- Publisher trader/contact/address/2-step-verification confirmation.
- Dashboard upload and validation.
- Final legal review if the release will be promoted, monetized, or used beyond
  the small Developer Preview.
- Explicit owner confirmation before **Submit for review**.
