document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('start');
  const clearBtn = document.getElementById('clear');
  const goalEl = document.getElementById('goal');
  const statusEl = document.getElementById('status');

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
