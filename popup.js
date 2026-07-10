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

chrome.storage.local.get(['extensionDisabled'], function(result) {
  const disableBtn = document.getElementById('disableBtn');
  if (result.extensionDisabled) {
    disableBtn.textContent = 'Enable Extension';
    disableBtn.style.backgroundColor = '#28a745';
  } else {
    disableBtn.textContent = 'Disable Extension';
    disableBtn.style.backgroundColor = '#dc3545';
  }
});

document.getElementById('disableBtn').addEventListener('click', () => {
  chrome.storage.local.get(['extensionDisabled'], function(result) {
    const newState = !result.extensionDisabled;
    chrome.storage.local.set({extensionDisabled: newState}, function() {
      // Reload active tab if it's on prairielearn so changes take effect
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs.length > 0 && tabs[0].url && tabs[0].url.includes('prairielearn')) {
          chrome.tabs.reload(tabs[0].id);
        }
      });
      window.close(); // Close popup
    });
  });
});

// Dev Mode button
chrome.storage.local.get(['devMode'], function(result) {
  const devBtn = document.getElementById('devModeBtn');
  if (result.devMode) {
    devBtn.textContent = '🔧 Dev Mode: ON';
    devBtn.style.backgroundColor = '#fd7e14';
  }
});

document.getElementById('devModeBtn').addEventListener('click', () => {
  chrome.storage.local.get(['devMode'], function(result) {
    const newState = !result.devMode;
    chrome.storage.local.set({devMode: newState}, function() {
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs.length > 0 && tabs[0].url && tabs[0].url.includes('prairielearn')) {
          chrome.tabs.reload(tabs[0].id);
        }
      });
      window.close();
    });
  });
});
