// tracker.js

class PrairieLearnTracker {
  constructor() {
    chrome.storage.local.get(['extensionDisabled'], (result) => {
      if (result.extensionDisabled) return;
      this.init();
    });
  }

  init() {
    const path = window.location.pathname;
    
    // Check if on Home Page
    if (path === '/' || path === '/pl' || path === '/pl/') {
      this.initHomeWidget();
    }
    
    // Check if on Assessments Page
    const assessmentsMatch = path.match(/\/pl\/course_instance\/(\d+)\/assessments\/?$/);
    if (assessmentsMatch) {
      const courseId = assessmentsMatch[1];
      this.initPinButtons(courseId);
    }
  }

  destroy() {
    const widget = document.getElementById('pl-extension-upcoming-widget');
    if (widget) widget.remove();

    document.querySelectorAll('.btn-xs.ms-2').forEach(btn => {
      if (btn.textContent === 'Pin' || btn.textContent === 'Unpin') btn.remove();
    });
  }

  // --- Home Page Logic ---

  async initHomeWidget() {
    // 1. Wait for the main container
    let container = await this.waitForElement('.content > .container, main .container, [data-component="HomeCards"]', 2000);
    
    if (!container) {
      // Aggressive fallback for empty pages where these elements might not exist
      container = document.querySelector('#content') || document.querySelector('main') || document.querySelector('.container') || document.body;
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
      body.innerHTML = `<div class="text-danger">Error loading data: ${fetchResponse.error}</div>`;
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
      courseName = navText.textContent.trim().split('-')[0].trim();
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
      let dueAt = null;
      const popoverBtn = cells[2].querySelector('button[data-bs-toggle="popover"]');
      
      if (popoverBtn) {
        const content = popoverBtn.getAttribute('data-bs-content') || '';
        const popDoc = parser.parseFromString(content, 'text/html');
        const popRows = popDoc.querySelectorAll('tr');
        if (popRows.length > 1) {
          const lastRow = popRows[popRows.length - 1];
          const cols = lastRow.querySelectorAll('td');
          if (cols.length >= 3) {
            const dateText = cols[2].textContent.trim();
            const cleanDateText = dateText.replace(/\([A-Z]+\)/, '').trim();
            const d = new Date(cleanDateText);
            if (!isNaN(d.getTime())) {
              dueAt = d.toISOString();
            }
          }
        }
      }

      assignments.push({
        courseId,
        courseName,
        title,
        url,
        badge,
        score,
        dueAt
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
      const badgeHTML = item.badge ? `<span class="badge bg-secondary me-1">${item.badge}</span>` : '';
      
      const dueStr = item.dueAt ? new Date(item.dueAt).toLocaleString([], {
        weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      }) : 'No due date';

      let progColor = 'secondary';
      if (item.score >= 100) progColor = 'success';
      else if (item.score >= 50) progColor = 'primary';
      else if (item.score > 0) progColor = 'warning';

      html += `
        <tr>
          <td class="align-middle">${item.courseName}</td>
          <td class="align-middle">
            ${pinBadge}
            ${badgeHTML}
            <a href="${item.url}">${item.title}</a>
          </td>
          <td class="align-middle">${dueStr}</td>
          <td class="align-middle" style="min-width: 120px;">
            <div class="progress border border-${progColor}">
              <div class="progress-bar bg-${progColor}" style="width: ${item.score}%">${item.score}%</div>
            </div>
          </td>
        </tr>
      `;
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;
  }

  // --- Assessments Page Logic ---

  async initPinButtons(courseId) {
    const table = await this.waitForElement('table[aria-label="Assessments"]');
    if (!table) return;

    // Get current pins to set initial state
    const pinsResponse = await chrome.runtime.sendMessage({ action: 'GET_PINS' });
    const pinnedMap = pinsResponse.success ? pinsResponse.pins : {};

    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) return; // not an assessment row

      const titleCell = cells[1];
      const link = titleCell.querySelector('a');
      if (!link) return;

      const url = link.getAttribute('href');
      const title = link.textContent.trim();
      
      const id = `${courseId}_${url}`;
      let isPinned = !!pinnedMap[id];

      const btn = document.createElement('button');
      btn.className = `btn btn-xs ms-2 ${isPinned ? 'btn-warning' : 'btn-outline-secondary'}`;
      btn.textContent = isPinned ? 'Unpin' : 'Pin';
      
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        btn.disabled = true;
        
        const assessment = { courseId, url, title, dueAt: null }; 

        const resp = await chrome.runtime.sendMessage({
          action: 'TOGGLE_PIN',
          assessment: assessment
        });

        if (resp.success) {
          isPinned = resp.isPinned;
          btn.className = `btn btn-xs ms-2 ${isPinned ? 'btn-warning' : 'btn-outline-secondary'}`;
          btn.textContent = isPinned ? 'Unpin' : 'Pin';
        }
        btn.disabled = false;
      });

      link.parentElement.appendChild(btn);
    });
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
