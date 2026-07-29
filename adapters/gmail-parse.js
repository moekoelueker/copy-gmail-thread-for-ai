// Pure-ish Gmail print-view parsing. Network and live-page identity stay in
// gmail.js; this file turns detached Gmail HTML into a validated thread model.

(() => {
  const CT = (globalThis.CT = globalThis.CT || {});
  const { text: T, richtext: RT, clean: CL, security: S } = CT;

  function headerText(node) {
    let out = "";
    for (const child of node?.childNodes || []) {
      if (child.nodeType === 3) out += child.nodeValue;
      else if (child.nodeType === 1) {
        if (child.tagName === "BR") out += "\n";
        else {
          out += headerText(child);
          if (/^(DIV|P|TR|TABLE|LI|TD|TH)$/.test(child.tagName)) out += "\n";
        }
      }
    }
    return out;
  }

  const EMAIL_RE =
    /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/i;

  function parseAddressList(value) {
    const input = String(value || "");
    const parts = [];
    let start = 0;
    let quote = false;
    let escaped = false;
    let angleDepth = 0;

    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (quote && ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        quote = !quote;
        continue;
      }
      if (!quote && (ch === "<" || ch === "〈")) angleDepth++;
      else if (!quote && (ch === ">" || ch === "〉")) angleDepth = Math.max(0, angleDepth - 1);
      else if (!quote && angleDepth === 0 && (ch === "," || ch === ";")) {
        parts.push(input.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(input.slice(start));

    let complete = !quote && angleDepth === 0;
    const items = [];
    for (const part of parts) {
      const raw = part.trim();
      if (!raw) continue;
      // Count addresses outside the quoted display name only. Gmail writes
      // "someone@example.com" <someone@example.com> whenever a contact has no
      // name of its own, and counting inside the quotes read that single
      // recipient as two addresses crammed into one unsplit part — marking
      // ordinary headers partial. The check still catches the case it exists
      // for, because a genuinely unsplit list is not inside quotes.
      const unquoted = raw.replace(/"(?:[^"\\]|\\.)*"/g, "");
      const emailCount = (unquoted.match(
        /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi
      ) || []).length;
      const parsed = parseAddress(raw);
      if ((raw.includes("@") && !parsed.email) || emailCount > 1) complete = false;
      if (parsed.name || parsed.email) items.push(parsed);
      else complete = false;
    }
    return { items, complete };
  }

  function splitAddressList(value) {
    return parseAddressList(value).items;
  }

  function parseAddress(value) {
    const raw = String(value || "").trim();
    if (!raw) return { name: "", email: "" };
    const angle = raw.match(/^(.*?)[<〈]\s*([^>〉]+?)\s*[>〉]\s*$/);
    const email = ((angle ? angle[2] : raw).match(EMAIL_RE) || [""])[0];
    let name = angle ? angle[1].trim() : email ? raw.replace(email, "").trim() : raw;
    name = name
      .replace(/^"(.*)"$/, "$1")
      .replace(/\\"/g, '"')
      .trim();
    return { name: name || email, email };
  }

  // The colon is mandatory. With it optional, any line beginning with a label
  // word was parsed as a recipient list — including the sender head row, where
  // "Tobias Weber <tw@…>" became the to-recipient "bias Weber" and "Andrea"
  // fed the German label "an". A locale that renders labels without a colon
  // degrades to an explicit HEADER_INCOMPLETE instead of silent corruption.
  const RECIPIENT_LABELS = [
    { key: "bcc", re: /^(?:bcc|blind copy|密送|密件副本)\s*[:：]\s*/iu },
    { key: "cc", re: /^(?:cc|copy|kopie|抄送|副本)\s*[:：]\s*/iu },
    { key: "to", re: /^(?:to|an|à|para|收件人|到|宛先)\s*[:：]\s*/iu },
  ];

  // Header lines this model knows about and deliberately does not carry.
  // Recognized here so they cannot trip the unparsed-address check below.
  const IGNORED_HEADER_LINE = /^reply-to\s*[:：]/i;

  function recipientLine(line) {
    for (const label of RECIPIENT_LABELS) {
      if (label.re.test(line)) {
        return { key: label.key, value: line.replace(label.re, "") };
      }
    }
    return null;
  }

  function parseHeader(rows) {
    const all = Array.from(rows || []);
    const headRow = all[0];
    const headerRows = all.length > 1 ? all.slice(0, -1) : all;
    const raw = headerRows.map(headerText).join("\n");

    // The head row carries the sender and the date; Gmail renders recipient
    // labels only on the rows between it and the body. Scanning the head row
    // let a sender display name that merely begins with a label word be split
    // into a fabricated recipient.
    const recipientLines = headerRows
      .slice(1)
      .map(headerText)
      .join("\n")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const recipients = { to: [], cc: [], bcc: [] };
    const labeled = [];
    let recipientParsingComplete = true;
    for (const line of recipientLines) {
      const parsed = recipientLine(line);
      if (!parsed) {
        // An unlabeled line that still carries an address is recipient data
        // this parser failed to understand — a wrapped list, an unsupported
        // locale's label. Flag it rather than dropping it silently.
        if (!IGNORED_HEADER_LINE.test(line) && EMAIL_RE.test(line)) {
          recipientParsingComplete = false;
        }
        continue;
      }
      labeled.push(line);
      const list = parseAddressList(parsed.value);
      if (!list.complete || !list.items.length) {
        recipientParsingComplete = false;
      }
      recipients[parsed.key].push(...list.items);
    }

    const name = (headRow?.querySelector("b")?.textContent || "").trim();
    const email = (headerText(headRow).match(EMAIL_RE) || [""])[0];

    const cells = headRow?.querySelectorAll(":scope > td, :scope > th") || [];
    const dateRaw = cells.length > 1 ? headerText(cells[cells.length - 1]).trim() : "";
    const issues = [];
    if (!name && !email) issues.push("sender");
    if (!dateRaw) issues.push("date");
    if (!labeled.length || !recipientParsingComplete) issues.push("recipients");

    return {
      from: { name: name || email, email },
      ...recipients,
      dateRaw,
      complete: issues.length === 0,
      issues,
      raw,
    };
  }

  // Broad selector, narrow decision: T.isGmailUiIcon checks the origin. Matching
  // the path as a substring let an email body host its own
  // ".../icons/mail/images/x.gif" beside a <b>filename</b> and inject a
  // fabricated attachment into that sender's own message.
  const ATTACH_ICON = 'img[src*="/icons/mail/"]';
  const SIZE_RE = /\b(\d+(?:[.,]\d+)?)\s*([KMG])B?\b/i;

  function attachmentContainer(node, scope) {
    const table = node.closest("table");
    const messageTable = scope.closest("table.message");
    return table && table !== messageTable ? table : null;
  }

  function attachmentName(node) {
    const bounded = (value) => {
      const text = String(value || "").trim();
      return text.length <= 500 ? text : text.slice(0, 500);
    };
    const row = node.closest("tr");
    const table = node.closest("table");
    const candidates = [
      node.querySelector?.("b"),
      row?.querySelector("b"),
      table?.querySelector("b"),
    ];
    for (const candidate of candidates) {
      const value = bounded(candidate?.textContent);
      if (value) return value;
    }
    const title = bounded(node.getAttribute?.("title"));
    if (title) return title;
    const text = bounded(node.textContent);
    return text && text.length <= 200 ? text : "";
  }

  function attachmentSize(node) {
    const row = node.closest("tr");
    const table = node.closest("table");
    const match =
      (row?.textContent || "").match(SIZE_RE) ||
      (table?.textContent || "").match(SIZE_RE);
    return match ? match[0].trim() : undefined;
  }

  function extractAttachments(scope, context) {
    const attachments = [];
    const handled = new Set();
    const refused = new Set();
    const issues = [];

    for (const anchor of Array.from(scope.querySelectorAll("a[href]"))) {
      const href = anchor.getAttribute("href") || "";
      const url = S.resolveAttachmentUrl(href, context);
      if (!url) {
        // "Gmail gave no link" and "we refused Gmail's link" are different
        // problems with different answers, and reporting both as the former
        // left no way to tell them apart. Only links inside an attachment
        // container count, so an ordinary body link — including one a sender
        // crafted to look like an attachment — cannot manufacture this notice.
        const container = attachmentContainer(anchor, scope);
        if (container) refused.add(container);
        continue;
      }
      const name = attachmentName(anchor);
      if (!name) {
        issues.push("attachment link without a filename");
        continue;
      }
      attachments.push({
        name,
        size: attachmentSize(anchor),
        url,
        source: "print-view",
      });
      const container = attachmentContainer(anchor, scope);
      if (container) {
        handled.add(container);
        container.remove();
      }
    }

    // Some print views expose only an icon and filename. Preserve the metadata,
    // but mark attachment delivery unverifiable because no safe Gmail URL exists.
    for (const icon of Array.from(scope.querySelectorAll(ATTACH_ICON))) {
      if (!T.isGmailUiIcon(icon.getAttribute("src"))) continue;
      const container = attachmentContainer(icon, scope);
      if (container && handled.has(container)) continue;
      const name = attachmentName(icon);
      if (!name) {
        issues.push("attachment icon without a filename");
        continue;
      }
      attachments.push({
        name,
        size: attachmentSize(icon),
        url: null,
        source: "print-view",
      });
      issues.push(
        container && refused.has(container)
          ? `download link rejected by URL policy for ${name}`
          : `no download link for ${name}`
      );
      if (container) container.remove();
    }

    return { attachments, complete: issues.length === 0, issues };
  }

  function parsePrintView(html, context, openSubject) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    const tables = Array.from(doc.querySelectorAll("table.message")).filter(
      (table) => !table.parentElement?.closest("table.message")
    );
    if (!tables.length) return { empty: true, warnings: [] };

    const title = (doc.title || "").trim();
    if (!T.titleMatchesSubject(title, openSubject)) {
      return { mismatch: true, printSubject: title };
    }

    const messages = [];
    const attachments = [];
    const warnings = [];
    let headersComplete = true;
    let attachmentsComplete = true;
    let quotedTrimmed = false;
    let preservedInlineReplies = 0;

    for (let index = 0; index < tables.length; index++) {
      const table = tables[index];
      const rows = table.querySelectorAll(":scope > tbody > tr, :scope > tr");
      if (rows.length < 2) {
        headersComplete = false;
        attachmentsComplete = false;
        warnings.push({
          code: "MESSAGE_SKIPPED",
          message: `Message candidate ${index + 1} used an unrecognized layout and was not copied.`,
        });
        continue;
      }

      const header = parseHeader(rows);
      const bodyCell = rows[rows.length - 1];
      // Preserve the candidate position. If an earlier table is skipped, a gap
      // in n is more honest than silently renumbering later messages.
      const n = index + 1;
      if (!header.complete) {
        headersComplete = false;
        warnings.push({
          code: "HEADER_INCOMPLETE",
          message: `Message ${n} is missing parsed ${header.issues.join(", ")} information.`,
        });
      }

      const found = extractAttachments(bodyCell, context);
      if (!found.complete) {
        attachmentsComplete = false;
        warnings.push({
          code: "ATTACHMENT_INCOMPLETE",
          message: `Message ${n}: ${found.issues.join("; ")}.`,
        });
      }
      for (const item of found.attachments) attachments.push({ ...item, messageN: n });

      const quoteResult = CL.stripQuoteNodes(bodyCell);
      if (quoteResult.removed) quotedTrimmed = true;
      if (quoteResult.preserved) preservedInlineReplies += quoteResult.preserved;
      const rendered = RT.toMarkdown(bodyCell);
      const cleaned = CL.trimQuotedText(rendered);
      if (cleaned.trimmed) quotedTrimmed = true;
      if (cleaned.elided) {
        warnings.push({
          code: "BODY_ELIDED_BY_GMAIL",
          message:
            `Message ${n}: Gmail rendered this body as an elision placeholder, ` +
            "so its content was never in the print view and is not reported here.",
        });
      }

      messages.push({
        n,
        from: header.from,
        to: header.to,
        cc: header.cc,
        bcc: header.bcc,
        date: T.toIso(header.dateRaw),
        dateRaw: header.dateRaw,
        body: cleaned.text,
      });
    }

    const messagesComplete = messages.length === tables.length;
    if (preservedInlineReplies) {
      warnings.push({
        code: "INLINE_REPLY_PRESERVED",
        message: "A quoted block was retained because it may contain an inline reply.",
      });
    }

    return {
      thread: messages.length
        ? {
            subject: openSubject,
            source:
              messagesComplete && headersComplete && attachmentsComplete
                ? "print-view"
                : "print-view-partial",
            quotedTrimmed,
            completeness: {
              messages: messagesComplete,
              headers: headersComplete,
              attachments: attachmentsComplete,
            },
            warnings,
            expectedMessageCount: tables.length,
            messages,
            attachments,
          }
        : null,
      empty: messages.length === 0,
      warnings,
    };
  }

  CT.gmailParse = {
    headerText,
    parseAddress,
    splitAddressList,
    parseHeader,
    extractAttachments,
    parsePrintView,
  };
})();
