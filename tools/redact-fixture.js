#!/usr/bin/env node
// Turn a captured Gmail print view into a fixture that is safe to commit.
//
//   npm run redact -- ~/Downloads/printview-19ec69dc.html
//
// Preserves everything the parser depends on — tags, classes, attributes, table
// shape, quote blocks, attachment markup, dates — and replaces everything that
// identifies anyone. Real mail must never land in a public repository, and a
// fixture is worthless if redaction flattens the structure it exists to test.

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const WORDS = [
  "lorem", "ipsum", "dolor", "amet", "consectetur", "adipiscing", "elit",
  "tempor", "incididunt", "labore", "magna", "aliqua", "veniam", "nostrud",
  "aliquip", "commodo", "consequat", "voluptate", "cillum", "pariatur",
];

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: npm run redact -- <captured-printview.html> [output.html]");
    process.exit(1);
  }
  if (!fs.existsSync(input)) {
    console.error(`no such file: ${input}`);
    process.exit(1);
  }

  const html = fs.readFileSync(input, "utf8");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "domcontentloaded" });

  const result = await page.evaluate((words) => {
    const people = new Map();
    const files = new Map();
    let personN = 0;
    let fileN = 0;

    const pseudoPerson = (addr) => {
      const key = addr.toLowerCase();
      if (!people.has(key)) {
        personN += 1;
        people.set(key, { name: `Person ${personN}`, email: `person${personN}@example.com` });
      }
      return people.get(key);
    };

    // Words the parsers key on. Month and day names matter as much as the
    // structural keywords: scrubbing them turns "Sun, Jun 14, 2026" into
    // unparseable noise and every date assertion becomes meaningless.
    const KEEP = new RegExp(
      "^(" +
        "re|fwd|fw|aw|wg|on|wrote|to|cc|bcc|from|sent|subject|at|am|pm|" +
        "schrieb|écrit|发件人|到|收件人|日期|主题|" +
        "attachment|attachments|quoted|text|hidden|message|original|forwarded|" +
        "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|" +
        "january|february|march|april|june|july|august|september|october|november|december|" +
        "mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|" +
        "monday|tuesday|wednesday|thursday|friday|saturday|sunday" +
      ")$",
      "i"
    );

    const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
    const LETTERS = /[A-Za-zÀ-ɏ]{2,}/g;
    // Private-use delimiters. A bare index would be indistinguishable from the digits
    // in "Jun 14, 2026", and restoring would overwrite every date.
    const SENTINEL = /\uE000(\d+)\uE001/g;

    const pseudoWord = (w, offset) => {
      const r = words[(w.length * 7 + offset) % words.length];
      if (w === w.toUpperCase() && w.length > 1) return r.toUpperCase();
      if (w[0] === w[0].toUpperCase()) return r[0].toUpperCase() + r.slice(1);
      return r;
    };

    // Addresses are parked behind sentinels before prose is scrubbed, then
    // restored. Scrubbing first would mangle the pseudonyms; scrubbing after
    // would leave display names like "Jennifer" untouched whenever they sat in
    // the same whitespace-delimited token as an address.
    const scrubText = (input) => {
      const parked = [];
      let s = String(input).replace(EMAIL, (m) => {
        parked.push(pseudoPerson(m).email);
        return `\uE000${parked.length - 1}\uE001`;
      });
      s = s.replace(LETTERS, (w, i) => (KEEP.test(w) ? w : pseudoWord(w, i)));
      return s.replace(SENTINEL, (_, i) => parked[Number(i)]);
    };

    const walk = (node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3) {
          if (child.nodeValue.trim()) child.nodeValue = scrubText(child.nodeValue);
          continue;
        }
        if (child.nodeType !== 1) continue;

        if (child.tagName === "A") {
          const href = child.getAttribute("href") || "";
          if (/^mailto:/i.test(href)) {
            child.setAttribute("href", `mailto:${pseudoPerson(href.slice(7)).email}`);
          } else if (/^https?:/i.test(href)) {
            try {
              const u = new URL(href);
              // Query strings carry session tokens and account ids.
              child.setAttribute("href", `${u.origin}${u.pathname}`);
            } catch (_) {
              child.setAttribute("href", "https://example.com/link");
            }
          }
        }

        if (child.tagName === "IMG") {
          const src = child.getAttribute("src") || "";
          // Gmail's own icon URLs are structural — the attachment parser keys on
          // them — so those stay. Everything else becomes a stub.
          if (!/gstatic\.com|\/icons\/mail\//i.test(src)) {
            child.setAttribute("src", "https://example.com/image.png");
          }
          if (child.getAttribute("alt")) child.setAttribute("alt", "image");
        }

        // Attachment filenames live in <b>. Keep the extension so type
        // classification and the size regex still have something to work on.
        if (child.tagName === "B") {
          const t = (child.textContent || "").trim();
          const m = t.match(/\.([A-Za-z0-9]{1,8})$/);
          if (m) {
            if (!files.has(t)) {
              fileN += 1;
              files.set(t, `document-${fileN}.${m[1]}`);
            }
            child.textContent = files.get(t);
            continue;
          }
        }

        for (const attr of ["title", "name", "email", "download_url", "alt"]) {
          const v = child.getAttribute && child.getAttribute(attr);
          if (v) child.setAttribute(attr, scrubText(v));
        }

        walk(child);
      }
    };

    walk(document.body);
    if (document.title) {
      document.title = "Gmail - " + scrubText(document.title.replace(/^Gmail\s*-\s*/, ""));
    }

    return {
      html: "<!doctype html>\n" + document.documentElement.outerHTML,
      people: people.size,
      files: files.size,
    };
  }, WORDS);

  await browser.close();

  const out =
    process.argv[3] ||
    path.join(
      __dirname,
      "..",
      "test",
      "e2e",
      "fixtures",
      `real-${path.basename(input).replace(/\.html?$/i, "")}.html`
    );
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, result.html);

  console.log(`redacted ${result.people} addresses and ${result.files} filenames`);
  console.log(`wrote ${out}`);
  console.log("\nRead it before committing. Redaction is mechanical, not a guarantee.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
