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
 * - default.js: For apiPost, getIcon, getLocalISOString, setupGlobalModalClosing, and modal helpers
 * - toast.js: For status notifications
 */

/**
 * --- Module Configuration & State ---
 */
const CONFIG = {
    SYNC_INTERVAL_MS: 300000,        // Background synchronization (5 min)
    UI_TICK_MS: 60000               // Relative time update frequency (1 min)
};

let STATE = {
    logs: {},                       // Map of member names to dosage arrays
    registry: [],                   // Global list of available medications
    members: [],                    // List of family members for dropdowns
    isAdmin: false                  // Authorization gate for administrative actions
};

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
    
    // Configure unified modal closure behavior
    setupGlobalModalClosing(['modal-overlay'], [
        closeDoseModal, closeEditModal, closeRegistryModal, closeManageModal, closeConfirmModal
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
    try {
        const response = await fetch('/medication/api/state');
        const data = await response.json();
        
        if (data && data.success) {
            STATE.logs = data.logs;
            STATE.registry = data.registry;
            STATE.members = data.members;
            STATE.isAdmin = !!data.is_admin;
            renderUI();
        }
    } catch (err) {
        console.error('loadState failed:', err);
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
    const btn = document.getElementById(btnId);
    const formData = new FormData(form);

    // Contextual merging: consolidate split inputs for DB compatibility
    const mode = form.id === 'doseForm' ? 'add' : 'edit';
    const timeEl = document.getElementById(`${mode}_taken_at_time`);
    const dateEl = document.getElementById(`${mode}_taken_at_date`);
    if (timeEl && dateEl) {
        formData.set('taken_at', `${dateEl.value} ${timeEl.value}`);
    }

    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Saving...`;

    try {
        const result = await apiPost(url, Object.fromEntries(formData));
        if (result && result.success) {
            closeDoseModal();
            closeEditModal();
            await loadState();
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
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
    btn.innerHTML = `${getIcon('waiting')} Saving...`;

    try {
        const result = await apiPost(url, Object.fromEntries(formData));
        if (result && result.success) {
            closeManageModal();
            await loadState();
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
    renderDropdowns();
    renderRegistryTable();
    renderActionButtons();
    updateAllIntervals();
}

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
                        <span class="user-icon">${getIcon(member)}</span>
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
 * Generates the HTML fragment for a single medication dose.
 * 
 * @param {Object} l - Log record metadata.
 * @returns {string} - Rendered HTML.
 */
function renderLogItem(l) {
    const parts = l.taken_at.split(' ');
    let displayDt = l.taken_at;
    if (parts.length === 2) {
        const dateParts = parts[0].split('-');
        const timeStr = parts[1].substring(0, 5);
        displayDt = `${timeStr} ${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
    }

    return `
        <div class="med-item" data-id="${l.id}" onclick="toggleMedExpand(this)">
            <div class="med-item-main">
                <div class="med-item-info">
                    <span class="med-name">${escapeHtml(l.medication_name)}</span>
                    <span class="med-dosage-pill">${l.dosage} mg</span>
                </div>
                <div class="med-item-right">
                    <div class="med-item-timer">
                        <span class="interval-update" data-unix="${l.taken_at_unix}">...</span>
                    </div>
                    <span class="expand-icon">${getIcon('expand')}</span>
                </div>
            </div>
            <div class="med-item-details">
                <div class="med-item-footer">
                    <span class="taken-at-label">${getIcon('clock')} ${displayDt}</span>
                    <div class="med-item-actions" onclick="event.stopPropagation()">
                        <button type="button" class="btn-icon-reset" onclick="confirmResetMedication(${l.id})" title="Reset Time">${getIcon('reset')}</button>
                        <button type="button" class="btn-icon-edit" onclick='openEditModal(${JSON.stringify(l)})' title="Edit Log">${getIcon('edit')}</button>
                        <button type="button" class="btn-icon-delete" onclick="confirmDeleteMedication(${l.id}, '${escapeHtml(l.medication_name)} for ${escapeHtml(l.family_member)}')" title="Delete Log">${getIcon('delete')}</button>
                    </div>
                </div>
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
        `<option value="${m.id}">${getIcon(m.username)} ${escapeHtml(m.username)}</option>`
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

    body.innerHTML = STATE.registry.map(m => `
        <tr>
            <td><strong>${escapeHtml(m.name)}</strong></td>
            <td>${m.default_dosage} mg</td>
            <td>${m.usage_count}</td>
            <td class="col-actions">
                <div class="action-buttons">
                    <button type="button" class="btn-icon-edit" onclick="openManageModal('${m.id}', '${escapeHtml(m.name)}', '${m.default_dosage}')" title="Edit Registry">${getIcon('edit')}</button>
                    <button type="button" class="btn-icon-delete" onclick="confirmDeleteRegistry(${m.id}, '${escapeHtml(m.name)}')" 
                            ${m.usage_count > 0 ? 'disabled' : ''} title="Remove Registry Item">${getIcon('delete')}</button>
                </div>
            </td>
        </tr>
    `).join('');
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
function closeDoseModal() { 
    const modal = document.getElementById('doseModal');
    if (modal) {
        modal.classList.remove('show');
        document.body.classList.remove('modal-open');
    }
}

/**
 * Pre-fills and displays the record editor.
 * 
 * @param {Object} data - Source record metadata.
 * @returns {void}
 */
function openEditModal(data) {
    const form = document.getElementById('editForm');
    if (!form) return;
    
    form.action = `/medication/api/edit/${data.id}`;
    document.getElementById('edit_member_select').value = data.family_member_id;
    document.getElementById('edit_med_name').value = data.medication_name;
    document.getElementById('edit_dosage').value = data.dosage;
    
    const parts = data.taken_at.split(' ');
    document.getElementById('edit_taken_at_date').value = parts[0];
    document.getElementById('edit_taken_at_time').value = parts[1].substring(0, 5);
    
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
        document.body.classList.remove('modal-open');
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
    showConfirmModal({
        title: 'Delete Log',
        message: `Are you sure you want to delete the log for <strong>${name}</strong>?`,
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
                <span class="reminder-toggle-content">${getIcon('reminders')} Schedule Reminder</span>
            </label>
            <div id="reminder_options" class="reminder-options hidden">
                <label class="reminder-delay-label">Delay (Hours)</label>
                <div class="reminder-delay-selector">
                    ${[1,2,3,4,5,6,7,8,9,10,12,24].map(h => `
                        <label class="delay-pill"><input type="radio" name="reminder_delay" value="${h}" ${h==4 ? 'checked' : ''}><span>${h}</span></label>
                    `).join('')}
                </div>
                <label class="reminder-recipients-label">Send To</label>
                <div class="reminder-recipients-list">${recipientCheckboxes}</div>
            </div>
        </div>
    `;

    showConfirmModal({
        title: 'Reset Time',
        icon: 'reset',
        message: resetHtml,
        confirmText: 'Reset',
        confirmIcon: 'save',
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
                payload.reminder_desc = `Follow-up dose reminder. http://rendler.org/medication`;
            }

            const result = await apiPost(`/medication/api/reset/${id}`, payload);
            if (result && result.success) {
                await loadState();
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
        document.body.classList.remove('modal-open');
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
    showConfirmModal({
        title: 'Remove from Registry',
        message: `Are you sure you want to remove <strong>${name}</strong> from the registry?`,
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

/**
 * Sanitizes input for safe DOM injection.
 * 
 * @param {string} text - Raw input string.
 * @returns {string} - Escaped output.
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
window.handleLogSubmit = handleLogSubmit;
window.handleRegistrySubmit = handleRegistrySubmit;
window.fillForm = fillForm;
window.toggleMedExpand = toggleMedExpand;
window.openDoseModal = openDoseModal;
window.closeDoseModal = closeDoseModal;
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
window.loadState = loadState;
