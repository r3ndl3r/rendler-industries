// /public/js/shopping.js

document.addEventListener('DOMContentLoaded', function() {
    // Auto-focus on the add item input
    const itemInput = document.querySelector('input[name="item_name"]');
    if (itemInput) {
        itemInput.focus();
    }
    
    // Add keyboard shortcut for quick add (Ctrl/Cmd + Enter)
    if (itemInput) {
        itemInput.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                const form = this.closest('form');
                if (form) {
                    form.submit();
                }
            }
        });
    }
    
    // Animate new items when page loads
    const items = document.querySelectorAll('.shopping-item');
    items.forEach((item, index) => {
        item.style.opacity = '0';
        item.style.transform = 'translateY(10px)';
        
        setTimeout(() => {
            item.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            item.style.opacity = '1';
            item.style.transform = 'translateY(0)';
        }, index * 50);
    });
    
    // Add smooth scroll to checked section if it exists
    const checkedSection = document.querySelector('.checked-section');
    if (checkedSection && window.location.hash === '#checked') {
        setTimeout(() => {
            checkedSection.scrollIntoView({ behavior: 'smooth' });
        }, 100);
    }
    
    // Prevent double submission
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
        form.addEventListener('submit', function(e) {
            const submitBtn = this.querySelector('button[type="submit"]');
            if (submitBtn && submitBtn.disabled) {
                e.preventDefault();
                return false;
            }
            
            if (submitBtn) {
                submitBtn.disabled = true;
                
                // Re-enable after 2 seconds as fallback
                setTimeout(() => {
                    submitBtn.disabled = false;
                }, 2000);
            }
        });
    });
    
    // Add item count to title
    updateItemCount();
});

function updateItemCount() {
    const uncheckedItems = document.querySelectorAll('.shopping-item:not(.checked)');
    const count = uncheckedItems.length;
    
    if (count > 0) {
        document.title = `(${count}) Shopping List`;
    } else {
        document.title = 'Shopping List';
    }
}

// Modal handling
function editItem(id, currentName) {
    const modal = document.getElementById('editModal');
    const form = document.getElementById('editForm');
    const editId = document.getElementById('editId');
    const editName = document.getElementById('editName');
    
    if (modal && form && editId && editName) {
        form.action = '/shopping/edit/' + id;
        editId.value = id;
        editName.value = currentName;
        modal.style.display = 'flex';
        
        setTimeout(() => {
            editName.focus();
            editName.select();
        }, 100);
    }
}

function closeEditModal() {
    const modal = document.getElementById('editModal');
    if (modal) modal.style.display = 'none';
}

function openDeleteModal(id, itemName) {
    const modal = document.getElementById('deleteModal');
    const form = document.getElementById('deleteForm');
    const deleteItemName = document.getElementById('deleteItemName');
    
    if (modal && form && deleteItemName) {
        form.action = '/shopping/delete/' + id;
        deleteItemName.textContent = itemName;
        modal.style.display = 'flex';
    }
}

function closeDeleteModal() {
    const modal = document.getElementById('deleteModal');
    if (modal) modal.style.display = 'none';
}

function openClearAllModal() {
    const modal = document.getElementById('clearAllModal');
    if (modal) modal.style.display = 'flex';
}

function closeClearAllModal() {
    const modal = document.getElementById('clearAllModal');
    if (modal) modal.style.display = 'none';
}

// Close modals on escape key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeEditModal();
        closeDeleteModal();
        closeClearAllModal();
    }
});

// Close modal when clicking outside
document.addEventListener('click', function(e) {
    const editModal = document.getElementById('editModal');
    const deleteModal = document.getElementById('deleteModal');
    const clearAllModal = document.getElementById('clearAllModal');
    
    if (e.target === editModal) closeEditModal();
    if (e.target === deleteModal) closeDeleteModal();
    if (e.target === clearAllModal) closeClearAllModal();
});

// Toast Notification Function (matching the one in go.js/files.js)
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
