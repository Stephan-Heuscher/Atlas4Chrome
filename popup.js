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
    
    statusEl.textContent = 'Detecting active tab...';
    console.log('=== POPUP: Starting agent detection ===');
    
    // Get the active tab - try multiple approaches
    let activeTabId = null;
    let activeTabUrl = null;
    
    // Approach 1: Query active tab in current window
    console.log('Approach 1: Query active tab in currentWindow');
    try {
      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (result) => {
          console.log('Query result:', result);
          resolve(result);
        });
      });
      if (tabs && tabs.length > 0) {
        activeTabId = tabs[0].id;
        activeTabUrl = tabs[0].url;
        console.log(`✓ Approach 1 success: tab ${activeTabId} - ${activeTabUrl}`);
      } else {
        console.log('Approach 1 returned empty array');
      }
    } catch (e) {
      console.error('Approach 1 failed:', e);
    }
    
    // Approach 2: If that didn't work, query all tabs
    if (!activeTabId) {
      console.log('Approach 2: Query all tabs and find active one');
      try {
        const tabs = await new Promise((resolve) => {
          chrome.tabs.query({}, (result) => {
            console.log('All tabs:', result.map(t => ({ id: t.id, active: t.active, url: t.url })));
            resolve(result);
          });
        });
        const activeTab = tabs.find(t => t.active && !t.url?.startsWith('chrome-extension://'));
        if (activeTab) {
          activeTabId = activeTab.id;
          activeTabUrl = activeTab.url;
          console.log(`✓ Approach 2 success: tab ${activeTabId} - ${activeTabUrl}`);
        } else {
          console.log('Approach 2: No active tab found in list');
        }
      } catch (e) {
        console.error('Approach 2 failed:', e);
      }
    }
    
    if (!activeTabId) {
      statusEl.textContent = 'Error: Could not detect active tab. Check console.';
      console.error('✗ FATAL: No active tab found via either approach');
      return;
    }
    
    console.log(`✓ FINAL: Starting agent on tab ${activeTabId}: ${activeTabUrl}`);
    statusEl.textContent = `Starting agent on tab ${activeTabId}...`;
    
    chrome.runtime.sendMessage({ type: 'START_AGENT', goal, tabId: activeTabId }, (resp) => {
      if (chrome.runtime.lastError) {
        statusEl.textContent = 'Error: ' + chrome.runtime.lastError.message;
        console.error('Message error:', chrome.runtime.lastError);
        return;
      }
      console.log(`✓ Agent started response:`, resp);
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
