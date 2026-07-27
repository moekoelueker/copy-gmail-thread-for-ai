#!/usr/bin/env node
// Redact a saved Gmail print view without executing it or allowing it network
// access. The result still requires human review before it is treated as a
// genuine live-Gmail regression fixture.

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const WORDS = [
  "lorem", "ipsum", "dolor", "amet", "consectetur", "adipiscing", "elit",
  "tempor", "incididunt", "labore", "magna", "aliqua", "veniam", "nostrud",
  "aliquip", "commodo", "consequat", "voluptate", "cillum", "pariatur",
];

function nextDefaultPath() {
  const directory = path.join(__dirname, "..", "test", "e2e", "fixtures");
  let number = 1;
  while (fs.existsSync(path.join(directory, `real-capture-${number}.html`))) number++;
  return path.join(directory, `real-capture-${number}.html`);
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: npm run redact -- <captured-printview.html> [output.html]");
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(input)) throw new Error(`no such file: ${input}`);

  const output = path.resolve(process.argv[3] || nextDefaultPath());
  const sidecar = output.replace(/\.html?$/i, "") + ".expected.json";
  if (fs.existsSync(output) || fs.existsSync(sidecar)) {
    throw new Error(`refusing to overwrite existing fixture or sidecar: ${output}`);
  }

  const html = fs.readFileSync(input, "utf8");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.route("**/*", (route) => route.abort("blockedbyclient"));
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    const result = await page.evaluate((words) => {
      const people = new Map();
      const files = new Map();
      const attachmentUrls = new Map();
      let personN = 0;
      let fileN = 0;
      let attachmentN = 0;

      const pseudoPerson = (address) => {
        const key = String(address || "").toLowerCase();
        if (!people.has(key)) {
          personN++;
          people.set(key, {
            name: `Person ${personN}`,
            email: `person${personN}@example.com`,
          });
        }
        return people.get(key);
      };

      const pseudoFile = (name) => {
        const key = String(name || "");
        if (!files.has(key)) {
          fileN++;
          const extension = (key.match(/\.([A-Za-z0-9]{1,8})$/) || [])[1];
          files.set(key, `document-${fileN}${extension ? "." + extension : ""}`);
        }
        return files.get(key);
      };

      const safeAttachmentUrl = (raw) => {
        const key = String(raw || "");
        if (!attachmentUrls.has(key)) {
          attachmentN++;
          attachmentUrls.set(
            key,
            `/mail/u/0/?view=att&th=THREAD_REAL&attid=redacted-${attachmentN}&disp=safe`
          );
        }
        return attachmentUrls.get(key);
      };

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
      const EMAIL = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi;
      const LETTERS = /[A-Za-zÀ-ɏ]{2,}/g;
      const SENTINEL = /\uE000(\d+)\uE001/g;

      const pseudoWord = (word, offset) => {
        const replacement = words[(word.length * 7 + offset) % words.length];
        if (word === word.toUpperCase() && word.length > 1) return replacement.toUpperCase();
        if (word[0] === word[0].toUpperCase()) {
          return replacement[0].toUpperCase() + replacement.slice(1);
        }
        return replacement;
      };

      const scrubText = (input) => {
        const parked = [];
        let value = String(input || "").replace(EMAIL, (match) => {
          parked.push(pseudoPerson(match).email);
          return `\uE000${parked.length - 1}\uE001`;
        });
        value = value.replace(LETTERS, (word, offset) =>
          KEEP.test(word) ? word : pseudoWord(word, offset)
        );
        return value.replace(SENTINEL, (_, index) => parked[Number(index)]);
      };

      const isGmailAttachment = (raw) => {
        try {
          const url = new URL(String(raw || ""), "https://mail.google.com");
          return (
            url.origin === "https://mail.google.com" &&
            url.searchParams.get("view") === "att"
          );
        } catch (_) {
          return false;
        }
      };

      // Captures are hostile input. Remove everything executable, navigational,
      // or capable of issuing a request before serializing the fixture.
      document
        .querySelectorAll(
          "script, style, iframe, frame, object, embed, template, base, link, form, input, " +
            "button, meta"
        )
        .forEach((element) => element.remove());
      for (const element of document.querySelectorAll("*")) {
        for (const attribute of Array.from(element.attributes)) {
          const name = attribute.name.toLowerCase();
          if (
            /^on/i.test(name) ||
            name === "style" ||
            name.startsWith("data-") ||
            (name !== "download_url" &&
              /(?:href|src|url|uri|action|background|poster|manifest)$/.test(name) &&
              !(element.tagName === "A" && name === "href") &&
              !(element.tagName === "IMG" && name === "src"))
          ) {
            element.removeAttribute(attribute.name);
          }
        }
      }
      for (const element of Array.from(document.head?.children || [])) {
        if (element.tagName !== "TITLE") element.remove();
      }
      const charset = document.createElement("meta");
      charset.setAttribute("charset", "utf-8");
      document.head?.prepend(charset);
      const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
      const comments = [];
      while (walker.nextNode()) comments.push(walker.currentNode);
      comments.forEach((comment) => comment.remove());

      const walk = (node) => {
        for (const child of Array.from(node.childNodes)) {
          if (child.nodeType === Node.TEXT_NODE) {
            if (child.nodeValue.trim()) child.nodeValue = scrubText(child.nodeValue);
            continue;
          }
          if (child.nodeType !== Node.ELEMENT_NODE) continue;

          for (const attribute of Array.from(child.attributes)) {
            if (/^on/i.test(attribute.name) || attribute.name === "style") {
              child.removeAttribute(attribute.name);
            }
          }

          if (child.tagName === "A") {
            const href = child.getAttribute("href") || "";
            if (/^mailto:/i.test(href)) {
              child.setAttribute("href", `mailto:${pseudoPerson(href.slice(7)).email}`);
            } else if (isGmailAttachment(href)) {
              child.setAttribute("href", safeAttachmentUrl(href));
            } else {
              child.setAttribute("href", "https://example.com/link");
            }
            child.removeAttribute("ping");
          }

          if (child.tagName === "IMG") {
            const src = child.getAttribute("src") || "";
            if (/^https:\/\/(?:ssl\.)?gstatic\.com\/(?:ui\/v1\/)?icons\/mail\//i.test(src)) {
              const url = new URL(src);
              child.setAttribute("src", url.origin + url.pathname);
            } else {
              child.setAttribute("src", "https://example.com/image.png");
            }
            child.removeAttribute("srcset");
            if (child.hasAttribute("alt")) child.setAttribute("alt", "image");
          }

          let replacedFilename = false;
          if (child.tagName === "B") {
            const text = (child.textContent || "").trim();
            if (/\.[A-Za-z0-9]{1,8}$/.test(text)) {
              child.textContent = pseudoFile(text);
              replacedFilename = true;
            }
          }

          const downloadUrl = child.getAttribute("download_url");
          if (downloadUrl) {
            const first = downloadUrl.indexOf(":");
            const markers = [
              downloadUrl.lastIndexOf(":https://"),
              downloadUrl.lastIndexOf(":http://"),
              downloadUrl.lastIndexOf(":/mail/"),
            ].filter((index) => index > first);
            const marker = markers.length ? Math.max(...markers) : -1;
            if (first > 0 && marker > first) {
              const type = downloadUrl.slice(0, first).replace(/[^A-Za-z0-9!#$&^_.+/-]/g, "");
              const name = pseudoFile(downloadUrl.slice(first + 1, marker));
              const rawUrl = downloadUrl.slice(marker + 1);
              child.setAttribute(
                "download_url",
                `${type || "application/octet-stream"}:${name}:${safeAttachmentUrl(rawUrl)}`
              );
            } else {
              child.removeAttribute("download_url");
            }
          }

          for (const name of [
            "srcset", "poster", "action", "formaction", "background", "cite",
            "manifest", "profile", "longdesc",
          ]) {
            child.removeAttribute(name);
          }
          for (const name of ["title", "name", "email", "alt", "value", "placeholder"]) {
            const value = child.getAttribute(name);
            if (value) child.setAttribute(name, scrubText(value));
          }

          for (const attribute of Array.from(child.attributes)) {
            const name = attribute.name.toLowerCase();
            if (name.startsWith("data-")) {
              child.removeAttribute(attribute.name);
            } else if (
              name.includes("href") &&
              !(child.tagName === "A" && name === "href")
            ) {
              child.removeAttribute(attribute.name);
            } else if (name === "src" && child.tagName !== "IMG") {
              child.removeAttribute(attribute.name);
            } else if (name !== "download_url" && /(?:url|uri)$/.test(name)) {
              child.removeAttribute(attribute.name);
            } else if (name === "id") {
              if (!/^(appendonsend|stopSpelling|divRplyFwdMsg)$/.test(attribute.value)) {
                child.setAttribute(attribute.name, "redacted-id");
              }
            } else if (name.startsWith("aria-")) {
              child.setAttribute(attribute.name, "redacted");
            }
          }

          if (!replacedFilename) walk(child);
        }
      };

      walk(document.body);
      if (document.title) {
        const originalTitle = document.title.trim();
        const originalSubject = /^Gmail\s*[-–—]\s*/i.test(originalTitle)
          ? originalTitle.replace(/^Gmail\s*[-–—]\s*/i, "")
          : originalTitle.replace(/\s*[-–—]\s*Gmail$/i, "");
        document.title = "Gmail - " + scrubText(originalSubject);
      }

      const redactedTitle = document.title.trim();
      const subject = /^Gmail\s*[-–—]\s*/i.test(redactedTitle)
        ? redactedTitle.replace(/^Gmail\s*[-–—]\s*/i, "").trim()
        : redactedTitle.replace(/\s*[-–—]\s*Gmail$/i, "").trim();
      const messageCount = Array.from(document.querySelectorAll("table.message")).filter(
        (table) => !table.parentElement?.closest("table.message")
      ).length;
      const attachmentContainers = new Set();
      for (const element of document.querySelectorAll(
        'a[href*="view=att"], img[src*="/icons/mail/"]'
      )) {
        attachmentContainers.add(element.closest("table") || element);
      }

      return {
        html: "<!doctype html>\n" + document.documentElement.outerHTML,
        people: people.size,
        files: files.size,
        expected: {
          schemaVersion: 1,
          kind: "redacted-live-gmail-print-view",
          manuallyReviewed: false,
          subject,
          messageCount,
          attachmentCount: attachmentContainers.size,
          expectedComplete: null,
          reviewNotes: "Inspect the HTML, then set manuallyReviewed and expectedComplete.",
        },
      };
    }, WORDS);

    const forbidden = [
      /\bjavascript:/i,
      /\bon[a-z]+\s*=/i,
      /<(?:script|iframe|object|embed|style|link|base)\b/i,
      /https?:\/\/(?!mail\.google\.com\/|(?:ssl\.)?gstatic\.com\/|example\.com\/)/i,
    ];
    for (const pattern of forbidden) {
      if (pattern.test(result.html)) throw new Error(`redaction safety check failed: ${pattern}`);
    }

    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, result.html, { flag: "wx" });
    fs.writeFileSync(sidecar, JSON.stringify(result.expected, null, 2) + "\n", {
      flag: "wx",
    });

    console.log(`redacted ${result.people} addresses and ${result.files} filenames`);
    console.log(`wrote ${output}`);
    console.log(`wrote ${sidecar}`);
    console.log("Review both files; tests reject the fixture until manuallyReviewed is true.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
