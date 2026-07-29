#!/usr/bin/env node
// Build a loadable archive containing runtime files only.
//
// The documented install is "Download ZIP -> Load unpacked", which hands the
// user the whole repository: tests, fixtures, tooling and docs are several
// times the size of the extension itself, and a raw Gmail capture left in the
// working tree would ride along. This produces the opposite: an explicit
// allowlist derived from the manifest, with nothing else in it.
//
// No dependencies. The archive is written with node:zlib so the project keeps
// its zero-dependency, no-build-step property.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ROOT = path.join(__dirname, "..");

// Assets popup.html pulls in. The manifest cannot declare these, and parsing
// HTML to discover them would be a worse trade than naming them here.
const POPUP_ASSETS = ["popup.js", "popup.css"];

function runtimeFiles(root = ROOT) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const files = new Set(["manifest.json", "LICENSE", "PRIVACY.md", ...POPUP_ASSETS]);
  const add = (value) => {
    if (typeof value === "string" && value) files.add(value);
  };

  add(manifest.background?.service_worker);
  // The manifest names one service-worker file; every other module the worker
  // runs arrives through importScripts, which the manifest cannot express.
  // Follow it transitively, or the archive ships a worker that throws on
  // install while an unpacked load from the repository keeps working.
  const pending = [manifest.background?.service_worker].filter(Boolean);
  const scanned = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (scanned.has(file)) continue;
    scanned.add(file);
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    for (const call of fs.readFileSync(full, "utf8").matchAll(/importScripts\(([^)]*)\)/g)) {
      for (const [, imported] of call[1].matchAll(/["']([^"']+)["']/g)) {
        add(imported);
        pending.push(imported);
      }
    }
  }

  add(manifest.action?.default_popup);
  for (const script of manifest.content_scripts || []) {
    (script.js || []).forEach(add);
    (script.css || []).forEach(add);
  }
  for (const icons of [manifest.icons, manifest.action?.default_icon]) {
    for (const value of Object.values(icons || {})) add(value);
  }

  const missing = Array.from(files).filter((file) => !fs.existsSync(path.join(root, file)));
  if (missing.length) {
    throw new Error(`manifest references files that do not exist: ${missing.join(", ")}`);
  }
  return Array.from(files).sort();
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function buildZip(files, root = ROOT) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const name of files) {
    const raw = fs.readFileSync(path.join(root, name));
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    // Only claim compression when it actually helped.
    const stored = deflated.length >= raw.length;
    const body = stored ? raw : deflated;
    const method = stored ? 0 : 8;
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // dos time
    local.writeUInt16LE(0x21, 12); // fixed dos date, so builds are reproducible
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // version made by
    entry.writeUInt16LE(20, 6); // version needed
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);

    offset += local.length + nameBytes.length + body.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuffer, end]);
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const files = runtimeFiles();
  const target = path.resolve(
    process.argv[2] || path.join(ROOT, `copy-gmail-thread-for-ai-${manifest.version}.zip`)
  );
  const archive = buildZip(files);
  fs.writeFileSync(target, archive);

  console.log(`${files.length} runtime files, ${(archive.length / 1024).toFixed(1)} KB`);
  for (const file of files) console.log(`  ${file}`);
  console.log(`wrote ${target}`);
}

if (require.main === module) main();

module.exports = { runtimeFiles, buildZip, crc32 };
