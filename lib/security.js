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

    let u;
    try {
      u = new URL(String(raw || ""), GMAIL_ORIGIN);
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
    safeDownloadPath,
    reportedDownloadPath,
  };
})();
