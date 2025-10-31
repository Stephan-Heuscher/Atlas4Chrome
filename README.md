# Atlas4Chrome Helper (dev files)

Files added to this folder:

- `manifest.json` — MV3 manifest requesting `tabs`, `scripting`, and `storage` permissions and registering `background.js` as the service worker.
- `background.js` — Minimal background service worker that listens for install and a test message to inject a small script into a tab.

How to load the extension in Chrome (developer mode):

1. Open Chrome and go to chrome://extensions/
2. Enable "Developer mode" (top-right).
3. Click "Load unpacked" and pick the folder:

   `c:\Users\S\OneDrive\Dokumente\Programme\Atlas4Chrome`

Testing the background worker's example injection:

- Open any web page (e.g., https://example.com).
- Open DevTools (F12) on that page and run this in the console to send a message to the service worker:

```js
// Replace <TAB_ID> with the tab id (or omit and rely on sender tab when run from a content script)
chrome.runtime.sendMessage({ type: 'INJECT_SCRIPT', tabId: /* your tab id */ , payload: { info: 'hello' } }, (resp) => console.log('resp', resp));
```

Note: If you call `chrome.runtime.sendMessage` from the page console, it won't originate from the tab context that the service worker expects — for a quick test, open the extension's background console via chrome://extensions -> "Service worker" (Inspect views) and send messages from there, or use a small extension popup/content script to message the worker.

Permissions and host access:

- The manifest requests `"tabs"`, `"scripting"`, and `"storage"`. It also includes `host_permissions: ["<all_urls>"]` so scripting.executeScript can run against pages. If you only need specific hosts, replace `<all_urls>` with a narrower pattern.

Next steps you might want:

- Add icons under `icons/` as referenced in the manifest.
- Add a popup or options page to provide UI for triggering injections or storing settings.
