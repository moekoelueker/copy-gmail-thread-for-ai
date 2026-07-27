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
  H.state.onAttachmentRequest = null;
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
  assert.ok(out.includes('email="jennifer@example.com"'));
  assert.ok(out.includes('local="Sun, Jun 14, 2026 at 7:51 AM"'));
  assert.match(out, /date="2026-06-14T\d\d:51/);
  assert.ok(out.includes('<recipient name="Sam Rivera" email="sam@example.net"/>'));
  assert.ok(out.includes('<recipient name="Legal" email="legal@example.org"/>'));
});

test("attributes each attachment exactly once to its message", async () => {
  await H.openThread();
  const out = await H.copyViaButton();
  assert.ok(out.includes("<attachment_count>2</attachment_count>"));
  assert.strictEqual((out.match(/name="Northwind_Signed\.pdf"/g) || []).length, 1);
  assert.strictEqual((out.match(/name="figures\.csv"/g) || []).length, 1);
  const messageTwo = out.slice(out.indexOf('<message n="2"'), out.indexOf('<message n="3"'));
  assert.ok(messageTwo.includes("Northwind_Signed.pdf"));
  assert.ok(messageTwo.includes("figures.csv"));
  assert.ok(!out.includes("pdf.gif"));
});

// Gmail shows the same file twice: once in the print view and once as a live
// attachment chip whose URL carries ui/ik/permmsgid/realattid. Matching on the
// full href reported one attachment as two to four entries, forced attachment
// completeness to false, raised two warnings on a healthy thread, and made save
// mode download every file twice. The live fixture now carries realistic chips,
// so these assertions are the regression guard.
test("live chips never duplicate the print view's attachments", async () => {
  await H.openThread();
  const out = await H.copyViaButton();

  assert.ok(
    out.includes("<attachment_count>2</attachment_count>"),
    (out.match(/<attachment_count>\d+<\/attachment_count>/) || [])[0]
  );
  assert.strictEqual((out.match(/name="Northwind_Signed\.pdf"/g) || []).length, 1);
  assert.strictEqual((out.match(/name="figures\.csv"/g) || []).length, 1);
  assert.ok(
    !out.includes('attribution="unknown"'),
    "a chip for an already-attributed file was reported as unattributed"
  );
  assert.ok(!out.includes("ATTACHMENT_ATTRIBUTION_UNKNOWN"));
  assert.ok(!out.includes("ATTACHMENT_UNAVAILABLE"));
  assert.ok(out.includes('<completeness messages="true" headers="true" attachments="true"/>'));
  assert.ok(out.includes("<complete>true</complete>"));
  assert.doesNotMatch(await H.toastText(), /review warnings/i);
});

// The filename fallback must not over-correct: one file per message is two
// files, not one, even when the names are identical.
test("the same filename on two messages stays two attachments", async () => {
  H.state.printView = fixture("printview-negotiation.html").replace(
    "<div>Received, thank you.</div>",
    "<div>Received, thank you.</div>" +
      '<table><tr><td><a href="/mail/u/0/?view=att&amp;th=THREAD_REAL&amp;attid=0.1' +
      '&amp;permmsgid=msg-f:3&amp;disp=safe&amp;realattid=f_third"><b>Northwind_Signed.pdf</b></a> 153K</td></tr></table>'
  );
  await H.openThread();
  const out = await H.copyViaButton();

  assert.ok(out.includes("<attachment_count>3</attachment_count>"));
  assert.strictEqual((out.match(/name="Northwind_Signed\.pdf"/g) || []).length, 2);
  const messageTwo = out.slice(out.indexOf('<message n="2"'), out.indexOf('<message n="3"'));
  const messageThree = out.slice(out.indexOf('<message n="3"'));
  assert.ok(messageTwo.includes("Northwind_Signed.pdf"), "message 2 lost its copy");
  assert.ok(messageThree.includes("Northwind_Signed.pdf"), "message 3 lost its copy");
  // Distinct files must still get distinct destinations.
  assert.ok(!out.includes('attribution="unknown"'));
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
    /name="Northwind_Signed\.pdf"[^>]*status="not downloaded \(use Copy \+ save files\)"/
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
      'path="gmail-threads/subject-paid-collaboration-opportunity-with-northwind/'
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

// The service worker is the last privileged boundary and must not trust the
// content script that asked. lib/security.js is unit-tested with forged
// senders; these two prove background.js actually routes through it.
test("the service worker refuses a download request that has no Gmail tab", async () => {
  await H.openThread();
  const before = (await H.downloads()).length;
  const popup = await H.popupForGmail();

  const response = await popup.evaluate(
    () =>
      new Promise((resolve) =>
        chrome.runtime.sendMessage(
          {
            type: "download",
            url: "/mail/u/0/?view=att&th=THREAD_REAL&attid=0.1&disp=safe",
            path: "gmail-threads/x/y.pdf",
            threadId: "THREAD_REAL",
          },
          resolve
        )
      )
  );

  assert.deepStrictEqual(response, { ok: false, error: "download request rejected" });
  assert.strictEqual((await H.downloads()).length, before, "an extension page started a download");
  if (!popup.isClosed()) await popup.close();
});

test("the service worker re-checks the account after the tab moves mid-capture", async () => {
  await H.openThread();
  const before = (await H.downloads()).length;

  // The content script validated every attachment URL while the tab was on
  // /mail/u/0/. Move the tab to another account after the first download has
  // been authorized but before the second, and the worker must refuse the
  // second on its own — nothing about the content script's request changed.
  let switched = false;
  H.state.onAttachmentRequest = async (url) => {
    if (switched || url.searchParams.get("kind") !== "csv") return;
    switched = true;
    await H.page.evaluate(() => history.pushState({}, "", "/mail/u/1/#all/THREAD_REAL"));
  };

  const out = await H.copyViaButton("save");
  assert.ok(switched, "the account switch never happened, so nothing was proven");

  assert.ok(
    out.includes('status="unsafe download request rejected"'),
    "the worker authorized a download for an account the tab had left"
  );
  const after = (await H.downloads()).length;
  assert.strictEqual(after, before + 1, `expected exactly the pre-switch download, got ${after - before}`);
  assert.match(await H.toastText(), /review warnings/i);

  await H.page.evaluate(() => history.pushState({}, "", "/mail/u/0/#all/THREAD_REAL"));
});

// Email HTML is attacker-controlled. These are the two shapes a sender can use
// to reach the parser: markup that mimics Gmail's attachment chrome, and markup
// that mimics Gmail's own subject heading.
test("a sender cannot forge an attachment with a lookalike icon path", async () => {
  H.state.printView = fixture("printview-negotiation.html").replace(
    "<div>Received, thank you.</div>",
    "<div>Received, thank you.</div>" +
      '<table><tr><td><img src="https://evil.example/icons/mail/images/pdf.gif"></td>' +
      "<td><b>Board_Minutes_CONFIDENTIAL.pdf</b> 900K</td></tr></table>"
  );
  await H.openThread();
  const out = await H.copyViaButton();

  // The text stays: it is genuinely what the sender wrote. What must not
  // happen is it being promoted into structured attachment metadata.
  assert.ok(
    !/<attachment [^>]*name="Board_Minutes_CONFIDENTIAL\.pdf"/.test(out),
    "an email body fabricated an attachment entry"
  );
  assert.ok(!out.includes("no download link for Board_Minutes_CONFIDENTIAL.pdf"));
  assert.ok(out.includes("<attachment_count>2</attachment_count>"));
  assert.ok(out.includes('<completeness messages="true" headers="true" attachments="true"/>'));
  assert.strictEqual(H.state.externalRequests.length, 0, H.state.externalRequests.join("\n"));
});

test("a sender cannot disable the controls with a lookalike subject heading", async () => {
  H.state.page = fixture("gmail-thread.html").replace(
    '<div class="a3s">Visible copy of the first message only.</div>',
    '<div class="a3s">Hello <h2 class="hP" data-legacy-thread-id="THREAD_DECOY_A">' +
      "Subject: Paid Collaboration Opportunity with Northwind</h2></div>"
  );
  await H.openThread();

  const buttons = await H.page.locator(".ctl-actions button").allTextContents();
  assert.deepStrictEqual(buttons.map((label) => label.trim()), [
    "Copy thread",
    "Copy + save files",
  ]);

  const out = await H.copyViaButton();
  assert.ok(out.startsWith('<email_thread format_version="3">'), out.slice(0, 120));
  assert.ok(out.includes("<messages>3</messages>"));
  const printRequest = H.state.requests.find((url) => url.includes("view=pt"));
  assert.ok(printRequest.includes("th=THREAD_REAL"), printRequest);
  assert.ok(!printRequest.includes("DECOY"), printRequest);
});

test("a genuinely ambiguous page says so instead of blaming the user", async () => {
  // Two headings that are not inside any message body: the extension cannot
  // tell which conversation is open, and must not guess.
  H.state.page = fixture("gmail-thread.html").replace(
    '<div class="thread">',
    '<h2 class="hP" data-legacy-thread-id="THREAD_DECOY_B">Another conversation</h2>' +
      '<div class="thread">'
  );
  await H.page.goto("about:blank");
  await H.page.goto("https://mail.google.com/mail/u/0/#all/THREAD_REAL");
  await H.page.waitForTimeout(1200);

  assert.strictEqual(await H.page.locator(".ctl-actions").count(), 0, "controls were anchored anyway");

  const popup = await H.popupForGmail();
  const hint = await popup.locator("#hint").innerText();
  assert.match(hint, /Couldn't identify the open conversation/i, hint);
  assert.doesNotMatch(hint, /No thread open/i);
  if (!popup.isClosed()) await popup.close();
});

test("the capture records the timezone its ISO dates were derived in", async () => {
  await H.openThread();
  const out = await H.copyViaButton();
  assert.match(out, /<capture_timezone>[A-Za-z]+\/[A-Za-z_+-]+<\/capture_timezone>/, out.slice(0, 600));
});

// Gmail truncates long filenames in the chip. When the chip carries no
// download_url the visible name is all there is, and it does not equal the
// print view's full name — so filename matching alone cannot tell that these
// are the same file. The capability key is what closes it.
test("a chip with a truncated name is still matched to its print-view entry", async () => {
  const longName = "Quarterly_Revenue_Report_Final_v7_APPROVED.pdf";
  H.state.printView = fixture("printview-negotiation.html").replace(
    "<div>Received, thank you.</div>",
    "<div>Received, thank you.</div>" +
      '<table><tr><td><a href="/mail/u/0/?view=att&amp;th=THREAD_REAL&amp;attid=0.7' +
      `&amp;permmsgid=msg-f:3&amp;disp=safe&amp;realattid=f_long"><b>${longName}</b></a> ２M</td></tr></table>`
  );
  H.state.page = fixture("gmail-thread.html").replace(
    '<div class="aQH">',
    '<div class="aQH">' +
      '<span class="aZo"><a href="https://mail.google.com/mail/u/0/?ui=2&amp;ik=fixtureik123' +
      "&amp;attid=0.7&amp;permmsgid=msg-f:3&amp;th=THREAD_REAL&amp;view=att&amp;disp=safe&amp;realattid=f_long\">" +
      '<div class="aYy"><span class="aV3 a6U">Quarterly_Revenue_Repor….pdf</span></div></a></span>'
  );

  await H.openThread();
  const out = await H.copyViaButton();

  assert.ok(out.includes("<attachment_count>3</attachment_count>"), (out.match(/<attachment_count>\d+</) || [])[0]);
  assert.ok(out.includes(`name="${longName}"`), "the full print-view name was lost");
  assert.ok(!out.includes("Quarterly_Revenue_Repor_.pdf"), "the truncated chip name became a second attachment");
  assert.ok(!out.includes('attribution="unknown"'));
  assert.ok(out.includes('<completeness messages="true" headers="true" attachments="true"/>'));
});

test("a sender cannot inject attachment chips through a message body", async () => {
  // Gmail's own chips sit beside the body. Chip markup found inside a rendered
  // body is the sender's HTML and must not become thread attachments.
  H.state.page = fixture("gmail-thread.html").replace(
    '<div class="a3s">Visible copy of the first message only.</div>',
    '<div class="a3s">Visible copy.' +
      '<div class="aQA"><span class="aV3" title="Payroll_2026_ALL_STAFF.xlsx">Payroll_2026_ALL_STAFF.xlsx</span></div>' +
      '<a download_url="application/pdf:Wire_Instructions.pdf:https://evil.example/x?view=att&amp;th=THREAD_REAL&amp;attid=9">w</a>' +
      "</div>"
  );
  await H.openThread();
  const out = await H.copyViaButton();

  assert.ok(!/<attachment [^>]*name="Payroll_2026_ALL_STAFF/.test(out), "body markup forged an attachment");
  assert.ok(!/<attachment [^>]*name="Wire_Instructions/.test(out), "body markup forged an attachment");
  assert.ok(out.includes("<attachment_count>2</attachment_count>"));
  assert.ok(!out.includes('attribution="unknown"'));
  assert.ok(out.includes('<completeness messages="true" headers="true" attachments="true"/>'));
  assert.strictEqual(H.state.externalRequests.length, 0, H.state.externalRequests.join("\n"));
});
