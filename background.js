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

function start(url, path, sendResponse) {
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
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Every decision lives in lib/security.js so it can be tested directly
  // against forged senders. Nothing here re-derives one or works around it.
  if (msg?.type === "download") {
    const decision = S.authorizeDownload(msg, sender, chrome.runtime.id);
    if (!decision.ok) {
      console.warn("[copy-gmail-thread] refused a download request:", decision.error);
      sendResponse({ ok: false, error: decision.error });
      return false;
    }
    start(decision.url, decision.path, sendResponse);
    return true;
  }

  if (msg?.type === "download-thread") {
    const decision = S.authorizeThreadDocument(msg, sender, chrome.runtime.id);
    if (!decision.ok) {
      console.warn("[copy-gmail-thread] refused a thread document request:", decision.error);
      sendResponse({ ok: false, error: decision.error });
      return false;
    }
    // The URL is built here, from text, and never taken from the message. That
    // is the whole reason this path is safe to expose to a content script.
    start(D.dataUrl(decision.text), decision.path, sendResponse);
    return true;
  }

  return false;
});
