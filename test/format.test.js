const test = require("node:test");
const assert = require("node:assert");
const { format: F } = require("./loader");

const msg = (over = {}) => ({
  n: 1,
  from: { name: "Jane Doe", email: "jane@acme.com" },
  to: [],
  cc: [],
  date: "2026-07-07T16:03:00.000Z",
  dateRaw: "Jul 7, 2026",
  body: "Hello.",
  attachments: [],
  ...over,
});

const thread = (over = {}) => ({
  subject: "Q3 renewal",
  url: "https://mail.google.com/mail/u/0/#all/abc",
  source: "print-view",
  complete: true,
  quotedTrimmed: false,
  messages: [msg()],
  ...over,
});

test("emits a well-formed envelope", () => {
  const out = F.build(thread());
  assert.ok(out.startsWith("<email_thread>"));
  assert.ok(out.trimEnd().endsWith("</email_thread>"));
  assert.ok(out.includes("<subject>Q3 renewal</subject>"));
  assert.ok(out.includes("<messages>1</messages>"));
});

test("a body containing a closing tag cannot break the structure", () => {
  const out = F.build(thread({ messages: [msg({ body: "see </message> and </body>" })] }));
  const opens = (out.match(/<message\b/g) || []).length;
  const closes = (out.match(/<\/message>/g) || []).length;
  assert.strictEqual(opens, 1);
  assert.strictEqual(closes, 1, "an escaped closing tag leaked into the structure");
  assert.ok(out.includes("&lt;/message&gt;") || out.includes("&lt;/message"), out);
});

test("does not over-escape ordinary angle brackets in bodies", () => {
  const out = F.build(thread({ messages: [msg({ body: "use <div> for layout, x < y" })] }));
  assert.ok(out.includes("<div>"), "legitimate markup discussion was mangled");
  assert.ok(out.includes("x < y"));
});

test("escapes attribute values", () => {
  const out = F.build(
    thread({ messages: [msg({ from: { name: 'Bob "The Closer" & Co <x>', email: "b@x.com" } })] })
  );
  assert.ok(out.includes("&quot;"), "quotes not escaped in attribute");
  assert.ok(out.includes("&amp;"), "ampersand not escaped in attribute");
  const fromLine = out.split("\n").find((l) => l.startsWith("<from "));
  assert.ok(/^<from name="[^"]*" email="[^"]*"\/>$/.test(fromLine), fromLine);
});

test("omits empty recipient tags", () => {
  const out = F.build(thread());
  assert.ok(!out.includes("<to>"), "emitted an empty <to>");
  assert.ok(!out.includes("<cc>"), "emitted an empty <cc>");
});

test("includes recipients when present", () => {
  const out = F.build(thread({ messages: [msg({ to: ["a@x.com", "b@x.com"], cc: ["c@x.com"] })] }));
  assert.ok(out.includes("<to>a@x.com, b@x.com</to>"));
  assert.ok(out.includes("<cc>c@x.com</cc>"));
});

test("an empty body becomes an explicit placeholder, never a dropped message", () => {
  const out = F.build(thread({ messages: [msg({ body: "" })] }));
  assert.ok(out.includes("[no text content]"), out);
  assert.strictEqual((out.match(/<message\b/g) || []).length, 1);
});

test("an incomplete capture is declared in the output, not just the toast", () => {
  const out = F.build(thread({ complete: false, source: "dom-fallback" }));
  assert.ok(out.includes("<complete>false</complete>"));
  assert.ok(/<note>[^<]*collapsed/i.test(out), "no warning note for a partial capture");
});

test("an unparseable date degrades to date_raw", () => {
  const out = F.build(thread({ messages: [msg({ date: null, dateRaw: "sometime Tuesday" })] }));
  assert.ok(out.includes('date_raw="sometime Tuesday"'));
  assert.ok(!/ date="/.test(out), "emitted a fabricated date attribute");
});

test("renders thread-level attachments", () => {
  const out = F.build(
    thread({
      attachments: [
        { name: "invoice.pdf", type: "application/pdf", size: "240 KB", path: "~/Downloads/x/invoice.pdf" },
        { name: "notes.txt", type: "text/plain", size: "1 KB", content: "line one" },
      ],
    })
  );
  assert.ok(out.includes('<attachment name="invoice.pdf"'));
  assert.ok(out.includes("/>"), "self-closing form missing for a file with no content");
  assert.ok(out.includes("line one"), "inlined content missing");
  assert.ok(out.includes("</attachment>"));
});

test("quoted-trim note appears only when trimming happened", () => {
  assert.ok(!/quoted reply chains/i.test(F.build(thread())));
  assert.ok(/quoted reply chains/i.test(F.build(thread({ quotedTrimmed: true }))));
});
