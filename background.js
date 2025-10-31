// Background service worker - Agent Brain (MV3)
// Responsibilities:
// - Accept a START_AGENT message with a `goal` string
// - Run runAgentCycle(goal) which captures screenshots, sends them to the Gemini placeholder,
//   receives actions, and dispatches those actions to the content script (the Hands).

console.log('Atlas4Chrome service worker loaded.');

// Utility: promisified captureVisibleTab
function captureVisibleTabAsync() {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
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

// Send screenshot+goal directly to the Gemini 2.5 Computer Use Model API.
// The API Key is retrieved from chrome.storage.sync, set via the options page.
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-computer-use-preview-10-2025:generateContent';

async function sendToGemini(screenshotDataUrl, goal, step) {
  const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
  if (!geminiApiKey) {
    console.error('Gemini API key not found. Please set it in the extension options.');
    // Return a "done" action to stop the loop gracefully.
    return { action: 'done', result: 'API key is missing.' };
  }

  try {
    // Construct a prompt for the Gemini Computer Use Model.
    const prompt = `You are an autonomous browser agent. The user's goal is: "${goal}". We are at step ${step}. Analyze the provided screenshot and determine the single next action to take. Return a single valid JSON object describing that action. Examples: {"action":"click","selector":"button#submit"}, {"action":"type","selector":"input[name='q']","text":"search terms"}, {"action":"scroll","direction":"down"}, {"action":"done","result":"Goal achieved."}`;

    const requestBody = {
      "contents": [
        {
          "role": "user",
          "parts": [
            { "text": prompt },
            {
              "inline_data": {
                "mime_type": "image/png",
                "data": screenshotDataUrl.split(',')[1] // Remove the "data:image/png;base64," prefix
              }
            }
          ]
        }
      ],
      "generationConfig": {
        "temperature": 0,
        "maxOutputTokens": 2048,
        "response_mime_type": "application/json"
      }
    };

    const response = await fetch(`${GEMINI_ENDPOINT}?key=${geminiApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Gemini API request failed:', response.status, errorBody);
      throw new Error(`API request failed with status ${response.status}`);
    }

    const result = await response.json();
    // The response from the model when using "application/json" mime type is directly the JSON content.
    // It's often in result.candidates[0].content.parts[0].text
    const jsonText = result.candidates[0].content.parts[0].text;
    return JSON.parse(jsonText);

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

    // 1) Capture screenshot of the currently visible tab
    let screenshot = null;
    try {
      screenshot = await captureVisibleTabAsync();
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

    // Find the currently active tab in the last focused window
    const tabs = await new Promise((resolve) => chrome.tabs.query({ active: true, lastFocusedWindow: true }, resolve));
    const tab = tabs && tabs[0];
    if (!tab) {
      console.warn('No active tab found to send action to.');
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
