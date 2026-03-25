// /public/js/timers/manage.js

/**
 * Timer Management Controller
 * 
 * Manages the administrative interface for device usage timers.
 * It facilitates the creation, modification, and deletion of 
 * user-specific time limits and bonus time grants.
 * 
 * Features:
 * - Ledger rendering with user-based filtering
 * - Interactive definition creation and modification workflows
 * - Integrated bonus time grant system with instant reconciliation
 * - Standardized lifecycle for destructive removal operations
 * - Dynamic dropdown population from synchronized user state
 * - High-density JSDoc documentation for all handlers
 * 
 * Dependencies:
 * - default.js: For apiPost, getIcon, setupGlobalModalClosing, and modal helpers
 */

/**
 * --- Module Configuration & State ---
 */
const CONFIG = {
    SYNC_INTERVAL_MS: 60000,          // Server synchronization frequency
    TICK_INTERVAL_MS: 1000           // Local UI resolution
};

let STATE = {
    timers: [],                     // Collection of all timer definitions
    users: [],                      // Collection of platform user accounts
    filterUserId: ''                // Current active user filter
};

/**
 * Bootstraps the module state and establishes event delegation.
 * 
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', () => {
    // Initial fetch of the administrative roster
    loadState();

    // Interaction: Main Create trigger
    const btnCreate = document.getElementById('btn-create-timer');
    if (btnCreate) {
        btnCreate.addEventListener('click', openCreateModal);
    }

    // Interaction: User filtering
    const userFilter = document.getElementById('user-filter');
    if (userFilter) {
        userFilter.addEventListener('change', (e) => {
            STATE.filterUserId = e.target.value;
            renderUI();
        });
    }

    // Global modal behavior
    setupGlobalModalClosing(['modal-overlay'], [closeModals]);

    // High-resolution local UI loop
    setInterval(updateLocalTimers, CONFIG.TICK_INTERVAL_MS);

    // Background synchronization
    setInterval(loadState, CONFIG.SYNC_INTERVAL_MS);
});

/**
 * --- Logic & UI Operations ---
 */

/**
 * High-resolution background loop for local time increments.
 * 
 * @returns {void}
 */
function updateLocalTimers() {
    let changed = false;
    STATE.timers.forEach(t => {
        if (t.is_running && !t.is_paused) {
            t.elapsed_seconds++;
            t.remaining_seconds = Math.max(-36000, t.remaining_seconds - 1);
            changed = true;
        }
    });

    if (changed) {
        // Update row labels directly to reflect real-time increments.
        STATE.timers.forEach(t => {
            if (t.is_running && !t.is_paused) {
                const row = document.querySelector(`tr[data-timer-id="${t.id}"]`);
                if (row) {
                    const elapsedEl = row.querySelector('.elapsed-cell');
                    const remainingEl = row.querySelector('.remaining-cell');
                    
                    if (elapsedEl) elapsedEl.textContent = `${Math.floor(t.elapsed_seconds / 60)}m`;
                    if (remainingEl) {
                        if (t.remaining_seconds > 0) {
                            remainingEl.textContent = `${Math.floor(t.remaining_seconds / 60)}m`;
                        } else {
                            remainingEl.innerHTML = '<span class="expired-text">EXPIRED</span>';
                        }
                    }

                    if (t.remaining_seconds <= 0) {
                        // Force a server state refresh once the timer reaches zero.
                        loadState(true);
                    }
                }
            }
        });
    }
}

/**
 * Synchronizes the administrative state with the server.
 * 
 * @async
 * @param {boolean} force - Whether to bypass interaction-aware inhibition.
 * @returns {Promise<void>}
 */
async function loadState(force = false) {
    // Skip background refresh if a modal is active or the user is typing/interacting with filters
    const anyModalOpen = document.querySelector('.modal-overlay.show, .modal-overlay.active, .delete-modal-overlay.show, .delete-modal-overlay.active');
    const activeEl = document.activeElement;
    const inputFocused = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.id === 'user-filter' || activeEl.classList.contains('user-dropdown'));

    if (!force && (anyModalOpen || inputFocused)) return;

    try {
        const response = await fetch(`/timers/api/manage/state${STATE.filterUserId ? `?user_id=${STATE.filterUserId}` : ''}`);
        const data = await response.json();
        
        if (data && data.success) {
            STATE.timers = data.timers;
            STATE.users = data.users;
            renderUI();
        }
    } catch (err) {
        console.error('loadState failed:', err);
    }
}

/**
 * Orchestrates the full UI synchronization lifecycle.
 * 
 * @returns {void}
 */
function renderUI() {
    renderTable();
    renderUserDropdowns();
}

/**
 * Generates the timer definition ledger.
 * 
 * @returns {void}
 */
function renderTable() {
    const container = document.getElementById('manageTableContainer');
    if (!container) return;

    if (STATE.timers.length === 0) {
        container.innerHTML = `<div class="no-timers"><p>No timers found.</p></div>`;
        return;
    }

    // Apply local filtering
    const filtered = STATE.filterUserId 
        ? STATE.timers.filter(t => t.user_id == STATE.filterUserId)
        : STATE.timers;

    let html = `
        <table class="data-table timers-table">
            <thead>
                <tr>
                    <th>User</th>
                    <th>Timer Name</th>
                    <th>Category</th>
                    <th>Weekday Limit</th>
                    <th>Weekend Limit</th>
                    <th>Used Today</th>
                    <th>Remaining</th>
                    <th>Status</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${filtered.map(t => renderTableRow(t)).join('')}
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

/**
 * Generates the HTML fragment for a single ledger row.
 * 
 * @param {Object} t - Timer record metadata.
 * @returns {string} - Rendered HTML row.
 */
function renderTableRow(t) {
    const remaining = t.remaining_seconds || 0;
    const catClass = (t.category || '').toLowerCase().replace(' ', '-');
    
    return `
        <tr data-timer-id="${t.id}">
            <td class="user-cell" data-label="User">${escapeHtml(t.username)}</td>
            <td class="name-cell" data-label="Timer Name">${escapeHtml(t.name)}</td>
            <td class="category-cell" data-label="Category">
                <span class="category-badge ${catClass}">${escapeHtml(t.category)}</span>
            </td>
            <td class="limit-cell" data-label="Weekday Limit">${t.weekday_minutes}m</td>
            <td class="limit-cell" data-label="Weekend Limit">${t.weekend_minutes}m</td>
            <td class="elapsed-cell" data-label="Used Today">${Math.floor((t.elapsed_seconds || 0) / 60)}m</td>
            <td class="remaining-cell" data-label="Remaining">
                ${remaining > 0 ? `${Math.floor(remaining / 60)}m` : '<span class="expired-text">EXPIRED</span>'}
            </td>
            <td class="status-cell" data-label="Status">
                ${t.is_running ? `<span class="status-badge running">${getIcon('running')} Running</span>` : (t.is_paused ? `<span class="status-badge paused">${getIcon('paused')} Paused</span>` : `<span class="status-badge idle">${getIcon('idle')} Idle</span>`)}
            </td>
            <td class="actions-cell" data-label="Actions">
                <div class="action-buttons">
                    <button class="btn-icon-bonus" onclick="openBonusModal(${t.id})" title="Grant Bonus Time">${getIcon('bonus')}</button>
                    ${remaining > 0 ? `
                        <button class="btn-icon-transfer" onclick="showTransferModal(${t.id})" title="Transfer Time">${getIcon('transfer')}</button>
                    ` : ''}
                    <button class="btn-icon-edit" onclick="openEditModal(${t.id})" title="Edit Timer">${getIcon('edit')}</button>
                    <button class="btn-icon-delete" onclick="confirmDeleteTimer(${t.id}, '${escapeHtml(t.name)}')" title="Delete Timer">${getIcon('delete')}</button>
                </div>
            </td>
        </tr>
    `;
}

/**
 * Populates all user selection dropdowns from state.
 * 
 * @returns {void}
 */
function renderUserDropdowns() {
    const nonAdmins = STATE.users.filter(u => !u.is_admin);
    const options = nonAdmins.map(u => `<option value="${u.id}">${escapeHtml(u.username)}</option>`).join('');
    
    document.querySelectorAll('.user-dropdown').forEach(el => {
        const currentVal = el.value;
        const isFilter = el.id === 'user-filter';
        el.innerHTML = (isFilter ? '<option value="">All Users</option>' : '<option value="">Select User...</option>') + options;
        el.value = currentVal;
    });
}

/**
 * --- Interactive Handlers ---
 */

/**
 * Prepares and displays the timer creation interface.
 * 
 * @returns {void}
 */
function openCreateModal() {
    const form = document.getElementById('create-timer-form');
    if (form) form.reset();
    
    const modal = document.getElementById('modal-create-timer');
    if (modal) {
        modal.classList.add('show');
        document.body.classList.add('modal-open');
    }
}

/**
 * Pre-fills and displays the timer editor.
 * 
 * @param {number} id - Target identifier.
 * @returns {void}
 */
function openEditModal(id) {
    const t = STATE.timers.find(item => item.id == id);
    if (!t) return;

    document.getElementById('edit-timer-id').value = t.id;
    document.getElementById('edit-name').value = t.name;
    document.getElementById('edit-category').value = t.category;
    document.getElementById('edit-weekday').value = t.weekday_minutes;
    document.getElementById('edit-weekend').value = t.weekend_minutes;

    const modal = document.getElementById('modal-edit-timer');
    if (modal) {
        modal.classList.add('show');
        document.body.classList.add('modal-open');
    }
}

/**
 * Displays the bonus time grant interface.
 * 
 * @param {number} id - Target identifier.
 * @returns {void}
 */
function openBonusModal(id) {
    document.getElementById('bonus-timer-id').value = id;
    document.getElementById('bonus-minutes').value = 15;

    const modal = document.getElementById('modal-bonus-time');
    if (modal) {
        modal.classList.add('show');
        document.body.classList.add('modal-open');
    }
}

/**
 * Executes persistent definition creation.
 * 
 * @async
 * @param {Event} event - Triggering form event.
 * @returns {Promise<void>}
 */
async function handleCreateSubmit(event) {
    if (event) event.preventDefault();
    const form = event.target;
    const btn = document.getElementById('createSaveBtn');
    const originalHtml = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Saving...`;

    try {
        const formData = new FormData(form);
        const result = await apiPost('/timers/api/create', formData);
        if (result && result.success) {
            closeModals();
            await loadState(true);
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Executes persistent definition modifications.
 * 
 * @async
 * @param {Event} event - Triggering form event.
 * @returns {Promise<void>}
 */
async function handleEditSubmit(event) {
    if (event) event.preventDefault();
    const form = event.target;
    const id = document.getElementById('edit-timer-id').value;
    const btn = document.getElementById('editSaveBtn');
    const originalHtml = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Saving...`;

    try {
        const formData = new FormData(form);
        const result = await apiPost(`/timers/api/update/${id}`, formData);
        if (result && result.success) {
            closeModals();
            await loadState(true);
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Executes persistent bonus time grants.
 * 
 * @async
 * @param {Event} event - Triggering form event.
 * @returns {Promise<void>}
 */
async function handleBonusSubmit(event) {
    if (event) event.preventDefault();
    const form = event.target;
    const btn = document.getElementById('bonusSaveBtn');
    const originalHtml = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Saving...`;

    try {
        const formData = new FormData(form);
        const result = await apiPost('/timers/api/bonus', formData);
        if (result && result.success) {
            closeModals();
            await loadState(true);
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Orchestrates the deletion flow for a timer definition.
 * 
 * @param {number} id - Target identifier.
 * @param {string} name - Display label for context.
 * @returns {void}
 */
function confirmDeleteTimer(id, name) {
    showConfirmModal({
        title: 'Delete Timer',
        message: `Are you sure you want to remove definition \"<strong>${escapeHtml(name)}</strong>\"?`,
        danger: true,
        confirmText: 'Delete',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const result = await apiPost(`/timers/api/delete/${id}`);
            if (result && result.success) {
                // UI: Animate removal
                const row = document.querySelector(`tr[data-timer-id="${id}"]`);
                if (row) {
                    row.classList.add('row-fade-out');
                    setTimeout(async () => {
                        STATE.timers = STATE.timers.filter(t => t.id != id);
                        renderUI();
                    }, 500);
                } else {
                    await loadState();
                }
            }
        }
    });
}

/**
 * Displays a modal to select a target timer for time transfer.
 * 
 * @param {number} fromId - Source timer identifier.
 * @returns {void}
 */
function showTransferModal(fromId) {
    const source = STATE.timers.find(t => t.id == fromId);
    if (!source) return;

    // Filter for other timers belonging to the SAME user
    const targets = STATE.timers.filter(t => t.id != fromId && t.user_id == source.user_id);
    
    if (targets.length === 0) {
        showToast('No other active timers available for this user', 'info');
        return;
    }

    const modalHtml = `
        <div class="transfer-modal-content">
            <p>Transfer remaining time from <strong>${escapeHtml(source.name)}</strong> to another device for <strong>${escapeHtml(source.username)}</strong>:</p>
            <div class="transfer-targets-list">
                ${targets.map(t => `
                    <div class="transfer-target-item" onclick="handleTransfer(${fromId}, ${t.id})">
                        <div class="target-icon ${t.category.toLowerCase().replace(' ', '-')}">
                            ${getIcon(t.category.toLowerCase().replace(' ', '-'))}
                        </div>
                        <div class="target-info">
                            <div class="target-name">${escapeHtml(t.name)}</div>
                            <div class="target-remaining">${Math.floor((t.remaining_seconds || 0) / 60)}m remaining</div>
                        </div>
                        <div class="target-arrow">
                            ${getIcon('chevron-right')}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    // showConfirmModal is the standard way to show a dynamic modal in this project
    showConfirmModal({
        title: 'Transfer Time',
        icon: 'transfer',
        message: modalHtml,
        hideCancel: false,
        cancelText: 'Cancel',
        hideCloseX: false,
        alignment: 'center',
        confirmText: 'Select Target...',
        onConfirm: () => { /* No-op, selection happens via onclick */ }
    });
    
    // Hide the default confirm button because we use items in the list to trigger the action
    const btn = document.getElementById('globalConfirmModalBtn');
    if (btn) btn.classList.add('hidden');
}

/**
 * Executes the time transfer via API.
 * 
 * @async
 * @param {number} fromId - Source identifier.
 * @param {number} toId - Target identifier.
 * @returns {Promise<void>}
 */
async function handleTransfer(fromId, toId) {
    const targetItem = document.querySelector(`.transfer-target-item[onclick*="${toId}"]`);
    if (targetItem) {
        targetItem.classList.add('pending');
        targetItem.innerHTML = `<div class="loading-spinner">${getIcon('waiting')} Transferring...</div>`;
    }

    try {
        const result = await apiPost('/timers/api/transfer', {
            from_timer_id: fromId,
            to_timer_id: toId
        });

        if (result && result.success) {
            closeConfirmModal();
            await loadState(true);
        } else {
            // Error is automatically toasted by apiPost
            if (targetItem) {
                targetItem.classList.remove('pending');
                // Reset content via local render if needed
                renderUI(); 
            }
        }
    } catch (err) {
        console.error("Transfer Error:", err);
    }
}

/**
 * Hides all active administrative modals.
 * 
 * @returns {void}
 */
function closeModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('show'));
    document.body.classList.remove('modal-open');
}

/**
 * Sanitizes input for safe DOM injection.
 * 
 * @param {string} text - Raw input.
 * @returns {string} - Escaped output.
 */
function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * --- Global Exposure ---
 */
window.handleCreateSubmit = handleCreateSubmit;
window.handleEditSubmit = handleEditSubmit;
window.handleBonusSubmit = handleBonusSubmit;
window.openCreateModal = openCreateModal;
window.openEditModal = openEditModal;
window.openBonusModal = openBonusModal;
window.showTransferModal = showTransferModal;
window.handleTransfer = handleTransfer;
window.confirmDeleteTimer = confirmDeleteTimer;
window.closeModals = closeModals;
window.loadState = loadState;
