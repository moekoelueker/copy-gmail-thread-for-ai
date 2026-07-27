// Removing quoted reply chains and signatures.
//
// Split deliberately in two:
//   stripQuoteNodes(root) — DOM surgery, browser only, mechanical and low risk.
//   trimQuotedText(body)  — pure string logic, where all the subtle judgement
//                           lives, so it can be unit-tested in Node.

(() => {
  const CT = (globalThis.CT = globalThis.CT || {});

  // ---------- DOM pass ----------

  const QUOTE_SELECTORS = [
    "blockquote.gmail_quote",
    "div.gmail_quote",
    ".gmail_extra > blockquote",
    "blockquote[type=cite]",
    "div.moz-cite-prefix",
  ];
  const SIGNATURE_SELECTORS = ["div.gmail_signature"];

  // Outlook marks the start of quoted history with these and then keeps going as
  // siblings, so the node itself and everything after it has to go.
  const TAIL_MARKERS = ["#appendonsend", "hr#stopSpelling", "#divRplyFwdMsg"];

  function textWithBreaks(node) {
    let out = "";
    for (const child of node?.childNodes || []) {
      if (child.nodeType === 3) out += child.nodeValue || "";
      else if (child.nodeType === 1) {
        if (child.tagName === "BR") out += "\n";
        else {
          out += textWithBreaks(child);
          if (/^(DIV|P|LI|BLOCKQUOTE)$/.test(child.tagName)) out += "\n";
        }
      }
    }
    return out;
  }

  function possibleInlineReply(el) {
    const lines = textWithBreaks(el)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const hasLiteralQuotes = lines.some((line) => /^>/.test(line));
    const literalProse = lines
      .filter((line) => !/^>/.test(line))
      .filter((line) => !/^(?:On\b.*wrote:|Am\b.*schrieb.*:|Le\b.*a écrit\s*:)/i.test(line))
      .join(" ");
    if (hasLiteralQuotes && literalProse.length > INLINE_REPLY_CHARS) return true;

    // In HTML replies, an inline answer may be a sibling of a nested blockquote
    // inside Gmail's outer gmail_quote wrapper. Remove the known quoted subtree
    // from a clone; substantial prose left outside it must survive.
    if (el.matches?.("div.gmail_quote, .gmail_extra")) {
      const clone = el.cloneNode(true);
      clone
        .querySelectorAll("blockquote, .gmail_attr, div.gmail_quote")
        .forEach((node) => node.remove());
      const outside = String(clone.textContent || "").replace(/\s+/g, " ").trim();
      if (outside.length > INLINE_REPLY_CHARS) return true;
    }
    return false;
  }

  function stripQuoteNodes(root) {
    let removed = 0;
    let preserved = 0;
    for (const sel of SIGNATURE_SELECTORS) {
      for (const el of root.querySelectorAll(sel)) {
        el.remove();
        removed++;
      }
    }
    for (const sel of QUOTE_SELECTORS) {
      for (const el of root.querySelectorAll(sel)) {
        if (!el.isConnected && !root.contains(el)) continue;
        if (possibleInlineReply(el)) {
          // Keep the suspected answer, but remove an identifiable nested quote
          // and its attribution line. This avoids preserving the whole old
          // conversation merely because a point-by-point answer lived beside it.
          for (const quoted of el.querySelectorAll("blockquote, .gmail_attr")) {
            quoted.remove();
            removed++;
          }
          preserved++;
          continue;
        }
        el.remove();
        removed++;
      }
    }
    for (const sel of TAIL_MARKERS) {
      const el = root.querySelector(sel);
      if (!el) continue;
      let node = el;
      while (node) {
        const next = node.nextSibling;
        node.remove();
        removed++;
        node = next;
      }
    }
    return { removed, preserved };
  }

  // ---------- text pass ----------

  // A forwarded message is content the user meant to keep, not quoted history.
  // Forwards also contain "From:/Sent:" headers that would trip the heuristics
  // below, so when we see one we do no text-level cutting at all and rely purely
  // on the DOM pass. Conservative on purpose: keeping noise beats losing mail.
  const FORWARD_MARKER =
    /-{2,}\s*(forwarded message|weitergeleitete nachricht|message transf)/i;

  // Two kinds of quote marker, and they need different treatment.
  //
  // "chain" intros ("On … wrote:") precede >-prefixed text, and people reply
  // inline inside that text, so the safety valve has to run.
  //
  // "header" intros are a quoted From/To/Date/Subject block. Everything after
  // one is quoted by construction and none of it is >-prefixed, so running the
  // valve there would read the quoted headers as prose and never cut at all.
  const QUOTE_INTROS = [
    { kind: "chain", re: /^[ \t]*On\b[\s\S]{0,400}?\bwrote:[ \t]*$/m },
    { kind: "chain", re: /^[ \t]*Am\b[\s\S]{0,400}?\bschrieb\b[\s\S]{0,200}?:[ \t]*$/m },
    { kind: "chain", re: /^[ \t]*Le\b[\s\S]{0,400}?\ba écrit\s*:[ \t]*$/m },
    { kind: "header", re: /^[ \t]*-{2,}\s*Original Message\s*-{2,}[ \t]*$/im },
    { kind: "header", re: /^[ \t]*From:[ \t]*\S[^\n]*\r?\n[ \t]*Sent:[ \t]*/im },
    // Chinese mail clients quote with a From/To/Date/Subject header block.
    // Common in real threads with overseas senders.
    { kind: "header", re: /^[ \t]*发件人\s*[:：][^\n]*\r?\n[ \t]*(?:到|收件人)\s*[:：]/m },
  ];

  const SIGNATURE_LINE = /^-- ?[ \t]*$/m;

  // Gmail's own placeholder where it elided a quote. Pure noise once the real
  // quoted content has been removed.
  const PLACEHOLDERS = /^[ \t]*\[?(Quoted text hidden|Message clipped|Zitierter Text ausgeblendet)\]?[ \t]*$/gim;

  // Many signatures carry no "--" delimiter, so a closing salutation is the
  // only marker available. Cutting there is only safe when what follows is
  // short and boilerplate-shaped, hence the guards in trimSignature.
  const SALUTATION =
    /^[ \t]*(best regards|kind regards|warm regards|best wishes|best|regards|sincerely|thanks|thank you|cheers|mit freundlichen grüßen|viele grüße|beste grüße)[,!]?[ \t]*$/gim;

  const KEEP_AFTER = /\bP\.?S\.?[:.\s]|\?/;

  function trimSignature(text) {
    let last = null;
    let m;
    SALUTATION.lastIndex = 0;
    while ((m = SALUTATION.exec(text)) !== null) last = m;
    if (!last) return text;

    const tail = text.slice(last.index + last[0].length);
    // Never cut across a postscript or a question — those are content, not
    // boilerplate. And only cut a tail small enough to plausibly be a sign-off.
    if (KEEP_AFTER.test(tail)) return text;
    if (tail.length > 320) return text;
    if (tail.split("\n").filter((l) => l.trim()).length > 8) return text;

    const kept = text.slice(0, last.index).trimEnd();
    return kept.trim() ? kept : text;
  }

  // How much unquoted prose has to sit inside the removed tail before we treat
  // it as an inline reply rather than quoted history.
  const INLINE_REPLY_CHARS = 80;

  // The tail is quoted history if its lines are quote markers. Real prose there
  // means the sender answered point by point inside the quote, and cutting
  // would throw their reply away.
  function tailLooksLikeInlineReply(tail) {
    const unquoted = tail
      .split("\n")
      .filter((l) => l.trim() && !/^\s*>/.test(l))
      .join(" ")
      .trim();
    return unquoted.length > INLINE_REPLY_CHARS;
  }

  function trimQuotedText(body) {
    const original = String(body == null ? "" : body);
    if (!original.trim()) return { text: original, trimmed: false };
    if (FORWARD_MARKER.test(original)) return { text: original, trimmed: false };

    let cut = original.length;
    let introEnd = original.length;
    let kind = null;
    for (const intro of QUOTE_INTROS) {
      const m = intro.re.exec(original);
      if (m && m.index < cut) {
        cut = m.index;
        introEnd = m.index + m[0].length;
        kind = intro.kind;
      }
    }

    // Judge the cut on what it removes, not on what it leaves. Keying on "is the
    // remainder short?" would spare every one-line reply — "Sounds good." atop a
    // long chain — which is exactly the quadratic blow-up this exists to stop.
    if (kind === "chain" && tailLooksLikeInlineReply(original.slice(introEnd))) {
      cut = original.length;
    }

    let out = original.slice(0, cut);

    // Only treat "--" as a signature delimiter when the tail it would remove is
    // a minority of the message. Otherwise a stray "--" near the top of a short
    // email would delete the whole thing.
    const sig = SIGNATURE_LINE.exec(out);
    if (sig && sig.index > out.length * 0.5) out = out.slice(0, sig.index);

    out = trimSignature(out);
    out = out.replace(PLACEHOLDERS, "");
    out = out.replace(/\n{3,}/g, "\n\n").trimEnd();

    // Trimming must never turn a non-empty body into an empty one.
    if (!out.trim()) return { text: original, trimmed: false };
    return { text: out, trimmed: out.length !== original.length };
  }

  CT.clean = { stripQuoteNodes, trimQuotedText };
})();
