// /public/js/todo.js

/**
 * Todo List - 100% AJAX SPA Implementation
 */

let appState = {
    todos: []
};

document.addEventListener('DOMContentLoaded', () => {
    loadState();

    const taskInput = document.getElementById('taskInput');
    if (taskInput) taskInput.focus();

    // Handle Add Form
    const addForm = document.getElementById('addTodoForm');
    if (addForm) {
        addForm.addEventListener('submit', (e) => {
            e.preventDefault();
            addTodo();
        });
    }

    // Global modal closing helper
    setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay'], [
        closeEditModal, closeConfirmModal
    ]);
});

/**
 * Core Data Management
 */
async function loadState() {
    const container = document.getElementById('todoListContainer');
    if (container && !container.querySelector('.loading-state')) {
        container.innerHTML = getLoadingHtml('Syncing tasks...');
    }

    try {
        const response = await fetch('/todo/api/state');
        const data = await response.json();
        appState.todos = data.todos;
        renderTodoItems();
    } catch (err) {
        console.error('Failed to load todo state:', err);
        showToast('Connection error. Failed to sync tasks.', 'error');
    }
}

/**
 * Rendering Engine
 */
function renderTodoItems() {
    const container = document.getElementById('todoListContainer');
    if (!container) return;

    if (appState.todos.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>📭 Your todo list is empty!</p>
                <p class="empty-hint">Add your first task above to get started.</p>
            </div>`;
        return;
    }

    const active = appState.todos.filter(t => !t.is_completed);
    const completed = appState.todos.filter(t => t.is_completed);

    let html = '';

    if (active.length > 0) {
        html += `<h3 class="section-title">Active Tasks</h3>`;
        active.forEach(todo => {
            html += renderTodoItem(todo);
        });
    }

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
                    <button class="btn-icon-edit" onclick="openEditModal(${todo.id}, \`${todo.task_name.replace(/`/g, '\\`')}\`)" title="Edit">
                        ${getIcon('edit')}
                    </button>
                ` : ''}
                <button class="btn-icon-delete" onclick="deleteTodo(${todo.id}, \`${todo.task_name.replace(/`/g, '\\`')}\`)" title="Delete">
                    ${getIcon('delete')}
                </button>
            </div>
        </div>
    `;
}

/**
 * API Interactions
 */
async function addTodo() {
    const input = document.getElementById('taskInput');
    const task_name = input.value.trim();
    if (!task_name) return;

    const btn = document.querySelector('#addTodoForm .btn-blue-add');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Adding...`;

    const result = await apiPost('/todo/add', { task_name: task_name });
    if (result && result.success) {
        input.value = '';
        await loadState();
    }
    
    btn.disabled = false;
    btn.innerHTML = originalHtml;
}

async function toggleTodo(id) {
    const item = document.querySelector(`.todo-item[data-id="${id}"]`);
    if (item) item.classList.add('pending');

    const result = await apiPost(`/todo/toggle/${id}`);
    if (result && result.success) {
        await loadState();
    } else {
        if (item) item.classList.remove('pending');
    }
}

async function deleteTodo(id, name) {
    showConfirmModal({
        title: 'Delete Task',
        message: `Are you sure you want to remove "<strong>${escapeHtml(name)}</strong>"?`,
        danger: true,
        confirmText: 'Delete',
        onConfirm: async () => {
            const result = await apiPost(`/todo/delete/${id}`);
            if (result && result.success) {
                await loadState();
            }
        }
    });
}

function openEditModal(id, currentName) {
    document.getElementById('editId').value = id;
    document.getElementById('editName').value = currentName;
    document.getElementById('editModal').classList.add('show');
    document.getElementById('editName').focus();
}

function closeEditModal() {
    document.getElementById('editModal').classList.remove('show');
}

async function submitEdit() {
    const id = document.getElementById('editId').value;
    const name = document.getElementById('editName').value.trim();
    if (!name) return;

    const btn = document.querySelector('#editModal .btn-primary');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Saving...`;

    const result = await apiPost(`/todo/edit/${id}`, { task_name: name });
    if (result && result.success) {
        closeEditModal();
        await loadState();
    }
    
    btn.disabled = false;
    btn.innerHTML = originalHtml;
}

function openClearCompletedModal() {
    showConfirmModal({
        title: 'Clear Completed',
        message: 'Are you sure you want to clear all completed tasks?',
        danger: true,
        confirmText: 'Clear All',
        onConfirm: async () => {
            const result = await apiPost('/todo/clear');
            if (result && result.success) {
                await loadState();
            }
        }
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
