// /public/js/users.js

/**
 * User Management Controller Module
 * 
 * This module manages the Administrative User interface. It handles role 
 * toggling, account approval, and record modification through a high-density 
 * AJAX-driven SPA ledger.
 * 
 * Features:
 * - Real-time role switching (Admin/Family) with toggle-switch UI
 * - Integrated approval workflow for pending registrations
 * - Dynamic ledger updates (row reconciliation) after edits
 * - Mandatory Action pattern for permanent user deletion (No Cancel)
 * - Visual fade-out animations for record removal
 * - Lifecycle-aware button state management
 * 
 * Dependencies:
 * - default.js: For apiPost, getIcon, setupGlobalModalClosing, and modal helpers
 * - toast.js: For operation feedback
 */

/**
 * Action: toggleRole (Admin)
 * Inverts a user's permission bit on the server.
 * 
 * @param {number} userId - Target user identifier
 * @param {string} role - Permission bit to toggle ('admin' or 'family')
 * @param {boolean} value - Target boolean state
 */
async function toggleRole(userId, role, value) {
    const data = {
        id: userId,
        role: role,
        value: value ? 1 : 0
    };

    const result = await apiPost('/users/toggle_role', data);
    // Logic: fallback to reload on failure to sync visual switch state
    if (!result || !result.success) {
        location.reload();
    }
}

/**
 * Initialization System
 * Sets up listeners for user management forms and configures global modal behavior.
 */
document.addEventListener('DOMContentLoaded', function() {
    const editForm = document.getElementById('editUserForm');
    if (editForm) {
        /**
         * Action: Edit Submission Handler
         * Submits account modifications and reconciles the ledger row.
         */
        editForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const btn = this.querySelector('button[type="submit"]');
            const originalHtml = btn ? btn.innerHTML : '';
            const userId = document.getElementById('editUserId').value;
            const formData = new FormData(this);
            
            // UI Feedback: disable button and show processing state
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = `${getIcon('waiting')} Saving...`;
            }

            const result = await apiPost(`/users/update/${userId}`, Object.fromEntries(formData));
            
            // Lifecycle Cleanup: Restore button regardless of result
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }

            if (result && result.success) {
                closeEditModal();
                
                // Logic: Dynamic Ledger Reconciliation
                // Manually update cells to avoid a full list fetch/re-render
                const row = document.getElementById(`user-row-${userId}`);
                if (row) {
                    row.querySelector('.user-username').textContent = formData.get('username');
                    row.querySelector('.user-email').textContent = formData.get('email');
                    
                    const discordEl = row.querySelector('.user-discord');
                    const discordId = formData.get('discord_id');
                    if (discordId) {
                        discordEl.textContent = discordId;
                        discordEl.classList.remove('user-discord-empty');
                        discordEl.classList.add('user-discord-active');
                    } else {
                        discordEl.textContent = '-';
                        discordEl.classList.remove('user-discord-active');
                        discordEl.classList.add('user-discord-empty');
                    }

                    const statusCell = row.querySelector('.user-status-cell');
                    const status = formData.get('status');
                    if (status === 'approved') {
                        statusCell.innerHTML = '<span class="status-badge status-approved">Approved</span>';
                        // Lifecycle: remove redundant approval button if status shifted
                        const approveBtn = row.querySelector('.btn-icon-view');
                        if (approveBtn) approveBtn.closest('form')?.remove();
                    } else {
                        statusCell.innerHTML = '<span class="status-badge status-pending">Pending</span>';
                    }
                }
            }
        });
    }

    // Modal: Configure unified closure logic for global and local overlays
    setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay'], [
        closeEditModal, closeConfirmModal,
        () => closeLocalModal('deleteUserModal')
    ]);
});

/**
 * Action: approveUser (Admin)
 * Transitions a user from 'pending' to 'approved' state.
 * 
 * @param {number} userId - Target user identifier
 * @param {HTMLElement} formEl - The triggering form container for cleanup
 */
async function approveUser(userId, formEl) {
    const btn = formEl.querySelector('button');
    const originalHtml = btn ? btn.innerHTML : '';
    
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `${getIcon('waiting')}`;
    }

    const result = await apiPost(`/users/approve/${userId}`);
    
    // Lifecycle Cleanup: restore button on failure, otherwise row is updated
    if (result && result.success) {
        const row = document.getElementById(`user-row-${userId}`);
        if (row) {
            const statusCell = row.querySelector('.user-status-cell');
            if (statusCell) statusCell.innerHTML = '<span class="status-badge status-approved">Approved</span>';
            formEl.remove();
        }
    } else if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Interface: openEditUserModal
 * Pre-fills the administrative user editor.
 * 
 * @param {Object} user - User record from state
 */
function openEditUserModal(user) {
    const modal = document.getElementById('editUserModal');
    if (!modal) return;

    document.getElementById('editUserId').value = user.id;
    document.getElementById('editUsername').value = user.username;
    document.getElementById('editEmail').value = user.email;
    document.getElementById('editDiscordId').value = user.discord_id || '';
    document.getElementById('editStatus').value = user.status || 'pending';
    document.getElementById('editPassword').value = ''; 
    
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
}

/**
 * Hides the user editor interface.
 */
function closeEditModal() {
    const modal = document.getElementById('editUserModal');
    if (modal) modal.style.display = 'none';
    document.body.classList.remove('modal-open');
}

/**
 * Interface: closeLocalModal
 * Utility for closing localized single-button modals.
 * 
 * @param {string} id - Modal element ID
 */
function closeLocalModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.style.display = 'none';
    document.body.classList.remove('modal-open');
}

/**
 * Action: confirmDeleteUser (Admin)
 * Orchestrates the Mandatory Action deletion flow for a user account.
 * 
 * @param {number} id - Record identifier
 * @param {string} username - Name for confirmation prompt
 */
function confirmDeleteUser(id, username) {
    const text = document.getElementById('deleteUserText');
    const btn = document.getElementById('confirmDeleteUserBtn');
    const modal = document.getElementById('deleteUserModal');

    if (text) text.innerHTML = `Are you sure you want to permanently delete user "<strong>${username}</strong>"?`;
    
    if (btn) {
        // Logic: bind dynamic execution handler to the centered confirmation button
        btn.onclick = async () => {
            const originalHtml = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = `${getIcon('waiting')} Deleting...`;
            
            try {
                const result = await apiPost(`/users/delete/${id}`);
                
                // Lifecycle Cleanup: restore button state
                btn.disabled = false;
                btn.innerHTML = originalHtml;

                if (result && result.success) {
                    closeLocalModal('deleteUserModal');
                    // UI Lifecycle: animate row removal from ledger
                    const row = document.getElementById(`user-row-${id}`);
                    if (row) {
                        row.classList.add('row-fade-out');
                        setTimeout(() => row.remove(), 500);
                    }
                }
            } catch (err) {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
        };
    }
    
    if (modal) {
        modal.style.display = 'flex';
        document.body.classList.add('modal-open');
    }
}

/**
 * Global Exposure
 * Required for event delegation and template handlers.
 */
window.toggleRole = toggleRole;
window.approveUser = approveUser;
window.openEditUserModal = openEditUserModal;
window.closeEditModal = closeEditModal;
window.confirmDeleteUser = confirmDeleteUser;
window.closeLocalModal = closeLocalModal;
