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
 * - default.js: For apiPost, showToast, and modal helpers
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
    child_balances: [],
    pending_submissions: [],
    my_submissions: []
};
let choresStateRequestSeq = 0;
let mySubmissionsRequestSeq = 0;

/**
 * Bootstraps the module state and establishes event delegation.
 * 
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    loadMySubmissions();
    setInterval(() => { loadState(); loadMySubmissions(); }, CONFIG.SYNC_INTERVAL_MS);
    setupGlobalModalClosing(['modal-overlay'], [closeAddModal, closeSubmitModal, closeReviewModal]);
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
        const requestSeq = ++choresStateRequestSeq;
        const data = await apiGet('/chores/api/state');
        if (requestSeq !== choresStateRequestSeq) return;
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
 * Fetches the current child's submission history.
 *
 * @async
 * @param {boolean} force - If true, bypasses inhibition checks.
 * @returns {Promise<void>}
 */
async function loadMySubmissions(force = false) {
    const anyModalOpen = document.querySelector('.modal-overlay.show') || document.querySelector('.delete-modal-overlay.show');
    const inputFocused = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
    if (!force && (anyModalOpen || inputFocused)) return;

    try {
        const requestSeq = ++mySubmissionsRequestSeq;
        const data = await apiGet('/chores/api/my_submissions');
        if (requestSeq !== mySubmissionsRequestSeq) return;
        if (data && data.success) {
            STATE.my_submissions = data.submissions || [];
            renderMySubmissions();
        }
    } catch (err) {
        console.error("loadMySubmissions failed:", err);
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
        statsCon.innerHTML = `⭐ <span>${STATE.current_points} pts</span>`;
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
        renderPendingSubmissions();
    } else if (STATE.is_child) {
        if (childView) childView.classList.remove('hidden');
        if (adminView) adminView.classList.add('hidden');
        if (noAccessView) noAccessView.classList.add('hidden');
        if (adminActions) adminActions.classList.add('hidden');
        const childSubmitActions = document.getElementById('childSubmitActions');
        if (childSubmitActions) childSubmitActions.classList.remove('hidden');
        renderChores();
        renderUserBalances();
        renderMySubmissions();
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
                <div class="empty-state-icon">😊</div>
                <p>No Chores Pending</p>
                <div class="empty-hint">Everything is clean! The board is currently clear.</div>
            </div>
        `;
        return;
    }

    grid.innerHTML = STATE.active_chores.map(c => {
        const isTargeted = !!c.assigned_to;
        const iconHtml = isTargeted ? window.getUserIcon(c.assigned_username) : '🌍';
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
                            ${STATE.is_admin ? `<button class="btn-icon-delete" title="Delete Chore" onclick="confirmDeleteChore(${c.id}, ${escapeHtml(JSON.stringify(c.title || ''))})">🗑️</button>` : ''}
                        </div>
                    </div>
                </div>
                ${STATE.is_child ? `
                <button class="btn-chore-claim" 
                    onclick="confirmClaim(${c.id}, ${escapeHtml(JSON.stringify(c.title || ''))}, ${Number(c.points) || 0})">
                    ✅ I Finished This! <span class="btn-points-tag">Points: ${c.points}</span>
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
    const safeTitle = escapeHtml(title || '');
    const safePoints = Number(points) || 0;
    showConfirmModal({
        title: 'Chore Completion',
        message: `Confirm that you completed "<strong>${safeTitle}</strong>"?<br><br>Rewards: ${safePoints > 0 ? `<span class="text-success">${safePoints} pts</span>` : 'no points'}.`,
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
    const safeTitle = escapeHtml(title || '');
    showConfirmModal({
        title: 'Delete Chore',
        message: `Permanently delete "<strong>${safeTitle}</strong>"?`,
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
                await loadState(true);
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
/**
 * Checks whether any chores or global confirmation modal is currently visible.
 * Used to prevent premature body-scroll unlock when modals are layered.
 * @returns {boolean} True if at least one chores/global modal has the 'show' class.
 */
function hasOpenChoresModal() {
    return !!document.querySelector([
        '#addChoreModal.show',
        '#submitWorkModal.show',
        '#reviewSubmissionModal.show',
        '#globalConfirmActionModal.show'
    ].join(', '));
}

function closeAddModal() {
    const modal = document.getElementById('addChoreModal');
    if (modal) {
        modal.classList.remove('show');
        if (!hasOpenChoresModal()) document.body.classList.remove('modal-open');
    }
}

/**
 * Opens the "Submit My Work" modal.
 *
 * @returns {void}
 */
function openSubmitModal() {
    const modal = document.getElementById('submitWorkModal');
    if (modal) {
        modal.classList.add('show');
        document.body.classList.add('modal-open');
    }
}

/**
 * Closes the "Submit My Work" modal and resets the form.
 *
 * @returns {void}
 */
function closeSubmitModal() {
    const modal = document.getElementById('submitWorkModal');
    if (modal) {
        modal.classList.remove('show');
        if (!hasOpenChoresModal()) document.body.classList.remove('modal-open');
    }
    const form = document.getElementById('submitWorkForm');
    if (form) form.reset();
}

/**
 * Handles the "Submit My Work" form submission including file uploads.
 *
 * @async
 * @param {Event} e - Form submit event
 * @returns {Promise<void>}
 */
async function submitWork(e) {
    if (e) e.preventDefault();
    const form = e.target;
    const btn  = document.getElementById('submitWorkBtn');
    const originalHtml = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = '⌛ Submitting...';

    try {
        const formData = new FormData(form);
        const res = await apiPost('/chores/api/submit', formData);
        if (res && res.success) {
            closeSubmitModal();
            await loadMySubmissions(true);
        } else if (res) {
            showToast(res.error || 'Submission failed', 'error');
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Opens the review modal for a pending submission, rendering photos from STATE.
 *
 * @param {number} submissionId - chore_submissions.id
 * @returns {void}
 */
function openReviewModal(submissionId) {
    const modal = document.getElementById('reviewSubmissionModal');
    const body  = document.getElementById('reviewModalBody');
    if (!modal || !body) return;

    const sub = STATE.pending_submissions.find(s => s.id === submissionId);
    if (!sub) {
        body.innerHTML = `<p class="text-center">Submission not found.</p>`;
        modal.classList.add('show');
        document.body.classList.add('modal-open');
        return;
    }

    const beforeSrc = sub.before_photo_id ? `/chores/serve/${sub.before_photo_id}` : '';
    const afterSrc  = sub.after_photo_id  ? `/chores/serve/${sub.after_photo_id}`  : '';

    body.innerHTML = `
        <p class="review-modal-meta">
            ${escapeHtml(sub.username)} — ${format_datetime(sub.submitted_at)}
        </p>
        <div class="review-description">${escapeHtml(sub.description)}</div>
        <div class="review-photo-grid">
            <div class="review-photo-cell">
                <div class="review-photo-label">Before</div>
                ${beforeSrc ? `<img class="review-photo-img" src="${beforeSrc}" alt="Before Photo">` : '<p class="review-photo-unavailable">Photo unavailable</p>'}
            </div>
            <div class="review-photo-cell">
                <div class="review-photo-label">After</div>
                ${afterSrc ? `<img class="review-photo-img" src="${afterSrc}" alt="After Photo">` : '<p class="review-photo-unavailable">Photo unavailable</p>'}
            </div>
        </div>
        <div class="review-points-row">
            <label>⭐ Points to Award</label>
            <input type="number" id="reviewPoints" class="game-input-premium no-emoji review-points-input" min="1" placeholder="e.g. 10">
        </div>
        <div class="review-comment-row">
            <label>Comment (required for rejection)</label>
            <textarea id="reviewComment" class="game-input-premium no-emoji" rows="2" placeholder="Optional for approval, required for rejection"></textarea>
        </div>
        <div class="modal-actions modal-actions-center review-modal-actions">
            <button class="btn-premium-action-shrink" onclick="confirmApprove(${submissionId})">✅ Approve</button>
            <button class="btn-premium-action-shrink btn-danger-action" onclick="confirmReject(${submissionId})">❌ Reject</button>
        </div>
    `;

    modal.classList.add('show');
    document.body.classList.add('modal-open');
}

/**
 * Closes the review modal.
 *
 * @returns {void}
 */
function closeReviewModal() {
    const modal = document.getElementById('reviewSubmissionModal');
    if (modal) {
        modal.classList.remove('show');
        if (!hasOpenChoresModal()) document.body.classList.remove('modal-open');
    }
}

/**
 * Confirms and sends an approval for a pending submission.
 *
 * @param {number} submissionId - chore_submissions.id
 * @returns {void}
 */
function confirmApprove(submissionId) {
    const points = parseInt(document.getElementById('reviewPoints')?.value || '0', 10);
    if (!points || points < 1) {
        showToast('Enter a points value greater than 0 to approve.', 'error');
        return;
    }
    const comment = document.getElementById('reviewComment')?.value || '';

    showConfirmModal({
        title: 'Approve Submission',
        message: `Award <strong>${points} points</strong> and approve this submission?`,
        confirmText: 'Approve',
        hideCancel: true,
        onConfirm: async () => {
            const res = await apiPost('/chores/api/approve', { id: submissionId, points, comment });
            if (res && res.success) {
                showToast('Submission approved and points awarded!', 'success');
                closeReviewModal();
                await loadState(true);
            } else {
                await loadState(true);
            }
        }
    });
}

/**
 * Confirms and sends a rejection for a pending submission.
 *
 * @param {number} submissionId - chore_submissions.id
 * @returns {void}
 */
function confirmReject(submissionId) {
    const comment = document.getElementById('reviewComment')?.value?.trim() || '';
    if (!comment) {
        showToast('A reason is required when rejecting a submission.', 'error');
        return;
    }

    showConfirmModal({
        title: 'Reject Submission',
        message: `Reject this submission and notify the child with your feedback?`,
        confirmText: 'Reject',
        danger: true,
        hideCancel: true,
        onConfirm: async () => {
            const res = await apiPost('/chores/api/reject', { id: submissionId, comment });
            if (res && res.success) {
                showToast('Submission rejected. Child notified.', 'success');
                closeReviewModal();
                await loadState(true);
            } else {
                await loadState(true);
            }
        }
    });
}

/**
 * Fills the "Add Chore" dropdown targeting children.
 * 
 * @returns {void}
 */
function populateAssignedSelect() {
    const select = document.getElementById('assignedToSelect');
    if (!select) return;

    const baseOpt = `<option value="">🏠 Family Pool</option>`;
    const children = STATE.all_users.filter(u => u.is_child && !u.is_admin);

    select.innerHTML = baseOpt + children.map(c =>
        `<option value="${c.id}">${window.getUserIcon(c.username)} ${escapeHtml(c.username)}</option>`
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
    btn.innerHTML = `⏳ Posting...`;
    
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
        container.innerHTML = `<div class="component-loading"><span class="loading-icon-pulse">⌛</span></div>`;
        return;
    }

    container.innerHTML = STATE.quick_add_chores.map(c => {
        const iconHtml = c.assigned_username ? window.getUserIcon(c.assigned_username) : '🌍';
        return `
            <div class="repost-item" title="${escapeHtml(c.title)}" onclick="fillChoreForm(${escapeHtml(JSON.stringify(c.title || ''))}, ${Number(c.points) || 0}, ${escapeHtml(JSON.stringify(c.assigned_to || ''))})">
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
                <td>
                    <div class="audit-user">
                        <span>${window.getUserIcon(u.username)}</span>
                        <span>${escapeHtml(u.username)}</span>
                    </div>
                </td>
                <td class="${sum > 0 ? 'text-success' : ''}"><strong>${sum}</strong> <small>pts</small></td>
            </tr>
        `;
    }).join('');
}

/**
 * Renders the child's own submission history cards below the bounty board.
 *
 * @returns {void}
 */
function renderMySubmissions() {
    const section = document.getElementById('mySubmissionsSection');
    const list    = document.getElementById('mySubmissionsList');
    if (!section || !list) return;

    if (!STATE.is_child || STATE.is_admin) {
        section.classList.add('hidden');
        return;
    }

    if (STATE.my_submissions.length === 0) {
        section.classList.add('hidden');
        return;
    }

    section.classList.remove('hidden');
    list.innerHTML = STATE.my_submissions.map(s => {
        const desc = s.description || '';
        const badgeClass = s.status === 'pending' ? 'pending' : (s.status === 'approved' ? 'approved' : 'rejected');
        const badgeText  = s.status === 'pending'
            ? '⏳ Pending Review'
            : (s.status === 'approved' ? `✅ Approved — ${s.points_awarded} pts` : (s.status === 'rejected' ? '❌ Rejected' : `❓ ${s.status}`));

        return `
            <div class="submission-card">
                <div class="submission-card-body">
                    <div class="submission-card-desc">${escapeHtml(desc)}</div>
                    <div class="submission-card-meta">${format_datetime(s.submitted_at)}</div>
                </div>
                <span class="submission-status-badge ${badgeClass}">${badgeText}</span>
            </div>
        `;
    }).join('');
}

/**
 * Renders the admin pending submissions table and toggles panel visibility.
 *
 * @returns {void}
 */
function renderPendingSubmissions() {
    const panel = document.getElementById('pendingSubmissionsPanel');
    const tbody = document.getElementById('pendingSubmissionsTable');
    if (!panel || !tbody) return;

    if (!STATE.pending_submissions || STATE.pending_submissions.length === 0) {
        panel.classList.add('hidden');
        return;
    }

    panel.classList.remove('hidden');
    tbody.innerHTML = STATE.pending_submissions.map(s => {
        const desc = s.description || '';
        const excerpt = desc.length > 55 ? desc.substring(0, 52) + '...' : desc;
        return `
            <tr>
                <td data-label="User" class="col-user">
                    <span class="audit-user">${window.getUserIcon(s.username)} ${escapeHtml(s.username)}</span>
                </td>
                <td data-label="Time" class="col-time"><small>${format_datetime(s.submitted_at)}</small></td>
                <td data-label="Task" class="col-task">${escapeHtml(excerpt)}</td>
                <td class="text-right col-actions">
                    <button class="btn-icon-view" title="Review Submission" onclick="openReviewModal(${s.id})">🔍</button>
                </td>
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
        const userIcon = window.getUserIcon(h.completed_by_name?.toLowerCase());
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
                    ${h.source !== 'submission' ? `<button class="btn-icon-delete" title="Revoke Completion" onclick="confirmRevoke(${h.id})">🗑️</button>` : ''}
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
                await loadState(true);
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
window.openSubmitModal = openSubmitModal;
window.closeSubmitModal = closeSubmitModal;
window.submitWork = submitWork;
window.openReviewModal = openReviewModal;
window.closeReviewModal = closeReviewModal;
window.confirmApprove = confirmApprove;
window.confirmReject = confirmReject;
