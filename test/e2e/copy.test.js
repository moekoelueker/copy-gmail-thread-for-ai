// End-to-end tests: the real extension, in a real Chrome, against a stand-in
// Gmail served at the real origin. See harness.js for how and why.

const test = require("node:test");
const assert = require("node:assert");
const { start, fixture } = require("./harness");

let H;

test.before(async () => {
  H = await start();
});

test.after(async () => {
  if (H) await H.stop();
});

test.beforeEach(() => {
  H.state.page = fixture("gmail-thread.html");
  H.state.printView = fixture("printview-negotiation.html");
  H.state.printViewStatus = 200;
});

test("injects its button into an open thread", async () => {
  await H.openThread();
  const label = await H.page.textContent(".ctl-btn");
  assert.strictEqual(label.trim(), "Copy Email Thread");
});

test("requests the open thread, not an inbox list row", async () => {
  // The regression that shipped: an unscoped [data-legacy-thread-id] lookup
  // matched a decoy list row and copied an unrelated conversation.
  await H.openThread();
  await H.copyViaButton();
  const printReq = H.state.requests.find((u) => u.includes("view=pt"));
  assert.ok(printReq, "no print view request was made");
  assert.ok(printReq.includes("th=THREAD_REAL"), printReq);
  assert.ok(!printReq.includes("DECOY"), printReq);
});

test("copies the whole thread as a well-formed document", async () => {
  await H.openThread();
  const out = await H.copyViaButton();
  assert.ok(out.startsWith("<email_thread>"), out.slice(0, 80));
  assert.ok(out.trimEnd().endsWith("</email_thread>"));
  assert.ok(out.includes("<messages>3</messages>"), "expected all three messages");
  assert.ok(out.includes("<complete>true</complete>"));
});

test("carries sender, both timestamps and recipients", async () => {
  await H.openThread();
  const out = await H.copyViaButton();
  assert.ok(out.includes('from="Jennifer"'), "sender missing");
  assert.ok(out.includes('email="jennifer@globeinflu.com"'), "sender address missing or mangled");
  assert.ok(/local="Sun, Jun 14, 2026 at 7:51 AM"/.test(out), "local timestamp missing");
  assert.ok(/date="2026-06-14T\d\d:51/.test(out), "ISO timestamp missing");
  assert.ok(out.includes("Moe Lueker (moelueker@gmail.com)"), "recipient missing");
  assert.ok(out.includes("legal@zenalabs.com"), "cc missing");
});

test("no metadata element leaks a raw angle bracket", async () => {
  await H.openThread();
  const out = await H.copyViaButton();
  for (const tag of ["subject", "to", "cc", "participants"]) {
    for (const m of out.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))) {
      assert.ok(!/[<>]/.test(m[1]), `${tag} contained markup: ${m[1]}`);
    }
  }
});

test("extracts attachments onto the message that carried them", async () => {
  await H.openThread();
  const out = await H.copyViaButton();
  assert.ok(out.includes("<attachment_count>2</attachment_count>"), "count wrong or missing");
  assert.ok(out.includes('name="MiniMax_Signed.pdf"'), "attachment missing");
  assert.ok(out.includes('size="153K"'), "attachment size missing");
  // Both belong to message 2; neither may drift onto another message.
  const m2 = out.split(/<message /)[2] || "";
  assert.ok(m2.includes("MiniMax_Signed.pdf"), "attachment attributed to the wrong message");
  // The markup must not also survive as a leftover table in the body.
  assert.ok(!out.includes("pdf.gif"), "Gmail icon leaked into the body");
});

test("strips quoted chains, signatures and tracking pixels", async () => {
  await H.openThread();
  const out = await H.copyViaButton();
  assert.ok(!out.includes("On Sun, Jun 14, 2026 Jennifer wrote:"), "quote chain survived");
  assert.ok(!out.includes("发件人"), "Chinese quote header survived");
  assert.ok(!out.includes("email_open_log_pic"), "tracking pixel survived");
  assert.ok(!out.includes("Business Development"), "signature survived");
});

test("preserves links, tables and unwraps Google's redirect", async () => {
  await H.openThread();
  const out = await H.copyViaButton();
  assert.ok(out.includes("[the brief](https://example.com/brief)"), "link lost or not unwrapped");
  assert.ok(out.includes("| Deliverable | Fee |"), "table flattened");
  assert.ok(out.includes("| YouTube video | $3,500 |"), "table row lost");
});

test("refuses when Gmail returns a different conversation", async () => {
  await H.openThread();
  H.state.printView = fixture("printview-other-thread.html");
  const out = await H.copyViaButton();
  assert.ok(!out.includes("Instagram"), "handed over the wrong conversation");
  assert.strictEqual(out, "__NOT_COPIED__", "clipboard should be untouched");
  assert.match(await H.toastText(), /different conversation/i);
});

test("falls back visibly when the print view fails", async () => {
  await H.openThread();
  H.state.printViewStatus = 500;
  const out = await H.copyViaButton();
  assert.ok(out.includes("<complete>false</complete>"), "partial capture not declared");
  assert.ok(/<note>[^<]*collapsed/i.test(out), "no warning note in the output");
  assert.match(await H.toastText(), /collapsed messages may be missing/i);
});

test("the service worker command path copies too", async () => {
  await H.openThread();
  const out = await H.copyViaCommand("copy");
  assert.ok(out.startsWith("<email_thread>"), out.slice(0, 80));
});

test("plain copy inlines text attachments but saves nothing", async () => {
  await H.openThread();
  const out = await H.copyViaButton();
  // A .csv is small and readable, so its contents belong in the paste.
  assert.ok(out.includes("quarter,revenue"), "text attachment was not inlined");
  // A PDF is not parsed, and a plain copy must never touch the disk.
  assert.match(out, /name="MiniMax_Signed\.pdf"[^>]*status="not saved/, out.slice(0, 400));
  assert.ok(out.includes('type="application/pdf"'), "MIME type not inferred from the filename");
});

test("save mode processes attachments instead of listing them", async () => {
  await H.openThread();
  const out = await H.copyViaCommand("save");
  const pdf = (out.match(/<attachment name="MiniMax_Signed\.pdf"[^>]*>/) || [""])[0];
  assert.ok(pdf, "attachment missing in save mode");
  // Whether the download succeeds in a sandboxed browser is beside the point;
  // what matters is that the save branch ran rather than the copy-only branch.
  assert.ok(
    !pdf.includes("not saved"),
    `save mode still reported the copy-only status: ${pdf}`
  );
});
