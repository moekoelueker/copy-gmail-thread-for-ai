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
  H.state.printViewDelay = 0;
  H.state.rejectIk = false;
  H.state.expectedThreadId = "THREAD_REAL";
});

test("injects clear copy and save controls into an open thread", async () => {
  await H.openThread();
  const labels = await H.page.locator(".ctl-actions button").allTextContents();
  assert.deepStrictEqual(labels.map((label) => label.trim()), [
    "Copy thread",
    "Copy + save files",
  ]);
});

test("requests the open thread, never an inbox-list decoy", async () => {
  await H.openThread();
  await H.copyViaButton();
  const printRequest = H.state.requests.find((url) => url.includes("view=pt"));
  assert.ok(printRequest, "no print-view request was made");
  assert.ok(printRequest.includes("th=THREAD_REAL"), printRequest);
  assert.ok(!printRequest.includes("DECOY"), printRequest);
});

test("narrow ancestor fallback finds the thread without searching role=main", async () => {
  H.state.page = fixture("gmail-thread.html")
    .replace(
      '<h2 class="hP" data-legacy-thread-id="THREAD_REAL">',
      '<h2 class="hP">'
    )
    .replace('<div class="thread">', '<div class="thread" data-legacy-thread-id="THREAD_REAL">');
  await H.openThread();
  const out = await H.copyViaButton();
  assert.ok(out.includes("<messages>3</messages>"));
  const printRequest = H.state.requests.find((url) => url.includes("view=pt"));
  assert.ok(printRequest.includes("th=THREAD_REAL"), printRequest);
});

test("copies all messages as parseable, complete XML", async () => {
  await H.openThread();
  const out = await H.copyViaButton();
  assert.ok(out.startsWith('<email_thread format_version="3">'), out.slice(0, 100));
  assert.ok(out.trimEnd().endsWith("</email_thread>"));
  assert.ok(out.includes("<messages>3</messages>"));
  assert.ok(out.includes('<completeness messages="true" headers="true" attachments="true"/>'));
  assert.ok(out.includes("<complete>true</complete>"));

  const parsed = await H.page.evaluate((xml) => {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    return {
      errors: doc.querySelectorAll("parsererror").length,
      messages: doc.querySelectorAll("message").length,
    };
  }, out);
  assert.deepStrictEqual(parsed, { errors: 0, messages: 3 });
});

test("retries without a stale Gmail session key", async () => {
  H.state.rejectIk = true;
  await H.openThread();
  const out = await H.copyViaButton();
  assert.ok(out.includes("<complete>true</complete>"));
  const requests = H.state.requests.filter((url) => url.includes("view=pt"));
  assert.ok(requests.some((url) => url.includes("ik=fixtureik123")));
  assert.ok(requests.some((url) => !url.includes("ik=")));
});

test("makes who said what, when and to whom unambiguous", async () => {
  await H.openThread();
  const out = await H.copyViaButton();
  assert.ok(out.includes('from="Jennifer"'));
  assert.ok(out.includes('email="jennifer@globeinflu.com"'));
  assert.ok(out.includes('local="Sun, Jun 14, 2026 at 7:51 AM"'));
  assert.match(out, /date="2026-06-14T\d\d:51/);
  assert.ok(out.includes('<recipient name="Moe Lueker" email="moelueker@gmail.com"/>'));
  assert.ok(out.includes('<recipient name="Legal" email="legal@zenalabs.com"/>'));
});

test("attributes each attachment exactly once to its message", async () => {
  await H.openThread();
  const out = await H.copyViaButton();
  assert.ok(out.includes("<attachment_count>2</attachment_count>"));
  assert.strictEqual((out.match(/name="MiniMax_Signed\.pdf"/g) || []).length, 1);
  assert.strictEqual((out.match(/name="figures\.csv"/g) || []).length, 1);
  const messageTwo = out.slice(out.indexOf('<message n="2"'), out.indexOf('<message n="3"'));
  assert.ok(messageTwo.includes("MiniMax_Signed.pdf"));
  assert.ok(messageTwo.includes("figures.csv"));
  assert.ok(!out.includes("pdf.gif"));
});

test("strips recognized history and signatures without retaining trackers", async () => {
  await H.openThread();
  const out = await H.copyViaButton();
  assert.ok(!out.includes("On Sun, Jun 14, 2026 Jennifer wrote:"));
  assert.ok(!out.includes("发件人"));
  assert.ok(!out.includes("email_open_log_pic"));
  assert.ok(!out.includes("Business Development"));
});

test("preserves useful links and data tables while making images inert", async () => {
  await H.openThread();
  const out = await H.copyViaButton();
  assert.ok(out.includes("[the brief](https://example.com/brief)"));
  assert.ok(out.includes("| Deliverable | Fee |"));
  assert.ok(out.includes("| YouTube video | $3,500 |"));
  assert.ok(out.includes("[image: logo]"));
  assert.doesNotMatch(
    out,
    /(^|[\s>])!\[[^\]\n]*\]\(https?:/im,
    "active remote Markdown image survived"
  );
});

test("refuses to copy when Gmail returns a different conversation", async () => {
  await H.openThread();
  H.state.printView = fixture("printview-other-thread.html");
  const out = await H.copyViaButton();
  assert.strictEqual(out, "__NOT_COPIED__");
  assert.match(await H.toastText(), /different conversation/i);
});

test("refuses if the user changes conversations during capture", async () => {
  H.state.printViewDelay = 250;
  await H.openThread();
  await H.page.evaluate(() => navigator.clipboard.writeText("__NOT_COPIED__"));
  await H.page.click(".ctl-btn-copy");

  const deadline = Date.now() + 2_000;
  while (
    !H.state.requests.some((url) => url.includes("view=pt")) &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await H.page.evaluate(() => {
    const heading = document.querySelector("h2.hP");
    heading.setAttribute("data-legacy-thread-id", "THREAD_OTHER");
    heading.textContent = "Another conversation";
  });
  await H.page.waitForFunction(
    () => Array.from(document.querySelectorAll(".ctl-actions button")).every((b) => !b.disabled),
    { timeout: 15_000 }
  );

  assert.strictEqual(await H.page.evaluate(() => navigator.clipboard.readText()), "__NOT_COPIED__");
  assert.match(await H.toastText(), /conversation changed/i);
});

test("a partially parseable print view is marked partial, not complete", async () => {
  H.state.printView = fixture("printview-negotiation.html").replace(
    "</body>",
    '<table class="message"><tr><td>unknown layout</td></tr></table></body>'
  );
  await H.openThread();
  const out = await H.copyViaButton();
  assert.ok(out.includes('<completeness messages="false" headers="false" attachments="false"/>'));
  assert.ok(out.includes("<messages>3</messages>"));
  assert.ok(out.includes("<message_candidates>4</message_candidates>"));
  assert.ok(out.includes("<complete>false</complete>"));
  assert.ok(out.includes('<warning code="MESSAGE_SKIPPED">'));
  assert.match(await H.toastText(), /review warnings/i);
});

test("visible-page fallback declares every unverifiable field", async () => {
  await H.openThread();
  H.state.printViewStatus = 500;
  const out = await H.copyViaButton();
  assert.ok(out.includes('<completeness messages="false" headers="false" attachments="false"/>'));
  assert.ok(out.includes("<complete>false</complete>"));
  assert.ok(out.includes('<warning code="VISIBLE_PAGE_FALLBACK">'));
  assert.match(await H.toastText(), /review warnings/i);
});

test("service-worker command path copies without a second sign-in", async () => {
  await H.openThread();
  const out = await H.copyViaCommand("copy");
  assert.ok(out.startsWith('<email_thread format_version="3">'));
});

test("popup explains the browser-session model and can copy", async () => {
  await H.openThread();
  await H.page.evaluate(() => navigator.clipboard.writeText("__NOT_COPIED__"));
  const popup = await H.popupForGmail();
  assert.match(await popup.locator(".compact").innerText(), /signed-in Gmail tab/i);
  assert.match(await popup.locator(".compact").innerText(), /No Google sign-in/i);
  await popup.click("#copy");
  await H.page.waitForFunction(
    () => document.querySelector(".ctl-toast")?.textContent?.includes("Copied"),
    { timeout: 15_000 }
  );
  const out = await H.page.evaluate(() => navigator.clipboard.readText());
  assert.ok(out.startsWith('<email_thread format_version="3">'));
  if (!popup.isClosed()) await popup.close();
});

test("plain copy inlines text and starts no disk download", async () => {
  await H.openThread();
  const before = (await H.downloads()).length;
  const out = await H.copyViaButton();
  assert.ok(out.includes("quarter,revenue"));
  assert.match(
    out,
    /name="MiniMax_Signed\.pdf"[^>]*status="not downloaded \(use Copy \+ save files\)"/
  );
  assert.ok(out.includes('type="application/pdf"'));
  assert.strictEqual((await H.downloads()).length, before);
});

test("save mode starts and completes every attachment download", async () => {
  await H.openThread();
  const before = (await H.downloads()).length;
  const out = await H.copyViaButton("save");
  const items = await H.waitForDownloads(before + 2);
  const newItems = items.slice(0, items.length - before);

  assert.strictEqual(newItems.length, 2);
  assert.ok(newItems.every((item) => item.state === "complete"));
  assert.ok(
    newItems.every((item) => item.url.startsWith("https://mail.google.com/mail/u/0/"))
  );
  assert.strictEqual((out.match(/status="download started"/g) || []).length, 2);
  assert.ok(out.includes("<download_path_base>Chrome download directory</download_path_base>"));
  assert.ok(
    out.includes(
      'path="gmail-threads/subject-paid-collaboration-opportunity-with-minimax/'
    )
  );
  assert.ok(!out.includes("~/Downloads"));
});

test("crafted off-origin attachment metadata causes no external request", async () => {
  H.state.page = fixture("gmail-thread.html").replace(
    '<div class="a3s">Visible copy of the first message only.</div>',
    '<div class="a3s">Visible copy.</div>' +
      '<span class="aV3" title="trap.txt"><a download_url="text/plain:trap.txt:https://evil.example/steal?view=att&amp;th=THREAD_REAL&amp;attid=1">trap</a></span>'
  );
  await H.openThread();
  const out = await H.copyViaButton();
  assert.strictEqual(H.state.externalRequests.length, 0, H.state.externalRequests.join("\n"));
  assert.ok(out.includes("unsafe download link rejected"));
  assert.ok(out.includes('<warning code="ATTACHMENT_UNAVAILABLE">'));
});
