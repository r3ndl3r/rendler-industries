// /public/js/shopping.js

/**
 * Collaborative Shopping List - 100% AJAX SPA
 */

let shoppingItems = [];
let isAdmin = false;

document.addEventListener('DOMContentLoaded', function() {
    const itemInput = document.querySelector('input[name="item_name"]');
    if (itemInput) itemInput.focus();

    // Load initial data
    loadShoppingList();

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

async function loadShoppingList() {
    const response = await fetch('/shopping/api/data');
    const result = await response.json();
    
    if (result && result.success) {
        shoppingItems = result.items;
        isAdmin = result.is_admin;
        renderShoppingList();
    } else {
        document.getElementById('shoppingListContainer').innerHTML = `
            <div class="empty-state">
                <p>Failed to load shopping list.</p>
                <button onclick="loadShoppingList()" class="btn-secondary btn-small">Retry</button>
            </div>
        `;
    }
}

function renderShoppingList() {
    const container = document.getElementById('shoppingListContainer');
    
    if (shoppingItems.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>Your shopping list is empty!</p>
                <p class="empty-hint">Add your first item above to get started.</p>
            </div>
        `;
        return;
    }

    const unchecked = shoppingItems.filter(i => !i.is_checked);
    const checked = shoppingItems.filter(i => i.is_checked);

    let html = '';

    if (unchecked.length > 0) {
        html += `<h3 class="section-title">To Buy</h3>`;
        unchecked.forEach(item => {
            html += renderItemHtml(item);
        });
    }

    if (checked.length > 0) {
        html += `
            <div class="checked-section">
                <div class="checked-header">
                    <h3 class="section-title">Checked Items</h3>
                    <button type="button" class="btn-clear-all" onclick="openClearAllModal()">
                        Clear All
                    </button>
                </div>
                ${checked.map(item => renderItemHtml(item)).join('')}
            </div>
        `;
    }

    container.innerHTML = html;
}

function renderItemHtml(item) {
    const isChecked = item.is_checked;
    const itemNameEscaped = escapeHtml(item.item_name);
    const addedByEscaped = escapeHtml(item.added_by);

    return `
        <div class="shopping-item ${isChecked ? 'checked' : ''}" data-id="${item.id}">
            <div class="item-content">
                <button type="button" class="checkbox-btn ${isChecked ? 'checked' : ''}" onclick="toggleItem(${item.id})" title="${isChecked ? 'Uncheck' : 'Mark as bought'}">
                    <span class="checkmark">${isChecked ? '✓' : ''}</span>
                </button>
                <div class="item-details">
                    ${!isChecked ? `
                        <a href="https://www.google.com/search?q=${encodeURIComponent(item.item_name)}" target="_blank" class="item-link">
                            <span class="item-name">${itemNameEscaped}</span>
                        </a>
                    ` : `
                        <span class="item-name">${itemNameEscaped}</span>
                    `}
                    <small class="item-meta">Added by ${addedByEscaped}</small>
                </div>
            </div>
            <div class="action-buttons">
                ${!isChecked ? `
                    <button type="button" class="btn-icon-edit" onclick="editItem(${item.id}, \`${item.item_name.replace(/'/g, "\\'")}\`)" title="Edit">${getIcon('edit')}</button>
                ` : ''}
                <button type="button" class="btn-icon-delete" onclick="openDeleteModal(${item.id}, \`${item.item_name.replace(/'/g, "\\'")}\`)" title="Delete">${getIcon('delete')}</button>
            </div>
        </div>
    `;
}

async function addItem() {
    const input = document.querySelector('input[name="item_name"]');
    const name = input.value.trim();
    if (!name) return;

    const result = await apiPost('/shopping/api/add', { item_name: name });
    if (result && result.success) {
        input.value = '';
        shoppingItems.unshift({
            id: result.id,
            item_name: result.item_name,
            added_by: result.added_by,
            is_checked: 0
        });
        renderShoppingList();
        showToast(result.message, 'success');
    }
}

async function toggleItem(id) {
    const result = await apiPost(`/shopping/api/toggle/${id}`);
    if (result && result.success) {
        const item = shoppingItems.find(i => i.id == id);
        if (item) {
            item.is_checked = !item.is_checked;
            // Re-sort items: unchecked first, then by id desc (or however we want)
            // But let's keep it simple for now and just re-render
            renderShoppingList();
        }
    }
}

function openDeleteModal(id, itemName) {
    const modal = document.getElementById('deleteModal');
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    document.getElementById('deleteItemName').textContent = itemName;
    modal.style.display = 'flex';
    
    confirmBtn.onclick = async () => {
        const result = await apiPost(`/shopping/api/delete/${id}`);
        if (result && result.success) {
            shoppingItems = shoppingItems.filter(i => i.id != id);
            renderShoppingList();
            closeDeleteModal();
            showToast(result.message, 'success');
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

    const result = await apiPost(`/shopping/api/edit/${id}`, { item_name: name });
    if (result && result.success) {
        const item = shoppingItems.find(i => i.id == id);
        if (item) item.item_name = name;
        renderShoppingList();
        closeEditModal();
        showToast(result.message, 'success');
    }
}

function openClearAllModal() { document.getElementById('clearAllModal').style.display = 'flex'; }
function closeClearAllModal() { document.getElementById('clearAllModal').style.display = 'none'; }

async function clearCheckedItems() {
    const result = await apiPost('/shopping/api/clear');
    if (result && result.success) {
        shoppingItems = shoppingItems.filter(i => !i.is_checked);
        renderShoppingList();
        closeClearAllModal();
        showToast(result.message, 'success');
    }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
