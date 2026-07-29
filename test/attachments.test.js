const test = require("node:test");
const assert = require("node:assert");
const { attachments: A } = require("./loader");

const CONTEXT = { threadId: "THREAD_REAL", accountIndex: "0" };
const att = (id, extra = "") =>
  `/mail/u/0/?view=att&th=THREAD_REAL&attid=${encodeURIComponent(id)}${extra}`;

test("parses Gmail download_url values without splitting filename colons", () => {
  const got = A.parseDownloadUrl(
    "application/pdf:Q3: final.pdf:/mail/u/0/?view=att&th=THREAD_REAL&attid=0.1"
  );
  assert.deepStrictEqual(got, {
    type: "application/pdf",
    name: "Q3: final.pdf",
    url: "/mail/u/0/?view=att&th=THREAD_REAL&attid=0.1",
  });
});

test("rejects malformed download_url values", () => {
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
  const out = A.normalise([{ name: "../../.zshrc", href: att("1") }], "Subject", CONTEXT);
  assert.ok(!out[0].name.includes(".."), out[0].name);
  assert.ok(!out[0].path.includes(".."), out[0].path);
  assert.ok(out[0].path.startsWith("gmail-threads/"), out[0].path);
});

test("normalise allocates globally unique paths, including pre-suffixed names", () => {
  const out = A.normalise(
    [
      { name: "invoice.pdf", href: att("1") },
      { name: "invoice (2).pdf", href: att("2") },
      { name: "invoice.pdf", href: att("3") },
    ],
    "Subject",
    CONTEXT
  );
  const targets = out.map((item) => item.targetName);
  assert.deepStrictEqual(targets, ["invoice.pdf", "invoice (2).pdf", "invoice (3).pdf"]);
  assert.strictEqual(new Set(out.map((item) => item.path)).size, 3);
});

test("normalise prefers download_url metadata and falls back to a safe href", () => {
  const out = A.normalise(
    [
      {
        name: "chip label",
        downloadUrl: "image/png:real name.png:https://evil.example/file",
        href: att("1"),
      },
    ],
    "Subject",
    CONTEXT
  );
  assert.strictEqual(out[0].name, "real name.png");
  assert.strictEqual(out[0].type, "image/png");
  assert.match(out[0].url, /^https:\/\/mail\.google\.com\/mail\/u\/0\//);
  assert.strictEqual(out[0].rejectedUrl, false);
});

test("normalise rejects an off-origin attachment-looking URL", () => {
  const [out] = A.normalise(
    [{ name: "trap.txt", href: "https://evil.example/?view=att&th=THREAD_REAL&attid=1" }],
    "Subject",
    CONTEXT
  );
  assert.strictEqual(out.url, null);
  assert.strictEqual(out.rejectedUrl, true);
});

test("normalise de-duplicates the same verified Gmail capability", () => {
  const out = A.normalise(
    [
      { name: "a.pdf", href: att("1"), messageN: null },
      { name: "duplicate label.pdf", href: att("1"), messageN: 2 },
    ],
    "Subject",
    CONTEXT
  );
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].messageN, 2);
});

test("save mode both inlines text and starts its download", async (t) => {
  const url = `https://mail.google.com${att("csv")}`;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    const response = new Response("quarter,revenue\nQ3,1200000\n", {
      status: 200,
      headers: { "content-type": "text/csv; charset=utf-8" },
    });
    Object.defineProperty(response, "url", { value: url });
    return response;
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const calls = [];
  const result = await A.collect(
    [{ name: "figures.csv", href: att("csv"), messageN: 2 }],
    "Subject",
    "save",
    async (downloadUrl, path) => {
      calls.push({ downloadUrl, path });
      return { ok: true, path, status: "download started" };
    },
    CONTEXT
  );

  assert.strictEqual(calls.length, 1);
  assert.match(result.items[0].content, /quarter,revenue/);
  assert.strictEqual(result.items[0].status, "download started");
  assert.strictEqual(result.summary.inlined, 1);
  assert.strictEqual(result.summary.downloadStarted, 1);
});

test("save mode reports a failed start and skips a declared oversized file", async () => {
  let calls = 0;
  const result = await A.collect(
    [
      { name: "small.pdf", href: att("1"), size: "1 MB" },
      { name: "large.pdf", href: att("2"), size: "26 MB" },
    ],
    "Subject",
    "save",
    async () => {
      calls++;
      return { ok: false, error: "download failed to start" };
    },
    CONTEXT
  );
  assert.strictEqual(calls, 1);
  assert.strictEqual(result.summary.downloadFailed, 1);
  assert.strictEqual(result.summary.skipped, 1);
  assert.match(result.items[1].status, /exceeds 25\.0 MB/);
});

test("copy mode reports a text attachment that could not be read", async (t) => {
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  global.fetch = async () => {
    throw new Error("network unavailable");
  };
  console.warn = () => {};
  t.after(() => {
    global.fetch = originalFetch;
    console.warn = originalWarn;
  });

  const result = await A.collect(
    [{ name: "notes.txt", href: att("notes") }],
    "Subject",
    "copy",
    async () => ({ ok: true }),
    CONTEXT
  );
  assert.strictEqual(result.summary.inlineFailed, 1);
  assert.strictEqual(result.items[0].status, "could not be read");
});

test("an exactly 100 KB text attachment is not marked truncated", async (t) => {
  const url = `https://mail.google.com${att("exact")}`;
  const bytes = new Uint8Array(A.MAX_INLINE_BYTES).fill(65);
  const originalFetch = global.fetch;
  global.fetch = async () => {
    const response = new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "text/plain",
        "content-length": String(bytes.length),
      },
    });
    Object.defineProperty(response, "url", { value: url });
    return response;
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const result = await A.fetchInline(url, A.MAX_INLINE_BYTES, CONTEXT);
  assert.strictEqual(result.truncated, false);
  assert.strictEqual(result.bytes, A.MAX_INLINE_BYTES);
});

test("targetPath stays inside the extension folder", () => {
  const p = A.targetPath("../escape", "../../x.sh");
  assert.ok(p.startsWith("gmail-threads/"), p);
  assert.ok(!p.includes(".."), p);
});

// Gmail percent-encodes the filename inside download_url. Leaving it encoded
// made a chip name sanitize to "Claim_20form.pdf" while the print-view entry
// stayed "Claim form.pdf", so the merge could not pair them and reported one
// file twice.
test("decodes a percent-encoded filename in a download_url value", () => {
  const got = A.parseDownloadUrl(
    "application/pdf:Quarterly%20Report%20-%20Q3.pdf:" +
      "/mail/u/0/?view=att&th=THREAD_REAL&attid=0.1"
  );
  assert.strictEqual(got.name, "Quarterly Report - Q3.pdf");
});

test("keeps a filename whose percent sign is not an escape", () => {
  const got = A.parseDownloadUrl(
    "application/pdf:100%discount.pdf:/mail/u/0/?view=att&th=THREAD_REAL&attid=0.1"
  );
  assert.strictEqual(got.name, "100%discount.pdf");
});

test("a decoded chip name merges with its print-view entry instead of doubling", () => {
  const printView = [
    { name: "Claim form.pdf", url: null, messageN: 1, source: "print-view" },
  ];
  const live = [
    {
      name: A.parseDownloadUrl(
        "application/pdf:Claim%20form.pdf:https://mail-attachment.example/x"
      ).name,
      messageN: null,
      source: "live-page",
    },
  ];
  const merged = A.mergeRaw(printView, live, CONTEXT);
  assert.strictEqual(merged.items.length, 1);
  assert.strictEqual(merged.supplementalOnly, 0);
});

// Merging the chip into the print-view entry fixes the count, but the entry it
// keeps has no URL of its own. Without carrying the chip's refused URL across,
// the merged attachment would claim no link was ever found — understating a
// link that was on the page and was refused.
test("a merged entry still reports a refused chip link rather than no link", () => {
  const printView = [
    { name: "Claim form.pdf", url: null, messageN: 1, source: "print-view" },
  ];
  const live = [
    {
      name: "Claim form.pdf",
      href:
        "https://mail-attachment.googleusercontent.com/attachment/u/0/" +
        "?view=att&th=THREAD_REAL&attid=0.1",
      messageN: null,
      source: "live-page",
    },
  ];
  const merged = A.mergeRaw(printView, live, CONTEXT);
  assert.strictEqual(merged.items.length, 1);

  const normalised = A.normalise(merged.items, "Subject", CONTEXT);
  assert.strictEqual(normalised.length, 1);
  assert.strictEqual(normalised[0].url, null);
  assert.strictEqual(normalised[0].rejectedUrl, true);
  assert.strictEqual(normalised[0].messageN, 1);
});
