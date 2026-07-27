// The lib/* modules are plain scripts that attach themselves to globalThis.CT
// so they can be listed directly in the manifest with no bundler. That also
// makes them valid CommonJS, so Node can load them as-is — no build step, no
// test framework, no dependencies.
//
// lib/richtext.js and adapters/gmail.js need a DOM and are covered by
// test/browser/index.html instead.

const path = require("node:path");
const root = path.join(__dirname, "..");

require(path.join(root, "lib/text.js"));
require(path.join(root, "lib/security.js"));
require(path.join(root, "lib/clean.js"));
require(path.join(root, "lib/format.js"));
require(path.join(root, "lib/attachments.js"));

module.exports = globalThis.CT;
