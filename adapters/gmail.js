// Gmail adapter.
//
// The only provider implementation. Everything Gmail-specific lives behind
// three methods (isThreadOpen / getThread / getAttachments) so adding another
// mail provider later is a new file rather than a refactor. Nothing else in the
// codebase knows what Gmail is.

(() => {
  const CT = (globalThis.CT = globalThis.CT || {});
  const { text: T, richtext: RT, clean: CL } = CT;

  const ERR = {
    NOT_ON_THREAD: "NOT_ON_THREAD",
    NO_IK: "NO_IK",
    NOT_LOGGED_IN: "NOT_LOGGED_IN",
    FETCH_FAILED: "FETCH_FAILED",
    PARSE_EMPTY: "PARSE_EMPTY",
    WRONG_THREAD: "WRONG_THREAD",
  };

  // ---------- thread identity ----------

  function subjectEl() {
    return document.querySelector("h2.hP");
  }

  // Must be scoped to the OPEN thread's subject heading. Gmail puts
  // data-legacy-thread-id on inbox list rows as well, so an unscoped
  // querySelector returns whichever row happens to come first in the DOM — a
  // different conversation entirely — and the copy silently succeeds with the
  // wrong email in it. Never widen this selector.
  function threadId() {
    const h = subjectEl();
    if (!h) return null;

    const direct = h.getAttribute("data-legacy-thread-id");
    if (direct) return direct;

    // Fallback stays inside the opened conversation. Searching the document
    // would reintroduce the list-row bug.
    const scope = h.closest("[role='main']");
    const el = scope ? scope.querySelector("[data-legacy-thread-id]") : null;
    return el ? el.getAttribute("data-legacy-thread-id") : null;
  }

  function accountIndex() {
    const m = location.pathname.match(/\/mail\/u\/(\d+)/);
    return m ? m[1] : "0";
  }

  function isThreadOpen() {
    return Boolean(threadId() && subjectEl());
  }

  function threadUrl(id) {
    return `https://mail.google.com/mail/u/${accountIndex()}/#all/${id}`;
  }

  // ---------- session key ----------
  //
  // The previous version injected into Gmail's MAIN world via chrome.scripting
  // to read window.GLOBALS[9]. That meant running code inside Gmail's own
  // JavaScript context — by far the most sensitive thing the extension did, and
  // all for one string. The same value is reachable from the isolated world with
  // plain DOM reads, so the scripting permission is gone entirely.

  let cachedIk = null;

  function findIk() {
    if (cachedIk) return cachedIk;

    // Rung 1: Gmail's own links carry ik= in their query string.
    for (const a of document.querySelectorAll('a[href*="ik="]')) {
      const m = (a.getAttribute("href") || "").match(/[?&]ik=([A-Za-z0-9_-]{4,})/);
      if (m) return (cachedIk = m[1]);
    }

    // Rung 2: the bootstrap payload in an inline script.
    for (const s of document.scripts) {
      if (s.src) continue;
      const body = s.textContent || "";
      if (body.length > 2_000_000) continue;
      const m =
        body.match(/[?&]ik=([A-Za-z0-9_-]{4,})/) ||
        body.match(/["']ik["']\s*:\s*["']([A-Za-z0-9_-]{4,})["']/);
      if (m) return (cachedIk = m[1]);
    }

    // Rung 3: the caller retries without ik at all.
    return null;
  }

  // ---------- print view ----------

  function printViewUrl(id, ik) {
    const base = `https://mail.google.com/mail/u/${accountIndex()}/?view=pt&search=all&th=${encodeURIComponent(id)}`;
    return ik ? `${base}&ik=${encodeURIComponent(ik)}` : base;
  }

  function looksLikeLogin(resp, html) {
    if (/accounts\.google\.com|ServiceLogin/i.test(resp.url || "")) return true;
    return /<title>[^<]*sign in[^<]*<\/title>/i.test(html);
  }

  // Header cells are small and structural; a full markdown render would be
  // overkill and would mangle the "to ..." line we need to parse.
  function headerText(node) {
    let out = "";
    for (const child of node.childNodes) {
      if (child.nodeType === 3) out += child.nodeValue;
      else if (child.nodeType === 1) {
        if (child.tagName === "BR") out += "\n";
        else {
          out += headerText(child);
          if (/^(DIV|P|TR|TABLE|LI)$/.test(child.tagName)) out += "\n";
        }
      }
    }
    return out;
  }

  const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;

  function splitAddresses(s) {
    return String(s || "")
      .split(/[,;]/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  function parseHeader(row) {
    const raw = headerText(row);
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);

    const toLine = lines.find((l) => /^to\b/i.test(l));
    const ccLine = lines.find((l) => /^cc\b/i.test(l));

    // The sender's address is on the lines before "to ...". Searching the whole
    // header would happily return a recipient instead.
    const beforeTo = toLine ? lines.slice(0, lines.indexOf(toLine)) : lines;
    const senderBlob = beforeTo.join(" ");

    const name = (row.querySelector("b")?.textContent || "").trim();
    const email = (senderBlob.match(EMAIL_RE) || [""])[0];

    const cells = row.querySelectorAll(":scope > td");
    const dateRaw = cells.length > 1 ? headerText(cells[cells.length - 1]).trim() : "";

    // The print view does not always start the recipient list on its own line,
    // so fall back to an inline match before giving up.
    let to = toLine ? splitAddresses(toLine.replace(/^to\b:?\s*/i, "")) : [];
    let cc = ccLine ? splitAddresses(ccLine.replace(/^cc\b:?\s*/i, "")) : [];
    if (!to.length) {
      const m = raw.match(/\bto:\s*([^\n]+)/i);
      if (m) to = splitAddresses(m[1]);
    }
    if (!cc.length) {
      const m = raw.match(/\bcc:\s*([^\n]+)/i);
      if (m) cc = splitAddresses(m[1]);
    }

    // Recipients are the one header field whose markup we have not been able to
    // pin down. Log the raw header when nothing parses, so the gap is
    // diagnosable from the console instead of silently absent.
    if (!to.length && !cc.length) {
      console.debug(
        "[copy-gmail-thread] no recipients parsed from header:",
        JSON.stringify(raw.slice(0, 300))
      );
    }

    return { from: { name: name || email, email }, to, cc, dateRaw };
  }

  // Attachments in the print view are rendered as a small table: a filetype
  // icon from Gmail's own icon set, the filename in <b>, and a size. Parsing
  // them here rather than from the live DOM means each attachment can be tied
  // to the message it actually belongs to, instead of being lumped onto the
  // thread as a guess.
  const ATTACH_ICON = 'img[src*="/icons/mail/images/"], img[src*="/ui/v1/icons/mail"]';
  const SIZE_RE = /\b(\d+(?:[.,]\d+)?)\s*([KMG])B?\b/i;

  function extractAttachments(scope) {
    const found = [];
    for (const img of Array.from(scope.querySelectorAll(ATTACH_ICON))) {
      const row = img.closest("tr") || img.closest("table");
      if (!row) continue;

      const name = (row.querySelector("b")?.textContent || "").trim();
      const table = img.closest("table");
      if (!name) {
        if (table) table.remove();
        continue;
      }

      const link = row.querySelector('a[href*="view=att"], a[href*="&disp="]');
      const sizeMatch = (row.textContent || "").match(SIZE_RE);

      found.push({
        name,
        size: sizeMatch ? sizeMatch[0].trim() : undefined,
        url: link ? link.getAttribute("href") : null,
      });

      // Drop the table so the same information does not also appear as a
      // half-empty markdown table inside the message body.
      if (table) table.remove();
    }
    return found;
  }

  function parsePrintView(html, id) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const tables = doc.querySelectorAll("table.message");
    if (!tables.length) return null;

    // Verify the fetched conversation is the one on screen. If a thread id is
    // ever resolved incorrectly, the copy would otherwise succeed silently with
    // somebody else's email in it — which is far worse than failing.
    const printSubject = (doc.title || "").replace(/^Gmail\s*-\s*/i, "").trim();
    const openSubject = (subjectEl()?.innerText || "").trim();
    if (!T.subjectsMatch(printSubject, openSubject)) {
      console.warn(
        "[copy-gmail-thread] thread mismatch — open:", JSON.stringify(openSubject),
        "fetched:", JSON.stringify(printSubject)
      );
      return { mismatch: true };
    }

    const messages = [];
    let anyTrimmed = false;

    for (const t of tables) {
      const rows = t.querySelectorAll(":scope > tbody > tr, :scope > tr");
      if (rows.length < 2) continue;

      const head = parseHeader(rows[0]);
      const bodyCell = rows[rows.length - 1];

      // Order matters: pull attachments out before rendering, so their markup
      // is removed from the body rather than rendered as leftover tables.
      const attachments = extractAttachments(bodyCell);

      CL.stripQuoteNodes(bodyCell);
      const rendered = RT.toMarkdown(bodyCell);
      const { text: body, trimmed } = CL.trimQuotedText(rendered);
      if (trimmed) anyTrimmed = true;

      messages.push({
        n: messages.length + 1,
        from: head.from,
        to: head.to,
        cc: head.cc,
        date: T.toIso(head.dateRaw),
        dateRaw: head.dateRaw,
        // An attachment-only or image-only message has no text. The old code
        // dropped those silently, so the message vanished from the thread with
        // no trace. Keep it; format.js supplies a placeholder body.
        body,
        attachments: [],
      });
    }

    if (!messages.length) return null;

    const subject =
      (subjectEl()?.innerText || "").trim() ||
      (doc.title || "").replace(/^Gmail\s*-\s*/i, "").trim();

    return {
      subject,
      url: threadUrl(id),
      source: "print-view",
      complete: true,
      quotedTrimmed: anyTrimmed,
      messages,
    };
  }

  // ---------- visible-DOM fallback ----------

  function extractFromDom(id) {
    const messages = [];
    let anyTrimmed = false;

    for (const node of document.querySelectorAll("div.adn")) {
      const bodyEl = node.querySelector("div.a3s");
      if (!bodyEl) continue;

      const clone = bodyEl.cloneNode(true);
      CL.stripQuoteNodes(clone);
      const { text: body, trimmed } = CL.trimQuotedText(RT.toMarkdown(clone));
      if (trimmed) anyTrimmed = true;

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
        date: T.toIso(dateRaw),
        dateRaw,
        body,
        attachments: [],
      });
    }

    return {
      subject: (subjectEl()?.innerText || "").trim(),
      url: threadUrl(id),
      source: "dom-fallback",
      // This path only sees expanded messages. Saying so is the whole point:
      // silently returning a partial thread that looks complete is the worst
      // failure this tool can have.
      complete: false,
      quotedTrimmed: anyTrimmed,
      messages,
    };
  }

  // ---------- public ----------

  async function getThread() {
    const id = threadId();
    if (!id) return { ok: false, error: ERR.NOT_ON_THREAD };

    const ik = findIk();
    let html = null;

    try {
      const resp = await fetch(printViewUrl(id, ik), { credentials: "include" });
      const bodyText = await resp.text();

      if (looksLikeLogin(resp, bodyText)) return { ok: false, error: ERR.NOT_LOGGED_IN };
      if (!resp.ok) {
        console.warn("[copy-gmail-thread] print view HTTP", resp.status);
        html = null;
      } else {
        html = bodyText;
      }
    } catch (e) {
      console.warn("[copy-gmail-thread] print view fetch failed:", e);
      html = null;
    }

    if (html) {
      const thread = parsePrintView(html, id);
      // A mismatch is never recoverable by falling back — refuse loudly rather
      // than handing over the wrong conversation.
      if (thread && thread.mismatch) return { ok: false, error: ERR.WRONG_THREAD };
      if (thread) return { ok: true, thread };
      console.warn("[copy-gmail-thread] print view returned no parseable messages");
    }

    const fallback = extractFromDom(id);
    if (!fallback.messages.length) {
      return { ok: false, error: ik ? ERR.PARSE_EMPTY : ERR.NO_IK };
    }
    return { ok: true, thread: fallback };
  }

  // Attachment discovery. The print view's markup for attachments is not
  // documented and varies; this reads the live DOM, which is stable and
  // observable. Filenames here are attacker-controlled and are sanitised
  // downstream in lib/attachments.js before ever reaching the downloads API.
  function getAttachments() {
    const seen = new Set();
    const out = [];
    for (const el of document.querySelectorAll('span.aV3, div.aQA span[title], a[href*="view=att"]')) {
      const name = (el.getAttribute("title") || el.textContent || "").trim();
      if (!name || seen.has(name)) continue;
      const link = el.closest("[download_url]") || el.querySelector?.("[download_url]");
      const downloadUrl = link?.getAttribute("download_url") || null;
      const href = el.tagName === "A" ? el.getAttribute("href") : null;
      seen.add(name);
      out.push({ name, downloadUrl, href });
    }
    return out;
  }

  // extractAttachments is exported so the DOM tests can exercise it against
  // Gmail's real attachment markup rather than assuming it matches.
  CT.adapter = { isThreadOpen, getThread, getAttachments, threadId, extractAttachments, ERR };
})();
