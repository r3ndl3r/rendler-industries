/* /public/js/users.js */

/**
 * Toggles a user role via AJAX.
 * @param {number} userId - The ID of the user to update.
 * @param {string} role - 'admin' or 'family'.
 * @param {boolean} value - True for enabled, false for disabled.
 */
async function toggleRole(userId, role, value) {
    const data = {
        id: userId,
        role: role,
        value: value ? 1 : 0
    };

    const result = await apiPost('/users/toggle_role', data);
    if (!result || !result.success) {
        location.reload();
    }
}

// Handle Forms and Listeners
document.addEventListener('DOMContentLoaded', function() {
    const editForm = document.getElementById('editUserForm');
    if (editForm) {
        editForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const btn = this.querySelector('button[type="submit"]');
            const originalHtml = btn.innerHTML;
            const userId = document.getElementById('editUserId').value;
            const formData = new FormData(this);
            
            btn.disabled = true;
            btn.innerHTML = `${getIcon('waiting')} Saving...`;

            const result = await apiPost(`/users/update/${userId}`, Object.fromEntries(formData));
            
            // Always reset button state before closing or on error
            btn.disabled = false;
            btn.innerHTML = originalHtml;

            if (result && result.success) {
                closeEditModal();
                
                // Dynamic DOM Update
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
                        const approveBtn = row.querySelector('.btn-icon-view');
                        if (approveBtn) approveBtn.closest('form')?.remove();
                    } else {
                        statusCell.innerHTML = '<span class="status-badge status-pending">Pending</span>';
                    }
                }
            }
        });
    }

    // Use global modal closing helper
    setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay'], [
        closeEditModal, closeConfirmModal
    ]);
});

async function approveUser(userId, formEl) {
    const btn = formEl.querySelector('button');
    const originalHtml = btn.innerHTML;
    
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')}`;

    const result = await apiPost(`/users/approve/${userId}`);
    if (result && result.success) {
        const row = document.getElementById(`user-row-${userId}`);
        if (row) {
            const statusCell = row.querySelector('.user-status-cell');
            statusCell.innerHTML = '<span class="status-badge status-approved">Approved</span>';
            formEl.remove();
        }
    } else {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

function openEditUserModal(user) {
    const modal = document.getElementById('editUserModal');
    document.getElementById('editUserId').value = user.id;
    document.getElementById('editUsername').value = user.username;
    document.getElementById('editEmail').value = user.email;
    document.getElementById('editDiscordId').value = user.discord_id || '';
    document.getElementById('editStatus').value = user.status || 'pending';
    document.getElementById('editPassword').value = ''; 
    
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
}

function closeEditModal() {
    document.getElementById('editUserModal').style.display = 'none';
    document.body.classList.remove('modal-open');
}

function confirmDeleteUser(id, username) {
    showConfirmModal({
        title: 'Delete User',
        message: `Are you sure you want to permanently delete user "<strong>${username}</strong>"?`,
        danger: true,
        confirmText: 'Delete User',
        loadingText: 'Deleting...',
        onConfirm: async () => {
            const result = await apiPost(`/users/delete/${id}`);
            if (result && result.success) {
                const row = document.getElementById(`user-row-${id}`);
                if (row) {
                    row.classList.add('row-fade-out');
                    setTimeout(() => row.remove(), 500);
                }
            }
        }
    });
}
