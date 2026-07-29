// Security boundaries shared by the content script and service worker.
//
// Attachment metadata ultimately comes from email-controlled DOM. Host
// permissions do not constrain chrome.downloads, so every URL and path is
// validated again at the last privileged boundary.

(() => {
  const CT = (globalThis.CT = globalThis.CT || {});

  const GMAIL_ORIGIN = "https://mail.google.com";
  const DOWNLOAD_ROOT = "gmail-threads";

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

  function validThreadId(value) {
    const id = String(value || "");
    return id.length >= 4 && id.length <= 256 && /^[A-Za-z0-9._:-]+$/.test(id);
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
    if (
      u.searchParams.getAll("th").length !== 1 ||
      u.searchParams.get("th") !== String(context.threadId)
    ) {
      return null;
    }
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
  function authorizeDownload(msg, sender, runtimeId) {
    const REJECTED = { ok: false, error: "download request rejected" };
    const UNSAFE = { ok: false, error: "unsafe download request rejected" };

    if (!msg || msg.type !== "download") return REJECTED;
    if (!sender || !runtimeId || sender.id !== runtimeId) return REJECTED;
    // Only the top frame. Subframes are not where this extension's content
    // script runs, so a request from one is forged by construction.
    if (sender.frameId !== 0) return REJECTED;

    const tabUrl = String(sender.tab?.url || "");
    if (!/^https:\/\/mail\.google\.com\//.test(tabUrl)) return REJECTED;
    if (accountIndexFromUrl(tabUrl) == null) return REJECTED;

    const url = resolveAttachmentUrl(msg.url, {
      accountIndex: accountIndexFromUrl(tabUrl),
      threadId: msg.threadId,
    });
    const path = String(msg.path || "");
    if (!url || !safeDownloadPath(path)) return UNSAFE;

    return { ok: true, url, path };
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
    accountIndexFromUrl,
    validThreadId,
    resolveAttachmentUrl,
    attachmentCapabilityKey,
    authorizeDownload,
    safeDownloadPath,
    reportedDownloadPath,
  };
})();
