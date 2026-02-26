// /public/js/shopping.js

/**
 * Collaborative Shopping List - Refactored to use default.js
 */

document.addEventListener('DOMContentLoaded', function() {
    const itemInput = document.querySelector('input[name="item_name"]');
    if (itemInput) itemInput.focus();

    // Handle Add Form
    const addForm = document.getElementById('addShoppingForm');
    if (addForm) {
        addForm.addEventListener('submit', function(e) {
            e.preventDefault();
            addItem();
        });
    }

    // Use global modal closing helper
    setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay'], [
        closeEditModal, closeDeleteModal, closeClearAllModal
    ]);
});

function createItemElement(id, itemName, addedBy, isChecked = false) {
    const div = document.createElement('div');
    div.className = `shopping-item ${isChecked ? 'checked' : ''}`;
    div.dataset.id = id;
    
    div.innerHTML = `
        <div class="item-content">
            <button type="button" class="checkbox-btn ${isChecked ? 'checked' : ''}" onclick="toggleItem(${id})" title="${isChecked ? 'Uncheck' : 'Mark as bought'}">
                <span class="checkmark">${isChecked ? '✓' : ''}</span>
            </button>
            <div class="item-details">
                <a href="https://www.google.com/search?q=${encodeURIComponent(itemName)}" target="_blank" class="item-link">
                    <span class="item-name">${itemName}</span>
                </a>
                <small class="item-meta">Added by ${addedBy}</small>
            </div>
        </div>
        <div class="action-buttons">
            ${!isChecked ? `
                <button type="button" class="btn-icon-edit" onclick="editItem(${id}, \`${itemName}\`)" title="Edit">${getIcon('edit')}</button>
            ` : ''}
            <button type="button" class="btn-icon-delete" onclick="openDeleteModal(${id}, \`${itemName}\`)" title="Delete">${getIcon('delete')}</button>
        </div>
    `;
    return div;
}

async function addItem() {
    const input = document.querySelector('input[name="item_name"]');
    const name = input.value.trim();
    if (!name) return;

    const result = await apiPost('/shopping/add', { item_name: name });
    if (result) {
        input.value = '';
        const emptyState = document.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        let activeContainer = document.querySelector('.items-container');
        let activeHeader = document.querySelector('.items-container .section-title');
        
        if (!activeHeader) {
            activeHeader = document.createElement('h3');
            activeHeader.className = 'section-title';
            activeHeader.textContent = 'To Buy';
            activeContainer.prepend(activeHeader);
        }

        const newEl = createItemElement(result.id, result.item_name, result.added_by);
        activeHeader.after(newEl);
    }
}

async function toggleItem(id) {
    const result = await apiPost(`/shopping/toggle/${id}`);
    if (result) {
        const item = document.querySelector(`.shopping-item[data-id="${id}"]`);
        const isNowChecked = !item.classList.contains('checked');
        const itemName = item.querySelector('.item-name').textContent;
        const addedBy = item.querySelector('.item-meta').textContent.replace('Added by ', '');
        
        item.style.opacity = '0';
        item.style.transform = 'translateY(10px)';
        
        setTimeout(() => {
            item.remove();
            if (isNowChecked) {
                let checkedSection = document.querySelector('.checked-section');
                if (!checkedSection) {
                    checkedSection = document.createElement('div');
                    checkedSection.className = 'checked-section';
                    checkedSection.innerHTML = `
                        <div class="checked-header">
                            <h3 class="section-title">Checked Items</h3>
                            <button type="button" onclick="openClearAllModal()" class="btn-clear-all">Clear All</button>
                        </div>
                    `;
                    document.querySelector('.items-container').appendChild(checkedSection);
                }
                const newEl = createItemElement(id, itemName, addedBy, true);
                checkedSection.appendChild(newEl);
            } else {
                let activeHeader = document.querySelector('.items-container .section-title');
                const newEl = createItemElement(id, itemName, addedBy, false);
                activeHeader.after(newEl);
            }
        }, 300);
    }
}

function openDeleteModal(id, itemName) {
    const modal = document.getElementById('deleteModal');
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    document.getElementById('deleteItemName').textContent = itemName;
    modal.style.display = 'flex';
    
    confirmBtn.onclick = async () => {
        const result = await apiPost(`/shopping/delete/${id}`);
        if (result) {
            const item = document.querySelector(`.shopping-item[data-id="${id}"]`);
            if (item) {
                item.style.opacity = '0';
                item.style.transform = 'translateX(20px)';
                setTimeout(() => {
                    const parent = item.parentNode;
                    item.remove();
                    if (parent.classList.contains('checked-section') && !parent.querySelector('.shopping-item')) {
                        parent.remove();
                    }
                }, 300);
            }
            closeDeleteModal();
        }
    };
}

function closeDeleteModal() { document.getElementById('deleteModal').style.display = 'none'; }

function editItem(id, currentName) {
    const modal = document.getElementById('editModal');
    document.getElementById('editId').value = id;
    document.getElementById('editName').value = currentName;
    modal.style.display = 'flex';
    document.getElementById('editName').focus();
}

function closeEditModal() { document.getElementById('editModal').style.display = 'none'; }

async function submitEdit() {
    const id = document.getElementById('editId').value;
    const name = document.getElementById('editName').value.trim();
    if (!name) return;

    const result = await apiPost(`/shopping/edit/${id}`, { item_name: name });
    if (result) {
        const item = document.querySelector(`.shopping-item[data-id="${id}"]`);
        item.querySelector('.item-name').textContent = name;
        item.querySelector('.btn-icon-edit')?.setAttribute('onclick', `editItem(${id}, \`${name}\`)`);
        item.querySelector('.btn-icon-delete').setAttribute('onclick', `openDeleteModal(${id}, \`${name}\`)`);
        closeEditModal();
    }
}

function openClearAllModal() { document.getElementById('clearAllModal').style.display = 'flex'; }
function closeClearAllModal() { document.getElementById('clearAllModal').style.display = 'none'; }
