// Content script - The Hands
// Listens for EXEC_ACTION messages from the background service worker and performs actions

console.log('Atlas4Chrome content script injected.');

/**
 * Visual debug: Show where clicks/types are happening on the page
 */
function showClickMarker(x, y, color = 'red', label = 'click') {
  try {
    const marker = document.createElement('div');
    marker.style.position = 'fixed';
    marker.style.left = (x - 15) + 'px';
    marker.style.top = (y - 15) + 'px';
    marker.style.width = '30px';
    marker.style.height = '30px';
    marker.style.borderRadius = '50%';
    marker.style.border = `3px solid ${color}`;
    marker.style.backgroundColor = 'transparent';
    marker.style.zIndex = '999999';
    marker.style.pointerEvents = 'none';
    marker.title = `${label} at (${x}, ${y})`;
    
    // Add text label
    const text = document.createElement('div');
    text.textContent = label.charAt(0).toUpperCase();
    text.style.position = 'absolute';
    text.style.top = '50%';
    text.style.left = '50%';
    text.style.transform = 'translate(-50%, -50%)';
    text.style.color = color;
    text.style.fontSize = '10px';
    text.style.fontWeight = 'bold';
    text.style.fontFamily = 'monospace';
    marker.appendChild(text);
    
    document.body.appendChild(marker);
    
    // Remove after 3 seconds
    setTimeout(() => marker.remove(), 3000);
    
    console.log(`${label} marker at (${x}, ${y})`);
  } catch (err) {
    console.error('Failed to show marker:', err);
  }
}

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

// Click at pixel coordinates (from Gemini Computer Use API)
// Coordinates are raw pixel values from the screenshot
async function clickAt(xPx, yPx) {
  try {
    // Clamp coordinates to viewport
    const x = Math.round(Math.max(0, Math.min(xPx, window.innerWidth - 1)));
    const y = Math.round(Math.max(0, Math.min(yPx, window.innerHeight - 1)));
    
    console.log(`clickAt(${x}, ${y}) in viewport ${window.innerWidth}x${window.innerHeight}`);
    
    // Show visual marker
    showClickMarker(x, y, 'red', 'C');
    
    // Get element at viewport coordinates
    const el = document.elementFromPoint(x, y);
    console.log('Element at point:', el?.tagName, el?.className, el?.id);
    
    if (el && el !== document.body && el !== document.documentElement) {
      // Scroll element into view
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
      
      // Wait a tiny bit for scroll
      await new Promise(r => setTimeout(r, 100));
      
      // Re-get element after scroll (coordinates changed)
      const elAfterScroll = document.elementFromPoint(x, y);
      
      // Dispatch all necessary events
      elAfterScroll?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y, buttons: 1 }));
      elAfterScroll?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }));
      elAfterScroll?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      
      // Also try native click if available
      if (elAfterScroll?.click) {
        elAfterScroll.click();
      }
      
      console.log('Clicked element:', elAfterScroll?.tagName, elAfterScroll?.id, elAfterScroll?.className);
      return { success: true };
    } else {
      console.log('No valid element found, trying generic click');
      // Try generic click on document
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y
      });
      document.elementFromPoint(x, y)?.dispatchEvent(clickEvent);
      return { success: true };
    }
  } catch (err) {
    console.error('clickAt error:', err);
    return { success: false, error: err.message };
  }
}

// Type text at pixel coordinates (from Gemini Computer Use API)
async function typeTextAt(xPx, yPx, text, press_enter = true) {
  try {
    const x = Math.round(xPx);
    const y = Math.round(yPx);
    
    console.log(`typeTextAt(${x}, ${y}, "${text}")`);
    
    // Show visual marker
    showClickMarker(x, y, 'blue', 'T');
    
    const el = document.elementFromPoint(x, y);
    console.log('Element at point:', el?.tagName, el?.className);
    
    if (el) {
      el.focus();
      if ('value' in el) {
        el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        if (press_enter) {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
        }
        console.log('Text typed into input element');
        return { success: true };
      }
      if (el.isContentEditable) {
        el.innerText = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        console.log('Text typed into contentEditable');
        return { success: true };
      }
    }
    // fallback: type into activeElement
    const ae = document.activeElement;
    if (ae && 'value' in ae) {
      ae.value = text;
      ae.dispatchEvent(new Event('input', { bubbles: true }));
      if (press_enter) ae.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      console.log('Text typed into activeElement');
      return { success: true };
    }
    console.log('No editable element found');
    return { success: false, error: 'no-editable-element-at-coordinates' };
  } catch (err) {
    console.error('typeTextAt error:', err);
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
    case 'click_at':
      return await clickAt(action.args?.x || action.x || 0, action.args?.y || action.y || 0);
    case 'type_text_at':
    case 'type_at':
      return await typeTextAt(action.args?.x || action.x || 0, action.args?.y || action.y || 0, action.args?.text || action.text || '', action.args?.press_enter !== false);
    case 'type':
    case 'typeText':
      return await typeText(action.selector, action.text || action.value || '');
    case 'hover_at':
      try {
        const x = Math.round(action.args?.x || action.x || 0);
        const y = Math.round(action.args?.y || action.y || 0);
        const el = document.elementFromPoint(x, y);
        if (el) el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y }));
        return { success: true };
      } catch (err) { return { success: false, error: err.message }; }
    case 'scroll_at':
      try {
        const x = Math.round(action.args?.x || action.x || 0);
        const y = Math.round(action.args?.y || action.y || 0);
        const direction = (action.args?.direction || action.direction || 'down');
        const el = document.elementFromPoint(x, y) || document.scrollingElement || document.body;
        if (direction === 'down') el.scrollBy({ top: 400, behavior: 'smooth' });
        else if (direction === 'up') el.scrollBy({ top: -400, behavior: 'smooth' });
        return { success: true };
      } catch (err) { return { success: false, error: err.message }; }
    case 'scroll':
      return await scrollPage(action.direction || 'down');
    case 'done':
      return { success: true, done: true, result: action.result };
    
    // Computer Use API actions
    case 'open_web_browser':
      try {
        const url = action.args?.url;
        if (url) {
          // Navigate to the URL in current tab or new tab
          window.location.href = url;
          return { success: true, url: window.location.href };
        }
        // If no URL, just return current page
        return { success: true, url: window.location.href };
      } catch (err) {
        return { success: false, error: err.message };
      }
    
    case 'find_on_page':
      try {
        const query = action.args?.text || action.text || '';
        if (!query) return { success: false, error: 'no-search-query' };
        // Use browser find - just highlight the first occurrence
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          null,
          false
        );
        let node;
        while (node = walker.nextNode()) {
          if (node.textContent.includes(query)) {
            const range = document.createRange();
            range.selectNodeContents(node);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            node.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return { success: true, found: true };
          }
        }
        return { success: true, found: false };
      } catch (err) {
        return { success: false, error: err.message };
      }
    
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
