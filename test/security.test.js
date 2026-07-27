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
    "/mail/u/0/?view=att&th=OTHER&attid=0.1",
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
    ["other thread", { ...GOOD_MSG, url: "/mail/u/0/?view=att&th=OTHER&attid=0.1" }],
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
