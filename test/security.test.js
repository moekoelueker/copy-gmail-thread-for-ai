const test = require("node:test");
const assert = require("node:assert");
const { security: S } = require("./loader");

const CONTEXT = { threadId: "THREAD_REAL", accountIndex: "0" };

test("thread identifiers accept Gmail shapes but reject delimiters and controls", () => {
  assert.ok(S.validThreadId("thread-f:1234567890"));
  assert.ok(S.validThreadId("FMfcgzQZS_ab-c.1"));
  for (const value of ["abc", "THREAD/OTHER", "THREAD&th=OTHER", "THREAD\u0000OTHER"]) {
    assert.strictEqual(S.validThreadId(value), false, JSON.stringify(value));
  }
});

test("accepts only an exact Gmail attachment URL for the active account and thread", () => {
  const relative = "/mail/u/0/?view=att&th=THREAD_REAL&attid=0.1&disp=safe";
  assert.strictEqual(
    S.resolveAttachmentUrl(relative, CONTEXT),
    `https://mail.google.com${relative}`
  );

  for (const value of [
    "https://evil.example/?view=att&th=THREAD_REAL&attid=0.1",
    "https://mail.google.com.evil.example/mail/u/0/?view=att&th=THREAD_REAL&attid=0.1",
    "http://mail.google.com/mail/u/0/?view=att&th=THREAD_REAL&attid=0.1",
    "/mail/u/1/?view=att&th=THREAD_REAL&attid=0.1",
    "/mail/u/0/?view=att&th=abc&attid=0.1",
    "/mail/u/0/other?view=att&th=THREAD_REAL&attid=0.1",
    "/mail/u/0/?view=att&th=THREAD_REAL",
    "/mail/u/0/?view=att&th=THREAD_REAL&permmsgid=msg-f:123",
    "/mail/u/0/?view=att&view=att&th=THREAD_REAL&attid=0.1",
    "/mail/u/0/?view=att&th=THREAD_REAL&th=OTHER&attid=0.1",
    "/mail/u/0/?view=att&th=THREAD_REAL&attid=0.1&attid=0.2",
    "/mail/u/0/?view=att&th=THREAD_REAL&attid=0.1#fragment",
  ]) {
    assert.strictEqual(S.resolveAttachmentUrl(value, CONTEXT), null, value);
  }
});

test("download paths are relative, scoped and portable", () => {
  assert.ok(S.safeDownloadPath("gmail-threads/q3/invoice.pdf"));
  for (const value of [
    "",
    "/gmail-threads/q3/invoice.pdf",
    "C:\\gmail-threads\\q3\\invoice.pdf",
    "gmail-threads/../invoice.pdf",
    "other/q3/invoice.pdf",
    "gmail-threads/q3",
    "gmail-threads/q3/invoice\n.pdf",
    "gmail-threads/con/invoice.pdf",
    "gmail-threads/q3/NUL.txt",
    "gmail-threads/q3/CON .txt",
    "gmail-threads/q3/invoice.",
  ]) {
    assert.strictEqual(S.safeDownloadPath(value), false, value);
  }
});

test("reports Chrome-resolved download paths on macOS and Windows", () => {
  const requested = "gmail-threads/q3/invoice.pdf";
  assert.strictEqual(
    S.reportedDownloadPath("/Users/me/Downloads/gmail-threads/q3/invoice (1).pdf", requested),
    "gmail-threads/q3/invoice (1).pdf"
  );
  assert.strictEqual(
    S.reportedDownloadPath(
      "C:\\Users\\me\\Downloads\\gmail-threads\\q3\\invoice (1).pdf",
      requested
    ),
    "gmail-threads/q3/invoice (1).pdf"
  );
  assert.strictEqual(
    S.reportedDownloadPath("/tmp/playwright-internal-uuid", requested),
    requested
  );
});

// The service worker is the last privileged boundary. These forge the sender
// object directly, because a content script cannot be made to send a hostile
// message without weakening the shipping code.
const RUNTIME_ID = "abcdefghijklmnopabcdefghijklmnop";
const GOOD_MSG = {
  type: "download",
  url: "/mail/u/0/?view=att&th=THREAD_REAL&attid=0.1&disp=safe",
  path: "gmail-threads/q3/invoice.pdf",
  threadId: "THREAD_REAL",
};
const GOOD_SENDER = {
  id: RUNTIME_ID,
  frameId: 0,
  tab: { url: "https://mail.google.com/mail/u/0/#all/THREAD_REAL" },
};

test("the download boundary authorizes only the extension's own Gmail top frame", () => {
  const allowed = S.authorizeDownload(GOOD_MSG, GOOD_SENDER, RUNTIME_ID);
  assert.strictEqual(allowed.ok, true);
  assert.strictEqual(
    allowed.url,
    "https://mail.google.com/mail/u/0/?view=att&th=THREAD_REAL&attid=0.1&disp=safe"
  );
  assert.strictEqual(allowed.path, "gmail-threads/q3/invoice.pdf");

  const rejected = [
    ["another extension", GOOD_MSG, { ...GOOD_SENDER, id: "x".repeat(32) }],
    ["no sender id", GOOD_MSG, { ...GOOD_SENDER, id: undefined }],
    ["a subframe", GOOD_MSG, { ...GOOD_SENDER, frameId: 1 }],
    ["an extension page with no tab", GOOD_MSG, { id: RUNTIME_ID, frameId: 0 }],
    ["a non-Gmail tab", GOOD_MSG, { ...GOOD_SENDER, tab: { url: "https://evil.example/" } }],
    [
      "a lookalike host tab",
      GOOD_MSG,
      { ...GOOD_SENDER, tab: { url: "https://mail.google.com.evil.example/mail/u/0/" } },
    ],
    ["an http Gmail tab", GOOD_MSG, { ...GOOD_SENDER, tab: { url: "http://mail.google.com/mail/u/0/" } }],
    ["a chrome-extension page", GOOD_MSG, { ...GOOD_SENDER, tab: { url: `chrome-extension://${RUNTIME_ID}/popup.html` } }],
  ];
  for (const [label, msg, sender] of rejected) {
    const result = S.authorizeDownload(msg, sender, RUNTIME_ID);
    assert.strictEqual(result.ok, false, label);
    assert.strictEqual(result.error, "download request rejected", label);
  }

  assert.strictEqual(S.authorizeDownload(GOOD_MSG, GOOD_SENDER, undefined).ok, false);
  assert.strictEqual(S.authorizeDownload({ type: "ping" }, GOOD_SENDER, RUNTIME_ID).ok, false);
  assert.strictEqual(S.authorizeDownload(null, GOOD_SENDER, RUNTIME_ID).ok, false);
});

test("the download boundary re-derives the account from the tab, not the message", () => {
  // The content script may have validated this URL while the tab was on /u/0/.
  // Once the tab is on another account the capability is no longer authorized,
  // and the worker must decide that for itself.
  const movedTab = {
    ...GOOD_SENDER,
    tab: { url: "https://mail.google.com/mail/u/1/#all/THREAD_REAL" },
  };
  const result = S.authorizeDownload(GOOD_MSG, movedTab, RUNTIME_ID);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, "unsafe download request rejected");
});

test("the download boundary ignores an account claimed by the message", () => {
  // Only sender.tab decides which account a capability belongs to. A message
  // field must never be able to widen that, however the caller labels it.
  for (const extra of [
    { accountIndex: "1" },
    { accountIndex: 1 },
    { tab: { url: "https://mail.google.com/mail/u/1/" } },
    { sender: { id: RUNTIME_ID, frameId: 0, tab: { url: "https://mail.google.com/mail/u/1/" } } },
  ]) {
    const result = S.authorizeDownload(
      { ...GOOD_MSG, ...extra, url: "/mail/u/1/?view=att&th=THREAD_REAL&attid=0.1&disp=safe" },
      GOOD_SENDER,
      RUNTIME_ID
    );
    assert.strictEqual(result.ok, false, JSON.stringify(extra));
    assert.strictEqual(result.error, "unsafe download request rejected");
  }

  // And the tab's own account still authorizes normally.
  assert.strictEqual(S.authorizeDownload({ ...GOOD_MSG, accountIndex: "9" }, GOOD_SENDER, RUNTIME_ID).ok, true);
});

test("the download boundary rejects unsafe URLs and paths independently", () => {
  const bad = [
    ["off-origin url", { ...GOOD_MSG, url: "https://evil.example/?view=att&th=THREAD_REAL&attid=0.1" }],
    ["malformed th", { ...GOOD_MSG, url: "/mail/u/0/?view=att&th=a&attid=0.1" }],
    ["thread id not in message", { ...GOOD_MSG, threadId: undefined }],
    ["credentials in url", { ...GOOD_MSG, url: "https://u:p@mail.google.com/mail/u/0/?view=att&th=THREAD_REAL&attid=0.1" }],
    ["duplicate th", { ...GOOD_MSG, url: "/mail/u/0/?view=att&th=THREAD_REAL&th=OTHER&attid=0.1" }],
    ["traversal path", { ...GOOD_MSG, path: "gmail-threads/../../evil.sh" }],
    ["absolute path", { ...GOOD_MSG, path: "/etc/cron.d/evil" }],
    ["windows device path", { ...GOOD_MSG, path: "gmail-threads/q3/COM1.pdf" }],
    ["backslash path", { ...GOOD_MSG, path: "gmail-threads\\q3\\..\\evil.pdf" }],
    ["escaping the download root", { ...GOOD_MSG, path: "other/q3/invoice.pdf" }],
    ["missing path", { ...GOOD_MSG, path: "" }],
  ];
  for (const [label, msg] of bad) {
    const result = S.authorizeDownload(msg, GOOD_SENDER, RUNTIME_ID);
    assert.strictEqual(result.ok, false, label);
    assert.strictEqual(result.error, "unsafe download request rejected", label);
  }
});

test("attachment capability keys ignore session and rendering parameters", () => {
  // Same file, as the print view and as a live attachment chip render it.
  const printView = "/mail/u/0/?view=att&th=T&attid=0.1&permmsgid=msg-f:9&disp=safe";
  const liveChip =
    "/mail/u/0/?ui=2&ik=abc123&attid=0.1&permmsgid=msg-f:9&th=T&view=att&disp=safe&zw";
  assert.strictEqual(
    S.attachmentCapabilityKey(printView),
    S.attachmentCapabilityKey(liveChip)
  );

  // realattid is unique per attachment and wins when present.
  assert.strictEqual(
    S.attachmentCapabilityKey("/mail/u/0/?view=att&th=T&attid=0.1&realattid=f_abc"),
    S.attachmentCapabilityKey("/mail/u/0/?ui=2&ik=z&view=att&th=T&attid=0.2&realattid=f_abc")
  );

  // The same attid in two different messages is not the same attachment.
  assert.notStrictEqual(
    S.attachmentCapabilityKey("/mail/u/0/?view=att&th=T&attid=0.1&permmsgid=msg-f:1"),
    S.attachmentCapabilityKey("/mail/u/0/?view=att&th=T&attid=0.1&permmsgid=msg-f:2")
  );

  assert.strictEqual(S.attachmentCapabilityKey("/mail/u/0/?view=att&th=T"), null);
  assert.strictEqual(S.attachmentCapabilityKey("::::"), null);
});

test("extracts the Gmail account index without accepting another origin", () => {
  assert.strictEqual(S.accountIndexFromUrl("https://mail.google.com/mail/u/12/#inbox"), "12");
  assert.strictEqual(S.accountIndexFromUrl("https://mail.google.com/mail/#inbox"), "0");
  assert.strictEqual(S.accountIndexFromUrl("https://mail.google.com/not-mail/u/0/"), null);
  assert.strictEqual(S.accountIndexFromUrl("https://evil.example/mail/u/0/"), null);
  // Delegated mailboxes use /mail/b/<address>/ and are deliberately
  // unsupported; they must fail closed rather than map onto account 0.
  assert.strictEqual(
    S.accountIndexFromUrl("https://mail.google.com/mail/b/team@example.com/#all/x"),
    null
  );
});

// Gmail's print view is served from /mail/u/<n>/ and emits attachment hrefs
// relative to it. Resolving those against the bare origin produced pathname
// "/" and the account check then refused a legitimate attachment link — the
// whole reason a real thread could not download its four PDFs.
test("resolves a print-view attachment link written relative to the account path", () => {
  assert.strictEqual(
    S.resolveAttachmentUrl("?view=att&th=THREAD_REAL&attid=0.7&disp=safe", CONTEXT),
    "https://mail.google.com/mail/u/0/?view=att&th=THREAD_REAL&attid=0.7&disp=safe"
  );
});

test("resolving against the account path admits no other location", () => {
  for (const value of [
    "../1/?view=att&th=THREAD_REAL&attid=0.1",
    "other?view=att&th=THREAD_REAL&attid=0.1",
    "/?view=att&th=THREAD_REAL&attid=0.1",
    "//evil.example/?view=att&th=THREAD_REAL&attid=0.1",
  ]) {
    assert.strictEqual(S.resolveAttachmentUrl(value, CONTEXT), null, value);
  }
});

// ---------- thread document boundary ----------

const GOOD_DOC = {
  type: "download-thread",
  text: '<email_thread format_version="4"></email_thread>',
  path: "gmail-threads/q3-b250daf4/thread.xml",
};

test("the thread document boundary authorizes only the extension's own Gmail top frame", () => {
  const allowed = S.authorizeThreadDocument(GOOD_DOC, GOOD_SENDER, RUNTIME_ID);
  assert.strictEqual(allowed.ok, true);
  assert.strictEqual(allowed.path, GOOD_DOC.path);
  assert.strictEqual(allowed.text, GOOD_DOC.text);

  for (const sender of [
    null,
    { ...GOOD_SENDER, id: "otheridotheridotheridotheridothe" },
    { ...GOOD_SENDER, frameId: 1 },
    { ...GOOD_SENDER, tab: { url: "https://evil.example/" } },
    { ...GOOD_SENDER, tab: { url: "https://mail.google.com.evil.example/mail/u/0/" } },
    { ...GOOD_SENDER, tab: undefined },
  ]) {
    const result = S.authorizeThreadDocument(GOOD_DOC, sender, RUNTIME_ID);
    assert.strictEqual(result.ok, false, JSON.stringify(sender));
    assert.strictEqual(result.error, "thread document request rejected");
  }
});

test("a thread document request carries no URL the caller can name", () => {
  // The whole safety of this path is that the worker builds the source itself.
  // Anything URL-shaped in the message must be inert: authorization returns
  // text and a path, never a URL, however the caller labels its fields.
  const decision = S.authorizeThreadDocument(
    { ...GOOD_DOC, url: "https://evil.example/payload", downloadUrl: "file:///etc/passwd" },
    GOOD_SENDER,
    RUNTIME_ID
  );
  assert.strictEqual(decision.ok, true);
  assert.strictEqual(decision.url, undefined);
  assert.deepStrictEqual(Object.keys(decision).sort(), ["ok", "path", "text"]);
});

test("the thread document boundary pins the basename", () => {
  // safeDownloadPath alone would admit any safe name under the download root,
  // which would let a compromised content script scatter files through a
  // user's saved threads. One known name per folder is the whole capability.
  for (const path of [
    "gmail-threads/q3-b250daf4/notes.xml",
    "gmail-threads/q3-b250daf4/thread.html",
    "gmail-threads/q3-b250daf4/thread.xml.exe",
    "gmail-threads/q3-b250daf4/Thread.xml",
    "gmail-threads/thread.xml",
    "elsewhere/q3-b250daf4/thread.xml",
    "/gmail-threads/q3-b250daf4/thread.xml",
    "gmail-threads/../thread.xml",
    "C:/gmail-threads/q3/thread.xml",
  ]) {
    const result = S.authorizeThreadDocument({ ...GOOD_DOC, path }, GOOD_SENDER, RUNTIME_ID);
    assert.strictEqual(result.ok, false, path);
    assert.strictEqual(result.error, "unsafe thread document request rejected");
  }
});

test("the thread document boundary rejects a wrong type, empty text, and oversized text", () => {
  assert.strictEqual(
    S.authorizeThreadDocument({ ...GOOD_DOC, type: "download" }, GOOD_SENDER, RUNTIME_ID).error,
    "thread document request rejected"
  );

  for (const text of ["", null, undefined, 42, {}, ["x"]]) {
    const result = S.authorizeThreadDocument({ ...GOOD_DOC, text }, GOOD_SENDER, RUNTIME_ID);
    assert.strictEqual(result.ok, false, JSON.stringify(text));
    assert.strictEqual(result.error, "unsafe thread document request rejected");
  }

  const justUnder = "a".repeat(S.MAX_THREAD_DOCUMENT_BYTES);
  assert.strictEqual(
    S.authorizeThreadDocument({ ...GOOD_DOC, text: justUnder }, GOOD_SENDER, RUNTIME_ID).ok,
    true
  );
  assert.strictEqual(
    S.authorizeThreadDocument({ ...GOOD_DOC, text: justUnder + "a" }, GOOD_SENDER, RUNTIME_ID).ok,
    false
  );
});

test("the thread document size cap counts UTF-8 bytes, not code units", () => {
  // A string of astral characters is four bytes per code point and two code
  // units per code point, so a length-based cap would admit twice the payload
  // it believed it was admitting.
  const astral = "\u{1F600}".repeat(S.MAX_THREAD_DOCUMENT_BYTES / 4 + 1);
  assert.ok(astral.length < S.MAX_THREAD_DOCUMENT_BYTES);
  assert.strictEqual(
    S.authorizeThreadDocument({ ...GOOD_DOC, text: astral }, GOOD_SENDER, RUNTIME_ID).ok,
    false
  );
});

test("neither download boundary answers for the other's message type", () => {
  assert.strictEqual(S.authorizeDownload(GOOD_DOC, GOOD_SENDER, RUNTIME_ID).ok, false);
  assert.strictEqual(S.authorizeThreadDocument(GOOD_MSG, GOOD_SENDER, RUNTIME_ID).ok, false);
});

// ---------- message-scoped attachment links ----------

test("an attachment on a later message resolves, because th names the message", () => {
  // A Gmail thread id is its first message's id, so "th" equals the thread id
  // only for message 1. Demanding equality refused every attachment after the
  // first, which meant save mode saved nothing on any thread with a reply.
  const later = "19f3647466b19bfb";
  assert.strictEqual(
    S.resolveAttachmentUrl(`/mail/u/0/?view=att&th=${later}&attid=0.1&disp=safe`, {
      threadId: "19ec69dc5c88b132",
      accountIndex: "0",
    }),
    `https://mail.google.com/mail/u/0/?view=att&th=${later}&attid=0.1&disp=safe`
  );
});

test("a message-scoped th still has to look like a Gmail identifier", () => {
  for (const th of ["a", "", "THREAD/OTHER", "THREAD OTHER", "x".repeat(257)]) {
    assert.strictEqual(
      S.resolveAttachmentUrl(`/mail/u/0/?view=att&th=${encodeURIComponent(th)}&attid=0.1`, CONTEXT),
      null,
      JSON.stringify(th)
    );
  }
});

test("relaxing the thread check did not relax anything else", () => {
  const later = "19f3647466b19bfb";
  for (const value of [
    `https://evil.example/mail/u/0/?view=att&th=${later}&attid=0.1`,
    `http://mail.google.com/mail/u/0/?view=att&th=${later}&attid=0.1`,
    `/mail/u/1/?view=att&th=${later}&attid=0.1`,
    `/mail/u/0/other?view=att&th=${later}&attid=0.1`,
    `/mail/u/0/?view=pt&th=${later}&attid=0.1`,
    `/mail/u/0/?view=att&th=${later}`,
    `/mail/u/0/?view=att&th=${later}&th=OTHER&attid=0.1`,
    `/mail/u/0/?view=att&th=${later}&attid=0.1#frag`,
  ]) {
    assert.strictEqual(S.resolveAttachmentUrl(value, CONTEXT), null, value);
  }
});

test("exactThread restores the strict comparison for a caller that wants it", () => {
  const strict = { ...CONTEXT, exactThread: true };
  assert.ok(S.resolveAttachmentUrl("/mail/u/0/?view=att&th=THREAD_REAL&attid=0.1", strict));
  assert.strictEqual(
    S.resolveAttachmentUrl("/mail/u/0/?view=att&th=19f3647466b19bfb&attid=0.1", strict),
    null
  );
});

test("the account, which is tab-derived, is still the binding that holds", () => {
  // This is what a compromised content script cannot forge, and with the thread
  // comparison relaxed it is the load-bearing check. It must never be
  // satisfiable from the message.
  assert.strictEqual(
    S.authorizeDownload(
      {
        ...GOOD_MSG,
        url: "/mail/u/1/?view=att&th=19f3647466b19bfb&attid=0.1",
        threadId: "19f3647466b19bfb",
        accountIndex: "1",
      },
      GOOD_SENDER,
      RUNTIME_ID
    ).ok,
    false
  );
});
