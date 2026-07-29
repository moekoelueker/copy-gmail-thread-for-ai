const test = require("node:test");
const assert = require("node:assert");
const CT = require("./loader");

const D = CT.downloads;

// A stand-in for the parts of chrome.downloads this module touches. Callback
// style, because that is what the service worker gets.
function fakeApi(items = []) {
  const listeners = [];
  return {
    listeners,
    search(query, cb) {
      cb(items.filter((item) => item.id === query.id));
    },
    onChanged: {
      addListener: (fn) => listeners.push(fn),
      removeListener: (fn) => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      },
    },
    emit(delta) {
      for (const fn of listeners.slice()) fn(delta);
    },
  };
}

const REQUESTED = "gmail-threads/q3-invoices/B2G form.pdf";

test("reports the name Chrome actually wrote, not the one requested", async () => {
  const api = fakeApi([{ id: 7, filename: "", state: "in_progress" }]);
  const settled = D.settle(api, 7, REQUESTED);

  api.emit({
    id: 7,
    filename: { previous: "", current: "/Users/me/Downloads/gmail-threads/q3-invoices/B2G form (2).pdf" },
  });

  assert.deepStrictEqual(await settled, {
    ok: true,
    path: "gmail-threads/q3-invoices/B2G form (2).pdf",
    status: "download started",
  });
});

test("uses a filename already resolved before the listener attaches", async () => {
  const api = fakeApi([
    {
      id: 7,
      filename: "/Users/me/Downloads/gmail-threads/q3-invoices/B2G form (1).pdf",
      state: "in_progress",
    },
  ]);

  assert.deepStrictEqual(await D.settle(api, 7, REQUESTED), {
    ok: true,
    path: "gmail-threads/q3-invoices/B2G form (1).pdf",
    status: "download started",
  });
});

test("an interrupted download is a failure, not a start", async () => {
  const api = fakeApi([{ id: 7, filename: "", state: "in_progress" }]);
  const settled = D.settle(api, 7, REQUESTED);

  api.emit({ id: 7, state: { previous: "in_progress", current: "interrupted" } });

  assert.deepStrictEqual(await settled, { ok: false, error: "download interrupted" });
});

test("a download already interrupted at search time never claims to have started", async () => {
  const api = fakeApi([{ id: 7, filename: "", state: "interrupted" }]);

  assert.deepStrictEqual(await D.settle(api, 7, REQUESTED), {
    ok: false,
    error: "download interrupted",
  });
});

test("a filename that never arrives falls back to the request and says so", async () => {
  const api = fakeApi([{ id: 7, filename: "", state: "in_progress" }]);

  assert.deepStrictEqual(await D.settle(api, 7, REQUESTED, { timeoutMs: 20 }), {
    ok: true,
    path: REQUESTED,
    status: "download started (path unverified)",
  });
});

test("another download's progress never settles this one", async () => {
  const api = fakeApi([{ id: 7, filename: "", state: "in_progress" }]);
  const settled = D.settle(api, 7, REQUESTED, { timeoutMs: 40 });

  api.emit({ id: 8, filename: { current: "/Users/me/Downloads/gmail-threads/q3-invoices/other.pdf" } });

  assert.strictEqual((await settled).path, REQUESTED, "settled on a different download's event");
});

test("the change listener is released once the download settles", async () => {
  const api = fakeApi([{ id: 7, filename: "", state: "in_progress" }]);
  const settled = D.settle(api, 7, REQUESTED);
  assert.strictEqual(api.listeners.length, 1);

  api.emit({ id: 7, filename: { current: "/Users/me/Downloads/gmail-threads/q3-invoices/B2G form.pdf" } });
  await settled;

  assert.strictEqual(api.listeners.length, 0, "listener leaked past the download");
});
