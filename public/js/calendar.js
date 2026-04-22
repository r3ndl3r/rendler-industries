// /public/js/calendar.js

/**
 * Family Calendar Controller
 * 
 * Manages the multi-view calendar interface using a state-driven architecture. 
 * Coordinates event scheduling, real-time synchronization, and administrative 
 * management through a synchronized interface.
 * 
 * Features:
 * - Multi-view rendering for Month, Week, and Day modes.
 * - Real-time synchronization with event roster.
 * - Optimized local scheduling workflows.
 * - High-resolution upcoming event widget with automatic countdowns.
 * - Administrative management ledger with category filtering.
 * - Synchronized stream for metadata and event payloads.
 * - Strict Privacy Mandate: Private events visible only to owner/admin.
 * 
 * Dependencies:
 * - default.js: For apiPost, setupGlobalModalClosing, and modal helpers.
 * - toast.js: For operation feedback.
 */

/**
 * --- Module Configuration & State ---
 */
const CONFIG = {
    SYNC_INTERVAL_MS: 300000,        // Background server sync (5 min)
    COUNTDOWN_TICK_MS: 60000,       // Relative time update frequency (1 min)
    SCROLL_DELAY_MS: 100            // UI timing for vertical alignment
};

let STATE = {
    events: [],                     // Master collection of {id, title, start_date, end_date, ...}
    filteredEvents: [],             // Active view filtered collection
    categories: [],                 // List of unique event category labels
    users: [],                      // Family roster for attendee selection
    isAdmin: false,                 // Authorization gate for administrative actions
    currentUserId: null,            // ID of currently logged-in user
    currentDate: new Date(),        // Active temporal pointer
    currentView: 'month',           // Current display mode (month|week|day)
    historyMode: false,             // Flag for full audit/history view
    allEvents: []                   // Full history cache (when historyMode is active)
};

/**
 * Bootstraps the module state and establishes background lifecycles.
 * 
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', () => {
    // 1. Context detection
    STATE.historyMode = false; // Initialized as false, triggered via UI

    // 2. Initial state hydration
    loadState();

    // 3. Event listener registration
    setupEventListeners();

    // 4. Background lifecycles
    setInterval(loadEvents, CONFIG.SYNC_INTERVAL_MS);
    setInterval(renderUpcomingEvents, CONFIG.COUNTDOWN_TICK_MS);

    // 5. Global modal closure configuration
    window.setupGlobalModalClosing(['modal-overlay'], [closeEventModal, closeDetailsModal, closeHistoryModal]);
});

/**
 * --- Data Management & Synchronization ---
 */

/**
 * Synchronizes structural metadata and initiates event fetching.
 * Skips the refresh cycle if the user is currently interacting with a modal
 * or has an active cursor in an input field, unless 'force' is true.
 * 
 * @async
 * @param {boolean} force - If true, bypasses inhibition checks (e.g., after save).
 * @returns {Promise<void>}
 */
async function loadState(force = false) {
    // Skip background refresh if a modal is active OR the user is typing in an input field.
    // This prevents overwriting user input or causing focus-loss jumps.
    const anyModalOpen = document.querySelector('.modal-overlay.show, .modal-overlay.active, .delete-modal-overlay.show, .delete-modal-overlay.active');
    const inputFocused = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
    
    if (!force && (anyModalOpen || inputFocused) && (STATE.events.length > 0 || STATE.users.length > 0)) return;

    try {
        const response = await fetch('/calendar/api/state');
        const data = await response.json();
        
        if (data && data.success) {
            STATE.categories = data.categories || [];
            STATE.users = data.users || [];
            STATE.isAdmin = !!data.is_admin;
            STATE.currentUserId = data.current_user_id;
            
            // UI Setup based on state
            populateDropdowns();
            
            const notifyGroup = document.getElementById('notificationGroup');
            if (notifyGroup) {
                if (STATE.isAdmin) notifyGroup.classList.remove('hidden');
                else notifyGroup.classList.add('hidden');
            }
            
            if (true) { // Always initialize view from URL on main page
                initializeViewFromUrl();
            }
            
            await loadEvents();
        }
    } catch (err) {
        console.error('loadState failed:', err);
    }
}

/**
 * Fetches events within the current viewport range and triggers redraw.
 * Skips the refresh cycle if the user is currently interacting with a modal
 * or has an active cursor in an input field, unless 'force' is true.
 * 
 * @async
 * @param {boolean} force - If true, bypasses inhibition checks (e.g., after save).
 * @returns {Promise<void>}
 */
async function loadEvents(force = false) {
    // Skip background refresh if a modal is active OR the user is typing in an input field.
    // This prevents overwriting user input or causing focus-loss jumps.
    const anyModalOpen = document.querySelector('.modal-overlay.show, .modal-overlay.active, .delete-modal-overlay.show, .delete-modal-overlay.active');
    const inputFocused = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');

    if (!force && (anyModalOpen || inputFocused) && STATE.events.length > 0) return;

    let start, end;
    
    if (STATE.historyMode) {
        start = '2020-01-01';
        end = '2030-12-31';
    } else {
        const vEnd = getViewEndDate();
        const buffer = new Date();
        buffer.setDate(buffer.getDate() + 30); // Ensure at least 30 days visibility for the Upcoming widget

        start = formatDate(getViewStartDate());
        end = formatDate(vEnd > buffer ? vEnd : buffer);
    }

    const container = document.getElementById('calendarView');
    // Show initial pulse if collection is empty
    if (container && !container.querySelector('.component-loading') && STATE.events.length === 0) {
        container.innerHTML = `
            <div class="component-loading">
                <div class="loading-scan-line"></div>
                <span class="loading-icon-pulse">📅</span>
                <p class="loading-label">Synchronizing...</p>
            </div>`;
    }

    try {
        const response = await fetch(`/calendar/api/events?start=${start}&end=${end}`);
        const data = await response.json();
        
        if (data && data.success) {
            STATE.events = (data.events || []).map(e => ({
                ...e,
                uid: e.is_recurring_instance
                    ? `r${e.recurrence_source_id}_${(e.instance_date || '').replace(/-/g, '')}`
                    : String(e.id)
            }));
            applyFilters();
            renderUI();
        }
    } catch (err) {
        console.error('loadEvents failed:', err);
    }
}

/**
 * --- UI Rendering Engine ---
 */

/**
 * Orchestrates the full UI synchronization lifecycle based on current mode.
 * 
 * @returns {void}
 */
function renderUI() {
    if (STATE.historyMode) {
        renderHistoryTable();
    } else {
        updatePeriodTitle();
        renderCalendar();
        renderUpcomingEvents();
    }
}

/**
 * Populates all category and attendee selection components from state.
 * 
 * @returns {void}
 */
function populateDropdowns() {
    // 1. Category Filter & Datalist
    const filterSelects = document.querySelectorAll('.category-dropdown');
    const categoryDatalist = document.getElementById('categoryList');
    
    const categoryOptions = STATE.categories.map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join('');
    filterSelects.forEach(select => {
        const currentVal = select.value;
        select.innerHTML = '<option value="">All Categories</option>' + categoryOptions;
        select.value = currentVal;
    });

    if (categoryDatalist) {
        categoryDatalist.innerHTML = STATE.categories.map(cat => `<option value="${escapeHtml(cat)}">`).join('');
    }

    // 2. Attendee Checkboxes
    const recipients = STATE.users.map(u => ({ id: u.id, label: escapeHtml(u.username) }));
    window.renderSelectorGrid('attendees-container', recipients, { name: 'attendees[]', prefix: 'attendee', type: 'day' });

}

/**
 * Generates the primary calendar layout (Month/Week/Day).
 * 
 * @returns {void}
 */
function renderCalendar() {
    if (STATE.currentView === 'month') renderMonthView();
    else if (STATE.currentView === 'week') renderWeekView();
    else if (STATE.currentView === 'day') renderDayView();
}

/**
 * Generates the standard 7-column month grid.
 * 
 * @returns {void}
 */
function renderMonthView() {
    const container = document.getElementById('calendarView');
    if (!container) return;
    
    container.innerHTML = '<div class="calendar-grid"></div>';
    const grid = container.querySelector('.calendar-grid');
    
    ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].forEach(day => {
        const header = document.createElement('div');
        header.className = 'calendar-day-header';
        header.innerHTML = `<span class="day-full">${day}</span><span class="day-abbr">${day.substring(0, 3)}</span>`;
        grid.appendChild(header);
    });
    
    const start = getViewStartDate();
    const end = getViewEndDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = formatDate(d);
        const cell = document.createElement('div');
        cell.className = 'calendar-day';
        cell.onclick = () => openAddEventModal(dateStr);
        
        if (d.getTime() === today.getTime()) cell.classList.add('today');
        if (d.getMonth() !== STATE.currentDate.getMonth()) cell.classList.add('other-month');
        if (d < today) cell.classList.add('past-day');
        
        cell.innerHTML = `<div class="day-number">${d.getDate()}</div>`;
        
        const dayEvents = getEventsForDate(dateStr);
        if (dayEvents.length > 0) {
            const eventsDiv = document.createElement('div');
            eventsDiv.className = 'day-events';
            eventsDiv.innerHTML = dayEvents.map(e => renderEventPill(e, true)).join('');
            cell.appendChild(eventsDiv);
        }
        
        grid.appendChild(cell);
    }
}

/**
 * Generates the focused 7-day strip layout.
 * 
 * @returns {void}
 */
function renderWeekView() {
    const container = document.getElementById('calendarView');
    if (!container) return;
    
    container.innerHTML = '<div class="calendar-grid calendar-view-week"></div>';
    const grid = container.querySelector('.calendar-grid');
    
    ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].forEach(day => {
        const header = document.createElement('div');
        header.className = 'calendar-day-header';
        header.innerHTML = `<span class="day-full">${day}</span><span class="day-abbr">${day.substring(0, 3)}</span>`;
        grid.appendChild(header);
    });
    
    const start = getViewStartDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        const dateStr = formatDate(d);
        
        const cell = document.createElement('div');
        cell.className = 'calendar-day';
        cell.onclick = () => openAddEventModal(dateStr);
        if (d.getTime() === today.getTime()) cell.classList.add('today');
        
        cell.innerHTML = `<div class="day-number">${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>`;
        
        const dayEvents = getEventsForDate(dateStr);
        if (dayEvents.length > 0) {
            const eventsDiv = document.createElement('div');
            eventsDiv.className = 'day-events';
            eventsDiv.innerHTML = dayEvents.map(e => renderEventPill(e, false)).join('');
            cell.appendChild(eventsDiv);
        }
        
        grid.appendChild(cell);
    }
}

/**
 * Generates the 24-hour vertical timeline.
 * 
 * @returns {void}
 */
function renderDayView() {
    const container = document.getElementById('calendarView');
    if (!container) return;
    
    const dateStr = formatDate(STATE.currentDate);
    container.innerHTML = '<div class="calendar-day-view-container"></div>';
    const dayGrid = container.querySelector('.calendar-day-view-container');

    for (let h = 0; h < 24; h++) {
        const row = document.createElement('div');
        row.className = 'calendar-hour-row';
        
        const displayHour = h === 0 ? '12 AM' : (h > 12 ? `${h - 12} PM` : (h === 12 ? '12 PM' : `${h} AM`));
        
        row.innerHTML = `
            <div class="calendar-hour-label">${displayHour}</div>
            <div class="calendar-hour-events" onclick="openAddEventModal('${dateStr}')">
                ${getEventsForHour(dateStr, h).map(e => `
                    <div class="event-item" style="--event-color: ${e.color};" onclick="event.stopPropagation(); showEventDetails('${e.uid}')">
                        ${e.is_private ? '🔒' : ''}
                        <strong>${escapeHtml(e.title)}</strong>${e.is_recurring_instance ? ' 🔁' : ''} ${e.all_day ? '(All Day)' : ''}
                    </div>
                `).join('')}
            </div>
        `;
        dayGrid.appendChild(row);
    }
}

/**
 * Generates the HTML fragment for an event pill.
 * 
 * @param {Object} e - Event metadata.
 * @param {boolean} compact - Flag for initials-only attendees.
 * @returns {string} - Rendered HTML.
 */
function renderEventPill(e, compact) {
    const timeStr = (e.all_day || compact) ? '' : ` - ${formatTime(e.start_date)}`;
    let attendeeHtml = '';
    
    if (e.attendee_names) {
        const names = e.attendee_names.split(',').map(n => n.trim());
        attendeeHtml = `<div class="event-attendees">` + names.map((name, i) => {
            const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            return `<span class="attendee-pill attendee-color-${(i % 8) + 1}" title="${escapeHtml(name)}">${compact ? initials : escapeHtml(name)}</span>`;
        }).join('') + `</div>`;
    }

    const recurIcon = e.is_recurring_instance ? ' 🔁' : '';

    return `
        <div class="event-item ${e.all_day ? 'all-day' : ''} ${e.is_private ? 'private-event' : ''}" style="--event-color: ${e.color};" onclick="event.stopPropagation(); showEventDetails('${e.uid}')">
            <div class="event-item-content">
                <span class="event-title">
                    ${e.is_private ? '🔒' : ''}
                    ${escapeHtml(e.title)}${timeStr}${recurIcon}
                </span>
                ${attendeeHtml}
            </div>
        </div>
    `;
}

/**
 * Generates the audit history table within the modal.
 * 
 * @returns {void}
 */
function renderHistoryTable() {
    const container = document.getElementById('historyTableContainer');
    if (!container) return;

    // Filter by search text and category if present
    const query = (document.getElementById('historySearchInput')?.value || '').toLowerCase();
    const catFilter = document.getElementById('historyCategoryFilter')?.value || '';

    const baseEvents = STATE.events.filter(e => {
        const matchesQuery = !query || 
            (e.title && e.title.toLowerCase().includes(query)) || 
            (e.description && e.description.toLowerCase().includes(query));
        const matchesCat = !catFilter || e.category === catFilter;
        return matchesQuery && matchesCat;
    });

    // Recurring events are returned as instances; show one representative row per series in history.
    const seenSeries = new Set();
    const uniqueEvents = baseEvents.filter(e => {
        if (!e.is_recurring_instance) return true;
        if (seenSeries.has(e.recurrence_source_id)) return false;
        seenSeries.add(e.recurrence_source_id);
        return true;
    });

    const now = new Date();
    const upcoming = uniqueEvents.filter(e => new Date(e.end_date || e.start_date) >= now).sort((a, b) => a.start_date.localeCompare(b.start_date));
    const past = uniqueEvents.filter(e => new Date(e.end_date || e.start_date) < now).sort((a, b) => b.start_date.localeCompare(a.start_date));

    container.innerHTML = `
        <h3 class="history-sub-header">Upcoming Events</h3>
        ${renderTable(upcoming, 'No upcoming events found.')}
        <h3 class="history-sub-header past">Past Events</h3>
        ${renderTable(past, 'No past events found.')}
    `;
}

/**
 * Interface entry for the History Audit modal.
 */
async function openHistoryModal() {
    const modal = document.getElementById('historyModal');
    if (!modal) return;
    
    STATE.historyMode = true;
    modal.classList.add('show');
    document.body.classList.add('modal-open');
    
    // Clear search
    const input = document.getElementById('historySearchInput');
    if (input) input.value = '';
    
    await loadEvents(true); // Fetch wide range
}

function closeHistoryModal() {
    const modal = document.getElementById('historyModal');
    if (!modal) return;
    
    STATE.historyMode = false;
    modal.classList.remove('show');
    document.body.classList.remove('modal-open');
    
    loadEvents(true); // Restore narrow range for calendar
}

function filterHistory() {
    renderHistoryTable();
}

/**
 * Internal table generator for management views.
 * 
 * @param {Object[]} events - Record collection.
 * @param {string} emptyMsg - Label for zero-record states.
 * @returns {string} - Rendered HTML table.
 */
function renderTable(events, emptyMsg) {
    if (events.length === 0) return `<div class="empty-state">${emptyMsg}</div>`;

    let lastDay = '';
    let groupClass = 'group-even';
    let html = `
        <table class="events-table grouped-table">
            <thead>
                <tr>
                    <th class="col-title">Title</th>
                    <th class="col-time">Time</th>
                    <th class="col-category">Category</th>
                    <th class="col-attendees">Attendees</th>
                    <th class="col-creator">Created By</th>
                    <th class="col-actions-header">Actions</th>
                </tr>
            </thead>
            <tbody>
    `;

    events.forEach(e => {
        const currentDay = e.start_date.split(' ')[0];
        if (currentDay !== lastDay) {
            lastDay = currentDay;
            groupClass = (groupClass === 'group-odd') ? 'group-even' : 'group-odd';
            
            html += `
                <tr class="day-group-header ${groupClass}">
                    <td colspan="6">
                        <div class="day-group-label">📅 ${formatDateWithOrdinal(currentDay)}</div>
                    </td>
                </tr>
            `;
        }

        const timeDisplay = e.all_day ? 'All Day' : `${formatTime(e.start_date)} - ${formatTime(e.end_date)}`;

        html += `
        <tr data-event-id="${e.id}" class="${groupClass} ${e.is_private ? 'table-row-private' : ''}" onclick="showEventDetails('${e.uid}')" style="cursor: pointer;">
            <td>
                <span class="event-color-dot" style="--event-color: ${e.color}"></span>
                ${e.is_private ? '🔒' : ''}
                <strong>${escapeHtml(e.title)}${e.recurrence_rule ? ' 🔁' : ''}</strong>
                ${e.description ? `<div class="event-desc">${escapeHtml(e.description)}</div>` : ''}
            </td>
            <td class="date-cell">${timeDisplay}</td>
            <td>${escapeHtml(e.category || '-')}</td>
            <td class="attendees-cell">
                <div class="attendee-pills-container">
                    ${renderAttendeePills(e.attendee_names, true)}
                </div>
            </td>
            <td>${escapeHtml(e.creator_name || 'Unknown')}</td>
            <td class="actions-cell">
                <div class="action-btns">
                    <button type="button" class="btn-icon-view" title="View Details">👁️</button>
                    <button type="button" class="btn-icon-delete" onclick="event.stopPropagation(); confirmDeleteEvent(${e.id}, '${escapeHtml(e.title)}')" title="Delete">🗑️</button>
                </div>
            </td>
        </tr>

        `;
    });

    html += `</tbody></table>`;
    return html;
}

/**
 * Formats a date string into "Sunday, 8th March 2026" format.
 * 
 * @param {string} dateStr - YYYY-MM-DD string.
 * @returns {string} - Formatted date.
 */
function formatDateWithOrdinal(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
    const day = d.getDate();
    const month = d.toLocaleDateString('en-US', { month: 'long' });
    const year = d.getFullYear();

    const ordinal = (day) => {
        if (day > 3 && day < 21) return 'th';
        switch (day % 10) {
            case 1:  return "st";
            case 2:  return "nd";
            case 3:  return "rd";
            default: return "th";
        }
    };

    return `${dayName}, ${day}${ordinal(day)} ${month} ${year}`;
}

/**
 * Formats time from SQL string to 12h AM/PM (e.g. "12:00PM").
 * 
 * @param {string} dtStr - SQL datetime.
 * @returns {string} - Formatted time.
 */
function formatTime(dtStr) {
    const t = dtStr.split(' ')[1];
    if (!t) return '';
    const [h, m] = t.split(':');
    const hour = parseInt(h);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    return `${hour % 12 || 12}:${m}${ampm}`;
}

/**
 * Generates the sidebar upcoming events widget.
 * 
 * @returns {void}
 */
function renderUpcomingEvents() {
    const container = document.getElementById('upcomingEventsList');
    if (!container) return;

    const now = new Date();
    const futureLimit = new Date();
    futureLimit.setDate(futureLimit.getDate() + 30);

    const upcoming = STATE.events
        .map(e => ({ ...e, parsedStart: new Date(e.start_date.replace(' ', 'T')) }))
        .filter(e => e.parsedStart >= now && e.parsedStart <= futureLimit)
        .sort((a, b) => a.parsedStart - b.parsedStart);

    if (upcoming.length === 0) {
        container.innerHTML = '<div class="upcoming-empty">No upcoming events</div>';
        return;
    }

    let lastDay = '';
    let html = '';

    upcoming.forEach(e => {
        const currentDay = e.start_date.split(' ')[0];
        if (currentDay !== lastDay) {
            lastDay = currentDay;
            html += `
                <div class="upcoming-day-header">
                    📅 ${formatDateWithOrdinal(currentDay)}
                </div>
            `;
        }

        const timeInfo = e.all_day ? 'All Day' : `${formatTime(e.start_date)} - ${formatTime(e.end_date)}`;

        html += `
            <div class="upcoming-event-item ${e.is_private ? 'private-event' : ''}" style="--event-color: ${e.color}" onclick="showEventDetails('${e.uid}')">
                <div class="upcoming-event-color"></div>
                <div class="upcoming-event-details">
                    <div class="upcoming-event-title">
                        ${e.is_private ? '🔒' : ''}
                        ${escapeHtml(e.title)}
                    </div>
                    <div class="upcoming-event-datetime">${timeInfo}</div>
                    ${e.attendee_names ? `<div class="upcoming-event-attendees">${renderAttendeePills(e.attendee_names, true)}</div>` : ''}
                    <div class="upcoming-event-countdown">${getCountdown(e.parsedStart)}</div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

/**
 * --- Interactive Handlers ---
 */

/**
 * Orchestrates navigation control and filter registration.
 * 
 * @returns {void}
 */
function setupEventListeners() {
    const prev = document.getElementById('prevPeriod');
    const next = document.getElementById('nextPeriod');
    const today = document.getElementById('todayBtn');
    const add = document.getElementById('addEventBtn');
    const filter = document.getElementById('categoryFilter');
    
    if (prev) prev.onclick = navigatePrevious;
    if (next) next.onclick = navigateNext;
    if (today) today.onclick = navigateToday;
    if (add) add.onclick = () => openAddEventModal();
    if (filter) filter.onchange = () => { applyFilters(); renderUI(); };
    
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.onclick = () => {
            STATE.currentView = btn.dataset.view;
            updateViewButtons();
            loadEvents();
        };
    });

    const startInput = document.getElementById('eventStartDate');
    const endInput = document.getElementById('eventEndDate');
    if (startInput && endInput) {
        startInput.onchange = () => { if (!endInput.value || endInput.value < startInput.value) endInput.value = startInput.value; };
    }

    const allDayCb = document.getElementById('eventAllDay');
    if (allDayCb) {
        allDayCb.onchange = () => {
            const timeGroups = [document.getElementById('startTimeGroup'), document.getElementById('endTimeGroup')];
            timeGroups.forEach(g => { 
                if (g) {
                    if (allDayCb.checked) g.classList.add('hidden');
                    else g.classList.remove('hidden');
                }
            });
        };
    }

    const recurrenceSelect  = document.getElementById('recurrenceRule');
    const recurrenceOptions = document.getElementById('recurrenceOptions');
    const intervalLabel     = document.getElementById('recurrenceIntervalLabel');
    const intervalLabels    = { daily: 'days', weekly: 'weeks', monthly: 'months', yearly: 'years' };
    if (recurrenceSelect && recurrenceOptions) {
        recurrenceSelect.addEventListener('change', () => {
            const val = recurrenceSelect.value;
            if (val) {
                recurrenceOptions.classList.remove('hidden');
                if (intervalLabel) intervalLabel.textContent = intervalLabels[val] || 'periods';
            } else {
                recurrenceOptions.classList.add('hidden');
            }
        });
    }

    const notifyCb      = document.getElementById('eventNotify');
    const reminderGroup = document.getElementById('reminderPresetsGroup');
    if (notifyCb && reminderGroup) {
        notifyCb.onchange = () => {
            if (notifyCb.checked) {
                reminderGroup.classList.remove('hidden');
            } else {
                reminderGroup.classList.add('hidden');
                const _rd = document.getElementById('reminderDays');
                const _rh = document.getElementById('reminderHours');
                const _rm = document.getElementById('reminderMinutes');
                const _nm = document.getElementById('notificationMinutes');
                if (_rd) _rd.value = 0;
                if (_rh) _rh.value = 0;
                if (_rm) _rm.value = 0;
                if (_nm) _nm.value = 0;
            }
        };

        ['reminderDays', 'reminderHours', 'reminderMinutes'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', _syncReminderMinutes);
        });
    }
}

function _syncReminderMinutes() {
    const dEl = document.getElementById('reminderDays');
    const hEl = document.getElementById('reminderHours');
    const mEl = document.getElementById('reminderMinutes');
    const nEl = document.getElementById('notificationMinutes');
    if (!dEl || !hEl || !mEl || !nEl) return;
    const days  = parseInt(dEl.value) || 0;
    const hours = parseInt(hEl.value) || 0;
    const mins  = parseInt(mEl.value) || 0;
    nEl.value = days * 1440 + hours * 60 + mins;
}

function _populateReminderDropdowns(totalMins) {
    const days  = Math.floor(totalMins / 1440);
    const hours = Math.floor((totalMins % 1440) / 60);
    const mins  = totalMins % 60;
    const dEl = document.getElementById('reminderDays');
    const hEl = document.getElementById('reminderHours');
    const mEl = document.getElementById('reminderMinutes');
    const nEl = document.getElementById('notificationMinutes');
    if (!dEl || !hEl || !mEl || !nEl) return;
    const clampedDays = Math.min(days, 7);
    dEl.value = clampedDays;
    hEl.value = hours;
    mEl.value = mins;
    nEl.value = clampedDays * 1440 + hours * 60 + mins;
}

/**
 * Executes persistent record creation or modification.
 * 
 * @async
 * @param {Event} event - Triggering form event.
 * @returns {Promise<void>}
 */
async function handleEventSubmit(event) {
    if (event) event.preventDefault();
    
    const form = event.target;
    const btn = document.getElementById('saveEventBtn');
    const id = document.getElementById('eventId').value;
    const url = id ? '/calendar/api/edit' : '/calendar/api/add';
    
    const formData = new FormData(form);
    
    // VALIDATION: If notifications are enabled, at least one attendee MUST be selected
    const notifyMins = parseInt(document.getElementById('notificationMinutes').value || 0);
    const attendeesCount = document.querySelectorAll('#attendees-container input:checked').length;
    
    if (notifyMins > 0 && attendeesCount === 0) {
        window.showToast('Please select at least one attendee to receive notifications', 'error');
        return;
    }

    const start = `${formData.get('start_date')} ${formData.get('start_time') || '00:00'}:00`;
    const end = `${formData.get('end_date')} ${formData.get('end_time') || '23:59'}:59`;
    formData.set('start_date', start);
    formData.set('end_date', end);

    // Explicitly set checkbox values to ensure they are captured in FormData.
    formData.set('all_day', document.getElementById('eventAllDay').checked ? 1 : 0);
    formData.set('is_private', document.getElementById('eventIsPrivate').checked ? 1 : 0);
    
    const sendNotifyCb = document.getElementById('sendNotifications');
    if (sendNotifyCb) formData.set('send_notifications', sendNotifyCb.checked ? 1 : 0);

    const eventNotifyCb = document.getElementById('eventNotify');
    if (eventNotifyCb) formData.set('event_notify', eventNotifyCb.checked ? 1 : 0);

    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `⌛ Saving...`;

    try {
        const result = await window.apiPost(url, formData);
        if (result && result.success) {
            closeEventModal();
            await loadEvents(true);
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * --- Viewport & Navigation Helpers ---
 */

/**
 * Calculates view mode specific navigation shifts.
 * 
 * @returns {void}
 */
function navigatePrevious() {
    if (STATE.currentView === 'month') {
        STATE.currentDate.setDate(1);
        STATE.currentDate.setMonth(STATE.currentDate.getMonth() - 1);
    }
    else if (STATE.currentView === 'week') STATE.currentDate.setDate(STATE.currentDate.getDate() - 7);
    else STATE.currentDate.setDate(STATE.currentDate.getDate() - 1);
    loadEvents();
}

/**
 * Calculates view mode specific navigation shifts.
 * 
 * @returns {void}
 */
function navigateNext() {
    if (STATE.currentView === 'month') {
        STATE.currentDate.setDate(1);
        STATE.currentDate.setMonth(STATE.currentDate.getMonth() + 1);
    }
    else if (STATE.currentView === 'week') STATE.currentDate.setDate(STATE.currentDate.getDate() + 7);
    else STATE.currentDate.setDate(STATE.currentDate.getDate() + 1);
    loadEvents();
}

/**
 * Resets pointer to current system date.
 * 
 * @returns {void}
 */
function navigateToday() {
    STATE.currentDate = new Date();
    loadEvents();
}

/**
 * --- Modal Controllers ---
 */

/**
 * Displays the event editor in creation mode.
 * 
 * @param {string} [dateStr] - Optional default start date.
 * @returns {void}
 */
function openAddEventModal(dateStr) {
    const modal = document.getElementById('eventModal');
    const form = document.getElementById('eventForm');
    if (!modal || !form) return;

    form.reset();
    document.getElementById('eventId').value = '';
    document.getElementById('modalTitle').innerHTML = `Add Event`;
    document.getElementById('deleteEventBtn').classList.add('hidden');
    document.getElementById('cloneEventBtn').classList.add('hidden');

    // Reset recurrence
    const _rRule = document.getElementById('recurrenceRule');
    const _rOpts = document.getElementById('recurrenceOptions');
    const _rIntv = document.getElementById('recurrenceInterval');
    const _rEnd  = document.getElementById('recurrenceEndDate');
    const _rSkip = document.getElementById('skipOccurrenceBtn');
    if (_rRule) _rRule.value = '';
    if (_rOpts) _rOpts.classList.add('hidden');
    if (_rIntv) _rIntv.value = 1;
    if (_rEnd)  _rEnd.value  = '';
    if (_rSkip) _rSkip.classList.add('hidden');

    // Initial notification state
    const notifyCb = document.getElementById('eventNotify');
    if (notifyCb) {
        notifyCb.checked = false;
        const _rg = document.getElementById('reminderPresetsGroup');
        const _nm = document.getElementById('notificationMinutes');
        const _rd = document.getElementById('reminderDays');
        const _rh = document.getElementById('reminderHours');
        const _rm = document.getElementById('reminderMinutes');
        if (_rg) _rg.classList.add('hidden');
        if (_nm) _nm.value = 0;
        if (_rd) _rd.value = 0;
        if (_rh) _rh.value = 0;
        if (_rm) _rm.value = 0;
    }
    
    if (dateStr) {
        document.getElementById('eventStartDate').value = dateStr;
        document.getElementById('eventEndDate').value = dateStr;
    }

    const activeFilter = document.getElementById('categoryFilter').value;
    if (activeFilter) {
        document.getElementById('eventCategory').value = activeFilter;
    }

    modal.classList.add('show');
    document.body.classList.add('modal-open');
}

/**
 * Displays the event editor in modification mode.
 * 
 * @param {number} id - Target resource ID.
 * @returns {void}
 */
function openEditModalById(id) {
    const event = STATE.events.find(e => e.id == id);
    if (!event) return;

    document.getElementById('eventId').value = event.id;
    document.getElementById('eventTitle').value = event.title;
    document.getElementById('eventDescription').value = event.description || '';
    document.getElementById('eventCategory').value = event.category || '';
    document.getElementById('eventColor').value = event.color || '#3788d8';
    document.getElementById('eventAllDay').checked = !!event.all_day;
    document.getElementById('eventIsPrivate').checked = !!event.is_private;
    
    const [sDate, sTime] = event.start_date.split(' ');
    const [eDate, eTime] = event.end_date.split(' ');
    document.getElementById('eventStartDate').value = sDate;
    document.getElementById('eventStartTime').value = (sTime || '').substring(0, 5);
    document.getElementById('eventEndDate').value = eDate;
    document.getElementById('eventEndTime').value = (eTime || '').substring(0, 5);

    const attendeeIds = (event.attendees || '').split(',');
    document.querySelectorAll('#attendees-container input[type="checkbox"]').forEach(cb => {
        cb.checked = attendeeIds.includes(cb.value);
    });

    // Populate Notifications
    const notifyCb      = document.getElementById('eventNotify');
    const reminderGroup = document.getElementById('reminderPresetsGroup');
    if (notifyCb && reminderGroup) {
        const mins = parseInt(event.notification_minutes || 0);
        notifyCb.checked = mins > 0;

        if (mins > 0) {
            reminderGroup.classList.remove('hidden');
            _populateReminderDropdowns(mins);
        } else {
            reminderGroup.classList.add('hidden');
            const _rd = document.getElementById('reminderDays');
            const _rh = document.getElementById('reminderHours');
            const _rm = document.getElementById('reminderMinutes');
            const _nm = document.getElementById('notificationMinutes');
            if (_rd) _rd.value = 0;
            if (_rh) _rh.value = 0;
            if (_rm) _rm.value = 0;
            if (_nm) _nm.value = 0;
        }
    }

    // Recurrence fields (management table always edits the series, never an instance)
    const ruleEl = document.getElementById('recurrenceRule');
    if (ruleEl) {
        ruleEl.value = event.recurrence_rule || '';
        ruleEl.dispatchEvent(new Event('change'));
        const _ri = document.getElementById('recurrenceInterval');
        const _re = document.getElementById('recurrenceEndDate');
        if (_ri) _ri.value = event.recurrence_interval || 1;
        if (_re) _re.value = event.recurrence_end_date || '';
    }
    const skipBtn = document.getElementById('skipOccurrenceBtn');
    if (skipBtn) skipBtn.classList.add('hidden');

    document.getElementById('modalTitle').innerHTML = `Edit Event`;

    // Authorization: Only owner or admin can see action buttons
    const canManage = (STATE.currentUserId == event.created_by || STATE.isAdmin);
    if (canManage) {
        document.getElementById('deleteEventBtn').classList.remove('hidden');
        document.getElementById('cloneEventBtn').classList.remove('hidden');
        document.getElementById('deleteEventBtn').onclick = () => confirmDeleteEvent(event.id, event.title);
        document.getElementById('cloneEventBtn').onclick = () => cloneEvent(event);
    } else {
        document.getElementById('deleteEventBtn').classList.add('hidden');
        document.getElementById('cloneEventBtn').classList.add('hidden');
    }

    const modal = document.getElementById('eventModal');
    modal.classList.add('show');
    document.body.classList.add('modal-open');
}

/**
 * Displays the event editor for a calendar-view event or recurring instance, identified by uid.
 * For instances, sets eventId to recurrence_source_id so the submit targets the base DB row.
 * Instances are self-contained — no base-event lookup in STATE is needed.
 *
 * @param {string} uid - Synthetic uid assigned in loadEvents.
 * @returns {void}
 */
function openEditModalByUid(uid) {
    const event = STATE.events.find(e => e.uid == uid);
    if (!event) return;

    document.getElementById('eventId').value = event.is_recurring_instance
        ? event.recurrence_source_id
        : event.id;
    document.getElementById('eventTitle').value = event.title;
    document.getElementById('eventDescription').value = event.description || '';
    document.getElementById('eventCategory').value = event.category || '';
    document.getElementById('eventColor').value = event.color || '#3788d8';
    document.getElementById('eventAllDay').checked = !!event.all_day;
    document.getElementById('eventIsPrivate').checked = !!event.is_private;

    const [sDate, sTime] = event.start_date.split(' ');
    const [eDate, eTime] = event.end_date.split(' ');
    document.getElementById('eventStartDate').value = sDate;
    document.getElementById('eventStartTime').value = (sTime || '').substring(0, 5);
    document.getElementById('eventEndDate').value = eDate;
    document.getElementById('eventEndTime').value = (eTime || '').substring(0, 5);

    const attendeeIds = (event.attendees || '').split(',');
    document.querySelectorAll('#attendees-container input[type="checkbox"]').forEach(cb => {
        cb.checked = attendeeIds.includes(cb.value);
    });

    // Notifications
    const notifyCb      = document.getElementById('eventNotify');
    const reminderGroup = document.getElementById('reminderPresetsGroup');
    if (notifyCb && reminderGroup) {
        const mins = parseInt(event.notification_minutes || 0);
        notifyCb.checked = mins > 0;
        if (mins > 0) {
            reminderGroup.classList.remove('hidden');
            _populateReminderDropdowns(mins);
        } else {
            reminderGroup.classList.add('hidden');
            const _rd = document.getElementById('reminderDays');
            const _rh = document.getElementById('reminderHours');
            const _rm = document.getElementById('reminderMinutes');
            const _nm = document.getElementById('notificationMinutes');
            if (_rd) _rd.value = 0;
            if (_rh) _rh.value = 0;
            if (_rm) _rm.value = 0;
            if (_nm) _nm.value = 0;
        }
    }

    // Recurrence fields — present on both base and instance (instance is self-contained)
    const ruleEl = document.getElementById('recurrenceRule');
    if (ruleEl) {
        ruleEl.value = event.recurrence_rule || '';
        ruleEl.dispatchEvent(new Event('change'));
        const _ri = document.getElementById('recurrenceInterval');
        const _re = document.getElementById('recurrenceEndDate');
        if (_ri) _ri.value = event.recurrence_interval || 1;
        if (_re) _re.value = event.recurrence_end_date || '';
    }

    // Skip button — visible for recurring instances only
    const skipBtn = document.getElementById('skipOccurrenceBtn');
    if (skipBtn) {
        skipBtn.classList.toggle('hidden', !event.is_recurring_instance);
        if (event.is_recurring_instance) {
            skipBtn.onclick = () => skipOccurrence(event.recurrence_source_id, event.instance_date);
        }
    }

    document.getElementById('modalTitle').innerHTML = event.is_recurring_instance
        ? 'Edit Event Series'
        : (event.id ? 'Edit Event' : 'Add Event');

    // Authorization
    const canManage = (STATE.currentUserId == event.created_by || STATE.isAdmin);
    if (canManage) {
        document.getElementById('deleteEventBtn').classList.remove('hidden');
        document.getElementById('cloneEventBtn').classList.remove('hidden');
        document.getElementById('deleteEventBtn').onclick = () => confirmDeleteEvent(
            event.is_recurring_instance ? event.recurrence_source_id : event.id, event.title);
        document.getElementById('cloneEventBtn').onclick = () => cloneEvent(event);
    } else {
        document.getElementById('deleteEventBtn').classList.add('hidden');
        document.getElementById('cloneEventBtn').classList.add('hidden');
    }

    const modal = document.getElementById('eventModal');
    modal.classList.add('show');
    document.body.classList.add('modal-open');
}

/**
 * Posts a date to the skip-occurrence endpoint and reloads events.
 *
 * @param {number} id - Base event DB id.
 * @param {string} date - YYYY-MM-DD date string of the occurrence to skip.
 * @returns {Promise<void>}
 */
async function skipOccurrence(id, date) {
    const result = await window.apiPost('/calendar/api/skip_occurrence', { id, date });
    if (result && result.success) { closeEventModal(); loadEvents(true); }
}

/**
 * Transforms an edit context into a new event creation context.
 * 
 * @param {Object} event - Source event metadata.
 * @returns {void}
 */
function cloneEvent(event) {
    document.getElementById('eventId').value = '';
    document.getElementById('modalTitle').innerHTML = `Clone Event`;
    
    document.getElementById('deleteEventBtn').classList.add('hidden');
    document.getElementById('cloneEventBtn').classList.add('hidden');

    const notifyGroup = document.getElementById('notificationGroup');
    if (notifyGroup) {
        if (STATE.isAdmin) notifyGroup.classList.remove('hidden');
        else notifyGroup.classList.add('hidden');
    }
}

/**
 * Orchestrates the terminal event removal flow.
 * 
 * @param {number} id - Target identifier.
 * @param {string} title - Display label for context.
 * @returns {void}
 */
function confirmDeleteEvent(id, title) {
    window.showConfirmModal({
        title: 'Delete Event',
        message: `Are you sure you want to remove \"<strong>${escapeHtml(title)}</strong>\"?`,
        danger: true,
        confirmText: 'Delete',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const result = await window.apiPost('/calendar/api/delete', { id: id });
            if (result && result.success) {
                closeEventModal();
                await loadEvents(true);
            }
        }
    });
}

/**
 * Displays the detailed lightbox for a specific record.
 * 
 * @param {number} id - Target identifier.
 * @returns {void}
 */
function showEventDetails(uid) {
    const event = STATE.events.find(e => e.uid == uid);
    if (!event) return;

    const content = document.getElementById('eventDetailsContent');
    const dateStr = formatDateTimeFriendly(event.start_date, event.all_day);
    const timeInfo = event.all_day ? 'All Day' : `${formatTime(event.start_date)} - ${formatTime(event.end_date)}`;

    content.innerHTML = `
        <div class="event-details-header">
            <h2 style="--header-color: ${event.color}; color: var(--header-color)">
                ${event.is_private ? '🔒' : ''}
                ${escapeHtml(event.title)}
            </h2>
        </div>
        <div class="event-details-body">
            ${event.is_private ? `<div class="event-detail-row status-private"><strong>🔒 Status:</strong> <span class="badge-private">Private Event</span></div>` : ''}
            <div class="event-detail-row"><strong>📅 Date:</strong> <span>${dateStr}</span></div>
            <div class="event-detail-row"><strong>🕒 Time:</strong> <span>${timeInfo}</span></div>
            ${event.category ? `<div class="event-detail-row"><strong>ℹ️ Category:</strong> <span>${escapeHtml(event.category)}</span></div>` : ''}
            ${event.recurrence_rule ? `<div class="event-detail-row"><strong>🔁 Repeat:</strong> <span>Every ${event.recurrence_interval || 1} ${event.recurrence_rule.replace('ly', 's')}${event.recurrence_end_date ? ` until ${event.recurrence_end_date.split('-').reverse().join('-')}` : ''}</span></div>` : ''}
            ${event.notification_minutes && event.notification_minutes > 0 ? `<div class="event-detail-row"><strong>🔔 Reminder:</strong> <span>${formatReminderMinutes(event.notification_minutes)} before</span></div>` : ''}
            ${event.description ? `<div class="event-detail-row"><strong>📋 Description:</strong> <span>${escapeHtml(event.description)}</span></div>` : ''}
            ${event.attendee_names ? `<div class="event-detail-row"><strong>👨‍👩‍👧‍👦 Attendees:</strong> <span>${renderAttendeePills(event.attendee_names, true)}</span></div>` : ''}
            <div class="event-detail-row"><strong>👤 Created By:</strong> <span>${escapeHtml(event.creator_name || 'Unknown')}</span></div>
        </div>

    `;

    document.getElementById('editFromDetailsBtn').onclick = () => { closeDetailsModal(); openEditModalByUid(event.uid); };
    
    // Hide Edit button if user cannot manage the event
    const editBtn = document.getElementById('editFromDetailsBtn');
    if (editBtn) {
        if (STATE.currentUserId == event.created_by || STATE.isAdmin) editBtn.classList.remove('hidden');
        else editBtn.classList.add('hidden');
    }

    const modal = document.getElementById('eventDetailsModal');
    modal.classList.add('show');
    document.body.classList.add('modal-open');
}

/**
 * Hides the event editor.
 * 
 * @returns {void}
 */
function closeEventModal() {
    const modal = document.getElementById('eventModal');
    if (modal) {
        modal.classList.remove('show');
        document.body.classList.remove('modal-open');
    }
}

/**
 * Hides the detail lightbox.
 * 
 * @returns {void}
 */
function closeDetailsModal() {
    const modal = document.getElementById('eventDetailsModal');
    if (modal) {
        modal.classList.remove('show');
        document.body.classList.remove('modal-open');
    }
}

/**
 * --- Utilities ---
 */

/**
 * Synchronizes navigation pill states.
 * 
 * @returns {void}
 */
function updateViewButtons() {
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === STATE.currentView);
    });
}

/**
 * Reconciles temporal grid filters based on UI selection.
 * 
 * @returns {void}
 */
function applyFilters() {
    const cat = document.getElementById('categoryFilter').value;
    STATE.filteredEvents = cat ? STATE.events.filter(e => e.category === cat) : STATE.events;
}

/**
 * Formats a Date object to YYYY-MM-DD.
 * 
 * @param {Date} date - Source object.
 * @returns {string} - Formatted string.
 */
function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Generates a high-density descriptive date/time label.
 * 
 * @param {string} dtStr - SQL datetime.
 * @param {boolean} allDay - Flag for date-only focus.
 * @returns {string} - Friendly label.
 */
function formatDateTimeFriendly(dtStr, allDay) {
    if (!dtStr) return '-';
    const [datePart] = dtStr.split(' ');
    const dateStr = formatDateWithOrdinal(datePart);
    if (allDay) return dateStr;
    return `${dateStr} at ${formatTime(dtStr)}`;
}

/**
 * Generates attendee initials pills.
 * 
 * @param {string} namesStr - Comma-separated list.
 * @param {boolean} [useFullName=false] - Whether to render full names instead of initials.
 * @returns {string} - Rendered HTML.
 */
function renderAttendeePills(namesStr, useFullName = false) {
    if (!namesStr) return '';
    return namesStr.split(',').map((name, i) => {
        const n = name.trim();
        const display = useFullName ? n : n.split(' ').map(part => part[0]).join('').substring(0, 2).toUpperCase();
        return `<span class="attendee-pill attendee-color-${(i % 8) + 1}" title="${escapeHtml(n)}">${escapeHtml(display)}</span>`;
    }).join('');
}

/**
 * Generates a relative countdown string.
 * 
 * @param {Date} target - Target date.
 * @returns {string} - Descriptive string.
 */
function getCountdown(target) {
    const diff = target - new Date();
    if (diff < 0) return 'Started';
    
    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
    const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (d > 0) {
        return `In ${d} day${d !== 1 ? 's' : ''}, ${h} hour${h !== 1 ? 's' : ''}`;
    } else if (h > 0) {
        return `In ${h} hour${h !== 1 ? 's' : ''}, ${m} minute${m !== 1 ? 's' : ''}`;
    } else {
        return `In ${m} minute${m !== 1 ? 's' : ''}`;
    }
}

/**
 * Formats notification minutes into a friendly string (e.g., "1 day").
 * 
 * @param {number} totalMins - Minute count.
 * @returns {string} - Friendly label.
 */
function formatReminderMinutes(totalMins) {
    if (totalMins === 0) return 'At time of event';
    const days  = Math.floor(totalMins / 1440);
    const hours = Math.floor((totalMins % 1440) / 60);
    const mins  = totalMins % 60;
    
    let parts = [];
    if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
    if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
    if (mins > 0) parts.push(`${mins} minute${mins !== 1 ? 's' : ''}`);
    
    return parts.join(', ');
}

/**
 * Resolves Monday-aligned viewport start.

 * 
 * @returns {Date} - Start date object.
 */
function getViewStartDate() {
    const d = new Date(STATE.currentDate);
    d.setHours(0, 0, 0, 0);
    if (STATE.currentView === 'month') {
        const first = new Date(d.getFullYear(), d.getMonth(), 1);
        const diff = first.getDay() === 0 ? 6 : first.getDay() - 1;
        first.setDate(first.getDate() - diff);
        return first;
    } else if (STATE.currentView === 'week') {
        const diff = d.getDay() === 0 ? 6 : d.getDay() - 1;
        d.setDate(d.getDate() - diff);
        return d;
    }
    return d;
}

/**
 * Resolves Sunday-aligned viewport end.
 * 
 * @returns {Date} - End date object.
 */
function getViewEndDate() {
    const d = new Date(STATE.currentDate);
    d.setHours(23, 59, 59, 999);
    if (STATE.currentView === 'month') {
        const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        const lastDayOfWeek = last.getDay();
        const daysUntilSunday = lastDayOfWeek === 0 ? 0 : 7 - lastDayOfWeek;
        last.setDate(last.getDate() + daysUntilSunday);
        return last;
    } else if (STATE.currentView === 'week') {
        const start = getViewStartDate();
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        return end;
    }
    return d;
}

/**
 * Filters master collection for a specific date.
 * 
 * @param {string} dateStr - YYYY-MM-DD.
 * @returns {Object[]} - Filtered collection.
 */
function getEventsForDate(dateStr) {
    return STATE.filteredEvents.filter(e => {
        const s = e.start_date.split(' ')[0];
        const end = e.end_date.split(' ')[0];
        return dateStr >= s && dateStr <= end;
    }).sort((a, b) => a.start_date.localeCompare(b.start_date));
}

/**
 * Filters master collection for a specific hour.
 * 
 * @param {string} dateStr - YYYY-MM-DD.
 * @param {number} hour - 0-23.
 * @returns {Object[]} - Filtered collection.
 */
function getEventsForHour(dateStr, hour) {
    return STATE.filteredEvents.filter(e => {
        const s = e.start_date.split(' ')[0];
        const end = e.end_date.split(' ')[0];
        if (dateStr < s || dateStr > end) return false;
        if (e.all_day && hour === 0) return true;
        if (e.all_day) return false;
        const h = parseInt(e.start_date.split(' ')[1].split(':')[0]);
        return h === hour;
    });
}

/**
 * Updates the primary viewport label.
 * 
 * @returns {void}
 */
function updatePeriodTitle() {
    const el = document.getElementById('currentPeriod');
    if (!el) return;
    if (STATE.currentView === 'month') el.textContent = STATE.currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    else if (STATE.currentView === 'week') {
        const s = getViewStartDate();
        const e = getViewEndDate();
        el.textContent = `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } else {
        el.textContent = STATE.currentDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }
}

/**
 * Synchronizes temporal focus from URL parameters.
 * 
 * @returns {void}
 */
function initializeViewFromUrl() {
    const p = new URLSearchParams(window.location.search);
    if (p.get('view')) STATE.currentView = p.get('view');
    if (p.get('date')) {
        const urlDate = new Date(p.get('date'));
        if (!isNaN(urlDate.getTime())) {
            STATE.currentDate = urlDate;
        }
    }
    updateViewButtons();
}

/**
 * --- Global Exposure ---
 */

window.handleEventSubmit = handleEventSubmit;
window.openAddEventModal = openAddEventModal;
window.openEditModalById = openEditModalById;
window.openEditModalByUid = openEditModalByUid;
window.confirmDeleteEvent = confirmDeleteEvent;
window.showEventDetails = showEventDetails;
window.closeEventModal = closeEventModal;
window.closeDetailsModal = closeDetailsModal;
window.loadEvents = loadEvents;

