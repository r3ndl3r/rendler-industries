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
            // Revert the checkbox on failure (optional, but good UX)
            location.reload();
        }
    }).fail(function() {
        showToast('Request failed', 'error');
        location.reload();
    });
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
    const modal = document.getElementById('deleteConfirmModal');
    if (event.target == modal) {
        closeDeleteModal();
    }
}
