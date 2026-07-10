let isExtensionDisabled = false;

// Check if dark mode is enabled in storage, if so apply it.
chrome.storage.local.get(['darkMode', 'extensionDisabled'], function(result) {
  if (result.extensionDisabled) {
    isExtensionDisabled = true;
    return;
  }

  if (result.darkMode) {
    document.documentElement.classList.add('pl-dark-mode');
  }
  // Apply grade colors after dark mode state is known
  applyGradeColors();
});

// Listen for messages from the popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'extensionDisabledChanged') {
    isExtensionDisabled = request.disabled;
    if (isExtensionDisabled) {
      document.documentElement.classList.remove('pl-dark-mode');
      resetGradeColors();
    } else {
      chrome.storage.local.get(['darkMode'], function(result) {
        if (result.darkMode) {
          document.documentElement.classList.add('pl-dark-mode');
        }
        applyGradeColors();
      });
    }
    return;
  }

  if (isExtensionDisabled) return;
  
  if (request.action === 'toggleDarkMode') {
    document.documentElement.classList.toggle('pl-dark-mode');
    // Re-apply grade colors with updated dark mode state
    resetGradeColors();
    applyGradeColors();
  }
});

// --- Grade Colorization Logic ---

/**
 * Check if dark mode is currently active.
 */
function isDarkMode() {
  return document.documentElement.classList.contains('pl-dark-mode');
}

/**
 * Returns a vivid RGB color for a grade percentage.
 * 0% = red (220, 38, 38), 50% = orange (234, 179, 8), 100% = green (22, 163, 74)
 */
function getColorForGrade(grade) {
  grade = Math.max(0, Math.min(100, grade));

  let r, g, b;

  if (grade <= 50) {
    // Red → Orange
    const t = grade / 50;
    r = Math.round(220 + (234 - 220) * t);
    g = Math.round(38 + (179 - 38) * t);
    b = Math.round(38 + (8 - 38) * t);
  } else {
    // Orange → Green
    const t = (grade - 50) / 50;
    r = Math.round(234 + (22 - 234) * t);
    g = Math.round(179 + (163 - 179) * t);
    b = Math.round(8 + (74 - 8) * t);
  }

  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Wrap an element in a filter-cancelling container so our grade colors
 * display correctly even when the dark mode body filter is active.
 * 
 * Dark mode applies `invert(0.9) hue-rotate(180deg)` on <body>.
 * We wrap grade elements in a container with `hue-rotate(180deg) invert(1)`
 * which approximately cancels the parent filter, preserving our true colors.
 */
function wrapWithFilterCancel(element, wrapperTag) {
  if (element.parentElement && element.parentElement.classList.contains('pl-grade-wrapper')) {
    return; // Already wrapped
  }
  const wrapper = document.createElement(wrapperTag || 'div');
  wrapper.className = 'pl-grade-wrapper';
  wrapper.style.setProperty('filter', 'hue-rotate(180deg) invert(1)', 'important');
  if (wrapperTag === 'span') {
    wrapper.style.setProperty('display', 'inline-block', 'important');
  }
  element.parentElement.insertBefore(wrapper, element);
  wrapper.appendChild(element);
}

/**
 * Remove all wrappers and reset styles for re-processing
 * (needed when toggling dark mode on/off).
 */
function resetGradeColors() {
  // Unwrap all wrapped elements
  document.querySelectorAll('.pl-grade-wrapper').forEach(wrapper => {
    const parent = wrapper.parentElement;
    while (wrapper.firstChild) {
      parent.insertBefore(wrapper.firstChild, wrapper);
    }
    wrapper.remove();
  });

  // Reset progress bar styles
  document.querySelectorAll('.progress[data-pl-grade-colored]').forEach(bar => {
    bar.removeAttribute('data-pl-grade-colored');
    // Restore original inline styles
    bar.removeAttribute('style');
    bar.style.minWidth = '5em';
    bar.style.maxWidth = '20em';
  });
  document.querySelectorAll('.progress-bar').forEach(el => {
    const w = el.style.width;
    el.removeAttribute('style');
    if (w) el.style.width = w;
  });
  document.querySelectorAll('.progress .d-flex').forEach(el => {
    el.removeAttribute('style');
  });

  // Reset badge styles
  document.querySelectorAll('.badge[data-pl-grade-colored]').forEach(badge => {
    badge.removeAttribute('data-pl-grade-colored');
    badge.removeAttribute('style');
  });
}

/**
 * Colorize progress bars on the assessments list page.
 * Structure: .progress > .progress-bar (filled) + .d-flex (remaining with % text)
 */
function colorizeProgressBars() {
  const dark = isDarkMode();
  const progressBars = document.querySelectorAll('.progress');

  progressBars.forEach(bar => {
    if (bar.dataset.plGradeColored) return;

    const filledBar = bar.querySelector('.progress-bar');
    if (!filledBar) return;

    const widthStr = filledBar.style.width;
    if (!widthStr) return;

    const grade = parseFloat(widthStr);
    if (isNaN(grade) || grade < 0 || grade > 100) return;

    const color = getColorForGrade(grade);

    // Wrap in filter-cancelling container when dark mode is active
    if (dark) {
      wrapWithFilterCancel(bar, 'div');
    }

    // Style the progress bar
    bar.style.setProperty('background-color', '#333', 'important');
    bar.style.setProperty('border-color', color, 'important');
    filledBar.style.setProperty('background-color', color, 'important');

    // Style the text inside the bar
    const textDiv = bar.querySelector('.d-flex');
    if (textDiv) {
      textDiv.style.setProperty('color', '#ffffff', 'important');
      textDiv.style.setProperty('font-weight', 'bold', 'important');
      textDiv.style.setProperty('text-shadow', '0 1px 2px rgba(0,0,0,0.5)', 'important');
    }

    bar.dataset.plGradeColored = 'true';
  });
}

/**
 * Colorize variant history badges and any standalone percentage badges.
 * These are <a class="badge"> or <span class="badge"> containing "XX%".
 */
function colorizeBadges() {
  const dark = isDarkMode();
  const badges = document.querySelectorAll('.badge');

  badges.forEach(badge => {
    if (badge.dataset.plGradeColored) return;

    const text = badge.textContent.trim();
    const match = text.match(/^(\d+(?:\.\d+)?)%$/);
    if (!match) return;

    const grade = parseFloat(match[1]);
    if (isNaN(grade) || grade < 0 || grade > 100) return;

    const color = getColorForGrade(grade);

    // Wrap in filter-cancelling container when dark mode is active
    if (dark) {
      wrapWithFilterCancel(badge, 'span');
    }

    // Apply the color
    badge.style.setProperty('background-color', color, 'important');
    badge.style.setProperty('color', '#ffffff', 'important');
    badge.style.setProperty('border', 'none', 'important');

    // Remove Bootstrap color classes that might override our color
    const classesToRemove = Array.from(badge.classList).filter(c =>
      c.startsWith('badge-') || c.startsWith('bg-') || c.startsWith('text-bg-')
    );
    classesToRemove.forEach(c => badge.classList.remove(c));

    badge.dataset.plGradeColored = 'true';
  });
}

function applyGradeColors() {
  colorizeProgressBars();
  colorizeBadges();
}

// Re-apply on dynamic content changes (PrairieLearn uses AJAX in some places)
const observer = new MutationObserver(() => {
  if (isExtensionDisabled) return;
  applyGradeColors();
});
observer.observe(document.body, { childList: true, subtree: true });
