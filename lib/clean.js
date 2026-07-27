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
    "div.gmail_signature",
    "blockquote[type=cite]",
    "div.moz-cite-prefix",
  ];

  // Outlook marks the start of quoted history with these and then keeps going as
  // siblings, so the node itself and everything after it has to go.
  const TAIL_MARKERS = ["#appendonsend", "hr#stopSpelling", "#divRplyFwdMsg"];

  function stripQuoteNodes(root) {
    let removed = 0;
    for (const sel of QUOTE_SELECTORS) {
      for (const el of root.querySelectorAll(sel)) {
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
    return removed;
  }

  // ---------- text pass ----------

  // A forwarded message is content the user meant to keep, not quoted history.
  // Forwards also contain "From:/Sent:" headers that would trip the heuristics
  // below, so when we see one we do no text-level cutting at all and rely purely
  // on the DOM pass. Conservative on purpose: keeping noise beats losing mail.
  const FORWARD_MARKER =
    /-{2,}\s*(forwarded message|weitergeleitete nachricht|message transf)/i;

  const QUOTE_INTROS = [
    /^[ \t]*On\b[\s\S]{0,400}?\bwrote:[ \t]*$/m,
    /^[ \t]*Am\b[\s\S]{0,400}?\bschrieb\b[\s\S]{0,200}?:[ \t]*$/m,
    /^[ \t]*Le\b[\s\S]{0,400}?\ba écrit\s*:[ \t]*$/m,
    /^[ \t]*-{2,}\s*Original Message\s*-{2,}[ \t]*$/im,
    /^[ \t]*From:[ \t]*\S[^\n]*\r?\n[ \t]*Sent:[ \t]*/im,
  ];

  const SIGNATURE_LINE = /^-- ?[ \t]*$/m;

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
    for (const re of QUOTE_INTROS) {
      const m = re.exec(original);
      if (m && m.index < cut) {
        cut = m.index;
        introEnd = m.index + m[0].length;
      }
    }

    // Judge the cut on what it removes, not on what it leaves. Keying on "is the
    // remainder short?" would spare every one-line reply — "Sounds good." atop a
    // long chain — which is exactly the quadratic blow-up this exists to stop.
    if (cut < original.length && tailLooksLikeInlineReply(original.slice(introEnd))) {
      cut = original.length;
    }

    let out = original.slice(0, cut);

    // Only treat "--" as a signature delimiter when the tail it would remove is
    // a minority of the message. Otherwise a stray "--" near the top of a short
    // email would delete the whole thing.
    const sig = SIGNATURE_LINE.exec(out);
    if (sig && sig.index > out.length * 0.5) out = out.slice(0, sig.index);

    out = out.replace(/\n{3,}/g, "\n\n").trimEnd();

    // Trimming must never turn a non-empty body into an empty one.
    if (!out.trim()) return { text: original, trimmed: false };
    return { text: out, trimmed: out.length !== original.length };
  }

  CT.clean = { stripQuoteNodes, trimQuotedText };
})();
