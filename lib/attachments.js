// Attachment handling.
//
// Deliberately does NOT parse PDFs or Office files. Bundling pdf.js would add
// ~1-2 MB of vendored minified code to an extension that reads your mail, which
// would destroy the one security property that matters here: that you can read
// the whole thing in a sitting. Both consumers of this output (Claude Code off
// disk, claude.ai as an upload) already read PDFs natively, so the job is to
// deliver files, not to understand them.

(() => {
  const CT = (globalThis.CT = globalThis.CT || {});
  const T = CT.text;

  // Formats whose text is worth inlining straight into the clipboard.
  const INLINE_EXT = new Set([
    "txt", "md", "csv", "tsv", "json", "log", "xml", "yml", "yaml", "ics",
  ]);

  const MAX_INLINE_BYTES = 100 * 1024;
  const MAX_INLINE_TOTAL = 300 * 1024;
  const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
  const FOLDER_ROOT = "gmail-threads";

  function extensionOf(name) {
    const m = String(name || "").match(/\.([A-Za-z0-9]{1,8})$/);
    return m ? m[1].toLowerCase() : "";
  }

  function isInlineable(name) {
    return INLINE_EXT.has(extensionOf(name));
  }

  // Gmail stores "mime/type:filename:url" in a download_url attribute. The URL
  // itself contains colons, so split on the first two only.
  function parseDownloadUrl(value) {
    const s = String(value || "");
    const i1 = s.indexOf(":");
    if (i1 < 0) return null;
    const i2 = s.indexOf(":", i1 + 1);
    if (i2 < 0) return null;
    const url = s.slice(i2 + 1);
    if (!/^https?:/i.test(url)) return null;
    return { type: s.slice(0, i1), name: s.slice(i1 + 1, i2), url };
  }

  // Sanitises again rather than trusting the caller. normalise() already cleans
  // the name, but this is the last function before a path reaches the downloads
  // API and it must be safe on its own terms. sanitizeFilename is idempotent.
  function targetPath(subject, filename) {
    return `${FOLDER_ROOT}/${T.slugify(subject)}/${T.sanitizeFilename(filename)}`;
  }

  async function fetchInline(url, budget) {
    const resp = await fetch(url, { credentials: "include" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = await resp.arrayBuffer();
    const total = buf.byteLength;
    const allowed = Math.min(MAX_INLINE_BYTES, budget, total);
    const slice = buf.slice(0, allowed);
    let content = new TextDecoder("utf-8", { fatal: false }).decode(slice);
    if (allowed < total) {
      content += `\n[truncated: ${allowed} of ${total} bytes]`;
    }
    return { content, bytes: allowed, total };
  }

  // Resolve raw DOM hits into a clean, de-duplicated, sanitised list.
  function normalise(raw, subject) {
    const out = [];
    const used = new Map();

    for (const item of raw) {
      const parsed = item.downloadUrl ? parseDownloadUrl(item.downloadUrl) : null;
      const rawName = parsed?.name || item.name || "attachment";
      let name = T.sanitizeFilename(rawName);

      // De-duplicate collisions rather than letting one file overwrite another.
      const seen = used.get(name) || 0;
      used.set(name, seen + 1);
      if (seen > 0) {
        const m = name.match(/^(.*?)(\.[A-Za-z0-9]{1,8})?$/);
        name = `${m[1]} (${seen + 1})${m[2] || ""}`;
      }

      out.push({
        name,
        originalName: rawName,
        type: parsed?.type || "",
        url: parsed?.url || item.href || null,
        inlineable: isInlineable(name),
        path: targetPath(subject, name),
      });
    }
    return out;
  }

  // mode "copy": inline small text files only, never touch the disk.
  // mode "save": also download everything else.
  async function collect(rawList, subject, mode, requestDownload) {
    const items = normalise(rawList, subject);
    const results = [];
    let budget = MAX_INLINE_TOTAL;

    for (const item of items) {
      const entry = { name: item.name, type: item.type || undefined };

      if (!item.url) {
        entry.status = "no download link found";
        results.push(entry);
        continue;
      }

      if (item.inlineable && budget > 0) {
        try {
          const { content, bytes } = await fetchInline(item.url, budget);
          budget -= bytes;
          entry.content = content;
          entry.size = T.formatSize(bytes);
          results.push(entry);
          continue;
        } catch (e) {
          console.warn("[copy-gmail-thread] inline fetch failed for", item.name, e);
          entry.status = "could not be read";
        }
      }

      if (mode === "save") {
        try {
          const res = await requestDownload(item.url, item.path);
          entry.path = res && res.ok ? `~/Downloads/${item.path}` : undefined;
          entry.status = res && res.ok ? undefined : "download failed";
        } catch (e) {
          console.warn("[copy-gmail-thread] download failed for", item.name, e);
          entry.status = "download failed";
        }
      } else if (!entry.status) {
        entry.status = "not saved (use Save to download)";
      }

      results.push(entry);
    }
    return results;
  }

  CT.attachments = {
    collect,
    normalise,
    parseDownloadUrl,
    isInlineable,
    extensionOf,
    targetPath,
    MAX_DOWNLOAD_BYTES,
  };
})();
