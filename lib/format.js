// Thread object -> tagged output.
//
// XML-style tags with markdown bodies. Email bodies routinely contain "#",
// "---" and code fences, so markdown headings are ambiguous as message
// boundaries; tags are not. JSON would escape every newline into "\n" soup and
// YAML breaks on arbitrarily indented email text.
//
// Pure. Unit-tested in Node (test/format.test.js).

(() => {
  const CT = (globalThis.CT = globalThis.CT || {});

  const TAGS = [
    "email_thread", "meta", "subject", "messages", "source", "complete", "url",
    "message", "from", "to", "cc", "body", "attachments", "attachment", "note",
    "participants", "date_range", "attachment_count",
  ];

  const CLOSING_TAG = new RegExp(`</(${TAGS.join("|")})\\b`, "gi");

  // Escape only sequences that could be misread as one of our own closing tags.
  // Escaping every "<" would mangle emails that discuss HTML or contain code.
  function escBody(s) {
    return String(s == null ? "" : s).replace(CLOSING_TAG, "&lt;/$1");
  }

  function escAttr(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function attachmentTag(a) {
    const bits = [`name="${escAttr(a.name)}"`];
    if (a.type) bits.push(`type="${escAttr(a.type)}"`);
    if (a.size) bits.push(`size="${escAttr(a.size)}"`);
    if (a.path) bits.push(`path="${escAttr(a.path)}"`);
    if (a.status) bits.push(`status="${escAttr(a.status)}"`);
    const open = `<attachment ${bits.join(" ")}`;
    if (a.content == null) return `${open}/>`;
    return `${open}>\n${escBody(a.content)}\n</attachment>`;
  }

  function messageBlock(m) {
    const from = m.from || {};

    // Sender and timing live on the opening tag so a single line identifies the
    // message. Splitting them across lines meant two reads to answer "who said
    // this and when", and lost the sender entirely if output was truncated.
    const head = [`<message n="${m.n}"`];
    if (m.date) head.push(`date="${escAttr(m.date)}"`);
    // The ISO stamp is UTC; the local string is what the participants actually
    // saw. Without it, an evening reply reads as next-day and "how fast did
    // they respond" gets answered wrong.
    if (m.dateRaw) head.push(`local="${escAttr(m.dateRaw)}"`);
    head.push(`from="${escAttr(from.name || from.email || "unknown")}"`);
    if (from.email) head.push(`email="${escAttr(from.email)}"`);

    const out = [`${head.join(" ")}>`];
    if (m.to && m.to.length) out.push(`<to>${escBody(m.to.join(", "))}</to>`);
    if (m.cc && m.cc.length) out.push(`<cc>${escBody(m.cc.join(", "))}</cc>`);

    const body = (m.body || "").trim() || "[no text content]";
    out.push("<body>", escBody(body), "</body>");

    if (m.attachments && m.attachments.length) {
      out.push("<attachments>");
      for (const a of m.attachments) out.push(attachmentTag(a));
      out.push("</attachments>");
    }
    out.push("</message>");
    return out.join("\n");
  }

  function build(thread) {
    const msgs = thread.messages || [];
    const out = ["<email_thread>", "<meta>"];
    out.push(`<subject>${escBody(thread.subject || "(no subject)")}</subject>`);
    out.push(`<messages>${msgs.length}</messages>`);

    // A roster up front means a reader knows who is involved without first
    // reading every message. On a long multi-party thread that is the
    // difference between orienting immediately and reconstructing it by hand.
    // Parenthesised rather than angle-bracketed so no address can be mistaken
    // for a tag.
    const people = new Map();
    for (const m of msgs) {
      const email = (m.from && m.from.email) || "";
      const name = (m.from && m.from.name) || email;
      const key = email || name;
      if (key && !people.has(key)) people.set(key, email && name !== email ? `${name} (${email})` : key);
    }
    if (people.size) {
      out.push(`<participants>${escBody(Array.from(people.values()).join("; "))}</participants>`);
    }

    const dated = msgs.filter((m) => m.date).map((m) => m.date);
    if (dated.length > 1) {
      out.push(`<date_range>${escAttr(dated[0])} to ${escAttr(dated[dated.length - 1])}</date_range>`);
    }

    const attachmentCount = msgs.reduce((n, m) => n + ((m.attachments && m.attachments.length) || 0), 0);
    if (attachmentCount) out.push(`<attachment_count>${attachmentCount}</attachment_count>`);
    out.push(`<source>${escBody(thread.source || "print-view")}</source>`);
    out.push(`<complete>${thread.complete === false ? "false" : "true"}</complete>`);
    if (thread.url) out.push(`<url>${escBody(thread.url)}</url>`);

    // The completeness signal has to live in the pasted text, not only in a
    // toast. By the time this reaches a model the toast is long gone, and a
    // model reasoning confidently over half a thread is the worst outcome here.
    if (thread.complete === false) {
      out.push(
        "<note>Captured from the visible page only. Messages Gmail had " +
          "collapsed may be missing from this thread.</note>"
      );
    }
    if (thread.quotedTrimmed) {
      out.push("<note>Quoted reply chains and signatures were removed.</note>");
    }
    out.push("</meta>");

    // Thread-level rather than per-message: Gmail exposes attachment chips for
    // the whole conversation, and guessing which message each belongs to would
    // be a fabrication. Better to be accurate about the thread than confidently
    // wrong about the message.
    if (thread.attachments && thread.attachments.length) {
      out.push("<attachments>");
      for (const a of thread.attachments) out.push(attachmentTag(a));
      out.push("</attachments>");
    }

    for (const m of msgs) out.push(messageBlock(m));
    out.push("</email_thread>");
    return out.join("\n");
  }

  CT.format = { build, escBody, escAttr };
})();
