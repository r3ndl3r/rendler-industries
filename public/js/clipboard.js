/* /public/js/clipboard.js */

let messageIdToDelete = null;

function openModal() {
    document.getElementById('modalTitle').textContent = 'Add New Content';
    document.getElementById('messageId').value = '';
    document.getElementById('paste').value = '';
    document.getElementById('contentForm').action = '/clipboard';
    document.getElementById('contentModal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('contentModal').style.display = 'none';
}

function editMessage(id, btn) {
    const text = btn.getAttribute('data-text');
    document.getElementById('modalTitle').textContent = 'Edit Content';
    document.getElementById('messageId').value = id;
    
    // Create a temporary element to decode HTML entities
    const doc = new DOMParser().parseFromString(text, 'text/html');
    document.getElementById('paste').value = doc.documentElement.textContent;
    
    document.getElementById('contentForm').action = '/clipboard/update';
    document.getElementById('contentModal').style.display = 'flex';
}

function removeMessage(id) {
    messageIdToDelete = id;
    document.getElementById('deleteModal').style.display = 'flex';
}

function closeDeleteModal() {
    messageIdToDelete = null;
    document.getElementById('deleteModal').style.display = 'none';
}

function copyToClipboard(btn) {
    const text = btn.getAttribute('data-text');
    // Decode HTML entities
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const cleanText = doc.documentElement.textContent;

    navigator.clipboard.writeText(cleanText).then(() => {
        showToast('Copied to clipboard!', 'success');
    }).catch(err => {
        console.error('Could not copy text: ', err);
        showToast('Failed to copy', 'error');
    });
}

document.addEventListener('DOMContentLoaded', function() {
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    if (confirmBtn) {
        confirmBtn.onclick = function() {
            if (messageIdToDelete) {
                $.post('/clipboard/delete/' + messageIdToDelete, function() {
                    location.reload();
                }).fail(function() {
                    showToast('Unauthorized: You are not allowed to delete messages.', 'error');
                    closeDeleteModal();
                });
            }
        };
    }
});

// Close modals when clicking outside
window.onclick = function(event) {
    const contentModal = document.getElementById('contentModal');
    const deleteModal = document.getElementById('deleteModal');
    
    if (event.target == contentModal) {
        closeModal();
    }
    if (event.target == deleteModal) {
        closeDeleteModal();
    }
}

function textIn() {
    document.getElementById("paste").style.backgroundColor = "#1e293b";
}
