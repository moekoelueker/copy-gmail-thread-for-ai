const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const run = promisify(execFile);
const ROOT = path.join(__dirname, "..", "..");

test("fixture redactor executes no capture code and removes URL capabilities", async (t) => {
  let requests = 0;
  const server = http.createServer((_request, response) => {
    requests++;
    response.writeHead(200).end("unexpected");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ctgfa-redactor-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, "raw.html");
  const output = path.join(directory, "real-capture.html");
  const port = server.address().port;

  fs.writeFileSync(
    input,
    `<!doctype html>
    <html><head>
      <title>Gmail - Secret Client Thread</title>
      <script>fetch("http://127.0.0.1:${port}/script-leak")</script>
      <style>body{background:url("http://127.0.0.1:${port}/style-leak")}</style>
    </head><body onload="fetch('http://127.0.0.1:${port}/event-leak')">
      <!-- Secret Client comment -->
      <img src="http://127.0.0.1:${port}/image-leak" alt="Secret Client">
      <a href="/private/path?token=SecretToken">Secret Link</a>
      <table class="message"><tr>
        <td><b>Secret Sender</b> sender@private.example</td><td>Jul 7, 2026</td>
      </tr><tr><td>to: Recipient &lt;recipient@private.example&gt;</td></tr>
      <tr><td>
        <div>Call +1 415 555 0137, SSN 123-45-6789, account 000123456789.</div>
        <div>IBAN DE89370400440532013000, record 88213377, born 1974-03-02.</div>
        <div>\u4f60\u597d\uff0c\u8fd9\u662f\u673a\u5bc6\u7684\u5546\u4e1a\u8ba1\u5212\u4e66\u3002</div>
        <div>\u041f\u0440\u0438\u0432\u0435\u0442, \u044d\u0442\u043e \u043a\u043e\u043d\u0444\u0438\u0434\u0435\u043d\u0446\u0438\u0430\u043b\u044c\u043d\u044b\u0439 \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442.</div>
        <a href="/mail/u/7/?view=att&amp;th=SECRET_THREAD&amp;attid=secret-id">
          <b>private-plan.pdf</b>
        </a>
        <div download_url="text/plain:secret.txt:https://mail.google.com/mail/u/7/?view=att&amp;th=SECRET_THREAD&amp;attid=second-secret"></div>
        <template><script>fetch("http://127.0.0.1:${port}/template-leak")</script></template>
        <svg><image href="http://127.0.0.1:${port}/svg-leak"></image></svg>
      </td></tr></table>
    </body></html>`,
    "utf8"
  );

  await run(process.execPath, [path.join(ROOT, "tools", "redact-fixture.js"), input, output], {
    cwd: ROOT,
    timeout: 20_000,
  });

  const html = fs.readFileSync(output, "utf8");
  const expected = JSON.parse(
    fs.readFileSync(output.replace(/\.html$/, ".expected.json"), "utf8")
  );

  assert.strictEqual(requests, 0, "captured HTML reached the network");
  assert.doesNotMatch(html, /Secret|private\.example|127\.0\.0\.1|\/private\/path/i);
  assert.doesNotMatch(html, /<(?:script|style|template)\b|\bonload=|javascript:/i);
  assert.match(
    html,
    /href="\/mail\/u\/0\/\?view=att&amp;th=THREAD_REAL&amp;attid=redacted-\d+&amp;disp=safe"/
  );
  assert.match(html, /download_url="text\/plain:document-\d+\.txt:\/mail\/u\/0\//);
  assert.strictEqual(expected.kind, "redacted-live-gmail-print-view");
  assert.strictEqual(expected.manuallyReviewed, false);
  assert.strictEqual(expected.messageCount, 1);

  // Redaction used to cover Latin-script prose only, so every digit and every
  // non-Latin sentence reached the committed fixture untouched.
  for (const leak of [
    "415 555 0137",
    "123-45-6789",
    "000123456789",
    "370400440532013000",
    "88213377",
    "1974-03-02",
    "\u673a\u5bc6",
    "\u043a\u043e\u043d\u0444\u0438\u0434\u0435\u043d\u0446\u0438\u0430\u043b\u044c\u043d\u044b\u0439",
  ]) {
    assert.ok(!html.includes(leak), `redaction leaked ${leak}`);
  }
  // Dates and short quantities stay readable so the capture is still parseable.
  assert.match(html, /Jul 7, 2026/);
});
