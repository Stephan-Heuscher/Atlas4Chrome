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
});
