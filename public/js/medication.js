// /public/js/medication.js

/**
 * Medication Tracker Controller Module
 * 
 * This module manages the Family Medication interface, providing 
 * real-time tracking of dosages, automated interval calculations, 
 * and administrative registry management.
 * 
 * Features:
 * - Real-time dosing intervals (updated every 60 seconds)
 * - Intelligent form pre-filling from medication registry
 * - Integrated dosage reset workflow with automated follow-up reminders
 * - Administrative management of the global medication registry
 * - Mobile-optimized collapsible log entries
 * 
 * Dependencies:
 * - default.js: For apiPost, getLoadingHtml, getIcon, getLocalISOString, and modal helpers
 * - toast.js: For status notifications
 */

/**
 * Application State
 * Central data store for medication logs, registry items, and family members
 */
let appData = { 
    logs: {},                       // Map of member names to dosage arrays
    registry: [],                   // Global list of available medications
    members: []                     // List of family members for selection logic
};

/**
 * Initialization System
 * Triggers initial data sync and schedules background UI updates
 */
document.addEventListener('DOMContentLoaded', () => {
    // Bootstrap collection from server
    refreshData();
    
    // Maintain accurate "time since" labels
    setInterval(updateAllIntervals, 60000);
    
    // Configure unified modal closure behavior
    setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay'], [
        closeDoseModal, closeEditModal, closeConfirmModal, closeRegistryModal, closeManageModal
    ]);
});

/**
 * --- Data Management ---
 */

/**
 * Synchronizes module state with the server-side source of truth.
 */
function refreshData() {
    fetch('/medication/api/data')
        .then(res => res.json())
        .then(data => {
            appData = data;
            renderUI();
        })
        .catch(err => {
            console.error('refreshData error:', err);
            showToast("Failed to load medication data", "error");
        });
}

/**
 * Logic: submitForm
 * Universal handler for medication log and registry forms.
 * Performs date/time merging for log entries before transmission.
 * 
 * @param {Event} event - Submission event
 * @param {string} url - Target endpoint
 * @param {boolean} isRegistry - Context flag for registry vs log entries
 */
function submitForm(event, url, isRegistry = false) {
    event.preventDefault();
    const form = event.target;
    const btn = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);

    // Contextual merging: consolidate split date/time inputs for DB compatibility
    if (!isRegistry) {
        const mode = form.id === 'doseForm' ? 'add' : 'edit';
        const timeEl = document.getElementById(`${mode}_taken_at_time`);
        const dateEl = document.getElementById(`${mode}_taken_at_date`);
        if (timeEl && dateEl) {
            formData.set('taken_at', `${dateEl.value} ${timeEl.value}`);
        }
    }

    // UI Feedback: disable button and pulse icon
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Processing...`;

    // Transmit using global AJAX helper
    apiPost(url, Object.fromEntries(formData)).then(data => {
        if (data) {
            // Success: clear UI state and re-sync
            closeDoseModal();
            closeEditModal();
            if (isRegistry) closeManageModal();
            refreshData();
        } else {
            // Failure: restore UI for correction
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }).catch(() => {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    });
}

/**
 * --- UI Rendering ---
 */

/**
 * Orchestrates the full UI refresh across all components.
 */
function renderUI() {
    renderGrid();
    renderDropdowns();
    renderRegistryTable();
    updateAllIntervals();
}

/**
 * Generates the user-categorized medication dose grid.
 */
function renderGrid() {
    const grid = document.getElementById('medication-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const members = Object.keys(appData.logs).sort();
    const activeMembers = members.filter(m => appData.logs[m].length > 0);

    // Handle empty state
    if (activeMembers.length === 0) {
        grid.innerHTML = `<div class="empty-state"><p>📭 No active medication logs found.</p></div>`;
        return;
    }

    // Iterate through members and build dosage cards
    activeMembers.forEach(member => {
        const logs = appData.logs[member];
        const card = document.createElement('div');
        card.className = 'medication-card glass-panel';
        
        let logsHtml = '';
        logs.forEach(l => {
            // Format datetime for display (HH:MM DD/MM/YYYY)
            const parts = l.taken_at.split(' ');
            let displayDt = l.taken_at;
            if (parts.length === 2) {
                const dateParts = parts[0].split('-');
                const timeStr = parts[1].substring(0, 5);
                displayDt = `${timeStr} ${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
            }
            
            // Build dosage row fragment
            logsHtml += `
                <div class="med-item" data-id="${l.id}" onclick="toggleMedExpand(this)">
                    <div class="med-item-main">
                        <div class="med-item-info">
                            <span class="med-name">${l.medication_name}</span>
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
                                <button type="button" class="btn-icon-reset" onclick="confirmResetMedication(${l.id})">${getIcon('reset')}</button>
                                <button type="button" class="btn-icon-edit" onclick='openEditModal(${JSON.stringify(l)})'>${getIcon('edit')}</button>
                                <button type="button" class="btn-icon-delete" onclick="confirmDeleteMedication(${l.id}, '${l.medication_name} for ${l.family_member}')">${getIcon('delete')}</button>
                            </div>
                        </div>
                    </div>
                </div>`;
            });

        card.innerHTML = `
            <div class="user-header">
                <h2 class="user-name">
                    <span class="user-icon">${getFamilyIcon(member)}</span>
                    <span class="user-label">${member}</span>
                </h2>
            </div>
            <div class="user-med-list">${logsHtml}</div>
        `;
        grid.appendChild(card);
    });
}

/**
 * Searches local state for a specific log record.
 * 
 * @param {number} id - Target ID
 * @returns {Object|null} - Log object or null
 */
function findLogById(id) {
    for (const member in appData.logs) {
        const found = appData.logs[member].find(l => l.id == id);
        if (found) return found;
    }
    return null;
}

/**
 * Populates form dropdowns from the global registry.
 */
function renderDropdowns() {
    const options = appData.registry.map(m => 
        `<option value="${m.name}" data-dosage="${m.default_dosage}">${m.name}</option>`
    ).join('');
    
    const placeholder = '<option value="" selected>-- Select existing --</option>';
    const addSelect = document.getElementById('add_quick_select');
    const editSelect = document.getElementById('edit_quick_select');
    
    if (addSelect) addSelect.innerHTML = placeholder + options;
    if (editSelect) editSelect.innerHTML = placeholder + options;
}

/**
 * Generates the administrative registry management table.
 */
function renderRegistryTable() {
    const body = document.getElementById('registry-table-body');
    if (!body) return;

    body.innerHTML = appData.registry.map(m => `
        <tr>
            <td><strong>${m.name}</strong></td>
            <td>${m.default_dosage} mg</td>
            <td>${m.usage_count}</td>
            <td class="col-actions">
                <div class="action-buttons">
                    <button type="button" class="btn-icon-edit" onclick="openManageModal('${m.id}', '${m.name}', '${m.default_dosage}')">${getIcon('edit')}</button>
                    <button type="button" class="btn-icon-delete" onclick="confirmDeleteRegistry(${m.id}, '${m.name}')" 
                            ${m.usage_count > 0 ? 'disabled style="opacity:0.3; cursor:not-allowed"' : ''}>${getIcon('delete')}</button>
                </div>
            </td>
        </tr>
    `).join('');
}

/**
 * --- Helpers & Utilities ---
 */

/**
 * Resolves user-specific icons from the global registry.
 * 
 * @param {string} member - Username
 * @returns {string} - Icon symbol
 */
function getFamilyIcon(member) {
    return getIcon(member);
}

/**
 * Helper: fillForm
 * Pre-populates the dose form when a registry item is selected.
 * 
 * @param {string} mode - 'add' or 'edit'
 * @param {string} name - Med name
 * @param {number} dosage - Default dosage
 */
function fillForm(mode, name, dosage) {
    if (!name) return;
    document.getElementById(`${mode}_med_name`).value = name;
    if (dosage && dosage > 0) document.getElementById(`${mode}_dosage`).value = dosage;
}

/**
 * Logic: toggleMedExpand
 * Manages accordion-style expansion of medication log items.
 * 
 * @param {HTMLElement} el - Clicked item element
 */
function toggleMedExpand(el) {
    if (el.classList.contains('expanded')) {
        el.classList.remove('expanded');
    } else {
        const list = el.closest('.user-med-list');
        // Close others in the same list for focus
        list.querySelectorAll('.med-item.expanded').forEach(item => item !== el && item.classList.remove('expanded'));
        el.classList.add('expanded');
    }
}

/**
 * UI Refresh: updateAllIntervals
 * Re-calculates "time since" labels for all visible log entries.
 */
function updateAllIntervals() {
    document.querySelectorAll('.interval-update').forEach(el => {
        const unix = parseInt(el.getAttribute('data-unix'));
        if (unix) el.textContent = getTimeSince(unix);
    });
}

/**
 * Logic: setNow
 * Syncs the form inputs with current system time.
 * 
 * @param {string} mode - 'add' or 'edit'
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
 * Interface: openDoseModal
 * Prepares and displays the logging interface.
 */
function openDoseModal() {
    const modal = document.getElementById('doseModal');
    if (modal) modal.style.display = 'block';
    setNow('add');
}

/**
 * Interface: closeDoseModal
 * Hides the logging interface.
 */
function closeDoseModal() { 
    const modal = document.getElementById('doseModal');
    if (modal) modal.style.display = 'none'; 
}

/**
 * Interface: openEditModal
 * Pre-fills the logging interface with existing record data.
 * 
 * @param {Object} data - Log record object
 */
function openEditModal(data) {
    const form = document.getElementById('editForm');
    if (!form) return;
    
    form.action = `/medication/edit/${data.id}`;
    document.getElementById('edit_member_select').value = data.family_member_id;
    document.getElementById('edit_med_name').value = data.medication_name;
    document.getElementById('edit_dosage').value = data.dosage;
    
    const parts = data.taken_at.split(' ');
    document.getElementById('edit_taken_at_date').value = parts[0];
    document.getElementById('edit_taken_at_time').value = parts[1].substring(0, 5);
    
    document.getElementById('editModal').style.display = 'block';
}

/**
 * Hides the edit interface.
 */
function closeEditModal() { 
    const modal = document.getElementById('editModal');
    if (modal) modal.style.display = 'none'; 
}

/**
 * Action: confirmDeleteMedication
 * Triggers deletion confirmation for a specific log entry.
 */
function confirmDeleteMedication(id, name) {
    showConfirmModal({
        title: 'Delete Medication Log',
        message: `Are you sure you want to delete the log for <strong>${name}</strong>?`,
        danger: true,
        confirmText: 'Delete Log',
        onConfirm: async () => {
            const result = await apiPost(`/medication/delete/${id}`);
            if (result) refreshData();
        }
    });
}

/**
 * Workflow: confirmResetMedication
 * Complex workflow for resetting a dose time and scheduling automated follow-ups.
 * 
 * @param {number} id - Target log entry ID
 */
function confirmResetMedication(id) {
    const l = findLogById(id);
    if (!l) return;

    const medName = l.medication_name;
    const memberName = l.family_member;
    const memberId = l.family_member_id;

    const localISO = getLocalISOString();
    const [date, currentTime] = localISO.split('T');
    
    // Generate recipient grid from state
    const recipientCheckboxes = appData.members.map(m => `
        <label class="recipient-checkbox">
            <input type="checkbox" name="reminder_recipients[]" value="${m.id}" ${m.id == memberId ? 'checked' : ''}>
            <span class="recipient-name">${m.username}</span>
        </label>
    `).join('');

    // Launch specialized confirmation modal with embedded reminder logic
    showConfirmModal({
        title: 'Reset Dose Time',
        icon: 'reset',
        message: `
            <div class="reset-modal-text">
                Reset timestamp for <strong>${medName}</strong> for <strong>${memberName}</strong>?
            </div>
            <div class="form-group reset-form-group">
                <label class="reset-label">Target Time (Today)</label>
                <input type="time" id="reset_time_input" class="game-input reset-time-input" value="${currentTime}">
            </div>

            <div class="reminder-box">
                <label class="reminder-toggle-label">
                    <input type="checkbox" id="enable_reminder" onchange="document.getElementById('reminder_options').style.display = this.checked ? 'block' : 'none'">
                    <span class="reminder-toggle-content">${getIcon('reminders')} Schedule Reminder</span>
                </label>
                
                <div id="reminder_options" class="reminder-options">
                    <label class="reminder-delay-label">Delay (Hours)</label>
                    <div class="reminder-delay-selector">
                        ${[1,2,3,4,5,6,7,8,9,10,12,24].map(h => `
                            <label class="delay-pill">
                                <input type="radio" name="reminder_delay" value="${h}" ${h==4 ? 'checked' : ''}>
                                <span>${h}</span>
                            </label>
                        `).join('')}
                    </div>
                    
                    <label class="reminder-recipients-label">Send To</label>
                    <div class="reminder-recipients-list">
                        ${recipientCheckboxes}
                    </div>
                </div>
            </div>
        `,
        confirmText: 'Reset to Selected Time',
        onConfirm: async () => {
            const selectedTime = document.getElementById('reset_time_input').value;
            const enableReminder = document.getElementById('enable_reminder').checked;
            
            const payload = { taken_at: `${date} ${selectedTime}` };
            
            // Integrate reminder creation if requested
            if (enableReminder) {
                payload.create_reminder = 1;
                payload.reminder_delay = document.querySelector('input[name="reminder_delay"]:checked').value;
                
                const recipients = Array.from(document.querySelectorAll('input[name="reminder_recipients[]"]:checked')).map(cb => cb.value);
                payload.reminder_recipients = recipients.join(',');
                
                payload.reminder_title = `💊 Meds: ${medName} for ${memberName}`;
                payload.reminder_desc = `Follow-up dose reminder created from Medication Tracker. http://rendler.org/medication`;
            }

            const result = await apiPost(`/medication/reset/${id}`, payload);
            if (result) refreshData();
        }
    });
}

/**
 * Registry Controls: Interface toggles
 */
function openRegistryModal() { document.getElementById('registryModal').style.display = 'block'; }
function closeRegistryModal() { document.getElementById('registryModal').style.display = 'none'; }

function openManageModal(id, name, dosage) {
    document.getElementById('manageEditForm').action = `/medication/manage/update/${id}`;
    document.getElementById('manage_id').value = id;
    document.getElementById('manage_name').value = name;
    document.getElementById('manage_dosage').value = dosage;
    document.getElementById('manageEditModal').style.display = 'block';
}
function closeManageModal() { document.getElementById('manageEditModal').style.display = 'none'; }

/**
 * Action: confirmDeleteRegistry
 * Confirmation for permanent removal of a medication from the global registry.
 */
function confirmDeleteRegistry(id, name) {
    showConfirmModal({
        title: 'Remove from Registry',
        message: `Are you sure you want to remove <strong>${name}</strong> from the medication registry?`,
        danger: true,
        confirmText: 'Remove',
        onConfirm: async () => {
            const result = await apiPost(`/medication/manage/delete/${id}`);
            if (result) {
                refreshData();
            }
        }
    });
}

/**
 * Global Exposure
 * Necessary for inline event handlers in server-rendered templates.
 */
window.submitForm = submitForm;
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
window.confirmDeleteRegistry = confirmDeleteRegistry;
window.refreshData = refreshData;
