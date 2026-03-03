// /public/js/reminders.js

/**
 * Reminders Controller Module
 * 
 * This module manages the Recurring Reminders interface. It implements
 * a high-resolution countdown engine paired with a 100% AJAX-driven 
 * SPA architecture for real-time task awareness.
 * 
 * Features:
 * - Real-time countdowns using the 3D Flip Clock engine
 * - Dynamic 7-day occurrence calculations with last-run awareness
 * - Administrative management of titles, schedules, and recipients
 * - Integrated 60-second state synchronization with server maintenance
 * - Optimistic UI updates for status toggles and day-level adjustments
 * - One-off reminder support with automated self-deletion logic
 * 
 * Dependencies:
 * - default.js: For FlipClockManager, apiPost, getIcon, and modal helpers
 * - toast.js: For status feedback
 */

/**
 * Application State
 * Synchronized collection of reminder configurations and eligible recipients
 */
let appState = {
    reminders: [],                  // Collection of reminder records
    recipients: []                  // List of users available for assignment
};

/**
 * Initialization System
 * Boots the module and establishes high-frequency polling for countdowns
 */
document.addEventListener('DOMContentLoaded', () => {
    // Bootstrap initial state
    loadState();
    
    // UI: High-resolution tick for 3D clocks (1s)
    setInterval(updateCountdowns, 1000);
    
    // Sync: Background refresh to stay aligned with server background maintenance (60s)
    setInterval(loadState, 60000);

    // Interaction: Form delegation
    const addForm = document.getElementById('addReminderForm');
    if (addForm) {
        addForm.addEventListener('submit', (e) => {
            e.preventDefault();
            submitAdd();
        });
    }

    const editForm = document.getElementById('editReminderForm');
    if (editForm) {
        editForm.addEventListener('submit', (e) => {
            e.preventDefault();
            submitEdit();
        });
    }

    // Modal: Configure unified closure behavior
    setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay'], [
        closeAddModal, closeEditModal, closeConfirmModal
    ]);
});

/**
 * --- Core Data Management ---
 */

/**
 * Logic: loadState
 * Fetches master configuration and populates the local state store.
 * Implements interaction-locking to prevent UI jitter during editing.
 * 
 * @returns {Promise<void>}
 */
async function loadState() {
    // Lifecycle: inhibit background sync if user is actively interacting with forms
    const anyModalOpen = document.querySelector('.modal-overlay.show');
    if (anyModalOpen && appState.reminders.length > 0) return;

    const container = document.getElementById('remindersListContainer');
    // Show skeleton only on initial boot
    if (container && appState.reminders.length === 0) {
        container.innerHTML = getLoadingHtml('Syncing reminders...');
    }

    try {
        const response = await fetch('/reminders/api/state');
        const data = await response.json();
        
        // Sync state and trigger UI reconciliation
        appState.reminders = data.reminders;
        appState.recipients = data.recipients;
        renderReminders();
    } catch (err) {
        console.error('loadState error:', err);
        showToast('Connection error. Failed to sync reminders.', 'error');
    }
}

/**
 * --- UI Rendering Engine ---
 */

/**
 * Orchestrates the sorting and generation of reminder cards.
 */
function renderReminders() {
    const container = document.getElementById('remindersListContainer');
    if (!container) return;

    // FlipClock: reset internal diff tracker to ensure fresh card initialization
    FlipClockManager.prevStates = {};

    // Handle empty state
    if (appState.reminders.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>📭 No recurring reminders configured.</p>
                <p class="empty-hint">Click the button above to create your first weekly reminder.</p>
            </div>`;
        return;
    }

    // Sort:
    // 1. Operational status (Paused items at bottom)
    // 2. Next trigger time (Soonest first)
    const sorted = [...appState.reminders].sort((a, b) => {
        if (a.is_active !== b.is_active) return b.is_active - a.is_active;

        const nextA = getNextOccurrence(a.reminder_time, a.days_of_week, a.last_run_at);
        const nextB = getNextOccurrence(b.reminder_time, b.days_of_week, b.last_run_at);

        if (!nextA) return 1;
        if (!nextB) return -1;
        return nextA - nextB;
    });

    container.innerHTML = sorted.map(r => renderReminderCard(r)).join('');
    
    // Initial sync for the new DOM elements
    updateCountdowns();
    
    // Update modal checkbox grids
    renderSelectors();
}

/**
 * UI Component: renderReminderCard
 * Builds the HTML fragment for a single reminder.
 * 
 * @param {Object} r - Reminder record
 * @returns {string} - Rendered HTML
 */
function renderReminderCard(r) {
    const isActive = !!r.is_active;
    const isOneOff = !!r.is_one_off;
    const reminderTime = r.reminder_time.substring(0, 5);
    
    // Localize: convert 24h server time to display format
    const [hRaw, mRaw] = reminderTime.split(':');
    let h = parseInt(hRaw);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    const displayTime = `${h}:${mRaw}`;

    // Logic: build interactive day-of-week toggles
    const activeDays = (r.days_of_week || '').split(',').reduce((acc, d) => { acc[d] = true; return acc; }, {});
    const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const dayDots = dayLabels.map((label, idx) => {
        const dayNum = idx + 1;
        const active = activeDays[dayNum];
        return `<span class="day-dot ${active ? 'active' : ''}" onclick="toggleDay(${r.id}, ${dayNum}, ${active ? 0 : 1})" title="${getDayFullName(dayNum)}">${label}</span>`;
    }).join('');

    // Logic: build recipient icons
    const recipientPills = (r.recipient_names || '').split(',').filter(n => n).map(name => 
        `<span class="recipient-badge">${getIcon('reminders')} ${escapeHtml(name)}</span>`
    ).join('');

    return `
        <div class="glass-panel reminder-card ${isActive ? '' : 'paused'}"
             data-id="${r.id}"
             data-time="${reminderTime}"
             data-days="${r.days_of_week || ''}"
             data-one-off="${isOneOff ? '1' : '0'}"
             data-last-run="${r.last_run_at || ''}">
            <div class="reminder-header">
                <div class="title-stack">
                    ${isOneOff ? `<span class="one-off-badge">${getIcon('clock')} One-off</span>` : ''}
                    <h2 class="reminder-title">${escapeHtml(r.title)}</h2>
                </div>
            </div>

            <div class="reminder-time">
                <div class="reminder-time-main">
                    <span class="clock-icon">${getIcon('clock')}</span>
                    <span class="time-text">${displayTime}</span>
                    <span class="time-ampm">${ampm}</span>
                </div>
                <div class="flip-clock" id="countdown-${r.id}"></div>
            </div>

            <div class="reminder-days">
                ${dayDots}
            </div>

            ${r.description ? `<p class="reminder-desc">${escapeHtml(r.description)}</p>` : `<p class="reminder-desc reminder-desc-empty">No description provided.</p>`}

            <div class="reminder-recipients">
                <span class="label">Recipients</span>
                <div class="recipient-pills">
                    ${recipientPills || '<span class="recipient-badge-empty">No recipients</span>'}
                </div>
            </div>

            <div class="reminder-footer-actions">
                <button class="btn-icon-${isActive ? 'view' : 'copy'} btn-status-toggle"
                        onclick="toggleReminder(${r.id}, ${isActive ? 0 : 1}, this)"
                        title="${isActive ? 'Pause Reminder' : 'Resume Reminder'}">
                    ${getIcon(isActive ? 'running' : 'paused')}
                </button>
                <button class="btn-icon-edit"
                        onclick="prepareEditModal(${r.id})"
                        title="Edit Reminder">${getIcon('edit')}
                </button>
                <button class="btn-icon-delete"
                        onclick="confirmDeleteReminder(${r.id}, \`${r.title.replace(/`/g, '\\`')}\`)"
                        title="Delete Reminder">${getIcon('delete')}
                </button>
            </div>
        </div>
    `;
}

/**
 * Logic: renderSelectors
 * Updates the checkbox grids within the add/edit modals based on latest recipient state.
 */
function renderSelectors() {
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    
    const renderDays = (prefix) => {
        const container = document.getElementById(`${prefix}DaysSelector`);
        if (!container) return;
        container.innerHTML = dayNames.map((name, i) => `
            <label class="day-checkbox">
                <input type="checkbox" name="days[]" value="${i + 1}" id="${prefix}Day${i + 1}">
                <span>${name}</span>
            </label>
        `).join('');
    };

    const renderRecipients = (prefix) => {
        const container = document.getElementById(`${prefix}RecipientsSelector`);
        if (!container) return;
        container.innerHTML = appState.recipients.map(u => `
            <label class="recipient-checkbox">
                <input type="checkbox" name="recipients[]" value="${u.id}" id="${prefix}Recipient${u.id}">
                <span>${escapeHtml(u.username)}</span>
            </label>
        `).join('');
    };

    renderDays('add');
    renderDays('edit');
    renderRecipients('add');
    renderRecipients('edit');
}

/**
 * --- Modal Management ---
 */

/**
 * Interface: openAddModal
 * Resets and displays the reminder creation interface.
 */
function openAddModal() {
    const modal = document.getElementById('addReminderModal');
    const form = document.getElementById('addReminderForm');
    if (form) form.reset();
    if (modal) modal.classList.add('show');
}

/**
 * Interface: closeAddModal
 * Hides the reminder creation interface.
 */
function closeAddModal() {
    const modal = document.getElementById('addReminderModal');
    if (modal) modal.classList.remove('show');
}

/**
 * Interface: prepareEditModal
 * Pre-fills the reminder editor with existing record state.
 * 
 * @param {number} id - Target ID
 */
function prepareEditModal(id) {
    const r = appState.reminders.find(item => item.id == id);
    if (!r) return;

    const modal = document.getElementById('editReminderModal');
    const form = document.getElementById('editReminderForm');
    if (form) form.reset();

    document.getElementById('editReminderId').value = r.id;
    document.getElementById('editReminderTitle').value = r.title;
    document.getElementById('editReminderDescription').value = r.description || '';
    document.getElementById('editReminderTime').value = r.reminder_time.substring(0, 5);
    document.getElementById('editReminderOneOff').checked = (r.is_one_off == 1);

    // Sync multi-level selectors
    if (r.days_of_week) {
        r.days_of_week.split(',').forEach(d => {
            const cb = document.getElementById(`editDay${d}`);
            if (cb) cb.checked = true;
        });
    }

    if (r.recipient_ids) {
        String(r.recipient_ids).split(',').forEach(uid => {
            const cb = document.getElementById(`editRecipient${uid}`);
            if (cb) cb.checked = true;
        });
    }

    if (modal) modal.classList.add('show');
}

/**
 * Interface: closeEditModal
 * Hides the reminder editor.
 */
function closeEditModal() {
    const modal = document.getElementById('editReminderModal');
    if (modal) modal.classList.remove('show');
}

/**
 * --- API Interactions ---
 */

/**
 * Action: submitAdd
 * Transmits a new reminder record to the server.
 * 
 * @returns {Promise<void>}
 */
async function submitAdd() {
    const form = document.getElementById('addReminderForm');
    const btn = form.querySelector('button[type="submit"]');
    const originalHtml = btn.innerHTML;
    
    // UI: indicate network flight
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Creating...`;

    const result = await apiPost('/reminders/add', new FormData(form));
    if (result && result.success) {
        closeAddModal();
        await loadState();
    } else {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Action: submitEdit
 * Transmits modifications to an existing record.
 * 
 * @returns {Promise<void>}
 */
async function submitEdit() {
    const form = document.getElementById('editReminderForm');
    const id = document.getElementById('editReminderId').value;
    const btn = form.querySelector('button[type="submit"]');
    const originalHtml = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Saving...`;

    const result = await apiPost(`/reminders/update/${id}`, new FormData(form));
    if (result && result.success) {
        closeEditModal();
        await loadState();
    } else {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Action: confirmDeleteReminder
 * Triggers confirmation and removes record upon user approval.
 */
function confirmDeleteReminder(id, title) {
    showConfirmModal({
        title: 'Delete Reminder',
        message: `Are you sure you want to delete "<strong>${escapeHtml(title)}</strong>"?`,
        danger: true,
        confirmText: 'Delete',
        onConfirm: async () => {
            const result = await apiPost(`/reminders/delete/${id}`);
            if (result && result.success) {
                await loadState();
            }
        }
    });
}

/**
 * Action: toggleReminder
 * Inverts the active/operational status of a reminder.
 */
async function toggleReminder(id, active) {
    const result = await apiPost(`/reminders/toggle/${id}`, { active: active ? 1 : 0 });
    if (result && result.success) {
        await loadState();
    }
}

/**
 * Action: toggleDay
 * Surgical toggle for a specific day of the week within a reminder's schedule.
 */
async function toggleDay(reminderId, day, active) {
    const result = await apiPost('/reminders/toggle_day', { id: reminderId, day: day, active: active });
    if (result && result.success) {
        await loadState();
    }
}

/**
 * --- Logic: Countdown Engine ---
 */

/**
 * Resolves the absolute date/time of the next scheduled trigger.
 * Implements rollover logic for time-of-day and day-of-week boundaries.
 * 
 * @param {string} timeStr - 24h format HH:MM
 * @param {string} daysStr - Comma-separated ISO day numbers
 * @param {string|null} lastRunAt - Server timestamp of previous execution
 * @returns {Date|null} - Target date object
 */
function getNextOccurrence(timeStr, daysStr, lastRunAt = '') {
    if (!daysStr) return null;
    const [h, m] = timeStr.split(':').map(Number);
    const days = daysStr.split(',').map(Number);

    const now = new Date();
    const isoToday = now.getDay() === 0 ? 7 : now.getDay();
    const nowMins  = now.getHours() * 60 + now.getMinutes();
    const targetMins = h * 60 + m;

    // Guard: check if task already executed during the current calendar day
    let hasRunToday = false;
    if (lastRunAt) {
        const lastRun = new Date(lastRunAt.replace(' ', 'T'));
        if (lastRun.toDateString() === now.toDateString()) {
            hasRunToday = true;
        }
    }

    // Logic: scan next 7 days for the first valid intersection
    for (let offset = 0; offset <= 7; offset++) {
        const checkDay = ((isoToday - 1 + offset) % 7) + 1;
        if (days.includes(checkDay)) {
            // Edge Case: if today, ensure it hasn't run and the time is still in the future
            if (offset === 0) {
                if (hasRunToday || targetMins < nowMins) continue;
            }
            const next = new Date(now);
            next.setDate(now.getDate() + offset);
            next.setHours(h, m, 0, 0);
            return next;
        }
    }
    return null;
}

/**
 * Logic: updateCountdowns
 * Calculates remainders and updates FlipClock DOM nodes.
 * Implements self-destruction logic for expired one-off reminders.
 */
function updateCountdowns() {
    document.querySelectorAll('.reminder-card').forEach(card => {
        const reminderId = card.dataset.id;
        const el = document.getElementById(`countdown-${reminderId}`);
        if (!el) return;

        // Context: clear clock if reminder is manually paused
        if (card.classList.contains('paused')) { 
            el.innerHTML = ''; 
            delete FlipClockManager.prevStates[reminderId];
            return; 
        }

        const next = getNextOccurrence(card.dataset.time, card.dataset.days, card.dataset.lastRun);
        if (!next) { 
            el.innerHTML = ''; 
            delete FlipClockManager.prevStates[reminderId]; 
            return; 
        }

        const diff = next - new Date();
        // Scenario: Trigger Threshold reached
        if (diff <= 0) {
            el.innerHTML = '<div class="flip-card due-badge">DUE NOW</div>';
            delete FlipClockManager.prevStates[reminderId];
            
            // Lifecycle: manage auto-removal for one-off events
            if (card.dataset.oneOff === '1' && !card.classList.contains('row-fade-out')) {
                setTimeout(() => {
                    card.classList.add('row-fade-out');
                    setTimeout(() => {
                        appState.reminders = appState.reminders.filter(r => r.id != reminderId);
                        card.remove();
                    }, 500); // Animation duration margin
                }, 2000); // Grace period for "DUE NOW" visibility
            }
            return;
        }

        const totalSeconds = Math.floor(diff / 1000);
        const d = Math.floor(totalSeconds / 86400);
        const h = Math.floor((totalSeconds % 86400) / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;

        // Trigger FlipClock reconciliation
        FlipClockManager.update(el, { 
            dd: d, 
            hh: String(h).padStart(2, '0'), 
            mm: String(m).padStart(2, '0'), 
            ss: String(s).padStart(2, '0') 
        }, reminderId);
    });
}

/**
 * --- Helpers & Utilities ---
 */

/**
 * Translates ISO day number to human-readable name.
 * 
 * @param {number} day - 1-7
 * @returns {string} - Name
 */
function getDayFullName(day) {
    return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][day - 1];
}

/**
 * Prevents XSS by sanitizing dynamic HTML content.
 * 
 * @param {string} text - Raw input
 * @returns {string} - Sanitized HTML
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
