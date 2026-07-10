// devmode.js

if (typeof PrairieLearnTracker !== 'undefined') {
  PrairieLearnTracker.prototype.initDevMode = async function() {
    try {
      await this.setupMockPins();
    } catch (err) {
      console.warn('PL Extension: Mock pin setup failed (non-fatal)', err);
    }

    await this.initHomeWidget();

    // Add dev mode indicator to widget header
    const header = document.querySelector('#pl-extension-upcoming-widget .card-header');
    if (header) {
      header.classList.replace('bg-primary', 'bg-warning');
      header.classList.replace('text-white', 'text-dark');
      header.querySelector('h2').textContent = '\u{1F527} Upcoming Assignments (Dev Mode)';
    }

    await this.initMockAssessmentsSection();
  };

  PrairieLearnTracker.prototype.setupMockPins = async function() {
    // Pre-pin two items for demonstration (only if no pins exist yet)
    try {
      const existing = await chrome.runtime.sendMessage({ action: 'GET_PINS' });
      if (existing.success && Object.keys(existing.pins).length > 0) return;
    } catch (err) {
      // Continue with setup even if check fails
    }

    const mockAssignments = this.getMockAssignments();
    const pinsToSet = {};

    // Pin "Homework 3: Gauss's Law" (has due date — tests auto-expiry)
    const pinned1 = mockAssignments.find(a => a.url.includes('5010'));
    if (pinned1) {
      pinsToSet[`${pinned1.courseId}_${pinned1.url}`] = pinned1;
    }

    // Pin "Extra Credit: Red-Black Trees" (no due date — tests persistence)
    const pinned2 = mockAssignments.find(a => a.url.includes('5011'));
    if (pinned2) {
      pinsToSet[`${pinned2.courseId}_${pinned2.url}`] = pinned2;
    }

    await chrome.storage.local.set({ pinnedAssessments: pinsToSet });
  };

  PrairieLearnTracker.prototype.getMockAssignments = function() {
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    return [
      {
        courseId: '1001',
        courseName: 'CS-225 Data Structures',
        title: 'Homework 7: Binary Trees',
        url: '/pl/course_instance/1001/assessment/5001',
        badge: 'HW',
        score: 0,
        dueAt: new Date(now + 1 * DAY).toISOString(),
      },
      {
        courseId: '1001',
        courseName: 'CS-225 Data Structures',
        title: 'Lab 4: Hash Tables',
        url: '/pl/course_instance/1001/assessment/5002',
        badge: 'Lab',
        score: 30,
        dueAt: new Date(now + 3 * DAY).toISOString(),
      },
      {
        courseId: '1002',
        courseName: 'MATH 241 \u2013 Calculus III',
        title: 'Midterm Practice Exam',
        url: '/pl/course_instance/1002/assessment/5003',
        badge: 'Exam',
        score: 75,
        dueAt: new Date(now + 7 * DAY).toISOString(),
      },
      {
        courseId: '1002',
        courseName: 'MATH 241 \u2013 Calculus III',
        title: 'Homework 5: Partial Derivatives',
        url: '/pl/course_instance/1002/assessment/5004',
        badge: 'HW',
        score: 50,
        dueAt: new Date(now + 10 * DAY).toISOString(),
      },
      {
        courseId: '1001',
        courseName: 'CS-225 Data Structures',
        title: 'Final Project: Graph Algorithms',
        url: '/pl/course_instance/1001/assessment/5005',
        badge: 'Project',
        score: 0,
        dueAt: new Date(now + 21 * DAY).toISOString(),
      },
      {
        courseId: '1002',
        courseName: 'MATH 241 \u2013 Calculus III',
        title: 'Quiz 3: Vector Fields',
        url: '/pl/course_instance/1002/assessment/5006',
        badge: 'Quiz',
        score: 45,
        dueAt: new Date(now - 1 * DAY).toISOString(),
      },
      {
        courseId: '1001',
        courseName: 'CS-225 Data Structures',
        title: 'Homework 6: Heaps',
        url: '/pl/course_instance/1001/assessment/5007',
        badge: 'HW',
        score: 100,
        dueAt: new Date(now + 5 * DAY).toISOString(),
      },
      {
        courseId: '1003',
        courseName: 'PHYS 212 \u2014 E&M',
        title: 'Optional Practice Problems',
        url: '/pl/course_instance/1003/assessment/5008',
        badge: '',
        score: 10,
        dueAt: null,
      },
      {
        courseId: '1003',
        courseName: 'PHYS 212 \u2014 E&M',
        title: 'Lab 2: Circuits (Closed)',
        url: '/pl/course_instance/1003/assessment/5009',
        badge: 'Lab',
        score: 100,
        dueAt: new Date(now - 3 * DAY).toISOString(),
      },
      {
        courseId: '1003',
        courseName: 'PHYS 212 \u2014 E&M',
        title: 'Homework 3: Gauss\'s Law',
        url: '/pl/course_instance/1003/assessment/5010',
        badge: 'HW',
        score: 0,
        dueAt: new Date(now + 5 * DAY).toISOString(),
      },
      {
        courseId: '1001',
        courseName: 'CS-225 Data Structures',
        title: 'Extra Credit: Red-Black Trees',
        url: '/pl/course_instance/1001/assessment/5011',
        badge: 'EC',
        score: 0,
        dueAt: null,
      },
    ];
  };

  PrairieLearnTracker.prototype.initMockAssessmentsSection = async function() {
    let container = document.querySelector('.content > .container') ||
      document.querySelector('main .container') ||
      document.querySelector('#content') ||
      document.querySelector('.container') ||
      document.body;

    if (!container) return;
    if (document.getElementById('pl-extension-mock-assessments')) return;

    let pinnedMap = {};
    try {
      const pinsResponse = await chrome.runtime.sendMessage({ action: 'GET_PINS' });
      pinnedMap = pinsResponse.success ? pinsResponse.pins : {};
    } catch (err) {}

    const assignments = this.getMockAssignments();

    const edgeCases = [
      'Due tomorrow, 0% \u2192 shows (urgent)',
      'Due in 3d, 30% \u2192 shows',
      'Due in 1w, 75% \u2192 shows',
      'Due in 10d, 50% \u2192 shows',
      'Due in 3w \u2192 FILTERED (>14 days)',
      'Past due \u2192 FILTERED',
      '100% complete \u2192 FILTERED',
      'No due date \u2192 FILTERED (unless pinned)',
      'Closed + past due \u2192 FILTERED',
      'Due in 5d, 0% \u2192 PRE-PINNED',
      'No due date \u2192 PRE-PINNED (persistence test)',
    ];

    const section = document.createElement('div');
    section.id = 'pl-extension-mock-assessments';
    section.className = 'card mb-4';
    section.innerHTML = `
      <div class="card-header bg-info text-white d-flex justify-content-between align-items-center">
        <h2 class="mb-0 h4">\u{1F9EA} Dev Mode \u2013 All Mock Assessments</h2>
        <span class="badge bg-light text-dark">${assignments.length} items</span>
      </div>
      <div class="card-body">
        <p class="text-muted small mb-2">Pin/unpin items below, then click <strong>Refresh</strong> on the widget above to see changes.</p>
        <div class="table-responsive">
          <table class="table table-sm table-hover mb-0">
            <thead>
              <tr>
                <th>Course</th>
                <th>Assignment</th>
                <th>Due</th>
                <th>Score</th>
                <th>Expected Behavior</th>
              </tr>
            </thead>
            <tbody id="pl-ext-mock-tbody"></tbody>
          </table>
        </div>
      </div>
    `;

    const widget = document.getElementById('pl-extension-upcoming-widget');
    if (widget && widget.parentNode) {
      widget.parentNode.insertBefore(section, widget.nextSibling);
    } else {
      container.appendChild(section);
    }

    const tbody = document.getElementById('pl-ext-mock-tbody');

    assignments.forEach((a, i) => {
      const id = `${a.courseId}_${a.url}`;
      let isPinned = !!pinnedMap[id];

      const tr = document.createElement('tr');

      const dueStr = a.dueAt ? new Date(a.dueAt).toLocaleString([], {
        weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      }) : 'No due date';

      const badge = a.badge ? `<span class="badge bg-secondary me-1">${a.badge}</span>` : '';
      const desc = edgeCases[i] || '';
      const descClass = desc.includes('FILTERED') ? 'text-danger' :
                        desc.includes('PINNED') ? 'text-warning fw-bold' : 'text-success';

      tr.innerHTML = `
        <td class="align-middle">${a.courseName}</td>
        <td class="align-middle">
          ${badge}
          <a href="${a.url}">${a.title}</a>
        </td>
        <td class="align-middle">${dueStr}</td>
        <td class="align-middle">${a.score}%</td>
        <td class="align-middle small ${descClass}">${desc}</td>
      `;

      const titleCell = tr.querySelectorAll('td')[1];
      const btn = document.createElement('button');
      btn.className = `btn btn-xs ms-2 ${isPinned ? 'btn-warning' : 'btn-outline-secondary'}`;
      btn.textContent = isPinned ? 'Unpin' : 'Pin';
      btn.setAttribute('data-pl-ext-pin', id);

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        btn.disabled = true;
        try {
          const assessment = { courseId: a.courseId, url: a.url, title: a.title, dueAt: a.dueAt };
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

      titleCell.appendChild(btn);
      tbody.appendChild(tr);
    });
  };
}
