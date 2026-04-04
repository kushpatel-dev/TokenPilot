(function() {
  "use strict";

  function updateStatusUI(isEnabled) {
    const statusDisplay = document.getElementById('status-display');
    if (!statusDisplay) return;

    if (isEnabled) {
      statusDisplay.innerHTML = '<div class="status-dot"></div> Active';
      statusDisplay.style.background = 'rgba(34, 197, 94, 0.1)';
      statusDisplay.style.borderColor = 'rgba(34, 197, 94, 0.2)';
      statusDisplay.style.color = '#4ade80';
    } else {
      statusDisplay.innerHTML = '<div class="status-dot" style="background:#ef4444;box-shadow:none;"></div> Inactive';
      statusDisplay.style.background = 'rgba(239, 68, 68, 0.1)';
      statusDisplay.style.borderColor = 'rgba(239, 68, 68, 0.2)';
      statusDisplay.style.color = '#fca5a5';
    }
  }

  function init() {
    const toggle = document.getElementById('power-toggle');
    if (!toggle) return;

    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['isEnabled'], (result) => {
          if (chrome.runtime.lastError) {
            console.warn('Storage error:', chrome.runtime.lastError);
            return;
          }
          const isEnabled = result.isEnabled !== false;
          toggle.checked = isEnabled;
          updateStatusUI(isEnabled);
        });
      } else {
        updateStatusUI(true);
      }
    } catch (e) {
      console.error('Core init error:', e);
    }

    toggle.addEventListener('change', () => {
      const isEnabled = toggle.checked;
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ isEnabled });
        }
      } catch (e) {
        console.error('Save error:', e);
      }
      updateStatusUI(isEnabled);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
