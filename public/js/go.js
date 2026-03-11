// /public/js/go.js

/**
 * Go Links Controller Module
 * 
 * Manages the Platform Short-Link interface. It facilitates rapid 
 * redirection management and provides real-time link lifecycle orchestration
 * using a state-driven architecture for multi-user synchronization.
 * 
 * Features:
 * - List rendering from centralized Single Source of Truth
 * - Clipboard integration for rapid short-link distribution
 * - Administrative record lifecycle management (CRUD)
 * - Atomic UI reconciliation via background sync guards
 * 
 * Dependencies:
 * - default.js: For getIcon, apiPost, and showConfirmModal
 */

/**
 * --- Module Configuration & State ---
 */
const CONFIG = {
    SYNC_INTERVAL_MS: 300000        // Background refresh frequency (5 mins)
};

let STATE = {
    items: [] 
};

/**
 * Initializes the module state and establishes global event behaviors.
 * 
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', () => {
    loadState();

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('error')) {
        window.showToast('The requested Go Link was not found or is inactive.', 'error');
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Modal: Configure unified closure behavior
    window.setupGlobalModalClosing(['modal-overlay'], [closeEditModal]);

    // Background Synchronization
    setInterval(loadState, CONFIG.SYNC_INTERVAL_MS);
});

/**
 * --- Core Data Management ---
 */

/**
 * Synchronizes the module state with the server.
 * 
 * @async
 * @param {boolean} [force=false] - If true, bypasses interaction guards.
 * @returns {Promise<void>}
 */
async function loadState(force = false) {
    // Lifecycle: inhibit background sync if user is actively interacting with forms
    const anyModalOpen = document.querySelector('.modal-overlay.active, .delete-modal-overlay.active');
    const inputFocused = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');

    if (!force && (anyModalOpen || inputFocused) && STATE.items.length > 0) return;

    const container = document.getElementById('linksList');
    // Lifecycle: show loading pulse if initial boot
    if (container && !container.querySelector('.component-loading') && STATE.items.length === 0) {
        container.innerHTML = `
            <div class="component-loading">
                <div class="loading-scan-line"></div>
                <span class="loading-icon-pulse">${window.getIcon('link')}</span>
                <p class="loading-label">Synchronizing short-links...</p>
            </div>`;
    }

    try {
        const response = await fetch('/go/api/state');
        const data = await response.json();
        
        if (data && data.success) {
            STATE.items = data.items;
            renderList();
        }
    } catch (err) {
        console.error('loadState failed:', err);
    }
}

/**
 * Generates the link collection display.
 * 
 * @returns {void}
 */
function renderList() {
    const container = document.getElementById('linksList');
    if (!container) return;

    if (STATE.items.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>${window.getIcon('empty')} No Go links found.</p>
            </div>`;
        return;
    }

    container.innerHTML = STATE.items.map(link => {
        const safeKeyword = escapeHtml(link.keyword);
        const safeUrl = escapeHtml(link.url);
        const safeDesc = escapeHtml(link.description || '');

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
                        <span class="added-by">${window.getIcon('user')} ${escapeHtml(link.username || 'Unknown')}</span>
                    </div>
                </div>
                
                <div class="item-actions">
                    <button type="button" class="btn-icon-copy" onclick="copyGoLink('${safeKeyword}')" title="Copy Link">${window.getIcon('copy')}</button>
                    <button type="button" class="btn-icon-edit" onclick="openEditModal(${link.id})" title="Edit">${window.getIcon('edit')}</button>
                    <button type="button" class="btn-icon-delete" onclick="removeLink(${link.id}, '${safeKeyword}')" title="Delete">${window.getIcon('delete')}</button>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * --- UI & Interaction Logic ---
 */

/**
 * Encodes special characters for safe DOM injection.
 * 
 * @param {string} str - Raw input.
 * @returns {string} - Escaped output.
 */
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Pre-fills and displays the record modification interface.
 * 
 * @param {number} id - Record identifier.
 * @returns {void}
 */
function openEditModal(id) {
    const link = STATE.items.find(i => i.id == id);
    if (!link) return;

    const modal = document.getElementById('editModal');
    
    document.getElementById('editId').value = link.id;
    document.getElementById('editKeyword').value = link.keyword;
    document.getElementById('editUrl').value = link.url;
    document.getElementById('editDescription').value = link.description || '';
    
    if (modal) {
        modal.classList.add('active');
        document.body.classList.add('modal-open');
    }
}

/**
 * Hides the record editor and restores scroll focus.
 * 
 * @returns {void}
 */
function closeEditModal() {
    const modal = document.getElementById('editModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.classList.remove('modal-open');
    }
}

/**
 * Executes persistent storage operations via the API and synchronizes state.
 * 
 * @async
 * @param {Event} event - Triggering form event.
 * @param {boolean} isEdit - Target flag.
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
    btn.innerHTML = `${window.getIcon('waiting')} ${isEdit ? 'Saving...' : 'Adding...'}`;

    try {
        const formData = new FormData(form);
        const result = await window.apiPost(endpoint, formData);

        if (result && result.success) {
            if (isEdit) {
                closeEditModal();
            } else {
                form.reset();
            }
            // Lifecycle: Trigger atomic reconciliation
            await loadState(true);
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Initiates the deletion flow for a record and updates local state.
 * 
 * @param {number} id - Record identifier.
 * @param {string} keyword - Display label for context.
 * @returns {void}
 */
function removeLink(id, keyword) {
    window.showConfirmModal({
        title: 'Delete Link',
        message: `Are you sure you want to permanently delete the link for <strong>g/${keyword}</strong>?`,
        danger: true,
        confirmText: 'Delete Link',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const result = await window.apiPost('/go/api/delete', { id: id });
            if (result && result.success) {
                const row = document.getElementById(`link-row-${id}`);
                if (row) {
                    row.classList.add('row-fade-out');
                    setTimeout(() => loadState(true), 500);
                } else {
                    await loadState(true);
                }
            }
        }
    });
}

/**
 * Copies the short-link URL to the system clipboard.
 * 
 * @param {string} keyword - Redirection identifier.
 * @returns {void}
 */
function copyGoLink(keyword) {
    const url = `${window.location.origin}/g/${keyword}`;
    navigator.clipboard.writeText(url).then(() => {
        window.showToast(`Link copied: g/${keyword}`, 'success');
    }).catch(err => {
        console.error('Clipboard failure:', err);
        window.showToast('Failed to copy link.', 'error');
    });
}

/**
 * --- Global Exposure ---
 */
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
window.submitEntry = submitEntry;
window.removeLink = removeLink;
window.copyGoLink = copyGoLink;
window.loadState = loadState;
