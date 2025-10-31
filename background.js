// Minimal MV3 background service worker
// Listens for installation and a simple message to demonstrate scripting injection

chrome.runtime.onInstalled.addListener(() => {
  console.log('Atlas4Chrome background service worker installed.');
});

// Example message handler: supports a message to inject a small script into a tab
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === 'INJECT_SCRIPT') {
    const tabId = message.tabId || sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'no-tab-id' });
      return;
    }

    chrome.scripting.executeScript(
      {
        target: { tabId },
        func: (payload) => {
          // This function runs in the page context.
          // Keep it minimal and self-contained.
          console.log('Atlas4Chrome injected script says hello', payload);
          // Example: attach a temporary element so user can see it
          const el = document.createElement('div');
          el.textContent = 'Atlas4Chrome injected script ran';
          el.style.position = 'fixed';
          el.style.right = '8px';
          el.style.bottom = '8px';
          el.style.zIndex = 999999;
          el.style.background = 'rgba(0,0,0,0.6)';
          el.style.color = 'white';
          el.style.padding = '6px 8px';
          el.style.borderRadius = '4px';
          document.body.appendChild(el);
          setTimeout(() => el.remove(), 3000);
        },
        args: [message.payload]
      },
      (injectionResults) => {
        if (chrome.runtime.lastError) {
          console.error('Script injection failed:', chrome.runtime.lastError);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({ success: true, results: injectionResults });
      }
    );

    // Return true to indicate we'll call sendResponse asynchronously
    return true;
  }
});
