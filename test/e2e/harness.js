// Real-extension browser harness against a deterministic stand-in Gmail.
// No real mailbox, Google credential, or external network request is used.
//
// Two independent surfaces fetch from "Gmail" and they need separate stand-ins.
// Playwright's context.route() covers what a page or the content script issues.
// It does not cover chrome.downloads.download(), which the browser performs
// outside any page: those requests escaped routing, reached the real
// mail.google.com, and saved 853 KB of Google's sign-in HTML while the tests
// asserted only that the download reached "complete" — green for years, and
// intermittently red whenever Google answered 401 instead. So the host is also
// resolved to a local HTTPS server that serves the same fixtures, and every
// other host is blackholed at the resolver.
//
// Each test file here drives a full Chrome, so package.json runs them with
// --test-concurrency=1: run concurrently, several browsers compete for one
// machine and the waits below start reporting load instead of behavior. Serial
// costs about half a minute.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");

// Every wait here bounds a hang; none of them asserts latency. A capture takes
// about two seconds.
const WAIT_MS = 15_000;

const ROOT = path.join(__dirname, "..", "..");
const FIXTURES = path.join(__dirname, "fixtures");

// The bodies the stand-in serves for an attachment. Both surfaces answer from
// here, so a test can assert that the bytes on disk are the bytes we served.
const ATTACHMENT_BODIES = {
  csv: { type: "text/csv; charset=utf-8", body: "quarter,revenue\nQ3,1200000\n" },
  pdf: { type: "application/pdf", body: "%PDF-1.4 deterministic test file" },
};

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), "utf8");
}

// Generated per run and discarded with the profile. Chrome accepts it only
// because of --ignore-certificate-errors, so nothing is trusted machine-wide
// and no key is committed.
function selfSignedCert(directory) {
  const key = path.join(directory, "stand-in-key.pem");
  const cert = path.join(directory, "stand-in-cert.pem");
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes",
     "-keyout", key, "-out", cert, "-days", "1",
     "-subj", "/CN=mail.google.com",
     "-addext", "subjectAltName=DNS:mail.google.com"],
    { stdio: "ignore" }
  );
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

// extensionRoot lets a test load a built release archive instead of the
// repository, so the shipped artifact is exercised and not just the source.
async function start({ extensionRoot = ROOT } = {}) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctgfa-"));

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
    // Requests Playwright's routing never saw. In practice, the downloads.
    standInRequests: [],
  };

  // Serves whatever Playwright's routing cannot see, which in practice is
  // every chrome.downloads request. Recorded so a test can prove the download
  // was served here rather than by the internet.
  const server = https.createServer(selfSignedCert(userDataDir), (req, res) => {
    state.standInRequests.push(req.url);
    const url = new URL(req.url, "https://mail.google.com");
    if (url.searchParams.get("view") === "att") {
      if (url.searchParams.get("th") !== state.expectedThreadId) {
        res.writeHead(404).end("wrong thread");
        return;
      }
      const kind = url.searchParams.get("kind") === "csv" ? "csv" : "pdf";
      const { type, body } = ATTACHMENT_BODIES[kind];
      res.writeHead(200, { "content-type": type, "content-length": Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(state.page);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const standInPort = server.address().port;

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
      // Gmail resolves to the stand-in above; everything else fails to resolve,
      // so no test can reach the internet even if a code path tries.
      `--host-resolver-rules=MAP mail.google.com 127.0.0.1:${standInPort},MAP * ~NOTFOUND`,
      "--ignore-certificate-errors",
    ],
  });

  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "https://mail.google.com",
  });

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
      const kind = url.searchParams.get("kind") === "csv" ? "csv" : "pdf";
      const { type, body } = ATTACHMENT_BODIES[kind];
      return route.fulfill({
        status: 200,
        contentType: type,
        headers: { "content-length": String(Buffer.byteLength(body)) },
        body,
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
      serviceWorker = await context.waitForEvent("serviceworker", { timeout: WAIT_MS });
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
    await page.waitForSelector(".ctl-actions", { timeout: WAIT_MS });
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
      { timeout: WAIT_MS }
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
      { timeout: WAIT_MS }
    );
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll(".ctl-actions button")).every((b) => !b.disabled),
      { timeout: WAIT_MS }
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
    await popup.waitForSelector("#onGmail:not([hidden])", { timeout: WAIT_MS });
    return popup;
  }

  async function waitForDownloads(count) {
    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      const items = await downloads();
      if (items.length >= count && items.slice(0, count).every((item) => item.state === "complete")) {
        return items;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // Report what was actually seen. "timed out waiting for 2" cannot
    // distinguish a download that never started from one stuck in_progress
    // from one Chrome interrupted, and those have nothing to do with
    // each other.
    const seen = (await downloads()).map(
      (item) => `${item.id}:${item.state}${item.error ? `(${item.error})` : ""}`
    );
    const served = state.requests.filter((u) => u.includes("view=att")).length;
    throw new Error(
      `timed out waiting for ${count} completed downloads; saw [${seen.join(", ")}]` +
        `; attachment requests served by the stand-in: ${served}`
    );
  }

  const toastText = () =>
    page.evaluate(() => document.querySelector(".ctl-toast")?.textContent || "");

  async function stop() {
    await context.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  return {
    context,
    page,
    state,
    fixture,
    worker,
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
