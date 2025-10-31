// Background service worker - Agent Brain (MV3)
// Responsibilities:
// - Accept a START_AGENT message with a `goal` string
// - Run runAgentCycle(goal) which captures screenshots, sends them to the Gemini placeholder,
//   receives actions, and dispatches those actions to the content script (the Hands).

console.log('Atlas4Chrome service worker loaded.');

// Promisified chrome.storage helpers
function storageGet(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (res) => resolve(res && res[key]));
  });
}

function storageSet(obj) {
  return new Promise((resolve) => {
    chrome.storage.local.set(obj, () => resolve());
  });
}

function storageSyncGet(key) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(key, (res) => resolve(res && res[key]));
  });
}

// Helper: broadcast raw model response to any UI and persist to storage for debugging
function broadcastModelRaw(obj) {
  try {
    chrome.storage.local.set({ lastModelResponse: obj });
  } catch (e) {
    console.warn('Failed to write lastModelResponse to storage', e);
  }
  try {
    chrome.runtime.sendMessage({ type: 'MODEL_RAW', payload: obj });
  } catch (e) {
    // ignore
  }
}

// Utility: promisified captureVisibleTab
function captureVisibleTabAsync(windowId = null, format = 'jpeg', quality = 60) {
  return new Promise((resolve, reject) => {
    try {
      const opts = { format };
      if (format === 'jpeg' && typeof quality === 'number') opts.quality = quality;
      chrome.tabs.captureVisibleTab(windowId, opts, (dataUrl) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve(dataUrl);
      });
    } catch (err) {
      reject(err);
    }
  });
}

// Try to capture a small thumbnail by lowering JPEG quality until the base64
// payload is below maxBytes or until qualities are exhausted.
async function captureThumbnail(windowId = null, maxBytes = 15000) {
  const qualities = [60, 40, 25, 10];
  let sawQuotaError = false;
  for (const q of qualities) {
    try {
      const dataUrl = await captureVisibleTabAsync(windowId, 'jpeg', q);
      if (!dataUrl) continue;
      const base64 = dataUrl.split(',')[1] || '';
      if (base64.length <= maxBytes) return dataUrl;
      // otherwise continue to next lower quality
    } catch (err) {
      console.warn('captureVisibleTab failed at quality', q, err && err.message ? err.message : err);
      if (err && err.message && /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(err.message)) sawQuotaError = true;
    }
  }
  // As a last resort attempt a PNG capture (may be larger) and return it.
  try {
    const png = await captureVisibleTabAsync(windowId, 'png');
    return png;
  } catch (err) {
    console.warn('Final PNG capture failed', err && err.message ? err.message : err);
    if (err && err.message && /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(err.message)) sawQuotaError = true;
    // If we saw a quota error, surface that to caller so they can backoff more aggressively
    if (sawQuotaError) {
      const e = new Error('CAPTURE_QUOTA');
      e.code = 'CAPTURE_QUOTA';
      throw e;
    }
    return null;
  }
}

// Utility: promisified sendMessage to tab
function sendMessageToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (resp) => {
      // If the content script is not present, chrome.runtime.lastError will be set
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(resp);
    });
  });
}

// Send screenshot+goal directly to the Gemini 2.5 Computer Use Model API using
// the Computer Use tool (generateMessage endpoint). The API Key is retrieved
// from chrome.storage.sync, set via the options page.
// Use the v1beta2 generateContent endpoint which supports the Computer Use payload shape
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-computer-use-preview-10-2025:generateContent';

async function sendToGemini(screenshotDataUrl, goal, step) {
  const geminiApiKey = await storageSyncGet('geminiApiKey');
  if (!geminiApiKey) {
    console.error('Gemini API key not found. Please set it in the extension options.');
    return { action: 'done', result: 'API key is missing.' };
  }

  try {
    // Build the user prompt describing the goal.
    const userText = `Goal: ${goal}\n\nRespond with ONLY the Computer Use tool function calls. Do not add any other text.`;

    const screenshotBase64 = screenshotDataUrl ? screenshotDataUrl.split(',')[1] : null;

    // Build the official Computer Use request per Google docs:
    // https://ai.google.dev/gemini-api/docs/computer-use#send-request
    // The model works with normalized 0-1000 coordinates regardless of input image dimensions.
    // Recommended screen size: 1440x900.
    const contents = [
      {
        role: 'user',
        parts: [
          { text: userText },
          // attach screenshot as inline_data part if available
          ...(screenshotBase64 ? [{ inline_data: { mime_type: 'image/png', data: screenshotBase64 } }] : [])
        ]
      }
    ];

    // Computer Use tool declaration
    const tools = [
      {
        computer_use: {
          environment: 'ENVIRONMENT_BROWSER'
        }
      }
    ];

    const requestBody = {
      contents,
      tools
    };

    let successResponse = null;
    try {
      // Broadcast the payload for debugging
      try { broadcastModelRaw({ payload: requestBody }); } catch (e) {}

      const response = await fetch(`${GEMINI_ENDPOINT}?key=${geminiApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        let errorBodyText = await response.text();
        try { const j = JSON.parse(errorBodyText); if (j && j.error && j.error.message) errorBodyText = j.error.message; } catch (e) {}
        console.error('Gemini API request failed:', response.status, errorBodyText);
        try { broadcastModelRaw({ error: errorBodyText, status: response.status }); } catch (e) {}
        throw new Error(`API request failed with status ${response.status}: ${errorBodyText}`);
      }

      successResponse = response;
    } catch (err) {
      console.error('Network or fetch error:', err && err.message ? err.message : err);
      throw err;
    }

    if (!successResponse) {
      const err = 'Failed to get response from Gemini API';
      console.error(err);
      try { broadcastModelRaw({ error: err }); } catch (e) {}
      throw new Error(err);
    }

    // At this point, successResponse.ok === true, so we can safely parse JSON
    const result = await successResponse.json();
    // Save and broadcast raw response for debugging UIs (side panel / popup)
    try { broadcastModelRaw({ response: result }); } catch (e) { /* ignore */ }

    // Extract function calls from the v1beta generateContent response.
    // Response shape: result.candidates[0].content.parts[], where parts can have .function_call
    try {
      const candidate = result?.candidates && result.candidates[0];
      const parts = candidate?.content?.parts || [];
      // Collect function_call parts
      const functionCalls = parts.filter((p) => p.function_call).map((p) => p.function_call);
      if (functionCalls.length > 0) {
        // Support multiple actions: return the first for now (agent loop will continue)
        const fc = functionCalls[0];
        // fc has { name: string, args: object }
        let args = fc.args || {};
        
        // Check for safety_decision in args
        if (args.safety_decision) {
          console.warn('Safety decision detected:', args.safety_decision);
          if (args.safety_decision.decision === 'require_confirmation') {
            // TODO: Implement user confirmation UI in the side panel
            // For now, log a warning and treat as unsafe
            console.warn('Action requires user confirmation. Model suggests:', args.safety_decision.explanation);
            return { action: 'done', result: `Safety confirmation required: ${args.safety_decision.explanation}` };
          }
        }
        
        // If args is a string, try to parse
        if (typeof args === 'string') {
          try { args = JSON.parse(args); } catch (e) { /* keep as string */ }
        }
        // Return normalized action object containing the function call
        return { action: fc.name, args };
      }
    } catch (e) {
      console.warn('Failed to parse function_call from Gemini generateContent response', e);
    }

    // Fallback: look for textual JSON in candidate parts
    try {
      const textParts = (result?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('\n');
      const jsonMatch = String(textParts).match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const actionObj = JSON.parse(jsonMatch[0]);
        return actionObj;
      }
      return { action: 'done', result: 'No function_call or JSON action found in model response', raw: result };
    } catch (e) {
      console.error('Error extracting JSON from Gemini response', e);
      return { action: 'done', result: `Failed to parse model output: ${e.message}` };
    }

  } catch (err) {
    console.error('Error calling Gemini or parsing response:', err);
    const payload = { action: 'done', result: `An error occurred: ${err.message}` };
    try { broadcastModelRaw({ error: err.message }); } catch (e) {}
    return payload;
  }
}

// Main agent loop: runs until the model returns an action { action: 'done' }
async function runAgentCycle(goal, options = {}) {
  console.log('Agent starting with goal:', goal);
  const maxSteps = options.maxSteps || 10;
  let step = 0;

  // Mark agent as running so STOP_AGENT can interrupt
  await storageSet({ agentShouldRun: true });

  const MIN_CAPTURE_INTERVAL_MS = 1200; // keep captures >1.2s apart to avoid quota

  while (step < maxSteps) {
    step += 1;
    console.log('Agent step', step);

    // 1) Determine the active tab and capture its visible contents
    let screenshot = null;
    let activeTabs = await new Promise((resolve) => chrome.tabs.query({ active: true, lastFocusedWindow: true }, resolve));
    const activeTab = activeTabs && activeTabs[0];
    if (!activeTab) {
      console.warn('No active tab available to operate on. Aborting agent cycle.');
      break;
    }

    try {
      // Respect a minimum interval between captures (persisted across SW restarts)
      const lastCaptureAt = await storageGet('lastCaptureAt') || 0;
      const now = Date.now();
      const since = now - lastCaptureAt;
      if (since < MIN_CAPTURE_INTERVAL_MS) {
        const waitMs = MIN_CAPTURE_INTERVAL_MS - since;
        console.log('Waiting', waitMs, 'ms to respect capture interval');
        await new Promise((r) => setTimeout(r, waitMs));
      }

      // Capture a thumbnail sized JPEG to avoid large payloads.
      try {
        screenshot = await captureThumbnail(activeTab.windowId, 15000);
      } catch (err) {
        if (err && err.code === 'CAPTURE_QUOTA') {
          // The browser reported we hit capture quota. Back off a bit longer and skip the image for this step.
          console.warn('Capture quota hit, backing off for 2s and skipping screenshot this step.');
          await new Promise((r) => setTimeout(r, 2000));
          // Update last capture time to prevent immediate retries
          await storageSet({ lastCaptureAt: Date.now() });
          screenshot = null;
        } else {
          throw err;
        }
      }

      if (screenshot) {
        // record when we last captured successfully
        await storageSet({ lastCaptureAt: Date.now() });
      }
      if (screenshot) {
        const base64 = screenshot.split(',')[1] || '';
        if (base64.length > 20000) {
          console.warn('Captured screenshot is still too large (', base64.length, 'bytes), omitting image from request.');
          screenshot = null;
        }
      }
    } catch (err) {
      console.warn('Failed to capture tab screenshot:', err);
    }

    // Check if user requested stop
    const shouldRun = await storageGet('agentShouldRun');
    if (!shouldRun) {
      console.log('Agent stop requested. Exiting cycle.');
      break;
    }

    // 2) Send screenshot + goal to Gemini (placeholder)
    let geminiAction = null;
    try {
      geminiAction = await sendToGemini(screenshot, goal, step - 1);
    } catch (err) {
      console.error('Gemini API call error:', err);
      break;
    }

    console.log('Gemini ->', geminiAction);

    // 3) Dispatch action to active tab's content script
    if (!geminiAction || !geminiAction.action) {
      console.warn('Invalid action from Gemini:', geminiAction);
      break;
    }

    if (geminiAction.action === 'done') {
      console.log('Agent completed goal:', geminiAction.result || 'done');
      // Optionally store result
      await chrome.storage.local.set({ lastAgentResult: geminiAction.result || 'done' });
      break;
    }

    // Ensure we have an active tab to send actions to. Reuse the previously found activeTab if possible.
    let tab = activeTab;
    if (!tab || !tab.id) {
      const tabs = await new Promise((resolve) => chrome.tabs.query({ active: true, lastFocusedWindow: true }, resolve));
      tab = tabs && tabs[0];
    }
    if (!tab || !tab.id) {
      console.warn('No active tab found to send action to. Aborting agent cycle.');
      break;
    }

    const resp = await sendMessageToTab(tab.id, { type: 'EXEC_ACTION', action: geminiAction });
    console.log('Content script response:', resp);

    if (!resp || !resp.success) {
      console.warn('Action failed or no response from content script:', resp);
      // Optionally decide to retry or abort; here we continue to next step
    }

    // Small delay between steps to avoid rapid looping and to allow the SW to stay alive
    await new Promise((r) => setTimeout(r, 800));
  }

  console.log('Agent cycle finished. Steps:', step);
  return { steps: step };
}

// Message listener: start the agent when the popup sends START_AGENT
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === 'START_AGENT') {
    const goal = message.goal || '';
    // Run the agent (don't block the message) — keep worker alive as needed using alarms if required.
    // Mark run flag and start
    storageSet({ agentShouldRun: true }).then(() => {
      runAgentCycle(goal).then((res) => {
        console.log('runAgentCycle result:', res);
      }).catch((err) => console.error('Agent error:', err));
    });

    sendResponse({ started: true });
    // Return true when sending response asynchronously — indicate we'll send an async response
    return true;
  }

  if (message.type === 'STOP_AGENT') {
    // Cooperative stop: set flag so runAgentCycle will exit between steps
    storageSet({ agentShouldRun: false }).then(() => {
      console.log('STOP_AGENT received; agentShouldRun set to false');
    });
    sendResponse({ stopped: true });
    return true;
  }
});
