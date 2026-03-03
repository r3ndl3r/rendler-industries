// /public/js/shopping.js

/**
 * Shopping List Module
 * 
 * This module manages the collaborative Family Shopping List. It provides
 * a 100% AJAX-driven SPA experience for real-time list management.
 * 
 * Features:
 * - Real-time synchronization with family shopping data
 * - Sectioned views (To Buy vs. Checked Items)
 * - Automatic Google Search deep-linking for active items
 * - Themed modal interactions for editing and batch clearing
 * - Mobile-first layout with high-visibility touch targets
 * 
 * Dependencies:
 * - default.js: For apiPost, getIcon, escapeHtml, and modal helpers
 * - toast.js: For notification feedback
 */

/**
 * Application State
 * Maintains current collection of shopping items and user permission context
 */
let shoppingItems = [];             // Collection of {id, item_name, added_by, is_checked}
let isAdmin = false;                // Permission flag for administrative actions

/**
 * Initialization System
 * Boots the module and establishes event listeners
 */
document.addEventListener('DOMContentLoaded', function() {
    // UI: focus item entry field for rapid input
    const itemInput = document.querySelector('input[name="item_name"]');
    if (itemInput) itemInput.focus();

    // Data: Fetch initial collection from server
    loadShoppingList();

    // Interaction: Handle item addition form
    const addForm = document.getElementById('addShoppingForm');
    if (addForm) {
        addForm.addEventListener('submit', function(e) {
            e.preventDefault();
            addItem();
        });
    }

    // Modal: Configure global click-outside-to-close behavior
    setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay'], [
        closeEditModal, closeConfirmModal
    ]);
});

/**
 * Action: loadShoppingList
 * Fetches the master shopping collection from the server
 * 
 * @returns {Promise<void>}
 */
async function loadShoppingList() {
    const response = await fetch('/shopping/api/data');
    const result = await response.json();
    
    if (result && result.success) {
        // Sync state and trigger render
        shoppingItems = result.items;
        isAdmin = result.is_admin;
        renderShoppingList();
    } else {
        // Error handling with manual retry option
        document.getElementById('shoppingListContainer').innerHTML = `
            <div class="empty-state">
                <p>Failed to load shopping list.</p>
                <button onclick="loadShoppingList()" class="btn-secondary btn-small">Retry</button>
            </div>
        `;
    }
}

/**
 * UI Engine: renderShoppingList
 * Generates the categorized shopping list HTML from current state
 */
function renderShoppingList() {
    const container = document.getElementById('shoppingListContainer');
    
    // Handle empty state
    if (shoppingItems.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>Your shopping list is empty!</p>
                <p class="empty-hint">Add your first item above to get started.</p>
            </div>
        `;
        return;
    }

    // Categorize items based on bought status
    const unchecked = shoppingItems.filter(i => !i.is_checked);
    const checked = shoppingItems.filter(i => i.is_checked);

    let html = '';

    // Render "To Buy" section
    if (unchecked.length > 0) {
        html += `<h3 class="section-title">To Buy</h3>`;
        unchecked.forEach(item => {
            html += renderItemHtml(item);
        });
    }

    // Render "Checked Items" with batch clear functionality
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

/**
 * UI Component: renderItemHtml
 * Builds the HTML fragment for a single shopping item
 * 
 * @param {Object} item - Item object from state
 * @returns {string} - Rendered HTML
 */
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
                <button type="button" class="btn-icon-delete" onclick="deleteItem(${item.id}, \`${item.item_name.replace(/'/g, "\\'")}\`)" title="Delete">${getIcon('delete')}</button>
            </div>
        </div>
    `;
}

/**
 * Action: addItem
 * Submits new item to server and performs an optimistic update
 * 
 * @returns {Promise<void>}
 */
async function addItem() {
    const input = document.querySelector('input[name="item_name"]');
    const name = input.value.trim();
    if (!name) return;

    // UI Feedback: indicate network flight
    const btn = document.querySelector('#addShoppingForm .btn-blue-add');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Adding...`;

    const result = await apiPost('/shopping/api/add', { item_name: name });
    if (result && result.success) {
        input.value = '';
        // Optimistic State Update
        shoppingItems.unshift({
            id: result.id,
            item_name: result.item_name,
            added_by: result.added_by,
            is_checked: 0
        });
        renderShoppingList();
    }
    
    btn.disabled = false;
    btn.innerHTML = originalHtml;
}

/**
 * Action: toggleItem
 * Inverts item checked status on server and local state
 * 
 * @param {number} id - Item ID
 * @returns {Promise<void>}
 */
async function toggleItem(id) {
    const itemEl = document.querySelector(`.shopping-item[data-id="${id}"]`);
    if (itemEl) itemEl.classList.add('pending'); // Visual feedback during processing

    const result = await apiPost(`/shopping/api/toggle/${id}`);
    if (result && result.success) {
        const item = shoppingItems.find(i => i.id == id);
        if (item) {
            item.is_checked = !item.is_checked;
            renderShoppingList();
        }
    } else if (itemEl) {
        itemEl.classList.remove('pending');
    }
}

/**
 * Modal: deleteItem
 * Triggers confirmation for item removal
 * 
 * @param {number} id - Item ID
 * @param {string} itemName - Display name for confirmation text
 */
function deleteItem(id, itemName) {
    showConfirmModal({
        title: 'Delete Item',
        message: `Are you sure you want to remove "<strong>${itemName}</strong>" from the list?`,
        danger: true,
        confirmText: 'Delete',
        loadingText: 'Deleting...',
        onConfirm: async () => {
            const result = await apiPost(`/shopping/api/delete/${id}`);
            if (result && result.success) {
                // Update local state and refresh
                shoppingItems = shoppingItems.filter(i => i.id != id);
                renderShoppingList();
            }
        }
    });
}

/**
 * Modal: editItem
 * Pre-fills and shows the item description editor
 * 
 * @param {number} id - Item ID
 * @param {string} currentName - Existing item description
 */
function editItem(id, currentName) {
    document.getElementById('editId').value = id;
    document.getElementById('editName').value = currentName;
    document.getElementById('editModal').classList.add('show');
    document.getElementById('editName').focus();
}

/**
 * Hides the item editor modal
 */
function closeEditModal() { 
    document.getElementById('editModal').classList.remove('show'); 
}

/**
 * Action: submitEdit
 * Submits the updated item description to the server
 * 
 * @returns {Promise<void>}
 */
async function submitEdit() {
    const id = document.getElementById('editId').value;
    const name = document.getElementById('editName').value.trim();
    const btn = document.querySelector('#editModal .btn-primary');
    if (!name) return;

    // UI Feedback: indicate processing
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Saving...`;

    const result = await apiPost(`/shopping/api/edit/${id}`, { item_name: name });
    if (result && result.success) {
        // Sync local state and refresh UI
        const item = shoppingItems.find(i => i.id == id);
        if (item) item.item_name = name;
        renderShoppingList();
        closeEditModal();
    }
    
    btn.disabled = false;
    btn.innerHTML = originalHtml;
}

/**
 * Modal: openClearAllModal
 * Confirmation for batch deletion of all checked items
 */
function openClearAllModal() {
    showConfirmModal({
        title: 'Clear All',
        message: 'Are you sure you want to clear all checked items?',
        danger: true,
        confirmText: 'Clear All',
        loadingText: 'Clearing...',
        onConfirm: async () => {
            const result = await apiPost('/shopping/api/clear');
            if (result && result.success) {
                // Remove all checked items from local state
                shoppingItems = shoppingItems.filter(i => !i.is_checked);
                renderShoppingList();
            }
        }
    });
}

/**
 * Utility: escapeHtml
 * Sanitizes strings to prevent XSS in dynamic HTML injections
 * 
 * @param {string} text - Raw input string
 * @returns {string} - Sanitized HTML string
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Global Exposure
 * Required for event handlers defined in .ep templates
 */
window.toggleItem = toggleItem;
window.deleteItem = deleteItem;
window.editItem = editItem;
window.submitEdit = submitEdit;
window.openClearAllModal = openClearAllModal;
window.loadShoppingList = loadShoppingList;
window.closeEditModal = closeEditModal;
