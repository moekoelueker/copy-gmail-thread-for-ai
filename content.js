// Orchestration and UI. Everything provider-specific lives in adapters/gmail.js.

(() => {
  const CT = globalThis.CT;
  const { adapter: A, format: F, attachments: AT } = CT;
  const ERR = A.ERR;

  const MESSAGES = {
    NOT_ON_THREAD: "Open an email thread first.",
    NO_IK: "Couldn't read Gmail's session key — reload Gmail and retry.",
    NOT_LOGGED_IN: "Gmail session expired — reload and sign in.",
    FETCH_FAILED: "Gmail wouldn't return the thread — reload and retry.",
    PARSE_EMPTY: "Couldn't read any messages from this thread.",
    WRONG_THREAD: "Gmail returned a different conversation — nothing copied. Reload and retry.",
    CLIPBOARD_BLOCKED: "Clipboard blocked — click the page, then try again.",
  };

  const SIZE_WARN_BYTES = 400 * 1024;
  const MESSAGE_WARN_COUNT = 150;

  // ---------- toast ----------

  let toastEl = null;
  let toastTimers = [];

  function toast(text, opts = {}) {
    toastTimers.forEach(clearTimeout);
    toastTimers = [];
    if (toastEl) toastEl.remove();

    toastEl = document.createElement("div");
    toastEl.className = "ctl-toast" + (opts.warn ? " ctl-toast-warn" : "");
    toastEl.setAttribute("role", "status");
    toastEl.setAttribute("aria-live", "polite");
    toastEl.textContent = text;
    document.body.appendChild(toastEl);

    const life = opts.sticky ? 15000 : opts.warn ? 6000 : 2600;
    const el = toastEl;
    toastTimers.push(setTimeout(() => el.classList.add("ctl-toast-out"), life - 400));
    toastTimers.push(setTimeout(() => el.remove(), life));
  }

  // ---------- clipboard ----------
  //
  // Two paths on purpose. A button click carries transient user activation, so
  // the async API is clean. A keyboard command does not, and since Chrome 107 a
  // command-triggered navigator.clipboard call can raise a permission prompt —
  // so that path uses execCommand, which the clipboardWrite permission covers.

  function writeViaTextarea(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("aria-hidden", "true");
    ta.style.cssText = "position:fixed;top:-1000px;left:-1000px;opacity:0;";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e) {
      console.warn("[copy-gmail-thread] execCommand copy failed:", e);
    }
    ta.remove();
    return ok;
  }

  async function copyToClipboard(text, viaGesture) {
    if (viaGesture && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) {
        console.warn("[copy-gmail-thread] async clipboard failed, falling back:", e);
      }
    }
    return writeViaTextarea(text);
  }

  // ---------- downloads ----------

  function requestDownload(url, path) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "download", url, path }, (resp) => {
          if (chrome.runtime.lastError) {
            console.warn("[copy-gmail-thread]", chrome.runtime.lastError.message);
            return resolve({ ok: false });
          }
          resolve(resp || { ok: false });
        });
      } catch (e) {
        console.warn("[copy-gmail-thread] download message failed:", e);
        resolve({ ok: false });
      }
    });
  }

  // ---------- main ----------

  let busy = false;

  async function run(mode, viaGesture) {
    if (busy) return;
    busy = true;
    try {
      if (!A.isThreadOpen()) {
        toast(MESSAGES.NOT_ON_THREAD);
        return;
      }
      toast(mode === "save" ? "Copying thread and saving attachments…" : "Copying thread…", {
        sticky: true,
      });

      const res = await A.getThread();
      if (!res.ok) {
        toast(MESSAGES[res.error] || MESSAGES.PARSE_EMPTY, { warn: true });
        return;
      }
      const thread = res.thread;

      // Attachments found in the print view are attributed to their own message
      // and must still be processed — inlined if they are text, downloaded on a
      // save. Without this they were listed but never fetched, which quietly
      // made the save action a no-op.
      try {
        let found = 0;
        for (const m of thread.messages) {
          if (!m.attachments || !m.attachments.length) continue;
          found += m.attachments.length;
          m.attachments = await AT.collect(m.attachments, thread.subject, mode, requestDownload);
        }

        // Only fall back to scanning the live page when the print view gave us
        // nothing; otherwise the same files would be listed twice.
        if (!found) {
          const raw = A.getAttachments();
          if (raw.length) {
            thread.attachments = await AT.collect(raw, thread.subject, mode, requestDownload);
          }
        }
      } catch (e) {
        console.warn("[copy-gmail-thread] attachment collection failed:", e);
      }

      const output = F.build(thread);
      const wrote = await copyToClipboard(output, viaGesture);
      if (!wrote) {
        toast(MESSAGES.CLIPBOARD_BLOCKED, { warn: true });
        return;
      }

      const n = thread.messages.length;
      const parts = [`${n} message${n === 1 ? "" : "s"}`];
      if (thread.attachments?.length) {
        const saved = thread.attachments.filter((a) => a.path).length;
        parts.push(
          saved
            ? `${saved} attachment${saved === 1 ? "" : "s"} saved`
            : `${thread.attachments.length} attachment${thread.attachments.length === 1 ? "" : "s"} listed`
        );
      }
      if (thread.quotedTrimmed) parts.push("quoted text trimmed");
      if (output.length > SIZE_WARN_BYTES || n > MESSAGE_WARN_COUNT) {
        parts.push(`${Math.round(output.length / 1024)} KB`);
      }

      // A partial capture must never be reported as a clean success.
      if (thread.complete === false) {
        toast(`⚠ Copied ${parts.join(" · ")} — collapsed messages may be missing`, {
          warn: true,
        });
      } else {
        toast(`✓ Copied ${parts.join(" · ")}`);
      }
    } catch (e) {
      console.error("[copy-gmail-thread] unexpected failure:", e);
      toast("Something went wrong — see the console for details.", { warn: true });
    } finally {
      busy = false;
    }
  }

  // ---------- button ----------

  function attachButton() {
    const subject = document.querySelector("h2.hP");
    if (!subject?.parentElement) return;
    if (subject.parentElement.querySelector(".ctl-btn")) return;

    const b = document.createElement("button");
    b.type = "button";
    b.className = "ctl-btn";
    b.textContent = "Copy Email Thread";
    b.setAttribute("aria-label", "Copy this email thread as LLM-ready text");
    b.title = "Copy the full thread (see chrome://extensions/shortcuts for the keyboard shortcut)";
    b.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      b.disabled = true;
      b.classList.add("ctl-loading");
      await run("copy", true);
      b.classList.remove("ctl-loading");
      b.disabled = false;
    });
    subject.parentElement.appendChild(b);
  }

  function contextAlive() {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  // Gmail mutates its DOM constantly. The previous version ran this handler on
  // every single mutation; debouncing keeps it off the critical path.
  let pending = null;
  const observer = new MutationObserver(() => {
    if (!contextAlive()) {
      observer.disconnect();
      document.querySelectorAll(".ctl-btn, .ctl-toast").forEach((el) => el.remove());
      return;
    }
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      attachButton();
    }, 250);
  });

  observer.observe(document.body, { childList: true, subtree: true });
  attachButton();

  // Keyboard shortcuts are declared in the manifest and dispatched by the
  // service worker, so they are remappable at chrome://extensions/shortcuts and
  // never shadow the browser's own copy.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "run") {
      run(msg.mode === "save" ? "save" : "copy", Boolean(msg.viaGesture));
      sendResponse({ ok: true });
    } else if (msg?.type === "ping") {
      sendResponse({ ok: true, onThread: A.isThreadOpen() });
    }
    return false;
  });
})();
