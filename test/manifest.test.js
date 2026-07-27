const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

test("manifest keeps the reviewed permission boundary", () => {
  assert.strictEqual(manifest.manifest_version, 3);
  assert.deepStrictEqual([...manifest.permissions].sort(), ["clipboardWrite", "downloads"]);
  assert.deepStrictEqual(manifest.host_permissions, ["https://mail.google.com/*"]);
  assert.ok(!manifest.oauth2, "OAuth configuration was added");
  assert.ok(!manifest.externally_connectable, "external messaging was enabled");
  assert.ok(!manifest.optional_host_permissions, "an unreviewed optional host was added");
});

test("content scripts run only on Gmail and load security boundaries in order", () => {
  assert.strictEqual(manifest.content_scripts.length, 1);
  const script = manifest.content_scripts[0];
  assert.deepStrictEqual(script.matches, ["https://mail.google.com/*"]);

  const index = (name) => script.js.indexOf(name);
  assert.ok(index("lib/security.js") >= 0);
  assert.ok(index("lib/security.js") < index("lib/attachments.js"));
  assert.ok(index("adapters/gmail-parse.js") < index("adapters/gmail.js"));
  assert.ok(index("adapters/gmail.js") < index("content.js"));
  for (const file of script.js) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `missing manifest script: ${file}`);
  }
});

test("manifest and package versions stay synchronized", () => {
  assert.strictEqual(manifest.version, pkg.version);
});
