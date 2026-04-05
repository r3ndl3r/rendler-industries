// /public/js/chores.js

/**
 * Chore Board Controller
 * 
 * Optimized for High-Fidelity Glassmorphism and Atomic State Sync.
 * 
 * Features:
 * - State-driven ledger rendering
 * - Real-time points tally
 * - Admin auditing and revocation
 * 
 * Dependencies:
 * - default.js: For apiPost, getIcon, showToast, and modal helpers
 */

// --- Utility Helpers ---

/**
 * --- Global Exposure ---
 */


const CONFIG = {
    SYNC_INTERVAL_MS: 10000          // Background synchronization frequency (10s)
};

let STATE = {
    is_admin: false,
    is_child: false,
    current_points: 0,
    active_chores: [],
    all_users: [],
    history: [],
    quick_add_chores: [],
    child_balances: []
};

/**
 * Bootstraps the module state and establishes event delegation.
 * 
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    setInterval(loadState, CONFIG.SYNC_INTERVAL_MS);
    setupGlobalModalClosing(['modal-overlay'], [closeAddModal]);
});

/**
 * State Sychronization
 * 
 * @async
 * @param {boolean} force - If true, bypasses inhibition checks (e.g., after save).
 * @returns {Promise<void>}
 */
async function loadState(force = false) {
    // Skip background refresh if a modal is active OR the user is typing in an input field.
    const anyModalOpen = document.querySelector('.modal-overlay.show') || document.querySelector('.delete-modal-overlay.show');
    const inputFocused = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');

    if (!force && (anyModalOpen || inputFocused) && STATE.active_chores.length > 0) return;

    try {
        const res = await fetch('/chores/api/state');
        const data = await res.json();
        if (data && data.success) {
            STATE = { ...STATE, ...data };
            renderUI();
        } else {
            const noAccess = document.getElementById('noAccessView');
            if (noAccess) noAccess.classList.remove('hidden');
        }
    } catch (err) {
        console.error("Chores Board loadState failed:", err);
    }
}

/**
 * Orchestrates role-based visibility and dashboard rendering.
 *
 * @returns {void}
 */
function renderUI() {
    const childView = document.getElementById('childView');
    const adminView = document.getElementById('adminView');
    const noAccessView = document.getElementById('noAccessView');
    const statsCon = document.getElementById('headerStats');
    const adminActions = document.getElementById('adminActions');

    // 1. Display Player Balance
    if (STATE.is_child && !STATE.is_admin) {
        statsCon.innerHTML = `${window.getIcon('star')} <span>${STATE.current_points} pts</span>`;
    } else {
        statsCon.innerHTML = '';
    }

    // 2. Control Layout Visibility
    if (STATE.is_admin) {
        if (adminView) adminView.classList.remove('hidden');
        if (childView) childView.classList.remove('hidden'); 
        if (noAccessView) noAccessView.classList.add('hidden');
        if (adminActions) adminActions.classList.remove('hidden');
        renderAdminControlPanel();
        renderChores();
        renderUserBalances();
    } else if (STATE.is_child) {
        if (childView) childView.classList.remove('hidden');
        if (adminView) adminView.classList.add('hidden');
        if (noAccessView) noAccessView.classList.add('hidden');
        if (adminActions) adminActions.classList.add('hidden');
        renderChores();
        renderUserBalances();
    } else {
        if (childView) childView.classList.add('hidden');
        if (adminView) adminView.classList.add('hidden');
        if (noAccessView) noAccessView.classList.remove('hidden');
        if (adminActions) adminActions.classList.add('hidden');
    }
}

/**
 * =======================
 * CHILD GAME LOOP VIEW
 * =======================
 */

/**
 * Renders high-fidelity chore cards.
 * 
 * @returns {void}
 */
function renderChores() {
    const grid = document.getElementById('choreGrid');
    if (!grid) return;

    if (STATE.active_chores.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">${window.getIcon('happy')}</div>
                <p>No Chores Pending</p>
                <div class="empty-hint">Everything is clean! The board is currently clear.</div>
            </div>
        `;
        return;
    }

    grid.innerHTML = STATE.active_chores.map(c => {
        const isTargeted = !!c.assigned_to;
        const iconName = isTargeted ? (c.assigned_username?.toLowerCase() || 'user') : 'globe';
        const iconHtml = window.getIcon(iconName) || window.getIcon('globe');
        const badgeText = isTargeted 
            ? ((STATE.is_admin && !STATE.is_child) ? `Assigned to ${escapeHtml(c.assigned_username || 'User')}` : 'Assigned to You')
            : 'Global Chore';

        return `
            <div id="chore-card-${c.id}" class="chore-card ${isTargeted ? 'targeted' : ''}">
                <div>
                    <div class="chore-badge">${iconHtml} ${badgeText}</div>
                    <div class="chore-header">
                        <div class="chore-title">${escapeHtml(c.title)}</div>
                        <div class="chore-actions">
                            ${STATE.is_admin ? `<button class="btn-icon-delete" title="Delete Chore" onclick="confirmDeleteChore(${c.id}, '${escapeHtml(c.title).replace(/'/g, "\\'")}')">${window.getIcon('delete')}</button>` : ''}
                        </div>
                    </div>
                </div>
                ${STATE.is_child ? `
                <button class="btn-chore-claim" 
                    onclick="confirmClaim(${c.id}, '${escapeHtml(c.title).replace(/'/g, "\\'")}', ${c.points})">
                    ${window.getIcon('check')} I Finished This! <span class="btn-points-tag">Points: ${c.points}</span>
                </button>
                ` : `
                <div class="chore-points-static">
                    <span class="btn-points-tag">Points: ${c.points}</span>
                </div>
                `}
            </div>
        `;
    }).join('');
}

/**
 * Verifies honor-system completion using global modal.
 * 
 * @param {number} choreId - Chore identifier
 * @param {string} title - Action description
 * @param {number} points - Point reward value
 * @returns {void}
 */
function confirmClaim(choreId, title, points) {
    showConfirmModal({
        title: 'Chore Completion',
        message: `Confirm that you completed "<strong>${title}</strong>"?<br><br>Rewards: ${points > 0 ? `<span class="text-success">${points} pts</span>` : 'no points'}.`,
        confirmText: 'Confirm Completion',
        hideCancel: true,
        onConfirm: async () => {
            const card = document.getElementById(`chore-card-${choreId}`);
            if (card) card.classList.add('pending');

            const res = await apiPost('/chores/api/complete', { id: choreId });
            if (res && res.success) {
                showToast(`Task recognized! +${points} pts rewarded.`, 'success');
                loadState(true);
            } else {
                if (card) card.classList.remove('pending');
                if (res && res.error) showToast(res.error, "danger");
                loadState(true);
            }
        }
    });
}

/**
 * Prompts admin permanently removing a chore from the active pool.
 * 
 * @param {number} choreId - Chore identifier
 * @param {string} title - Description
 * @returns {void}
 */
function confirmDeleteChore(choreId, title) {
    showConfirmModal({
        title: 'Delete Chore',
        message: `Permanently delete "<strong>${title}</strong>"?`,
        danger: true,
        confirmText: 'Delete',
        hideCancel: true,
        onConfirm: async () => {
            const card = document.getElementById(`chore-card-${choreId}`);
            if (card) card.classList.add('pending');

            const res = await apiPost('/chores/api/delete', { id: choreId });
            if (res && res.success) {
                showToast(`Chore "${title}" deleted.`, 'success');
                loadState(true);
            } else {
                if (card) card.classList.remove('pending');
            }
        }
    });
}

/**
 * =======================
 * ADMIN REVIEW PANELS
 * =======================
 */

/**
 * Renders all admin interfaces targeting families.
 * 
 * @returns {void}
 */
function renderAdminControlPanel() {
    renderUserBalances();
    renderQuickAdd();
    renderHistory();
    populateAssignedSelect();
}

/**
 * Modal Management: Open the "Add Chore" dialog.
 * 
 * @returns {void}
 */
function openAddModal() {
    const modal = document.getElementById('addChoreModal');
    if (modal) {
        modal.classList.add('show');
        document.body.classList.add('modal-open');
    }
}

/**
 * Modal Management: Close the "Add Chore" dialog.
 * 
 * @returns {void}
 */
function closeAddModal() {
    const modal = document.getElementById('addChoreModal');
    if (modal) {
        modal.classList.remove('show');
        document.body.classList.remove('modal-open');
    }
}

/**
 * Fills the "Add Chore" dropdown targeting children.
 * 
 * @returns {void}
 */
function populateAssignedSelect() {
    const select = document.getElementById('assignedToSelect');
    if (!select) return;

    const baseOpt = `<option value="">${getIcon('family')} Family Pool</option>`;
    const children = STATE.all_users.filter(u => u.is_child && !u.is_admin);

    select.innerHTML = baseOpt + children.map(c =>
        `<option value="${c.id}">${getIcon(c.username)} ${escapeHtml(c.username)}</option>`
    ).join('');
}
/**
 * Processes Admin posting a new chore.
 * 
 * @async
 * @param {Event} e - Form submission event
 * @returns {Promise<void>}
 */
async function addChore(e) {
    if (e) e.preventDefault();
    const form = e.target;
    // Visually disable button while in flight
    const btn = form.querySelector('button[type="submit"]');
    const originalHtml = btn.innerHTML;
    
    btn.disabled = true;
    btn.innerHTML = `${window.getIcon('waiting')} Posting...`;
    
    try {
        const formData = new FormData(form);
        const res = await apiPost('/chores/api/add', formData);
        
        if (res && res.success) {
            showToast(`✨ Posted: ${escapeHtml(formData.get('title'))} (+${formData.get('points')} pts). Notification sent!`, 'success');
            form.reset();
            closeAddModal();
            await loadState(true);
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Populates the add chore modal with template data for review.
 * 
 * @param {string} title - Chore textual description
 * @param {number} points - Bounty value
 * @param {string} assignedTo - Target user ID (or empty for global)
 * @returns {void}
 */
function fillChoreForm(title, points, assignedTo) {
    const titleInput = document.querySelector('input[name="title"]');
    const pointsInput = document.querySelector('input[name="points"]');
    const assignedSelect = document.getElementById('assignedToSelect');

    if (titleInput) titleInput.value = title;
    if (pointsInput) pointsInput.value = points;
    if (assignedSelect) assignedSelect.value = assignedTo || '';

    // Visual feedback: brief highlight on the form groups
    const groups = document.querySelectorAll('.form-group-glass');
    groups.forEach(g => {
        g.style.transition = 'none';
        g.style.backgroundColor = 'rgba(59, 130, 246, 0.2)';
        setTimeout(() => {
            g.style.transition = 'background-color 0.8s ease';
            g.style.backgroundColor = '';
        }, 50);
    });

    showToast('Template populated! Review and click Post.', 'info');
}

/**
 * Maps the quick-add buttons.
 * 
 * @returns {void}
 */
function renderQuickAdd() {
    const container = document.getElementById('quickAddGrid');
    if (!container) return;

    if (STATE.quick_add_chores.length === 0) {
        container.innerHTML = '<div class="empty-hint p-2">No recent templates available.</div>';
        return;
    }

    container.innerHTML = STATE.quick_add_chores.map(c => {
        const iconName = c.assigned_username ? c.assigned_username.toLowerCase() : 'globe';
        const iconHtml = window.getIcon(iconName) || window.getIcon('globe');
        return `
            <div class="repost-item" onclick="fillChoreForm('${escapeHtml(c.title)}', ${c.points}, '${c.assigned_to || ''}')">
                <span class="repost-icon">${iconHtml}</span>
                <span class="repost-title">${escapeHtml(c.title)}</span>
                <span class="repost-pts">+${c.points}</span>
            </div>
        `;
    }).join('');
}

/**
 * Renders tabular child point balances.
 * 
 * @returns {void}
 */
function renderUserBalances() {
    const tbody = document.getElementById('balancesTable');
    if (!tbody || !STATE.child_balances) return;

    tbody.innerHTML = STATE.child_balances.map(u => {
        const sum = u.current_points;
        return `
            <tr>
                <td><strong>${window.getIcon(u.username)} ${escapeHtml(u.username)}</strong></td>
                <td class="${sum > 0 ? 'text-success' : ''}"><strong>${sum}</strong> <small>pts</small></td>
            </tr>
        `;
    }).join('');
}

/**
 * Maps recent history for an admin allowing revocation.
 * 
 * @returns {void}
 */
function renderHistory() {
    const tbody = document.getElementById('historyTable');
    if (!tbody) return;

    if (STATE.history.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center p-4 empty-hint">No audit logs found.</td></tr>`;
        return;
    }

    tbody.innerHTML = STATE.history.map(h => {
        const userIcon = window.getIcon(h.completed_by_name?.toLowerCase()) || window.getIcon('user');
        return `
            <tr id="history-row-${h.id}" class="history-row">
                <td data-label="User" class="col-user">
                    <span class="audit-user">${userIcon} ${escapeHtml(h.completed_by_name || 'System')}</span>
                </td>
                <td data-label="Time" class="col-time"><small>${format_datetime(h.completed_at)}</small></td>
                <td data-label="Task" class="col-task">${escapeHtml(h.title)}</td>
                <td data-label="Points" class="col-points ${h.points > 0 ? 'text-success' : ''}">
                    <strong>${h.points > 0 ? `+${h.points}` : '0'}</strong>
                </td>
                <td class="text-right col-actions">
                    <button class="btn-icon-delete" title="Revoke Completion" onclick="confirmRevoke(${h.id})">
                        ${window.getIcon('delete')}
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Prompts admin reversal of a completed task.
 * 
 * @param {number} choreId - Completed chore identifier
 * @returns {void}
 */
function confirmRevoke(choreId) {
    showConfirmModal({
        title: 'Revoke Completion',
        message: 'This will return the chore to the grid and dock points from the child. Proceed?',
        confirmText: 'REVOKE',
        hideCancel: true,
        danger: true,
        onConfirm: async () => {
            const row = document.getElementById(`history-row-${choreId}`);
            if (row) row.classList.add('pending');

            const res = await apiPost('/chores/api/revoke', { id: choreId });
            if (res && res.success) {
                showToast('Chore status revoked.', 'success');
                loadState(true);
            } else {
                if (row) row.classList.remove('pending');
            }
        }
    });
}

/**
 * --- Global Exposure ---
 */
window.loadState = loadState;
window.confirmClaim = confirmClaim;
window.confirmDeleteChore = confirmDeleteChore;
window.addChore = addChore;
window.fillChoreForm = fillChoreForm;
window.confirmRevoke = confirmRevoke;
window.openAddModal = openAddModal;
window.closeAddModal = closeAddModal;
