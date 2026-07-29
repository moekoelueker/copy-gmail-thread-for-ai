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
    AMBIGUOUS_PAGE: "AMBIGUOUS_PAGE",
  };
  const MAX_PRINT_VIEW_BYTES = 25 * 1024 * 1024;
  const MAX_LIVE_ATTACHMENTS = 500;

  // Gmail renders message bodies inside these containers. Email HTML is
  // attacker-controlled: a body carrying its own <h2 class="hP"> made the real
  // subject ambiguous, which removed the in-page controls entirely and left the
  // popup insisting no thread was open. Anyone who can send mail could do it.
  // Kept deliberately narrow. div.a3s and div.ii are the rendered body, which
  // is where injected markup lands; div.adn and div.gs are Gmail's own message
  // containers and excluding those risks discarding the real heading and
  // breaking the extension outright, which is worse than the attack.
  const MESSAGE_BODY = "div.a3s, div.ii, blockquote, table.message";

  function subjectState() {
    const candidates = Array.from(document.querySelectorAll("h2.hP")).filter((element) => {
      if (element.closest(MESSAGE_BODY)) return false;
      if (element.closest('[aria-hidden="true"], [hidden]')) return false;
      const style = globalThis.getComputedStyle?.(element);
      return !style || (style.display !== "none" && style.visibility !== "hidden");
    });
    if (candidates.length === 1) return { element: candidates[0], ambiguous: false };
    const inMain = candidates.filter((element) => element.closest('[role="main"]'));
    if (inMain.length === 1) return { element: inMain[0], ambiguous: false };
    // Fail closed, but say which failure it was: "open a thread first" is wrong
    // and unactionable when a thread is plainly open.
    return { element: null, ambiguous: candidates.length > 1 };
  }

  function subjectEl() {
    return subjectState().element;
  }

  // "thread" | "ambiguous" | "none" — what the UI should tell the user.
  function pageState() {
    if (currentIdentity()) return "thread";
    return subjectState().ambiguous ? "ambiguous" : "none";
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

  function threadUrl(identity) {
    return `https://mail.google.com/mail/u/${identity.accountIndex}/#all/${encodeURIComponent(
      identity.id
    )}`;
  }

  const cachedIk = new Map();
  // Keys Gmail has already rejected. Remembering the individual stale value,
  // rather than caching a blanket null, lets a later valid key still be found
  // instead of degrading every subsequent copy for the life of the page.
  const staleIk = new Set();

  function markIkStale(accountIndex, ik) {
    if (ik) staleIk.add(ik);
    cachedIk.delete(accountIndex);
  }

  // Gmail's date rendering carries no offset, so toIso reinterprets it in this
  // browser's zone. Recording the zone keeps that derivation auditable rather
  // than silently authoritative.
  function captureTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch (_) {
      return "";
    }
  }

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
        if (/^[A-Za-z0-9_-]{4,}$/.test(ik) && !staleIk.has(ik)) {
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
      if (match && !staleIk.has(match[1])) {
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
      timezone: captureTimezone(),
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
    if (!identity) {
      return {
        ok: false,
        error: subjectState().ambiguous ? ERR.AMBIGUOUS_PAGE : ERR.NOT_ON_THREAD,
      };
    }

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
            markIkStale(identity.accountIndex, attempts[attempt]);
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
              timezone: captureTimezone(),
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
          markIkStale(identity.accountIndex, attempts[attempt]);
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
  //
  // One chip can match this selector through several arms at once: the filename
  // span, an aria title, and the download_url carrier are frequently different
  // nodes in the same chip. Matching per element reported a single attachment
  // two or three times, so discovery is collapsed to one candidate per chip.
  const CHIP_SELECTOR = "span.aV3, div.aQA span[title], [download_url]";

  // Gmail renders Drive files, YouTube videos and other link previews in the
  // same chip zone as real attachments. A preview carries no download_url and
  // points off-origin; admitting one invented a file named after a video title
  // and falsely downgraded attachment completeness for the whole thread.
  //
  // The exclusion is deliberately narrow, because a wrongly dropped attachment
  // is a silent miss and that is worse than the noise it removes. A candidate
  // survives if it makes any attachment claim at all: a download_url (which
  // includes metadata a sender crafted — a claim must be reported and refused
  // downstream, not discarded here), Gmail's own span.aV3 filename class, or a
  // link that points at Gmail. A same-origin chip is therefore kept even when
  // the stricter URL policy later rejects it, so a genuine refusal stays
  // visible. Only a candidate claiming nothing is discarded.
  const FILENAME_CHIP = "span.aV3";
  function pointsAtGmail(value) {
    try {
      return new URL(String(value || ""), S.GMAIL_ORIGIN).origin === S.GMAIL_ORIGIN;
    } catch (_) {
      return false;
    }
  }

  function getAttachments(thread) {
    const context = {
      threadId: thread?.threadId,
      accountIndex: thread?.accountIndex,
    };
    const candidates = [];
    let truncated = false;

    for (const element of document.querySelectorAll(CHIP_SELECTOR)) {
      if (candidates.length >= MAX_LIVE_ATTACHMENTS) {
        truncated = true;
        break;
      }
      // Gmail renders its chips beside the body, never inside it. A message
      // body carrying chip markup of its own is the sender's HTML, not Gmail's,
      // and was able to add attacker-named attachments to the thread.
      if (element.closest(MESSAGE_BODY)) continue;
      const carrier =
        element.closest("[download_url]") ||
        element.querySelector?.("[download_url]") ||
        element.closest("a[href]");
      const downloadUrl = carrier?.getAttribute("download_url") || null;
      const parsed = downloadUrl ? AT.parseDownloadUrl(downloadUrl) : null;
      const href = carrier?.getAttribute("href") || parsed?.url || null;
      const claimsAttachment =
        Boolean(downloadUrl) ||
        Boolean(element.matches?.(FILENAME_CHIP)) ||
        Boolean(element.querySelector?.(FILENAME_CHIP));
      if (!claimsAttachment && href && !pointsAtGmail(href)) continue;
      const name = (
        parsed?.name ||
        element.getAttribute("title") ||
        element.textContent ||
        ""
      ).trim();
      if (!name) continue;
      candidates.push({
        name,
        downloadUrl,
        href,
        messageN: null,
        source: "live-page",
      });
    }

    // When a chip's filename node and its link node are separate elements, the
    // pass above yields one linked candidate and one bare name for the same
    // file. Keep the linked one: a candidate with no capability can never be
    // verified, fetched, or downloaded, and would only be reported as missing.
    const linked = new Set(
      candidates.filter((item) => item.href).map((item) => AT.nameKey(item.name))
    );
    const items = [];
    const seenKeys = new Set();
    for (const item of candidates) {
      if (!item.href && linked.has(AT.nameKey(item.name))) continue;
      const key = item.href
        ? S.resolveAttachmentUrl(item.href, context) ||
          S.attachmentCapabilityKey(item.href) ||
          `rejected:${AT.nameKey(item.name)}:${item.href}`
        : `no-link:${AT.nameKey(item.name)}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      items.push(item);
    }
    return { items, truncated };
  }

  CT.adapter = {
    getThread,
    getAttachments,
    subjectElement: subjectEl,
    pageState,
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
