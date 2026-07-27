// Service worker: keyboard command routing and the privileged download boundary.

importScripts("lib/security.js");

const S = globalThis.CT.security;
const GMAIL = /^https:\/\/mail\.google\.com\//;

async function activeGmailTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !GMAIL.test(tab.url)) return null;
  return tab;
}

async function dispatch(mode) {
  const tab = await activeGmailTab();
  if (!tab) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "run", mode });
  } catch (e) {
    console.warn("[copy-gmail-thread] could not reach Gmail:", e?.message || e);
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command === "copy-thread") dispatch("copy");
  else if (command === "save-thread") dispatch("save");
});

function respondWithDownload(id, requestedPath, sendResponse) {
  chrome.downloads.search({ id }, (items) => {
    // Issuing a download is not the same as completing it. Report "started"
    // truthfully and use Chrome's resolved basename when it is already known.
    const actual = items && items[0] ? items[0].filename : "";
    sendResponse({
      ok: true,
      id,
      path: S.reportedDownloadPath(actual, requestedPath),
      status: "download started",
    });
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "download") return false;

  // The entire decision lives in lib/security.js so it can be tested directly
  // against forged senders. Nothing here re-derives it or works around it.
  const decision = S.authorizeDownload(msg, sender, chrome.runtime.id);
  if (!decision.ok) {
    console.warn("[copy-gmail-thread] refused a download request:", decision.error);
    sendResponse({ ok: false, error: decision.error });
    return false;
  }
  const { url, path } = decision;

  chrome.downloads.download(
    { url, filename: path, conflictAction: "uniquify", saveAs: false },
    (id) => {
      if (chrome.runtime.lastError || id === undefined) {
        console.warn(
          "[copy-gmail-thread] download could not start:",
          chrome.runtime.lastError?.message
        );
        sendResponse({ ok: false, error: "download failed to start" });
        return;
      }
      respondWithDownload(id, path, sendResponse);
    }
  );
  return true;
});
