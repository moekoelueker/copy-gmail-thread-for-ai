// Real-extension browser harness against a deterministic stand-in Gmail.
// No real mailbox, Google credential, or external network request is used.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "..");
const FIXTURES = path.join(__dirname, "fixtures");

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), "utf8");
}

// extensionRoot lets a test load a built release archive instead of the
// repository, so the shipped artifact is exercised and not just the source.
async function start({ extensionRoot = ROOT } = {}) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctgfa-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    acceptDownloads: true,
    args: [
      ...(process.env.HEADED ? [] : ["--headless=new"]),
      `--disable-extensions-except=${extensionRoot}`,
      `--load-extension=${extensionRoot}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
    ],
  });

  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "https://mail.google.com",
  });

  const state = {
    page: fixture("gmail-thread.html"),
    printView: fixture("printview-negotiation.html"),
    printViewStatus: 200,
    printViewDelay: 0,
    rejectIk: false,
    onAttachmentRequest: null,
    expectedThreadId: "THREAD_REAL",
    requests: [],
    externalRequests: [],
  };

  await context.route("**/*", async (route) => {
    const requestUrl = route.request().url();
    let url;
    try {
      url = new URL(requestUrl);
    } catch (_) {
      return route.continue();
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return route.continue();
    }
    state.requests.push(url.toString());

    if (url.origin !== "https://mail.google.com") {
      state.externalRequests.push(url.toString());
      return route.abort("blockedbyclient");
    }

    if (url.searchParams.get("view") === "pt") {
      if (url.searchParams.get("th") !== state.expectedThreadId) {
        return route.fulfill({
          status: 404,
          contentType: "text/html; charset=utf-8",
          body: fixture("printview-other-thread.html"),
        });
      }
      if (state.printViewStatus !== 200) {
        return route.fulfill({ status: state.printViewStatus, body: "error" });
      }
      if (state.rejectIk && url.searchParams.has("ik")) {
        return route.fulfill({ status: 400, body: "stale ik" });
      }
      if (state.printViewDelay) {
        await new Promise((resolve) => setTimeout(resolve, state.printViewDelay));
      }
      return route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: state.printView,
      });
    }

    if (url.searchParams.get("view") === "att") {
      if (url.searchParams.get("th") !== state.expectedThreadId) {
        return route.fulfill({ status: 404, body: "wrong thread" });
      }
      // Lets a test change page state at a precise point mid-capture without
      // racing a timer. Awaited before the response is produced.
      if (state.onAttachmentRequest) {
        await state.onAttachmentRequest(url);
      }
      if (url.searchParams.get("kind") === "csv") {
        return route.fulfill({
          status: 200,
          contentType: "text/csv; charset=utf-8",
          headers: { "content-length": "27" },
          body: "quarter,revenue\nQ3,1200000\n",
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: "%PDF-1.4 deterministic test file",
      });
    }

    return route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: state.page,
    });
  });

  const page = await context.newPage();
  const consoleLines = [];
  page.on("console", (message) => {
    consoleLines.push(`${message.type()}: ${message.text()}`);
  });

  async function worker() {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
    }
    return serviceWorker;
  }

  async function openThread() {
    state.requests.length = 0;
    state.externalRequests.length = 0;
    // A same-hash navigation can be optimized into a no-op, leaving the
    // previous scenario's fixture in place. Force a fresh document each time.
    await page.goto("about:blank");
    await page.goto("https://mail.google.com/mail/u/0/#all/THREAD_REAL");
    await page.waitForSelector(".ctl-actions", { timeout: 15_000 });
  }

  async function resetClipboard() {
    await page.evaluate(() => navigator.clipboard.writeText("__NOT_COPIED__"));
  }

  async function copyViaButton(mode = "copy") {
    await resetClipboard();
    const selector = mode === "save" ? ".ctl-btn-save" : ".ctl-btn-copy";
    await page.click(selector);
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll(".ctl-actions button")).every((b) => !b.disabled),
      { timeout: 15_000 }
    );
    return page.evaluate(() => navigator.clipboard.readText());
  }

  async function copyViaCommand(mode = "copy") {
    await resetClipboard();
    const serviceWorker = await worker();
    await serviceWorker.evaluate(async (requestedMode) => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab.id, { type: "run", mode: requestedMode });
    }, mode);
    await page.waitForFunction(
      () =>
        document.querySelector(".ctl-toast")?.textContent?.match(
          /Copied|couldn't|expired|different|open an email/i
        ),
      { timeout: 15_000 }
    );
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll(".ctl-actions button")).every((b) => !b.disabled),
      { timeout: 15_000 }
    );
    return page.evaluate(() => navigator.clipboard.readText());
  }

  async function downloads() {
    const serviceWorker = await worker();
    return serviceWorker.evaluate(() => chrome.downloads.search({}));
  }

  async function popupForGmail() {
    const serviceWorker = await worker();
    const extensionId = new URL(serviceWorker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront();
    // Reload while the Gmail tab is active so popup.js sees the same state a
    // real toolbar popup would see.
    await popup.reload();
    await popup.waitForSelector("#onGmail:not([hidden])", { timeout: 15_000 });
    return popup;
  }

  async function waitForDownloads(count) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const items = await downloads();
      if (items.length >= count && items.slice(0, count).every((item) => item.state === "complete")) {
        return items;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`timed out waiting for ${count} completed downloads`);
  }

  const toastText = () =>
    page.evaluate(() => document.querySelector(".ctl-toast")?.textContent || "");

  async function stop() {
    await context.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  return {
    context,
    page,
    state,
    fixture,
    openThread,
    copyViaButton,
    copyViaCommand,
    downloads,
    waitForDownloads,
    popupForGmail,
    toastText,
    consoleLines,
    stop,
  };
}

module.exports = { start, fixture };
