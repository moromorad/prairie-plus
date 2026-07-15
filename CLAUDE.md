# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome/browser extension (Manifest V3) for PrairieLearn that adds:
- An **Upcoming Assignments widget** on the PL home page, fetching and parsing each course's assessments page
- **Pin/Unpin buttons** on individual course assessment pages
- **Dark mode** toggled from the popup
- **Grade colorization** on assessment score bars and badges (red → orange → green)
- **Variant statistics** on question pages — a summary row (avg/best/perfect/open counts, parsed from the "All variants" badges) injected into the question score panel
- **Dev mode** — navigates to a local PrairieLearn instance at `http://localhost:3000`

## Loading the extension

No build step. Load unpacked directly in Chrome:
1. Open `chrome://extensions`
2. Enable Developer Mode
3. Click "Load unpacked" → select the `PrarieLearn-Extension/` folder

After any code change, click the reload button on the extension card in `chrome://extensions`.

## Architecture

### Script responsibilities

| File | Context | Role |
|---|---|---|
| `background.js` | Service worker | Fetches assessment HTML pages (with 5-min cache in `chrome.storage.local`), manages pin storage, handles `FETCH_ASSESSMENTS` / `TOGGLE_PIN` / `GET_PINS` messages |
| `content.js` | Injected into every PL page | Dark mode class toggling, grade colorization of `.progress` bars and `.badge` elements |
| `tracker.js` | Injected into every PL page | `PrairieLearnTracker` class — detects current page path, injects the home widget or pin buttons, parses HTML responses from background |
| `popup.js` | Extension popup | Sends messages to content script for dark mode; uses `chrome.tabs.update` for dev mode navigation |

### Message passing flow

```
popup.js ──toggleDarkMode──▶ content.js
tracker.js ──FETCH_ASSESSMENTS──▶ background.js ──fetch()──▶ PL server
tracker.js ──TOGGLE_PIN / GET_PINS──▶ background.js ──chrome.storage.local
```

### Key data structures

**Pin storage key** in `chrome.storage.local.pinnedAssessments`:
```js
{ [`${courseId}_${url}`]: { courseId, url, title, dueAt } }
```
Pins with a past `dueAt` are automatically pruned in `background.js#getPins()`.

**Assessment cache** in `chrome.storage.local.courseCache`:
```js
{ [courseId]: { timestamp: Number, html: String } }
```
Expires after 5 minutes; force-cleared when the user clicks Refresh.

### Page detection (tracker.js)

- **Home page** (`/`, `/pl`, `/pl/`): injects the upcoming widget, fetches all course assessment pages via background, filters to assignments due within 14 days and not 100% complete, pinned items always shown
- **Assessments page** (`/pl/course_instance/:id/assessments`): adds Pin/Unpin buttons inline to each table row
- **Question page** (path contains `/instance_question/`): injects a `Variant stats` row into `#question-score-panel-content`, directly after the "All variants:" row. Stats are computed from the variant badges (`a.badge` with "NN%" or "Open" text); hidden overflow badges are included. Only appears on Homework-type assessments (Exams have no "All variants" row).

### Dark mode implementation (content.js + dark-mode.css)

Applied as `html.pl-dark-mode` class. CSS uses `filter: invert(0.9) hue-rotate(180deg)` on `<body>`, with counter-filters on images, video, and iframes. The `.navbar` also gets a counter-filter to restore its original colors, but this creates a nested stacking context — so the navbar is explicitly given `position: relative; z-index: 9999` to keep its dropdown above the main content. Grade color elements use a JS wrapper div with `filter: hue-rotate(180deg) invert(1)` to cancel the body filter and preserve true RGB colors.

### Dev mode

The popup button checks if the active tab URL starts with `http://localhost` and navigates between `http://localhost:3000/pl` and `https://us.prairielearn.com/pl`. No storage state — dev mode is implicit from the current URL. The extension runs identically on localhost and prod; all content scripts and background fetches use `window.location.origin` so they naturally target whichever host is active.

## Reference project

`PrairieLearn-Assignment-Tracker/` is a separate open-source extension used as a functional reference (not copied directly). It has separate Chrome and Firefox builds. Consult it to understand how PrairieLearn's DOM is structured (table selectors, popover date format, navbar course name).
