// Check if dark mode is enabled in storage, if so apply it.
chrome.storage.local.get(['darkMode'], function(result) {
  if (result.darkMode) {
    document.documentElement.classList.add('pl-dark-mode');
  }
});

// Listen for messages from the popup to toggle dark mode
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'toggleDarkMode') {
    document.documentElement.classList.toggle('pl-dark-mode');
  }
});
