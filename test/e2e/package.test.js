// The release archive, not the repository, is what a user installs. Extract it
// and drive the real extension out of the extracted folder: a missing runtime
// file is invisible when Chrome is pointed at the source tree.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { start } = require("./harness");
const { runtimeFiles, buildZip } = require("../../tools/package-extension");

function extract(archive, target) {
  const written = [];
  for (let i = 0; i + 30 <= archive.length; i++) {
    if (archive.readUInt32LE(i) !== 0x04034b50) continue;
    const method = archive.readUInt16LE(i + 8);
    const compressed = archive.readUInt32LE(i + 18);
    const nameLength = archive.readUInt16LE(i + 26);
    const extraLength = archive.readUInt16LE(i + 28);
    const start = i + 30 + nameLength + extraLength;
    const name = archive.slice(i + 30, i + 30 + nameLength).toString("utf8");
    const body = archive.slice(start, start + compressed);
    const raw = method === 8 ? zlib.inflateRawSync(body) : body;
    const destination = path.join(target, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, raw);
    written.push(name);
    i = start + compressed - 1;
  }
  return written;
}

test("the built release archive installs and copies a thread", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ctgfa-pkg-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const files = runtimeFiles();
  const extracted = extract(buildZip(files), directory);
  assert.deepStrictEqual(extracted.sort(), files.slice().sort());
  assert.ok(fs.existsSync(path.join(directory, "manifest.json")));
  assert.ok(!fs.existsSync(path.join(directory, "test")), "tests shipped in the archive");
  assert.ok(!fs.existsSync(path.join(directory, "docs")), "docs shipped in the archive");

  const H = await start({ extensionRoot: directory });
  t.after(async () => H.stop());

  await H.openThread();
  const out = await H.copyViaButton();
  assert.ok(out.startsWith('<email_thread format_version="3">'), out.slice(0, 120));
  assert.ok(out.includes("<messages>3</messages>"));
  assert.ok(out.includes("<complete>true</complete>"));
  assert.ok(out.includes("<attachment_count>2</attachment_count>"));

  // Save mode is the only path that reaches the service worker. A module the
  // worker importScripts but the archive omits leaves the worker throwing on
  // install, which copy mode never notices — it never messages the worker.
  const saved = await H.copyViaButton("save");
  assert.strictEqual(
    (saved.match(/status="download started"/g) || []).length,
    2,
    "the packaged service worker did not accept downloads"
  );

  const popup = await H.popupForGmail();
  assert.match(await popup.locator(".compact").innerText(), /signed-in Gmail tab/i);
  if (!popup.isClosed()) await popup.close();
});
