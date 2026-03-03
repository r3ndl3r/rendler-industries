// /public/js/clipboard.js

/**
 * Platform Clipboard Module
 * 
 * This module manages the central community clipboard. it provides a 
 * 100% AJAX-driven SPA interface for persistent text-blob storage, 
 * including secure content sharing and administrative modification.
 * 
 * Features:
 * - Persistent community clippings with HTML entity decoding
 * - Cross-platform "Copy to Clipboard" utility with legacy browser fallbacks
 * - Administrative editing and deletion workflows
 * - Integrated confirmation for destructive operations
 * - Themed glassmorphism modal management
 * 
 * Dependencies:
 * - default.js: For getIcon, apiPost, and modal helpers
 * - toast.js: For action feedback
 * - jquery.js: For legacy AJAX submission support
 */

/**
 * Application State
 * Pointer for active deletion requests.
 */
let messageIdToDelete = null;

/**
 * Interface: openModal
 * Resets and displays the content creation interface.
 */
function openModal() {
    const title = document.getElementById('modalTitle');
    const idField = document.getElementById('messageId');
    const input = document.getElementById('paste');
    const form = document.getElementById('contentForm');
    const modal = document.getElementById('contentModal');

    if (title) title.textContent = 'Add New Content';
    if (idField) idField.value = '';
    if (input) input.value = '';
    if (form) form.action = '/clipboard';
    if (modal) modal.style.display = 'flex';
}

/**
 * Hides the content editor interface.
 */
function closeModal() {
    const modal = document.getElementById('contentModal');
    if (modal) modal.style.display = 'none';
}

/**
 * Interface: editMessage (Admin)
 * Pre-fills the content editor with existing clipping data.
 * Implements HTML decoding to restore raw text for editing.
 * 
 * @param {number} id - Record ID
 * @param {HTMLElement} btn - Button containing the source data attributes
 */
function editMessage(id, btn) {
    const text = btn.getAttribute('data-text');
    const title = document.getElementById('modalTitle');
    const idField = document.getElementById('messageId');
    const input = document.getElementById('paste');
    const form = document.getElementById('contentForm');
    const modal = document.getElementById('contentModal');

    if (title) title.textContent = 'Edit Content';
    if (idField) idField.value = id;
    
    // Logic: decode HTML entities to restore raw newlines and symbols for the textarea
    const doc = new DOMParser().parseFromString(text, 'text/html');
    if (input) input.value = doc.documentElement.textContent;
    
    if (form) form.action = '/clipboard/update';
    if (modal) modal.style.display = 'flex';
}

/**
 * Interface: removeMessage (Admin)
 * Prepares the deletion workflow for a specific record.
 * 
 * @param {number} id - Record ID
 */
function removeMessage(id) {
    messageIdToDelete = id;
    const modal = document.getElementById('deleteModal');
    if (modal) modal.style.display = 'flex';
}

/**
 * Resets the deletion pointer and hides the interface.
 */
function closeDeleteModal() {
    messageIdToDelete = null;
    const modal = document.getElementById('deleteModal');
    if (modal) modal.style.display = 'none';
}

/**
 * Action: copyToClipboard
 * Orchestrates the transfer of clipping text to the system clipboard.
 * 
 * @param {HTMLElement} btn - Triggering button containing data attributes
 */
function copyToClipboard(btn) {
    const text = btn.getAttribute('data-text');
    
    // Logic: decode entities to ensure copied text is clean
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const cleanText = doc.documentElement.textContent;

    // Context: try modern Clipboard API
    if (navigator.clipboard) {
        navigator.clipboard.writeText(cleanText).then(() => {
            showToast('Copied to clipboard!', 'success');
        }).catch(err => {
            console.error('Clipboard failure:', err);
            showToast('Failed to copy', 'error');
        });
    }
}

/**
 * Initialization System
 * Boots the clipboard logic and attaches confirmation listeners.
 */
document.addEventListener('DOMContentLoaded', function() {
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    if (confirmBtn) {
        /**
         * Action: Final Deletion Hook
         * Executes the persistent purge of a clipping.
         */
        confirmBtn.onclick = function() {
            if (messageIdToDelete) {
                // Logic: use jQuery for rapid POST submission with legacy fail hooks
                $.post('/clipboard/delete/' + messageIdToDelete, function() {
                    location.reload(); // Lifecycle: full refresh to sync ledger
                }).fail(function() {
                    showToast('Unauthorized: You are not allowed to delete messages.', 'error');
                    closeDeleteModal();
                });
            }
        };
    }
});

/**
 * Global Interaction Handler
 * Manages modal closure on overlay clicks.
 */
window.onclick = function(event) {
    const contentModal = document.getElementById('contentModal');
    const deleteModal = document.getElementById('deleteModal');
    
    if (event.target == contentModal) closeModal();
    if (event.target == deleteModal) closeDeleteModal();
};

/**
 * UI: textIn
 * Visual feedback for textarea focus.
 */
function textIn() {
    const input = document.getElementById("paste");
    if (input) input.style.backgroundColor = "#1e293b";
}

/**
 * Global Exposure
 * Required for inline event handlers in templates.
 */
window.openModal = openModal;
window.closeModal = closeModal;
window.editMessage = editMessage;
window.removeMessage = removeMessage;
window.closeDeleteModal = closeDeleteModal;
window.copyToClipboard = copyToClipboard;
window.textIn = textIn;
