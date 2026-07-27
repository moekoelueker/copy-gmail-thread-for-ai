// Canonical attachment processing.
//
// Discovery produces one thread-wide list with messageN set when attribution is
// known. This module validates URLs, resolves filename collisions globally,
// inlines bounded text, and starts explicit downloads. It never exposes a raw
// attachment URL in the copied output.

(() => {
  const CT = (globalThis.CT = globalThis.CT || {});
  const T = CT.text;
  const S = CT.security;

  const INLINE_EXT = new Set([
    "txt", "md", "csv", "tsv", "json", "log", "xml", "yml", "yaml", "ics",
  ]);

  const MAX_INLINE_BYTES = 100 * 1024;
  const MAX_INLINE_TOTAL = 300 * 1024;
  const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

  function extensionOf(name) {
    const m = String(name || "").match(/\.([A-Za-z0-9]{1,8})$/);
    return m ? m[1].toLowerCase() : "";
  }

  function isInlineable(name) {
    return INLINE_EXT.has(extensionOf(name));
  }

  const TYPES = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    heic: "image/heic",
    svg: "image/svg+xml",
    zip: "application/zip",
    txt: "text/plain",
    csv: "text/csv",
    tsv: "text/tab-separated-values",
    json: "application/json",
    xml: "application/xml",
    ics: "text/calendar",
    md: "text/markdown",
    log: "text/plain",
    yml: "text/yaml",
    yaml: "text/yaml",
    mp4: "video/mp4",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    eml: "message/rfc822",
  };

  function guessType(name) {
    return TYPES[extensionOf(name)] || "";
  }

  function cleanType(value, fallbackName) {
    const type = String(value || "").trim();
    return /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(type)
      ? type
      : guessType(fallbackName);
  }

  // Gmail stores "mime/type:filename:https://..." in download_url. Find the
  // URL marker rather than treating a colon in the filename as a separator.
  function parseDownloadUrl(value) {
    const s = String(value || "");
    const first = s.indexOf(":");
    if (first < 1) return null;
    const markers = [
      s.lastIndexOf(":https://"),
      s.lastIndexOf(":http://"),
      s.lastIndexOf(":/mail/"),
    ]
      .filter((i) => i > first)
      .sort((a, b) => b - a);
    if (!markers.length) return null;
    const urlAt = markers[0];
    return {
      type: s.slice(0, first),
      name: s.slice(first + 1, urlAt),
      url: s.slice(urlAt + 1),
    };
  }

  function targetPath(subject, filename) {
    return `${S.DOWNLOAD_ROOT}/${T.slugify(subject)}/${T.sanitizeFilename(filename)}`;
  }

  function collisionName(name, number) {
    if (number <= 1) return name;
    const m = name.match(/^(.*?)(\.[A-Za-z0-9]{1,8})?$/);
    return `${m[1]} (${number})${m[2] || ""}`;
  }

  function targetKey(name) {
    return String(name || "").normalize("NFKC").toLowerCase();
  }

  function uniqueTargetName(name, usedTargets) {
    let number = 1;
    let candidate = name;
    while (usedTargets.has(targetKey(candidate))) {
      number++;
      candidate = collisionName(name, number);
    }
    usedTargets.add(targetKey(candidate));
    return candidate;
  }

  function rawUrls(item) {
    const parsed = item.downloadUrl ? parseDownloadUrl(item.downloadUrl) : null;
    const values = [parsed?.url, item.url, item.href].filter(Boolean);
    return { parsed, values: Array.from(new Set(values)) };
  }

  function resolveRawUrl(item, context) {
    const { parsed, values } = rawUrls(item || {});
    for (const value of values) {
      const url = S.resolveAttachmentUrl(value, context);
      if (url) return { parsed, values, url };
    }
    return { parsed, values, url: null };
  }

  function nameKey(name) {
    return targetKey(T.sanitizeFilename(String(name || "attachment")));
  }

  // Merge Gmail's live attachment chips into the print-view list.
  //
  // These are two renderings of the same files, and their URLs are not
  // comparable as strings: a chip carries ui/ik/permmsgid/realattid that the
  // print-view link may omit. Matching on the full href reported every
  // attachment twice, flipped attachment completeness to false, and made save
  // mode download each file more than once. Match on the underlying capability
  // first, then fall back to a filename multiset so that a thread carrying the
  // same filename on two messages still resolves to two distinct attachments.
  function mergeRaw(primary, supplemental, context) {
    const out = Array.from(primary || []);
    const byUrl = new Map();
    const byCapability = new Map();
    const byName = new Map();
    const consumed = new Set();

    const index = (item) => {
      const { url } = resolveRawUrl(item, context);
      if (url) {
        if (!byUrl.has(url)) byUrl.set(url, item);
        const capability = S.attachmentCapabilityKey(url);
        if (capability && !byCapability.has(capability)) byCapability.set(capability, item);
      }
      const key = nameKey(item?.name);
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(item);
    };
    for (const item of out) index(item);

    const match = (item, url) => {
      const direct = url ? byUrl.get(url) : null;
      if (direct && !consumed.has(direct)) return direct;

      const capability = S.attachmentCapabilityKey(url || item?.href || item?.url || "");
      const byCap = capability ? byCapability.get(capability) : null;
      if (byCap && !consumed.has(byCap)) return byCap;

      const pool = byName.get(nameKey(item?.name)) || [];
      return pool.find((candidate) => !consumed.has(candidate)) || null;
    };

    let supplementalOnly = 0;
    for (const item of supplemental || []) {
      const { url } = resolveRawUrl(item, context);
      const existing = match(item, url);
      if (existing) {
        consumed.add(existing);
        if (existing.messageN == null && item.messageN != null) existing.messageN = item.messageN;
        if (!existing.size && item.size) existing.size = item.size;
        // A print-view entry Gmail rendered without a usable link can adopt the
        // chip's verified capability instead of being reported as unavailable.
        if (url && !resolveRawUrl(existing, context).url) existing.href = url;
        continue;
      }
      out.push(item);
      index(item);
      supplementalOnly++;
    }
    return { items: out, supplementalOnly };
  }

  // Resolve raw DOM hits into a globally de-duplicated, sanitized list.
  function normalise(raw, subject, context) {
    const out = [];
    const usedTargets = new Set();
    const byUrl = new Map();

    for (const item of raw || []) {
      const { parsed, values, url } = resolveRawUrl(item, context);
      const rawName = parsed?.name || item.name || "attachment";
      const name = T.sanitizeFilename(rawName);

      if (url && byUrl.has(url)) {
        const existing = byUrl.get(url);
        if (existing.messageN == null && Number.isInteger(item.messageN)) {
          existing.messageN = item.messageN;
        }
        if (!existing.size && item.size) existing.size = item.size;
        continue;
      }

      const targetName = uniqueTargetName(name, usedTargets);
      const size = item.size || undefined;
      const entry = {
        name,
        originalName: rawName,
        targetName,
        type: cleanType(parsed?.type || item.type, name) || undefined,
        size,
        sizeBytes: T.parseSizeBytes(size),
        url,
        rejectedUrl: Boolean(values.length && !url),
        inlineable: isInlineable(name),
        path: targetPath(subject, targetName),
        messageN: Number.isInteger(item.messageN) ? item.messageN : null,
        source: item.source || "unknown",
      };
      out.push(entry);
      if (url) byUrl.set(url, entry);
    }
    return out;
  }

  function charsetFor(contentType, bytes) {
    if (bytes.length >= 2) {
      if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
      if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
    }
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return "utf-8";
    }
    const m = String(contentType || "").match(/\bcharset\s*=\s*["']?([^;"'\s]+)/i);
    return m ? m[1] : "utf-8";
  }

  function decodeText(bytes, contentType) {
    const label = charsetFor(contentType, bytes);
    try {
      return new TextDecoder(label, { fatal: false }).decode(bytes);
    } catch (_) {
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    }
  }

  async function readLimited(resp, limit) {
    const declaredRaw = Number(resp.headers.get("content-length"));
    const declared = Number.isFinite(declaredRaw) && declaredRaw >= 0 ? declaredRaw : null;

    if (!resp.body?.getReader) {
      const all = new Uint8Array(await resp.arrayBuffer());
      return {
        bytes: all.slice(0, limit),
        total: all.length,
        truncated: all.length > limit,
      };
    }

    const reader = resp.body.getReader();
    const chunks = [];
    let kept = 0;
    let observed = 0;
    let stoppedEarly = false;
    const capacity = limit + 1;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value || new Uint8Array();
      observed += chunk.length;
      const take = Math.min(chunk.length, Math.max(0, capacity - kept));
      if (take) {
        chunks.push(chunk.slice(0, take));
        kept += take;
      }
      if (take < chunk.length || kept >= capacity) {
        stoppedEarly = true;
        await reader.cancel().catch(() => {});
        break;
      }
    }

    const buffered = new Uint8Array(kept);
    let offset = 0;
    for (const chunk of chunks) {
      buffered.set(chunk, offset);
      offset += chunk.length;
    }
    const bytes = buffered.slice(0, limit);
    const truncated =
      stoppedEarly || buffered.length > limit || (declared != null && declared > limit);
    return {
      bytes,
      total: declared ?? (stoppedEarly ? null : observed),
      truncated,
    };
  }

  async function fetchInline(url, budget, context) {
    const safeUrl = S.resolveAttachmentUrl(url, context);
    if (!safeUrl) throw new Error("unsafe attachment URL");

    const resp = await fetch(safeUrl, {
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    if (!S.resolveAttachmentUrl(resp.url, context)) throw new Error("attachment redirected off Gmail");

    const limit = Math.max(0, Math.min(MAX_INLINE_BYTES, budget));
    const { bytes, total, truncated } = await readLimited(resp, limit);
    let content = decodeText(bytes, resp.headers.get("content-type"));
    if (truncated) {
      const totalText = total == null ? "total size unknown" : `of ${T.formatSize(total)}`;
      content += `\n[truncated after ${T.formatSize(bytes.length)} ${totalText}]`;
    }
    return { content, bytes: bytes.length, total, truncated };
  }

  // mode "copy": inline bounded text only.
  // mode "save": inline text and start downloads for every attachment.
  async function collect(rawList, subject, mode, requestDownload, context) {
    const items = normalise(rawList, subject, context);
    const results = [];
    const summary = {
      total: items.length,
      inlined: 0,
      inlineFailed: 0,
      inlineSkipped: 0,
      inlineTruncated: 0,
      downloadStarted: 0,
      downloadFailed: 0,
      skipped: 0,
      unsafe: 0,
      noLink: 0,
    };
    let budget = MAX_INLINE_TOTAL;

    for (const item of items) {
      const entry = {
        name: item.name,
        type: item.type,
        size: item.size,
        messageN: item.messageN,
      };

      if (item.rejectedUrl) {
        entry.status = "unsafe download link rejected";
        summary.unsafe++;
        results.push(entry);
        continue;
      }
      if (!item.url) {
        entry.status = "no Gmail download link found";
        summary.noLink++;
        results.push(entry);
        continue;
      }

      if (item.inlineable && budget > 0) {
        try {
          const inline = await fetchInline(item.url, budget, context);
          budget -= inline.bytes;
          entry.content = inline.content;
          entry.inlinedBytes = inline.bytes;
          entry.truncated = inline.truncated;
          summary.inlined++;
          if (inline.truncated) summary.inlineTruncated++;
        } catch (e) {
          console.warn(
            "[copy-gmail-thread] inline attachment fetch failed:",
            e?.message || e
          );
          entry.inlineStatus = "could not be read";
          summary.inlineFailed++;
        }
      } else if (item.inlineable) {
        entry.inlineStatus = "not inlined: thread text limit reached";
        summary.inlineSkipped++;
      }

      if (mode === "save") {
        if (item.sizeBytes != null && item.sizeBytes > MAX_DOWNLOAD_BYTES) {
          entry.status = `not downloaded: exceeds ${T.formatSize(MAX_DOWNLOAD_BYTES)} limit`;
          summary.skipped++;
        } else {
          try {
            const res = await requestDownload(item.url, item.path, context);
            if (res?.ok) {
              entry.path = res.path || item.path;
              entry.status = res.status || "download started";
              summary.downloadStarted++;
            } else {
              entry.status = res?.error || "download failed to start";
              summary.downloadFailed++;
            }
          } catch (e) {
            console.warn("[copy-gmail-thread] attachment download failed:", e?.message || e);
            entry.status = "download failed to start";
            summary.downloadFailed++;
          }
        }
      } else if (entry.content != null) {
        entry.status = entry.truncated ? "inlined (truncated)" : "inlined";
      } else if (!entry.inlineStatus) {
        entry.status = "not downloaded (use Copy + save files)";
      } else {
        entry.status = entry.inlineStatus;
      }

      results.push(entry);
    }
    return { items: results, summary };
  }

  CT.attachments = {
    collect,
    normalise,
    mergeRaw,
    nameKey,
    parseDownloadUrl,
    isInlineable,
    extensionOf,
    targetPath,
    fetchInline,
    MAX_DOWNLOAD_BYTES,
    MAX_INLINE_BYTES,
    MAX_INLINE_TOTAL,
  };
})();
