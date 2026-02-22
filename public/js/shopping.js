/* /public/js/shopping.js */

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

    // Modal logic
    window.addEventListener('click', (e) => {
        const editModal = document.getElementById('editModal');
        const deleteModal = document.getElementById('deleteModal');
        const clearAllModal = document.getElementById('clearAllModal');
        if (e.target === editModal) closeEditModal();
        if (e.target === deleteModal) closeDeleteModal();
        if (e.target === clearAllModal) closeClearAllModal();
    });
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
                <button type="button" class="btn-edit-item" onclick="editItem(${id}, \`${itemName}\`)" title="Edit">
                    <svg xmlns="http://www.w3.org/2000/svg" class="icon-small" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                </button>
            ` : ''}
            <button type="button" class="btn-delete-item" onclick="openDeleteModal(${id}, \`${itemName}\`)" title="Delete">
                <svg xmlns="http://www.w3.org/2000/svg" class="icon-small" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
    `;
    return div;
}

async function addItem() {
    const input = document.querySelector('input[name="item_name"]');
    const name = input.value.trim();
    if (!name) return;

    try {
        const response = await fetch('/shopping/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ item_name: name })
        });
        const result = await response.json();
        
        if (result.success) {
            showToast('Item added!', 'success');
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
        } else {
            showToast('Error: ' + result.error, 'error');
        }
    } catch (err) {
        showToast('Request failed', 'error');
    }
}

async function toggleItem(id) {
    try {
        const response = await fetch(`/shopping/toggle/${id}`, { 
            method: 'POST'
        });
        const result = await response.json();
        
        if (result.success) {
            const item = document.querySelector(`.shopping-item[data-id="${id}"]`);
            const isNowChecked = !item.classList.contains('checked');
            const itemName = item.querySelector('.item-name').textContent;
            const metaText = item.querySelector('.item-meta').textContent;
            const addedBy = metaText.replace('Added by ', '');
            
            item.style.opacity = '0';
            item.style.transform = 'translateY(10px)';
            
            setTimeout(() => {
                const parent = item.parentNode;
                item.remove();
                
                // If section is now empty (active side), clean up header
                if (parent.classList.contains('items-container') && !parent.querySelector('.shopping-item:not(.checked)')) {
                    // Logic to find and hide/remove "To Buy" title if we want
                }

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
                    if (!activeHeader) {
                        activeHeader = document.createElement('h3');
                        activeHeader.className = 'section-title';
                        activeHeader.textContent = 'To Buy';
                        document.querySelector('.items-container').prepend(activeHeader);
                    }
                    const newEl = createItemElement(id, itemName, addedBy, false);
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

function openDeleteModal(id, itemName) {
    const modal = document.getElementById('deleteModal');
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    document.getElementById('deleteItemName').textContent = itemName;
    modal.style.display = 'flex';
    
    confirmBtn.onclick = async () => {
        try {
            const response = await fetch(`/shopping/delete/${id}`, { 
                method: 'POST'
            });
            const result = await response.json();
            if (result.success) {
                showToast('Item removed', 'success');
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
        } catch (err) {
            showToast('Delete failed', 'error');
        }
    };
}

function closeDeleteModal() {
    document.getElementById('deleteModal').style.display = 'none';
}

function editItem(id, currentName) {
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
        const response = await fetch(`/shopping/edit/${id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ item_name: name })
        });
        const result = await response.json();
        if (result.success) {
            showToast('Item updated', 'success');
            const item = document.querySelector(`.shopping-item[data-id="${id}"]`);
            item.querySelector('.item-name').textContent = name;
            item.querySelector('.btn-edit-item')?.setAttribute('onclick', `editItem(${id}, \`${name}\`)`);
            item.querySelector('.btn-delete-item').setAttribute('onclick', `openDeleteModal(${id}, \`${name}\`)`);
            closeEditModal();
        }
    } catch (err) {
        showToast('Update failed', 'error');
    }
}

function openClearAllModal() {
    document.getElementById('clearAllModal').style.display = 'flex';
}

function closeClearAllModal() {
    document.getElementById('clearAllModal').style.display = 'none';
}
