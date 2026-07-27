// Service worker.
//
// Two jobs: route keyboard commands to the Gmail tab, and perform downloads
// (content scripts cannot call chrome.downloads).
//
// Notably absent: chrome.scripting and any MAIN-world injection. v1 injected
// into Gmail's own JavaScript context to read a session token; v2 reads the
// same value from the isolated world, so that capability is gone.

const GMAIL = /^https:\/\/mail\.google\.com\//;

async function activeGmailTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return null;
  // tab.url is populated because mail.google.com is in host_permissions.
  if (tab.url && !GMAIL.test(tab.url)) return null;
  return tab;
}

async function dispatch(mode) {
  const tab = await activeGmailTab();
  if (!tab) return; // Not on Gmail. The popup explains what to do.
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "run", mode });
  } catch (e) {
    // Content script not present yet (Gmail still loading, or the tab predates
    // an extension reload). Nothing useful to do without a notifications
    // permission, so log it rather than failing silently and invisibly.
    console.warn("[copy-gmail-thread] could not reach the page:", e?.message || e);
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command === "copy-thread") dispatch("copy");
  else if (command === "save-thread") dispatch("save");
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "download") return false;

  // Only ever act on requests originating from a Gmail tab.
  if (!sender.tab || !GMAIL.test(sender.tab.url || "")) {
    sendResponse({ ok: false });
    return false;
  }
  // Defence in depth: the filename is derived from attacker-controlled input
  // and is already sanitised in lib/attachments.js. Refuse anything that still
  // looks like traversal rather than trusting the downloads API to catch it.
  const path = String(msg.path || "");
  if (!path || path.includes("..") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    console.warn("[copy-gmail-thread] refused suspicious download path:", path);
    sendResponse({ ok: false });
    return false;
  }

  chrome.downloads.download(
    { url: msg.url, filename: path, conflictAction: "uniquify", saveAs: false },
    (id) => {
      if (chrome.runtime.lastError || id === undefined) {
        console.warn("[copy-gmail-thread] download failed:", chrome.runtime.lastError?.message);
        sendResponse({ ok: false });
      } else {
        sendResponse({ ok: true, id });
      }
    }
  );
  return true; // async response
});
