document.getElementById('toggleBtn').addEventListener('click', () => {
  // Query the active tab
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    if (tabs.length === 0) return;
    const activeTab = tabs[0];
    
    // Toggle the state in storage
    chrome.storage.local.get(['darkMode'], function(result) {
      const newState = !result.darkMode;
      chrome.storage.local.set({darkMode: newState}, function() {
        // Send a message to the content script in the active tab to toggle the class
        chrome.tabs.sendMessage(activeTab.id, {action: 'toggleDarkMode'});
      });
    });
  });
});
