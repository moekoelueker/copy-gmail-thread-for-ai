// Pure string helpers. No DOM, no chrome.*, no network.
// Everything here is unit-tested in Node (test/text.test.js).

(() => {
  const CT = (globalThis.CT = globalThis.CT || {});

  const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
  const ODD_SPACES = /[\u00A0\u2007\u202F]/g;

  // ---------- dates ----------

  // Gmail renders dates in the viewer's own timezone with no offset, e.g.
  // "Mon, Jul 7, 2026 at 4:03 PM". Date parses an offset-less string as local
  // time, so toISOString() yields the correct instant. If parsing fails we
  // return null and the caller emits the raw string — never a fabricated date.
  function toIso(raw) {
    if (!raw) return null;
    const cleaned = String(raw)
      .replace(ODD_SPACES, " ")
      .replace(/\bat\b/i, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    const ms = Date.parse(cleaned);
    if (Number.isNaN(ms)) return null;
    const d = new Date(ms);
    // Guard against Date.parse accepting something absurd.
    const year = d.getUTCFullYear();
    if (year < 1990 || year > 2100) return null;
    return d.toISOString();
  }

  // ---------- filenames ----------

  // Attachment filenames are attacker-controlled: anyone can mail you a file
  // called "../../.zshrc" or one padded with control characters. chrome.downloads
  // rejects ".." path components, but we never rely on that as the only defence.
  // Unicode letters are preserved so "Angebot-Gruen.pdf" and umlauts survive.
  function sanitizeFilename(name, fallback = "attachment") {
    let n = String(name == null ? "" : name);
    try {
      n = n.normalize("NFC");
    } catch (_) {
      /* malformed input; keep as-is */
    }
    n = n
      .replace(CONTROL_CHARS, "")
      .replace(/[/\\]/g, "_")
      .replace(/[^\p{L}\p{N}._ ()-]/gu, "_")
      .replace(/\.{2,}/g, ".") // collapse ".." so no traversal survives
      .replace(/^[.\s]+/, "")
      .replace(/_{2,}/g, "_")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (!n || n === ".") n = fallback;

    if (n.length > 100) {
      const m = n.match(/\.[\p{L}\p{N}]{1,8}$/u);
      const ext = m ? m[0] : "";
      n = n.slice(0, 100 - ext.length).trim() + ext;
    }
    return n;
  }

  // Folder name derived from the thread subject.
  function slugify(subject, fallback = "thread") {
    let s = String(subject == null ? "" : subject)
      .toLowerCase()
      .replace(CONTROL_CHARS, "")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!s) return fallback;
    return s.slice(0, 60).replace(/-+$/, "") || fallback;
  }

  function formatSize(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return "unknown size";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  // ---------- urls ----------

  // Gmail rewrites outbound links through google.com/url?q=<real>. Unwrap so the
  // model sees the destination rather than a tracking hop.
  function unwrapRedirect(href) {
    try {
      const u = new URL(href, "https://mail.google.com");
      if (/(^|\.)google\.com$/.test(u.hostname) && u.pathname === "/url") {
        const target = u.searchParams.get("q") || u.searchParams.get("url");
        if (target && /^https?:/i.test(target)) return target;
      }
      return href;
    } catch (_) {
      return href;
    }
  }

  function isSafeUrl(href) {
    return /^(https?:|mailto:)/i.test(String(href || "").trim());
  }

  // Gmail's image proxy wraps the real source and appends it after a "#".
  // The proxy URL itself is session-gated and useless to anything downstream,
  // so recover the underlying address when it is there.
  function unwrapImageProxy(src) {
    const s = String(src || "");
    if (!/googleusercontent\.com\/(proxy|meips)/i.test(s)) return s;
    const i = s.indexOf("#http");
    return i > -1 ? s.slice(i + 1) : s;
  }

  // "Moe Lueker <moe@x.com>" -> "Moe Lueker (moe@x.com)".
  // Angle brackets around addresses are the mail convention, but inside a
  // tagged document they read as markup. Parentheses carry the same meaning
  // with no ambiguity, and match how participants are rendered.
  function normalizeAddress(s) {
    const raw = String(s == null ? "" : s).trim();
    const m = raw.match(/^(.*?)[<〈]\s*([^>〉]+?)\s*[>〉]$/);
    if (!m) return raw;
    const name = m[1].trim().replace(/^["']|["']$/g, "");
    const addr = m[2].trim();
    return name && name !== addr ? `${name} (${addr})` : addr;
  }

  function normSubject(s) {
    let out = String(s == null ? "" : s).toLowerCase();
    let prev;
    do {
      prev = out;
      out = out.replace(/^\s*(re|fwd|fw|aw|wg|antwort)\s*:\s*/i, "");
    } while (out !== prev);
    return out.replace(/[^a-z0-9]+/g, " ").trim();
  }

  // Cheap guard against having fetched a different conversation than the one on
  // screen. Returns true when we cannot tell, so a missing title never blocks a
  // legitimate copy.
  function subjectsMatch(a, b) {
    const x = normSubject(a);
    const y = normSubject(b);
    if (!x || !y) return true;
    return x.includes(y) || y.includes(x);
  }

  CT.text = {
    toIso,
    sanitizeFilename,
    slugify,
    formatSize,
    unwrapRedirect,
    unwrapImageProxy,
    isSafeUrl,
    normalizeAddress,
    normSubject,
    subjectsMatch,
  };
})();
