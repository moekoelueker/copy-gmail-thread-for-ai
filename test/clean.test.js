const test = require("node:test");
const assert = require("node:assert");
const { clean: C } = require("./loader");

test("cuts an English quoted reply chain", () => {
  const body = [
    "Sounds good, let's do Tuesday.",
    "",
    "On Tue, Jul 7, 2026 at 4:03 PM Jane Doe <jane@acme.com> wrote:",
    "> Can we move the call?",
    "> Jane",
  ].join("\n");
  const { text, trimmed } = C.trimQuotedText(body);
  assert.strictEqual(text, "Sounds good, let's do Tuesday.");
  assert.strictEqual(trimmed, true);
});

test("cuts a German quoted reply chain", () => {
  const body = [
    "Passt, bis Dienstag.",
    "",
    "Am Di., 7. Juli 2026 um 16:03 Uhr schrieb Jane Doe <jane@acme.com>:",
    "> Koennen wir verschieben?",
  ].join("\n");
  const { text, trimmed } = C.trimQuotedText(body);
  assert.strictEqual(text, "Passt, bis Dienstag.");
  assert.strictEqual(trimmed, true);
});

test("cuts an Outlook original-message block", () => {
  const body = "Approved.\n\n-----Original Message-----\nFrom: someone\nblah";
  assert.strictEqual(C.trimQuotedText(body).text, "Approved.");
});

test("cuts a Chinese-client quoted header block", () => {
  const body = [
    "ok! lets do it with 3500usd!",
    "",
    "发件人: Moe Lueker <moelueker@gmail.com>",
    "到: \"Jennifer\"<jennifer@globeinflu.com>",
    "日期: 周三, 2026-06-17 14:20:36",
    "主题: Re: Paid Collaboration Opportunity",
  ].join("\n");
  const { text, trimmed } = C.trimQuotedText(body);
  assert.strictEqual(text, "ok! lets do it with 3500usd!");
  assert.strictEqual(trimmed, true);
});

test("keeps forwarded messages intact", () => {
  const body = [
    "FYI, see below.",
    "",
    "---------- Forwarded message ---------",
    "From: Jane Doe <jane@acme.com>",
    "Sent: Tuesday, July 7, 2026",
    "Subject: Contract",
    "",
    "Here is the contract detail you asked about.",
  ].join("\n");
  const { text, trimmed } = C.trimQuotedText(body);
  assert.ok(text.includes("Here is the contract detail"), "forwarded body was eaten");
  assert.strictEqual(trimmed, false);
});

test("safety valve keeps an inline reply that lives inside quoted text", () => {
  // Everything meaningful sits after the quote intro. Cutting at the intro would
  // leave almost nothing, so the original must be preserved instead.
  const body = [
    "Hi,",
    "",
    "On Tue, Jul 7, 2026 at 4:03 PM Jane Doe <jane@acme.com> wrote:",
    "> Do you want option A or option B?",
    "I want option B, and here is a long explanation of exactly why that is.",
    "> When should we start?",
    "Let's start on the first of next month, assuming legal signs off in time.",
  ].join("\n");
  const { text, trimmed } = C.trimQuotedText(body);
  assert.ok(text.includes("I want option B"), "inline reply was lost");
  assert.strictEqual(trimmed, false);
});

test("trimming never produces an empty body", () => {
  const body = "On Tue, Jul 7, 2026 at 4:03 PM Jane Doe <jane@acme.com> wrote:\n> hello";
  const { text } = C.trimQuotedText(body);
  assert.ok(text.trim().length > 0, "body was emptied");
});

test("cuts a trailing signature", () => {
  const body = [
    "Here is the summary you asked for, covering the whole quarter in detail.",
    "",
    "--",
    "Jane Doe",
    "VP Sales, Acme",
    "+1 555 0100",
  ].join("\n");
  const { text } = C.trimQuotedText(body);
  assert.ok(text.includes("Here is the summary"));
  assert.ok(!text.includes("VP Sales"), "signature survived");
});

test("does not treat a leading double dash as a signature", () => {
  const body = "--\nThis whole message is what matters and it is the only content.";
  const { text } = C.trimQuotedText(body);
  assert.ok(text.includes("This whole message"), "body was deleted by a leading --");
});

test("handles empty and blank input", () => {
  assert.strictEqual(C.trimQuotedText("").text, "");
  assert.strictEqual(C.trimQuotedText(null).text, "");
  assert.strictEqual(C.trimQuotedText("   ").trimmed, false);
});

test("output does not grow with quote depth", () => {
  // The v1 defect: each message carried the entire chain below it, so a thread
  // grew quadratically. Trimming must make each message's cost independent of
  // how deep in the thread it sits.
  const make = (depth) => {
    let acc = "Original message body.";
    for (let i = 0; i < depth; i++) {
      acc = `Reply number ${i}.\n\nOn Tue, Jul 7, 2026 at 4:0${i} PM p${i} <p${i}@x.com> wrote:\n${acc
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n")}`;
    }
    return acc;
  };
  const shallow = C.trimQuotedText(make(2)).text.length;
  const deep = C.trimQuotedText(make(8)).text.length;
  assert.ok(
    Math.abs(deep - shallow) < 30,
    `depth changed output size: ${shallow} vs ${deep}`
  );
});
