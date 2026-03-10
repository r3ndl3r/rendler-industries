// /public/js/go.js

/**
 * Go Links Controller Module
 * 
 * Manages the Platform Short-Link interface. It facilitates rapid 
 * redirection management and provides real-time link lifecycle orchestration.
 * 
 * Features:
 * - List rendering from centralized state
 * - Clipboard integration for short-link sharing
 * - Record creation, modification, and removal
 * 
 * Dependencies:
 * - default.js: For getIcon, apiPost, and showConfirmModal
 */

/**
 * --- Application State ---
 */
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
        showToast('The requested Go Link was not found or is inactive.', 'error');
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    setupGlobalModalClosing(['modal-overlay'], [closeEditModal]);
});

/**
 * --- Logic & UI Operations ---
 */

/**
 * Synchronizes the module state with the server.
 * 
 * @async
 * @returns {Promise<void>}
 */
async function loadState() {
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
                <p>${getIcon('empty')} No Go links found.</p>
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
                        <span class="added-by">${getIcon('user')} ${escapeHtml(link.username || 'Unknown')}</span>
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
        modal.classList.add('show');
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
        modal.classList.remove('show');
        document.body.classList.remove('modal-open');
    }
}

/**
 * Executes persistent storage operations via the API and updates local state.
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
    btn.innerHTML = `${getIcon('waiting')} ${isEdit ? 'Saving...' : 'Adding...'}`;

    try {
        const formData = new FormData(form);
        const result = await apiPost(endpoint, formData);

        if (result && result.success) {
            if (isEdit) {
                // Manually update local state to ensure instant UI response
                const id = formData.get('id');
                const idx = STATE.items.findIndex(i => i.id == id);
                if (idx !== -1) {
                    STATE.items[idx].keyword = (formData.get('keyword') || '').toLowerCase();
                    STATE.items[idx].url = formData.get('url');
                    STATE.items[idx].description = formData.get('description');
                    renderList();
                }
                closeEditModal();
            } else {
                form.reset();
                // For additions, full sync is preferred to obtain the new record identifier
                await loadState();
            }
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
                // Manually remove from local state to ensure instant UI response
                STATE.items = STATE.items.filter(i => i.id != id);
                
                const row = document.getElementById(`link-row-${id}`);
                if (row) {
                    row.classList.add('row-fade-out');
                    setTimeout(() => renderList(), 500);
                } else {
                    renderList();
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
        showToast(`Link copied: g/${keyword}`, 'success');
    }).catch(err => {
        console.error('Clipboard failure:', err);
        showToast('Failed to copy link.', 'error');
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
