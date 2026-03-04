// /public/js/todo.js

/**
 * Todo List Controller Module
 * 
 * This module manages the 100% AJAX-based Task Management interface. 
 * It implements a state-driven architecture with optimistic UI updates
 * to ensure a seamless and responsive user experience.
 * 
 * Features:
 * - Real-time task synchronization with server state
 * - Optimistic UI updates for creation and completion
 * - Sorted view (Active first by date, then Completed)
 * - Mandatory Action pattern for editing and batch deletion (No Cancel buttons)
 * - Lifecycle-aware button state management to prevent "stuck" indicators
 * - Mobile-optimized touch targets for task toggling
 * 
 * Dependencies:
 * - default.js: For apiPost, getLoadingHtml, getIcon, setupGlobalModalClosing, and modal helpers
 * - toast.js: For notification feedback
 */

/**
 * Application State
 * Master data store synchronized with the server-side source of truth
 */
let appState = {
    todos: []                       // Array of todo objects {id, task_name, is_completed, created_at}
};

/**
 * Initialization System
 * Sets up initial state, event delegation, and global modal behavior
 */
document.addEventListener('DOMContentLoaded', () => {
    // Bootstrap initial data collection from server
    loadState();

    const taskInput = document.getElementById('taskInput');
    if (taskInput) {
        taskInput.focus();

        // Behavior: Auto-resize and key handlers for rapid task entry
        taskInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
        });

        taskInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                addTodo();
            }
        });
    }

    const editName = document.getElementById('editName');
    if (editName) {
        editName.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitEdit();
            }
        });
    }

    // Attach form submission handler
    const addForm = document.getElementById('addTodoForm');
    if (addForm) {
        addForm.addEventListener('submit', (e) => {
            e.preventDefault();
            addTodo();
        });
    }

    // Configure unified modal closing behavior for all overlays
    setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay'], [
        closeEditModal, closeConfirmModal
    ]);
});

/**
 * State Management: loadState
 * Fetches the complete todo collection and triggers re-render.
 * 
 * @returns {Promise<void>}
 */
async function loadState() {
    const container = document.getElementById('todoListContainer');
    
    // Display loading skeleton on initial fetch only to minimize UI jitter
    if (container && appState.todos.length === 0) {
        container.innerHTML = getLoadingHtml('Syncing tasks...');
    }

    try {
        const response = await fetch('/todo/api/state');
        const data = await response.json();
        
        // Update local state and refresh UI
        appState.todos = data.todos;
        renderTodoItems();
    } catch (err) {
        console.error('Failed to load todo state:', err);
        showToast('Connection error. Failed to sync tasks.', 'error');
    }
}

/**
 * UI Engine: renderTodoItems
 * Orchestrates the sorting and generation of the todo list HTML.
 */
function renderTodoItems() {
    const container = document.getElementById('todoListContainer');
    if (!container) return;

    // Handle empty list scenario
    if (appState.todos.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>📭 Your todo list is empty!</p>
                <p class="empty-hint">Add your first task above to get started.</p>
            </div>`;
        return;
    }

    // Sorting Logic: 
    // 1. Completion status (Incomplete first)
    // 2. Creation date (Newest first)
    const sortedTodos = [...appState.todos].sort((a, b) => {
        if (a.is_completed !== b.is_completed) return a.is_completed - b.is_completed;
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });

    const active = sortedTodos.filter(t => !t.is_completed);
    const completed = sortedTodos.filter(t => t.is_completed);

    let html = '';

    // Render Active Tasks section
    if (active.length > 0) {
        html += `<h3 class="section-title">Active Tasks</h3>`;
        active.forEach(todo => {
            html += renderTodoItem(todo);
        });
    }

    // Render Completed section with batch clear action
    if (completed.length > 0) {
        html += `
            <div class="completed-section">
                <div class="completed-header">
                    <h3 class="section-title">Completed</h3>
                    <button type="button" class="btn-clear-all" onclick="openClearCompletedModal()">Clear All</button>
                </div>`;
        completed.forEach(todo => {
            html += renderTodoItem(todo);
        });
        html += `</div>`;
    }

    container.innerHTML = html;
}

/**
 * UI Component: renderTodoItem
 * Generates the HTML fragment for a single todo row.
 * 
 * @param {Object} todo - The task object to render
 * @returns {string} - Rendered HTML string
 */
function renderTodoItem(todo) {
    const isCompleted = !!todo.is_completed;
    return `
        <div class="todo-item ${isCompleted ? 'completed' : ''}" data-id="${todo.id}">
            <div class="item-content">
                <button class="checkbox-btn ${isCompleted ? 'completed' : ''}" onclick="toggleTodo(${todo.id})" title="${isCompleted ? 'Re-open Task' : 'Complete Task'}">
                    <span class="checkmark">${isCompleted ? '✓' : ''}</span>
                </button>
                <div class="item-details">
                    <span class="item-name">${escapeHtml(todo.task_name)}</span>
                </div>
            </div>
            <div class="action-buttons">
                ${!isCompleted ? `
                    <button class="btn-icon-edit" onclick="openEditModal(${todo.id})" title="Edit">
                        ${getIcon('edit')}
                    </button>
                ` : ''}
                <button class="btn-icon-delete" onclick="deleteTodo(${todo.id})" title="Delete">
                    ${getIcon('delete')}
                </button>
            </div>
        </div>
    `;
}

/**
 * Action: addTodo
 * Submits a new task to the server and performs an optimistic UI update.
 * 
 * @returns {Promise<void>}
 */
async function addTodo() {
    const input = document.getElementById('taskInput');
    const task_name = input.value.trim();
    if (!task_name) return;

    // UI Feedback: disable button and show loading state
    const btn = document.querySelector('#addTodoForm .btn-blue-add');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Adding...`;

    const result = await apiPost('/todo/add', { task_name: task_name });
    
    // Lifecycle Cleanup: restore button state
    btn.disabled = false;
    btn.innerHTML = originalHtml;

    if (result && result.success) {
        input.value = '';
        input.style.height = 'auto'; // Reset height for auto-expanding textarea
        // Perform optimistic update to local state
        appState.todos.unshift({
            id: result.id,
            task_name: result.task_name,
            is_completed: 0,
            created_at: new Date().toISOString()
        });
        renderTodoItems();
    }
}

/**
 * Action: toggleTodo
 * Updates task completion status on server and local state.
 * 
 * @param {number} id - Target Task ID
 * @returns {Promise<void>}
 */
async function toggleTodo(id) {
    const itemEl = document.querySelector(`.todo-item[data-id="${id}"]`);
    if (itemEl) itemEl.classList.add('pending'); // Visual feedback during network flight

    const result = await apiPost(`/todo/toggle/${id}`);
    if (result && result.success) {
        const todo = appState.todos.find(t => t.id == id);
        if (todo) {
            todo.is_completed = !todo.is_completed;
            renderTodoItems();
        }
    } else if (itemEl) {
        itemEl.classList.remove('pending');
    }
}

/**
 * Action: deleteTodo
 * Orchestrates the Mandatory Action deletion flow for a specific task.
 * 
 * @param {number} id - Target Task ID
 */
async function deleteTodo(id) {
    const todo = appState.todos.find(t => t.id == id);
    if (!todo) return;

    showConfirmModal({
        title: 'Delete Task',
        message: `Are you sure you want to remove \"<strong>${escapeHtml(todo.task_name)}</strong>\"?`,
        danger: true,
        confirmText: 'Delete',
        hideCancel: true,
        alignment: 'center',
        loadingText: 'Deleting...',
        onConfirm: async () => {
            const result = await apiPost(`/todo/delete/${id}`);
            if (result && result.success) {
                appState.todos = appState.todos.filter(t => t.id != id);
                renderTodoItems();
            }
        }
    });
}

/**
 * Modal: openEditModal
 * Pre-fills and displays the task editing interface.
 * 
 * @param {number} id - Target Task ID
 */
window.openEditModal = function(id) {
    const todo = appState.todos.find(t => t.id == id);
    if (!todo) return;

    document.getElementById('editId').value = id;
    const editName = document.getElementById('editName');
    if (editName) {
        editName.value = todo.task_name;
        document.getElementById('editModal').classList.add('show');
        
        editName.focus();
        // Logic: Auto-expand height to match existing multi-line content
        editName.style.height = 'auto';
        editName.style.height = (editName.scrollHeight) + 'px';
    }
};

/**
 * Modal: closeEditModal
 * Hides the task editing interface.
 */
window.closeEditModal = function() {
    document.getElementById('editModal').classList.remove('show');
};

/**
 * Action: submitEdit
 * Submits modified task description to server.
 * 
 * @returns {Promise<void>}
 */
async function submitEdit() {
    const id = document.getElementById('editId').value;
    const nameInput = document.getElementById('editName');
    const name = nameInput ? nameInput.value.trim() : '';
    if (!name) return;

    // UI Feedback: disable button during processing
    const btn = document.querySelector('#editModal .btn-primary');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Saving...`;

    const result = await apiPost(`/todo/edit/${id}`, { task_name: name });
    
    // Lifecycle Cleanup: Restore state
    btn.disabled = false;
    btn.innerHTML = originalHtml;

    if (result && result.success) {
        const todo = appState.todos.find(t => t.id == id);
        if (todo) todo.task_name = name;
        closeEditModal();
        renderTodoItems();
    }
}

/**
 * Modal: openClearCompletedModal
 * Orchestrates the Mandatory Action batch deletion flow for completed tasks.
 */
window.openClearCompletedModal = function() {
    showConfirmModal({
        title: 'Clear Completed',
        message: 'Are you sure you want to clear all completed tasks from the list?',
        danger: true,
        confirmText: 'Clear All',
        hideCancel: true,
        alignment: 'center',
        loadingText: 'Clearing...',
        onConfirm: async () => {
            const result = await apiPost('/todo/clear');
            if (result && result.success) {
                appState.todos = appState.todos.filter(t => !t.is_completed);
                renderTodoItems();
            }
        }
    });
};

/**
 * Utility: escapeHtml
 * Prevents XSS by sanitizing dynamic text strings.
 * 
 * @param {string} text - Raw input string
 * @returns {string} - Sanitized HTML string
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Global Exposure
 * Necessary for inline event handlers defined in server-rendered templates.
 */
window.toggleTodo = toggleTodo;
window.deleteTodo = deleteTodo;
window.submitEdit = submitEdit;
