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
});
