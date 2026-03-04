// /public/js/users.js

/**
 * User Management Controller Module (SPA)
 * 
 * This module manages the Administrative User interface using a 100% AJAX-driven 
 * SPA architecture. It facilitates role toggling, account approval, and 
 * record modification through a high-density state-driven ledger.
 * 
 * Features:
 * - State-driven ledger rendering from /users (AJAX state)
 * - Real-time role switching (Admin/Family) with toggle-switch UI
 * - Integrated approval workflow with automated email dispatch
 * - High-density JSDoc documentation for behavioral transparency
 * - Pattern A (Ledger) implementation with glassmorphism styling
 * 
 * Dependencies:
 * - default.js: For apiPost, getIcon, setupGlobalModalClosing, and modal helpers
 * - toast.js: For operation feedback
 */

/**
 * --- Application State ---
 */
let moduleState = {
    users: [],      // Collection of user account records
    isAdmin: false   // Authorization flag for administrative actions
};

/**
 * --- Initialization ---
 */
document.addEventListener('DOMContentLoaded', () => {
    // Initial fetch of the user roster
    loadState();

    // Configure global modal behavior for edit interfaces
    setupGlobalModalClosing(['modal-overlay'], [closeEditModal]);
});

/**
 * --- Logic & UI Operations ---
 */

/**
 * Orchestrates the "Single Source of Truth" handshake.
 * Fetches all users from the API and triggers the rendering engine.
 * 
 * @async
 * @returns {Promise<void>}
 */
async function loadState() {
    try {
        const response = await fetch('/users', {
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        const data = await response.json();
        
        if (data.success) {
            moduleState.users = data.users;
            moduleState.isAdmin = data.is_admin;
            renderTable();
        }
    } catch (err) {
        console.error('User State Load Error:', err);
        showToast('Failed to sync user roster', 'error');
    }
}

/**
 * UI Engine: renderTable
 * Generates the ledger rows for all users.
 * Implements dynamic role switches and status badges.
 * 
 * @returns {void}
 */
function renderTable() {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;

    if (moduleState.users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">No users found.</td></tr>';
        return;
    }

    tbody.innerHTML = moduleState.users.map(user => `
        <tr id="user-row-${user.id}">
            <td data-label="ID">${user.id}</td>
            <td data-label="Username"><span class="text-wrap user-username">${escapeHtml(user.username)}</span></td>
            <td data-label="Email"><span class="text-wrap text-small user-email">${escapeHtml(user.email)}</span></td>
            <td data-label="Discord ID">
                ${user.discord_id 
                    ? `<span class="text-wrap text-small user-discord user-discord-active">${escapeHtml(user.discord_id)}</span>`
                    : `<span class="user-discord user-discord-empty">-</span>`
                }
            </td>
            <td data-label="Created"><span class="text-wrap text-small">${user.created_at}</span></td>
            <td data-label="Approved" class="user-status-cell">
                <label class="switch">
                    <input type="checkbox" 
                           onchange="approveUser(${user.id}, this)" 
                           ${user.status === 'approved' ? 'checked disabled' : ''}>
                    <span class="slider slider-approved"></span>
                </label>
            </td>
            <td data-label="Admin">
                <label class="switch">
                    <input type="checkbox" onchange="toggleRole(${user.id}, 'admin', this.checked)" ${user.is_admin ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            </td>
            <td data-label="Family">
                <label class="switch">
                    <input type="checkbox" onchange="toggleRole(${user.id}, 'family', this.checked)" ${user.is_family ? 'checked' : ''}>
                    <span class="slider slider-family"></span>
                </label>
            </td>
            <td data-label="Actions">
                <div class="action-btns">
                    <button type="button" class="btn-icon-edit" onclick="openEditUserModal(${user.id})" title="Edit">${getIcon('edit')}</button>
                    <button type="button" class="btn-icon-delete" onclick="confirmDeleteUser(${user.id}, '${escapeHtml(user.username)}')" title="Delete">${getIcon('delete')}</button>
                </div>
            </td>
        </tr>
    `).join('');
}

/**
 * Action: toggleRole (Admin)
 * Inverts a user's permission bit on the server.
 * 
 * @async
 * @param {number} userId - Target user identifier.
 * @param {string} role - Permission bit to toggle ('admin' or 'family').
 * @param {boolean} value - Target boolean state.
 * @returns {Promise<void>}
 */
async function toggleRole(userId, role, value) {
    const data = {
        id: userId,
        role: role,
        value: value ? 1 : 0
    };

    const result = await apiPost('/users/toggle_role', data);
    
    // Logic: if update fails, sync state to restore visual switch state
    if (!result || !result.success) {
        loadState();
    }
}

/**
 * Action: approveUser (Admin)
 * Transitions a user from 'pending' to 'approved' state.
 * Triggers automated welcome email dispatch and locks the interface.
 * 
 * @async
 * @param {number} userId - Target user identifier.
 * @param {HTMLInputElement} checkbox - The triggering toggle switch.
 * @returns {Promise<void>}
 */
async function approveUser(userId, checkbox) {
    if (!checkbox.checked) return; // Prevent logic if somehow unchecked

    // UI: Disable immediately to prevent spam/double-clicks
    checkbox.disabled = true;

    // Logic: result processing is handled by apiPost (Toast)
    const result = await apiPost(`/users/approve/${userId}`);
    
    if (result && result.success) {
        // Success: keep checked and disabled (locked out)
        loadState(); 
    } else {
        // Failure: revert state
        checkbox.checked = false;
        checkbox.disabled = false;
    }
}

/**
 * Interface: openEditUserModal
 * Pre-fills the administrative user editor with record data from state.
 * 
 * @param {number} id - Target user identifier.
 * @returns {void}
 */
function openEditUserModal(id) {
    const user = moduleState.users.find(u => u.id == id);
    if (!user) return;

    const modal = document.getElementById('editUserModal');
    
    document.getElementById('editUserId').value = user.id;
    document.getElementById('editUsername').value = user.username;
    document.getElementById('editEmail').value = user.email;
    document.getElementById('editDiscordId').value = user.discord_id || '';
    document.getElementById('editStatus').value = user.status || 'pending';
    document.getElementById('editPassword').value = ''; 
    
    if (modal) {
        modal.style.display = 'flex';
        document.body.classList.add('modal-open');
    }
}

/**
 * Hides the user editor interface and restores scroll focus.
 * 
 * @returns {void}
 */
function closeEditModal() {
    const modal = document.getElementById('editUserModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.classList.remove('modal-open');
    }
}

/**
 * Executes persistent profile modifications via AJAX.
 * Reconciles the ledger upon successful update.
 * 
 * @async
 * @param {Event} event - Triggering form event.
 * @returns {Promise<void>}
 */
async function submitUserEdit(event) {
    if (event) event.preventDefault();

    const form = event.target;
    const userId = document.getElementById('editUserId').value;
    const btn = document.getElementById('editSaveBtn');
    
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Saving...`;

    try {
        const formData = new FormData(form);
        const result = await apiPost(`/users/update/${userId}`, Object.fromEntries(formData));

        if (result && result.success) {
            closeEditModal();
            loadState();
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Action: confirmDeleteUser (Admin)
 * Orchestrates the Mandatory Action deletion flow for a user account.
 * 
 * @param {number} id - Target database record ID.
 * @param {string} username - Name for confirmation context.
 * @returns {void}
 */
function confirmDeleteUser(id, username) {
    showConfirmModal({
        title: 'Delete User',
        message: `Are you sure you want to permanently delete user \"<strong>${username}</strong>\"?`,
        danger: true,
        confirmText: 'Delete',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const result = await apiPost(`/users/delete/${id}`);
            if (result && result.success) {
                // UI Lifecycle: animate row removal from ledger
                const row = document.getElementById(`user-row-${id}`);
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
 * Sanitizes strings for safe DOM injection.
 * 
 * @param {string} str - Unsafe input.
 * @returns {string} - Escaped output.
 */
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * --- Global Exposure ---
 * These functions are explicitly exposed to the window object to support 
 * legacy inline event handlers defined in server-side templates.
 */
window.toggleRole = toggleRole;
window.approveUser = approveUser;
window.openEditUserModal = openEditUserModal;
window.closeEditModal = closeEditModal;
window.submitUserEdit = submitUserEdit;
window.confirmDeleteUser = confirmDeleteUser;
