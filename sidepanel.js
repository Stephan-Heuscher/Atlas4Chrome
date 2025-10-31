document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('start');
  const stopBtn = document.getElementById('stop');
  const goalEl = document.getElementById('goal');
  const statusEl = document.getElementById('status');
  const optionsLink = document.getElementById('optionsLink');

  optionsLink.addEventListener('click', (e) => {
    e.preventDefault();
    // Open options page
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    else window.open('options.html');
  });

  startBtn.addEventListener('click', () => {
    const goal = goalEl.value.trim();
    if (!goal) {
      statusEl.textContent = 'Please enter a goal.';
      return;
    }
    statusEl.textContent = 'Starting agent...';
    chrome.runtime.sendMessage({ type: 'START_AGENT', goal }, (resp) => {
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
});
