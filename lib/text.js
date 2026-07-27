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
      .replace(/\s+\./g, ".")
      .replace(/[.\s]+$/g, "")
      .trim();

    if (!n || n === ".") n = fallback;
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(n)) n = `_${n}`;

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
    s = s.slice(0, 60).replace(/-+$/, "") || fallback;
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s) ? `_${s}` : s;
  }

  function formatSize(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return "unknown size";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function parseSizeBytes(value) {
    const raw = String(value == null ? "" : value)
      .replace(",", ".")
      .trim();
    const m = raw.match(/^(\d+(?:\.\d+)?)\s*(B|K|KB|M|MB|G|GB)$/i);
    if (!m) return null;
    const factors = {
      B: 1,
      K: 1024,
      KB: 1024,
      M: 1024 * 1024,
      MB: 1024 * 1024,
      G: 1024 * 1024 * 1024,
      GB: 1024 * 1024 * 1024,
    };
    const n = Number(m[1]) * factors[m[2].toUpperCase()];
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
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
    const raw = String(href || "").trim();
    if (/^mailto:[^\s@]+@[^\s@]+/i.test(raw)) return true;
    if (!/^https?:\/\//i.test(raw)) return false;
    try {
      const url = new URL(raw);
      return (
        (url.protocol === "https:" || url.protocol === "http:") &&
        Boolean(url.hostname) &&
        !url.username &&
        !url.password
      );
    } catch (_) {
      return false;
    }
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
    let out = String(s == null ? "" : s);
    try {
      out = out.normalize("NFKC");
    } catch (_) {
      /* malformed input; compare the original code points */
    }
    out = out
      .replace(ODD_SPACES, " ")
      .toLowerCase();
    let prev;
    do {
      prev = out;
      out = out.replace(
        /^\s*(re|fwd|fw|aw|wg|antwort|sv|vs|tr|回复|回覆|答复|転送)\s*[:：]\s*/iu,
        ""
      );
    } while (out !== prev);
    return out.replace(/[\p{P}\p{Z}]+/gu, " ").trim();
  }

  // Thread identity is a security boundary. Missing subjects and substring
  // matches fail closed: "Budget" and "Budget Q3" may be different threads, and
  // non-Latin subjects must not collapse to an empty ASCII-only comparison.
  function subjectsMatch(a, b) {
    const x = normSubject(a);
    const y = normSubject(b);
    if (!x || !y) return false;
    return x === y;
  }

  CT.text = {
    toIso,
    sanitizeFilename,
    slugify,
    formatSize,
    parseSizeBytes,
    unwrapRedirect,
    unwrapImageProxy,
    isSafeUrl,
    normalizeAddress,
    normSubject,
    subjectsMatch,
  };
})();
