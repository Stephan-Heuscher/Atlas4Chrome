// Content script - The Hands
// Listens for EXEC_ACTION messages from the background service worker and performs actions

console.log('%c✅ Atlas4Chrome content script INJECTED', 'color: green; font-weight: bold; font-size: 14px;');
console.log('Viewport:', window.innerWidth, 'x', window.innerHeight);
console.log('Page URL:', window.location.href);

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
    
    // Also log to console with timestamp
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] 🎯 ${color.toUpperCase()} MARKER at (${x}, ${y}) - ${label}`);
    
    // Remove after 3 seconds
    setTimeout(() => {
      try {
        marker.remove();
        console.log(`[${timestamp}] 🎯 Marker removed after 3s`);
      } catch (e) {}
    }, 3000);
  } catch (err) {
    console.error('❌ Failed to show marker:', err);
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
// Coordinates are now in DEVICE pixels (physical pixels of the screenshot)
async function clickAt(xPx, yPx) {
  try {
    // Coordinates from Gemini are in device pixel space
    // We need to convert them to CSS pixel space for DOM operations
    const dpr = window.devicePixelRatio || 1;
    
    // Convert device pixels to CSS pixels
    const cssX = xPx / dpr;
    const cssY = yPx / dpr;
    
    // Clamp to CSS pixel viewport
    const clampedX = Math.max(0, Math.min(cssX, window.innerWidth - 1));
    const clampedY = Math.max(0, Math.min(cssY, window.innerHeight - 1));
    
    const logMsg = `🎯 CLICK AT device (${xPx}, ${yPx}) → CSS (${clampedX}, ${clampedY}) in viewport ${window.innerWidth}x${window.innerHeight} (DPR: ${dpr})`;
    console.log('%c' + logMsg, 'color: red; font-weight: bold; font-size: 14px;');
    
    // ALSO log to window for debugging
    window.__lastClickCoords = {deviceX: xPx, deviceY: yPx, cssX: clampedX, cssY: clampedY, viewport: `${window.innerWidth}x${window.innerHeight}`, dpr, timestamp: new Date().toLocaleTimeString()};
    console.table(window.__lastClickCoords);
    
    // Show visual marker at CSS coordinates
    showClickMarker(clampedX, clampedY, 'red', 'C');
    
    // Get element at viewport coordinates (use CSS pixels)
    const el = document.elementFromPoint(clampedX, clampedY);
    console.log('Element found:', el?.tagName, el?.id, el?.className);
    
    if (el && el !== document.body && el !== document.documentElement) {
      // Scroll element into view
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
      
      // Wait a tiny bit for scroll
      await new Promise(r => setTimeout(r, 100));
      
      // Re-get element after scroll (use CSS pixels)
      const elAfterScroll = document.elementFromPoint(clampedX, clampedY);
      
      // Dispatch all necessary events (use CSS pixels for clientX/clientY)
      elAfterScroll?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: clampedX, clientY: clampedY, buttons: 1 }));
      elAfterScroll?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: clampedX, clientY: clampedY }));
      elAfterScroll?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: clampedX, clientY: clampedY }));
      
      // Also try native click if available
      if (elAfterScroll?.click) {
        elAfterScroll.click();
      }
      
      console.log('✓ Clicked:', elAfterScroll?.tagName, elAfterScroll?.id, elAfterScroll?.className);
      return { success: true };
    } else {
      console.log('No valid element found, trying generic click');
      // Try generic click on document
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: clampedX,
        clientY: clampedY
      });
      document.elementFromPoint(clampedX, clampedY)?.dispatchEvent(clickEvent);
      return { success: true };
    }
  } catch (err) {
    console.error('clickAt error:', err);
    return { success: false, error: err.message };
  }
}

// Type text at pixel coordinates (from Gemini Computer Use API)
// Coordinates are now in DEVICE pixels (physical pixels of the screenshot)
async function typeTextAt(xPx, yPx, text, press_enter = true) {
  try {
    // Coordinates from Gemini are in device pixel space
    // We need to convert them to CSS pixel space for DOM operations
    const dpr = window.devicePixelRatio || 1;
    
    // Convert device pixels to CSS pixels
    const cssX = xPx / dpr;
    const cssY = yPx / dpr;
    
    // Clamp to CSS pixel viewport
    const clampedX = Math.max(0, Math.min(cssX, window.innerWidth - 1));
    const clampedY = Math.max(0, Math.min(cssY, window.innerHeight - 1));
    
    console.log(`%c✏️ TYPE TEXT AT device (${xPx}, ${yPx}) → CSS (${clampedX}, ${clampedY}): "${text}"`, 'color: blue; font-weight: bold; font-size: 12px;');
    
    // Show visual marker
    showClickMarker(clampedX, clampedY, 'blue', 'T');
    
    const el = document.elementFromPoint(clampedX, clampedY);
    console.log('Target element details:', {
      tagName: el?.tagName,
      id: el?.id,
      className: el?.className,
      hasValue: 'value' in el,
      contentEditable: el?.contentEditable,
      type: el?.type,
      name: el?.name,
      value: el?.value
    });
    
    if (el) {
      el.focus();
      if ('value' in el) {
        console.log('Setting value property to:', text);
        el.value = text;
        
        // Trigger comprehensive input events
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        
        // Type each character with keyboard events for better compatibility
        for (let i = 0; i < text.length; i++) {
          const char = text[i];
          el.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true, cancelable: true }));
          el.dispatchEvent(new KeyboardEvent('keypress', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true, cancelable: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true, cancelable: true }));
        }
        
        if (press_enter) {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
          el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
        }
        console.log('✓ Text typed into input element, press_enter:', press_enter);
        return { success: true };
      }
      if (el.isContentEditable) {
        el.innerText = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        console.log('✓ Text typed into contentEditable');
        return { success: true };
      }
    }
    // fallback: type into activeElement
    const ae = document.activeElement;
    console.log('Active element:', ae?.tagName, 'value' in ae, ae?.value);
    if (ae && 'value' in ae) {
      console.log('Setting activeElement value to:', text);
      ae.value = text;
      ae.dispatchEvent(new Event('input', { bubbles: true }));
      ae.dispatchEvent(new Event('change', { bubbles: true }));
      ae.dispatchEvent(new Event('blur', { bubbles: true }));
      
      // Type each character
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        ae.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true, cancelable: true }));
        ae.dispatchEvent(new KeyboardEvent('keypress', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true, cancelable: true }));
        ae.dispatchEvent(new KeyboardEvent('keyup', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true, cancelable: true }));
      }
      
      if (press_enter) {
        ae.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
        ae.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
        ae.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
      }
      console.log('✓ Text typed into activeElement, press_enter:', press_enter);
      return { success: true };
    }
    console.log(`❌ No editable element found at CSS (${clampedX}, ${clampedY})`);
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
  
  // Log the action type
  console.log(`%c[HANDLER] Action type: ${action.action}, X: ${action.args?.x || action.x || 0}, Y: ${action.args?.y || action.y || 0}`, 'color: purple; font-weight: bold;');
  
  switch (action.action) {
    case 'click':
      return await clickElement(action.selector);
    case 'click_at':
      console.log('%c[CLICK_AT] Calling clickAt with coords', 'color: red;', action.args?.x || action.x || 0, action.args?.y || action.y || 0);
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

// Function to mark two points and log their positions
function markTwoPoints(point1, point2) {
  try {
    // Mark the first point
    showClickMarker(point1.x, point1.y, 'green', 'P1');
    console.log(`Point 1: (${point1.x}, ${point1.y})`);

    // Mark the second point
    showClickMarker(point2.x, point2.y, 'blue', 'P2');
    console.log(`Point 2: (${point2.x}, ${point2.y})`);

    // Return the positions for further use
    return { point1, point2 };
  } catch (err) {
    console.error('❌ Failed to mark points:', err);
    return null;
  }
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('%c📨 MESSAGE RECEIVED', 'color: blue; font-weight: bold;', message);
  
  // Handle viewport request
  if (message.type === 'GET_VIEWPORT') {
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      scrollY: window.scrollY,
      scrollX: window.scrollX,
      documentHeight: document.documentElement.scrollHeight,
      documentWidth: document.documentElement.scrollWidth
    };
    console.log('%c📐 VIEWPORT INFO', 'color: cyan; font-weight: bold;', viewport);
    sendResponse(viewport);
    return;
  }
  
  // Modify the EXEC_ACTION handler to include positions in the Gemini request
  if (message.type === 'EXEC_ACTION') {
    const action = message.action;
    console.log('%c🎬 EXECUTING ACTION', 'color: orange; font-weight: bold;', action);

    // Example points to mark (replace with actual logic to determine points)
    const point1 = { x: 100, y: 150 };
    const point2 = { x: 300, y: 400 };

    // Mark the points and log their positions
    const markedPoints = markTwoPoints(point1, point2);

    handleAction(action)
      .then((result) => {
        console.log('%c✅ ACTION RESULT', 'color: green;', result);

        // Include the marked points in the response to Gemini
        const response = { ...result, markedPoints };
        sendResponse(response);
      })
      .catch((err) => {
        console.log('%c❌ ACTION ERROR', 'color: red;', err);
        sendResponse({ success: false, error: err.message });
      });

    // Indicate we'll send a response asynchronously
    return true;
  }
  
  if (!message || message.type !== 'EXEC_ACTION') {
    console.log('❌ Ignoring non-EXEC_ACTION message');
    return;
  }
  
  const action = message.action;
  console.log('%c🎬 EXECUTING ACTION', 'color: orange; font-weight: bold;', action);
  
  handleAction(action)
    .then((result) => {
      console.log('%c✅ ACTION RESULT', 'color: green;', result);
      sendResponse(result);
    })
    .catch((err) => {
      console.log('%c❌ ACTION ERROR', 'color: red;', err);
      sendResponse({ success: false, error: err.message });
    });
  
  // Indicate we'll send a response asynchronously
  return true;
});
