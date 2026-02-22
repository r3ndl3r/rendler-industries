/* /public/js/todo.js */

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

    // Modal Close logic
    window.onclick = function(event) {
        const editModal = document.getElementById('editModal');
        const deleteModal = document.getElementById('deleteConfirmModal');
        const clearModal = document.getElementById('clearCompletedModal');
        
        if (event.target == editModal) closeEditModal();
        if (event.target == deleteModal) closeDeleteConfirmModal();
        if (event.target == clearModal) closeClearCompletedModal();
    }

    // Setup final delete button
    const finalDeleteBtn = document.getElementById('finalDeleteBtn');
    if (finalDeleteBtn) {
        finalDeleteBtn.onclick = function() {
            if (todoIdToDelete) {
                performDelete(todoIdToDelete);
            }
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
                <button class="btn-edit-item" onclick="openEditModal(${id}, \`${taskName}\`)" title="Edit">
                    ✎
                </button>
            ` : ''}
            <button class="btn-delete-item" onclick="deleteTodo(${id})" title="Delete">
                🗑️
            </button>
        </div>
    `;
    return div;
}

async function addTodo() {
    const input = document.getElementById('taskInput');
    const task_name = input.value.trim();
    
    if (!task_name) return;

    try {
        const response = await fetch('/todo/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ task_name: task_name })
        });
        const result = await response.json();
        
        if (result.success) {
            showToast('Task added!', 'success');
            input.value = '';
            
            // Remove empty state if it exists
            const emptyState = document.querySelector('.empty-state');
            if (emptyState) emptyState.remove();

            // Find or create active tasks section
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
        } else {
            showToast('Error: ' + result.error, 'error');
        }
    } catch (err) {
        showToast('Request failed', 'error');
    }
}

async function toggleTodo(id) {
    try {
        const response = await fetch(`/todo/toggle/${id}`, { method: 'POST' });
        const result = await response.json();
        
        if (result.success) {
            const item = document.querySelector(`.todo-item[data-id="${id}"]`);
            const isNowCompleted = !item.classList.contains('completed');
            const taskName = item.querySelector('.item-name').textContent;
            
            // Fade out
            item.style.opacity = '0';
            item.style.transform = 'translateY(10px)';
            
            setTimeout(() => {
                item.remove();
                
                // If moving to completed
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
                    // Moving back to active
                    let activeHeader = document.querySelector('.items-container .section-title');
                    const newEl = createTaskElement(id, taskName, false);
                    activeHeader.after(newEl);
                }
            }, 300);

        } else {
            showToast('Error: ' + result.error, 'error');
        }
    } catch (err) {
        showToast('Request failed', 'error');
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
    try {
        const response = await fetch(`/todo/delete/${id}`, { method: 'POST' });
        const result = await response.json();
        
        if (result.success) {
            showToast('Task deleted', 'success');
            const item = document.querySelector(`.todo-item[data-id="${id}"]`);
            item.style.opacity = '0';
            item.style.transform = 'translateX(20px)';
            setTimeout(() => {
                const parent = item.parentNode;
                item.remove();
                
                // If section is now empty, clean it up
                if (parent.classList.contains('completed-section')) {
                    if (!parent.querySelector('.todo-item')) {
                        parent.remove();
                    }
                }
            }, 300);
            closeDeleteConfirmModal();
        } else {
            showToast('Error: ' + result.error, 'error');
        }
    } catch (err) {
        showToast('Request failed', 'error');
    }
}

function openEditModal(id, currentName) {
    const modal = document.getElementById('editModal');
    document.getElementById('editId').value = id;
    document.getElementById('editName').value = currentName;
    modal.style.display = 'flex';
    document.getElementById('editName').focus();
}

function closeEditModal() {
    document.getElementById('editModal').style.display = 'none';
}

async function submitEdit() {
    const id = document.getElementById('editId').value;
    const name = document.getElementById('editName').value.trim();
    
    if (!name) return;

    try {
        const response = await fetch(`/todo/edit/${id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ task_name: name })
        });
        const result = await response.json();
        
        if (result.success) {
            showToast('Task updated', 'success');
            const item = document.querySelector(`.todo-item[data-id="${id}"]`);
            item.querySelector('.item-name').textContent = name;
            
            // Update the edit button's onclick to reflect new name
            const editBtn = item.querySelector('.btn-edit-item');
            if (editBtn) {
                editBtn.setAttribute('onclick', `openEditModal(${id}, \`${name}\`)`);
            }
            
            closeEditModal();
        } else {
            showToast('Error: ' + result.error, 'error');
        }
    } catch (err) {
        showToast('Request failed', 'error');
    }
}

function openClearCompletedModal() {
    document.getElementById('clearCompletedModal').style.display = 'flex';
}

function closeClearCompletedModal() {
    document.getElementById('clearCompletedModal').style.display = 'none';
}

function textIn() {
    document.getElementById("taskInput").style.backgroundColor = "#1e293b";
}
