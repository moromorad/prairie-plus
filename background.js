// background.js

const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

class TrackerService {
  constructor() {
    this.initListeners();
  }

  initListeners() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'FETCH_ASSESSMENTS') {
        this.handleFetchAssessments(message.courseIds, message.origin)
          .then(data => sendResponse({ success: true, data }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep message channel open for async
      }
      
      if (message.action === 'TOGGLE_PIN') {
        this.togglePin(message.assessment)
          .then(isPinned => sendResponse({ success: true, isPinned }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
      }
      
      if (message.action === 'GET_PINS') {
        this.getPins()
          .then(pins => sendResponse({ success: true, pins }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
      }
    });
  }

  async handleFetchAssessments(courseIds, origin) {
    const data = await chrome.storage.local.get(['courseCache']);
    const cache = data.courseCache || {};
    const now = Date.now();

    const results = {};
    const idsToFetch = [];

    // Check cache
    for (const courseId of courseIds) {
      const cached = cache[courseId];
      if (cached && (now - cached.timestamp < CACHE_DURATION_MS)) {
        results[courseId] = cached.html;
      } else {
        idsToFetch.push(courseId);
      }
    }

    // Fetch missing
    for (const courseId of idsToFetch) {
      try {
        const url = `${origin}/pl/course_instance/${courseId}/assessments`;
        const response = await fetch(url);
        if (response.ok) {
          const html = await response.text();
          results[courseId] = html;
          cache[courseId] = {
            timestamp: now,
            html: html
          };
        }
      } catch (err) {
        console.error(`Failed to fetch for course ${courseId}:`, err);
      }
    }

    // Save updated cache
    await chrome.storage.local.set({ courseCache: cache });

    return results;
  }

  async getPins() {
    const data = await chrome.storage.local.get(['pinnedAssessments']);
    const pinned = data.pinnedAssessments || {};
    const now = Date.now();
    let changed = false;

    // Clean old pins (due dates in the past)
    const validPins = {};
    for (const [id, pin] of Object.entries(pinned)) {
      if (!pin.dueAt || new Date(pin.dueAt).getTime() > now) {
        validPins[id] = pin;
      } else {
        changed = true;
      }
    }

    if (changed) {
      await chrome.storage.local.set({ pinnedAssessments: validPins });
    }
    
    return validPins;
  }

  async togglePin(assessment) {
    const pins = await this.getPins();
    const id = `${assessment.courseId}_${assessment.url}`;
    
    let isPinned;
    if (pins[id]) {
      delete pins[id];
      isPinned = false;
    } else {
      pins[id] = assessment;
      isPinned = true;
    }

    await chrome.storage.local.set({ pinnedAssessments: pins });
    return isPinned;
  }
}

// Instantiate the service
new TrackerService();
