/* /public/js/users.js */

/**
 * Toggles a user role via AJAX.
 * @param {number} userId - The ID of the user to update.
 * @param {string} role - 'admin' or 'family'.
 * @param {boolean} value - True for enabled, false for disabled.
 */
function toggleRole(userId, role, value) {
    const data = {
        id: userId,
        role: role,
        value: value ? 1 : 0
    };

    $.post('/users/toggle_role', data, function(result) {
        if (result.success) {
            showToast(`${role.charAt(0).toUpperCase() + role.slice(1)} role updated`, 'success');
        } else {
            showToast('Error: ' + result.error, 'error');
            location.reload();
        }
    }).fail(function() {
        showToast('Request failed', 'error');
        location.reload();
    });
}

// Handle Edit Form Submission via AJAX
document.addEventListener('DOMContentLoaded', function() {
    const editForm = document.getElementById('editUserForm');
    if (editForm) {
        editForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const formData = new FormData(this);
            const url = this.action;
            const userId = document.getElementById('editUserId').value;
            
            fetch(url, {
                method: 'POST',
                headers: { 'X-Requested-With': 'XMLHttpRequest' },
                body: new URLSearchParams(formData)
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    showToast(data.message, 'success');
                    closeEditModal();
                    
                    // Dynamic DOM Update
                    const row = document.getElementById(`user-row-${userId}`);
                    if (row) {
                        // Update basic fields
                        row.querySelector('.user-username').textContent = formData.get('username');
                        row.querySelector('.user-email').textContent = formData.get('email');
                        
                        const discordEl = row.querySelector('.user-discord');
                        const discordId = formData.get('discord_id');
                        if (discordId) {
                            discordEl.textContent = discordId;
                            discordEl.style.color = '#7289da';
                            discordEl.style.opacity = '1';
                        } else {
                            discordEl.textContent = '-';
                            discordEl.style.color = '';
                            discordEl.style.opacity = '0.3';
                        }

                        // Update Status Badge
                        const statusCell = row.querySelector('.user-status-cell');
                        const status = formData.get('status');
                        if (status === 'approved') {
                            statusCell.innerHTML = '<span class="status-badge status-approved">Approved</span>';
                            // Remove approve button if it exists
                            const approveBtn = row.querySelector('form[action*="/approve"]');
                            if (approveBtn) approveBtn.remove();
                        } else {
                            statusCell.innerHTML = '<span class="status-badge status-pending">Pending</span>';
                        }
                    }
                } else {
                    showToast(data.error || 'Update failed', 'error');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                showToast('Request failed', 'error');
            });
        });
    }

    // Handle Delete Form Submission via AJAX
    const deleteForm = document.getElementById('deleteUserForm');
    if (deleteForm) {
        deleteForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const url = this.action;
            // Extract ID from action URL (last segment)
            const userId = url.substring(url.lastIndexOf('/') + 1);
            
            fetch(url, {
                method: 'POST',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    showToast(data.message, 'success');
                    closeDeleteModal();
                    
                    // Dynamic DOM Update: Fade out and remove row
                    const row = document.getElementById(`user-row-${userId}`);
                    if (row) {
                        row.style.transition = 'all 0.5s ease';
                        row.style.opacity = '0';
                        row.style.transform = 'translateX(20px)';
                        setTimeout(() => row.remove(), 500);
                    }
                } else {
                    showToast(data.error || 'Delete failed', 'error');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                showToast('Request failed', 'error');
            });
        });
    }
    
    // Handle Approve Forms (Inline)
    document.querySelectorAll('form[action^="/users/approve"]').forEach(form => {
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            const url = this.action;
            const userId = url.substring(url.lastIndexOf('/') + 1);
            
            fetch(url, {
                method: 'POST',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    showToast(data.message, 'success');
                    
                    // Dynamic DOM Update
                    const row = document.getElementById(`user-row-${userId}`);
                    if (row) {
                        const statusCell = row.querySelector('.user-status-cell');
                        statusCell.innerHTML = '<span class="status-badge status-approved">Approved</span>';
                        this.remove(); // Remove the form/button itself
                    }
                } else {
                    showToast(data.error || 'Approval failed', 'error');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                showToast('Request failed', 'error');
            });
        });
    });
});

function openEditUserModal(user) {
    const modal = document.getElementById('editUserModal');
    const form = document.getElementById('editUserForm');
    
    // Set form action
    form.action = `/users/update/${user.id}`;
    
    // Populate fields
    document.getElementById('editUserId').value = user.id;
    document.getElementById('editUsername').value = user.username;
    document.getElementById('editEmail').value = user.email;
    document.getElementById('editDiscordId').value = user.discord_id || '';
    document.getElementById('editStatus').value = user.status || 'pending';
    document.getElementById('editPassword').value = ''; // Always clear password
    
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeEditModal() {
    document.getElementById('editUserModal').style.display = 'none';
    document.body.style.overflow = 'auto';
}

function confirmDeleteUser(id, username) {
    const modal = document.getElementById('deleteConfirmModal');
    const nameEl = document.getElementById('deleteUserName');
    const form = document.getElementById('deleteUserForm');
    
    if (nameEl) nameEl.textContent = username;
    if (form) form.action = '/users/delete/' + id;
    if (modal) modal.style.display = 'flex';
}

function closeDeleteModal() {
    const modal = document.getElementById('deleteConfirmModal');
    if (modal) modal.style.display = 'none';
}

// Close modal when clicking outside
window.onclick = function(event) {
    const editModal = document.getElementById('editUserModal');
    const deleteModal = document.getElementById('deleteConfirmModal');
    
    if (event.target == editModal) closeEditModal();
    if (event.target == deleteModal) closeDeleteModal();
}
