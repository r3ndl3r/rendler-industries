// /public/js/go.js

document.addEventListener('DOMContentLoaded', function() {
    // Auto-focus on the add keyword input
    const keywordInput = document.querySelector('input[name="keyword"]');
    if (keywordInput) {
        keywordInput.focus();
    }
    
    // Add keyboard shortcut for quick add (Ctrl/Cmd + Enter)
    if (keywordInput) {
        keywordInput.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                const form = this.closest('form');
                if (form) {
                    form.submit();
                }
            }
        });
    }
    
    // Animate new items when page loads
    const items = document.querySelectorAll('.go-item');
    items.forEach((item, index) => {
        item.style.opacity = '0';
        item.style.transform = 'translateY(10px)';
        
        setTimeout(() => {
            item.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            item.style.opacity = '1';
            item.style.transform = 'translateY(0)';
        }, index * 50);
    });

    // Setup Copy Link functionality to clipboard
    const copyButtons = document.querySelectorAll('.copy-btn');
    copyButtons.forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            const urlToCopy = this.getAttribute('data-url');
            
            navigator.clipboard.writeText(urlToCopy).then(() => {
                showToast('Link copied to clipboard!', 'success');
                
                // Visual feedback on the button itself (temporary checkmark)
                const originalHTML = this.innerHTML;
                this.innerHTML = `<svg width="16" height="16" fill="none" stroke="#4ade80" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
                
                setTimeout(() => {
                    this.innerHTML = originalHTML;
                }, 2000);
            }).catch(err => {
                console.error('Failed to copy text: ', err);
                showToast('Failed to copy link', 'error');
            });
        });
    });
});

// Populates and displays the edit modal for a specific go link.
function editLink(id, keyword, url, description) {
    const modal = document.getElementById('editModal');
    const editId = document.getElementById('editId');
    const editKeyword = document.getElementById('editKeyword');
    const editUrl = document.getElementById('editUrl');
    const editDescription = document.getElementById('editDescription');
    
    // Set values
    editId.value = id;
    editKeyword.value = keyword;
    editUrl.value = url;
    editDescription.value = description || '';
    
    // Show modal
    modal.style.display = 'flex';
    
    // Focus on input
    setTimeout(() => {
        editKeyword.focus();
        editKeyword.select();
    }, 100);
}

function closeEditModal() {
    const modal = document.getElementById('editModal');
    if (modal) modal.style.display = 'none';
}

// Populates and displays the delete modal.
function openDeleteModal(id, keyword) {
    const modal = document.getElementById('deleteModal');
    const deleteId = document.getElementById('deleteId');
    const deleteKeyword = document.getElementById('deleteKeyword');
    
    if (modal && deleteId && deleteKeyword) {
        deleteId.value = id;
        deleteKeyword.textContent = `g/${keyword}`;
        modal.style.display = 'flex';
    }
}

function closeDeleteModal() {
    const modal = document.getElementById('deleteModal');
    if (modal) modal.style.display = 'none';
}

// Close modals on escape key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeEditModal();
        closeDeleteModal();
    }
});

// Close modal when clicking outside the content box
document.addEventListener('click', function(e) {
    const editModal = document.getElementById('editModal');
    const deleteModal = document.getElementById('deleteModal');
    if (e.target === editModal) closeEditModal();
    if (e.target === deleteModal) closeDeleteModal();
});

// Toast Notification Function (matching the one in files.js)
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem 1.5rem;
        border-radius: 12px;
        color: white;
        font-weight: 500;
        z-index: 10000;
        transform: translateX(400px);
        transition: transform 0.3s ease;
        backdrop-filter: blur(10px);
    `;

    if (type === 'success') {
        toast.style.background = 'rgba(76, 175, 80, 0.95)';
        toast.style.border = '1px solid rgba(76, 175, 80, 0.3)';
    } else if (type === 'error') {
        toast.style.background = 'rgba(239, 68, 68, 0.95)';
        toast.style.border = '1px solid rgba(239, 68, 68, 0.3)';
    } else {
        toast.style.background = 'rgba(59, 130, 246, 0.95)';
        toast.style.border = '1px solid rgba(59, 130, 246, 0.3)';
    }

    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.transform = 'translateX(0)';
    }, 100);

    setTimeout(() => {
        toast.style.transform = 'translateX(400px)';
        setTimeout(() => {
            if (toast.parentNode) {
                document.body.removeChild(toast);
            }
        }, 300);
    }, 3000);
}
