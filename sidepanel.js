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
    
    // Get the active tab in the current window
    const tabs = await new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, resolve);
    });
    
    if (tabs.length === 0) {
      statusEl.textContent = 'Error: No active tab found.';
      return;
    }
    
    const activeTabId = tabs[0].id;
    statusEl.textContent = 'Starting agent...';
    
    chrome.runtime.sendMessage({ type: 'START_AGENT', goal, tabId: activeTabId }, (resp) => {
      if (chrome.runtime.lastError) {
        statusEl.textContent = 'Error: ' + chrome.runtime.lastError.message;
        return;
      }
      statusEl.textContent = resp && resp.started ? 'Agent started.' : 'Failed to start agent.';
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
