// Thin bridge to the native shell (the macOS menu bar app or the iPhone app). In a page the
// Mac app serves itself (http://localhost:4821) the same messages go over HTTP; in any other
// browser every call is a no-op, so the same bundle runs under `vite dev` too.

const webHandler = window.__HOUSE_BOOT__?.platform === 'web' ? httpHandler() : null;
const handler = window.webkit?.messageHandlers?.house || webHandler;

// The browser page's stand-in for WebKit's message handler: each message is a POST, and a
// reply comes back to `incoming.reply` as it would from the app.
function httpHandler() {
  const headers = { 'Content-Type': 'application/json', 'X-House-Bridge': '1' };
  return {
    postMessage(message) {
      fetch('/bridge', { method: 'POST', headers, body: JSON.stringify(message) })
        .then((res) => (res.ok ? res.json() : { result: { error: `HTTP ${res.status}` } }))
        .catch(() => ({ result: { error: 'House Control is not running' } }))
        .then(({ result }) => { if (message.callId) incoming.reply(message.callId, result); });
    },
  };
}

export const isNative = Boolean(handler) && !webHandler;
/** The full page the Mac app serves at http://localhost:4821. */
export const isWeb = Boolean(webHandler);
/** Real devices can be driven: inside the app, or from its browser page. */
export const hasDevices = Boolean(handler);

// 'ios' inside the iPhone app (or with ?platform=ios in a browser, to work on that layout).
export const platform = window.__HOUSE_BOOT__?.platform
  || new URLSearchParams(location.search).get('platform') || (isNative ? 'macos' : 'web');
export const isPhone = platform === 'ios';

export function post(type, payload = {}) {
  handler?.postMessage({ type, ...payload });
}

// A tap you can feel, on the iPhone only: 'tick' for a step of a slider, 'light' /
// 'medium' for a switch or a scene, 'error' when a device refuses a change.
export function haptic(kind = 'light') {
  if (isPhone) post('haptic', { kind });
}

// Native -> JS entry points are attached here by main.js.
export const incoming = (window.house = window.house || {});

// Request/response on top of the one-way message channel.
let nextId = 1;
const pending = new Map();

export function call(type, payload = {}) {
  if (!handler) return Promise.reject(new Error('Only available inside the app'));
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    handler.postMessage({ type, callId: id, ...payload });
  });
}

incoming.reply = (id, result) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  if (result && result.error) p.reject(Object.assign(new Error(result.error), { detail: result }));
  else p.resolve(result);
};

// The browser page reads the devices itself, every few seconds while it is on screen (the
// app only reads them while its own panel is open).
if (webHandler) {
  const read = async () => {
    if (document.hidden || !incoming.applyRemote) return;
    try {
      const res = await fetch('/poll', { headers: { 'X-House-Bridge': '1' } });
      const { update } = await res.json();
      if (update) incoming.applyRemote(update);
    } catch { /* the app is not running: try again on the next tick */ }
  };
  setInterval(read, 5000);
  document.addEventListener('visibilitychange', read);
  setTimeout(read, 600);
}
