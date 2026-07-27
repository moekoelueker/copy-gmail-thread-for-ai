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

test("isSafeUrl rejects script and data URLs", () => {
  assert.ok(T.isSafeUrl("https://example.com"));
  assert.ok(T.isSafeUrl("mailto:a@b.com"));
  assert.ok(!T.isSafeUrl("javascript:alert(1)"));
  assert.ok(!T.isSafeUrl("data:text/html,<script>"));
});
