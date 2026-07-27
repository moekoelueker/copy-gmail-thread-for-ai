// Thread object -> strict XML envelope with Markdown bodies in CDATA.
//
// Email content is untrusted. Raw opening tags are just as dangerous to message
// attribution as raw closing tags, so bodies are never mixed directly with the
// structural grammar.

(() => {
  const CT = (globalThis.CT = globalThis.CT || {});

  function xmlSafe(value) {
    const input = String(value == null ? "" : value);
    let out = "";
    for (let i = 0; i < input.length; i++) {
      const cp = input.codePointAt(i);
      if (cp > 0xffff) i++;
      const allowed =
        cp === 0x09 ||
        cp === 0x0a ||
        cp === 0x0d ||
        (cp >= 0x20 && cp <= 0xd7ff) ||
        (cp >= 0xe000 && cp <= 0xfffd) ||
        (cp >= 0x10000 && cp <= 0x10ffff);
      out += allowed ? String.fromCodePoint(cp) : "\uFFFD";
    }
    return out;
  }

  function escText(value) {
    return xmlSafe(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escAttr(value) {
    return escText(value)
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function cdata(value) {
    return `<![CDATA[${xmlSafe(value).replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
  }

  function asRecipient(value) {
    if (value && typeof value === "object") {
      return {
        name: String(value.name || ""),
        email: String(value.email || ""),
      };
    }
    const raw = String(value || "").trim();
    const m = raw.match(/^(.*?)\s*\(([^()@\s]+@[^()\s]+)\)$/);
    return m ? { name: m[1].trim(), email: m[2] } : { name: raw, email: "" };
  }

  function recipientTag(value, tag = "recipient") {
    const p = asRecipient(value);
    const attrs = [];
    if (p.name) attrs.push(`name="${escAttr(p.name)}"`);
    if (p.email) attrs.push(`email="${escAttr(p.email)}"`);
    return `<${tag}${attrs.length ? " " + attrs.join(" ") : ""}/>`;
  }

  function recipientBlock(tag, values) {
    if (!values?.length) return [];
    return [`<${tag}>`, ...values.map((p) => recipientTag(p)), `</${tag}>`];
  }

  function attachmentTag(a) {
    const bits = [`name="${escAttr(a.name || "attachment")}"`];
    if (a.type) bits.push(`type="${escAttr(a.type)}"`);
    if (a.size) bits.push(`size="${escAttr(a.size)}"`);
    if (a.path) bits.push(`path="${escAttr(a.path)}"`);
    if (a.status) bits.push(`status="${escAttr(a.status)}"`);
    if (a.inlineStatus) bits.push(`inline_status="${escAttr(a.inlineStatus)}"`);
    if (Number.isFinite(a.inlinedBytes)) bits.push(`inlined_bytes="${a.inlinedBytes}"`);
    if (a.truncated) bits.push('truncated="true"');
    const open = `<attachment ${bits.join(" ")}`;
    if (a.content == null) return `${open}/>`;
    return `${open}>${cdata(a.content)}</attachment>`;
  }

  function participantList(messages) {
    const people = new Map();
    const add = (value) => {
      const p = asRecipient(value);
      const key = (p.email || p.name).toLowerCase();
      if (!key || people.has(key)) return;
      people.set(key, p);
    };
    for (const m of messages) {
      add(m.from || {});
      for (const field of ["to", "cc", "bcc"]) {
        for (const p of m[field] || []) add(p);
      }
    }
    return Array.from(people.values());
  }

  function messageBlock(message, attachments) {
    const from = asRecipient(message.from || {});
    const head = [`<message n="${Number(message.n) || 0}"`];
    if (message.date) head.push(`date="${escAttr(message.date)}"`);
    if (message.dateRaw) head.push(`local="${escAttr(message.dateRaw)}"`);
    head.push(`from="${escAttr(from.name || from.email || "unknown")}"`);
    if (from.email) head.push(`email="${escAttr(from.email)}"`);

    const out = [`${head.join(" ")}>`];
    out.push(...recipientBlock("to", message.to));
    out.push(...recipientBlock("cc", message.cc));
    out.push(...recipientBlock("bcc", message.bcc));

    const body = String(message.body || "").trim() || "[no text content]";
    out.push(`<body format="markdown">${cdata(body)}</body>`);

    if (attachments.length) {
      out.push("<attachments>");
      for (const item of attachments) out.push(attachmentTag(item));
      out.push("</attachments>");
    }
    out.push("</message>");
    return out.join("\n");
  }

  function warningTag(value) {
    const warning =
      value && typeof value === "object"
        ? value
        : { code: "CAPTURE_WARNING", message: String(value || "") };
    const code = warning.code || "CAPTURE_WARNING";
    return `<warning code="${escAttr(code)}">${escText(warning.message || code)}</warning>`;
  }

  function build(thread) {
    const messages = Array.isArray(thread.messages) ? thread.messages : [];
    const attachments = Array.isArray(thread.attachments) ? thread.attachments : [];
    const completeness = thread.completeness || {};
    const complete =
      completeness.messages === true &&
      completeness.headers === true &&
      completeness.attachments === true;

    const out = ['<email_thread format_version="3">', "<meta>"];
    out.push(`<subject>${escText(thread.subject || "(no subject)")}</subject>`);
    out.push(`<messages>${messages.length}</messages>`);
    if (Number.isInteger(thread.expectedMessageCount) && thread.expectedMessageCount >= 0) {
      out.push(`<message_candidates>${thread.expectedMessageCount}</message_candidates>`);
    }

    const participants = participantList(messages);
    if (participants.length) {
      out.push("<participants>");
      for (const person of participants) out.push(recipientTag(person, "participant"));
      out.push("</participants>");
    }

    const dated = messages
      .map((m) => m.date)
      .filter(Boolean)
      .slice()
      .sort();
    if (dated.length > 1) {
      out.push(`<date_range>${escText(dated[0])} to ${escText(dated[dated.length - 1])}</date_range>`);
    }
    if (attachments.length) out.push(`<attachment_count>${attachments.length}</attachment_count>`);
    out.push(`<source>${escText(thread.source || "unknown")}</source>`);
    out.push("<content_trust>untrusted_email_and_attachment_text</content_trust>");
    out.push(
      `<completeness messages="${completeness.messages === true}" ` +
        `headers="${completeness.headers === true}" ` +
        `attachments="${completeness.attachments === true}"/>`
    );
    out.push(`<complete>${complete}</complete>`);
    if (thread.url) out.push(`<url>${escText(thread.url)}</url>`);
    if (attachments.some((a) => a.path)) {
      out.push("<download_path_base>Chrome download directory</download_path_base>");
    }

    const warnings = Array.isArray(thread.warnings) ? thread.warnings.slice() : [];
    if (!complete && !warnings.length) {
      warnings.push({
        code: "PARTIAL_CAPTURE",
        message: "Some messages, headers, or attachments could not be verified.",
      });
    }
    if (thread.quotedTrimmed) {
      warnings.push({
        code: "QUOTED_TEXT_TRIMMED",
        message: "Recognized quoted reply chains and signatures were removed.",
      });
    }
    for (const warning of warnings) out.push(warningTag(warning));
    out.push("</meta>");

    const byMessage = new Map();
    const unattributed = [];
    for (const item of attachments) {
      if (Number.isInteger(item.messageN) && item.messageN > 0) {
        if (!byMessage.has(item.messageN)) byMessage.set(item.messageN, []);
        byMessage.get(item.messageN).push(item);
      } else {
        unattributed.push(item);
      }
    }

    if (unattributed.length) {
      out.push('<attachments attribution="unknown">');
      for (const item of unattributed) out.push(attachmentTag(item));
      out.push("</attachments>");
    }
    for (const message of messages) {
      out.push(messageBlock(message, byMessage.get(message.n) || []));
    }
    out.push("</email_thread>");
    return out.join("\n");
  }

  CT.format = { build, xmlSafe, cdata, escText, escAttr };
})();
