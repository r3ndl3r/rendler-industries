// /public/js/admin/users.js

/**
 * User Management Controller
 * 
 * Manages the Administrative User interface using a state-driven 
 * architecture. It facilitates role toggling, account approval, record
 * modification, and manual account creation through a high-density ledger.
 * 
 * Features:
 * - State-driven ledger rendering with 10-column grid
 * - Manual account creation via admin-only Add User modal
 * - Real-time role switching with iOS-style toggle UI
 * - Integrated approval workflow with automated synchronization
 * 
 * Dependencies:
 * - default.js: For apiPost, getIcon, setupGlobalModalClosing, showToast, and modal helpers
 */

/**
 * --- Module Configuration & State ---
 */
const CONFIG = {
    SYNC_INTERVAL_MS: 300000         // Background synchronization frequency
};

let STATE = {
    users: [],      // Collection of user account records
    isAdmin: false,  // Authorization flag for administrative actions
    currentUserId: 0 // ID of the currently logged-in admin
};

/**
 * Bootstraps the module state and establishes event delegation.
 * 
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    setupGlobalModalClosing(['modal-overlay'], [closeEditModal, closeAddUserModal]);
    setInterval(loadState, CONFIG.SYNC_INTERVAL_MS);
});

/**
 * --- UI Logic: Add User Modal ---
 */

/**
 * Prepares and displays the user creation interface.
 * Resets the form to clear any previous input before showing.
 * 
 * @returns {void}
 */
function openAddUserModal() {
    const form = document.getElementById('addUserForm');
    if (form) form.reset();

    const m = document.getElementById('addUserModal');
    if (m) m.classList.add('show');
    document.body.classList.add('modal-open');
}

/**
 * Hides the user creation interface and restores scroll behavior.
 * 
 * @returns {void}
 */
function closeAddUserModal() {
    const m = document.getElementById('addUserModal');
    if (m) m.classList.remove('show');
    document.body.classList.remove('modal-open');
}

/**
 * Executes the account creation protocol.
 * Submits the form payload to the server, shows a loading state on the
 * button during the request, and refreshes the ledger on success.
 * Toast feedback is handled automatically by apiPost.
 * 
 * @async
 * @param {Event} event - Form submission event.
 * @returns {Promise<void>}
 */
async function handleAddSubmit(event) {
    if (event) event.preventDefault();
    const form = event.target;
    const btn = document.getElementById('addSaveBtn');
    const originalHtml = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = `⌛ Creating...`;

    try {
        const formData = new FormData(form);

        // Explicitly set checkbox values: unchecked boxes are omitted from FormData,
        // which would produce an absent key rather than a deterministic 0 on the backend.
        formData.set('is_admin',  form.querySelector('[name="is_admin"]').checked  ? 1 : 0);
        formData.set('is_parent', form.querySelector('[name="is_parent"]').checked ? 1 : 0);
        formData.set('is_family', form.querySelector('[name="is_family"]').checked ? 1 : 0);
        formData.set('is_child',  form.querySelector('[name="is_child"]').checked  ? 1 : 0);

        const result = await apiPost('/admin/users/api/add', formData);
        if (result && result.success) {
            closeAddUserModal();
            await loadState(true);
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * --- Core Data Management ---
 */

/**
 * Synchronizes the module state with the server (Single Source of Truth).
 * Skips the refresh cycle if the user is currently interacting with a modal
 * or has an active cursor in an input field, unless 'force' is true.
 * 
 * @async
 * @param {boolean} force - If true, bypasses inhibition checks (e.g., after save).
 * @returns {Promise<void>}
 */
async function loadState(force = false) {
    // Skip background refresh if a modal is active OR the user is typing in an input field.
    // This prevents overwriting user input or causing focus-loss jumps.
    const anyModalOpen = document.querySelector('.modal-overlay.show') || document.querySelector('.delete-modal-overlay.show');
    const inputFocused = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');

    if (!force && (anyModalOpen || inputFocused) && STATE.users.length > 0) return;

    try {
        const response = await fetch('/admin/users/api/state');
        const data = await response.json();

        if (data && data.success) {
            STATE.users = data.users;
            STATE.isAdmin = !!data.is_admin;
            STATE.currentUserId = data.current_user_id;
            renderTable();
        }
    } catch (err) {
        console.error('loadState failed:', err);
    }
}

/**
 * --- UI Rendering Engine ---
 */

/**
 * Orchestrates the generation of the user ledger from state.
 * Sorts by ID ascending and delegates row generation to renderUserRow.
 * 
 * @returns {void}
 */
function renderTable() {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;

    if (STATE.users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="text-center">No users registered in the system.</td></tr>';
        return;
    }

    // Sort: Permanent record identifier (ascending)
    const sorted = [...STATE.users].sort((a, b) => a.id - b.id);
    tbody.innerHTML = sorted.map(u => renderUserRow(u)).join('');
}

/**
 * Generates the HTML fragment for a single user ledger row.
 * Self-referencing rows (current admin) have their Admin toggle disabled
 * to prevent privilege self-removal.
 * 
 * @param {Object} u - User record metadata.
 * @param {number} u.id - Unique user identifier.
 * @param {string} u.username - Displayed username.
 * @param {string} u.email - Registered email address.
 * @param {string} u.discord_id - Linked Discord user ID.
 * @param {string} u.created_at - Account creation timestamp.
 * @param {string} u.status - Account lifecycle state ('approved'|'pending').
 * @param {number} u.is_admin - Administrative privilege bit.
 * @param {number} u.is_parent - Parent privilege bit.
 * @param {number} u.is_family - Family member privilege bit.
 * @param {number} u.is_child - Child account privilege bit.
 * @returns {string} - Rendered HTML table row.
 */
function renderUserRow(u) {
    const isApproved = u.status === 'approved';

    return `
        <tr id="user-row-${u.id}" class="${u.status === 'pending' ? 'row-pending' : ''}">
            <td data-label="ID">${u.id}</td>
            <td data-label="Username"><span class="user-username">${getUserIcon(u.username)} ${escapeHtml(u.username)}</span></td>
            <td data-label="Email"><span class="user-email text-small">${escapeHtml(u.email)}</span></td>
            <td data-label="Discord ID">
                ${u.discord_id
                    ? `<span class="user-discord text-small">${escapeHtml(u.discord_id)}</span>`
                    : `<span class="user-discord-empty">-</span>`
                }
            </td>
            <td data-label="FCM" style="text-align:center" title="${u.has_fcm ? 'FCM token registered' : 'No FCM token'}">${u.has_fcm ? '🟢' : '🔴'}</td>
            <td data-label="Created"><span class="text-small">${u.created_at ? u.created_at.slice(8,10) + '-' + u.created_at.slice(5,7) + '-' + u.created_at.slice(0,4) : '-'}</span></td>
            <td data-label="Approved">
                <label class="switch">
                    <input type="checkbox" onchange="approveUser(${u.id}, this)" ${isApproved ? 'checked disabled' : ''}>
                    <span class="slider slider-approved"></span>
                </label>
            </td>
            <td data-label="Admin">
                <label class="switch">
                    <input type="checkbox" onchange="toggleRole(${u.id}, 'admin', this.checked)"
                           ${u.is_admin == 1 ? 'checked' : ''}
                           ${u.id == STATE.currentUserId ? 'disabled' : ''}>
                    <span class="slider"></span>
                </label>
            </td>
            <td data-label="Parent">
                <label class="switch">
                    <input type="checkbox" onchange="toggleRole(${u.id}, 'parent', this.checked)" ${u.is_parent == 1 ? 'checked' : ''}>
                    <span class="slider slider-parent"></span>
                </label>
            </td>
            <td data-label="Family">
                <label class="switch">
                    <input type="checkbox" onchange="toggleRole(${u.id}, 'family', this.checked)" ${u.is_family == 1 ? 'checked' : ''}>
                    <span class="slider slider-family"></span>
                </label>
            </td>
            <td data-label="Child">
                <label class="switch">
                    <input type="checkbox" onchange="toggleRole(${u.id}, 'child', this.checked)" ${u.is_child == 1 ? 'checked' : ''}>
                    <span class="slider slider-child"></span>
                </label>
            </td>
            <td data-label="Actions">
                <div class="action-btns">
                    <button class="btn-icon-edit" onclick="openEditUserModal(${u.id})" title="Edit Detail">✏️</button>
                    <button class="btn-icon-delete" onclick="confirmDeleteUser(${u.id}, '${escapeHtml(u.username)}')" title="Revoke Access">🗑️</button>
                </div>
            </td>
        </tr>
    `;
}

/**
 * --- Interactive Logic ---
 */

/**
 * Pre-fills and displays the user editor modal.
 * Clears the password field to avoid accidental overwrites.
 * 
 * @param {number} id - Target user identifier.
 * @returns {void}
 */
function openEditUserModal(id) {
    const u = STATE.users.find(item => item.id == id);
    if (!u) return;

    document.getElementById('editUserId').value = u.id;
    document.getElementById('editUsername').value = u.username;
    document.getElementById('editEmail').value = u.email;
    document.getElementById('editDiscordId').value = u.discord_id || '';
    document.getElementById('editStatus').value = u.status;
    document.getElementById('editPassword').value = '';

    const m = document.getElementById('editUserModal');
    if (m) m.classList.add('show');
    document.body.classList.add('modal-open');
}

/**
 * Hides the user editor modal and restores scroll behavior.
 * 
 * @returns {void}
 */
function closeEditModal() {
    const m = document.getElementById('editUserModal');
    if (m) m.classList.remove('show');
    document.body.classList.remove('modal-open');
}

/**
 * Executes persistent profile modifications.
 * Submits the edit form and refreshes the ledger on success.
 * 
 * @async
 * @param {Event} event - Form submission event.
 * @returns {Promise<void>}
 */
async function handleEditSubmit(event) {
    if (event) event.preventDefault();
    const form = event.target;
    const userId = document.getElementById('editUserId').value;
    const btn = document.getElementById('editSaveBtn');
    const originalHtml = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = `⌛ Saving...`;

    try {
        const result = await apiPost(`/admin/users/update/${userId}`, new FormData(form));
        if (result && result.success) {
            closeEditModal();
            await loadState(true);
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Activates a pending account registration.
 * Once approved, the toggle is permanently locked to prevent accidental reversal.
 * 
 * @async
 * @param {number} userId - Target user identifier.
 * @param {HTMLInputElement} checkbox - The triggering toggle switch.
 * @returns {Promise<void>}
 */
async function approveUser(userId, checkbox) {
    if (!checkbox.checked) return;
    checkbox.disabled = true;

    const result = await apiPost(`/admin/users/approve/${userId}`);
    if (result && result.success) {
        const u = STATE.users.find(item => item.id == userId);
        if (u) u.status = 'approved';
        renderTable();
    } else {
        checkbox.checked = false;
        checkbox.disabled = false;
    }
}

/**
 * Surgical toggle for user permission bits.
 * Guards against administrators removing their own admin privileges.
 * 
 * @async
 * @param {number} userId - Target user identifier.
 * @param {string} role - Role key ('admin'|'family'|'child').
 * @param {boolean} value - Target permission state.
 * @returns {Promise<void>}
 */
async function toggleRole(userId, role, value) {
    // Security: Prevent administrators from removing their own privileges
    if (role === 'admin' && !value && userId == STATE.currentUserId) {
        showToast('Operation rejected: You cannot remove your own admin status.', 'error');
        renderTable();
        return;
    }

    const result = await apiPost('/admin/users/toggle_role', { id: userId, role, value: value ? 1 : 0 });
    if (result && result.success) {
        const u = STATE.users.find(item => item.id == userId);
        if (u) {
            if (role === 'admin')  u.is_admin  = value ? 1 : 0;
            if (role === 'parent') u.is_parent = value ? 1 : 0;
            if (role === 'family') u.is_family = value ? 1 : 0;
            if (role === 'child')  u.is_child  = value ? 1 : 0;
            const cascade = result.cascaded || {};
            if (cascade.family)       u.is_family  = 1;
            if (cascade.clear_child)  u.is_child   = 0;
            if (cascade.clear_parent) u.is_parent  = 0;
            renderTable();
        }
    } else {
        renderTable();
    }
}

/**
 * Orchestrates the deletion flow for a user account.
 * Uses the themed confirm modal to prevent accidental removals.
 * Applies a fade-out animation before removing the row from local state.
 * 
 * @param {number} id - Target record identifier.
 * @param {string} username - Account display label for context.
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
            const result = await apiPost(`/admin/users/delete/${id}`);
            if (result && result.success) {
                const row = document.getElementById(`user-row-${id}`);
                if (row) {
                    row.classList.add('row-fade-out');
                    setTimeout(() => {
                        STATE.users = STATE.users.filter(u => u.id != id);
                        renderTable();
                    }, 500);
                } else {
                    await loadState(true);
                }
            }
        }
    });
}

/**
 * Prevents XSS by sanitizing dynamic content before DOM injection.
 * 
 * @param {string} text - Raw input string.
 * @returns {string} - HTML-escaped output.
 */
/**
 * --- Global Exposure ---
 */
window.loadState = loadState;
window.toggleRole = toggleRole;
window.approveUser = approveUser;
window.openEditUserModal = openEditUserModal;
window.closeEditModal = closeEditModal;
window.handleEditSubmit = handleEditSubmit;
window.confirmDeleteUser = confirmDeleteUser;
window.openAddUserModal = openAddUserModal;
window.closeAddUserModal = closeAddUserModal;
window.handleAddSubmit = handleAddSubmit;
