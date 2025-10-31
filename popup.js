document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('start');
  const clearBtn = document.getElementById('clear');
  const goalEl = document.getElementById('goal');
  const statusEl = document.getElementById('status');

  startBtn.addEventListener('click', () => {
    const goal = goalEl.value.trim();
    if (!goal) {
      statusEl.textContent = 'Please enter a goal.';
      return;
    }
    statusEl.textContent = 'Starting agent...';
    chrome.runtime.sendMessage({ type: 'START_AGENT', goal }, (resp) => {
      if (chrome.runtime.lastError) {
        statusEl.textContent = 'Error starting agent: ' + chrome.runtime.lastError.message;
        return;
      }
      statusEl.textContent = resp && resp.started ? 'Agent started.' : 'Failed to start agent.';
    });
  });

  clearBtn.addEventListener('click', () => {
    goalEl.value = '';
    statusEl.textContent = '';
  });

  // Open the side panel page in a new tab as a fallback if the browser doesn't support the side panel UI
  const openSideBtn = document.getElementById('openSide');
  if (openSideBtn) {
    openSideBtn.addEventListener('click', () => {
      const url = chrome.runtime.getURL('sidepanel.html');
      chrome.tabs.create({ url }, (tab) => {
        if (chrome.runtime.lastError) {
          statusEl.textContent = 'Failed to open side panel page: ' + chrome.runtime.lastError.message;
          return;
        }
        statusEl.textContent = 'Opened side panel in tab.';
      });
    });
  }
});
