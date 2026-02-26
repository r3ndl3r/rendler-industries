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
        closeDoseModal, closeEditModal, closeDeleteModal, closeResetModal, closeRegistryModal, closeManageModal
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
    const formData = new FormData(form);

    // Merge split time/date for medication logs (non-registry forms)
    if (!isRegistry && form.id !== 'deleteForm') {
        const mode = form.id === 'doseForm' ? 'add' : 'edit';
        const time = document.getElementById(`${mode}_taken_at_time`).value;
        const date = document.getElementById(`${mode}_taken_at_date`).value;
        if (time && date) {
            formData.set('taken_at', `${date} ${time}`);
        }
    }

    // Refactored to use standard apiPost from default.js
    apiPost(url, Object.fromEntries(formData)).then(data => {
        if (data) {
            closeDoseModal();
            closeEditModal();
            closeDeleteModal();
            closeResetModal();
            if (isRegistry) closeManageModal();
            refreshData();
        }
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
                                <button type="button" class="btn-icon-reset" onclick="confirmResetMedication(${l.id}, '${l.medication_name} for ${l.family_member}')">${getIcon('reset')}</button>
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
    const now = new Date();
    const time = now.toTimeString().substring(0, 5);
    const date = now.toISOString().substring(0, 10);
    document.getElementById(`${mode}_taken_at_time`).value = time;
    document.getElementById(`${mode}_taken_at_date`).value = date;
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
    document.getElementById('deleteMedName').textContent = name;
    document.getElementById('deleteForm').action = `/medication/delete/${id}`;
    document.getElementById('deleteConfirmModal').style.display = 'flex';
}
function closeDeleteModal() { document.getElementById('deleteConfirmModal').style.display = 'none'; }

function confirmResetMedication(id, name) {
    document.getElementById('resetMedName').textContent = name;
    document.getElementById('resetForm').action = `/medication/reset/${id}`;
    document.getElementById('resetConfirmModal').style.display = 'flex';
}
function closeResetModal() { document.getElementById('resetConfirmModal').style.display = 'none'; }

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
    if (confirm(`Remove ${name} from registry?`)) {
        submitForm({ preventDefault: () => {}, target: { id: 'deleteForm' } }, `/medication/manage/delete/${id}`, true);
    }
}
