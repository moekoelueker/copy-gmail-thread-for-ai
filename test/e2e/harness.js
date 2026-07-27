// End-to-end harness: loads the real extension into a real Chrome and serves a
// stand-in Gmail at the real origin.
//
// Requests to https://mail.google.com are intercepted and fulfilled locally, so
// the content script's manifest match pattern, its same-origin print-view
// fetch, the service worker, the clipboard and the downloads API all behave
// exactly as they do in production. Nothing here points at a real mailbox.
//
// What this cannot cover: Chrome binds keyboard commands at the browser level,
// so a synthetic keypress will not fire chrome.commands. The tests drive the
// same message the command dispatches instead, which exercises everything
// downstream of the key binding.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "..");
const FIXTURES = path.join(__dirname, "fixtures");

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), "utf8");
}

async function start() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctgfa-"));

  // Two deliberate choices here.
  //
  // Playwright's own Chromium rather than the system Chrome: Chrome 137+ removed
  // --load-extension, so a stock Chrome 150 silently starts with no extension at
  // all. Playwright's build still supports it, and pins the browser version so
  // the suite is reproducible.
  //
  // headless:false plus --headless=new rather than headless:true: the latter
  // selects the headless *shell* binary, which cannot run extensions. This runs
  // the full browser in new-headless mode, so nothing appears on screen.
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      ...(process.env.HEADED ? [] : ["--headless=new"]),
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
    ],
  });

  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "https://mail.google.com",
  });

  // Mutable so a single browser can serve different scenarios across tests.
  const state = {
    page: fixture("gmail-thread.html"),
    printView: fixture("printview-negotiation.html"),
    printViewStatus: 200,
    requests: [],
  };

  await context.route("https://mail.google.com/**", async (route) => {
    const url = new URL(route.request().url());
    state.requests.push(url.toString());

    if (url.searchParams.get("view") === "pt") {
      if (state.printViewStatus !== 200) {
        return route.fulfill({ status: state.printViewStatus, body: "error" });
      }
      return route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: state.printView,
      });
    }
    if (url.searchParams.get("view") === "att") {
      return route.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF-1.4 stub" });
    }
    return route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: state.page,
    });
  });

  const page = await context.newPage();
  const consoleLines = [];
  page.on("console", (m) => consoleLines.push(`${m.type()}: ${m.text()}`));

  async function openThread() {
    state.requests.length = 0;
    await page.goto("https://mail.google.com/mail/u/0/#all/THREAD_REAL");
    await page.waitForSelector(".ctl-btn", { timeout: 15000 });
  }

  async function copyViaButton() {
    await page.evaluate(() => navigator.clipboard.writeText("__NOT_COPIED__"));
    await page.click(".ctl-btn");
    await page.waitForFunction(
      () => !document.querySelector(".ctl-btn")?.disabled,
      { timeout: 15000 }
    );
    return page.evaluate(() => navigator.clipboard.readText());
  }

  // Drives the exact message chrome.commands.onCommand dispatches, so the
  // service worker -> content script path is covered even though a synthetic
  // keypress cannot trigger the real key binding.
  async function copyViaCommand(mode = "copy") {
    await page.evaluate(() => navigator.clipboard.writeText("__NOT_COPIED__"));
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
    await sw.evaluate(async (m) => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab.id, { type: "run", mode: m });
    }, mode);
    await page.waitForFunction(
      () => document.querySelector(".ctl-toast")?.textContent?.match(/Copied|Couldn|expired|different/),
      { timeout: 15000 }
    );
    return page.evaluate(() => navigator.clipboard.readText());
  }

  const toastText = () =>
    page.evaluate(() => document.querySelector(".ctl-toast")?.textContent || "");

  async function stop() {
    await context.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  return { context, page, state, fixture, openThread, copyViaButton, copyViaCommand, toastText, consoleLines, stop };
}

module.exports = { start, fixture };
