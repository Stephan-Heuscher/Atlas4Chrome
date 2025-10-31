// Background service worker - Agent Brain (MV3)
// Responsibilities:
// - Accept a START_AGENT message with a `goal` string
// - Run runAgentCycle(goal) which captures screenshots, sends them to the Gemini placeholder,
//   receives actions, and dispatches those actions to the content script (the Hands).

console.log('Atlas4Chrome service worker loaded.');

// Utility: promisified captureVisibleTab
function captureVisibleTabAsync(windowId = null) {
  return new Promise((resolve, reject) => {
    try {
      // If windowId is null, the API will use the currently focused window. In a
      // service worker context the focused window might be undefined, so prefer
      // explicitly passing the active tab's windowId when available.
      chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve(dataUrl);
      });
    } catch (err) {
      reject(err);
    }
  });
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
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-computer-use-preview-10-2025:generateMessage';

async function sendToGemini(screenshotDataUrl, goal, step) {
  const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
  if (!geminiApiKey) {
    console.error('Gemini API key not found. Please set it in the extension options.');
    return { action: 'done', result: 'API key is missing.' };
  }

  try {
    // Build a user message describing the goal and include a short context.
    const userText = `Agent goal: ${goal}\nStep: ${step || 0}\nReturn a single JSON object describing the next action: {\n  \"action\": \"click|type|scroll|done\",\n  \"selector\": \"...\",\n  \"text\": \"...\"\n}`;

    // Prepare a Computer Use tool definition. The tool tells the model how it
    // may use the environment (the browser) and that we expect a JSON action.
    const tools = [
      {
        name: 'computer_use',
        description: 'Tool for interacting with the browser DOM. When invoked, return a single JSON object describing the next DOM action to take (click/type/scroll/done). Do not include any extra text outside the JSON object.',
        // The exact `parameters`/`args` schema is optional here; the model will
        // typically return a tool invocation with arguments that we parse below.
      }
    ];

    const requestBody = {
      messages: [
        { role: 'system', content: { type: 'text', text: 'You are a precise browser automation assistant. Use the Computer Use tool to return a single JSON action.' } },
        { role: 'user', content: { type: 'text', text: userText } }
      ],
      tools,
      // Attach the screenshot as inline data in the input so the model can inspect it.
      // Some Gemini Computer Use integrations accept inline_data alongside messages.
      // Include it in an attachments-like field if supported by the API.
      // We include a small helper field 'context' to carry the screenshot base64.
      context: {
        screenshot: screenshotDataUrl ? screenshotDataUrl.split(',')[1] : null
      },
      temperature: 0.0,
      maxOutputTokens: 512
    };

    const response = await fetch(`${GEMINI_ENDPOINT}?key=${geminiApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      let errorBodyText = await response.text();
      try { const j = JSON.parse(errorBodyText); if (j && j.error && j.error.message) errorBodyText = j.error.message; } catch (e) {}
      console.error('Gemini API request failed:', response.status, errorBodyText);
      if (response.status === 400 && /Computer Use/i.test(errorBodyText)) {
        const guidance = `Model requires Computer Use tool. See https://ai.google.dev/gemini-api/docs/computer-use for instructions.`;
        console.warn(guidance);
        return { action: 'done', result: guidance + ' Raw error: ' + errorBodyText };
      }
      throw new Error(`API request failed with status ${response.status}: ${errorBodyText}`);
    }

    const result = await response.json();

    // Possible response shapes:
    // 1) A tool invocation: result.candidates[0].message.toolInvocation.arguments
    // 2) A textual response that contains JSON
    // Try to extract a tool invocation first
    try {
      const candidate = result?.candidates && result.candidates[0];
      const toolInvocation = candidate?.message?.toolInvocation || candidate?.toolInvocation;
      if (toolInvocation) {
        // arguments may be an object or a JSON string
        const args = toolInvocation.arguments;
        let argsObj = args;
        if (typeof args === 'string') {
          try { argsObj = JSON.parse(args); } catch (e) { argsObj = { raw: args }; }
        }
        // Expect argsObj to contain a field with the action JSON or the action itself
        if (argsObj && (argsObj.action || argsObj.actions || argsObj.raw)) {
          // Normalize and return the action object
          const actionObj = argsObj.action ? argsObj : (argsObj.actions ? argsObj.actions[0] : argsObj);
          return actionObj;
        }
      }
    } catch (e) {
      console.warn('Failed to parse toolInvocation from Gemini response', e);
    }

    // Fallback: look for JSON text in the candidate message content
    try {
      const text = result?.candidates?.[0]?.message?.content?.[0]?.text || result?.candidates?.[0]?.content?.parts?.[0]?.text || JSON.stringify(result);
      const jsonMatch = String(text).match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const actionObj = JSON.parse(jsonMatch[0]);
        return actionObj;
      }
      // If no JSON found, return done with raw text so user can inspect
      return { action: 'done', result: 'No JSON action found in model response', raw: text };
    } catch (e) {
      console.error('Error extracting JSON from Gemini response', e);
      return { action: 'done', result: `Failed to parse model output: ${e.message}` };
    }

  } catch (err) {
    console.error('Error calling Gemini or parsing response:', err);
    return { action: 'done', result: `An error occurred: ${err.message}` };
  }
}

// Main agent loop: runs until the model returns an action { action: 'done' }
async function runAgentCycle(goal, options = {}) {
  console.log('Agent starting with goal:', goal);
  const maxSteps = options.maxSteps || 10;
  let step = 0;

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
      screenshot = await captureVisibleTabAsync(activeTab.windowId);
    } catch (err) {
      console.warn('Failed to capture tab screenshot:', err);
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
    runAgentCycle(goal).then((res) => {
      console.log('runAgentCycle result:', res);
    }).catch((err) => console.error('Agent error:', err));

    sendResponse({ started: true });
    // Return true when sending response asynchronously — not necessary here but safe
    return false;
  }
});
