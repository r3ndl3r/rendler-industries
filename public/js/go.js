// /public/js/go.js

/**
 * Go Links Controller Module
 * 
 * This module manages the Platform Short-Link interface. It facilitates 
 * rapid redirection management and provides browser-compatible 
 * link sharing utilities.
 * 
 * Features:
 * - Clipboard integration for short-link sharing (g/keyword)
 * - Administrative management of redirection targets and descriptions
 * - Integrated confirmation workflow for link removal
 * - Unified click-outside modal closure logic
 * 
 * Dependencies:
 * - default.js: For getIcon, toast integration, and modal helpers
 */

/**
 * Initialization System
 * Sets up clipboard event listeners for existing link items.
 */
document.addEventListener('DOMContentLoaded', function() {
    // Interaction: Handle copy button clicks using data-url attributes
    document.querySelectorAll('.btn-icon-copy').forEach(btn => {
        btn.addEventListener('click', function() {
            const url = this.dataset.url;
            
            // Context: use modern Clipboard API
            if (navigator.clipboard) {
                navigator.clipboard.writeText(url).then(() => {
                    showToast('Link copied to clipboard!', 'success');
                }).catch(err => {
                    console.error('Clipboard failure:', err);
                    showToast('Failed to copy link', 'error');
                });
            }
        });
    });
});

/**
 * Interface: editLink (Admin)
 * Pre-fills and displays the short-link modification interface.
 * 
 * @param {number} id - Record ID
 * @param {string} keyword - Short keyword
 * @param {string} url - Target URL
 * @param {string} description - Optional detail
 */
function editLink(id, keyword, url, description) {
    const modal = document.getElementById('editModal');
    if (!modal) return;

    // Apply values to form fields
    document.getElementById('editId').value = id;
    document.getElementById('editKeyword').value = keyword;
    document.getElementById('editUrl').value = url;
    document.getElementById('editDescription').value = description;
    
    modal.style.display = 'flex';
}

/**
 * Hides the edit interface.
 */
function closeEditModal() {
    const modal = document.getElementById('editModal');
    if (modal) modal.style.display = 'none';
}

/**
 * Interface: openDeleteModal (Admin)
 * Displays the removal confirmation for a specific short-link.
 * 
 * @param {number} id - Record ID
 * @param {string} keyword - Short keyword for confirmation text
 */
function openDeleteModal(id, keyword) {
    showConfirmModal({
        title: 'Delete Link',
        message: `Are you sure you want to delete the link for <strong>g/${keyword}</strong>?`,
        danger: true,
        confirmText: 'Delete Link',
        hideCancel: true,
        alignment: 'center',
        loadingText: 'Deleting...',
        onConfirm: async () => {
            const result = await apiPost('/go/delete', { id: id });
            if (result && result.success) {
                location.reload();
            } else if (result && result.error) {
                showToast(result.error, 'error');
            }
        }
    });
}

/**
 * Global Interaction Handler
 * Manages modal closure when clicking on the frosted glass overlay.
 */
window.onclick = function(event) {
    const editModal = document.getElementById('editModal');
    if (event.target == editModal) closeEditModal();
};

/**
 * Global Exposure
 * Necessary for inline event handlers in server-rendered templates.
 */
window.editLink = editLink;
window.closeEditModal = closeEditModal;
window.openDeleteModal = openDeleteModal;
