# Privacy policy

**Copy Gmail Thread for AI** — last updated 27 July 2026.

Publisher: Zena Labs LLC. Contact: the issue tracker at
<https://github.com/moekoelueker/copy-gmail-thread-for-ai/issues>.

## The short version

The extension has no server. It collects nothing, transmits nothing to the
publisher, and stores nothing between uses. Everything it does happens inside
your own browser, using the Gmail session you are already signed into.

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

## What it does not do

- No data is sent to the publisher or to any third party. The only network
  destination the extension can reach is `https://mail.google.com`, enforced by
  the host permission in the manifest and re-checked before every request and
  every download.
- No Google OAuth, API key, account, or sign-in of any kind.
- No analytics, telemetry, crash reporting, advertising, or tracking.
- No use of `chrome.storage`, cookies, `localStorage`, or any other persistence.
  Nothing survives a page reload.
- No selling, renting, or sharing of user data, and no use of it for any purpose
  other than the single purpose above.
- No remote code. All code ships in the package and is readable in the
  repository.

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

The extension is not directed at children and collects no data from anyone.

## Changes

Material changes to this policy will be recorded in the repository's commit
history alongside a version bump.
