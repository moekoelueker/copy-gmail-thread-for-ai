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
});
