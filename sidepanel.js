document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('start');
  const stopBtn = document.getElementById('stop');
  const goalEl = document.getElementById('goal');
  const statusEl = document.getElementById('status');
  const optionsLink = document.getElementById('optionsLink');

  // Safety confirmation UI elements
  const safetyDialog = document.getElementById('safetyDialog');
  const safetyExplanation = document.getElementById('safetyExplanation');
  const safetyAllow = document.getElementById('safetyAllow');
  const safetyDeny = document.getElementById('safetyDeny');
  let pendingSafetyCallback = null;

  optionsLink.addEventListener('click', (e) => {
    e.preventDefault();
    // Open options page
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    else window.open('options.html');
  });

  startBtn.addEventListener('click', async () => {
    const goal = goalEl.value.trim();
    if (!goal) {
      statusEl.textContent = 'Please enter a goal.';
      return;
    }
    
    // Get the active tab - try multiple approaches
    let activeTabId = null;
    let activeTabUrl = null;
    
    // Approach 1: Query active tab in current window
    try {
      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, resolve);
      });
      if (tabs && tabs.length > 0) {
        activeTabId = tabs[0].id;
        activeTabUrl = tabs[0].url;
      }
    } catch (e) {
      console.error('Query approach 1 failed:', e);
    }
    
    // Approach 2: If that didn't work, get all tabs and find the active one
    if (!activeTabId) {
      try {
        const tabs = await new Promise((resolve) => {
          chrome.tabs.query({}, resolve);
        });
        const activeTab = tabs.find(t => t.active && !t.url?.startsWith('chrome-extension://'));
        if (activeTab) {
          activeTabId = activeTab.id;
          activeTabUrl = activeTab.url;
        }
      } catch (e) {
        console.error('Query approach 2 failed:', e);
      }
    }
    
    if (!activeTabId) {
      statusEl.textContent = 'Error: Could not determine active tab.';
      console.error('No active tab found');
      return;
    }
    
    console.log(`Starting agent on tab ${activeTabId}: ${activeTabUrl}`);
    statusEl.textContent = `Starting agent on tab ${activeTabId}...`;
    
    chrome.runtime.sendMessage({ type: 'START_AGENT', goal, tabId: activeTabId }, (resp) => {
      if (chrome.runtime.lastError) {
        statusEl.textContent = 'Error: ' + chrome.runtime.lastError.message;
        console.error('Message send error:', chrome.runtime.lastError);
        return;
      }
      statusEl.textContent = resp && resp.started ? `Agent started on tab ${activeTabId}.` : 'Failed to start agent.';
    });
  });

  stopBtn.addEventListener('click', () => {
    // Currently background has no STOP handler; send a STOP message which can be implemented later.
    chrome.runtime.sendMessage({ type: 'STOP_AGENT' }, (resp) => {
      if (chrome.runtime.lastError) {
        statusEl.textContent = 'Error: ' + chrome.runtime.lastError.message;
        return;
      }
      statusEl.textContent = resp && resp.stopped ? 'Agent stopped.' : 'Stop request sent.';
    });
  });

  // Show last agent result if present
  chrome.storage.local.get('lastAgentResult', (items) => {
    if (items && items.lastAgentResult) {
      statusEl.textContent = 'Last result: ' + items.lastAgentResult;
    }
  });

  // Debug area: show last raw model response if present
  const debugEl = document.getElementById('debug');
  const copyBtn = document.getElementById('copyDebug');
  chrome.storage.local.get('lastModelResponse', (items) => {
    if (items && items.lastModelResponse) {
      try { debugEl.value = JSON.stringify(items.lastModelResponse, null, 2); } catch (e) { debugEl.value = String(items.lastModelResponse); }
    }
  });

  // Listen for runtime messages from background with live model responses
  chrome.runtime.onMessage.addListener((msg, sender, resp) => {
    if (!msg || msg.type !== 'MODEL_RAW') return;
    try { debugEl.value = JSON.stringify(msg.payload, null, 2); } catch (e) { debugEl.value = String(msg.payload); }
  });

  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(debugEl.value);
        statusEl.textContent = 'Debug copied to clipboard.';
        setTimeout(() => statusEl.textContent = '', 1500);
      } catch (e) {
        statusEl.textContent = 'Copy failed: ' + e.message;
      }
    });
  }

  // Safety confirmation handlers
  safetyAllow.addEventListener('click', () => {
    statusEl.textContent = 'Safety confirmation: ALLOW';
    safetyDialog.style.display = 'none';
    if (pendingSafetyCallback) {
      pendingSafetyCallback(true);
      pendingSafetyCallback = null;
    }
  });

  safetyDeny.addEventListener('click', () => {
    statusEl.textContent = 'Safety confirmation: DENY';
    safetyDialog.style.display = 'none';
    if (pendingSafetyCallback) {
      pendingSafetyCallback(false);
      pendingSafetyCallback = null;
    }
  });

  // Listen for safety confirmation requests from background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'REQUEST_SAFETY_CONFIRMATION') return;
    
    // Show the safety dialog with explanation
    safetyExplanation.textContent = msg.explanation || 'The agent is about to perform an action that requires your confirmation.';
    safetyDialog.style.display = 'block';
    
    // Store callback to respond when user confirms/denies
    pendingSafetyCallback = (allowed) => {
      sendResponse({ safety_acknowledged: allowed });
    };
  });
});
