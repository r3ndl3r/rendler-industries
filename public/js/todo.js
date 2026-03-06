// /public/js/todo.js

/**
 * Todo List Controller
 * 
 * Manages the personal Task Management interface using a state-driven 
 * architecture. It provides a 100% AJAX-driven SPA experience with 
 * optimistic UI updates and real-time synchronization.
 * 
 * Features:
 * - State-driven task rendering (Active vs. Completed)
 * - Optimistic UI updates for creation and completion
 * - Automatic background synchronization every 5 minutes
 * - Mandatory Action pattern for modifications (No Cancel buttons)
 * - Lifecycle-aware button state management for network flight indicators
 * - Auto-expanding textareas for rapid multi-line entry
 * 
 * Dependencies:
 * - default.js: For apiPost, getIcon, setupGlobalModalClosing, and modal helpers
 * - toast.js: For notification feedback
 */

/**
 * --- Module Configuration & State ---
 */
const CONFIG = {
    SYNC_INTERVAL_MS: 300000         // Background synchronization frequency
};

let STATE = {
    todos: []                       // Collection of {id, task_name, is_completed, created_at}
};

/**
 * Bootstraps the module state and establishes event delegation.
 * 
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', () => {
    // Initial fetch of the todo roster
    loadState();

    const taskInput = document.getElementById('taskInput');
    if (taskInput) {
        taskInput.focus();

        // Behavior: Auto-resize and key handlers for rapid task entry
        taskInput.oninput = function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
        };

        taskInput.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleAddTodo(e);
            }
        };
    }

    const editName = document.getElementById('editName');
    if (editName) {
        editName.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleEditSubmit(e);
            }
        };
    }

    // Global modal behavior
    setupGlobalModalClosing(['modal-overlay'], [closeEditModal]);

    // Background synchronization
    setInterval(loadState, CONFIG.SYNC_INTERVAL_MS);
});

/**
 * --- Logic & UI Operations ---
 */

/**
 * Synchronizes the module state with the server (Single Source of Truth).
 * 
 * @async
 * @returns {Promise<void>}
 */
async function loadState() {
    try {
        const response = await fetch('/todo/api/state');
        const data = await response.json();
        
        if (data && data.success) {
            STATE.todos = data.todos;
            renderTable();
        }
    } catch (err) {
        console.error('loadState failed:', err);
    }
}

/**
 * Orchestrates the sorting and generation of the todo list categories.
 * 
 * @returns {void}
 */
function renderTable() {
    const container = document.getElementById('todoListContainer');
    if (!container) return;

    if (STATE.todos.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>📭 Your todo list is empty!</p>
                <p class="empty-hint">Add your first task above to get started.</p>
            </div>`;
        return;
    }

    // Sorting Logic: Incomplete first, then by creation date (newest first)
    const sorted = [...STATE.todos].sort((a, b) => {
        if (a.is_completed !== b.is_completed) return a.is_completed - b.is_completed;
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });

    const active = sorted.filter(t => !t.is_completed);
    const completed = sorted.filter(t => t.is_completed);

    let html = '';

    // Active Section
    if (active.length > 0) {
        html += `<h3 class="section-title">Active Tasks</h3>`;
        html += active.map(todo => renderTodoRow(todo)).join('');
    }

    // Completed Section
    if (completed.length > 0) {
        html += `
            <div class="completed-section">
                <div class="completed-header">
                    <h3 class="section-title">Completed</h3>
                    <button type="button" class="btn-clear-all" onclick="openClearCompletedModal()">Clear All</button>
                </div>
                ${completed.map(todo => renderTodoRow(todo)).join('')}
            </div>`;
    }

    container.innerHTML = html;
}

/**
 * Generates the HTML fragment for a single todo row.
 * 
 * @param {Object} todo - Task record metadata.
 * @returns {string} - Rendered HTML row.
 */
function renderTodoRow(todo) {
    const isCompleted = !!todo.is_completed;
    const nameEscaped = escapeHtml(todo.task_name);

    return `
        <div class="todo-item ${isCompleted ? 'completed' : ''}" data-id="${todo.id}">
            <div class="item-content">
                <button type="button" class="checkbox-btn ${isCompleted ? 'completed' : ''}" 
                        onclick="toggleTodo(${todo.id})" title="${isCompleted ? 'Re-open Task' : 'Complete Task'}">
                    <span class="checkmark">${isCompleted ? '✓' : ''}</span>
                </button>
                <div class="item-details">
                    <span class="item-name">${nameEscaped}</span>
                </div>
            </div>
            <div class="action-buttons">
                ${!isCompleted ? `
                    <button type="button" class="btn-icon-edit" onclick="openEditModal(${todo.id})" title="Edit Task">
                        ${getIcon('edit')}
                    </button>
                ` : ''}
                <button type="button" class="btn-icon-delete" onclick="confirmDeleteTodo(${todo.id}, \`${todo.task_name.replace(/`/g, "\\`")}\`)" title="Remove Task">
                    ${getIcon('delete')}
                </button>
            </div>
        </div>
    `;
}

/**
 * --- Interactive Handlers ---
 */

/**
 * Submits a new task to the collection.
 * Performs an optimistic UI update upon success.
 * 
 * @async
 * @param {Event} event - Triggering form event.
 * @returns {Promise<void>}
 */
async function handleAddTodo(event) {
    if (event) event.preventDefault();

    const input = document.getElementById('taskInput');
    const task_name = input.value.trim();
    if (!task_name) return;

    const btn = document.getElementById('addTaskBtn');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Adding...`;

    try {
        const result = await apiPost('/todo/api/add', { task_name: task_name });
        if (result && result.success) {
            input.value = '';
            input.style.height = 'auto';
            // Optimistic update
            STATE.todos.unshift({
                id: result.id,
                task_name: result.task_name,
                is_completed: 0,
                created_at: new Date().toISOString()
            });
            renderTable();
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Updates task completion status.
 * Reconciles local state immediately upon success.
 * 
 * @async
 * @param {number} id - Target identifier.
 * @returns {Promise<void>}
 */
async function toggleTodo(id) {
    const row = document.querySelector(`.todo-item[data-id="${id}"]`);
    if (row) row.classList.add('pending');

    const result = await apiPost(`/todo/api/toggle/${id}`);
    if (result && result.success) {
        const todo = STATE.todos.find(t => t.id == id);
        if (todo) {
            todo.is_completed = !todo.is_completed;
            renderTable();
        }
    } else if (row) {
        row.classList.remove('pending');
    }
}

/**
 * Pre-fills and displays the task editor.
 * 
 * @param {number} id - Target identifier.
 * @returns {void}
 */
function openEditModal(id) {
    const todo = STATE.todos.find(t => t.id == id);
    if (!todo) return;

    document.getElementById('editId').value = id;
    const input = document.getElementById('editName');
    if (input) {
        input.value = todo.task_name;
        const modal = document.getElementById('editModal');
        modal.style.display = 'flex';
        document.body.classList.add('modal-open');
        
        input.focus();
        input.style.height = 'auto';
        input.style.height = (input.scrollHeight) + 'px';
    }
}

/**
 * Hides the editor modal.
 * 
 * @returns {void}
 */
function closeEditModal() {
    const modal = document.getElementById('editModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.classList.remove('modal-open');
    }
}

/**
 * Executes persistent modifications to a task description.
 * 
 * @async
 * @param {Event} event - Triggering form event.
 * @returns {Promise<void>}
 */
async function handleEditSubmit(event) {
    if (event) event.preventDefault();

    const id = document.getElementById('editId').value;
    const input = document.getElementById('editName');
    const name = input.value.trim();
    if (!name) return;

    const btn = document.getElementById('editSaveBtn');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Saving...`;

    try {
        const result = await apiPost(`/todo/api/edit/${id}`, { task_name: name });
        if (result && result.success) {
            const todo = STATE.todos.find(t => t.id == id);
            if (todo) todo.task_name = name;
            renderTable();
            closeEditModal();
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Orchestrates the deletion flow for a specific task.
 * 
 * @param {number} id - Target identifier.
 * @param {string} taskName - Display label for context.
 * @returns {void}
 */
function confirmDeleteTodo(id, taskName) {
    showConfirmModal({
        title: 'Delete Task',
        message: `Are you sure you want to remove \"<strong>${escapeHtml(taskName)}</strong>\"?`,
        danger: true,
        confirmText: 'Delete',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const result = await apiPost(`/todo/api/delete/${id}`);
            if (result && result.success) {
                STATE.todos = STATE.todos.filter(t => t.id != id);
                renderTable();
            }
        }
    });
}

/**
 * Orchestrates the batch deletion of completed tasks.
 * 
 * @returns {void}
 */
function openClearCompletedModal() {
    showConfirmModal({
        title: 'Clear Completed',
        message: 'Are you sure you want to clear all completed tasks?',
        danger: true,
        confirmText: 'Clear All',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const result = await apiPost('/todo/api/clear');
            if (result && result.success) {
                STATE.todos = STATE.todos.filter(t => !t.is_completed);
                renderTable();
            }
        }
    });
}

/**
 * Sanitizes input for safe DOM injection.
 * 
 * @param {string} text - Raw input.
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
window.loadState = loadState;
window.toggleTodo = toggleTodo;
window.confirmDeleteTodo = confirmDeleteTodo;
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
window.handleEditSubmit = handleEditSubmit;
window.handleAddTodo = handleAddTodo;
window.openClearCompletedModal = openClearCompletedModal;
