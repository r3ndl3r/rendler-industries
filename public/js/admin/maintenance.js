// /public/js/admin/maintenance.js

/**
 * Maintenance Task Manager
 *
 * Admin interface for inspecting and controlling the database-driven
 * maintenance task registry. Supports enabling/disabling tasks, adjusting
 * intervals, immediate manual execution, and full CRUD via modal form.
 *
 * Features:
 * - State-driven card grid with 60-second background synchronization.
 * - Inhibited sync during active modal or focused input.
 * - Optimistic last-run display on manual task execution.
 * - Themed confirm modal for destructive operations.
 *
 * Dependencies:
 * - default.js: apiPost, setupGlobalModalClosing, showToast, showConfirmModal, escapeHtml.
 */

'use strict';

const CONFIG = {
    SYNC_INTERVAL_MS: 60000  // Background synchronization frequency (matches maintenance loop cadence)
};

const STATE = { tasks: [] };

/**
 * Formats a unix epoch timestamp as a relative human-readable string.
 *
 * @param {number} epoch - Unix timestamp in seconds (0 = never run)
 * @returns {string}
 */
function formatLastRun(epoch) {
    if (!epoch) return 'Never';
    const diff = Math.floor(Date.now() / 1000) - epoch;
    if (diff < 60)    return 'Just now';
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    const d = new Date(epoch * 1000);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Renders all task cards from STATE.tasks into #taskGrid.
 *
 * @returns {void}
 */
function renderTasks() {
    const grid = document.getElementById('taskGrid');
    if (!grid) return;

    if (!STATE.tasks.length) {
        grid.innerHTML = '<p class="empty-state-msg">No maintenance tasks found.</p>';
        return;
    }

    grid.innerHTML = STATE.tasks.map(task => `
        <div class="task-card glass-panel" data-name="${escapeHtml(task.name)}">
            <div class="task-card-header">
                <div class="task-info">
                    <h3 class="task-label">${escapeHtml(task.label)}</h3>
                    <p class="task-desc">${escapeHtml(task.description || '')}</p>
                    <code class="task-fn">${escapeHtml(task.function_name)}()</code>
                </div>
                <span class="task-status-badge ${task.is_enabled ? 'badge-enabled' : 'badge-disabled'}">${task.is_enabled ? 'enabled' : 'disabled'}</span>
            </div>
            <div class="task-card-body">
                <div class="task-meta-row">
                    <span class="task-last-run">🕐 ${formatLastRun(Number(task.last_run_epoch))}</span>
                    ${Number(task.is_async)   ? '<span class="task-async-badge">async</span>' : ''}
                    ${Number(task.run_last)   ? '<span class="task-run-last-badge">run last</span>' : ''}
                </div>
            </div>
            <div class="task-card-footer modal-actions-center">
                <button class="btn-secondary task-run-btn" onclick="runTask(this.closest('.task-card').dataset.name)">▶ Run Now</button>
                <button class="btn-icon-edit" title="Edit task" onclick="openEditModal(this.closest('.task-card').dataset.name)">✎</button>
                <button class="btn-icon-delete" title="Delete task" onclick="confirmDeleteTask(this.closest('.task-card').dataset.name)">🗑️</button>
            </div>
        </div>
    `).join('');
}

/**
 * Fetches all task configs from the server and re-renders the grid.
 *
 * @async
 * @returns {Promise<void>}
 */
async function loadState(force = false) {
    const anyModalOpen = document.querySelector('.modal-overlay.show');
    const inputFocused = document.activeElement &&
        (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
    if (!force && (anyModalOpen || inputFocused) && STATE.tasks.length > 0) return;

    try {
        const data = await apiGet('/admin/maintenance/api/state');
        if (data && data.success) {
            STATE.tasks = data.tasks || [];
            renderTasks();
        }
    } catch (err) {
        console.error('loadState failed:', err);
    }
}

/**
 * Triggers immediate execution of a task via api/run.
 *
 * @async
 * @param {string} name - Task name key
 * @returns {Promise<void>}
 */
async function runTask(name) {
    const card = Array.from(document.querySelectorAll('.task-card')).find(el => el.dataset.name === name);
    if (!card) return;

    const btn  = card.querySelector('.task-run-btn');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⌛ Running...';

    try {
        const res = await apiPost('/admin/maintenance/api/run', { name });
        if (res && res.success) {
            const lastRunEl = card.querySelector('.task-last-run');
            if (lastRunEl) lastRunEl.textContent = '🕐 Just now';
            const task = STATE.tasks.find(t => t.name === name);
            if (task) task.last_run_epoch = Math.floor(Date.now() / 1000);
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
    }
}

// --- Modal management ---

/**
 * Opens the add/edit modal pre-populated for a new task.
 *
 * @returns {void}
 */
function openAddModal() {
    document.getElementById('taskModalTitle').textContent  = 'Add Task';
    document.getElementById('modalMode').value             = 'add';
    document.getElementById('modalOriginalName').value     = '';
    document.getElementById('modalName').value             = '';
    document.getElementById('modalName').disabled          = false;
    document.getElementById('modalLabel').value            = '';
    document.getElementById('modalFunctionName').value     = '';
    document.getElementById('modalDescription').value      = '';
    document.getElementById('modalInterval').value         = '1';
    document.getElementById('modalIsEnabled').checked      = true;
    document.getElementById('modalIsAsync').checked        = false;
    document.getElementById('modalRunLast').checked        = false;

    const modal = document.getElementById('taskModal');
    modal.classList.add('show');
    document.body.classList.add('modal-open');
}

/**
 * Opens the add/edit modal pre-populated with an existing task's values.
 *
 * @param {string} name - Task name key
 * @returns {void}
 */
function openEditModal(name) {
    const task = STATE.tasks.find(t => t.name === name);
    if (!task) return;

    document.getElementById('taskModalTitle').textContent  = 'Edit Task';
    document.getElementById('modalMode').value             = 'edit';
    document.getElementById('modalOriginalName').value     = name;
    document.getElementById('modalName').value             = task.name;
    document.getElementById('modalName').disabled          = true;
    document.getElementById('modalLabel').value            = task.label || '';
    document.getElementById('modalFunctionName').value     = task.function_name || '';
    document.getElementById('modalDescription').value      = task.description || '';
    document.getElementById('modalInterval').value         = task.interval_minutes || 1;
    document.getElementById('modalIsEnabled').checked      = !!Number(task.is_enabled);
    document.getElementById('modalIsAsync').checked        = !!Number(task.is_async);
    document.getElementById('modalRunLast').checked        = !!Number(task.run_last);

    const modal = document.getElementById('taskModal');
    modal.classList.add('show');
    document.body.classList.add('modal-open');
}

/**
 * Closes the add/edit modal.
 *
 * @returns {void}
 */
function closeTaskModal() {
    const modal = document.getElementById('taskModal');
    modal.classList.remove('show');
    document.body.classList.remove('modal-open');
}

/**
 * Reads modal fields and submits to api/add or api/edit depending on mode.
 *
 * @async
 * @returns {Promise<void>}
 */
async function saveTaskModal() {
    const mode         = document.getElementById('modalMode').value;
    const name         = document.getElementById('modalOriginalName').value || document.getElementById('modalName').value.trim();
    const label        = document.getElementById('modalLabel').value.trim();
    const functionName = document.getElementById('modalFunctionName').value.trim();
    const description  = document.getElementById('modalDescription').value.trim();
    const interval     = parseInt(document.getElementById('modalInterval').value, 10) || 1;
    const isEnabled    = document.getElementById('modalIsEnabled').checked  ? 1 : 0;
    const isAsync      = document.getElementById('modalIsAsync').checked    ? 1 : 0;
    const runLast      = document.getElementById('modalRunLast').checked    ? 1 : 0;

    const newName = document.getElementById('modalName').value.trim();

    if (!newName)        { showToast('Name is required',          'error'); return; }
    if (!label)          { showToast('Label is required',         'error'); return; }
    if (!functionName)   { showToast('Function name is required', 'error'); return; }

    const btn  = document.getElementById('taskModalSaveBtn');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⌛ Saving...';

    const endpoint = mode === 'add' ? '/admin/maintenance/api/add' : '/admin/maintenance/api/edit';
    const payload  = {
        name:             mode === 'add' ? newName : name,
        label,
        function_name:    functionName,
        description,
        interval_minutes: interval,
        is_enabled:       isEnabled,
        is_async:         isAsync,
        run_last:         runLast
    };

    try {
        const res = await apiPost(endpoint, payload);
        if (res && res.success) {
            closeTaskModal();
            await loadState(true);
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
    }
}

/**
 * Shows a confirm modal then deletes the task on confirmation.
 *
 * @param {string} name - Task name key
 * @returns {void}
 */
function confirmDeleteTask(name) {
    const task = STATE.tasks.find(t => t.name === name);
    const label = task ? task.label : name;

    showConfirmModal({
        title:       'Delete Task',
        message:     `Permanently delete <strong>${escapeHtml(label)}</strong>? This cannot be undone.`,
        confirmText: 'Delete',
        danger:      true,
        hideCancel:  true,
        onConfirm:   async () => {
            const res = await apiPost('/admin/maintenance/api/delete', { name });
            if (res && res.success) {
                await loadState(true);
            }
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    loadState();
    setInterval(loadState, CONFIG.SYNC_INTERVAL_MS);
    setupGlobalModalClosing(['taskModal'], [closeTaskModal]);
});

window.runTask           = runTask;
window.openAddModal      = openAddModal;
window.openEditModal     = openEditModal;
window.closeTaskModal    = closeTaskModal;
window.saveTaskModal     = saveTaskModal;
window.confirmDeleteTask = confirmDeleteTask;
