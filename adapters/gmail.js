// Gmail transport and live-page integration.
//
// Detached print-view parsing lives in gmail-parse.js. This file owns only the
// current page identity, Gmail requests, and the explicitly partial DOM fallback.

(() => {
  const CT = (globalThis.CT = globalThis.CT || {});
  const { text: T, richtext: RT, clean: CL, security: S, attachments: AT } = CT;
  const P = CT.gmailParse;

  const ERR = {
    NOT_ON_THREAD: "NOT_ON_THREAD",
    NOT_LOGGED_IN: "NOT_LOGGED_IN",
    FETCH_FAILED: "FETCH_FAILED",
    PARSE_EMPTY: "PARSE_EMPTY",
    WRONG_THREAD: "WRONG_THREAD",
  };
  const MAX_PRINT_VIEW_BYTES = 25 * 1024 * 1024;
  const MAX_LIVE_ATTACHMENTS = 500;

  function subjectEl() {
    const candidates = Array.from(document.querySelectorAll("h2.hP")).filter((element) => {
      if (element.closest('[aria-hidden="true"], [hidden]')) return false;
      const style = globalThis.getComputedStyle?.(element);
      return !style || (style.display !== "none" && style.visibility !== "hidden");
    });
    if (candidates.length === 1) return candidates[0];
    const inMain = candidates.filter((element) => element.closest('[role="main"]'));
    return inMain.length === 1 ? inMain[0] : null;
  }

  // Never search the whole Gmail main region. Inbox rows live there too. Walk
  // only through the subject's ancestors and fail closed at role=main.
  function threadIdFor(heading) {
    if (!heading) return null;
    const direct = heading.getAttribute("data-legacy-thread-id");
    if (S.validThreadId(direct)) return direct;

    let node = heading.parentElement;
    let depth = 0;
    while (node && node.getAttribute("role") !== "main" && depth < 8) {
      const own = node.getAttribute("data-legacy-thread-id");
      if (S.validThreadId(own)) return own;

      const candidates = Array.from(node.children || [])
        .filter((child) => child.tagName !== "TR")
        .map((child) => child.getAttribute?.("data-legacy-thread-id"))
        .filter((id) => S.validThreadId(id));
      const unique = Array.from(new Set(candidates));
      if (unique.length === 1) return unique[0];
      if (unique.length > 1) return null;

      node = node.parentElement;
      depth++;
    }
    return null;
  }

  function threadId() {
    return threadIdFor(subjectEl());
  }

  function currentIdentity() {
    const heading = subjectEl();
    const id = threadIdFor(heading);
    const subject = (heading?.innerText || heading?.textContent || "").trim();
    const accountIndex = S.accountIndexFromUrl(location.href);
    if (!id || !subject || accountIndex == null) return null;
    return { id, threadId: id, subject, accountIndex };
  }

  function identityMatches(thread) {
    const current = currentIdentity();
    return Boolean(
      current &&
        current.threadId === thread?.threadId &&
        current.accountIndex === String(thread?.accountIndex) &&
        T.subjectsMatch(current.subject, thread?.subject)
    );
  }

  function isThreadOpen() {
    return Boolean(currentIdentity());
  }

  function threadUrl(identity) {
    return `https://mail.google.com/mail/u/${identity.accountIndex}/#all/${encodeURIComponent(
      identity.id
    )}`;
  }

  const cachedIk = new Map();

  function findIk(accountIndex) {
    if (cachedIk.has(accountIndex)) return cachedIk.get(accountIndex);

    for (const anchor of document.querySelectorAll('a[href*="ik="]')) {
      try {
        const url = new URL(anchor.getAttribute("href") || "", S.GMAIL_ORIGIN);
        if (
          url.origin !== S.GMAIL_ORIGIN ||
          !url.pathname.startsWith(`/mail/u/${accountIndex}/`)
        ) {
          continue;
        }
        const ik = url.searchParams.get("ik") || "";
        if (/^[A-Za-z0-9_-]{4,}$/.test(ik)) {
          cachedIk.set(accountIndex, ik);
          return ik;
        }
      } catch (_) {
        /* ignore malformed page links */
      }
    }

    for (const script of document.scripts) {
      if (script.src) continue;
      const body = script.textContent || "";
      if (body.length > 2_000_000) continue;
      const match =
        body.match(/[?&]ik=([A-Za-z0-9_-]{4,})/) ||
        body.match(/["']ik["']\s*:\s*["']([A-Za-z0-9_-]{4,})["']/);
      if (match) {
        cachedIk.set(accountIndex, match[1]);
        return match[1];
      }
    }
    return null;
  }

  function printViewUrl(identity, ik) {
    const base =
      `https://mail.google.com/mail/u/${identity.accountIndex}/?view=pt&search=all&th=` +
      encodeURIComponent(identity.id);
    return ik ? `${base}&ik=${encodeURIComponent(ik)}` : base;
  }

  function looksLikeLogin(resp, html) {
    if (/accounts\.google\.com|ServiceLogin/i.test(resp.url || "")) return true;
    return /<title>[^<]*(?:sign in|anmelden|connexion|iniciar sesión)[^<]*<\/title>/i.test(html);
  }

  async function responseTextLimited(resp) {
    const declared = Number(resp.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_PRINT_VIEW_BYTES) {
      const error = new Error("print view exceeds safety limit");
      error.code = "PRINT_VIEW_TOO_LARGE";
      throw error;
    }

    if (!resp.body?.getReader) {
      const bytes = new Uint8Array(await resp.arrayBuffer());
      if (bytes.length > MAX_PRINT_VIEW_BYTES) {
        const error = new Error("print view exceeds safety limit");
        error.code = "PRINT_VIEW_TOO_LARGE";
        throw error;
      }
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: false });
    let total = 0;
    let html = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value || new Uint8Array();
      total += chunk.byteLength;
      if (total > MAX_PRINT_VIEW_BYTES) {
        await reader.cancel().catch(() => {});
        const error = new Error("print view exceeds safety limit");
        error.code = "PRINT_VIEW_TOO_LARGE";
        throw error;
      }
      html += decoder.decode(chunk, { stream: true });
    }
    return html + decoder.decode();
  }

  function extractFromDom(identity, reason) {
    const messages = [];
    let quotedTrimmed = false;
    let preservedInline = false;

    for (const node of document.querySelectorAll("div.adn")) {
      const bodyEl = node.querySelector("div.a3s");
      if (!bodyEl) continue;
      const clone = bodyEl.cloneNode(true);
      const quoteResult = CL.stripQuoteNodes(clone);
      if (quoteResult.removed) quotedTrimmed = true;
      if (quoteResult.preserved) preservedInline = true;
      const cleaned = CL.trimQuotedText(RT.toMarkdown(clone));
      if (cleaned.trimmed) quotedTrimmed = true;

      const sender = node.querySelector("span.gD");
      const dateEl = node.querySelector("span.g3");
      const dateRaw = (dateEl?.getAttribute("title") || dateEl?.innerText || "").trim();
      messages.push({
        n: messages.length + 1,
        from: {
          name: (sender?.getAttribute("name") || sender?.innerText || "").trim(),
          email: (sender?.getAttribute("email") || "").trim(),
        },
        to: [],
        cc: [],
        bcc: [],
        date: T.toIso(dateRaw),
        dateRaw,
        body: cleaned.text,
      });
    }

    const warnings = [
      {
        code: "VISIBLE_PAGE_FALLBACK",
        message:
          reason ||
          "Gmail's complete print view was unavailable. Collapsed messages and headers may be missing.",
      },
    ];
    if (preservedInline) {
      warnings.push({
        code: "INLINE_REPLY_PRESERVED",
        message: "A quoted block was retained because it may contain an inline reply.",
      });
    }

    return {
      id: identity.id,
      threadId: identity.id,
      accountIndex: identity.accountIndex,
      subject: identity.subject,
      url: threadUrl(identity),
      source: "visible-page-partial",
      quotedTrimmed,
      completeness: { messages: false, headers: false, attachments: false },
      warnings,
      messages,
      attachments: [],
    };
  }

  async function getThread() {
    const identity = currentIdentity();
    if (!identity) return { ok: false, error: ERR.NOT_ON_THREAD };

    const ik = findIk(identity.accountIndex);
    let failure = null;
    const attempts = ik ? [ik, null] : [null];
    for (let attempt = 0; attempt < attempts.length; attempt++) {
      try {
        const resp = await fetch(printViewUrl(identity, attempts[attempt]), {
          credentials: "same-origin",
          cache: "no-store",
        });
        const html = await responseTextLimited(resp);
        if (looksLikeLogin(resp, html)) return { ok: false, error: ERR.NOT_LOGGED_IN };
        if (!resp.ok) {
          failure = `Gmail returned HTTP ${resp.status}; the visible-page fallback was used.`;
          if (attempt + 1 < attempts.length) {
            cachedIk.set(identity.accountIndex, null);
            continue;
          }
          break;
        }

        const parsed = P.parsePrintView(html, identity, identity.subject);
        if (parsed.mismatch) {
          console.warn("[copy-gmail-thread] refused a print-view subject mismatch");
          return { ok: false, error: ERR.WRONG_THREAD };
        }
        if (parsed.thread) {
          return {
            ok: true,
            thread: {
              ...parsed.thread,
              id: identity.id,
              threadId: identity.id,
              accountIndex: identity.accountIndex,
              url: threadUrl(identity),
            },
          };
        }
        failure = "Gmail's print view contained no parseable messages.";
        break;
      } catch (e) {
        console.warn("[copy-gmail-thread] print-view request failed:", e);
        failure =
          e?.code === "PRINT_VIEW_TOO_LARGE"
            ? "Gmail's print view exceeded the 25 MB safety limit; the visible-page fallback was used."
            : "Gmail's print view could not be loaded; the visible-page fallback was used.";
        if (e?.code !== "PRINT_VIEW_TOO_LARGE" && attempt + 1 < attempts.length) {
          cachedIk.set(identity.accountIndex, null);
          continue;
        }
        break;
      }
    }

    const fallback = extractFromDom(identity, failure);
    if (!fallback.messages.length) {
      return { ok: false, error: failure ? ERR.FETCH_FAILED : ERR.PARSE_EMPTY };
    }
    return { ok: true, thread: fallback };
  }

  // Supplemental attachment discovery from Gmail's own attachment chips. No
  // document-wide substring selector is used, and URLs are validated downstream
  // before any request can occur.
  function getAttachments(thread) {
    const context = {
      threadId: thread?.threadId,
      accountIndex: thread?.accountIndex,
    };
    const out = [];
    const seen = new Set();
    const selector = "span.aV3, div.aQA span[title], [download_url]";
    let truncated = false;

    for (const element of document.querySelectorAll(selector)) {
      if (out.length >= MAX_LIVE_ATTACHMENTS) {
        truncated = true;
        break;
      }
      const carrier =
        element.closest("[download_url]") ||
        element.querySelector?.("[download_url]") ||
        element.closest("a[href]");
      const downloadUrl = carrier?.getAttribute("download_url") || null;
      const parsed = downloadUrl ? AT.parseDownloadUrl(downloadUrl) : null;
      const href = carrier?.getAttribute("href") || parsed?.url || null;
      const name = (
        parsed?.name ||
        element.getAttribute("title") ||
        element.textContent ||
        ""
      ).trim();
      if (!name) continue;

      const key = href
        ? S.resolveAttachmentUrl(href, context) || `rejected:${name}:${href}`
        : `no-link:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        name,
        downloadUrl,
        href,
        messageN: null,
        source: "live-page",
      });
    }
    return { items: out, truncated };
  }

  CT.adapter = {
    isThreadOpen,
    getThread,
    getAttachments,
    subjectElement: subjectEl,
    identityMatches,
    threadId,
    currentIdentity,
    extractAttachments: P.extractAttachments,
    parseHeader: P.parseHeader,
    splitAddressList: P.splitAddressList,
    MAX_PRINT_VIEW_BYTES,
    MAX_LIVE_ATTACHMENTS,
    ERR,
  };
})();
