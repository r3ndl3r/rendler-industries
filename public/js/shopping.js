// /public/js/shopping.js

/**
 * Shopping List Controller
 * 
 * Manages the collaborative Family Shopping List using a state-driven 
 * architecture. It provides a synchronized experience with 
 * real-time updates and optimistic UI modifications.
 * 
 * Features:
 * - State-driven list rendering (To Buy vs. Checked Items)
 * - Automatic background synchronization every 5 minutes
 * - Real-time role-based UI adjustments (Admin actions)
 * - Standardized lifecycle for record modifications
 * - Lifecycle-aware button state management for network flight indicators
 * - Sanity-checked DOM manipulation for XSS prevention
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
    items: [],                      // Collection of {id, item_name, added_by, is_checked}
    isAdmin: false                  // Permission gate for destructive actions
};

/**
 * Bootstraps the module state and establishes event delegation.
 * 
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', () => {
    // UI: Focus entry field for rapid input
    const itemInput = document.querySelector('input[name="item_name"]');
    if (itemInput) itemInput.focus();

    // Initial fetch of the shopping roster
    loadState();

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
        const response = await fetch('/shopping/api/state');
        const data = await response.json();
        
        if (data && data.success) {
            STATE.items = data.items;
            STATE.isAdmin = !!data.is_admin;
            renderTable();
        }
    } catch (err) {
        console.error('loadState failed:', err);
    }
}

/**
 * Orchestrates the generation of the shopping list categories.
 * 
 * @returns {void}
 */
function renderTable() {
    const container = document.getElementById('shoppingListContainer');
    if (!container) return;
    
    if (STATE.items.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>🛒 Your shopping list is empty!</p>
                <p class="empty-hint">Add your first item above to get started.</p>
            </div>
        `;
        return;
    }

    const unchecked = STATE.items.filter(i => !i.is_checked);
    const checked = STATE.items.filter(i => i.is_checked);

    let html = '';

    // Active Items
    if (unchecked.length > 0) {
        html += `<h3 class="section-title">To Buy</h3>`;
        html += unchecked.map(item => renderItemRow(item)).join('');
    }

    // Completed Items
    if (checked.length > 0) {
        html += `
            <div class="checked-section">
                <div class="checked-header">
                    <h3 class="section-title">Checked Items</h3>
                    <button type="button" class="btn-clear-all" onclick="openClearAllModal()">
                        Clear All
                    </button>
                </div>
                ${checked.map(item => renderItemRow(item)).join('')}
            </div>
        `;
    }

    container.innerHTML = html;
}

/**
 * Generates the HTML fragment for a single shopping item.
 * 
 * @param {Object} item - Item record metadata.
 * @returns {string} - Rendered HTML row.
 */
function renderItemRow(item) {
    const isChecked = !!item.is_checked;
    const nameEscaped = escapeHtml(item.item_name);
    const userEscaped = escapeHtml(item.added_by);

    return `
        <div class="shopping-item ${isChecked ? 'checked' : ''}" data-id="${item.id}">
            <div class="item-content">
                <button type="button" class="checkbox-btn ${isChecked ? 'checked' : ''}" 
                        onclick="toggleItem(${item.id})" title="${isChecked ? 'Uncheck' : 'Mark as bought'}">
                    <span class="checkmark">${isChecked ? '✓' : ''}</span>
                </button>
                <div class="item-details">
                    ${!isChecked ? `
                        <a href="https://www.google.com/search?q=${encodeURIComponent(item.item_name)}" target="_blank" class="item-link">
                            <span class="item-name">${nameEscaped}</span>
                        </a>
                    ` : `
                        <span class="item-name">${nameEscaped}</span>
                    `}
                    <small class="item-meta">Added by ${userEscaped}</small>
                </div>
            </div>
            <div class="action-buttons">
                ${!isChecked ? `
                    <button type="button" class="btn-icon-edit" onclick="openEditModal(${item.id})" title="Edit Item">
                        ${getIcon('edit')}
                    </button>
                ` : ''}
                <button type="button" class="btn-icon-delete" onclick="confirmDeleteItem(${item.id}, \`${item.item_name.replace(/`/g, "\\`")}\`)" title="Remove Item">
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
 * Submits a new item to the collection.
 * Performs an optimistic UI update upon success.
 * 
 * @async
 * @param {Event} event - Triggering form event.
 * @returns {Promise<void>}
 */
async function handleAddItem(event) {
    if (event) event.preventDefault();

    const form = event.target;
    const input = form.querySelector('input[name="item_name"]');
    const name = input.value.trim();
    if (!name) return;

    const btn = document.getElementById('addItemBtn');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Adding...`;

    try {
        const result = await apiPost('/shopping/api/add', { item_name: name });
        if (result && result.success) {
            input.value = '';
            // Optimistic update
            STATE.items.unshift({
                id: result.id,
                item_name: result.item_name,
                added_by: result.added_by,
                is_checked: 0
            });
            renderTable();
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Updates item check status.
 * Reconciles the local state immediately upon success.
 * 
 * @async
 * @param {number} id - Target identifier.
 * @returns {Promise<void>}
 */
async function toggleItem(id) {
    const row = document.querySelector(`.shopping-item[data-id="${id}"]`);
    if (row) row.classList.add('pending');

    const result = await apiPost(`/shopping/api/toggle/${id}`);
    if (result && result.success) {
        const item = STATE.items.find(i => i.id == id);
        if (item) {
            item.is_checked = !item.is_checked;
            renderTable();
        }
    } else if (row) {
        row.classList.remove('pending');
    }
}

/**
 * Pre-fills and displays the item editor.
 * 
 * @param {number} id - Target identifier.
 * @returns {void}
 */
function openEditModal(id) {
    const item = STATE.items.find(i => i.id == id);
    if (!item) return;

    document.getElementById('editId').value = id;
    const input = document.getElementById('editName');
    if (input) {
        input.value = item.item_name;
        const modal = document.getElementById('editModal');
        modal.style.display = 'flex';
        document.body.classList.add('modal-open');
        input.focus();
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
 * Executes persistent modifications to an item.
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
        const result = await apiPost(`/shopping/api/edit/${id}`, { item_name: name });
        if (result && result.success) {
            const item = STATE.items.find(i => i.id == id);
            if (item) item.item_name = name;
            renderTable();
            closeEditModal();
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Orchestrates the deletion flow for a specific item.
 * 
 * @param {number} id - Target identifier.
 * @param {string} itemName - Display label for context.
 * @returns {void}
 */
function confirmDeleteItem(id, itemName) {
    showConfirmModal({
        title: 'Delete Item',
        message: `Are you sure you want to remove \"<strong>${escapeHtml(itemName)}</strong>\"?`,
        danger: true,
        confirmText: 'Delete',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const result = await apiPost(`/shopping/api/delete/${id}`);
            if (result && result.success) {
                STATE.items = STATE.items.filter(i => i.id != id);
                renderTable();
            }
        }
    });
}

/**
 * Orchestrates the batch deletion of checked items.
 * 
 * @returns {void}
 */
function openClearAllModal() {
    showConfirmModal({
        title: 'Clear Completed',
        message: 'Are you sure you want to clear all checked items?',
        danger: true,
        confirmText: 'Clear All',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const result = await apiPost('/shopping/api/clear');
            if (result && result.success) {
                STATE.items = STATE.items.filter(i => !i.is_checked);
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
window.toggleItem = toggleItem;
window.confirmDeleteItem = confirmDeleteItem;
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
window.handleEditSubmit = handleEditSubmit;
window.handleAddItem = handleAddItem;
window.openClearAllModal = openClearAllModal;
