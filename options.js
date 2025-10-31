// Saves options to chrome.storage
function saveOptions() {
  const apiKey = document.getElementById('apiKey').value;
  chrome.storage.sync.set({
    geminiApiKey: apiKey
  }, function() {
    // Update status to let user know options were saved.
    const status = document.getElementById('status');
    status.textContent = 'Options saved.';
    setTimeout(function() {
      status.textContent = '';
    }, 1500);
  });
}

// Restores input box state using the preferences stored in chrome.storage.
function restoreOptions() {
  chrome.storage.sync.get({
    geminiApiKey: ''
  }, function(items) {
    document.getElementById('apiKey').value = items.geminiApiKey;
  });
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);
