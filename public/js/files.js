// /public/js/files.js

/**
 * File Management Controller Module
 * 
 * This module manages the Platform Binary Vault interface using a 100% 
 * AJAX-driven architecture. It handles large multipart uploads, 
 * state-driven ledger rendering, and granular ACL synchronization.
 * 
 * Features:
 * - Single Source of Truth state-driven rendering from /files/api/state
 * - Drag-and-drop orchestration with 1GB binary threshold validation
 * - Dynamic ACL management (Admin Only vs. Whitelisted Recipients)
 * - High-density JSDoc documentation for behavioral transparency
 * - Ledger implementation with glassmorphism styling
 * 
 * Dependencies:
 * - default.js: For apiPost, getIcon, setupGlobalModalClosing, and modal helpers
 */

/**
 * --- Application Configuration & State ---
 */
const CONFIG = {
    SYNC_INTERVAL_MS: 300000         // Background synchronization frequency
};

let moduleState = {
    files: [],      // Metadata-only file records
    users: [],      // Full roster for permission whitelisting
    isAdmin: false   // Authorization gate for administrative actions
};

/**
 * --- Initialization ---
 */
document.addEventListener('DOMContentLoaded', () => {
    // Initial fetch of the file vault roster
    loadState();

    // Configure global modal behavior for upload and permissions
    setupGlobalModalClosing(['modal-overlay'], [closeUploadModal, closePermissionModal]);

    // Initialize the Drop Zone orchestration
    setupDropZone();

    // Background synchronization
    setInterval(loadState, CONFIG.SYNC_INTERVAL_MS);
});

/**
 * Orchestrates the "Single Source of Truth" handshake.
 * Fetches vault metadata and triggers the rendering engine.
 * 
 * @async
 * @param {boolean} force - Whether to bypass interaction-aware inhibition.
 * @returns {Promise<void>}
 */
async function loadState(force = false) {
    // Inhibit background sync if user is interacting with a modal or typing
    const anyModalOpen = document.querySelector('.modal-overlay.show, .modal-overlay.active, .delete-modal-overlay.show, .delete-modal-overlay.active');
    const inputFocused = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');

    if (!force && (anyModalOpen || inputFocused)) return;

    try {
        const response = await fetch('/files/api/state', {
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        const data = await response.json();
        
        if (data.success) {
            moduleState.files = data.files;
            moduleState.users = data.users;
            moduleState.isAdmin = data.is_admin;
            renderTable();
            renderRecipientSelectors();
        }
    } catch (err) {
        console.error('File Vault Load Error:', err);
        showToast('Failed to synchronize file vault', 'error');
    }
}

/**
 * UI Engine: renderTable
 * Generates the ledger rows for the binary vault.
 * Implements MIME-aware iconography and access badges.
 * 
 * @returns {void}
 */
function renderTable() {
    const tbody = document.getElementById('files-table-body');
    if (!tbody) return;

    if (moduleState.files.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">No resources found in the vault.</td></tr>';
        return;
    }

    tbody.innerHTML = moduleState.files.map(file => `
        <tr id="file-row-${file.id}">
            <td data-label="Type" class="col-type-cell">
                ${getFileEmoji(file.mime_type)}
            </td>
            <td data-label="Filename">
                <div class="file-name-cell">
                    <strong>${escapeHtml(file.original_filename)}</strong>
                    ${file.description ? `<br><small class="file-desc">${escapeHtml(file.description)}</small>` : ''}
                </div>
            </td>
            <td data-label="Uploader">${escapeHtml(file.uploaded_by)}</td>
            <td data-label="Date"><span class="text-small">${file.uploaded_at}</span></td>
            <td data-label="Size"><span class="text-small">${(file.file_size / 1024 / 1024).toFixed(2)} MB</span></td>
            <td data-label="Downloads" class="col-downloads-cell">${file.download_count || 0}</td>
            <td data-label="Access">
                ${file.admin_only 
                    ? `<span class="badge badge-admin">Admin</span>` 
                    : (file.allowed_users 
                        ? `<span class="badge badge-restricted">Restricted</span>` 
                        : `<span class="badge badge-public">Public</span>`)
                }
            </td>
            <td data-label="Actions">
                <div class="action-buttons">
                    <a href="/files/serve/${file.id}" target="_blank" class="btn-icon-view" title="View/Download">👁️</a>
                    <button type="button" class="btn-icon-copy" onclick="copyFileLink(${file.id})" title="Copy Link">📋</button>
                    ${moduleState.isAdmin ? `
                        <button type="button" class="btn-icon-edit" onclick="openPermissionModal(${file.id})" title="Permissions">⚙️</button>
                        <button type="button" class="btn-icon-delete" onclick="confirmDeleteFile(${file.id}, '${escapeHtml(file.original_filename)}')" title="Purge">🗑️</button>
                    ` : ''}
                </div>
            </td>
        </tr>
    `).join('');
}

/**
 * UI Engine: renderRecipientSelectors
 * Populates the whitelisting checkboxes in both modals using the global selector grid.
 * 
 * @returns {void}
 */
function renderRecipientSelectors() {
    const approvedUsers = moduleState.users.filter(u => u.status === 'approved');
    const recipients = approvedUsers.map(u => ({ id: u.username, label: u.username }));
    
    // Render recipient grids for both Upload and Permission modals
    renderSelectorGrid('uploadRecipientsList', recipients, { name: 'allowed_users[]', prefix: 'uploadUser' });
    renderSelectorGrid('permissionRecipientsList', recipients, { name: 'allowed_users[]', prefix: 'permissionUser' });
}

/**
 * Interface: openUploadModal
 * Displays the binary transfer interface.
 * 
 * @returns {void}
 */
function openUploadModal() {
    const modal = document.getElementById('uploadModal');
    if (modal) {
        document.getElementById('uploadForm').reset();
        document.getElementById('fileNameDisplay').textContent = '';
        modal.classList.add('show');
        document.body.classList.add('modal-open');
    }
}

/**
 * Hides the upload interface.
 * 
 * @returns {void}
 */
function closeUploadModal() {
    const modal = document.getElementById('uploadModal');
    if (modal) {
        modal.classList.remove('show');
        document.body.classList.remove('modal-open');
    }
}

/**
 * Interface: openPermissionModal (Admin)
 * Pre-fills the ACL management interface for a resource.
 * 
 * @param {number} id - Target resource identifier.
 * @returns {void}
 */
function openPermissionModal(id) {
    const file = moduleState.files.find(f => f.id == id);
    if (!file) return;

    const modal = document.getElementById('permissionModal');
    document.getElementById('permissionFileId').value = file.id;
    document.getElementById('permissionAdminOnly').checked = file.admin_only == 1;

    // Logic: Sync whitelisted user checkboxes
    const allowed = file.allowed_users ? file.allowed_users.split(',') : [];
    
    // Reset all checkboxes first (Form.reset handles most but explicit sync is safer)
    document.querySelectorAll('#permissionRecipientsList input[type="checkbox"]').forEach(cb => {
        cb.checked = allowed.includes(cb.value);
    });

    if (modal) {
        modal.classList.add('show');
        document.body.classList.add('modal-open');
    }
}

/**
 * Hides the ACL interface.
 * 
 * @returns {void}
 */
function closePermissionModal() {
    const modal = document.getElementById('permissionModal');
    if (modal) {
        modal.classList.remove('show');
        document.body.classList.remove('modal-open');
    }
}

/**
 * Action: submitFileUpload
 * Orchestrates the multipart binary transfer via AJAX.
 * 
 * @async
 * @param {Event} event - Triggering form event.
 * @returns {Promise<void>}
 */
async function submitFileUpload(event) {
    if (event) event.preventDefault();

    const form = event.target;
    const fileInput = document.getElementById('file');
    if (!fileInput.files.length) {
        showToast('No binary selected', 'error');
        return;
    }

    const btn = document.getElementById('uploadSaveBtn');
    const originalHtml = btn.innerHTML;
    
    btn.disabled = true;
    btn.innerHTML = `⌛ Uploading...`;

    try {
        const formData = new FormData(form);
        
        // Standardized Checkbox Check: ensure 0 is sent if unchecked
        if (!formData.has('admin_only')) {
            formData.set('admin_only', 0);
        }

        const result = await apiPost('/files/api/upload', formData);

        if (result && result.success) {
        closeUploadModal();
        loadState(true);
        }    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Action: submitPermissions (Admin)
 * Synchronizes ACL updates with the vault.
 * 
 * @async
 * @param {Event} event - Triggering form event.
 * @returns {Promise<void>}
 */
async function submitPermissions(event) {
    if (event) event.preventDefault();

    const form = event.target;
    const id = document.getElementById('permissionFileId').value;
    const btn = document.getElementById('permissionSaveBtn');

    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `⌛ Saving...`;

    try {
        const formData = new FormData(form);
        
        // Standardized Checkbox Check: ensure 0 is sent if unchecked
        if (!formData.has('admin_only')) {
            formData.set('admin_only', 0);
        }

        const result = await apiPost(`/files/api/permissions/${id}`, formData);

        if (result && result.success) {
            closePermissionModal();
            loadState(true);
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Action: confirmDeleteFile (Admin)
 * Orchestrates the Mandatory Action deletion flow for a resource.
 * 
 * @param {number} id - Target database record ID.
 * @param {string} filename - Display name for context.
 * @returns {void}
 */
function confirmDeleteFile(id, filename) {
    showConfirmModal({
        title: 'Purge Resource',
        message: `Are you sure you want to permanently delete \"<strong>${filename}</strong>\"?`,
        danger: true,
        confirmText: 'Purge',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const result = await apiPost(`/files/api/delete/${id}`);
            if (result && result.success) {
                const row = document.getElementById(`file-row-${id}`);
                if (row) {
                    row.classList.add('row-fade-out');
                    setTimeout(() => loadState(true), 500);
                } else {
                    loadState(true);
                }
            }
        }
    });
}

/**
 * Action: copyFileLink
 * Copies the full serve URL to the clipboard.
 * 
 * @param {number} id - Target resource identifier.
 * @returns {void}
 */
function copyFileLink(id) {
    const url = `${window.location.origin}/files/serve/${id}`;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => showToast('Link copied', 'success'));
    } else {
        const el = document.createElement('textarea');
        el.value = url;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        showToast('Link copied', 'success');
    }
}

/**
 * Helper: getFileEmoji
 * Maps MIME types to semantic icons from the global registry.
 * 
 * @param {string} mime - Content-Type string.
 * @returns {string} - Semantic icon symbol.
 */
function getFileEmoji(mime) {
    if (!mime) return '📎';
    if (mime.startsWith('image/')) return '🖼️';
    if (mime.includes('pdf')) return '📕';
    if (mime.startsWith('text/')) return '📄';
    if (mime.includes('zip') || mime.includes('archive')) return '📦';
    return '📎';
}

/**
 * Configures drag-and-drop orchestration for the upload modal.
 * 
 * @returns {void}
 */
function setupDropZone() {
    const zone = document.getElementById('dropZone');
    const input = document.getElementById('file');
    const display = document.getElementById('fileNameDisplay');

    if (!zone || !input) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(e => {
        zone.addEventListener(e, (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
        });
    });

    ['dragenter', 'dragover'].forEach(e => {
        zone.addEventListener(e, () => zone.classList.add('dragover'));
    });

    ['dragleave', 'drop'].forEach(e => {
        zone.addEventListener(e, () => zone.classList.remove('dragover'));
    });

    zone.addEventListener('drop', (evt) => {
        const files = evt.dataTransfer.files;
        if (files.length) {
            input.files = files;
            display.textContent = files[0].name;
            display.classList.remove('hidden');
        }
    });

    input.addEventListener('change', () => {
        if (input.files.length) {
            display.textContent = input.files[0].name;
            display.classList.remove('hidden');
        }
    });
}

/**
 * --- Global Exposure ---
 */
window.openUploadModal = openUploadModal;
window.closeUploadModal = closeUploadModal;
window.submitFileUpload = submitFileUpload;
window.openPermissionModal = openPermissionModal;
window.closePermissionModal = closePermissionModal;
window.submitPermissions = submitPermissions;
window.confirmDeleteFile = confirmDeleteFile;
window.copyFileLink = copyFileLink;
