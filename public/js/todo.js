// /public/js/todo.js

/**
 * Personal Todo List - Refactored to use default.js
 */

let todoIdToDelete = null;

document.addEventListener('DOMContentLoaded', function() {
    const taskInput = document.getElementById('taskInput');
    if (taskInput) taskInput.focus();

    // Handle Add Form
    const addForm = document.getElementById('addTodoForm');
    if (addForm) {
        addForm.addEventListener('submit', function(e) {
            e.preventDefault();
            addTodo();
        });
    }

    // Use global modal closing helper
    setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay'], [
        closeEditModal, closeDeleteConfirmModal, closeClearCompletedModal
    ]);

    // Setup final delete button
    const finalDeleteBtn = document.getElementById('finalDeleteBtn');
    if (finalDeleteBtn) {
        finalDeleteBtn.onclick = function() {
            if (todoIdToDelete) performDelete(todoIdToDelete);
        };
    }
});

function createTaskElement(id, taskName, isCompleted = false) {
    const div = document.createElement('div');
    div.className = `todo-item ${isCompleted ? 'completed' : ''}`;
    div.dataset.id = id;
    
    div.innerHTML = `
        <div class="item-content">
            <button class="checkbox-btn ${isCompleted ? 'completed' : ''}" onclick="toggleTodo(${id})" title="${isCompleted ? 'Re-open Task' : 'Complete Task'}">
                <span class="checkmark">${isCompleted ? '✓' : ''}</span>
            </button>
            <div class="item-details">
                <span class="item-name">${taskName}</span>
            </div>
        </div>
        <div class="action-buttons">
            ${!isCompleted ? `
                <button class="btn-icon-edit" onclick="openEditModal(${id}, \`${taskName}\`)" title="Edit">${getIcon('edit')}</button>
            ` : ''}
            <button class="btn-icon-delete" onclick="deleteTodo(${id})" title="Delete">${getIcon('delete')}</button>
        </div>
    `;
    return div;
}

async function addTodo() {
    const input = document.getElementById('taskInput');
    const task_name = input.value.trim();
    if (!task_name) return;

    const result = await apiPost('/todo/add', { task_name: task_name });
    if (result) {
        input.value = '';
        document.querySelector('.empty-state')?.remove();

        let activeContainer = document.querySelector('.items-container');
        let activeHeader = document.querySelector('.items-container .section-title');
        
        if (!activeHeader) {
            activeHeader = document.createElement('h3');
            activeHeader.className = 'section-title';
            activeHeader.textContent = 'Active Tasks';
            activeContainer.prepend(activeHeader);
        }

        const newEl = createTaskElement(result.id, result.task_name);
        activeHeader.after(newEl);
    }
}

async function toggleTodo(id) {
    const result = await apiPost(`/todo/toggle/${id}`);
    if (result) {
        const item = document.querySelector(`.todo-item[data-id="${id}"]`);
        const isNowCompleted = !item.classList.contains('completed');
        const taskName = item.querySelector('.item-name').textContent;
        
        item.style.opacity = '0';
        item.style.transform = 'translateY(10px)';
        
        setTimeout(() => {
            item.remove();
            if (isNowCompleted) {
                let completedSection = document.querySelector('.completed-section');
                if (!completedSection) {
                    completedSection = document.createElement('div');
                    completedSection.className = 'completed-section';
                    completedSection.innerHTML = `
                        <div class="completed-header">
                            <h3 class="section-title">Completed</h3>
                            <button type="button" class="btn-clear-all" onclick="openClearCompletedModal()">Clear All</button>
                        </div>
                    `;
                    document.querySelector('.items-container').appendChild(completedSection);
                }
                const newEl = createTaskElement(id, taskName, true);
                completedSection.appendChild(newEl);
            } else {
                let activeHeader = document.querySelector('.items-container .section-title');
                const newEl = createTaskElement(id, taskName, false);
                activeHeader.after(newEl);
            }
        }, 300);
    }
}

function deleteTodo(id) {
    todoIdToDelete = id;
    const item = document.querySelector(`.todo-item[data-id="${id}"]`);
    const name = item.querySelector('.item-name').textContent;
    document.getElementById('deleteTaskName').textContent = name;
    document.getElementById('deleteConfirmModal').style.display = 'flex';
}

function closeDeleteConfirmModal() {
    todoIdToDelete = null;
    document.getElementById('deleteConfirmModal').style.display = 'none';
}

async function performDelete(id) {
    const result = await apiPost(`/todo/delete/${id}`);
    if (result) {
        const item = document.querySelector(`.todo-item[data-id="${id}"]`);
        item.style.opacity = '0';
        item.style.transform = 'translateX(20px)';
        setTimeout(() => {
            const parent = item.parentNode;
            item.remove();
            if (parent.classList.contains('completed-section') && !parent.querySelector('.todo-item')) {
                parent.remove();
            }
        }, 300);
        closeDeleteConfirmModal();
    }
}

function openEditModal(id, currentName) {
    document.getElementById('editId').value = id;
    document.getElementById('editName').value = currentName;
    document.getElementById('editModal').style.display = 'flex';
    document.getElementById('editName').focus();
}

function closeEditModal() { document.getElementById('editModal').style.display = 'none'; }

async function submitEdit() {
    const id = document.getElementById('editId').value;
    const name = document.getElementById('editName').value.trim();
    if (!name) return;

    const result = await apiPost(`/todo/edit/${id}`, { task_name: name });
    if (result) {
        const item = document.querySelector(`.todo-item[data-id="${id}"]`);
        item.querySelector('.item-name').textContent = name;
        item.querySelector('.btn-icon-edit')?.setAttribute('onclick', `openEditModal(${id}, \`${name}\`)`);
        closeEditModal();
    }
}

function openClearCompletedModal() { document.getElementById('clearCompletedModal').style.display = 'flex'; }
function closeClearCompletedModal() { document.getElementById('clearCompletedModal').style.display = 'none'; }
