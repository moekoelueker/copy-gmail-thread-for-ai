#!/usr/bin/env node

// Capture the real popup markup and stylesheet in its Gmail-ready state for
// Chrome Web Store artwork. This does not sign in to Gmail or use live data.

const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "store-assets", "ui-popup-v2.png");
const controlsOutput = path.join(root, "docs", "screenshots", "controls.png");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 340, height: 560 },
    deviceScaleFactor: 2,
  });

  await page.goto(pathToFileURL(path.join(root, "popup.html")).href);
  await page.evaluate(() => {
    document.querySelector("#onGmail").hidden = false;
    document.querySelector("#offGmail").hidden = true;
    document.querySelector("#shortcuts").innerHTML = `
      <dt>Copy the open Gmail thread</dt><dd>⌥C</dd>
      <dt>Copy the thread and save attachments</dt><dd>⇧⌥C</dd>
    `;
  });

  await page.locator("body").screenshot({ path: output });

  const controlsPage = await browser.newPage({
    viewport: { width: 620, height: 90 },
    deviceScaleFactor: 1,
  });
  const contentCss = fs.readFileSync(path.join(root, "content.css"), "utf8");
  await controlsPage.setContent(`
    <style>
      body { margin: 0; padding: 2px; color: #202124; background: #fff; }
      ${contentCss}
    </style>
    <span class="ctl-actions" role="group" aria-label="Copy Gmail thread">
      <span class="ctl-data-note">Reads this thread locally</span>
      <button type="button" class="ctl-btn ctl-btn-copy">Copy thread</button>
      <button type="button" class="ctl-btn ctl-btn-save">Copy + save files</button>
    </span>
  `);
  await controlsPage.locator(".ctl-actions").screenshot({ path: controlsOutput });

  await browser.close();
  console.log(output);
  console.log(controlsOutput);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
