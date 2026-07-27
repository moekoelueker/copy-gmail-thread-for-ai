// Invariants over manually reviewed, redacted captures from a live Gmail print
// view. Synthetic fixtures deliberately use a different filename prefix.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { start, fixture } = require("./harness");

const FIXTURES = path.join(__dirname, "fixtures");
const real = fs
  .readdirSync(FIXTURES)
  .filter((name) => /^real-.*\.html$/.test(name))
  .sort();

function subjectOf(html) {
  const match = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (!match) return "";
  const title = match[1].trim();
  return /^Gmail\s*[-–—]\s*/i.test(title)
    ? title.replace(/^Gmail\s*[-–—]\s*/i, "").trim()
    : title.replace(/\s*[-–—]\s*Gmail$/i, "").trim();
}

function pageForSubject(subject) {
  return fixture("gmail-thread.html").replace(
    /(<h2 class="hP" data-legacy-thread-id="THREAD_REAL">)[\s\S]*?(<\/h2>)/,
    (_, open, close) => `${open}${subject}${close}`
  );
}

if (!real.length) {
  test("real-thread fixtures", { skip: "no reviewed real-*.html captures" }, () => {});
} else {
  let H;
  test.before(async () => {
    H = await start();
  });
  test.after(async () => {
    if (H) await H.stop();
  });

  for (const name of real) {
    test(`reviewed live-Gmail invariants hold for ${name}`, async () => {
      const htmlPath = path.join(FIXTURES, name);
      const sidecarPath = htmlPath.replace(/\.html$/i, ".expected.json");
      assert.ok(fs.existsSync(sidecarPath), `missing ground-truth sidecar: ${sidecarPath}`);
      const expected = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
      assert.strictEqual(expected.kind, "redacted-live-gmail-print-view");
      assert.strictEqual(
        expected.manuallyReviewed,
        true,
        "redactor output must be inspected before it counts as real coverage"
      );
      assert.strictEqual(typeof expected.expectedComplete, "boolean");

      const html = fs.readFileSync(htmlPath, "utf8");
      assert.strictEqual(subjectOf(html), expected.subject);
      H.state.printView = html;
      H.state.printViewStatus = 200;
      H.state.page = pageForSubject(expected.subject);
      await H.openThread();
      const out = await H.copyViaButton();
      assert.notStrictEqual(out, "__NOT_COPIED__", await H.toastText());

      const parsed = await H.page.evaluate((xml) => {
        const doc = new DOMParser().parseFromString(xml, "application/xml");
        return {
          errors: doc.querySelectorAll("parsererror").length,
          messages: doc.querySelectorAll("message").length,
          attachments: doc.querySelectorAll("attachment").length,
          complete: doc.querySelector("complete")?.textContent,
          messageHeads: Array.from(doc.querySelectorAll("message")).map((message) => ({
            n: message.getAttribute("n"),
            from: message.getAttribute("from"),
          })),
        };
      }, out);

      assert.strictEqual(parsed.errors, 0, "output is not well-formed XML");
      assert.strictEqual(parsed.messages, expected.messageCount);
      assert.strictEqual(parsed.attachments, expected.attachmentCount);
      assert.strictEqual(parsed.complete, String(expected.expectedComplete));
      for (const message of parsed.messageHeads) {
        assert.match(message.n || "", /^\d+$/);
        assert.ok(message.from, "message has no attributable sender");
      }

      for (const needle of [
        "[Quoted text hidden]",
        "pdf.gif",
        "email_open_log_pic",
        "googleusercontent.com/meips",
      ]) {
        assert.ok(!out.includes(needle), `${needle} survived into output`);
      }
    });
  }
}
