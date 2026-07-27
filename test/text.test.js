const test = require("node:test");
const assert = require("node:assert");
const { text: T } = require("./loader");

const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const NARROW_NBSP = String.fromCharCode(0x202f);

test("sanitizeFilename neutralises path traversal", () => {
  const out = T.sanitizeFilename("../../.zshrc");
  assert.ok(!out.includes(".."), `still contains "..": ${out}`);
  assert.ok(!out.includes("/"), `still contains "/": ${out}`);
});

test("sanitizeFilename neutralises absolute and nested paths", () => {
  for (const evil of ["../../../etc/passwd", "/etc/passwd", "..\\..\\win.ini"]) {
    const out = T.sanitizeFilename(evil);
    assert.ok(!out.includes("/") && !out.includes("\\") && !out.includes(".."), out);
  }
});

test("sanitizeFilename strips control characters", () => {
  assert.strictEqual(T.sanitizeFilename(`in${NUL}voi${BEL}ce.pdf`), "invoice.pdf");
});

test("sanitizeFilename preserves unicode letters", () => {
  assert.strictEqual(T.sanitizeFilename("Angebot-Grün.pdf"), "Angebot-Grün.pdf");
});

test("sanitizeFilename falls back when nothing survives", () => {
  assert.strictEqual(T.sanitizeFilename(""), "attachment");
  assert.strictEqual(T.sanitizeFilename("..."), "attachment");
  assert.strictEqual(T.sanitizeFilename(null), "attachment");
});

test("sanitizeFilename avoids Windows device names and trailing dots", () => {
  assert.strictEqual(T.sanitizeFilename("CON"), "_CON");
  assert.strictEqual(T.sanitizeFilename("nul.txt"), "_nul.txt");
  assert.strictEqual(T.sanitizeFilename("LPT1 .txt"), "_LPT1.txt");
  assert.strictEqual(T.sanitizeFilename("report.pdf."), "report.pdf");
  assert.strictEqual(T.slugify("CON"), "_con");
});

test("sanitizeFilename truncates but keeps the extension", () => {
  const out = T.sanitizeFilename("x".repeat(300) + ".pdf");
  assert.ok(out.length <= 100, `length ${out.length}`);
  assert.ok(out.endsWith(".pdf"), out);
});

test("toIso parses Gmail's date format including narrow spaces", () => {
  const plain = T.toIso("Mon, Jul 7, 2026 at 4:03 PM");
  const narrow = T.toIso(`Mon, Jul 7, 2026${NARROW_NBSP}at${NARROW_NBSP}4:03 PM`);
  assert.match(plain, /^2026-07-0[78]T/);
  assert.strictEqual(plain, narrow);
});

test("toIso never fabricates a date", () => {
  assert.strictEqual(T.toIso("not a date"), null);
  assert.strictEqual(T.toIso(""), null);
  assert.strictEqual(T.toIso(null), null);
  assert.strictEqual(T.toIso("Jan 1, 1200"), null, "absurd year should be rejected");
});

test("slugify produces a safe folder name", () => {
  assert.strictEqual(T.slugify("Q3 renewal / terms!!"), "q3-renewal-terms");
  assert.strictEqual(T.slugify("///"), "thread");
  assert.ok(T.slugify("x".repeat(200)).length <= 60);
});

test("unwrapRedirect recovers the real destination", () => {
  assert.strictEqual(
    T.unwrapRedirect("https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fa&sa=D"),
    "https://example.com/a"
  );
  assert.strictEqual(T.unwrapRedirect("https://example.com/a"), "https://example.com/a");
  assert.strictEqual(T.unwrapRedirect("nonsense"), "nonsense");
});

test("subjectsMatch catches a fetched thread that isn't the open one", () => {
  // Regression: an unscoped [data-legacy-thread-id] lookup matched an inbox list
  // row, so the extension fetched an unrelated conversation and reported success.
  assert.strictEqual(
    T.subjectsMatch(
      "linda_schuh_, getrippit and others posted something new",
      "Subject: Paid Collaboration Opportunity with Northwind"
    ),
    false
  );
});

test("subjectsMatch tolerates reply and forward prefixes", () => {
  assert.ok(T.subjectsMatch("Re: Q3 renewal", "Q3 renewal"));
  assert.ok(T.subjectsMatch("Fwd: Re: Q3 renewal", "Q3 renewal"));
  assert.ok(T.subjectsMatch("AW: Q3 renewal", "Re: Q3 renewal"));
  assert.strictEqual(
    T.subjectsMatch("Gmail - Q3 renewal terms", "Q3 renewal terms"),
    false,
    "mailbox-title wrappers belong in the adapter, not identity normalization"
  );
});

test("subjectsMatch fails closed when a subject is unavailable", () => {
  assert.strictEqual(T.subjectsMatch("", "Q3 renewal"), false);
  assert.strictEqual(T.subjectsMatch("Q3 renewal", ""), false);
});

test("subjectsMatch does not accept substring or non-Latin collisions", () => {
  assert.strictEqual(T.subjectsMatch("Budget", "Budget Q3"), false);
  assert.strictEqual(T.subjectsMatch("契約更新", "請求書"), false);
  assert.strictEqual(T.subjectsMatch("契約更新", "契約更新"), true);
});

test("parseSizeBytes handles Gmail units and rejects ambiguous text", () => {
  assert.strictEqual(T.parseSizeBytes("153K"), 153 * 1024);
  assert.strictEqual(T.parseSizeBytes("1.5 MB"), Math.round(1.5 * 1024 * 1024));
  assert.strictEqual(T.parseSizeBytes("1,5 MB"), Math.round(1.5 * 1024 * 1024));
  assert.strictEqual(T.parseSizeBytes("large"), null);
});

test("normalizeAddress removes angle brackets that would read as markup", () => {
  assert.strictEqual(
    T.normalizeAddress("Sam Rivera <sam@example.net>"),
    "Sam Rivera (sam@example.net)"
  );
  assert.strictEqual(T.normalizeAddress("<a@b.com>"), "a@b.com");
  assert.strictEqual(T.normalizeAddress("a@b.com"), "a@b.com");
  assert.strictEqual(T.normalizeAddress('"Jennifer" <j@x.com>'), "Jennifer (j@x.com)");
  assert.strictEqual(T.normalizeAddress("sam <sam@example.net>"), "sam (sam@example.net)");
});

test("no normalized address can contain a raw angle bracket", () => {
  for (const s of ["A <a@b.com>", "<x@y.com>", "plain@z.com", ""]) {
    const out = T.normalizeAddress(s);
    assert.ok(!out.includes("<") && !out.includes(">"), out);
  }
});

test("unwrapImageProxy recovers the real image URL", () => {
  const proxied =
    "https://ci3.googleusercontent.com/meips/ADKq_Nav123=s0-d-e1-ft#https://static.xx.fbcdn.net/rsrc/x.png";
  assert.strictEqual(T.unwrapImageProxy(proxied), "https://static.xx.fbcdn.net/rsrc/x.png");
  assert.strictEqual(T.unwrapImageProxy("https://example.com/a.png"), "https://example.com/a.png");
});

test("isSafeUrl rejects script and data URLs", () => {
  assert.ok(T.isSafeUrl("https://example.com"));
  assert.ok(T.isSafeUrl("mailto:a@b.com"));
  assert.ok(!T.isSafeUrl("javascript:alert(1)"));
  assert.ok(!T.isSafeUrl("data:text/html,<script>"));
  assert.ok(!T.isSafeUrl("https:example.com"));
  assert.ok(!T.isSafeUrl("https://user:password@example.com"));
});

test("Gmail interface icons are recognised by origin, not by path", () => {
  for (const good of [
    "https://ssl.gstatic.com/ui/v1/icons/mail/images/pdf.gif",
    "https://www.gstatic.com/icons/mail/images/generic.gif",
    "//ssl.gstatic.com/ui/v1/icons/mail/images/pdf.gif",
  ]) {
    assert.strictEqual(T.isGmailUiIcon(good), true, good);
    assert.strictEqual(T.isGmailUiAsset(good), true, good);
  }

  // An email body can host any path it likes. Treating these as Gmail's own
  // markup let a sender forge an attachment entry in their own message.
  for (const hostile of [
    "https://evil.example/icons/mail/images/pdf.gif",
    "http://ssl.gstatic.com/ui/v1/icons/mail/images/pdf.gif",
    "https://ssl.gstatic.com.evil.example/icons/mail/images/pdf.gif",
    "https://gstatic.com.evil.example/icons/mail/x.gif",
    "/icons/mail/images/pdf.gif",
    "icons/mail/images/pdf.gif",
    "javascript:alert(1)",
    "",
  ]) {
    assert.strictEqual(T.isGmailUiIcon(hostile), false, hostile);
  }

  // gstatic assets that are not attachment glyphs are still interface chrome.
  assert.strictEqual(T.isGmailUiAsset("https://ssl.gstatic.com/images/branding/x.png"), true);
  assert.strictEqual(T.isGmailUiIcon("https://ssl.gstatic.com/images/branding/x.png"), false);
});
