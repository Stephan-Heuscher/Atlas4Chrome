# Atlas4Chrome — Gemini 2.5 Agent Scaffold

This workspace contains a Chrome Manifest V3 extension that runs an autonomous agent using the Gemini 2.5 Computer Use Model directly from the browser.

**IMPORTANT**: This version stores your Gemini API key in your browser's synchronized storage (`chrome.storage.sync`). While convenient for development, be aware of the security implications of storing sensitive keys on the client-side.

## How to Install and Run

### 1. Set Your API Key
- Right-click the extension icon in your Chrome toolbar and select "Options".
- Paste your Gemini API key into the input field and click "Save".
- The key is now stored and will be used for all API requests.

### 2. Load the Extension in Chrome
- Open Chrome and navigate to `chrome://extensions/`.
- Enable "Developer mode" using the toggle in the top-right corner.
- Click the "Load unpacked" button.
- Select the folder `c:\Users\S\OneDrive\Dokumente\Programme\Atlas4Chrome`.

### 3. Run the Agent
- Click the extension icon to open the popup.
- Enter a goal for the agent in the textarea (e.g., "search for the weather in New York").
- Click "Start Agent".
- The agent will now take control of the active tab, capturing screenshots and sending them to the Gemini API to decide the next action. You can observe its progress in the DevTools console of the page it is operating on.

## Key Files
- `manifest.json`: Configures the extension, permissions (`activeTab`, `scripting`, `storage`, `tabs`), and registers the options page.
- `background.js`: The "Brain". Contains the main agent loop, captures screenshots, and makes direct API calls to the Gemini model.
- `content.js`: The "Hands". Executes actions (click, type, scroll) on the web page based on commands from the background script.
- `popup.html` / `popup.js`: The user interface for starting the agent.
- `options.html` / `options.js`: The options page for managing your API key.
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
