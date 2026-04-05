// /public/js/clipboard.js

/**
 * Platform Clipboard Module (SPA)
 * 
 * This module manages the central community clipboard using a 100% AJAX-driven 
 * SPA architecture. It provides persistent text-blob storage with real-time 
 * updates and dynamic notification dispatching.
 * 
 * Features:
 * - State-driven rendering from standardized JSON payloads
 * - Administrative CRUD operations with immediate UI reconciliation
 * - Dynamic notification permission handling (Discord, Email, Gotify, Pushover)
 * - Standardized glassmorphism card UI with fade-out animations
 * 
 * Dependencies:
 * - default.js: For getIcon, apiPost, and showConfirmModal
 * - toast.js: For system-level action feedback
 */

/**
 * --- Application State ---
 */
let moduleState = {
    messages: [],                   // Collection of clipping records from DB
    isAdmin: false,                  // Elevated privilege flag for administrative tools
    userConfig: {}                  // Permission flags for notification channels
};

/**
 * --- Initialization ---
 */
document.addEventListener('DOMContentLoaded', () => {
    // Initial fetch of the module state
    loadState();

    // Configure global modal behavior for frosted glass overlays
    setupGlobalModalClosing(['modal-overlay'], [closeModal]);
});

/**
 * --- Logic & UI Operations ---
 */

/**
 * Orchestrates the "Single Source of Truth" handshake.
 * Fetches the complete module state from the API and triggers UI rendering.
 * 
 * @async
 * @returns {Promise<void>}
 */
async function loadState() {
    try {
        const response = await fetch('/clipboard/api/state');
        const data = await response.json();
        
        if (data.success) {
            moduleState = data;
            renderList();
            updateNotificationOptions();
        }
    } catch (err) {
        console.error('Clipboard State Load Error:', err);
        showToast('Failed to load clippings', 'error');
    }
}

/**
 * UI Engine: renderList
 * Iterates through the module state to generate glassmorphism cards.
 * Implements HTML decoding via safe Base64 to ensure reliable text rendering.
 * 
 * @returns {void}
 */
function renderList() {
    const container = document.getElementById('messages-list');
    if (!container) return;

    if (moduleState.messages.length === 0) {
        container.innerHTML = '<div class="empty-hint"><p>No clippings found. Add some content to get started!</p></div>';
        return;
    }

    // Logic: use .map() for efficient template string generation
    // Use encodeURIComponent/escape pattern for UTF-8 safe Base64
    container.innerHTML = moduleState.messages.map(msg => {
        const safeRaw = btoa(unescape(encodeURIComponent(msg.raw)));
        return `
            <div class="message-item glass-panel" id="msg-row-${msg.id}">
                <div class="item-actions">
                    <button class="btn-icon-copy" onclick="copyToClipboard('${safeRaw}')" title="Copy to Clipboard">📋</button>
                    <button class="btn-icon-edit" onclick="editMessage(${msg.id}, '${safeRaw}')" title="Edit">✎</button>
                    <button class="btn-icon-delete" onclick="removeMessage(${msg.id})" title="Delete">🗑️</button>
                </div>
                <span class="message-text">${msg.text}</span>
            </div>
        `;
    }).join('');
}

/**
 * UI Engine: updateNotificationOptions
 * Dynamically reconciles notification visibility based on user profile permissions.
 * Prevents unauthorized users from attempting restricted dispatch actions.
 * 
 * @returns {void}
 */
function updateNotificationOptions() {
    const config = moduleState.user_config;
    const optionsSection = document.getElementById('notification-options');
    
    let visibleCount = 0;

    // Helper: conditional display logic
    const toggle = (id, condition) => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.toggle('hidden', !condition);
            if (condition) visibleCount++;
        }
    };

    toggle('notify-discord-wrap', config.has_discord);
    toggle('notify-email-wrap', config.has_email);
    toggle('notify-pushover-wrap', config.can_pushover);
    toggle('notify-gotify-wrap', config.can_gotify);

    // Context: Hide the entire section if no channels are available for this user
    if (optionsSection) {
        optionsSection.classList.toggle('hidden', visibleCount === 0);
    }
}

/**
 * Prepares and reveals the content creation interface.
 * Resets form state to ensure a clean capture environment.
 * 
 * @returns {void}
 */
function openModal() {
    const title = document.getElementById('modalTitle');
    const idField = document.getElementById('messageId');
    const input = document.getElementById('paste');
    const modal = document.getElementById('contentModal');
    const notifyOptions = document.getElementById('notification-options');

    if (title) title.textContent = 'Add New Content';
    if (idField) idField.value = '';
    if (input) input.value = '';
    
    // Default: show notification routing for new items
    if (notifyOptions) notifyOptions.classList.remove('hidden');
    
    if (modal) {
        modal.classList.add('show');
        document.body.classList.add('modal-open');
    }
}

/**
 * Standardized Modal Dismissal.
 * Clears background scroll lock and resets visibility.
 * 
 * @returns {void}
 */
function closeModal() {
    const modal = document.getElementById('contentModal');
    if (modal) {
        modal.classList.remove('show');
        document.body.classList.remove('modal-open');
    }
}

/**
 * Pre-fills the content editor with existing record data.
 * Suppresses notifications for updates to minimize redundancy.
 * 
 * @param {number} id - The database record ID.
 * @param {string} base64Raw - The raw content string (Base64 encoded for transmission).
 * @returns {void}
 */
function editMessage(id, base64Raw) {
    const raw = decodeURIComponent(escape(atob(base64Raw)));
    const title = document.getElementById('modalTitle');
    const idField = document.getElementById('messageId');
    const input = document.getElementById('paste');
    const modal = document.getElementById('contentModal');
    const notifyOptions = document.getElementById('notification-options');

    if (title) title.textContent = 'Edit Content';
    if (idField) idField.value = id;
    if (input) input.value = raw;
    
    // Notifications are suppressed for existing records to minimize noise
    if (notifyOptions) notifyOptions.classList.add('hidden');

    if (modal) {
        modal.classList.add('show');
        document.body.classList.add('modal-open');
    }
}

/**
 * Executes the persistent storage of a clipping via AJAX.
 * Handles both new creation and updates based on presence of ID.
 * 
 * @async
 * @param {Event|null} event - The triggering form submission event.
 * @returns {Promise<void>}
 */
async function submitEntry(event) {
    if (event) event.preventDefault();

    const form = document.getElementById('contentForm');
    const id = document.getElementById('messageId').value;
    const btn = document.getElementById('submitBtn');
    
    const endpoint = id ? '/clipboard/update' : '/copy';
    const originalHtml = btn.innerHTML;

    // UI State: Indicate flight
    btn.disabled = true;
    btn.innerHTML = `⌛ Saving...`;

    try {
        const formData = new FormData(form);
        const result = await apiPost(endpoint, formData);

        if (result && result.success) {
            closeModal();
            loadState();
        }
    } finally {
        // Lifecycle: always restore button state regardless of outcome
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Triggers the standardized confirmation workflow for clipping removal.
 * Implements the Mandatory Action pattern (No Cancel button).
 * 
 * @param {number} id - Target database record ID.
 * @returns {void}
 */
function removeMessage(id) {
    showConfirmModal({
        title: 'Delete Clipping',
        message: 'Are you sure you want to permanently remove this clipping?',
        danger: true,
        confirmText: 'Delete',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const result = await apiPost('/clipboard/delete', { id: id });
            if (result && result.success) {
                // UI: Orchestrate fade-out for visual polish
                const row = document.getElementById(`msg-row-${id}`);
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
 * Interface: copyToClipboard
 * Transfers clipping content to the operating system clipboard.
 * 
 * @param {string} base64Raw - Content to be copied (Base64 decoded locally).
 * @returns {void}
 */
function copyToClipboard(base64Raw) {
    const text = decodeURIComponent(escape(atob(base64Raw)));
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('Copied to clipboard!', 'success');
        }).catch(err => {
            console.error('Clipboard failure:', err);
            showToast('Failed to copy', 'error');
        });
    }
}

/**
 * --- Global Exposure ---
 * These functions are explicitly exposed to the window object to support 
 * legacy inline event handlers defined in server-side templates.
 */
window.openModal = openModal;
window.closeModal = closeModal;
window.editMessage = editMessage;
window.removeMessage = removeMessage;
window.copyToClipboard = copyToClipboard;
window.submitEntry = submitEntry;
