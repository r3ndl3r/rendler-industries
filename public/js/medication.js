// /public/js/medication.js

/**
 * Medication Tracker Controller
 * 
 * Manages the Family Medication interface using a state-driven architecture. 
 * It provides real-time dosage tracking, interval calculations, and 
 * administrative registry maintenance through a synchronized interface.
 * 
 * Features:
 * - State-driven rendering for logs, registry, and family members
 * - Real-time dosing intervals (auto-refreshing every 60s)
 * - Intelligent form pre-filling from medication registry
 * - Integrated dosage reset workflow with reminder scheduling
 * - Administrative management of the global medication catalog
 * - Local state reconciliation for zero-latency user feedback
 * 
 * Dependencies:
 * - default.js: For apiPost, getLocalISOString, setupGlobalModalClosing, and modal helpers
 * - toast.js: For status notifications
 */

/**
 * --- Module Configuration & State ---
 */
const CONFIG = {
    SYNC_INTERVAL_MS: 300000,        // Background synchronization (5 min)
    UI_TICK_MS: 60000,              // Relative time update frequency (1 min)
    PENDING_POLL_MS: 30000          // Pending confirmation poll (30 sec)
};

let STATE = {
    logs: {},                       // Map of member names to dosage arrays
    registry: [],                   // Global list of available medications
    members: [],                    // List of family members for dropdowns
    isAdmin: false,                 // Authorization gate for administrative actions
    isParent: false,                // Parent-only views
    reminders: [],                  // Medication reminder schedule list
    pendingEvents: [],              // Today's unconfirmed events for current user
    editingReminder: null,          // Holds data when editing an existing reminder set
    reminderSourceLogId: null,      // Source medication log row reminders should update on confirm
    reminderSaving: false           // Prevents double-submits from creating duplicate saves
};

let loadStateRequestSeq = 0;
let loadPendingRequestSeq = 0;

/**
 * Bootstraps the module state and establishes background lifecycles.
 * 
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', () => {
    // Initial fetch of the master dataset
    loadState();
    
    // Background relative time updates
    setInterval(updateAllIntervals, CONFIG.UI_TICK_MS);
    
    // Background data synchronization
    setInterval(loadState, CONFIG.SYNC_INTERVAL_MS);
    
    // Poll pending confirmations more frequently
    setInterval(loadPending, CONFIG.PENDING_POLL_MS);

    // Configure unified modal closure behavior
    setupGlobalModalClosing(['modal-overlay'], [
        closeDoseModal, closeEditModal, closeRegistryModal, closeManageModal, closeConfirmModal,
        closeReminderScheduler
    ]);
});

/**
 * --- Core Data Management ---
 */

/**
 * Synchronizes the module state with the server (Single Source of Truth).
 * 
 * @async
 * @param {boolean} force - Whether to bypass interaction-aware inhibition.
 * @returns {Promise<void>}
 */
async function loadState(force = false) {
    // Skip background refresh if a modal is active or the user is typing
    const anyModalOpen = document.querySelector('.modal-overlay.show, .modal-overlay.active, .delete-modal-overlay.show, .delete-modal-overlay.active, #reminderSchedulerModal.show');
    const inputFocused = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');

    if (!force && (anyModalOpen || inputFocused)) return;

    try {
        const requestSeq = ++loadStateRequestSeq;
        const data = await apiGet('/medication/api/state');
        if (requestSeq !== loadStateRequestSeq) return;

        if (data && data.success) {
            STATE.logs = data.logs;
            STATE.registry = data.registry;
            STATE.members = data.members;
            STATE.isAdmin = !!data.is_admin;
            STATE.isParent = !!data.is_parent;
            STATE.reminders = data.reminders || [];
            STATE.pendingEvents = data.pending_events || [];
            renderUI();
        }
    } catch (err) {
        console.error('loadState failed:', err);
    }
}

/**
 * Lightweight poll for pending confirmations only (does not re-render full UI).
 * @async
 * @returns {Promise<void>}
 */
async function loadPending() {
    const schedulerOpen = document.getElementById('reminderSchedulerModal')?.classList.contains('show');
    if (schedulerOpen) return;

    try {
        const requestSeq = ++loadPendingRequestSeq;
        const data = await apiGet('/medication/api/reminders');
        if (requestSeq !== loadPendingRequestSeq) return;
        if (data && data.success) {
            STATE.reminders = data.reminders || [];
            STATE.pendingEvents = data.pending_events || [];
            renderPendingList();
            renderReminderList();
        }
    } catch (err) {
        // Silently ignore background poll errors
    }
}
/**
 * Universal handler for log-related form submissions.
 * Performs date/time consolidation before transmission.
 * 
 * @async
 * @param {Event} event - Triggering form event.
 * @param {string} url - Target API endpoint.
 * @returns {Promise<void>}
 */
async function handleLogSubmit(event, url) {
    if (event) event.preventDefault();
    const form = event.target;
    const btnId = form.id === 'doseForm' ? 'addSaveBtn' : 'editSaveBtn';
    const btn = document.getElementById(btnId) || form.querySelector('button[type="submit"]');
    const formData = new FormData(form);

    // Contextual merging: consolidate split inputs for DB compatibility
    const mode = form.id === 'doseForm' ? 'add' : 'edit';
    const timeEl = document.getElementById(`${mode}_taken_at_time`);
    const dateEl = document.getElementById(`${mode}_taken_at_date`);
    if (timeEl && dateEl) {
        formData.set('taken_at', `${dateEl.value} ${timeEl.value}`);
    }

    const originalHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `⌛ Saving...`;
    }

    try {
        const result = await apiPost(url, Object.fromEntries(formData));
        if (result && result.success) {
            closeDoseModal();
            closeEditModal();
            await loadState(true);
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }
}

/**
 * Handler for administrative registry modifications.
 * 
 * @async
 * @param {Event} event - Triggering form event.
 * @param {string} url - Target API endpoint.
 * @returns {Promise<void>}
 */
async function handleRegistrySubmit(event, url) {
    if (event) event.preventDefault();
    const form = event.target;
    const btn = document.getElementById('manageSaveBtn');
    const formData = new FormData(form);

    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `⌛ Saving...`;

    try {
        const result = await apiPost(url, Object.fromEntries(formData));
        if (result && result.success) {
            closeManageModal();
            await loadState(true);
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * --- UI Rendering Engine ---
 */

/**
 * Orchestrates the full UI synchronization lifecycle.
 * 
 * @returns {void}
 */
function renderUI() {
    renderGrid();
    renderParentTally();
    renderDropdowns();
    renderRegistryTable();
    renderActionButtons();
    renderReminderList();
    renderPendingList();
    updateAllIntervals();
}

/**
 * Exposed for use by inline onclick handlers in modals.
 */
window.renderUI = renderUI;
window.loadState = loadState;
window.loadPending = loadPending;

/**
 * Generates the family-categorized medication dose grid.
 * 
 * @returns {void}
 */
function renderGrid() {
    const grid = document.getElementById('medication-grid');
    if (!grid) return;

    const members = Object.keys(STATE.logs).sort();
    const activeMembers = members.filter(m => STATE.logs[m].length > 0);

    if (activeMembers.length === 0) {
        grid.innerHTML = `<div class="empty-state"><p>📭 No active medication logs found.</p></div>`;
        return;
    }

    grid.innerHTML = activeMembers.map(member => {
        const logs = STATE.logs[member];
        return `
            <div class="medication-card glass-panel">
                <div class="user-header">
                    <h2 class="user-name">
                        <span class="user-icon">${window.getUserIcon(member)}</span>
                        <span class="user-label">${member}</span>
                    </h2>
                </div>
                <div class="user-med-list">
                    ${logs.map(l => renderLogItem(l)).join('')}
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Renders a parent-only running tally of the last 10 medications taken by the family.
 *
 * @returns {void}
 */
function renderParentTally() {
    const section = document.getElementById('parent-tally-section');
    const body = document.getElementById('parent-tally-body');
    if (!section || !body) return;

    if (!STATE.isParent) {
        section.hidden = true;
        body.innerHTML = '';
        return;
    }

    const allLogs = Object.values(STATE.logs || {})
        .flat()
        .sort((a, b) => (b.taken_at_unix || 0) - (a.taken_at_unix || 0))
        .slice(0, 10);

    section.hidden = false;

    if (!allLogs.length) {
        body.innerHTML = `<tr><td colspan="4">No medication logs found.</td></tr>`;
        return;
    }

    body.innerHTML = allLogs.map(log => `
        <tr>
            <td>${escapeHtml(formatTakenAtLabel(log.taken_at || ''))}</td>
            <td>${escapeHtml(log.family_member || '')}</td>
            <td>${escapeHtml(log.medication_name || '')}</td>
            <td>${escapeHtml(String(log.dosage || ''))} mg</td>
        </tr>
    `).join('');
}

/**
 * Generates the HTML fragment for a single medication dose.
 * 
 * @param {Object} l - Log record metadata.
 * @returns {string} - Rendered HTML.
 */
function renderLogItem(l) {
    const takenAt = l.taken_at || '';
    const reminders = getRemindersForLog(l);
    const displayDt = formatTakenAtLabel(takenAt);
    const deleteLabel = escapeHtml(JSON.stringify(`${l.medication_name || ''} for ${l.family_member || ''}`));

    return `
        <div class="med-item" data-id="${l.id}" onclick="toggleMedExpand(this)">
            <div class="med-item-main">
                <div class="med-item-info">
                    <span class="med-name">${reminders.length > 0 ? `<span class="med-reminder-indicator" title="${reminders.length} reminder${reminders.length === 1 ? '' : 's'} set">⏰</span>` : ''}${escapeHtml(l.medication_name)}</span>
                    <span class="med-dosage-pill">${l.dosage} mg</span>
                </div>
                <div class="med-item-right">
                    <div class="med-item-timer">
                        <span class="interval-update" data-unix="${l.taken_at_unix}">...</span>
                    </div>
                    <span class="expand-icon">🔽</span>
                </div>
            </div>
            <div class="med-item-details">
                ${renderLogReminderSummary(l)}
                <div class="med-item-footer">
                    <span class="taken-at-label">🕒 Last taken: ${displayDt}</span>
                    <div class="med-item-actions" onclick="event.stopPropagation()">
                        <button type="button" class="btn-icon-reset" onclick="confirmResetMedication(${l.id})" title="Reset Time">🔄</button>
                        <button type="button" class="btn-icon-reset btn-icon-reminder" onclick="openReminderSchedulerFromLog(${l.id})" title="Schedule Dose Reminder">⏰</button>
                        <button type="button" class="btn-icon-edit" onclick="openEditModalById(${l.id})" title="Edit Log">✏️</button>
                        <button type="button" class="btn-icon-delete" onclick="confirmDeleteMedication(${l.id}, ${deleteLabel})" title="Delete Log">🗑️</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Renders reminder controls associated with an existing medication log.
 *
 * @param {Object} l - Log record metadata.
 * @returns {string} Reminder summary HTML.
 */
function renderLogReminderSummary(l) {
    const reminders = getRemindersForLog(l);
    if (reminders.length === 0) {
        return `
            <div class="med-log-reminders" onclick="event.stopPropagation()">
                <div class="med-log-reminder-empty">
                    <span>No recurring reminders set.</span>
                </div>
            </div>
        `;
    }

    return `
        <div class="med-log-reminders" onclick="event.stopPropagation()">
            <div class="med-log-reminder-title">⏰ Current reminders</div>
            ${reminders.map(r => renderLogReminderItem(r)).join('')}
        </div>
    `;
}

/**
 * Finds reminders for the same medication/member as a medication log.
 *
 * @param {Object} l - Log record metadata.
 * @returns {Object[]} Matching reminder rows.
 */
function getRemindersForLog(l) {
    return (STATE.reminders || [])
        .filter(r => r.family_member_id == l.family_member_id && r.medication_name === l.medication_name)
        .sort((a, b) => (a.reminder_time || '').localeCompare(b.reminder_time || ''));
}

/**
 * Renders one compact reminder row inside an expanded medication log.
 *
 * @param {Object} r - Reminder schedule record.
 * @returns {string} Reminder row HTML.
 */
function renderLogReminderItem(r) {
    const timeDisplay = formatTimeAmPm(r.reminder_time);
    const active = r.is_active ? 1 : 0;
    const days = formatReminderDays(r.days_of_week);

    return `
        <div class="med-log-reminder-item ${active ? '' : 'reminder-inactive'}">
            <div class="med-log-reminder-info">
                <span class="reminder-time-label">⏰ ${timeDisplay}</span>
                <span class="reminder-days-label">${days}</span>
            </div>
            <div class="reminder-item-actions">
                <label class="reminder-toggle-switch">
                    <input type="checkbox" ${active ? 'checked' : ''} onchange="toggleReminderActive(${r.id}, this.checked, this)">
                    <span class="toggle-slider"></span>
                </label>
                <button type="button" class="btn-icon-delete" onclick="deleteReminderSchedule(${r.id})" title="Delete Reminder">🗑️</button>
            </div>
        </div>
    `;
}

/**
 * Populates all medication and family member dropdowns from state.
 * 
 * @returns {void}
 */
function renderDropdowns() {
    // 1. Medication Registry Options
    const regOptions = STATE.registry.map(m => 
        `<option value="${escapeHtml(m.name)}" data-dosage="${m.default_dosage}">${escapeHtml(m.name)}</option>`
    ).join('');
    
    const regPlaceholder = '<option value="" selected>-- Select existing --</option>';
    document.querySelectorAll('.registry-dropdown').forEach(el => {
        el.innerHTML = regPlaceholder + regOptions;
    });

    // 2. Family Member Options
    const memberOptions = STATE.members.map(m => 
        `<option value="${m.id}">${window.getUserIcon(m.username)} ${escapeHtml(m.username)}</option>`
    ).join('');

    const memPlaceholder = '<option value="" disabled selected>Select family member</option>';
    document.querySelectorAll('.member-dropdown').forEach(el => {
        el.innerHTML = memPlaceholder + memberOptions;
    });
}

/**
 * Manages the visibility of administrative action controls.
 * 
 * @returns {void}
 */
function renderActionButtons() {
    const adminPanel = document.getElementById('admin-actions');
    const memberPanel = document.getElementById('member-actions');
    
    if (adminPanel) adminPanel.classList.toggle('hidden', !STATE.isAdmin);
    if (memberPanel) memberPanel.classList.toggle('hidden', STATE.isAdmin);
}

/**
 * Generates the administrative registry management table.
 * 
 * @returns {void}
 */
function renderRegistryTable() {
    const body = document.getElementById('registry-table-body');
    if (!body) return;

    body.innerHTML = STATE.registry.map(m => {
        const safeNameArg = escapeHtml(JSON.stringify(m.name || ''));
        const safeDosageArg = escapeHtml(JSON.stringify(m.default_dosage || ''));
        return `
        <tr>
            <td><strong>${escapeHtml(m.name)}</strong></td>
            <td>${m.default_dosage} mg</td>
            <td>${m.usage_count}</td>
            <td class="col-actions">
                <div class="action-buttons">
                    <button type="button" class="btn-icon-edit" onclick="openManageModal(${m.id}, ${safeNameArg}, ${safeDosageArg})" title="Edit Registry">✏️</button>
                    <button type="button" class="btn-icon-delete" onclick="confirmDeleteRegistry(${m.id}, ${safeNameArg})" 
                            ${m.usage_count > 0 ? 'disabled' : ''} title="Remove Registry Item">🗑️</button>
                </div>
            </td>
        </tr>
    `;
    }).join('');
}

/**
 * --- Reminder List Rendering ---
 */

/**
 * Renders the reminder schedule list grouped by family member.
 * @returns {void}
 */
function renderReminderList() {
    const container = document.getElementById('reminder-list');
    if (!container) return;

    const reminders = STATE.reminders || [];
    if (reminders.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>⏰ No medication reminders configured.</p></div>`;
        return;
    }

    // Group by family member
    const grouped = {};
    reminders.forEach(r => {
        const key = r.family_member_name || 'Unknown';
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(r);
    });

    container.innerHTML = Object.keys(grouped).sort().map(member => `
        <div class="reminder-member-group">
            <div class="reminder-member-header">
                <span class="user-icon">${window.getUserIcon(member)}</span>
                <span class="reminder-member-name">${escapeHtml(member)}</span>
            </div>
            <div class="reminder-member-items">
                ${grouped[member].map(r => renderReminderItem(r)).join('')}
            </div>
        </div>
    `).join('');
}

/**
 * Renders a single reminder schedule item.
 * @param {Object} r - Reminder schedule record.
 * @returns {string} HTML
 */
const DAY_LABELS = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' };

function renderReminderItem(r) {
    const timeDisplay = formatTimeAmPm(r.reminder_time);
    const active = r.is_active ? 1 : 0;
    const days = formatReminderDays(r.days_of_week);
    return `
        <div class="reminder-item ${r.is_active ? '' : 'reminder-inactive'}">
            <div class="reminder-item-info">
                <span class="med-name">${escapeHtml(r.medication_name)}</span>
                <span class="med-dosage-pill">${r.dosage} mg</span>
                <span class="reminder-time-label">⏰ ${timeDisplay}</span>
                <span class="reminder-days-label">${days}</span>
            </div>
            <div class="reminder-item-actions">
                <button type="button" class="btn-icon-edit" onclick="openReminderSchedulerForEdit(${r.id})" title="Edit Reminder">✏️</button>
                <label class="reminder-toggle-switch">
                    <input type="checkbox" ${active ? 'checked' : ''} onchange="toggleReminderActive(${r.id}, this.checked, this)">
                    <span class="toggle-slider"></span>
                </label>
                <button type="button" class="btn-icon-delete" onclick="deleteReminderSchedule(${r.id})" title="Delete Reminder">🗑️</button>
            </div>
        </div>
    `;
}

/**
 * Formats a comma-separated day string as abbreviated labels.
 *
 * @param {string} daysOfWeek - Comma-separated day numbers.
 * @returns {string} Day labels.
 */
function formatReminderDays(daysOfWeek) {
    return (daysOfWeek || '').split(',').filter(Boolean).map(d => DAY_LABELS[d]).filter(Boolean).join(' ');
}

/**
 * Formats a DB time string as a 12-hour display label.
 *
 * @param {string} value - Time string such as HH:MM or HH:MM:SS.
 * @returns {string} Display time like 7:00 AM.
 */
function formatTimeAmPm(value) {
    if (!value) return '--:--';
    const match = String(value).match(/^(\d{1,2}):(\d{2})/);
    if (!match) return value;

    let hour = parseInt(match[1], 10);
    const minute = match[2];
    if (hour === 24) {
        hour = 0;
    }
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minute} ${suffix}`;
}

/**
 * Formats a medication taken_at timestamp for the expanded log footer.
 *
 * @param {string} value - Timestamp string such as YYYY-MM-DD HH:MM:SS.
 * @returns {string} Display label like 7:00 AM 06/06/2026.
 */
function formatTakenAtLabel(value) {
    if (!value) return 'No timestamp';
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})\s+(.+)$/);
    if (!match) return value;

    const [, year, month, day, timeValue] = match;
    return `${formatTimeAmPm(timeValue)} ${day}/${month}/${year}`;
}

/**
 * Renders today's pending confirmation items.
 * @returns {void}
 */
function renderPendingList() {
    const container = document.getElementById('pending-list');
    const section = document.getElementById('pending-section');
    if (!container) return;

    const events = STATE.pendingEvents || [];
    if (events.length === 0) {
        if (section) section.hidden = true;
        container.innerHTML = '';
        return;
    }

    if (section) section.hidden = false;

    // Sort by scheduled time ascending
    const sorted = [...events].sort((a, b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || ''));

    container.innerHTML = sorted.map(e => {
        const timeDisplay = formatTimeAmPm(e.scheduled_time);
        const lastFiredUnix = parseInt(e.last_fired_at_unix, 10);
        let overdueClass = '';
        let overdueLabel = '';
        if (lastFiredUnix) {
            const minsSince = Math.floor((Date.now() / 1000 - lastFiredUnix) / 60);
            if (minsSince >= 30) {
                overdueClass = 'pending-overdue';
                overdueLabel = `<span class="overdue-badge">⚠️ ${minsSince} min overdue</span>`;
            }
        }
        return `
            <div class="pending-item ${overdueClass}">
                <div class="pending-item-info">
                    <span class="med-name">${escapeHtml(e.medication_name)}</span>
                    <span class="med-dosage-pill">${e.dosage} mg</span>
                    <span class="reminder-time-label">⏰ ${timeDisplay}</span>
                    ${overdueLabel}
                </div>
                <button type="button" class="btn-primary pending-confirm-btn" onclick="confirmReminderEvent(${e.event_id}, this)">✅ Confirm</button>
            </div>
        `;
    }).join('');
}

/**
 * --- Reminder Schedule Management ---
 */

/**
 * Opens the reminder scheduler modal. If data is provided, pre-fills the form for editing.
 * @param {Object|null} data - Existing reminder schedule to edit (optional)
 * @returns {void}
 */
function openReminderScheduler(data) {
    const modal = document.getElementById('reminderSchedulerModal');
    if (!modal) return;

    // Populate medication dropdown from registry
    const medSelect = document.getElementById('reminder_medication_id');
    if (medSelect) {
        medSelect.innerHTML = '<option value="" disabled selected>Select medication</option>' +
            (STATE.registry || []).map(m =>
                `<option value="${m.id}" data-dosage="${m.default_dosage}">${escapeHtml(m.name)}</option>`
            ).join('');
    }

    // Populate member dropdown (reuse existing renderDropdowns which targets .member-dropdown)
    renderDropdowns();

    // Reset form defaults
    setReminderCount(1);
    document.getElementById('reminder_dosage').value = '';
    STATE.editingReminder = data ? data.id : null;
    STATE.reminderSourceLogId = data ? (data.source_log_id || null) : null;

    // Pre-fill if editing
    if (data) {
        if (medSelect) medSelect.value = data.medication_id;
        const memberSelect = document.getElementById('reminder_member_id');
        if (memberSelect) memberSelect.value = data.family_member_id;
        document.getElementById('reminder_dosage').value = data.dosage;

        // Pre-fill all times for this medication/member combo.
        const sameCombo = getReminderCombo(data);
        const timeCount = Math.min(sameCombo.length, 4);
        if (timeCount >= 1 && timeCount <= 4) {
            setReminderCount(timeCount);
            const timeInputs = document.querySelectorAll('#reminder_times_container .reminder-time-input');
            sameCombo.forEach((r, i) => {
                if (timeInputs[i]) timeInputs[i].value = r.reminder_time ? r.reminder_time.substring(0, 5) : '';
            });
        }

        // Pre-fill days of week
        const dayNums = (data.days_of_week || '').split(',').filter(Boolean);
        document.querySelectorAll('#reminderDaysSelector input[type="checkbox"]').forEach(cb => {
            cb.checked = dayNums.includes(cb.value);
        });
    } else {
        // New: all days checked by default
        document.querySelectorAll('#reminderDaysSelector input[type="checkbox"]').forEach(cb => cb.checked = true);
    }

    modal.classList.add('show');
    document.body.classList.add('modal-open');
}

/**
 * Opens the reminder scheduler modal pre-filled with an existing reminder's data.
 * @param {number} id - Reminder schedule ID
 * @returns {void}
 */
async function openReminderSchedulerForEdit(id) {
    await refreshReminderState();
    const data = STATE.reminders.find(r => r.id == id);
    if (data) openReminderScheduler(data);
}

/**
 * Refreshes reminder state before opening scheduler edit flows.
 * @returns {Promise<void>}
 */
async function refreshReminderState() {
    const data = await apiGet(`/medication/api/reminders?_=${Date.now()}`);
    if (data && data.success) {
        STATE.reminders = data.reminders || [];
        STATE.pendingEvents = data.pending_events || [];
        renderReminderList();
    }
}

/**
 * Gets unique reminder rows for the same medication/member combo.
 * @param {Object} data - Reminder schedule record
 * @returns {Object[]} Unique reminder rows sorted by time
 */
function getReminderCombo(data) {
    const seen = new Set();
    return (STATE.reminders || [])
        .filter(r => r.medication_id == data.medication_id && r.family_member_id == data.family_member_id)
        .sort((a, b) => (a.reminder_time || '').localeCompare(b.reminder_time || ''))
        .filter(r => {
            const key = (r.reminder_time || '').substring(0, 5);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

/**
 * Opens the reminder scheduler pre-filled from an existing dose log.
 * @param {number} id - Medication log ID
 * @returns {void}
 */
async function openReminderSchedulerFromLog(id) {
    let targetLog = null;
    for (const member in STATE.logs) {
        const found = STATE.logs[member].find(l => l.id == id);
        if (found) { targetLog = found; break; }
    }
    if (!targetLog) return;

    await refreshReminderState();

    const existingReminders = getRemindersForLog(targetLog);
    if (existingReminders.length > 0) {
        openReminderScheduler(existingReminders[0]);
        return;
    }

    const registryItem = STATE.registry.find(m => m.name === targetLog.medication_name);
    if (!registryItem) {
        alert('This medication is not in the registry, so a recurring reminder cannot be created yet.');
        return;
    }

    openReminderScheduler();
    STATE.reminderSourceLogId = targetLog.id;

    const medSelect = document.getElementById('reminder_medication_id');
    const memberSelect = document.getElementById('reminder_member_id');
    const dosageInput = document.getElementById('reminder_dosage');
    const timeInput = document.querySelector('#reminder_times_container .reminder-time-input');

    if (medSelect) medSelect.value = registryItem.id;
    if (memberSelect) memberSelect.value = targetLog.family_member_id;
    if (dosageInput) dosageInput.value = targetLog.dosage;

    const timeMatch = (targetLog.taken_at || '').match(/\b(\d{2}:\d{2})/);
    if (timeInput && timeMatch) timeInput.value = timeMatch[1];
}

/**
 * Sets the number of daily reminder time inputs to display.
 * @param {number} count - 1 to 4
 * @returns {void}
 */
function setReminderCount(count) {
    count = Math.max(1, Math.min(4, count));
    // Update button active state
    document.querySelectorAll('.reminder-count-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.count) === count);
    });

    // Generate time input fields
    const container = document.getElementById('reminder_times_container');
    if (!container) return;

    const existingValues = Array.from(container.querySelectorAll('.reminder-time-input')).map(inp => inp.value);

    container.innerHTML = Array.from({ length: count }, (_, i) => {
        const value = existingValues[i] || (i === 0 ? '07:00' : '');
        return `
            <div class="form-group reminder-time-group">
                <label>Time #${i + 1}</label>
                <input type="time" class="game-input reminder-time-input" value="${value}">
            </div>
        `;
    }).join('');
}

/**
 * Handles the reminder scheduler form submission.
 * @async
 * @param {Event} event
 * @returns {Promise<void>}
 */
async function handleReminderSave(event) {
    if (event) event.preventDefault();
    if (STATE.reminderSaving) return;

    const medicationId = document.getElementById('reminder_medication_id').value;
    const memberId = document.getElementById('reminder_member_id').value;
    const dosage = document.getElementById('reminder_dosage').value;
    const sourceLogId = STATE.reminderSourceLogId;

    const timeInputs = document.querySelectorAll('#reminder_times_container .reminder-time-input');
    const times = [...new Set(Array.from(timeInputs).map(inp => inp.value).filter(t => t))];

    const dayCheckboxes = document.querySelectorAll('#reminderDaysSelector input[type="checkbox"]:checked');
    const daysOfWeek = Array.from(dayCheckboxes).map(cb => parseInt(cb.value)).sort();

    if (!medicationId || !memberId || !dosage || !sourceLogId || times.length === 0) {
        alert('Reminders must be created from an existing medication log entry.');
        return;
    }

    if (times.length < 1 || times.length > 4) {
        return;
    }

    if (daysOfWeek.length === 0) {
        alert('Please select at least one day of the week.');
        return;
    }

    const btn = document.getElementById('reminderSaveBtn');
    const originalHtml = btn.innerHTML;
    STATE.reminderSaving = true;
    btn.disabled = true;
    btn.innerHTML = '⌛ Saving...';

    try {
        const result = await apiPost('/medication/api/reminders/save', {
            medication_id: medicationId,
            family_member_id: memberId,
            dosage: dosage,
            source_log_id: sourceLogId,
            times: JSON.stringify(times),
            days_of_week: JSON.stringify(daysOfWeek)
        });
        if (result && result.success) {
            closeReminderScheduler();
            await loadState(true);
        }
    } finally {
        STATE.reminderSaving = false;
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Closes the reminder scheduler modal.
 * @returns {void}
 */
function closeReminderScheduler() {
    const modal = document.getElementById('reminderSchedulerModal');
    if (modal) {
        modal.classList.remove('show');
        if (!hasOpenMedicationModal()) document.body.classList.remove('modal-open');
    }
}

/**
 * Toggles a reminder schedule's active flag.
 * @async
 * @param {number} id
 * @param {boolean} active
 * @returns {Promise<void>}
 */
async function toggleReminderActive(id, active, checkbox = null) {
    const result = await apiPost(`/medication/api/reminders/toggle/${id}`, { active: active ? 1 : 0 });
    if (result && result.success) {
        const reminder = STATE.reminders.find(r => r.id == id);
        if (reminder) reminder.is_active = active ? 1 : 0;
        renderReminderList();
        renderGrid();
        updateAllIntervals();
    } else if (checkbox) {
        checkbox.checked = !active;
    }
}

/**
 * Deletes a reminder schedule after confirmation.
 * @param {number} id
 * @returns {void}
 */
function deleteReminderSchedule(id) {
    const r = STATE.reminders.find(rem => rem.id == id);
    if (!r) return;
    const label = `${r.medication_name} ${formatTimeAmPm(r.reminder_time)}`;
    showConfirmModal({
        title: 'Delete Reminder',
        message: `Delete the reminder for <strong>${escapeHtml(label)}</strong>?`,
        danger: true,
        confirmText: 'Delete',
        alignment: 'center',
        onConfirm: async () => {
            const result = await apiPost(`/medication/api/reminders/delete/${id}`);
            if (result && result.success) {
                STATE.reminders = STATE.reminders.filter(r => r.id != id);
                renderReminderList();
                renderGrid();
                updateAllIntervals();
            }
        }
    });
}

/**
 * Confirms a pending reminder event as taken.
 * @async
 * @param {number} eventId
 * @param {HTMLButtonElement} btn
 * @returns {Promise<void>}
 */
async function confirmReminderEvent(eventId, btn) {
    if (btn && btn.disabled) return;
    const originalHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⌛ Confirming...';
    }

    const result = await apiPost(`/medication/api/reminders/confirm/${eventId}`);
    if (result && result.success) {
        STATE.pendingEvents = STATE.pendingEvents.filter(e => e.event_id != eventId);
        renderPendingList();
        // Also refresh full state in background to get updated logs
        loadState(true);
    } else if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * --- Interactive Logic ---
 */

/**
 * Pre-populates logging forms based on registry selection.
 * 
 * @param {string} mode - Context ('add'|'edit')
 * @param {string} name - Medication label
 * @param {number} dosage - Default dosage mg
 * @returns {void}
 */
function fillForm(mode, name, dosage) {
    if (!name) return;
    document.getElementById(`${mode}_med_name`).value = name;
    if (dosage && dosage > 0) document.getElementById(`${mode}_dosage`).value = dosage;
}

/**
 * Orchestrates the expansion state of medication logs (Accordion pattern).
 * 
 * @param {HTMLElement} el - Triggering element.
 * @returns {void}
 */
function toggleMedExpand(el) {
    if (el.classList.contains('expanded')) {
        el.classList.remove('expanded');
    } else {
        const list = el.closest('.user-med-list');
        list.querySelectorAll('.med-item.expanded').forEach(item => item !== el && item.classList.remove('expanded'));
        el.classList.add('expanded');
    }
}

/**
 * Refreshes relative time labels for all active log items.
 * 
 * @returns {void}
 */
function updateAllIntervals() {
    document.querySelectorAll('.interval-update').forEach(el => {
        const unix = parseInt(el.getAttribute('data-unix'));
        if (unix) el.textContent = getTimeSince(unix);
    });
}

/**
 * Synchronizes form temporal inputs with the current system time.
 * 
 * @param {string} mode - Context ('add'|'edit')
 * @returns {void}
 */
function setNow(mode) {
    const localISO = getLocalISOString();
    const [date, time] = localISO.split('T');
    const dateInput = document.getElementById(`${mode}_taken_at_date`);
    const timeInput = document.getElementById(`${mode}_taken_at_time`);
    
    if (dateInput) dateInput.value = date;
    if (timeInput) timeInput.value = time;
}

/**
 * --- Modal Controls ---
 */

/**
 * Prepares and displays the dosage logging interface.
 * 
 * @returns {void}
 */
function openDoseModal() {
    const modal = document.getElementById('doseModal');
    if (modal) {
        modal.classList.add('show');
        document.body.classList.add('modal-open');
        setNow('add');
    }
}

/**
 * Hides the logging interface.
 * 
 * @returns {void}
 */
function hasOpenMedicationModal() {
    return !!document.querySelector([
        '#doseModal.show',
        '#editModal.show',
        '#registryModal.show',
        '#manageEditModal.show',
        '#reminderSchedulerModal.show',
        '#globalConfirmActionModal.show'
    ].join(', '));
}

function closeDoseModal() { 
    const modal = document.getElementById('doseModal');
    if (modal) {
        modal.classList.remove('show');
        if (!hasOpenMedicationModal()) document.body.classList.remove('modal-open');
    }
}

/**
 * Pre-fills and displays the record editor.
 * 
 * @param {Object} data - Source record metadata.
 * @returns {void}
 */
function openEditModalById(id) {
    const logs = Object.values(STATE.logs || {}).flat();
    const log = logs.find(item => item.id == id);
    if (log) openEditModal(log);
}

function openEditModal(data) {
    const form = document.getElementById('editForm');
    if (!form) return;
    
    form.action = `/medication/api/edit/${data.id}`;
    document.getElementById('edit_member_select').value = data.family_member_id;
    document.getElementById('edit_med_name').value = data.medication_name;
    document.getElementById('edit_dosage').value = data.dosage;
    
    const takenAt = data.taken_at || '';
    const parts = takenAt.split(' ');
    if (parts.length === 2) {
        document.getElementById('edit_taken_at_date').value = parts[0];
        document.getElementById('edit_taken_at_time').value = parts[1].substring(0, 5);
    } else {
        setNow('edit');
    }
    
    const modal = document.getElementById('editModal');
    modal.classList.add('show');
    document.body.classList.add('modal-open');
}

/**
 * Hides the record editor.
 * 
 * @returns {void}
 */
function closeEditModal() { 
    const modal = document.getElementById('editModal');
    if (modal) {
        modal.classList.remove('show');
        if (!hasOpenMedicationModal()) document.body.classList.remove('modal-open');
    }
}

/**
 * Orchestrates the deletion flow for a log entry.
 * 
 * @param {number} id - Target identifier.
 * @param {string} name - Display label for context.
 * @returns {void}
 */
function confirmDeleteMedication(id, name) {
    const safeName = escapeHtml(name || '');
    showConfirmModal({
        title: 'Delete Log',
        message: `Are you sure you want to delete the log for <strong>${safeName}</strong>?`,
        danger: true,
        confirmText: 'Delete',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const result = await apiPost(`/medication/api/delete/${id}`);
            if (result && result.success) {
                // Local state reconciliation
                for (const member in STATE.logs) {
                    STATE.logs[member] = STATE.logs[member].filter(l => l.id != id);
                }
                renderUI();
            }
        }
    });
}

/**
 * Complex workflow for retroactive timestamp adjustment and reminder creation.
 * 
 * @param {number} id - Target identifier.
 * @returns {void}
 */
function confirmResetMedication(id) {
    let targetLog = null;
    for (const member in STATE.logs) {
        const found = STATE.logs[member].find(l => l.id == id);
        if (found) { targetLog = found; break; }
    }
    if (!targetLog) return;

    const localISO = getLocalISOString();
    const [date, currentTime] = localISO.split('T');
    
    const recipientCheckboxes = STATE.members.map(m => `
        <label class="recipient-checkbox">
            <input type="checkbox" name="reminder_recipients[]" value="${m.id}" ${m.id == targetLog.family_member_id ? 'checked' : ''}>
            <span class="recipient-name">${m.username}</span>
        </label>
    `).join('');

    const resetHtml = `
        <div class="reset-modal-text">Reset timestamp for <strong>${escapeHtml(targetLog.medication_name)}</strong> for <strong>${escapeHtml(targetLog.family_member)}</strong>?</div>
        <div class="form-group reset-form-group">
            <label class="reset-label">Target Time (Today)</label>
            <input type="time" id="reset_time_input" class="game-input reset-time-input" value="${currentTime}">
        </div>
        <div class="reminder-box">
            <label class="reminder-toggle-label">
                <input type="checkbox" id="enable_reminder" onchange="toggleReminderOptions(this.checked)">
                <span class="reminder-toggle-content">🔔 Schedule Reminder</span>
            </label>
            <div id="reminder_options" class="reminder-options hidden">
                <label class="reminder-delay-label">Delay (Hours)</label>
                <div class="selector-grid">
                    ${[1,2,3,4,5,6,7,8,9,10,12,24].map(h => `
                        <label class="selector-item"><input type="radio" name="reminder_delay" value="${h}" ${h==4 ? 'checked' : ''}><span>${h}</span></label>
                    `).join('')}
                </div>
                <label class="reminder-recipients-label">Send To</label>
                <div class="reminder-recipients-list">${recipientCheckboxes}</div>
            </div>
        </div>
    `;

    showConfirmModal({
        title: 'Reset Time',
        icon: '🔄',
        message: resetHtml,
        confirmText: 'Reset',
        confirmIcon: '💾',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const selectedTime = document.getElementById('reset_time_input').value;
            const enableReminder = document.getElementById('enable_reminder').checked;
            const payload = { taken_at: `${date} ${selectedTime}` };
            
            if (enableReminder) {
                payload.create_reminder = 1;
                payload.reminder_delay = document.querySelector('input[name="reminder_delay"]:checked').value;
                const recipients = Array.from(document.querySelectorAll('input[name="reminder_recipients[]"]:checked')).map(cb => cb.value);
                payload.reminder_recipients = recipients.join(',');
                payload.reminder_title = `💊 Meds: ${targetLog.medication_name} for ${targetLog.family_member}`;
                payload.reminder_desc = `Follow-up dose reminder.`;
            }

            const result = await apiPost(`/medication/api/reset/${id}`, payload);
            if (result && result.success) {
                await loadState(true);
            }
        }
    });
}

/**
 * Handles the display of reminder configuration options.
 * 
 * @param {boolean} show - Visibility flag.
 * @returns {void}
 */
function toggleReminderOptions(show) {
    const el = document.getElementById('reminder_options');
    if (el) el.classList.toggle('hidden', !show);
}

/**
 * --- Registry Controls (Admin) ---
 */

/**
 * Displays the administrative medication catalog.
 * 
 * @returns {void}
 */
function openRegistryModal() { 
    const modal = document.getElementById('registryModal');
    if (modal) {
        modal.classList.add('show'); 
        document.body.classList.add('modal-open');
    }
}

/**
 * Hides the medication catalog.
 * 
 * @returns {void}
 */
function closeRegistryModal() { 
    const modal = document.getElementById('registryModal');
    if (modal) {
        modal.classList.remove('show'); 
        if (!hasOpenMedicationModal()) document.body.classList.remove('modal-open');
    }
}

/**
 * Prepares and displays the registry item editor.
 * 
 * @param {number} id - Target identifier.
 * @param {string} name - Medication label.
 * @param {number} dosage - Default dosage.
 * @returns {void}
 */
function openManageModal(id, name, dosage) {
    const form = document.getElementById('manageEditForm');
    form.action = `/medication/api/manage/update/${id}`;
    document.getElementById('manage_id').value = id;
    document.getElementById('manage_name').value = name;
    document.getElementById('manage_dosage').value = dosage;
    
    const modal = document.getElementById('manageEditModal');
    modal.classList.add('show');
}

/**
 * Hides the registry editor.
 * 
 * @returns {void}
 */
function closeManageModal() { 
    const modal = document.getElementById('manageEditModal');
    if (modal) modal.classList.remove('show'); 
}

/**
 * Orchestrates the removal of a medication from the global catalog.
 * 
 * @param {number} id - Target identifier.
 * @param {string} name - Display label for context.
 * @returns {void}
 */
function confirmDeleteRegistry(id, name) {
    const safeName = escapeHtml(name || '');
    showConfirmModal({
        title: 'Remove from Registry',
        message: `Are you sure you want to remove <strong>${safeName}</strong> from the registry?`,
        danger: true,
        confirmText: 'Remove',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const result = await apiPost(`/medication/api/manage/delete/${id}`);
            if (result && result.success) {
                STATE.registry = STATE.registry.filter(m => m.id != id);
                renderUI();
            }
        }
    });
}

window.handleLogSubmit = handleLogSubmit;
window.handleRegistrySubmit = handleRegistrySubmit;
window.handleReminderSave = handleReminderSave;
window.fillForm = fillForm;
window.toggleMedExpand = toggleMedExpand;
window.openDoseModal = openDoseModal;
window.closeDoseModal = closeDoseModal;
window.openEditModalById = openEditModalById;
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
window.confirmDeleteMedication = confirmDeleteMedication;
window.confirmResetMedication = confirmResetMedication;
window.openRegistryModal = openRegistryModal;
window.closeRegistryModal = closeRegistryModal;
window.openManageModal = openManageModal;
window.closeManageModal = closeManageModal;
window.toggleReminderOptions = toggleReminderOptions;
window.confirmDeleteRegistry = confirmDeleteRegistry;
window.openReminderScheduler = openReminderScheduler;
window.openReminderSchedulerForEdit = openReminderSchedulerForEdit;
window.openReminderSchedulerFromLog = openReminderSchedulerFromLog;
window.closeReminderScheduler = closeReminderScheduler;
window.setReminderCount = setReminderCount;
window.toggleReminderActive = toggleReminderActive;
window.deleteReminderSchedule = deleteReminderSchedule;
window.confirmReminderEvent = confirmReminderEvent;
