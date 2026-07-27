// Property tests over captured real threads.
//
// Drop any number of redacted print-view captures into
// test/e2e/fixtures/ named real-*.html and they are all exercised here. The
// assertions are invariants rather than exact content, so one set of rules
// covers every thread: any shape of conversation, any language, any number of
// participants.
//
// Capture with the snippet in docs/fixtures.md, then:
//   npm run redact -- ~/Downloads/printview-<id>.html
//
// Skips cleanly when no captures are present, so the suite stays green on a
// fresh clone.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { start, fixture } = require("./harness");

const FIXTURES = path.join(__dirname, "fixtures");

// The mock page has to claim the same subject as the capture, or the
// wrong-thread guard fires and the interesting assertions never run.
function pageForSubject(subject) {
  return fixture("gmail-thread.html").replace(
    /(<h2 class="hP" data-legacy-thread-id="THREAD_REAL">)[\s\S]*?(<\/h2>)/,
    (_, open, close) => `${open}${subject}${close}`
  );
}

function subjectOf(html) {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/^Gmail\s*-\s*/i, "").trim() : "";
}
const real = fs
  .readdirSync(FIXTURES)
  .filter((f) => /^real-.*\.html$/.test(f))
  .sort();

if (!real.length) {
  test("real-thread fixtures", { skip: "no real-*.html captures in test/e2e/fixtures" }, () => {});
} else {
  let H;
  test.before(async () => {
    H = await start();
  });
  test.after(async () => {
    if (H) await H.stop();
  });

  for (const name of real) {
    test(`invariants hold for ${name}`, async () => {
      const html = fs.readFileSync(path.join(FIXTURES, name), "utf8");
      H.state.printView = html;
      H.state.printViewStatus = 200;
      H.state.page = pageForSubject(subjectOf(html));
      await H.openThread();
      const out = await H.copyViaButton();

      assert.notStrictEqual(
        out,
        "__NOT_COPIED__",
        `nothing was copied. Toast: ${await H.toastText()}`
      );

      // --- structure ---
      assert.ok(out.startsWith("<email_thread>"), "missing opening tag");
      assert.ok(out.trimEnd().endsWith("</email_thread>"), "missing closing tag");
      for (const tag of ["message", "body", "meta"]) {
        const open = (out.match(new RegExp(`<${tag}[ >]`, "g")) || []).length;
        const close = (out.match(new RegExp(`</${tag}>`, "g")) || []).length;
        assert.strictEqual(open, close, `unbalanced <${tag}>: ${open} open, ${close} close`);
      }

      // --- every message is attributed ---
      const heads = out.match(/<message [^>]*>/g) || [];
      assert.ok(heads.length > 0, "no messages parsed");
      for (const h of heads) {
        assert.match(h, /\bfrom="/, `message without a sender: ${h}`);
        assert.match(h, /\bn="\d+"/, `message without an index: ${h}`);
      }

      // --- metadata can never contain markup ---
      for (const tag of ["subject", "to", "cc", "participants"]) {
        for (const m of out.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))) {
          assert.ok(!/[<>]/.test(m[1]), `${tag} contained markup: ${m[1].slice(0, 120)}`);
        }
      }

      // --- no fabricated timestamps ---
      for (const m of out.matchAll(/\bdate="([^"]+)"/g)) {
        assert.match(m[1], /^\d{4}-\d{2}-\d{2}T/, `not an ISO timestamp: ${m[1]}`);
      }

      // --- noise that must never survive ---
      for (const [needle, why] of [
        ["[Quoted text hidden]", "Gmail quote placeholder"],
        ["pdf.gif", "Gmail filetype icon"],
        ["email_open_log_pic", "tracking pixel"],
        ["googleusercontent.com/meips", "unresolved image proxy URL"],
      ]) {
        assert.ok(!out.includes(needle), `${why} survived into the output`);
      }

      // --- a real capture is a complete capture ---
      assert.ok(out.includes("<complete>true</complete>"), "print view path reported incomplete");
    });
  }
}
