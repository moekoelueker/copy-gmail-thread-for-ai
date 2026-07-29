const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { runtimeFiles, buildZip } = require("../tools/package-extension");

const ROOT = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

// Entry names from the local file headers of an archive we produced ourselves.
function entryNames(archive) {
  const names = [];
  for (let i = 0; i + 30 <= archive.length; i++) {
    if (archive.readUInt32LE(i) !== 0x04034b50) continue;
    const nameLength = archive.readUInt16LE(i + 26);
    const extraLength = archive.readUInt16LE(i + 28);
    const compressed = archive.readUInt32LE(i + 18);
    names.push(archive.slice(i + 30, i + 30 + nameLength).toString("utf8"));
    i += 30 + nameLength + extraLength + compressed - 1;
  }
  return names;
}

test("the release archive carries every file the manifest references", () => {
  const files = runtimeFiles();
  const required = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => [...script.js, ...(script.css || [])]),
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
  ];
  for (const file of required) {
    assert.ok(files.includes(file), `release archive would omit ${file}`);
  }
  assert.ok(files.includes("manifest.json"));
  assert.ok(files.includes("popup.js"), "popup.html would load a missing script");
  assert.ok(files.includes("popup.css"));
  assert.ok(files.includes("LICENSE"));
  assert.ok(files.includes("PRIVACY.md"));
});

// The manifest names one service-worker file; everything else it runs arrives
// through importScripts, which the manifest cannot declare. lib/security.js
// survived only because it is a content script too, so a service-worker-only
// module would have been dropped from the archive and left the worker throwing
// on install — while an unpacked load from the repository kept working.
test("the release archive carries what the service worker imports", () => {
  const files = runtimeFiles();
  const worker = fs.readFileSync(path.join(ROOT, manifest.background.service_worker), "utf8");
  const imported = Array.from(worker.matchAll(/importScripts\(([^)]*)\)/g)).flatMap((call) =>
    Array.from(call[1].matchAll(/["']([^"']+)["']/g), (m) => m[1])
  );

  assert.ok(imported.length, "no importScripts call found to verify");
  for (const file of imported) {
    assert.ok(files.includes(file), `release archive would omit ${file}, imported by the worker`);
  }
});

test("the release archive carries nothing else", () => {
  // "Download ZIP" ships the whole repository. This is the guard that a release
  // build cannot: tests, fixtures, tooling, docs, or a raw capture left in the
  // working tree are all several times the size of the extension itself.
  const forbidden = /^(test|tools|docs|node_modules|\.git|icons\/src)\/|^(package(-lock)?\.json|README\.md|\.gitignore|\.DS_Store)$/;
  for (const file of runtimeFiles()) {
    assert.ok(!forbidden.test(file), `release archive would ship ${file}`);
    assert.ok(!file.includes(".."), file);
    assert.ok(!path.isAbsolute(file), file);
  }
});

test("the release archive is a valid zip containing exactly those files", () => {
  const files = runtimeFiles();
  const archive = buildZip(files);
  assert.strictEqual(archive.readUInt32LE(0), 0x04034b50, "not a zip archive");
  assert.deepStrictEqual(entryNames(archive).sort(), files.slice().sort());

  // Chrome rejects an archive whose manifest is not at the root.
  assert.ok(files.includes("manifest.json"));
  assert.ok(archive.length > 1024);
});

test("no runtime file references a test or development path", () => {
  for (const file of runtimeFiles()) {
    if (!/\.(js|html|css)$/.test(file)) continue;
    const body = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.ok(!/\brequire\(/.test(body), `${file} uses CommonJS require`);
    assert.ok(!/node_modules|test\/e2e|playwright/i.test(body), `${file} references dev tooling`);
  }
});
