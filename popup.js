document.addEventListener('DOMContentLoaded', () => {
  // 1. Dark Mode
  chrome.storage.local.get(['darkMode'], function(result) {
    document.getElementById('toggleDarkMode').checked = !!result.darkMode;
  });

  document.getElementById('toggleDarkMode').addEventListener('change', (e) => {
    const newState = e.target.checked;
    chrome.storage.local.set({darkMode: newState}, function() {
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs.length === 0) return;
        chrome.tabs.sendMessage(tabs[0].id, {action: 'toggleDarkMode'});
      });
    });
  });

  // 2. Extension Enabled (note: storage is `extensionDisabled`)
  chrome.storage.local.get(['extensionDisabled'], function(result) {
    document.getElementById('toggleExtension').checked = !result.extensionDisabled;
  });

  document.getElementById('toggleExtension').addEventListener('change', (e) => {
    const newState = !e.target.checked; // disabled = !checked
    chrome.storage.local.set({extensionDisabled: newState}, function() {
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs.length > 0 && tabs[0].url && tabs[0].url.includes('prairielearn')) {
          chrome.tabs.reload(tabs[0].id);
        }
      });
      setTimeout(() => window.close(), 100);
    });
  });

  // 3. Live Math Preview (note: storage is `disableMathPreview`)
  chrome.storage.local.get(['disableMathPreview'], function(result) {
    document.getElementById('toggleMath').checked = !result.disableMathPreview;
  });

  document.getElementById('toggleMath').addEventListener('change', (e) => {
    const newState = !e.target.checked; // disabled = !checked
    chrome.storage.local.set({disableMathPreview: newState}, function() {
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs.length > 0 && tabs[0].url && tabs[0].url.includes('prairielearn')) {
          chrome.tabs.reload(tabs[0].id);
        }
      });
      setTimeout(() => window.close(), 100);
    });
  });

  // 4. Developer Mode
  const PROD_URL = 'https://us.prairielearn.com/pl';
  const DEV_URL = 'http://localhost:3000/pl';

  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    if (tabs.length === 0) return;
    const url = tabs[0].url || '';
    if (url.startsWith('http://localhost')) {
      document.getElementById('toggleDevMode').checked = true;
    } else {
      document.getElementById('toggleDevMode').checked = false;
    }
  });

  document.getElementById('toggleDevMode').addEventListener('change', (e) => {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs.length === 0) return;
      const target = e.target.checked ? DEV_URL : PROD_URL;
      chrome.tabs.update(tabs[0].id, { url: target });
      setTimeout(() => window.close(), 100);
    });
  });
});
