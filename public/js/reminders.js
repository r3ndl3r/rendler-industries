// /public/js/reminders.js

/**
 * Reminders Controller
 * 
 * Manages the Recurring Reminders interface, implementing a high-resolution 
 * countdown engine paired with a state-driven architecture for real-time 
 * task awareness and administrative schedule management.
 * 
 * Features:
 * - Real-time countdowns using the 3D Flip Clock engine
 * - Dynamic 7-day occurrence calculations with last-run awareness
 * - Administrative management of titles, schedules, and recipients
 * - Integrated 60-second state synchronization with server maintenance
 * - Optimistic UI updates for status toggles and day-level adjustments
 * - One-off reminder support with automated self-deletion logic
 * - Mandatory Action pattern for secure record deletion
 * 
 * Dependencies:
 * - default.js: For FlipClockManager, apiPost, getIcon, and modal helpers
 */

/**
 * --- Module Configuration & State ---
 */
const CONFIG = {
    SYNC_INTERVAL_MS: 60000,         // Background synchronization frequency
    TICK_INTERVAL_MS: 1000          // Countdown engine resolution
};

let STATE = {
    reminders: [],                   // Collection of active reminder records
    recipients: [],                  // List of users available for assignment
    isAdmin: false,                  // Authorization gate for destructive actions
    currentUser: ''                  // Owner identification for session context
};

/**
 * Bootstraps the module state and establishes high-frequency polling.
 * 
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    
    // UI: High-resolution tick for 3D clocks
    setInterval(updateCountdowns, CONFIG.TICK_INTERVAL_MS);
    
    // Sync: Background refresh to stay aligned with server maintenance
    setInterval(loadState, CONFIG.SYNC_INTERVAL_MS);

    // Modal: Configure unified closure behavior
    setupGlobalModalClosing(['modal-overlay'], [
        closeAddModal, closeEditModal
    ]);
});

/**
 * --- Core Data Management ---
 */

/**
 * Synchronizes the module state with the server (Single Source of Truth).
 * 
 * @async
 * @returns {Promise<void>}
 */
async function loadState() {
    // Lifecycle: inhibit background sync if user is actively interacting with forms
    const anyModalOpen = document.querySelector('.modal-overlay[style*="display: block"]');
    if (anyModalOpen && STATE.reminders.length > 0) return;

    try {
        const response = await fetch('/reminders/api/state');
        const data = await response.json();
        
        if (data && data.success) {
            STATE.reminders = data.reminders;
            STATE.recipients = data.recipients;
            STATE.isAdmin = !!data.is_admin;
            STATE.currentUser = data.current_user;
            renderReminders();
        }
    } catch (err) {
        console.error('loadState error:', err);
        const container = document.getElementById('remindersListContainer');
        if (container && STATE.reminders.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>❌ Failed to synchronize with server.</p></div>';
        }
    }
}

/**
 * --- UI Rendering Engine ---
 */

/**
 * Orchestrates the generation of the reminder grid from state.
 * 
 * @returns {void}
 */
function renderReminders() {
    const container = document.getElementById('remindersListContainer');
    if (!container) return;

    // FlipClock: reset internal diff tracker to ensure fresh card initialization
    FlipClockManager.prevStates = {};

    if (STATE.reminders.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>📭 No recurring reminders configured.</p>
                <p class="empty-hint">Click the button above to create your first weekly reminder.</p>
            </div>`;
        return;
    }

    // Sort: 1. Operational status (Active first) 2. Next trigger time (Soonest first)
    const sorted = [...STATE.reminders].sort((a, b) => {
        if (a.is_active !== b.is_active) return b.is_active - a.is_active;
        const nextA = getNextOccurrence(a.reminder_time, a.days_of_week, a.last_run_at);
        const nextB = getNextOccurrence(b.reminder_time, b.days_of_week, b.last_run_at);
        if (!nextA) return 1;
        if (!nextB) return -1;
        return nextA - nextB;
    });

    container.innerHTML = sorted.map(r => renderReminderCard(r)).join('');
    
    updateCountdowns();
    renderSelectors();
}

/**
 * Generates the HTML fragment for a single reminder card.
 * 
 * @param {Object} r - Reminder record metadata.
 * @returns {string} - Rendered HTML template.
 */
function renderReminderCard(r) {
    const isActive = !!r.is_active;
    const isOneOff = !!r.is_one_off;
    const reminderTime = (r.reminder_time || '00:00').substring(0, 5);
    
    // Localize: convert 24h server time to display format
    const [hRaw, mRaw] = reminderTime.split(':');
    let h = parseInt(hRaw || 0);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    const displayTime = `${h}:${mRaw || '00'}`;

    // Interactive day-of-week toggles
    const activeDays = (r.days_of_week || '').split(',').reduce((acc, d) => { if(d) acc[d] = true; return acc; }, {});
    const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const dayDots = dayLabels.map((label, idx) => {
        const dayNum = idx + 1;
        const active = activeDays[dayNum];
        return `<span class="day-dot ${active ? 'active' : ''}" onclick="toggleDay(${r.id}, ${dayNum}, ${active ? 0 : 1})" title="${getDayFullName(dayNum)}">${label}</span>`;
    }).join('');

    // Recipient branding
    const recipientPills = (r.recipient_names || '').split(',').filter(n => n).map(name => 
        `<span class="recipient-badge">${getIcon('reminders')} ${escapeHtml(name)}</span>`
    ).join('');

    return `
        <div class="reminder-card ${isActive ? '' : 'paused'}"
             data-id="${r.id}"
             data-time="${reminderTime}"
             data-days="${r.days_of_week || ''}"
             data-one-off="${isOneOff ? '1' : '0'}"
             data-last-run="${r.last_run_at || ''}">
            <div class="reminder-header">
                <div class="title-stack">
                    ${isOneOff ? `<span class="one-off-badge">${getIcon('clock')} One-off</span>` : ''}
                    <h2 class="reminder-title">${escapeHtml(r.title || 'Untitled')}</h2>
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
                <button class="btn-icon-${isActive ? 'view' : 'copy'}"
                        onclick="toggleReminder(${r.id}, ${isActive ? 0 : 1})"
                        title="${isActive ? 'Pause Reminder' : 'Resume Reminder'}">
                    ${getIcon(isActive ? 'running' : 'paused')}
                </button>
                <button class="btn-icon-edit"
                        onclick="openEditModal(${r.id})"
                        title="Edit Reminder">${getIcon('edit')}
                </button>
                <button class="btn-icon-delete"
                        onclick="confirmDeleteReminder(${r.id}, \`${(r.title || 'Untitled').replace(/`/g, '\\`')}\`)"
                        title="Delete Reminder">${getIcon('delete')}
                </button>
            </div>
        </div>
    `;
}

/**
 * Updates the checkbox selection grids in creation/edit interfaces.
 * 
 * @returns {void}
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
        container.innerHTML = STATE.recipients.map(u => `
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
 * Displays the reminder creation interface.
 * 
 * @returns {void}
 */
function openAddModal() {
    const modal = document.getElementById('addReminderModal');
    const form = document.getElementById('addReminderForm');
    if (form) form.reset();
    if (modal) modal.style.display = 'block';
}

/**
 * Hides the reminder creation interface.
 * 
 * @returns {void}
 */
function closeAddModal() {
    const modal = document.getElementById('addReminderModal');
    if (modal) modal.style.display = 'none';
}

/**
 * Pre-fills and displays the reminder editor.
 * 
 * @param {number} id - Target identifier.
 * @returns {void}
 */
function openEditModal(id) {
    const r = STATE.reminders.find(item => item.id == id);
    if (!r) return;

    const modal = document.getElementById('editReminderModal');
    const form = document.getElementById('editReminderForm');
    if (form) form.reset();

    document.getElementById('editReminderId').value = r.id;
    document.getElementById('editReminderTitle').value = r.title;
    document.getElementById('editReminderDescription').value = r.description || '';
    document.getElementById('editReminderTime').value = r.reminder_time.substring(0, 5);
    document.getElementById('editReminderOneOff').checked = (r.is_one_off == 1);

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

    if (modal) modal.style.display = 'block';
}

/**
 * Hides the reminder editor.
 * 
 * @returns {void}
 */
function closeEditModal() {
    const modal = document.getElementById('editReminderModal');
    if (modal) modal.style.display = 'none';
}

/**
 * --- API Interactions ---
 */

/**
 * Orchestrates the reminder creation workflow.
 * 
 * @async
 * @param {Event} e - Form submission event.
 * @returns {Promise<void>}
 */
async function handleAdd(e) {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button[type="submit"]');
    const originalHtml = btn.innerHTML;
    
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Creating...`;

    try {
        const result = await apiPost('/reminders/add', new FormData(form));
        if (result && result.success) {
            closeAddModal();
            await loadState();
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Orchestrates the reminder modification workflow.
 * 
 * @async
 * @param {Event} e - Form submission event.
 * @returns {Promise<void>}
 */
async function handleEdit(e) {
    e.preventDefault();
    const form = e.target;
    const id = document.getElementById('editReminderId').value;
    const btn = form.querySelector('button[type="submit"]');
    const originalHtml = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Saving...`;

    try {
        const result = await apiPost(`/reminders/update/${id}`, new FormData(form));
        if (result && result.success) {
            closeEditModal();
            await loadState();
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Orchestrates the Mandatory Action deletion flow.
 * 
 * @param {number} id - Target identifier.
 * @param {string} title - Merchant context.
 * @returns {void}
 */
function confirmDeleteReminder(id, title) {
    showConfirmModal({
        title: 'Delete Reminder',
        message: `Permanently remove schedule for \"<strong>${title}</strong>\"?`,
        danger: true,
        confirmText: 'Delete',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const result = await apiPost(`/reminders/delete/${id}`);
            if (result && result.success) {
                STATE.reminders = STATE.reminders.filter(r => r.id != id);
                renderReminders();
            }
        }
    });
}

/**
 * Toggles the operational status of a reminder.
 * 
 * @async
 * @param {number} id - Target identifier.
 * @param {number} active - Target status (1/0).
 * @returns {Promise<void>}
 */
async function toggleReminder(id, active) {
    const result = await apiPost(`/reminders/toggle/${id}`, { active: active ? 1 : 0 });
    if (result && result.success) {
        const r = STATE.reminders.find(item => item.id == id);
        if (r) {
            r.is_active = active ? 1 : 0;
            
            // UI: If pausing, apply fade-out animation before re-sorting
            if (!active) {
                const card = document.querySelector(`.reminder-card[data-id="${id}"]`);
                if (card) {
                    card.classList.add('row-fade-out');
                    setTimeout(() => renderReminders(), 800); // Match CSS transition
                    return;
                }
            }
            
            renderReminders();
        }
    }
}

/**
 * Surgical toggle for a specific scheduled day.
 * 
 * @async
 * @param {number} reminderId - Parent identifier.
 * @param {number} day - ISO day number (1-7).
 * @param {number} active - Target status (1/0).
 * @returns {Promise<void>}
 */
async function toggleDay(reminderId, day, active) {
    const result = await apiPost('/reminders/toggle_day', { id: reminderId, day: day, active: active });
    if (result && result.success) {
        const r = STATE.reminders.find(item => item.id == reminderId);
        if (r) {
            let days = (r.days_of_week || '').split(',').filter(d => d).map(Number);
            if (active) {
                if (!days.includes(day)) days.push(day);
            } else {
                days = days.filter(d => d !== day);
            }
            r.days_of_week = days.sort((a, b) => a - b).join(',');
            renderReminders(); // Re-render locally
        }
    }
}

/**
 * --- Logic: Countdown Engine ---
 */

/**
 * Resolves the absolute date/time of the next scheduled trigger.
 * 
 * @param {string} timeStr - 24h format HH:MM.
 * @param {string} daysStr - Comma-separated ISO day numbers.
 * @param {string|null} lastRunAt - Server timestamp of previous execution.
 * @returns {Date|null} - Target date object.
 */
function getNextOccurrence(timeStr, daysStr, lastRunAt = '') {
    if (!daysStr || !timeStr) return null;
    const [h, m] = timeStr.split(':').map(Number);
    const days = daysStr.split(',').map(Number);

    const now = new Date();
    const isoToday = now.getDay() === 0 ? 7 : now.getDay();
    const nowMins  = now.getHours() * 60 + now.getMinutes();
    const targetMins = h * 60 + m;

    let hasRunToday = false;
    if (lastRunAt) {
        const lastRun = new Date(lastRunAt.replace(' ', 'T'));
        if (lastRun.toDateString() === now.toDateString()) hasRunToday = true;
    }

    for (let offset = 0; offset <= 7; offset++) {
        const checkDay = ((isoToday - 1 + offset) % 7) + 1;
        if (days.includes(checkDay)) {
            if (offset === 0 && (hasRunToday || targetMins < nowMins)) continue;
            const next = new Date(now);
            next.setDate(now.getDate() + offset);
            next.setHours(h, m, 0, 0);
            return next;
        }
    }
    return null;
}

/**
 * Synchronizes FlipClock DOM nodes with calculated remainders.
 * 
 * @returns {void}
 */
function updateCountdowns() {
    document.querySelectorAll('.reminder-card').forEach(card => {
        const reminderId = card.dataset.id;
        const el = document.getElementById(`countdown-${reminderId}`);
        if (!el) return;

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
        if (diff <= 0) {
            el.innerHTML = '<div class="flip-card due-badge">DUE NOW</div>';
            delete FlipClockManager.prevStates[reminderId];
            
            if (card.dataset.oneOff === '1' && !card.classList.contains('row-fade-out')) {
                setTimeout(() => {
                    card.classList.add('row-fade-out');
                    setTimeout(() => {
                        STATE.reminders = STATE.reminders.filter(r => r.id != reminderId);
                        card.remove();
                    }, 800);
                }, 2000);
            }
            return;
        }

        const totalSeconds = Math.floor(diff / 1000);
        const d = Math.floor(totalSeconds / 86400);
        const h = Math.floor((totalSeconds % 86400) / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;

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
 * @param {number} day - ISO day index (1-7).
 * @returns {string} - Full name.
 */
function getDayFullName(day) {
    return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][day - 1];
}

/**
 * Prevents XSS by sanitizing dynamic content.
 * 
 * @param {string} text - Raw input.
 * @returns {string} - Sanitized HTML.
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * --- Global Exposure ---
 */
window.openAddModal = openAddModal;
window.closeAddModal = closeAddModal;
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
window.confirmDeleteReminder = confirmDeleteReminder;
window.toggleReminder = toggleReminder;
window.toggleDay = toggleDay;
window.handleAdd = handleAdd;
window.handleEdit = handleEdit;
window.loadState = loadState;
