// Background service worker - Agent Brain (MV3)
// Orchestrates screenshot capture, API communication, and browser automation

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

const CONFIG = {
  GEMINI_ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-computer-use-preview-10-2025:generateContent',
  MIN_CAPTURE_INTERVAL_MS: 2500,
  MAX_SCREENSHOT_BYTES: 100000,
  CAPTURE_MAX_BYTES: 50000,
  CAPTURE_QUOTA_BACKOFF_MS: 1000,  // Initial backoff (exponential will increase)
  STEP_DELAY_MS: 800,
  MAX_STEPS_DEFAULT: 10,
  JPEG_QUALITIES: [20, 15, 10],  // Kept for reference but not used
};

const STORAGE = {
  LOCAL: {
    AGENT_SHOULD_RUN: 'agentShouldRun',
    LAST_CAPTURE_AT: 'lastCaptureAt',
    LAST_AGENT_RESULT: 'lastAgentResult',
    LAST_MODEL_RESPONSE: 'lastModelResponse',
  },
  SYNC: {
    GEMINI_API_KEY: 'geminiApiKey',
  },
};

// ============================================================================
// LOGGING UTILITIES
// ============================================================================

const Logger = {
  info: (msg, ...args) => console.log(`[Agent]`, msg, ...args),
  warn: (msg, ...args) => console.warn(`[Agent]`, msg, ...args),
  error: (msg, ...args) => console.error(`[Agent]`, msg, ...args),
  debug: (msg, ...args) => console.debug(`[Agent]`, msg, ...args),
};

// ============================================================================
// STORAGE HELPERS
// ============================================================================

const StorageAPI = {
  local: {
    get: (key) => new Promise((resolve) => {
      chrome.storage.local.get(key, (res) => resolve(res && res[key]));
    }),
    set: (obj) => new Promise((resolve) => {
      chrome.storage.local.set(obj, () => resolve());
    }),
  },
  sync: {
    get: (key) => new Promise((resolve) => {
      chrome.storage.sync.get(key, (res) => resolve(res && res[key]));
    }),
  },
  broadcast: (type, payload) => {
    try {
      // Don't await, but catch any errors
      StorageAPI.local.set({ lastModelResponse: { type, payload } })
        .catch(e => Logger.warn('Failed to persist debug info:', e));
    } catch (e) {
      Logger.warn('Failed to persist debug info:', e);
    }
    try {
      // Use callback to suppress "Receiving end does not exist" errors
      chrome.runtime.sendMessage(
        { type: 'MODEL_RAW', payload },
        () => {
          // Clear any lastError to suppress unhandled rejection
          chrome.runtime.lastError; // Just reading it clears the error state
        }
      );
    } catch (e) {
      // Ignore send failures
    }
  },
};

// ============================================================================
// TAB & SCREENSHOT UTILITIES
// ============================================================================

const TabAPI = {
  /**
   * Query tabs, filtering out extension pages (chrome-extension://)
   */
  getNormalTab: async (options = {}) => {
    const query = { lastFocusedWindow: true, ...options };
    const tabs = await new Promise((resolve) => chrome.tabs.query(query, resolve));
    Logger.debug(`Found ${tabs.length} tabs in window`);
    
    // Filter out extension pages
    const normalTabs = tabs.filter(t => t.url && !t.url.startsWith('chrome-extension://'));
    Logger.debug(`Filtered to ${normalTabs.length} normal tabs`);
    
    if (normalTabs.length === 0) {
      Logger.warn('No normal tabs found, listing all tabs:', tabs.map(t => ({ id: t.id, url: t.url })));
      return null;
    }
    
    const tab = normalTabs[0];
    Logger.debug(`Selected tab ${tab.id}: ${tab.url}`);
    return tab;
  },

  /**
   * Inject content script into tab
   */
  injectContentScript: async (tabId) => {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
      Logger.debug(`Content script injected: tab ${tabId}`);
      return true;
    } catch (err) {
      Logger.warn(`Failed to inject content script: ${err.message}`);
      return false;
    }
  },

  /**
   * Send message to tab with timeout
   */
  sendMessage: async (tabId, message) => {
    return new Promise((resolve) => {
      Logger.debug(`Sending message to tab ${tabId}:`, message);
      
      // First try to inject content script in case it's not loaded
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      }).then(() => {
        Logger.debug(`Content script injected/already present on tab ${tabId}`);
      }).catch(err => {
        // Injection might fail on restricted pages, but that's OK
        Logger.debug(`Pre-send injection attempt: ${err.message}`);
      });
      
      // Wait a bit for injection
      setTimeout(() => {
        Logger.debug(`Attempting to send message to tab ${tabId}...`);
        chrome.tabs.sendMessage(tabId, message, (resp) => {
          if (chrome.runtime.lastError) {
            Logger.warn(`Message send error (tab ${tabId}): ${chrome.runtime.lastError.message}`);
            resolve({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          Logger.debug(`Message response from tab ${tabId}:`, resp);
          resolve(resp || { success: false, error: 'No response' });
        });
      }, 100);
    });
  },
};

const ScreenshotAPI = {
  /**
   * Capture tab at specified format/quality
   */
  captureTab: (windowId = null, format = 'jpeg', quality = 60) => {
    return new Promise((resolve, reject) => {
      try {
        const opts = { format };
        if (format === 'jpeg' && typeof quality === 'number') opts.quality = quality;
        chrome.tabs.captureVisibleTab(windowId, opts, (dataUrl) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
            return;
          }
          resolve(dataUrl);
        });
      } catch (err) {
        reject(err);
      }
    });
  },

  /**
   * Get base64 size of dataURL
   */
  getSize: (dataUrl) => {
    const base64 = dataUrl?.split(',')[1] || '';
    return base64.length;
  },

  /**
   * Single capture with fixed quality (to avoid quota spam)
   */
  capture: async (windowId = null, maxBytes = CONFIG.CAPTURE_MAX_BYTES) => {
    try {
      // Use a balanced JPEG quality that works for most screenshots
      const quality = 15; // Lower quality = smaller file, good for Gemini vision
      
      try {
        const dataUrl = await ScreenshotAPI.captureTab(windowId, 'jpeg', quality);
        if (!dataUrl) {
          Logger.warn('Failed to capture screenshot: empty result');
          return null;
        }
        
        const size = ScreenshotAPI.getSize(dataUrl);
        Logger.info(`Screenshot: JPEG quality ${quality} (${size} bytes)`);
        return dataUrl;
      } catch (err) {
        if (err?.message?.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND')) {
          const quotaErr = new Error('CAPTURE_QUOTA');
          quotaErr.code = 'CAPTURE_QUOTA';
          throw quotaErr;
        }
        Logger.warn(`Screenshot capture failed: ${err.message}`);
        return null;
      }
    } catch (err) {
      if (err?.code === 'CAPTURE_QUOTA') throw err;
      Logger.error(`Screenshot error: ${err.message}`);
      return null;
    }
  },
};

// ============================================================================
// GEMINI API CLIENT
// ============================================================================

class GeminiClient {
  constructor() {
    this.endpoint = CONFIG.GEMINI_ENDPOINT;
  }

  async getApiKey() {
    const key = await StorageAPI.sync.get(STORAGE.SYNC.GEMINI_API_KEY);
    if (!key) {
      throw new Error('Gemini API key not found. Please set it in extension options.');
    }
    return key;
  }

  buildUserPart(goal, screenshotDataUrl) {
    const text = `Goal: ${goal}\n\nRespond with ONLY Computer Use tool calls. No other text.`;
    const base64 = screenshotDataUrl?.split(',')[1] || null;
    
    return {
      role: 'user',
      parts: [
        { text },
        ...(base64 ? [{ inline_data: { mime_type: 'image/png', data: base64 } }] : []),
      ]
    };
  }

  buildRequest(contents) {
    return {
      contents,
      tools: [{
        computer_use: { environment: 'ENVIRONMENT_BROWSER' }
      }]
    };
  }

  parseResponse(result) {
    const candidate = result?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    Logger.debug(`Response: ${parts.length} parts`);

    // Extract function calls (API returns camelCase: functionCall)
    const functionCalls = parts
      .filter(p => p.functionCall || p.function_call)
      .map(p => p.functionCall || p.function_call);

    if (functionCalls.length > 0) {
      return { type: 'function', calls: functionCalls };
    }

    // Fallback to text JSON
    const textParts = parts.map(p => p.text || '').join('\n');
    if (textParts) {
      const jsonMatch = textParts.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return { type: 'json', action: JSON.parse(jsonMatch[0]) };
        } catch (e) {
          Logger.warn('Failed to parse JSON fallback');
        }
      }
    }

    return { type: 'none' };
  }

  async call(screenshotDataUrl, goal, conversationHistory = []) {
    try {
      const apiKey = await this.getApiKey();
      const userPart = this.buildUserPart(goal, screenshotDataUrl);
      
      // Build contents: existing history + new user message
      const contents = [...conversationHistory, userPart];
      conversationHistory.push(userPart); // Persist user part

      const requestBody = this.buildRequest(contents);
      StorageAPI.broadcast('request', requestBody);

      const response = await fetch(`${this.endpoint}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        let errorMsg = await response.text();
        try {
          const json = JSON.parse(errorMsg);
          if (json?.error?.message) errorMsg = json.error.message;
        } catch (e) {}
        throw new Error(`API error ${response.status}: ${errorMsg}`);
      }

      const result = await response.json();
      StorageAPI.broadcast('response', result);

      const parsed = this.parseResponse(result);
      const candidate = result?.candidates?.[0];

      if (parsed.type === 'function' && candidate?.content) {
        // Add model response to history
        conversationHistory.push({
          role: 'model',
          parts: candidate.content.parts || []
        });
        
        const fc = parsed.calls[0];
        Logger.info(`Function call: ${fc.name}`);
        return {
          action: fc.name,
          args: fc.args || {},
          conversationHistory
        };
      }

      if (parsed.type === 'json') {
        return {
          action: parsed.action.action || 'done',
          args: parsed.action.args || {},
          conversationHistory
        };
      }

      return {
        action: 'done',
        result: 'No function calls found',
        conversationHistory
      };
    } catch (err) {
      Logger.error(`Gemini API error: ${err.message}`);
      return {
        action: 'done',
        result: `Error: ${err.message}`,
        conversationHistory
      };
    }
  }
}

// ============================================================================
// ACTION EXECUTOR
// ============================================================================

const ActionExecutor = {
  /**
   * Map Gemini Computer Use action names to content script actions
   */
  normalizeAction(action) {
    const normalized = { ...action };
    
    // Map navigate to open_web_browser
    if (normalized.action === 'navigate' && normalized.args?.url) {
      normalized.action = 'open_web_browser';
    }
    
    // Map search to open_web_browser with Google search
    if (normalized.action === 'search' && normalized.args?.query) {
      normalized.action = 'open_web_browser';
      normalized.args.url = `https://www.google.com/search?q=${encodeURIComponent(normalized.args.query)}`;
    }
    
    // Ensure open_web_browser has a URL (default to google if missing)
    if (normalized.action === 'open_web_browser' && !normalized.args?.url) {
      normalized.args.url = 'https://www.google.com';
    }
    
    return normalized;
  },

  async execute(tab, action) {
    try {
      // Normalize action names from Gemini
      const normalizedAction = this.normalizeAction(action);
      
      Logger.info(`Executing action on tab ${tab.id} (${tab.url}): ${normalizedAction.action}`);
      
      // Handle navigation directly in background (don't rely on content script for navigation)
      if (normalizedAction.action === 'open_web_browser' && normalizedAction.args?.url) {
        Logger.info(`Navigating tab ${tab.id} to: ${normalizedAction.args.url}`);
        await new Promise((resolve) => {
          chrome.tabs.update(tab.id, { url: normalizedAction.args.url }, (updatedTab) => {
            if (chrome.runtime.lastError) {
              Logger.error(`Navigation error: ${chrome.runtime.lastError.message}`);
            } else {
              Logger.info(`Tab ${tab.id} navigation initiated to ${updatedTab?.url}`);
            }
            resolve();
          });
        });
        // Wait for page to load before returning
        await new Promise(r => setTimeout(r, 2000));
        return { success: true, url: normalizedAction.args.url };
      }

      // For other actions, send to content script
      Logger.debug(`Sending action to tab ${tab.id}: ${normalizedAction.action}`);
      const response = await TabAPI.sendMessage(tab.id, {
        type: 'EXEC_ACTION',
        action: normalizedAction
      });

      Logger.debug(`Action ${normalizedAction.action} response:`, response);
      return response;
    } catch (err) {
      Logger.error(`Action execution failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  },

  async buildFunctionResponse(action, result, currentUrl) {
    return {
      role: 'user',
      parts: [{
        functionResponse: {
          name: action.action,
          response: {
            result: result.success 
              ? 'Action executed successfully' 
              : (result.error || 'Unknown error'),
            success: result.success !== false,
            url: currentUrl
          }
        }
      }]
    };
  }
};

// ============================================================================
// AGENT LOOP
// ============================================================================

class Agent {
  constructor(goal, options = {}) {
    this.goal = goal;
    this.maxSteps = options.maxSteps || CONFIG.MAX_STEPS_DEFAULT;
    this.step = 0;
    this.conversationHistory = [];
    this.gemini = new GeminiClient();
    this.quotaBackoffMultiplier = 1; // For exponential backoff
  }

  async getCaptureInterval() {
    const lastCaptureAt = await StorageAPI.local.get(STORAGE.LOCAL.LAST_CAPTURE_AT) || 0;
    const elapsed = Date.now() - lastCaptureAt;
    const wait = Math.max(0, CONFIG.MIN_CAPTURE_INTERVAL_MS - elapsed);
    return wait;
  }

  async recordCapture() {
    await StorageAPI.local.set({
      [STORAGE.LOCAL.LAST_CAPTURE_AT]: Date.now()
    });
  }

  async shouldContinue() {
    const shouldRun = await StorageAPI.local.get(STORAGE.LOCAL.AGENT_SHOULD_RUN);
    return shouldRun !== false;
  }

  async captureScreenshot(tab) {
    try {
      // Wait if needed
      const wait = await this.getCaptureInterval();
      if (wait > 0) {
        Logger.debug(`Waiting ${wait}ms for capture interval`);
        await new Promise(r => setTimeout(r, wait));
      }

      // Capture
      const screenshot = await ScreenshotAPI.capture(tab.windowId);
      if (screenshot) {
        await this.recordCapture();
        this.quotaBackoffMultiplier = 1; // Reset on success
        const size = ScreenshotAPI.getSize(screenshot);
        if (size > CONFIG.MAX_SCREENSHOT_BYTES) {
          Logger.warn(`Screenshot too large (${size} bytes), omitting`);
          return null;
        }
      }
      return screenshot;
    } catch (err) {
      if (err.code === 'CAPTURE_QUOTA') {
        // Exponential backoff: 1s, 2s, 4s, 8s...
        const backoff = CONFIG.CAPTURE_QUOTA_BACKOFF_MS * this.quotaBackoffMultiplier;
        Logger.warn(`Capture quota hit, backing off ${backoff}ms (attempt ${this.quotaBackoffMultiplier})`);
        await new Promise(r => setTimeout(r, backoff));
        this.quotaBackoffMultiplier = Math.min(this.quotaBackoffMultiplier * 2, 16); // Max 16s backoff
        await this.recordCapture();
        return null;
      }
      Logger.error(`Capture error: ${err.message}`);
      return null;
    }
  }

  async run() {
    Logger.info(`Starting: "${this.goal}"`);
    await StorageAPI.local.set({ [STORAGE.LOCAL.AGENT_SHOULD_RUN]: true });

    let activeTab = null;

    while (this.step < this.maxSteps) {
      this.step++;
      Logger.info(`Step ${this.step}`);

      // Delay between steps
      if (this.step > 1) {
        await new Promise(r => setTimeout(r, CONFIG.STEP_DELAY_MS));
      }

      // Get active tab on step 1, or use stored tab for subsequent steps
      if (this.step === 1) {
        activeTab = await TabAPI.getNormalTab();
        if (!activeTab?.id) {
          Logger.warn('No active tab found');
          break;
        }
      } else {
        // Verify stored tab still exists
        const tabs = await new Promise((resolve) => 
          chrome.tabs.query({ windowId: activeTab.windowId }, resolve)
        );
        activeTab = tabs.find(t => t.id === activeTab.id);
        if (!activeTab?.id) {
          Logger.warn('Active tab was closed');
          break;
        }
      }
      
      const tab = activeTab;

      // Check if should stop
      if (!await this.shouldContinue()) {
        Logger.info('Agent stop requested');
        break;
      }

      // Capture screenshot
      const screenshot = await this.captureScreenshot(tab);

      // Call Gemini
      const geminiAction = await this.gemini.call(screenshot, this.goal, this.conversationHistory);
      if (geminiAction.conversationHistory) {
        this.conversationHistory = geminiAction.conversationHistory;
      }

      Logger.debug(`Gemini returned: ${geminiAction.action}`);

      // Check if done
      if (geminiAction.action === 'done') {
        Logger.info(`Done: ${geminiAction.result || 'success'}`);
        await StorageAPI.local.set({
          [STORAGE.LOCAL.LAST_AGENT_RESULT]: geminiAction.result || 'success'
        });
        break;
      }

      // Execute action
      const result = await ActionExecutor.execute(tab, geminiAction);
      
      // Re-query current tab by ID (tab reference may be stale)
      const currentTabQuery = await new Promise((resolve) => 
        chrome.tabs.query({ windowId: tab.windowId }, resolve)
      );
      const currentTab = currentTabQuery?.find(t => !t.url?.startsWith('chrome-extension://'));
      const currentUrl = currentTab?.url || tab.url;

      // Add function response
      const funcResponse = await ActionExecutor.buildFunctionResponse(
        geminiAction,
        result,
        currentUrl
      );
      this.conversationHistory.push(funcResponse);
      Logger.debug(`Added function response for: ${geminiAction.action}`);
    }

    Logger.info(`Finished: ${this.step} steps`);
    return { steps: this.step };
  }
}

// ============================================================================
// MESSAGE HANDLER
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) return;

  if (message.type === 'START_AGENT') {
    const goal = message.goal || 'Unknown goal';
    const agent = new Agent(goal);
    agent.run()
      .then(result => Logger.info(`Agent completed:`, result))
      .catch(err => Logger.error(`Agent error:`, err));
    
    sendResponse({ started: true });
    return true;
  }

  if (message.type === 'STOP_AGENT') {
    StorageAPI.local.set({ [STORAGE.LOCAL.AGENT_SHOULD_RUN]: false })
      .then(() => Logger.info('Stop signal received'))
      .catch(err => Logger.error('Failed to set stop flag', err));
    
    sendResponse({ stopped: true });
    return true;
  }

  if (message.type === 'REQUEST_SAFETY_CONFIRMATION') {
    Logger.info('Safety confirmation requested');
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          Logger.warn('No safety response:', chrome.runtime.lastError.message);
          sendResponse({ safety_acknowledged: false });
        } else {
          sendResponse(response);
        }
      });
    } catch (err) {
      Logger.warn('Failed to send safety confirmation message:', err.message);
      sendResponse({ safety_acknowledged: false });
    }
    return true;
  }
});

Logger.info('Service worker loaded');
