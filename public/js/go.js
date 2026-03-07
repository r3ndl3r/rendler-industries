// /public/js/go.js

/**
 * Go Links Controller Module (SPA)
 * 
 * This module manages the Platform Short-Link interface using a 100% AJAX-driven 
 * SPA architecture. It facilitates rapid redirection management and provides 
 * real-time link lifecycle orchestration.
 * 
 * Features:
 * - State-driven ledger rendering from /go/api/state
 * - Clipboard integration for short-link sharing (g/keyword)
 * - Administrative CRUD operations with immediate UI reconciliation
 * - Pattern A (Ledger) implementation with glassmorphism cards
 * 
 * Dependencies:
 * - default.js: For getIcon, apiPost, and showConfirmModal
 */

/**
 * --- Application State ---
 */
let moduleState = {
    items: [] // Collection of short-link records
};

/**
 * --- Initialization ---
 */
document.addEventListener('DOMContentLoaded', () => {
    // Initial fetch of the module state
    loadState();

    // Configure global modal behavior
    setupGlobalModalClosing(['modal-overlay'], [closeEditModal]);
});

/**
 * --- Logic & UI Operations ---
 */

/**
 * Orchestrates the "Single Source of Truth" handshake.
 * Fetches all links from the API and triggers the rendering engine.
 * 
 * @async
 * @returns {Promise<void>}
 */
async function loadState() {
    try {
        const response = await fetch('/go/api/state');
        const data = await response.json();
        
        if (data.success) {
            moduleState.items = data.items;
            renderList();
        }
    } catch (err) {
        console.error('Go Links State Load Error:', err);
        showToast('Failed to sync links', 'error');
    }
}

/**
 * UI Engine: renderList
 * Generates the glassmorphism ledger items.
 * Implements popularity-based sorting (DESC visits) as configured in the backend.
 * 
 * @returns {void}
 */
function renderList() {
    const container = document.getElementById('go-list');
    if (!container) return;

    if (moduleState.items.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>No Go Links configured yet!</p>
                <p class="empty-hint">Create your first short link above.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = moduleState.items.map(link => {
        const safeKeyword = escapeHtml(link.keyword);
        const safeUrl = escapeHtml(link.url);
        const safeDesc = link.description ? escapeHtml(link.description) : '';

        return `
            <div class="go-item glass-panel" id="link-row-${link.id}">
                <div class="item-details">
                    <div class="link-header">
                        <a href="${safeUrl}" target="_blank" class="item-link">
                            g/${safeKeyword}
                        </a>
                        <span class="visit-badge">${link.visits} visits</span>
                    </div>
                    <div class="item-meta">
                        <i class="url-text">→ ${safeUrl}</i>
                        ${safeDesc ? `<span class="description-text">${safeDesc}</span>` : ''}
                    </div>
                </div>
                
                <div class="item-actions">
                    <button type="button" class="btn-icon-copy" onclick="copyGoLink('${safeKeyword}')" title="Copy Link">${getIcon('copy')}</button>
                    <button type="button" class="btn-icon-edit" onclick="openEditModal(${link.id})" title="Edit">${getIcon('edit')}</button>
                    <button type="button" class="btn-icon-delete" onclick="removeLink(${link.id}, '${safeKeyword}')" title="Delete">${getIcon('delete')}</button>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * --- Utilities ---
 */

/**
 * Sanitizes strings for safe DOM injection.
 * 
 * @param {string} str - Unsafe input.
 * @returns {string} - Escaped output.
 */
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Interface: openEditModal
 * Pre-fills the modification interface with existing record data.
 * 
 * @param {number} id - Target database record ID.
 * @returns {void}
 */
function openEditModal(id) {
    const link = moduleState.items.find(i => i.id == id);
    if (!link) return;

    const modal = document.getElementById('editModal');
    
    document.getElementById('editId').value = link.id;
    document.getElementById('editKeyword').value = link.keyword;
    document.getElementById('editUrl').value = link.url;
    document.getElementById('editDescription').value = link.description || '';
    
    if (modal) {
        modal.classList.add('show');
        document.body.classList.add('modal-open');
    }
}

/**
 * Hides the modification interface and restores scroll focus.
 * 
 * @returns {void}
 */
function closeEditModal() {
    const modal = document.getElementById('editModal');
    if (modal) {
        modal.classList.remove('show');
        document.body.classList.remove('modal-open');
    }
}

/**
 * Executes persistent storage operations (Add/Update) via AJAX.
 * 
 * @async
 * @param {Event} event - Triggering form event.
 * @param {boolean} isEdit - Flag determining the target endpoint.
 * @returns {Promise<void>}
 */
async function submitEntry(event, isEdit = false) {
    if (event) event.preventDefault();

    const form = event.target;
    const btnId = isEdit ? 'editSaveBtn' : 'addBtn';
    const btn = document.getElementById(btnId);
    const endpoint = isEdit ? '/go/api/edit' : '/go/api/add';
    
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} ${isEdit ? 'Saving...' : 'Adding...'}`;

    try {
        const formData = new FormData(form);
        const result = await apiPost(endpoint, formData);

        if (result && result.success) {
            if (isEdit) closeEditModal();
            else form.reset();
            
            loadState();
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Triggers the standardized confirmation workflow for link removal.
 * Implements the Mandatory Action pattern (No Cancel button).
 * 
 * @param {number} id - Unique record ID.
 * @param {string} keyword - Short identifier for confirmation context.
 * @returns {void}
 */
function removeLink(id, keyword) {
    showConfirmModal({
        title: 'Delete Link',
        message: `Are you sure you want to permanently delete the link for <strong>g/${keyword}</strong>?`,
        danger: true,
        confirmText: 'Delete Link',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const result = await apiPost('/go/api/delete', { id: id });
            if (result && result.success) {
                const row = document.getElementById(`link-row-${id}`);
                if (row) {
                    row.classList.add('row-fade-out');
                    setTimeout(() => loadState(), 500);
                } else {
                    loadState();
                }
            }
        }
    });
}

/**
 * Action: copyGoLink
 * Orchestrates the transfer of the absolute short-link URL to the clipboard.
 * 
 * @param {string} keyword - The short string used for resolution.
 * @returns {void}
 */
function copyGoLink(keyword) {
    const url = `${window.location.origin}/g/${keyword}`;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => {
            showToast('Link copied to clipboard!', 'success');
        }).catch(err => {
            console.error('Clipboard failure:', err);
            showToast('Failed to copy link', 'error');
        });
    }
}

/**
 * --- Global Exposure ---
 * Necessary for server-rendered template event hooks.
 */
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
window.submitEntry = submitEntry;
window.removeLink = removeLink;
window.copyGoLink = copyGoLink;
