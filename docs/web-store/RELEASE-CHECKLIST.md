# Chrome Web Store release checklist

## Completed in the repository

- [x] Manifest V3.
- [x] Narrow Gmail-only host permission.
- [x] No OAuth, remote code, analytics, telemetry, account, or persistent
      storage.
- [x] Privacy Policy with Limited Use disclosure.
- [x] Terms of Use with Developer Preview, warranty, and liability language.
- [x] Support and private-reporting guidance.
- [x] In-product Developer Preview and privacy/terms/support links.
- [x] Store listing, privacy-form values, and reviewer instructions.
- [x] Publisher-account, measurement, donation, and future monetization guidance.
- [x] 128px icon, required promotional tile, and store screenshots.
- [x] Runtime-only release packaging and archive-install end-to-end test.

## Publisher-account checks requiring the account owner

- [ ] Publisher display name is **Zena Labs LLC**.
- [ ] Trader declaration is accurate and verification is complete.
- [ ] Public contact email is verified and monitored.
- [ ] Public business name, address, and phone are accurate.
- [ ] Two-step verification is enabled on the publisher Google account.
- [ ] Zena Labs LLC has reviewed the public business information that the Web
      Store will display.
- [ ] Legal counsel has reviewed `TERMS.md` and `PRIVACY.md` if the extension
      will be promoted, monetized, or used beyond a small Developer Preview.

## Final functional checks

- [ ] Complete `docs/manual-test.md` against a current live Gmail account on
      macOS.
- [ ] Confirm copy, attachment download, popup, in-page controls, warnings,
      dark mode, narrow layout, and keyboard shortcuts.
- [ ] Complete the Windows section or keep Windows described as unverified.
- [ ] Confirm the package version is higher than every previously uploaded
      Web Store version.
- [x] Run `npm ci && npm run test:all && npm run package`.
- [x] Inspect the ZIP and confirm `manifest.json` is at its root.

## Developer Dashboard

- [ ] Add a new item and upload `copy-gmail-thread-for-ai-2.2.0.zip`.
- [ ] Complete Store Listing using `STORE-LISTING.md`.
- [ ] Complete Privacy using `PRIVACY-FORM.md`.
- [ ] Add `REVIEWER-NOTES.md` to Test instructions.
- [ ] Upload the assets from `store-assets/`.
- [ ] Select **Unlisted**, all intended regions, and **No in-app purchases**.
- [ ] Resolve every automated package warning.
- [ ] Stage the release and review the final listing.
- [ ] Submit for review only after the account owner confirms the public legal
      information and the live-Gmail test.

The Submit for Review action is intentionally not automated by this checklist;
it creates an externally reviewed release and should be performed after the
final owner confirmation.
