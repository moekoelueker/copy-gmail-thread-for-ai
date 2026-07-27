const test = require("node:test");
const assert = require("node:assert");
const { attachments: A } = require("./loader");

test("parses Gmail's download_url triple", () => {
  const got = A.parseDownloadUrl(
    "application/pdf:Q3 invoice.pdf:https://mail.google.com/mail/u/0/?view=att&th=abc"
  );
  assert.deepStrictEqual(got, {
    type: "application/pdf",
    name: "Q3 invoice.pdf",
    url: "https://mail.google.com/mail/u/0/?view=att&th=abc",
  });
});

test("rejects malformed or non-http download_url values", () => {
  assert.strictEqual(A.parseDownloadUrl(""), null);
  assert.strictEqual(A.parseDownloadUrl("nocolons"), null);
  assert.strictEqual(A.parseDownloadUrl("text/plain:a.txt:javascript:alert(1)"), null);
});

test("classifies inlineable text formats", () => {
  for (const n of ["a.txt", "b.CSV", "c.json", "d.ics", "e.md"]) {
    assert.ok(A.isInlineable(n), `${n} should inline`);
  }
  for (const n of ["a.pdf", "b.docx", "c.png", "d.zip", "noextension"]) {
    assert.ok(!A.isInlineable(n), `${n} should not inline`);
  }
});

test("normalise sanitises hostile filenames before they reach downloads", () => {
  const out = A.normalise([{ name: "../../.zshrc" }], "Subject");
  assert.ok(!out[0].name.includes(".."), out[0].name);
  assert.ok(!out[0].path.includes(".."), out[0].path);
  assert.ok(out[0].path.startsWith("gmail-threads/"), out[0].path);
});

test("normalise de-duplicates colliding names instead of overwriting", () => {
  const out = A.normalise(
    [{ name: "invoice.pdf" }, { name: "invoice.pdf" }, { name: "invoice.pdf" }],
    "Subject"
  );
  const names = out.map((a) => a.name);
  assert.strictEqual(new Set(names).size, 3, `collisions not resolved: ${names}`);
  assert.ok(names[1].includes("(2)"), names[1]);
});

test("normalise prefers the filename embedded in download_url", () => {
  const out = A.normalise(
    [{ name: "chip label", downloadUrl: "image/png:real name.png:https://x/y" }],
    "Subject"
  );
  assert.strictEqual(out[0].name, "real name.png");
  assert.strictEqual(out[0].type, "image/png");
  assert.strictEqual(out[0].url, "https://x/y");
});

test("targetPath stays inside the extension's own folder", () => {
  const p = A.targetPath("../escape", "../../x.sh");
  assert.ok(p.startsWith("gmail-threads/"), p);
  assert.ok(!p.includes(".."), p);
});
