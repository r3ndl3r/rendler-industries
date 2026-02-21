/* /public/js/go.js */

document.addEventListener('DOMContentLoaded', function() {
    // Handle Copy Buttons
    document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const url = this.dataset.url;
            
            navigator.clipboard.writeText(url).then(() => {
                showToast('Link copied to clipboard!', 'success');
            }).catch(err => {
                console.error('Could not copy text: ', err);
                showToast('Failed to copy link', 'error');
            });
        });
    });
});

// Modal Logic
function editLink(id, keyword, url, description) {
    document.getElementById('editId').value = id;
    document.getElementById('editKeyword').value = keyword;
    document.getElementById('editUrl').value = url;
    document.getElementById('editDescription').value = description;
    document.getElementById('editModal').style.display = 'flex';
}

function closeEditModal() {
    document.getElementById('editModal').style.display = 'none';
}

function openDeleteModal(id, keyword) {
    document.getElementById('deleteId').value = id;
    document.getElementById('deleteKeyword').textContent = 'g/' + keyword;
    document.getElementById('deleteModal').style.display = 'flex';
}

function closeDeleteModal() {
    document.getElementById('deleteModal').style.display = 'none';
}

// Close modals when clicking outside
window.onclick = function(event) {
    const editModal = document.getElementById('editModal');
    const deleteModal = document.getElementById('deleteModal');
    
    if (event.target == editModal) closeEditModal();
    if (event.target == deleteModal) closeDeleteModal();
}
