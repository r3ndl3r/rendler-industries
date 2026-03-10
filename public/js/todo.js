// /public/js/todo.js

/**
 * Todo List Controller
 * 
 * Manages the personal Task Management interface.
 * 
 * Features:
 * - List rendering with active and completed task separation
 * - Task creation and description editing
 * - Task completion toggling
 * - Automatic background synchronization
 * - Modal-driven deletion and batch cleanup
 * 
 * Dependencies:
 * - default.js: For apiPost, getIcon, setupGlobalModalClosing, and modal helpers
 * - toast.js: For notification feedback
 */

/**
 * --- Module Configuration & State ---
 */
const CONFIG = {
    SYNC_INTERVAL_MS: 300000
};

let STATE = {
    todos: []
};

/**
 * Initializes the module by fetching the task roster and binding event handlers.
 * 
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', () => {
    loadState();

    const taskInput = document.getElementById('taskInput');
    if (taskInput) {
        taskInput.focus();

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

    setupGlobalModalClosing(['modal-overlay'], [closeEditModal]);

    setInterval(loadState, CONFIG.SYNC_INTERVAL_MS);
});

/**
 * --- Logic & UI Operations ---
 */

/**
 * Synchronizes the task collection from the server.
 * 
 * @async
 * @returns {Promise<void>}
 */
async function loadState() {
    // Skip background refresh if a modal is active to prevent overwriting user input.
    const anyModalOpen = document.querySelector('.modal-overlay.active');
    if (anyModalOpen && STATE.todos.length > 0) return;

    try {
        const response = await fetch('/todo/api/state');
        const data = await response.json();
        
        if (data && data.success) {
            STATE.todos = data.todos;
            renderTable();
        } else if (data && data.error) {
            console.error('State Synchronization Error:', data.error);
        }
    } catch (err) {
        console.error('Network failure during state synchronization:', err);
    }
}

/**
 * Generates the task display groups based on current state.
 * 
 * @returns {void}
 */
function renderTable() {
    const container = document.getElementById('todoListContainer');
    if (!container) return;

    if (STATE.todos.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>${getIcon('empty')} Your todo list is empty!</p>
                <p class="empty-hint">Add your first task above to get started.</p>
            </div>`;
        return;
    }

    const sorted = [...STATE.todos].sort((a, b) => {
        if (a.is_completed !== b.is_completed) return a.is_completed - b.is_completed;
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });

    const active = sorted.filter(t => !t.is_completed);
    const completed = sorted.filter(t => t.is_completed);

    let html = '';

    if (active.length > 0) {
        html += `<h3 class="section-title">Active Tasks</h3>`;
        html += active.map(todo => renderTodoRow(todo)).join('');
    }

    if (completed.length > 0) {
        html += `
            <div class="completed-section">
                <div class="completed-header">
                    <h3 class="section-title">Completed</h3>
                    <button type="button" class="btn-clear-all" onclick="openClearCompletedModal()">${getIcon('reset')} Clear All</button>
                </div>
                ${completed.map(todo => renderTodoRow(todo)).join('')}
            </div>`;
    }

    container.innerHTML = html;
}

/**
 * Renders the markup for a single task record.
 * 
 * @param {Object} todo - Task record details.
 * @returns {string} - Rendered HTML fragment.
 */
function renderTodoRow(todo) {
    const isCompleted = !!todo.is_completed;
    const nameEscaped = escapeHtml(todo.task_name);

    return `
        <div class="todo-item ${isCompleted ? 'completed' : ''}" data-id="${todo.id}">
            <div class="item-content">
                <button type="button" class="checkbox-btn ${isCompleted ? 'completed' : ''}" 
                        onclick="toggleTodo(${todo.id})" title="${isCompleted ? 'Re-open Task' : 'Complete Task'}">
                    <span class="checkmark">${isCompleted ? getIcon('check') : ''}</span>
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
                <button type="button" class="btn-icon-delete" onclick="confirmDeleteTodo(${todo.id})" title="Remove Task">
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
 * Submits a new task and updates the display list.
 * 
 * @async
 * @param {Event} event - Form submission event.
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
 * Updates the completion status of a specific task.
 * 
 * @async
 * @param {number} id - Record identifier.
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
 * Displays the editor for a specific task record.
 * 
 * @param {number} id - Record identifier.
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
        modal.classList.add('active');
        document.body.classList.add('modal-open');
        
        input.focus();
        input.style.height = 'auto';
        input.style.height = (input.scrollHeight) + 'px';
    }
}

/**
 * Dismisses the editor interface.
 * 
 * @returns {void}
 */
function closeEditModal() {
    const modal = document.getElementById('editModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.classList.remove('modal-open');
    }
}

/**
 * Saves modifications to a task description.
 * 
 * @async
 * @param {Event} event - Form submission event.
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
 * Initiates the deletion confirmation flow for a task.
 * 
 * @param {number} id - Record identifier.
 * @returns {void}
 */
function confirmDeleteTodo(id) {
    const todo = STATE.todos.find(t => t.id == id);
    if (!todo) return;

    showConfirmModal({
        title: 'Delete Task',
        message: `Are you sure you want to remove \"<strong>${escapeHtml(todo.task_name)}</strong>\"?`,
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
 * Initiates the removal of all completed task records.
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
 * Escapes reserved characters for safe HTML injection.
 * 
 * @param {string} text - Raw content.
 * @returns {string} - Sanitized string.
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
