// Service worker: keyboard command routing and the privileged download boundary.

importScripts("lib/security.js", "lib/downloads.js");

const S = globalThis.CT.security;
const D = globalThis.CT.downloads;
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
      // Accepting the request is not writing the file. settle() waits for the
      // name Chrome actually chose, so the reported path survives uniquify.
      D.settle(chrome.downloads, id, path).then(sendResponse);
    }
  );
  return true;
});
