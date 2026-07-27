// Gmail-page orchestration and user interface.

(() => {
  const CT = globalThis.CT;
  const { adapter: A, format: F, attachments: AT } = CT;

  const MESSAGES = {
    NOT_ON_THREAD: "Open an email thread first.",
    NOT_LOGGED_IN: "Your Gmail session expired. Reload Gmail, sign in, and try again.",
    FETCH_FAILED: "Gmail couldn't provide this thread, and no visible messages could be read.",
    PARSE_EMPTY: "Gmail returned no messages that the extension could safely parse.",
    WRONG_THREAD: "Gmail returned a different conversation. Nothing was copied.",
    AMBIGUOUS_PAGE:
      "Couldn't identify the open conversation on this page. Reload Gmail and try again.",
    THREAD_CHANGED: "The open conversation changed while copying. Nothing was copied.",
    CLIPBOARD_BLOCKED:
      "Chrome blocked the clipboard. Click Gmail and retry; file downloads may already have started.",
  };

  const SIZE_WARN_BYTES = 400 * 1024;
  const MESSAGE_WARN_COUNT = 150;

  let toastEl = null;
  let toastTimers = [];

  function toast(text, opts = {}) {
    toastTimers.forEach(clearTimeout);
    toastTimers = [];
    if (toastEl) toastEl.remove();

    toastEl = document.createElement("div");
    toastEl.className = "ctl-toast" + (opts.warn ? " ctl-toast-warn" : "");
    toastEl.setAttribute("role", opts.warn ? "alert" : "status");
    toastEl.setAttribute("aria-live", opts.warn ? "assertive" : "polite");
    toastEl.textContent = text;
    document.body.appendChild(toastEl);

    const life = opts.sticky ? 15000 : opts.warn ? 7000 : 3000;
    const el = toastEl;
    toastTimers.push(setTimeout(() => el.classList.add("ctl-toast-out"), life - 400));
    toastTimers.push(setTimeout(() => el.remove(), life));
  }

  function writeViaTextarea(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("aria-hidden", "true");
    textarea.style.cssText = "position:fixed;top:-1000px;left:-1000px;opacity:0;";
    document.body.appendChild(textarea);
    textarea.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e) {
      console.warn("[copy-gmail-thread] execCommand copy failed:", e);
    }
    textarea.remove();
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

  function requestDownload(url, path, context) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          {
            type: "download",
            url,
            path,
            threadId: context.threadId,
          },
          (response) => {
            if (chrome.runtime.lastError) {
              console.warn("[copy-gmail-thread]", chrome.runtime.lastError.message);
              resolve({ ok: false, error: "download failed to start" });
              return;
            }
            resolve(response || { ok: false, error: "download failed to start" });
          }
        );
      } catch (e) {
        console.warn("[copy-gmail-thread] download message failed:", e);
        resolve({ ok: false, error: "download failed to start" });
      }
    });
  }

  function addWarning(thread, code, message) {
    thread.warnings = Array.isArray(thread.warnings) ? thread.warnings : [];
    if (!thread.warnings.some((warning) => warning.code === code && warning.message === message)) {
      thread.warnings.push({ code, message });
    }
  }

  function captureComplete(thread) {
    const c = thread.completeness || {};
    return c.messages === true && c.headers === true && c.attachments === true;
  }

  let busy = false;

  function setControlsBusy(value) {
    for (const group of document.querySelectorAll(".ctl-actions")) {
      group.setAttribute("aria-busy", String(value));
    }
    for (const button of document.querySelectorAll(".ctl-actions button")) {
      button.disabled = value;
      button.classList.toggle("ctl-loading", value);
    }
  }

  async function run(mode, viaGesture) {
    if (busy) {
      toast("A thread copy is already in progress.");
      return;
    }
    busy = true;
    setControlsBusy(true);
    try {
      const state = A.pageState();
      if (state !== "thread") {
        toast(state === "ambiguous" ? MESSAGES.AMBIGUOUS_PAGE : MESSAGES.NOT_ON_THREAD, {
          warn: true,
        });
        return;
      }

      toast(mode === "save" ? "Copying thread and starting file downloads…" : "Copying thread…", {
        sticky: true,
      });
      const response = await A.getThread();
      if (!response.ok) {
        toast(MESSAGES[response.error] || MESSAGES.PARSE_EMPTY, { warn: true, sticky: true });
        return;
      }

      const thread = response.thread;
      if (!A.identityMatches(thread)) {
        toast(MESSAGES.THREAD_CHANGED, { warn: true, sticky: true });
        return;
      }
      const context = {
        threadId: thread.threadId,
        accountIndex: thread.accountIndex,
      };

      let attachmentSummary = {
        total: 0,
        inlined: 0,
        inlineFailed: 0,
        inlineSkipped: 0,
        inlineTruncated: 0,
        downloadStarted: 0,
        downloadFailed: 0,
        skipped: 0,
        unsafe: 0,
        noLink: 0,
      };
      try {
        const liveResult = A.getAttachments(thread);
        const live = liveResult.items;
        if (liveResult.truncated) {
          thread.completeness.attachments = false;
          addWarning(
            thread,
            "ATTACHMENT_SCAN_LIMIT",
            `Live attachment discovery stopped at ${A.MAX_LIVE_ATTACHMENTS} candidates.`
          );
        }
        const merged = AT.mergeRaw(thread.attachments, live, context);
        if (merged.supplementalOnly > 0) {
          thread.completeness.attachments = false;
          addWarning(
            thread,
            "ATTACHMENT_ATTRIBUTION_UNKNOWN",
            `${merged.supplementalOnly} attachment(s) were visible on the Gmail page but missing ` +
              "from the print-view parse; their message attribution is unknown."
          );
        }

        const collected = await AT.collect(
          merged.items,
          thread.subject,
          mode,
          requestDownload,
          context
        );
        thread.attachments = collected.items;
        attachmentSummary = collected.summary;

        if (attachmentSummary.unsafe || attachmentSummary.noLink) {
          thread.completeness.attachments = false;
          addWarning(
            thread,
            "ATTACHMENT_UNAVAILABLE",
            "At least one attachment lacked a verified Gmail download link and was not fetched."
          );
        }
        if (attachmentSummary.downloadFailed) {
          addWarning(
            thread,
            "DOWNLOAD_FAILED",
            `${attachmentSummary.downloadFailed} download(s) failed to start.`
          );
        }
        if (attachmentSummary.inlineFailed) {
          addWarning(
            thread,
            "INLINE_ATTACHMENT_FAILED",
            `${attachmentSummary.inlineFailed} text attachment(s) could not be read.`
          );
        }
        if (attachmentSummary.inlineSkipped) {
          addWarning(
            thread,
            "INLINE_ATTACHMENT_LIMIT",
            `${attachmentSummary.inlineSkipped} text attachment(s) were not inlined because ` +
              "the per-thread text limit was reached."
          );
        }
        if (attachmentSummary.inlineTruncated) {
          addWarning(
            thread,
            "INLINE_ATTACHMENT_TRUNCATED",
            `${attachmentSummary.inlineTruncated} text attachment(s) were truncated at a safe limit.`
          );
        }
        if (attachmentSummary.skipped) {
          addWarning(
            thread,
            "DOWNLOAD_SKIPPED",
            `${attachmentSummary.skipped} attachment(s) exceeded the safe download limit.`
          );
        }
      } catch (e) {
        console.warn("[copy-gmail-thread] attachment processing failed:", e);
        thread.completeness.attachments = false;
        addWarning(
          thread,
          "ATTACHMENT_PROCESSING_FAILED",
          "Attachment processing failed; message text was still copied."
        );
      }

      thread.complete = captureComplete(thread);
      const output = F.build(thread);
      if (!(await copyToClipboard(output, viaGesture))) {
        toast(MESSAGES.CLIPBOARD_BLOCKED, { warn: true, sticky: true });
        return;
      }

      const messageCount = thread.messages.length;
      const parts = [`${messageCount} message${messageCount === 1 ? "" : "s"}`];
      if (attachmentSummary.total) {
        parts.push(
          `${attachmentSummary.total} attachment${attachmentSummary.total === 1 ? "" : "s"}`
        );
      }
      if (attachmentSummary.inlined) parts.push(`${attachmentSummary.inlined} inlined`);
      if (attachmentSummary.inlineFailed) {
        parts.push(`${attachmentSummary.inlineFailed} inline read failed`);
      }
      if (attachmentSummary.inlineSkipped) {
        parts.push(`${attachmentSummary.inlineSkipped} not inlined`);
      }
      if (attachmentSummary.inlineTruncated) {
        parts.push(`${attachmentSummary.inlineTruncated} truncated`);
      }
      if (attachmentSummary.downloadStarted) {
        parts.push(`${attachmentSummary.downloadStarted} download${attachmentSummary.downloadStarted === 1 ? "" : "s"} started`);
      }
      if (attachmentSummary.downloadFailed) {
        parts.push(`${attachmentSummary.downloadFailed} download${attachmentSummary.downloadFailed === 1 ? "" : "s"} failed`);
      }
      if (attachmentSummary.skipped) parts.push(`${attachmentSummary.skipped} skipped`);
      if (thread.quotedTrimmed) parts.push("quoted text trimmed");

      const outputBytes = new TextEncoder().encode(output).byteLength;
      if (outputBytes > SIZE_WARN_BYTES || messageCount > MESSAGE_WARN_COUNT) {
        parts.push(formatOutputSize(outputBytes));
      }

      const operationalWarning =
        attachmentSummary.downloadFailed ||
        attachmentSummary.skipped ||
        attachmentSummary.inlineFailed ||
        attachmentSummary.inlineSkipped ||
        attachmentSummary.inlineTruncated ||
        attachmentSummary.unsafe ||
        attachmentSummary.noLink;
      if (!thread.complete || operationalWarning) {
        toast(`⚠ Copied ${parts.join(" · ")} — review warnings in the pasted output`, {
          warn: true,
          sticky: true,
        });
      } else {
        toast(`✓ Copied ${parts.join(" · ")}`);
      }
    } catch (e) {
      console.error("[copy-gmail-thread] unexpected failure:", e);
      toast("Something went wrong. See the console; file downloads may already have started.", {
        warn: true,
        sticky: true,
      });
    } finally {
      busy = false;
      setControlsBusy(false);
    }
  }

  function formatOutputSize(bytes) {
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function makeAction(label, className, mode, description) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `ctl-btn ${className}`;
    button.textContent = label;
    button.setAttribute("aria-label", description);
    button.title = description;
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await run(mode, true);
    });
    return button;
  }

  function attachButtons() {
    const subject = A.subjectElement();
    if (!subject?.parentElement) return;
    if (subject.nextElementSibling?.classList.contains("ctl-actions")) return;
    document.querySelectorAll(".ctl-actions").forEach((group) => group.remove());

    const group = document.createElement("span");
    group.className = "ctl-actions";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Copy Gmail thread");
    group.setAttribute("aria-busy", "false");
    group.append(
      makeAction(
        "Copy thread",
        "ctl-btn-copy",
        "copy",
        "Copy this conversation as structured text"
      ),
      makeAction(
        "Copy + save files",
        "ctl-btn-save",
        "save",
        "Copy this thread and start downloads for its attachments"
      )
    );
    subject.insertAdjacentElement("afterend", group);
  }

  function contextAlive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch (_) {
      return false;
    }
  }

  let pending = null;
  const observer = new MutationObserver(() => {
    if (!contextAlive()) {
      observer.disconnect();
      document.querySelectorAll(".ctl-actions, .ctl-toast").forEach((element) => element.remove());
      return;
    }
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      attachButtons();
    }, 250);
  });

  observer.observe(document.body, { childList: true, subtree: true });
  attachButtons();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "run") {
      run(message.mode === "save" ? "save" : "copy", Boolean(message.viaGesture));
      sendResponse({ ok: true });
    } else if (message?.type === "ping") {
      const state = A.pageState();
      sendResponse({ ok: true, onThread: state === "thread", state });
    }
    return false;
  });
})();
