// /public/js/chores.js

/**
 * Chore Board Controller (V3)
 * 
 * Optimized for High-Fidelity Glassmorphism and Atomic State Sync.
 * Terminology: "Chore" (replacing Bounty).
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
 * Prevents XSS by sanitizing dynamic content before DOM injection.
 * 
 * @param {string} text - Raw input string.
 * @returns {string} - HTML-escaped output.
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Switches between module-specific administrative tabs.
 * 
 * @param {string} tab - Tab name prefix.
 * @param {HTMLElement} btn - clicked button.
 * @returns {void}
 */
function switchTab(tab, btn) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
    
    const targetTab = document.getElementById(tab + 'Tab');
    if (targetTab) {
        targetTab.classList.remove('hidden');
        renderAdminControlPanel();
    }
    
    if (btn) {
        btn.classList.add('active');
    }
}

/**
 * --- Module Configuration & State ---
 */
const CONFIG = {
    SYNC_INTERVAL_MS: 300000         // Background synchronization frequency
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
        renderAdminControlPanel();
        renderChores();
    } else if (STATE.is_child) {
        if (childView) childView.classList.remove('hidden');
        if (adminView) adminView.classList.add('hidden');
        if (noAccessView) noAccessView.classList.add('hidden');
        renderChores();
    } else {
        if (childView) childView.classList.add('hidden');
        if (adminView) adminView.classList.add('hidden');
        if (noAccessView) noAccessView.classList.remove('hidden');
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
        const targetText = (STATE.is_admin && !STATE.is_child) ? `Assigned to ${escapeHtml(c.assigned_username || 'User')}` : 'Assigned to You';
        return `
            <div class="chore-card ${isTargeted ? 'targeted' : ''}">
                <div>
                    ${isTargeted ? `<div class="chore-badge">${window.getIcon('star')} ${targetText}</div>` : ''}
                    <div class="chore-header">
                        <div class="chore-title">${escapeHtml(c.title)}</div>
                        <div class="chore-actions">
                            <div class="chore-points">
                                ${c.points > 0 ? `+${c.points}` : '0'} 
                            </div>
                            ${STATE.is_admin ? `<button class="btn-icon-delete" title="Delete Chore" onclick="confirmDeleteChore(${c.id}, '${escapeHtml(c.title).replace(/'/g, "\\'")}')">${window.getIcon('delete')}</button>` : ''}
                        </div>
                    </div>
                </div>
                ${STATE.is_child ? `
                <button class="btn-chore-claim" 
                    onclick="confirmClaim(${c.id}, '${escapeHtml(c.title).replace(/'/g, "\\'")}', ${c.points})">
                    ${window.getIcon('check')} I Finished This!
                </button>
                ` : ''}
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
        cancelText: 'Cancel',
        onConfirm: async () => {
            const res = await apiPost('/chores/api/complete', { id: choreId });
            if (res && res.success) {
                showToast(`Task recognized! +${points} pts rewarded.`, 'success');
                loadState(true);
            } else if (res && res.error) {
                showToast(res.error, "danger");
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
        message: `Permanently delete "<strong>${title}</strong>"?<br>This cannot be undone.`,
        danger: true,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        onConfirm: async () => {
            const res = await apiPost('/chores/api/delete', { id: choreId });
            if (res && res.success) {
                showToast(`Chore "${title}" deleted.`, 'success');
                loadState(true);
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
            await loadState(true);
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Reposts a past chore using its template.
 * 
 * @async
 * @param {string} title - Chore textual description
 * @param {number} points - Bounty value
 * @returns {Promise<void>}
 */
async function triggerQuickAdd(title, points) {
    const res = await apiPost('/chores/api/add', { title: title, points: points, assigned_to: '' });
    if (res && res.success) {
        showToast(`✨ Reactivated: ${escapeHtml(title)} (+${points} pts). Notification sent!`, 'success');
        loadState(true);
    }
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

    container.innerHTML = STATE.quick_add_chores.map(c => `
        <div class="repost-item" onclick="triggerQuickAdd('${escapeHtml(c.title)}', ${c.points})">
            <div class="repost-title">${escapeHtml(c.title)}</div>
            <div class="repost-pts">+${c.points}</div>
        </div>
    `).join('');
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
                <td class="text-right ${sum > 0 ? 'text-success' : ''}"><strong>${sum}</strong> <small>pts</small></td>
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
        const date = new Date(h.completed_at).toLocaleString();
        return `
            <tr>
                <td><small>${date}</small></td>
                <td><strong>${escapeHtml(h.completed_by_name || 'System')}</strong></td>
                <td>${escapeHtml(h.title)}</td>
                <td class="${h.points > 0 ? 'text-success' : ''}">
                    ${h.points > 0 ? `+${h.points}` : '0'}
                </td>
                <td class="text-right">
                    <button class="btn-icon-delete" onclick="confirmRevoke(${h.id})">
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
        confirmText: 'Yes, Revoke',
        cancelText: 'Cancel',
        onConfirm: async () => {
            const res = await apiPost('/chores/api/revoke', { id: choreId });
            if (res && res.success) {
                showToast('Chore status revoked.', 'success');
                loadState(true);
            }
        }
    });
}

/**
 * --- Global Exposure ---
 */
window.escapeHtml = escapeHtml;
window.switchTab = switchTab;
window.loadState = loadState;
window.confirmClaim = confirmClaim;
window.confirmDeleteChore = confirmDeleteChore;
window.addChore = addChore;
window.triggerQuickAdd = triggerQuickAdd;
window.confirmRevoke = confirmRevoke;
