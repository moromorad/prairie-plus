// tracker.js

class PrairieLearnTracker {
  constructor() {
    chrome.storage.local.get(['extensionDisabled', 'disableMathPreview'], (result) => {
      if (result.extensionDisabled) return;
      this.init(result.disableMathPreview);
    });
  }

  init(disableMathPreview = false) {
    const path = window.location.pathname;
    
    // Check if on Home Page
    if (path === '/' || path === '/pl' || path === '/pl/') {
      this.initHomeWidget();
    }
    
    // Check if on Assessments Page
    const assessmentsMatch = path.match(/\/pl\/course_instance\/(\d+)\/assessments\/?$/);
    if (assessmentsMatch) {
      this.initAssessmentsStats();
    }

    // Check if on a Question Page (student view of an instance question)
    if (path.includes('/instance_question/')) {
      this.initVariantStats();
      if (!disableMathPreview) {
        this.initMathRenderer();
      }
    }

    // Check if on a Workspace Page
    const workspaceMatch = path.match(/\/pl\/(?:public\/)?workspace\/(\d+)/);
    if (workspaceMatch) {
      this.initWorkspaceControls();
    }
  }

  destroy() {
    const widget = document.getElementById('pl-extension-upcoming-widget');
    if (widget) widget.remove();

    document.querySelectorAll('[data-pl-ext-pin]').forEach(btn => btn.remove());

    const statsRow = document.getElementById('pl-ext-variant-stats');
    if (statsRow) statsRow.remove();

    const invertItem = document.getElementById('pl-ext-invert-workspace-item');
    if (invertItem) invertItem.remove();
  }

  // --- Workspace Page Logic ---

  async initWorkspaceControls() {
    const navList = await this.waitForElement('#workspace-nav .navbar-nav');
    if (!navList) return;
    if (document.getElementById('pl-ext-invert-workspace-item')) return;

    const li = document.createElement('li');
    li.className = 'nav-item ms-2 my-1';
    li.id = 'pl-ext-invert-workspace-item';

    const btn = document.createElement('button');
    btn.id = 'pl-ext-invert-workspace-btn';
    btn.className = 'nav-item btn btn-light';
    btn.type = 'button';
    btn.title = 'Invert workspace editor (useful for light-themed tools like JupyterLab or RStudio)';

    const updateBtnUI = (inverted) => {
      btn.innerHTML = `<i class="fas fa-${inverted ? 'sun text-warning' : 'moon text-secondary'}" aria-hidden="true"></i> Invert Editor`;
      btn.classList.toggle('active', inverted);
    };

    chrome.storage.local.get(['invertWorkspaceIframe'], (result) => {
      const isInverted = !!result.invertWorkspaceIframe;
      if (isInverted) {
        document.documentElement.classList.add('pl-invert-workspace');
      }
      updateBtnUI(isInverted);
    });

    btn.addEventListener('click', () => {
      chrome.storage.local.get(['invertWorkspaceIframe'], (result) => {
        const newState = !result.invertWorkspaceIframe;
        chrome.storage.local.set({ invertWorkspaceIframe: newState }, () => {
          document.documentElement.classList.toggle('pl-invert-workspace', newState);
          updateBtnUI(newState);
        });
      });
    });

    if (!this._storageListenerBound) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.invertWorkspaceIframe !== undefined) {
          const val = !!changes.invertWorkspaceIframe.newValue;
          document.documentElement.classList.toggle('pl-invert-workspace', val);
          const currentBtn = document.getElementById('pl-ext-invert-workspace-btn');
          if (currentBtn) {
            currentBtn.innerHTML = `<i class="fas fa-${val ? 'sun text-warning' : 'moon text-secondary'}" aria-hidden="true"></i> Invert Editor`;
            currentBtn.classList.toggle('active', val);
          }
        }
      });
      this._storageListenerBound = true;
    }

    li.appendChild(btn);

    const lastItem = navList.lastElementChild;
    if (lastItem) {
      navList.insertBefore(li, lastItem);
    } else {
      navList.appendChild(li);
    }
  }

  // --- Home Page Logic ---

  async initHomeWidget() {
    // Prevent duplicate widget injection
    if (document.getElementById('pl-extension-upcoming-widget')) return;

    // 1. Wait for the main container
    let container = await this.waitForElement('main#content, .content > .container, main .container, [data-component="HomeCards"]', 2000);
    
    if (!container) {
      // Aggressive fallback for pages where the primary selectors don't match
      container = document.querySelector('main#content') || document.querySelector('main.container') || document.querySelector('#content') || document.querySelector('main') || document.querySelector('.container') || document.body;
    }
    
    if (!container) return;

    // Do not inject the widget if the user is not enrolled in any courses
    const courseIds = this.extractCourseIdsFromHome();
    if (courseIds.length === 0) return;

    // 2. Create the widget UI
    const widget = document.createElement('div');
    widget.id = 'pl-extension-upcoming-widget';
    widget.className = 'card mb-4';
    
    widget.innerHTML = `
      <div class="card-header bg-primary text-white d-flex justify-content-between align-items-center">
        <h2 class="mb-0 h4">Upcoming Assignments</h2>
        <button id="pl-ext-refresh-btn" class="btn btn-sm btn-light">Refresh</button>
      </div>
      <div class="card-body" id="pl-ext-upcoming-body">
        <div class="text-center text-muted">Loading...</div>
      </div>
    `;
    
    // Insert at the top of the container
    if (container.firstChild) {
      container.insertBefore(widget, container.firstChild);
    } else {
      container.appendChild(widget);
    }

    document.getElementById('pl-ext-refresh-btn').addEventListener('click', () => {
      this.loadDashboardData(true);
    });

    this.loadDashboardData(false);
  }

  async loadDashboardData(forceRefresh) {
    const body = document.getElementById('pl-ext-upcoming-body');
    if (!body) return;
    
    body.innerHTML = '<div class="text-center text-muted">Loading...</div>';

    try {

    // Get course IDs from the page
    const courseIds = this.extractCourseIdsFromHome();
    if (courseIds.length === 0) {
      body.innerHTML = '<div class="text-muted">No enrolled courses found.</div>';
      return;
    }

    // Clear cache if forcing refresh
    if (forceRefresh) {
      await chrome.storage.local.remove(['courseCache']);
    }

    // 1. Fetch raw HTMLs from background
    const fetchResponse = await chrome.runtime.sendMessage({
      action: 'FETCH_ASSESSMENTS',
      courseIds: courseIds,
      origin: window.location.origin
    });

    if (!fetchResponse.success) {
      body.innerHTML = `<div class="text-danger">Error loading data: ${escapeHtml(fetchResponse.error)}</div>`;
      return;
    }

    // 2. Parse the HTMLs
    const allAssignments = [];
    for (const [courseId, html] of Object.entries(fetchResponse.data)) {
      const parsed = this.parseAssessmentsHTML(html, courseId);
      allAssignments.push(...parsed);
    }

    // 3. Get pinned assignments
    const pinsResponse = await chrome.runtime.sendMessage({ action: 'GET_PINS' });
    const pinnedMap = pinsResponse.success ? pinsResponse.pins : {};

    // 4. Filter and sort
    const now = Date.now();
    const twoWeeksMs = 14 * 24 * 60 * 60 * 1000;
    
    const displayItems = allAssignments.filter(a => {
      const id = `${a.courseId}_${a.url}`;
      const isPinned = !!pinnedMap[id];
      a.isPinned = isPinned;
      
      if (isPinned) return true;
      
      // Filter out completed
      if (a.score >= 100) return false;
      
      // Filter out no due date or past due or far future
      if (!a.dueAt) return false;
      const dueTime = new Date(a.dueAt).getTime();
      if (dueTime < now || dueTime > now + twoWeeksMs) return false;
      
      return true;
    });

    displayItems.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
      const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
      return aDue - bDue;
    });

    // 5. Render
    this.renderUpcomingTable(body, displayItems);

    } catch (err) {
      console.error('PL Extension: Error loading dashboard data', err);
      body.innerHTML = `<div class="text-danger">Error: ${escapeHtml(err.message)}</div>`;
    }
  }

  extractCourseIdsFromHome() {
    const ids = new Set();
    document.querySelectorAll('a[href^="/pl/course_instance/"]').forEach(a => {
      const match = a.href.match(/\/pl\/course_instance\/(\d+)/);
      if (match) ids.add(match[1]);
    });
    return Array.from(ids);
  }

  parseAssessmentsHTML(html, courseId) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const assignments = [];

    // Find course name if possible
    let courseName = `Course ${courseId}`;
    const navText = doc.querySelector('.navbar-text');
    if (navText) {
      const fullText = navText.textContent.trim();
      const dashIdx = fullText.search(/\s[-\u2013\u2014]\s/);
      courseName = dashIdx > 0 ? fullText.substring(0, dashIdx).trim() : fullText;
    }

    const rows = doc.querySelectorAll('table[aria-label="Assessments"] tbody tr');
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) return;

      const titleLink = cells[1].querySelector('a');
      if (!titleLink) return;

      const title = titleLink.textContent.trim();
      const url = titleLink.getAttribute('href');
      
      // Badge
      const badgeEl = cells[1].querySelector('.badge');
      const badge = badgeEl ? badgeEl.textContent.trim() : '';

      // Score
      const scoreText = cells[3].textContent.trim();
      let score = 0;
      const scoreMatch = scoreText.match(/(\d+(?:\.\d+)?)%/);
      if (scoreMatch) score = parseFloat(scoreMatch[1]);
      else if (scoreText.toLowerCase().includes('not started')) score = 0;
      else if (scoreText.toLowerCase().includes('closed')) score = 100; // Treat closed as complete

      // Due Date
      const dueInfo = this.extractDueDate(cells[2]);
      const dueAt = dueInfo ? dueInfo.iso : null;
      const creditTier = dueInfo ? dueInfo.credit : null;

      assignments.push({
        courseId,
        courseName,
        title,
        url,
        badge,
        score,
        dueAt,
        creditTier
      });
    });

    return assignments;
  }

  renderUpcomingTable(container, items) {
    if (items.length === 0) {
      container.innerHTML = '<div class="text-muted">No upcoming incomplete assignments!</div>';
      return;
    }

    let html = `
      <div class="table-responsive">
        <table class="table table-sm table-hover table-striped mb-0">
          <thead>
            <tr>
              <th>Course</th>
              <th>Assignment</th>
              <th>Due</th>
              <th>Progress</th>
            </tr>
          </thead>
          <tbody>
    `;

    items.forEach(item => {
      const pinBadge = item.isPinned ? `<span class="badge bg-warning text-dark me-1" title="Pinned">Pinned</span>` : '';
      const badgeHTML = item.badge ? `<span class="badge bg-secondary me-1">${escapeHtml(item.badge)}</span>` : '';
      
      const formattedDate = item.dueAt ? new Date(item.dueAt).toLocaleString([], {
        weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      }) : 'No due date';

      const dueDisplay = (item.creditTier != null && item.dueAt)
        ? `${item.creditTier}% until ${formattedDate}`
        : formattedDate;

      let progColor = 'secondary';
      if (item.score >= 100) progColor = 'success';
      else if (item.score >= 50) progColor = 'primary';
      else if (item.score > 0) progColor = 'warning';

      const safeUrl = item.url ? encodeURI(item.url) : '#';
      const safeScore = Number.isFinite(item.score) ? Math.max(0, Math.min(100, item.score)) : 0;

      html += `
        <tr>
          <td class="align-middle">${escapeHtml(item.courseName)}</td>
          <td class="align-middle">
            ${pinBadge}
            ${badgeHTML}
            <a href="${safeUrl}">${escapeHtml(item.title)}</a>
          </td>
          <td class="align-middle text-nowrap">${escapeHtml(dueDisplay)}</td>
          <td class="align-middle" style="min-width: 120px;">
            <div class="progress border border-${progColor}">
              <div class="progress-bar bg-${progColor}" style="width: ${safeScore}%">${safeScore}%</div>
            </div>
          </td>
        </tr>
      `;
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;
  }

  // --- Due Date Extraction ---

  parseDateString(str) {
    if (!str) return null;
    const clean = str.replace(/\([A-Za-z0-9_+\-:\s]+\)/g, '').trim();
    if (!clean || clean === '—' || clean === '-') return null;

    const currentYear = new Date().getFullYear();
    const hasYear = /\b20\d{2}\b/.test(clean);

    if (hasYear) {
      const d = new Date(clean);
      if (!isNaN(d.getTime())) return d;
    }

    // Format: "23:59, Mon, Sep 21" or "14:30, Mon, Jan 5"
    const m1 = clean.match(/(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?)[,\s]+(?:[A-Za-z]{3},?\s+)?([A-Za-z]{3,9})\s+(\d{1,2})/i);
    if (m1) {
      const time = m1[1];
      const month = m1[2];
      const day = m1[3];
      const d = new Date(`${month} ${day}, ${currentYear} ${time}`);
      if (!isNaN(d.getTime())) return d;
    }

    // Format: "Mon, Sep 21, 11:59 PM" or "Sep 21, 11:59 PM"
    const m2 = clean.match(/(?:[A-Za-z]{3},?\s+)?([A-Za-z]{3,9})\s+(\d{1,2})(?:,?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?))?/i);
    if (m2) {
      const month = m2[1];
      const day = m2[2];
      const time = m2[3] || '23:59';
      const d = new Date(`${month} ${day}, ${currentYear} ${time}`);
      if (!isNaN(d.getTime())) return d;
    }

    const d = new Date(clean);
    if (!isNaN(d.getTime())) return d;

    return null;
  }

  extractDueDate(cell) {
    if (!cell) return null;
    const now = Date.now();

    // 1. Try parsing access rules from the popover table
    const popoverBtn = cell.querySelector('button[data-bs-toggle="popover"]');
    if (popoverBtn) {
      const content = popoverBtn.getAttribute('data-bs-content') || '';
      if (content) {
        const parser = new DOMParser();
        const popDoc = parser.parseFromString(content, 'text/html');
        const popRows = popDoc.querySelectorAll('tr');

        const tiers = [];
        popRows.forEach(row => {
          const cols = row.querySelectorAll('td');
          if (cols.length >= 3) {
            const creditStr = cols[0].textContent.trim();
            const dateStr = cols[2].textContent.trim();
            const d = this.parseDateString(dateStr);
            if (d) {
              const creditMatch = creditStr.match(/(\d+(?:\.\d+)?)%/);
              const credit = creditMatch ? parseFloat(creditMatch[1]) : (creditStr.toLowerCase().includes('none') ? 0 : 100);
              tiers.push({
                credit,
                date: d,
                iso: d.toISOString(),
                time: d.getTime()
              });
            }
          }
        });

        if (tiers.length > 0) {
          // Priority 1: 100% full-credit deadline in the future (the primary due date)
          const futureFullCredit = tiers.find(t => t.credit >= 100 && t.time >= now);
          if (futureFullCredit) return { iso: futureFullCredit.iso, credit: futureFullCredit.credit };

          // Priority 2: Earliest upcoming deadline with any credit (> 0) (e.g. in late submission window)
          const futureCreditTiers = tiers
            .filter(t => t.credit > 0 && t.time >= now)
            .sort((a, b) => a.time - b.time);
          if (futureCreditTiers.length > 0) return { iso: futureCreditTiers[0].iso, credit: futureCreditTiers[0].credit };

          // Priority 3: 100% deadline (even if in the past)
          const fullCreditTier = tiers.find(t => t.credit >= 100);
          if (fullCreditTier) return { iso: fullCreditTier.iso, credit: fullCreditTier.credit };

          // Priority 4: Earliest tier deadline
          return { iso: tiers[0].iso, credit: tiers[0].credit };
        }
      }
    }

    // 2. Fallback: Parse PrairieLearn's creditDateString directly from cell text
    // E.g. "100% until 23:59, Mon, Sep 21" or "100% until Mon, Sep 21, 11:59 PM"
    const cellClone = cell.cloneNode(true);
    cellClone.querySelectorAll('button, [data-bs-toggle="popover"]').forEach(el => el.remove());
    const cellText = cellClone.textContent.trim();

    const creditMatch = cellText.match(/(\d+(?:\.\d+)?)%/);
    const credit = creditMatch ? parseFloat(creditMatch[1]) : (cellText.toLowerCase().includes('none') ? 0 : 100);

    const untilMatch = cellText.match(/until\s+(.+?)(?:\s*$|\s*\(|\s*\n)/i);
    if (untilMatch) {
      const d = this.parseDateString(untilMatch[1]);
      if (d) return { iso: d.toISOString(), credit };
    }

    const directDate = this.parseDateString(cellText);
    if (directDate) return { iso: directDate.toISOString(), credit };

    return null;
  }

  // --- Assessments Page Logic ---

  async initPinButtons(courseId) {
    const table = await this.waitForElement('table[aria-label="Assessments"]');
    if (!table) return;

    // Get current pins to set initial state
    let pinnedMap = {};
    try {
      const pinsResponse = await chrome.runtime.sendMessage({ action: 'GET_PINS' });
      pinnedMap = pinsResponse.success ? pinsResponse.pins : {};
    } catch (err) {
      console.error('PL Extension: Failed to load pins', err);
    }

    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) return;

      const titleCell = cells[1];
      const link = titleCell.querySelector('a');
      if (!link) return;

      const url = link.getAttribute('href');
      const title = link.textContent.trim();
      const dueInfo = this.extractDueDate(cells[2]);
      const dueAt = dueInfo ? dueInfo.iso : null;
      const creditTier = dueInfo ? dueInfo.credit : null;

      const id = `${courseId}_${url}`;
      let isPinned = !!pinnedMap[id];

      const btn = document.createElement('button');
      btn.className = `btn btn-xs ms-2 ${isPinned ? 'btn-warning' : 'btn-outline-secondary'}`;
      btn.textContent = isPinned ? 'Unpin' : 'Pin';
      btn.setAttribute('data-pl-ext-pin', id);

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        btn.disabled = true;

        try {
          const assessment = { courseId, url, title, dueAt, creditTier };

          const resp = await chrome.runtime.sendMessage({
            action: 'TOGGLE_PIN',
            assessment: assessment
          });

          if (resp.success) {
            isPinned = resp.isPinned;
            btn.className = `btn btn-xs ms-2 ${isPinned ? 'btn-warning' : 'btn-outline-secondary'}`;
            btn.textContent = isPinned ? 'Unpin' : 'Pin';
          }
        } catch (err) {
          console.error('PL Extension: Failed to toggle pin', err);
        }
        btn.disabled = false;
      });

      link.parentElement.appendChild(btn);
    });
  }

  // --- Question Page Logic (variant statistics) ---

  /**
   * On a question page, the score panel (right sidebar) shows a row of badges
   * under "All variants:" — one per variant, each either "NN%" or "Open".
   * This injects a summary row (average / best / counts) directly below it,
   * between the variants row and the points rows.
   */
  async initVariantStats() {
    const panel = await this.waitForElement('#question-score-panel-content');
    if (!panel) return;
    if (document.getElementById('pl-ext-variant-stats')) return;

    // Find the "All variants:" row (only present on Homework-type assessments)
    const variantsRow = Array.from(panel.querySelectorAll('tbody > tr')).find(row =>
      row.textContent.trim().startsWith('All variants:')
    );
    if (!variantsRow) return;

    // Each variant is an <a class="badge"> containing "NN%" or "Open".
    // Older overflowed variants are hidden with display:none but still in the
    // DOM, so this includes every variant. The current variant's badge also
    // contains a visually-hidden "(current)" span, so match loosely.
    const scores = [];
    let openCount = 0;
    variantsRow.querySelectorAll('a.badge').forEach(badge => {
      const text = badge.textContent;
      const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
      if (match) {
        scores.push(parseFloat(match[1]));
      } else if (/\bopen\b/i.test(text)) {
        openCount++;
      }
    });

    const total = scores.length + openCount;
    if (total === 0) return;

    let summaryHTML;
    if (scores.length === 0) {
      summaryHTML = '<small class="text-muted">No graded variants yet</small>';
    } else {
      const avg = Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
      const best = Math.max(...scores);
      const perfectCount = scores.filter(s => s >= 100).length;

      const counts = [`${perfectCount}/${scores.length} perfect`];
      if (openCount > 0) counts.push(`${openCount} open`);

      summaryHTML = `
        <span class="text-nowrap me-1">Avg <span class="badge text-bg-secondary">${avg}%</span></span>
        <span class="text-nowrap me-1">Best <span class="badge text-bg-secondary">${best}%</span></span>
        <small class="text-muted text-nowrap">${counts.join(' &middot; ')}</small>
      `;
    }

    const statsRow = document.createElement('tr');
    statsRow.id = 'pl-ext-variant-stats';
    statsRow.innerHTML = `
      <td colspan="2" class="text-wrap">
        Variant stats: ${summaryHTML}
      </td>
    `;
    variantsRow.insertAdjacentElement('afterend', statsRow);
  }

  // --- Question Page Logic (Math Preview) ---

  initMathRenderer() {
    const selector = '.pl-symbolic-input, .pl-string-input';
    document.querySelectorAll(selector).forEach(el => this.setupMathPreview(el));

    const observer = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        if (mut.type === 'childList') {
          mut.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.matches && node.matches(selector)) {
                this.setupMathPreview(node);
              }
              if (node.querySelectorAll) {
                node.querySelectorAll(selector).forEach(el => this.setupMathPreview(el));
              }
            }
          });
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  setupMathPreview(containerEl) {
    if (containerEl.dataset.plExtMathPreview) return;
    containerEl.dataset.plExtMathPreview = 'true';

    // Find the input field, which could be inside shadow DOM or just a child
    let input = containerEl.querySelector('input:not([type="hidden"])') || containerEl.querySelector('textarea');
    if (!input && containerEl.shadowRoot) {
      input = containerEl.shadowRoot.querySelector('input:not([type="hidden"])') || containerEl.shadowRoot.querySelector('textarea');
    }
    
    // If no input is found inside, maybe containerEl itself is the input
    if (!input && (containerEl.tagName === 'INPUT' || containerEl.tagName === 'TEXTAREA')) {
        input = containerEl;
    }

    if (!input) {
      console.warn('PL Extension: No input found for math preview inside', containerEl);
      return;
    }

    const previewDiv = document.createElement('div');
    previewDiv.className = 'pl-ext-math-preview mt-2 p-2 border rounded bg-light text-dark';
    previewDiv.style.minHeight = '3em';
    // Always show it so the user knows it's there
    previewDiv.style.display = 'block';
    
    // Insert after the container to avoid breaking Bootstrap's .input-group flex layout
    containerEl.insertAdjacentElement('afterend', previewDiv);

    const updatePreview = () => {
      const val = input.value.trim();
      if (!val) {
        previewDiv.innerHTML = '<span class="text-muted small">Type LaTeX to preview...</span>';
        return;
      }
      
      if (typeof katex !== 'undefined') {
        const latexStr = plToLatex(val);
        katex.render(latexStr, previewDiv, {
          throwOnError: false,
          displayMode: true,
          output: 'htmlAndMathml'
        });
      } else {
        previewDiv.textContent = 'Error: KaTeX not loaded';
      }
    };

    input.addEventListener('input', updatePreview);
    
    // Initial render
    updatePreview();
  }

  waitForElement(selector, timeout = 5000) {
    return new Promise(resolve => {
      if (document.querySelector(selector)) {
        return resolve(document.querySelector(selector));
      }

      const observer = new MutationObserver(mutations => {
        if (document.querySelector(selector)) {
          observer.disconnect();
          resolve(document.querySelector(selector));
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }
}

// Instantiate
const tracker = new PrairieLearnTracker();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extensionDisabledChanged') {
    if (request.disabled) {
      tracker.destroy();
    } else {
      tracker.init();
    }
  }
});

// --- HTML Escaping Helper ---

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- PL to LaTeX Conversion Helpers ---

function plToLatex(str) {
  if (!str) return '';
  let out = str;

  // 1. Balanced functions (abs, Abs, sqrt, factorial)
  out = replaceBalancedFunc(out, 'sqrt', '\\sqrt{', '}');
  out = replaceBalancedFunc(out, 'abs', '\\left|{', '}\\right|');
  out = replaceBalancedFunc(out, 'Abs', '\\left|{', '}\\right|');
  out = replaceBalancedFunc(out, 'factorial', '(', ')!');

  // 2. Fractions (Heuristic)
  out = replaceFractions(out);

  // 3. Constants
  out = out.replace(/(^|[^\\])\b(pi|infty)\b/g, '$1\\$2');

  // 4. Exponentiation
  out = out.replace(/\*\*/g, '^');

  // 5. Functions
  const funcs = ['exp', 'log', 'ln', 'sgn', 'max', 'min', 'sign', 'Max', 'Min',
                 'cos', 'sin', 'tan', 'sec', 'cot', 'csc', 'cosh', 'sinh', 'tanh',
                 'arccos', 'arcsin', 'arctan', 'acos', 'asin', 'atan', 'arctan2', 'atan2', 'atanh', 'acosh', 'asinh'];
  const funcRegex = new RegExp('(^|[^\\\\])\\b(' + funcs.join('|') + ')\\b', 'g');
  out = out.replace(funcRegex, '$1\\$2');

  // 6. Greek letters
  const greekLetters = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'omicron', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega',
                        'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Rho', 'Sigma', 'Tau', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega'];
  const greekRegex = new RegExp('(^|[^\\\\])\\b(' + greekLetters.join('|') + ')\\b', 'g');
  out = out.replace(greekRegex, '$1\\$2');

  return out;
}

function replaceBalancedFunc(str, funcName, prefix, suffix) {
  let result = '';
  let i = 0;
  let searchStr = funcName + '(';
  
  while (i < str.length) {
    let idx = str.indexOf(searchStr, i);
    if (idx === -1) {
      result += str.substring(i);
      break;
    }
    // Ensure word boundary before funcName
    if (idx > 0 && /[a-zA-Z0-9_]/.test(str[idx-1])) {
      result += str.substring(i, idx + 1);
      i = idx + 1;
      continue;
    }
    
    result += str.substring(i, idx) + prefix;
    
    let pCount = 1;
    let j = idx + searchStr.length;
    let inner = '';
    while (j < str.length && pCount > 0) {
      if (str[j] === '(') pCount++;
      else if (str[j] === ')') pCount--;
      
      if (pCount > 0) inner += str[j];
      j++;
    }
    
    // Process inner recursively for the same function
    result += replaceBalancedFunc(inner, funcName, prefix, suffix) + suffix;
    i = j;
  }
  return result;
}

function replaceFractions(str) {
  let result = '';
  let i = 0;
  
  while (i < str.length) {
    let char = str[i];
    if (char === '/') {
      // Find numerator from the END of `result`
      let numStart = result.length - 1;
      while (numStart >= 0 && /\s/.test(result[numStart])) numStart--;
      
      let actualNumStart = numStart;
      if (numStart >= 0) {
        if (result[numStart] === ')') {
          let pCount = 1;
          actualNumStart--;
          while (actualNumStart >= 0 && pCount > 0) {
            if (result[actualNumStart] === ')') pCount++;
            else if (result[actualNumStart] === '(') pCount--;
            actualNumStart--;
          }
          actualNumStart++;
        } else if (result[numStart] === '}') {
          let pCount = 1;
          actualNumStart--;
          while (actualNumStart >= 0 && pCount > 0) {
            if (result[actualNumStart] === '}') pCount++;
            else if (result[actualNumStart] === '{') pCount--;
            actualNumStart--;
          }
          while (actualNumStart >= 0 && /[a-zA-Z\\]/.test(result[actualNumStart])) {
            actualNumStart--;
          }
          actualNumStart++;
        } else {
          while (actualNumStart >= 0 && /[a-zA-Z0-9_.]/.test(result[actualNumStart])) {
            actualNumStart--;
          }
          actualNumStart++;
        }
      } else {
        actualNumStart = 0;
      }
      
      if (result[actualNumStart] === '(') {
         let funcStart = actualNumStart - 1;
         while (funcStart >= 0 && /[a-zA-Z0-9_]/.test(result[funcStart])) {
           funcStart--;
         }
         actualNumStart = funcStart + 1;
      }

      let numerator = result.substring(actualNumStart).trim();
      result = result.substring(0, actualNumStart);
      
      // Find denominator from `str`
      let denStart = i + 1;
      while (denStart < str.length && /\s/.test(str[denStart])) denStart++;
      
      let actualDenEnd = denStart;
      if (denStart < str.length) {
        let tempEnd = denStart;
        while (tempEnd < str.length && /[a-zA-Z0-9_]/.test(str[tempEnd])) tempEnd++;
        if (tempEnd < str.length && str[tempEnd] === '(') {
           actualDenEnd = tempEnd;
        }
        
        if (str[actualDenEnd] === '(') {
          let pCount = 1;
          actualDenEnd++;
          while (actualDenEnd < str.length && pCount > 0) {
            if (str[actualDenEnd] === '(') pCount++;
            else if (str[actualDenEnd] === ')') pCount--;
            actualDenEnd++;
          }
        } else {
          while (actualDenEnd < str.length && /[a-zA-Z0-9_.]/.test(str[actualDenEnd])) {
            actualDenEnd++;
          }
        }
      }
      
      let denominator = str.substring(denStart, actualDenEnd).trim();
      result += '\\frac{' + numerator + '}{' + denominator + '}';
      i = actualDenEnd;
    } else {
      result += char;
      i++;
    }
  }
  return result;
}
