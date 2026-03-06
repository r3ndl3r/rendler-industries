// /public/js/users.js

/**
 * User Management Controller
 * 
 * Manages the Administrative User interface using a state-driven 
 * architecture. It facilitates role toggling, account approval, and 
 * record modification through a high-density ledger.
 * 
 * Features:
 * - State-driven ledger rendering with 9-column grid
 * - Real-time role switching with iOS-style toggle UI
 * - Integrated approval workflow with automated synchronization
 * - High-density JSDoc documentation
 * 
 * Dependencies:
 * - default.js: For apiPost, getIcon, setupGlobalModalClosing, and modal helpers
 */

/**
 * --- Module Configuration & State ---
 */
const CONFIG = {
    SYNC_INTERVAL_MS: 300000         // Background synchronization frequency
};

let STATE = {
    users: [],      // Collection of user account records
    isAdmin: false   // Authorization flag for administrative actions
};

/**
 * Bootstraps the module state and establishes event delegation.
 * 
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', () => {
    loadState();

    setupGlobalModalClosing(['modal-overlay'], [closeEditModal]);

    setInterval(loadState, CONFIG.SYNC_INTERVAL_MS);
});

/**
 * --- Core Data Management ---
 */

/**
 * Synchronizes the module state with the server (Single Source of Truth).
 * 
 * @async
 * @returns {Promise<void>}
 */
async function loadState() {
    try {
        const response = await fetch('/users/api/state');
        const data = await response.json();
        
        if (data && data.success) {
            STATE.users = data.users;
            STATE.isAdmin = !!data.is_admin;
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
 * 
 * @returns {void}
 */
function renderTable() {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;

    if (STATE.users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">No users registered in the system.</td></tr>';
        return;
    }

    // Sort: Permanent record identifier (ascending)
    const sorted = [...STATE.users].sort((a, b) => a.id - b.id);

    tbody.innerHTML = sorted.map(u => renderUserRow(u)).join('');
}

/**
 * Generates the HTML fragment for a single user ledger row.
 * 
 * @param {Object} u - User record metadata.
 * @returns {string} - Rendered HTML.
 */
function renderUserRow(u) {
    const isApproved = u.status === 'approved';
    
    return `
        <tr id="user-row-${u.id}" class="${u.status === 'pending' ? 'row-pending' : ''}">
            <td data-label="ID">${u.id}</td>
            <td data-label="Username"><span class="user-username">${escapeHtml(u.username)}</span></td>
            <td data-label="Email"><span class="user-email text-small">${escapeHtml(u.email)}</span></td>
            <td data-label="Discord ID">
                ${u.discord_id 
                    ? `<span class="user-discord text-small">${escapeHtml(u.discord_id)}</span>`
                    : `<span class="user-discord-empty">-</span>`
                }
            </td>
            <td data-label="Created"><span class="text-small">${u.created_at || '-'}</span></td>
            <td data-label="Approved">
                <label class="switch">
                    <input type="checkbox" onchange="approveUser(${u.id}, this)" ${isApproved ? 'checked disabled' : ''}>
                    <span class="slider slider-approved"></span>
                </label>
            </td>
            <td data-label="Admin">
                <label class="switch">
                    <input type="checkbox" onchange="toggleRole(${u.id}, 'admin', this.checked)" ${u.is_admin == 1 ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            </td>
            <td data-label="Family">
                <label class="switch">
                    <input type="checkbox" onchange="toggleRole(${u.id}, 'family', this.checked)" ${u.is_family == 1 ? 'checked' : ''}>
                    <span class="slider slider-family"></span>
                </label>
            </td>
            <td data-label="Actions">
                <div class="action-btns">
                    <button type="button" class="btn-icon-edit" onclick="openEditUserModal(${u.id})" title="Edit Profile">
                        ${getIcon('edit')}
                    </button>
                    <button type="button" class="btn-icon-delete" onclick="confirmDeleteUser(${u.id}, '${escapeHtml(u.username)}')" title="Delete Account">
                        ${getIcon('delete')}
                    </button>
                </div>
            </td>
        </tr>
    `;
}

/**
 * --- Interactive Logic ---
 */

/**
 * Pre-fills and displays the user editor.
 * 
 * @param {number} id - Target identifier.
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
    if (m) m.style.display = 'flex';
}

/**
 * Hides the user editor.
 * 
 * @returns {void}
 */
function closeEditModal() {
    const m = document.getElementById('editUserModal');
    if (m) m.style.display = 'none';
}

/**
 * --- API Interactions ---
 */

/**
 * Executes persistent profile modifications.
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
    btn.innerHTML = `${getIcon('waiting')} Saving...`;

    try {
        const result = await apiPost(`/users/update/${userId}`, new FormData(form));
        if (result && result.success) {
            closeEditModal();
            await loadState();
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Activates a pending account registration.
 * 
 * @async
 * @param {number} userId - Target identifier.
 * @param {HTMLInputElement} checkbox - The triggering toggle switch.
 * @returns {Promise<void>}
 */
async function approveUser(userId, checkbox) {
    if (!checkbox.checked) return;
    checkbox.disabled = true;

    const result = await apiPost(`/users/approve/${userId}`);
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
 * 
 * @async
 * @param {number} userId - Target identifier.
 * @param {string} role - Role key ('admin'|'family').
 * @param {boolean} value - Target status.
 * @returns {Promise<void>}
 */
async function toggleRole(userId, role, value) {
    const result = await apiPost('/users/toggle_role', { id: userId, role, value: value ? 1 : 0 });
    if (result && result.success) {
        const u = STATE.users.find(item => item.id == userId);
        if (u) {
            if (role === 'admin') u.is_admin = value ? 1 : 0;
            if (role === 'family') u.is_family = value ? 1 : 0;
            renderTable();
        }
    } else {
        renderTable();
    }
}

/**
 * Action: confirmDeleteUser (Admin)
 * Orchestrates the deletion flow for a user account.
 * 
 * @param {number} id - Target record ID.
 * @param {string} username - Account label.
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
                const row = document.getElementById(`user-row-${id}`);
                if (row) {
                    row.classList.add('row-fade-out');
                    setTimeout(() => {
                        STATE.users = STATE.users.filter(u => u.id != id);
                        renderTable();
                    }, 500);
                } else {
                    await loadState();
                }
            }
        }
    });
}

/**
 * Prevents XSS by sanitizing dynamic content.
 * 
 * @param {string} text - Raw input.
 * @returns {string} - Sanitized HTML.
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

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
