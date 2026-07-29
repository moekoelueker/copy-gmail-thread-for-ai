// Settling a started download into a truthful path and status.
//
// chrome.downloads.download() hands back an id as soon as the request is
// accepted, which is well before Chrome has picked the name it will write.
// Searching at that moment returns an empty filename, so the reported path fell
// back to the one requested. With conflictAction "uniquify" that is wrong for
// every capture after the first: the manifest said "B2G form.pdf" while the
// bytes landed in "B2G form (1).pdf", pointing a reader at a file from an
// earlier capture. Wait for the name instead, and let a download that dies on
// arrival say so rather than reporting a start it never achieved.
//
// The wait ends at the filename, not at completion: Chrome resolves the name
// almost immediately, while the transfer itself can take as long as the file is
// large, and the capture must not block on it.

(() => {
  const CT = (globalThis.CT = globalThis.CT || {});
  const S = CT.security;

  const FILENAME_TIMEOUT_MS = 5000;
  const INTERRUPTED = { ok: false, error: "download interrupted" };

  function settle(api, id, requestedPath, options = {}) {
    const timeoutMs = Number.isFinite(options.timeoutMs)
      ? options.timeoutMs
      : FILENAME_TIMEOUT_MS;

    return new Promise((resolve) => {
      let done = false;
      let timer = null;

      const finish = (result) => {
        if (done) return;
        done = true;
        api.onChanged.removeListener(onChanged);
        if (timer !== null) clearTimeout(timer);
        resolve(result);
      };

      const started = (filename) =>
        finish({
          ok: true,
          path: S.reportedDownloadPath(filename, requestedPath),
          status: "download started",
        });

      function onChanged(delta) {
        if (!delta || delta.id !== id) return;
        if (delta.state && delta.state.current === "interrupted") return finish(INTERRUPTED);
        const name = delta.filename && delta.filename.current;
        if (name) started(name);
      }

      // Listen before searching. A small attachment can resolve its name
      // between the two calls, and that event must not be missed.
      api.onChanged.addListener(onChanged);

      // Chrome can also go quiet — a worker eviction, or a state this code does
      // not model. Answering late is a bug; answering with an honest caveat is
      // not, and it keeps the content script from waiting on a dead port.
      timer = setTimeout(
        () =>
          finish({
            ok: true,
            path: requestedPath,
            status: "download started (path unverified)",
          }),
        timeoutMs
      );

      api.search({ id }, (items) => {
        const item = items && items[0];
        if (!item) return;
        if (item.state === "interrupted") return finish(INTERRUPTED);
        if (item.filename) started(item.filename);
      });
    });
  }

  CT.downloads = { settle, FILENAME_TIMEOUT_MS };
})();
