# Chrome Web Store reviewer notes

Paste this into the optional Test instructions field.

## Test instructions

No extension account, OAuth consent, API key, subscription, or paid feature is
required. The reviewer may use any Gmail account available to the reviewer.

1. Install the extension and reload an existing `https://mail.google.com` tab.
2. Open a Gmail conversation containing at least two messages.
3. Open the extension popup. It should show **Copy thread** and
   **Copy + save files**.
4. Choose **Copy thread**, then paste into a plain-text editor. The output
   should begin with `<email_thread format_version="3">` and include messages,
   participants, completeness fields, and any warnings.
5. Return to the same thread and use the two small controls beside the subject
   to verify the in-page interaction. The visible **Reads this thread locally**
   notice is the in-page data-handling disclosure.
6. To test **Copy + save files**, use a conversation with a harmless test
   attachment. Chrome should start a download below
   `gmail-threads/<sanitized-subject>/`. This action is separate from ordinary
   copy.
7. Open the inbox or a non-Gmail tab. The popup should explain that a Gmail
   conversation must be open rather than attempting to read another site.

## Architecture and privacy notes

- Manifest V3, no remote code, and no runtime dependencies.
- Host permission and content-script matches are limited to
  `https://mail.google.com/*`.
- No publisher server, OAuth, analytics, telemetry, advertising, account,
  storage API, cookies, or persistent identifiers.
- All parsing is local. The only runtime network destination is Gmail.
- Attachment URLs are independently validated in the content script and again
  at the service-worker download boundary.
- The repository and test suite are public at
  <https://github.com/moekoelueker/copy-gmail-thread-for-ai>.

The Developer Preview warning is intentional. The parser fails closed or marks
results partial when Gmail markup cannot be verified rather than presenting an
uncertain capture as complete.
