# Privacy policy

**Copy Gmail Thread for AI** — effective and last updated 25 August 2026.

Publisher: Zena Labs LLC. Privacy contact: <zenalabsllc@gmail.com>. Support:
<https://github.com/moekoelueker/copy-gmail-thread-for-ai/issues>.

## The short version

The extension processes the one Gmail conversation you choose entirely inside
your browser. It has no publisher-operated server, sends no copy of your Gmail
content to Zena Labs LLC, an AI provider, analytics service, advertiser, or any
other destination, and stores nothing between uses. Its only network access is
to Gmail itself, using the Gmail session you are already signed into, to fetch
the conversation and attachments you requested.

The local information it handles can include personal communications, names,
email addresses, message text, timestamps, attachment names and attachment
contents. It handles that information only to perform the user-requested copy
or download operation described below.

## What it does with your data

When you choose **Copy thread** or **Copy + save files** on an open Gmail
conversation, the extension:

1. asks Gmail, on `https://mail.google.com` only, for the print view of that
   one conversation, using your existing browser session;
2. converts it into structured text in the page;
3. writes that text to your clipboard;
4. if you chose **Copy + save files**, asks Chrome to download that
   conversation's attachments to your normal download directory.

Message text, addresses, timestamps and attachment contents are held in memory
only for as long as that operation takes.

The extension does not automatically send the resulting clipboard text to an
AI service or any other destination. A separate paste or upload by you is what
transmits that information to the destination you choose.

## What it does not do

- No copy of Gmail content is sent to the publisher, an AI provider, analytics
  service, advertiser, or other new destination. The only network origin the
  extension can reach is `https://mail.google.com`, enforced by the host
  permission in the manifest and re-checked before every request and download.
- No Google OAuth, API key, account, or sign-in of any kind.
- No analytics, telemetry, crash reporting, advertising, or tracking.
- No use of `chrome.storage`, `localStorage`, extension cookies, or any other
  persistence. The extension does not read or write Gmail cookies; Chrome only
  supplies the browser's existing Gmail session to the Gmail request. Nothing
  stored by the extension survives a page reload.
- No selling, renting, or sharing of user data, and no use of it for any purpose
  other than the single purpose above.
- No remote code. All code ships in the package and is readable in the
  repository.

## Retention, access and deletion

Zena Labs LLC does not receive or retain extension user data, so it has no
publisher-held copy to access, correct, export or delete. In-memory data is
discarded when the operation completes or the page reloads. Clipboard contents
remain under the operating system's control, and downloaded files remain in
the directory configured in Chrome until you remove them.

## Chrome Web Store Limited Use

The extension uses information received from Google services only to provide
its disclosed single purpose: converting the Gmail conversation selected by
the user into structured clipboard text and, when explicitly requested,
downloading its attachments. The extension's use of information received from
Google services adheres to the Chrome Web Store User Data Policy, including the
Limited Use requirements.

## Permissions and why each exists

| Permission | Why |
|---|---|
| `https://mail.google.com/*` | Read the open conversation and its attachments through your existing session. This is the only host the extension can contact. |
| `clipboardWrite` | Put the copied conversation on your clipboard, including from the keyboard shortcut. |
| `downloads` | Start downloads for that conversation's attachments, only when you choose **Copy + save files**. |

## Where your data goes after you paste it

The clipboard is the hand-off point, and it is where the extension's control
ends. If you paste a conversation into ChatGPT, Claude, or any other tool, that
conversation is transmitted to that provider and handled under **their** privacy
policy and retention terms — not this one. Email threads routinely contain other
people's personal information, so consider what a thread contains before pasting
it into a third-party service.

Downloaded attachments are ordinary files in your download directory. Deleting
them is up to you.

## Children

The extension is a general-audience productivity tool and is not directed to
children under 13. It does not ask for a user's age, create an extension
account, or send Gmail content or persistent identifiers to Zena Labs LLC. If
Zena Labs LLC learns that future publisher-operated functionality has received
personal information from a child in a manner requiring deletion or parental
consent, it will address that information as required by applicable law.

## Changes

Material changes to this policy or to the extension's data practices will be
prominently disclosed before the changed practice begins. Changes are also
recorded in the repository's commit history alongside a version bump.
