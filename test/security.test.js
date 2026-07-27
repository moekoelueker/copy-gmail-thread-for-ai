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

test("extracts the Gmail account index without accepting another origin", () => {
  assert.strictEqual(S.accountIndexFromUrl("https://mail.google.com/mail/u/12/#inbox"), "12");
  assert.strictEqual(S.accountIndexFromUrl("https://mail.google.com/mail/#inbox"), "0");
  assert.strictEqual(S.accountIndexFromUrl("https://mail.google.com/not-mail/u/0/"), null);
  assert.strictEqual(S.accountIndexFromUrl("https://evil.example/mail/u/0/"), null);
});
