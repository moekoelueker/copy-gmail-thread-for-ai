// Popup: the discoverability surface. Without it the extension is invisible to
// anyone who has not read the README, and pressing the shortcut on a non-Gmail
// page would appear to do nothing at all.

const GMAIL = /^https:\/\/mail\.google\.com\//;

const $ = (id) => document.getElementById(id);

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function showShortcuts() {
  const dl = $("shortcuts");
  let commands = [];
  try {
    commands = await chrome.commands.getAll();
  } catch (_) {
    return;
  }
  for (const c of commands) {
    if (!c.description) continue;
    const dt = document.createElement("dt");
    dt.textContent = c.description;
    const dd = document.createElement("dd");
    dd.textContent = c.shortcut || "unset";
    dl.append(dt, dd);
  }
}

async function trigger(mode, button) {
  const tab = await activeTab();
  if (!tab?.id) return;
  button.disabled = true;
  try {
    // viaGesture is false: the click happened in the popup, so the page has no
    // transient activation and the content script must use its execCommand path.
    await chrome.tabs.sendMessage(tab.id, { type: "run", mode, viaGesture: false });
    window.close();
  } catch (e) {
    $("hint").textContent = "Reload the Gmail tab and try again.";
    console.warn("[copy-gmail-thread]", e);
    button.disabled = false;
  }
}

async function init() {
  showShortcuts();

  $("remap").addEventListener("click", () => {
    // chrome:// URLs cannot be plain links from an extension page.
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  });

  const tab = await activeTab();
  const onGmail = Boolean(tab?.url && GMAIL.test(tab.url));

  $("onGmail").hidden = !onGmail;
  $("offGmail").hidden = onGmail;

  if (!onGmail) {
    $("openGmail").addEventListener("click", () => {
      chrome.tabs.create({ url: "https://mail.google.com/" });
    });
    return;
  }

  $("copy").addEventListener("click", (e) => trigger("copy", e.currentTarget));
  $("save").addEventListener("click", (e) => trigger("save", e.currentTarget));

  // Tell the user up front if they are in the inbox list rather than a thread.
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: "ping" });
    if (resp && resp.onThread === false) {
      $("hint").textContent = "No thread open — open an email first.";
      $("copy").disabled = true;
      $("save").disabled = true;
    }
  } catch (_) {
    $("hint").textContent = "Reload the Gmail tab to activate the extension.";
  }
}

init();
