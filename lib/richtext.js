// DOM subtree -> markdown.
//
// Replaces a plain textContent walk, which silently destroyed every hyperlink
// and flattened tables into newline soup. Business email is mostly tables and
// links, so that loss was invisible and expensive.
//
// Browser only (needs a DOM). Covered by test/browser/index.html.

(() => {
  const CT = (globalThis.CT = globalThis.CT || {});
  const T = CT.text;

  const SKIP = new Set([
    "SCRIPT", "STYLE", "HEAD", "NOSCRIPT", "META", "LINK", "TITLE", "BUTTON", "SELECT",
  ]);

  const BLOCK = new Set([
    "ADDRESS", "ARTICLE", "ASIDE", "DIV", "DL", "DD", "DT", "FIELDSET", "FIGCAPTION",
    "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "MAIN",
    "NAV", "P", "SECTION", "TR",
  ]);

  function renderChildren(node, ctx) {
    let out = "";
    for (const child of node.childNodes) out += render(child, ctx);
    return out;
  }

  function renderTable(el, ctx) {
    const rows = Array.from(
      el.querySelectorAll(":scope > tbody > tr, :scope > thead > tr, :scope > tr")
    );
    if (!rows.length) return renderChildren(el, ctx);

    const grid = rows.map((r) =>
      Array.from(r.querySelectorAll(":scope > td, :scope > th"))
    );
    const maxCols = Math.max(...grid.map((r) => r.length));

    // Email uses tables for layout constantly. A single-column table, or one
    // wrapping another table, is scaffolding rather than data — render its
    // contents normally instead of emitting a nonsense one-column table.
    if (maxCols <= 1 || el.querySelector("table")) return renderChildren(el, ctx);

    const cells = grid.map((row) => {
      const rendered = row.map((c) =>
        render(c, { ...ctx, inCell: true })
          .replace(/\s*\n+\s*/g, " ")
          .replace(/\|/g, "\\|")
          .trim()
      );
      while (rendered.length < maxCols) rendered.push("");
      return rendered;
    });

    // Marketing email is built out of spacer tables whose cells are empty or
    // hold nothing but a decorative image. Rendering those produces walls of
    // "| | |" that carry no information at all.
    const meaningful = cells.flat().filter((c) => c && c !== "[image]").length;
    if (!meaningful) return "";

    const header = cells[0];
    const lines = [
      `| ${header.join(" | ")} |`,
      `| ${header.map(() => "---").join(" | ")} |`,
    ];
    for (const row of cells.slice(1)) lines.push(`| ${row.join(" | ")} |`);
    return `\n${lines.join("\n")}\n`;
  }

  function renderList(el, ctx) {
    const ordered = el.tagName === "OL";
    const depth = ctx.listDepth || 0;
    const indent = "  ".repeat(depth);
    const items = Array.from(el.children).filter((c) => c.tagName === "LI");
    if (!items.length) return renderChildren(el, ctx);

    const lines = items.map((li, i) => {
      const marker = ordered ? `${i + 1}. ` : "- ";
      const inner = renderChildren(li, { ...ctx, listDepth: depth + 1 })
        .replace(/\n{2,}/g, "\n")
        .trim();
      return indent + marker + inner.replace(/\n/g, `\n${indent}  `);
    });
    return `\n${lines.join("\n")}\n`;
  }

  function renderLink(el, ctx) {
    const href = T.unwrapRedirect(el.getAttribute("href") || "");
    const text = renderChildren(el, ctx)
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\\/g, "\\\\")
      .replace(/\[/g, "\\[")
      .replace(/\]/g, "\\]");
    if (!T.isSafeUrl(href)) return text; // drops javascript: and data: hrefs
    const safeHref = href
      .replace(/\\/g, "%5C")
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29")
      .replace(/</g, "%3C")
      .replace(/>/g, "%3E")
      .replace(/"/g, "%22")
      .replace(/'/g, "%27")
      .replace(/\s/g, (ch) => encodeURIComponent(ch));
    if (!text) return safeHref;
    if (text === href) return safeHref;
    return `[${text}](${safeHref})`;
  }

  function renderImage(el) {
    const raw = (el.getAttribute("src") || "").trim();
    const alt = (el.getAttribute("alt") || "").trim();

    // Tracking pixels. Marketing mail is full of them and they carry no meaning.
    const w = parseInt(el.getAttribute("width") || "", 10);
    const h = parseInt(el.getAttribute("height") || "", 10);
    if ((w && w <= 2) || (h && h <= 2)) return "";
    if (/email_open_log_pic|\/open\.gif|utm_medium=email.*pixel/i.test(raw)) return "";

    // Gmail's own interface icons — filetype glyphs beside attachments and the
    // like. They are chrome, not content, and served from gstatic rather than
    // the image proxy, so neither rule above catches them.
    if (/(^|\/\/)(ssl\.)?gstatic\.com\/|\/icons\/mail\/images\//i.test(raw)) return "";

    // A single inline base64 image can add megabytes of noise to the clipboard.
    if (/^(data:|cid:)/i.test(raw)) return alt ? `[inline image: ${alt}]` : "[inline image]";
    if (!T.isSafeUrl(raw)) return alt ? `[image: ${alt}]` : "";

    // Do not emit active Markdown images. A remote image can be a per-recipient
    // tracking URL, and a chat client may fetch it as soon as the text is pasted.
    // Description preserves the useful semantic content without causing a
    // downstream network request.
    return alt ? `[image: ${alt}]` : "[image]";
  }

  function render(node, ctx) {
    if (node.nodeType === 3) {
      const v = node.nodeValue || "";
      return ctx.pre ? v : v.replace(/\s+/g, " ");
    }
    if (node.nodeType !== 1) return "";

    const tag = node.tagName;
    if (SKIP.has(tag)) return "";

    switch (tag) {
      case "BR":
        return "\n";
      case "HR":
        return "\n---\n";
      case "A":
        return renderLink(node, ctx);
      case "IMG":
        return renderImage(node);
      case "TABLE":
        return ctx.inCell ? renderChildren(node, ctx) : renderTable(node, ctx);
      case "UL":
      case "OL":
        return renderList(node, ctx);
      case "PRE": {
        const body = node.textContent.replace(/\s+$/, "");
        const longest = Math.max(0, ...(body.match(/`+/g) || []).map((s) => s.length));
        const fence = "`".repeat(Math.max(3, longest + 1));
        return ctx.inCell ? body : `\n${fence}\n${body}\n${fence}\n`;
      }
      case "CODE": {
        if (ctx.pre) return renderChildren(node, ctx);
        const body = renderChildren(node, ctx).trim();
        if (!body) return "";
        const longest = Math.max(0, ...(body.match(/`+/g) || []).map((s) => s.length));
        const fence = "`".repeat(longest + 1);
        return `${fence}${body}${fence}`;
      }
      case "B":
      case "STRONG": {
        const body = renderChildren(node, ctx).trim();
        return body ? `**${body}**` : "";
      }
      case "I":
      case "EM": {
        const body = renderChildren(node, ctx).trim();
        return body ? `*${body}*` : "";
      }
      case "BLOCKQUOTE": {
        const body = renderChildren(node, ctx).trim();
        if (!body) return "";
        return `\n${body.split("\n").map((l) => `> ${l}`).join("\n")}\n`;
      }
      case "LI":
        // Reached only when an LI sits outside a UL/OL; renderList handles the
        // normal case and calls renderChildren directly.
        return `\n- ${renderChildren(node, ctx).trim()}`;
      default: {
        const body = renderChildren(node, ctx);
        return BLOCK.has(tag) ? `${body}\n` : body;
      }
    }
  }

  function toMarkdown(node) {
    if (!node) return "";
    return (
      render(node, { listDepth: 0 })
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        // Collapse runs of spaces inside a line only. Anchoring on a preceding
        // non-space keeps leading indentation, which is what carries nesting in
        // markdown lists and would otherwise be flattened away.
        .replace(/([^\n \t])[ \t]{2,}/g, "$1 ")
        .trim()
    );
  }

  CT.richtext = { toMarkdown };
})();
