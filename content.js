// Content script - The Hands
// Listens for EXEC_ACTION messages from the background service worker and performs actions

console.log('Atlas4Chrome content script injected.');

async function clickElement(selector) {
  try {
    const el = document.querySelector(selector);
    if (!el) return { success: false, error: 'element-not-found', selector };
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    // Use click if available
    el.click();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function typeText(selector, text) {
  try {
    const el = document.querySelector(selector);
    if (!el) return { success: false, error: 'element-not-found', selector };
    el.focus();
    // If element is input/textarea, set value
    if ('value' in el) {
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true };
    }
    // For contenteditable
    if (el.isContentEditable) {
      el.innerText = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return { success: true };
    }
    return { success: false, error: 'not-editable' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function scrollPage(direction) {
  try {
    if (direction === 'down') {
      window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
    } else if (direction === 'up') {
      window.scrollBy({ top: -window.innerHeight * 0.8, behavior: 'smooth' });
    } else if (direction === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (direction === 'bottom') {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    } else {
      return { success: false, error: 'unknown-direction', direction };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleAction(action) {
  if (!action || !action.action) return { success: false, error: 'invalid-action' };
  switch (action.action) {
    case 'click':
      return await clickElement(action.selector);
    case 'type':
    case 'typeText':
      return await typeText(action.selector, action.text || action.value || '');
    case 'scroll':
      return await scrollPage(action.direction || 'down');
    case 'done':
      return { success: true, done: true, result: action.result };
    default:
      return { success: false, error: 'unknown-action', action };
  }
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'EXEC_ACTION') return;
  const action = message.action;
  handleAction(action).then((result) => sendResponse(result)).catch((err) => sendResponse({ success: false, error: err.message }));
  // Indicate we'll send a response asynchronously
  return true;
});
