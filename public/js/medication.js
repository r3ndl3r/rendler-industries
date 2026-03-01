// /public/js/medication.js

/**
 * Full AJAX Medication Tracker - Refactored to use default.js
 */

let appData = { logs: {}, registry: [], members: [] };

document.addEventListener('DOMContentLoaded', () => {
    refreshData();
    setInterval(updateAllIntervals, 60000);
    
    // Use global modal closing helper
    setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay'], [
        closeDoseModal, closeEditModal, closeConfirmModal, closeRegistryModal, closeManageModal
    ]);
});

/**
 * Core Data Management
 */
function refreshData() {
    fetch('/medication/api/data')
        .then(res => res.json())
        .then(data => {
            appData = data;
            renderUI();
        })
        .catch(err => showToast("Failed to load data", "error"));
}

function submitForm(event, url, isRegistry = false) {
    event.preventDefault();
    const form = event.target;
    const btn = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);

    // Merge split time/date for medication logs (non-registry forms)
    if (!isRegistry) {
        const mode = form.id === 'doseForm' ? 'add' : 'edit';
        const timeEl = document.getElementById(`${mode}_taken_at_time`);
        const dateEl = document.getElementById(`${mode}_taken_at_date`);
        if (timeEl && dateEl) {
            formData.set('taken_at', `${dateEl.value} ${timeEl.value}`);
        }
    }

    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Processing...`;

    // Refactored to use standard apiPost from default.js
    apiPost(url, Object.fromEntries(formData)).then(data => {
        if (data) {
            closeDoseModal();
            closeEditModal();
            if (isRegistry) closeManageModal();
            refreshData();
        } else {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }).catch(() => {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    });
}

/**
 * UI Rendering
 */
function renderUI() {
    renderGrid();
    renderDropdowns();
    renderRegistryTable();
    updateAllIntervals();
}

function renderGrid() {
    const grid = document.getElementById('medication-grid');
    grid.innerHTML = '';

    const members = Object.keys(appData.logs).sort();
    const activeMembers = members.filter(m => appData.logs[m].length > 0);

    if (activeMembers.length === 0) {
        grid.innerHTML = `<div class="empty-state"><p>📭 No active medication logs found.</p></div>`;
        return;
    }

    activeMembers.forEach(member => {
        const logs = appData.logs[member];
        const card = document.createElement('div');
        card.className = 'medication-card glass-panel';
        
        let logsHtml = '';
        logs.forEach(l => {
            const parts = l.taken_at.split(' ');
            let displayDt = l.taken_at;
            if (parts.length === 2) {
                const dateParts = parts[0].split('-');
                const timeStr = parts[1].substring(0, 5);
                displayDt = `${timeStr} ${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
            }
            
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

function findLogById(id) {
    for (const member in appData.logs) {
        const found = appData.logs[member].find(l => l.id == id);
        if (found) return found;
    }
    return null;
}

function renderDropdowns() {
    const options = appData.registry.map(m => 
        `<option value="${m.name}" data-dosage="${m.default_dosage}">${m.name}</option>`
    ).join('');
    
    const placeholder = '<option value="" selected>-- Select existing --</option>';
    document.getElementById('add_quick_select').innerHTML = placeholder + options;
    document.getElementById('edit_quick_select').innerHTML = placeholder + options;
}

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
 * Helpers & Event Handlers
 */
function getFamilyIcon(member) {
    return getIcon(member);
}

function fillForm(mode, name, dosage) {
    if (!name) return;
    document.getElementById(`${mode}_med_name`).value = name;
    if (dosage && dosage > 0) document.getElementById(`${mode}_dosage`).value = dosage;
}

function toggleMedExpand(el) {
    if (el.classList.contains('expanded')) {
        el.classList.remove('expanded');
    } else {
        const list = el.closest('.user-med-list');
        list.querySelectorAll('.med-item.expanded').forEach(item => item !== el && item.classList.remove('expanded'));
        el.classList.add('expanded');
    }
}

function updateAllIntervals() {
    document.querySelectorAll('.interval-update').forEach(el => {
        const unix = parseInt(el.getAttribute('data-unix'));
        // Uses global getTimeSince from default.js
        if (unix) el.textContent = getTimeSince(unix);
    });
}

function setNow(mode) {
    const localISO = getLocalISOString();
    const [date, time] = localISO.split('T');
    document.getElementById(`${mode}_taken_at_date`).value = date;
    document.getElementById(`${mode}_taken_at_time`).value = time;
}

/**
 * Modal Controls
 */
function openDoseModal() {
    document.getElementById('doseModal').style.display = 'block';
    setNow('add');
}
function closeDoseModal() { document.getElementById('doseModal').style.display = 'none'; }

function openEditModal(data) {
    const form = document.getElementById('editForm');
    form.action = `/medication/edit/${data.id}`;
    document.getElementById('edit_member_select').value = data.family_member_id;
    document.getElementById('edit_med_name').value = data.medication_name;
    document.getElementById('edit_dosage').value = data.dosage;
    
    const parts = data.taken_at.split(' ');
    document.getElementById('edit_taken_at_date').value = parts[0];
    document.getElementById('edit_taken_at_time').value = parts[1].substring(0, 5);
    
    document.getElementById('editModal').style.display = 'block';
}
function closeEditModal() { document.getElementById('editModal').style.display = 'none'; }

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

function confirmResetMedication(id) {
    const l = findLogById(id);
    if (!l) return;

    const medName = l.medication_name;
    const memberName = l.family_member;
    const memberId = l.family_member_id;

    const localISO = getLocalISOString();
    const [date, currentTime] = localISO.split('T');
    
    // Generate recipient checkboxes from appData.members
    const recipientCheckboxes = appData.members.map(m => `
        <label class="recipient-checkbox">
            <input type="checkbox" name="reminder_recipients[]" value="${m.id}" ${m.id == memberId ? 'checked' : ''}>
            <span class="recipient-name">${m.username}</span>
        </label>
    `).join('');

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
