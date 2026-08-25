# Chrome Web Store Privacy form values

These values are written to match version 2.2.0. Re-check them against the
package whenever runtime behavior changes.

Google began enforcing its updated disclosure rules on 1 August 2026. The
pre-install store description and the in-product popup therefore both state
what Gmail data is handled, why it is handled, that processing is local, and
that no publisher or third party receives or retains it. Each copy action is a
specific affirmative user action after those disclosures.

## Single purpose

At the user's request, read the one Gmail conversation currently open in the
browser, convert it locally into structured clipboard text with completeness
warnings, and optionally start downloads for that conversation's verified
attachments.

## Permission justifications

**Host permission — `https://mail.google.com/*`**

Required to identify the Gmail conversation open in the active tab, request
that same conversation's Gmail print view using the user's existing browser
session, read its message content and verified attachment metadata, and fetch
or download attachments only when the user activates the corresponding
feature. The content script and all runtime network validation are limited to
this exact HTTPS origin.

**`clipboardWrite`**

Required to place the user-requested structured conversation on the clipboard
from the in-page control, extension popup, or keyboard command. Clipboard data
is not transmitted to the publisher or automatically sent to another service.

**`downloads`**

Required only for the explicit **Copy + save files** action. It starts Chrome
downloads for attachment URLs that are revalidated against the active Gmail
account and thread and confines requested paths to a relative
`gmail-threads/` directory. The ordinary **Copy thread** action starts no file
downloads.

## Remote code

Select **No, I am not using remote code**. Every executable file is packaged
with the extension. There are no CDN scripts, remotely hosted modules, dynamic
code downloads, `eval`, or runtime dependencies.

## User data handled

Google requires disclosure even when data is processed only locally. Select
the dashboard categories corresponding to:

- Personally identifiable information — message participant names and email
  addresses can appear in the selected conversation.
- Personal communications — email message bodies, headers, recipients,
  timestamps, and attachments in the selected conversation.
- Website content — the extension reads the open Gmail conversation and its
  Gmail print view.
- User-generated content — select this as well if the current form presents it
  as a separate applicable category for email or attachment content.

Do not select authentication information: the extension does not read cookies,
passwords, OAuth tokens, or API keys. Chrome sends the existing Gmail session
to Gmail as part of the same-origin request, but the extension cannot read or
store that credential.

Do not select web history unless the dashboard's current wording explicitly
requires it for checking whether the active tab is on `mail.google.com`. The
extension does not build, store, or transmit browsing history; it only checks
the active page to decide whether its Gmail-only action is available.

## Data-use certifications

Certify all of the following because they are enforced by the current code:

- User data is used only for the disclosed single purpose.
- User data is not sold or transferred to third parties.
- User data is not used or transferred for advertising, profiling,
  creditworthiness, or lending.
- User data is not retained by the publisher.
- Humans at Zena Labs LLC cannot read extension user data because no such data
  is transmitted to or stored by Zena Labs LLC.
- Data handling complies with the Chrome Web Store User Data Policy, including
  the Limited Use requirements.

## Privacy-policy URL

<https://github.com/moekoelueker/copy-gmail-thread-for-ai/blob/main/PRIVACY.md>

## In-product disclosure

Before the copy buttons, the popup states that a copy action reads the open
Gmail conversation—including message text, participant details, links, and
attachment information—processes it locally to create the requested output,
and does not send or retain that data. It also states that the extension uses
the signed-in Gmail tab, has no Google sign-in or extension account, is a
Developer Preview built for personal productivity, requires review before
sharing or relying on output, and links to the Privacy Policy, Terms, and
support page.

The Gmail page controls also display **Reads this thread locally** immediately
beside the copy actions. Their accessible description explains the locally
handled message, participant, link, and attachment information and states that
the extension does not send or retain it.
