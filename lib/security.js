// Security boundaries shared by the content script and service worker.
//
// Attachment metadata ultimately comes from email-controlled DOM. Host
// permissions do not constrain chrome.downloads, so every URL and path is
// validated again at the last privileged boundary.

(() => {
  const CT = (globalThis.CT = globalThis.CT || {});

  const GMAIL_ORIGIN = "https://mail.google.com";
  const DOWNLOAD_ROOT = "gmail-threads";
  const THREAD_DOCUMENT_NAME = "thread.xml";
  const MAX_THREAD_DOCUMENT_BYTES = 5 * 1024 * 1024;

  function accountIndexFromUrl(value) {
    try {
      const u = new URL(String(value || ""), GMAIL_ORIGIN);
      if (u.origin !== GMAIL_ORIGIN) return null;
      const m = u.pathname.match(/^\/mail\/u\/(\d+)(?:\/|$)/);
      if (m) return m[1];
      return /^\/(?:mail\/?)?$/.test(u.pathname) ? "0" : null;
    } catch (_) {
      return null;
    }
  }

  // Gmail renders its id attributes with the literal string "undefined" before,
  // or instead of, a real value; two other Gmail extensions guard for it. It
  // has the shape of an id, and sent to Gmail it named some other conversation.
  const PLACEHOLDER_ID = /^(?:undefined|null)$/i;

  function validThreadId(value) {
    const id = String(value || "");
    return (
      id.length >= 4 &&
      id.length <= 256 &&
      /^[A-Za-z0-9._:-]+$/.test(id) &&
      !PLACEHOLDER_ID.test(id)
    );
  }

  // Gmail's permanent thread id, the form its own "Print all" uses today:
  // thread-f:<digits> once the server has assigned one, thread-a:<id> while a
  // thread exists only in this client.
  const PERM_THREAD_ID = /^thread-[a-z]:([A-Za-z0-9._-]{1,128})$/;

  function validPermThreadId(value) {
    const match = PERM_THREAD_ID.exec(String(value || ""));
    return Boolean(match) && !PLACEHOLDER_ID.test(match[1]);
  }

  // The legacy hex id is the same 64-bit number as a thread-f id, in base 16;
  // InboxSDK derives it the same way from Gmail's own responses. Only thread-f
  // qualifies: a thread-a id is client-assigned and has no legacy form.
  function legacyThreadIdFromPermId(value) {
    const match = /^thread-f:(\d{1,20})$/.exec(String(value || ""));
    if (!match) return null;
    try {
      const n = BigInt(match[1]);
      return n > 0n && n < 1n << 64n ? n.toString(16) : null;
    } catch (_) {
      return null;
    }
  }

  // Resolve relative Gmail links, then require the exact account and thread.
  // A URL merely containing "view=att" is not an attachment capability.
  function resolveAttachmentUrl(raw, context = {}) {
    if (!validThreadId(context.threadId)) return null;
    const accountIndex = String(context.accountIndex ?? "");
    if (!/^\d+$/.test(accountIndex)) return null;

    // Resolve against the account's own directory, not the bare origin. The
    // print view is served from /mail/u/<n>/ and writes its attachment hrefs
    // relative to it, so an origin base turned a legitimate link into pathname
    // "/" and the account check below then refused it. The check keeps its
    // teeth either way: an absolute URL ignores the base, and any relative
    // form that climbs or descends out of this directory still fails it.
    let u;
    try {
      u = new URL(String(raw || ""), `${GMAIL_ORIGIN}/mail/u/${accountIndex}/`);
    } catch (_) {
      return null;
    }

    if (u.href.length > 4096) return null;
    if (u.protocol !== "https:" || u.origin !== GMAIL_ORIGIN) return null;
    if (u.pathname !== `/mail/u/${accountIndex}/`) return null;
    if (
      u.searchParams.getAll("view").length !== 1 ||
      u.searchParams.get("view") !== "att"
    ) {
      return null;
    }
    // "th" on an attachment link is the id of the *message* carrying the file,
    // not of the thread. A Gmail thread id is its first message's id, so the
    // two coincide only for message 1 — which is why every synthetic fixture
    // passed while a real thread refused every attachment after the first.
    // Requiring equality here meant "Copy + save files" saved nothing at all
    // on any conversation with a reply, which is most of them.
    //
    // Relaxing this costs less than it appears. At the service-worker boundary
    // the comparison was already self-referential: context.threadId arrives in
    // the same message as the URL, so a caller supplying both could satisfy it
    // with any thread. What actually scopes an attachment is the account index,
    // which is derived from the sender's own tab and never from the message,
    // together with the fact that a link has to be rendered as Gmail's own
    // attachment markup to be discovered in the first place.
    if (u.searchParams.getAll("th").length !== 1) return null;
    const messageId = u.searchParams.get("th");
    if (!validThreadId(messageId)) return null;
    if (context.exactThread === true && messageId !== String(context.threadId)) return null;
    const attachmentId = u.searchParams.get("attid") || "";
    if (
      u.searchParams.getAll("attid").length !== 1 ||
      !/^[A-Za-z0-9._:-]{1,256}$/.test(attachmentId)
    ) {
      return null;
    }
    if (u.username || u.password || u.hash) return null;

    return u.href;
  }

  function safeDownloadPath(value) {
    const path = String(value || "");
    if (!path || path.length > 240) return false;
    if (/[\u0000-\u001f\u007f\\:*?"<>|]/.test(path)) return false;
    if (path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.includes("://")) return false;

    const parts = path.split("/");
    if (parts[0] !== DOWNLOAD_ROOT || parts.length < 3) return false;
    return parts.every((part) => {
      if (!part || part === "." || part === ".." || /[. ]$/.test(part)) return false;
      const stem = part.split(".")[0].replace(/[. ]+$/g, "");
      return !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem);
    });
  }

  // Identity of the underlying attachment capability, independent of the
  // session and rendering parameters Gmail varies between surfaces.
  //
  // The print view and the live attachment chip describe the same file with
  // different URLs: the chip adds ui/ik/permmsgid/realattid, the print view may
  // not. Comparing full hrefs therefore reports one attachment as two. Prefer
  // the strongest identifier present; realattid is unique per attachment,
  // permmsgid scopes attid to a message, and bare attid is per-message only.
  function attachmentCapabilityKey(url) {
    let u;
    try {
      u = new URL(String(url || ""), GMAIL_ORIGIN);
    } catch (_) {
      return null;
    }
    const realattid = u.searchParams.get("realattid") || "";
    if (realattid) return `realattid:${realattid}`;
    const attid = u.searchParams.get("attid") || "";
    if (!attid) return null;
    const permmsgid = u.searchParams.get("permmsgid") || "";
    return permmsgid ? `msg:${permmsgid}:${attid}` : `attid:${attid}`;
  }

  // The complete authorization decision for a download request, in one place.
  //
  // background.js is a thin caller so this can be exercised directly with
  // forged senders. Host permissions do not constrain chrome.downloads, and the
  // requesting content script shares a process with email-controlled DOM, so
  // nothing the message carries is trusted: the account index is derived from
  // the sender's own tab, never from the message.
  // Shared by both authorize* entry points below. A sender that fails any of
  // these is forged by construction, whatever it is asking for.
  function trustedSender(sender, runtimeId) {
    if (!sender || !runtimeId || sender.id !== runtimeId) return null;
    // Only the top frame. Subframes are not where this extension's content
    // script runs, so a request from one is forged by construction.
    if (sender.frameId !== 0) return null;

    const tabUrl = String(sender.tab?.url || "");
    if (!/^https:\/\/mail\.google\.com\//.test(tabUrl)) return null;
    const accountIndex = accountIndexFromUrl(tabUrl);
    return accountIndex == null ? null : { accountIndex };
  }

  function authorizeDownload(msg, sender, runtimeId) {
    const REJECTED = { ok: false, error: "download request rejected" };
    const UNSAFE = { ok: false, error: "unsafe download request rejected" };

    if (!msg || msg.type !== "download") return REJECTED;
    const trusted = trustedSender(sender, runtimeId);
    if (!trusted) return REJECTED;

    const url = resolveAttachmentUrl(msg.url, {
      accountIndex: trusted.accountIndex,
      threadId: msg.threadId,
    });
    const path = String(msg.path || "");
    if (!url || !safeDownloadPath(path)) return UNSAFE;

    return { ok: true, url, path };
  }

  // The transcript written alongside a saved thread.
  //
  // Deliberately narrower than authorizeDownload, and deliberately not an
  // overload of it. The message carries no URL at all: the caller supplies only
  // text, and the service worker builds the data: URL itself. A content script
  // shares a process with email-controlled DOM, so if it were allowed to name a
  // URL this path would become a way to have the extension fetch and save
  // anything. It cannot, because there is nothing here to name.
  //
  // The basename is pinned rather than merely sanitized. safeDownloadPath alone
  // would permit any safe name under the download root, which would let a
  // compromised content script scatter files through a user's saved threads;
  // one known name per folder is the whole capability.
  function authorizeThreadDocument(msg, sender, runtimeId) {
    const REJECTED = { ok: false, error: "thread document request rejected" };
    const UNSAFE = { ok: false, error: "unsafe thread document request rejected" };

    if (!msg || msg.type !== "download-thread") return REJECTED;
    if (!trustedSender(sender, runtimeId)) return REJECTED;

    const text = msg.text;
    if (typeof text !== "string" || !text) return UNSAFE;
    // Measured in UTF-8 bytes, not code units: the cap bounds what is encoded
    // into the data: URL, and a string of astral characters is twice the bytes
    // its length suggests.
    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > MAX_THREAD_DOCUMENT_BYTES) return UNSAFE;

    const path = String(msg.path || "");
    if (!safeDownloadPath(path)) return UNSAFE;
    if (path.split("/").pop() !== THREAD_DOCUMENT_NAME) return UNSAFE;

    return { ok: true, text, path };
  }

  // chrome.downloads may uniquify the basename. Report a path relative to
  // Chrome's configured download directory rather than fabricating ~/Downloads.
  function reportedDownloadPath(actualFilename, requestedPath) {
    const requested = String(requestedPath || "").replace(/\\/g, "/");
    const actual = String(actualFilename || "").replace(/\\/g, "/");
    const marker = `/${DOWNLOAD_ROOT}/`;
    const i = actual.lastIndexOf(marker);
    if (i >= 0) return actual.slice(i + 1);
    // Search can run before Chrome exposes its final filename, and automation
    // environments may expose an internal UUID instead. In either case the
    // exact safe path requested from Chrome is more truthful than inventing a
    // hybrid directory/UUID path.
    return requested;
  }

  CT.security = {
    GMAIL_ORIGIN,
    DOWNLOAD_ROOT,
    THREAD_DOCUMENT_NAME,
    MAX_THREAD_DOCUMENT_BYTES,
    accountIndexFromUrl,
    validThreadId,
    validPermThreadId,
    legacyThreadIdFromPermId,
    resolveAttachmentUrl,
    attachmentCapabilityKey,
    authorizeDownload,
    authorizeThreadDocument,
    safeDownloadPath,
    reportedDownloadPath,
  };
})();
