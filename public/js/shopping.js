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

function editItem(id, currentName) {
    const modal = document.getElementById('editModal');
    const form = document.getElementById('editForm');
    const editId = document.getElementById('editId');
    const editName = document.getElementById('editName');
    
    // Set form action
    form.action = '/shopping/edit/' + id;
    
    // Set values
    editId.value = id;
    editName.value = currentName;
    
    // Show modal
    modal.style.display = 'flex';
    
    // Focus on input
    setTimeout(() => {
        editName.focus();
        editName.select();
    }, 100);
}

function closeEditModal() {
    const modal = document.getElementById('editModal');
    modal.style.display = 'none';
}

// Close modal on escape key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeEditModal();
    }
});

// Close modal when clicking outside
document.addEventListener('click', function(e) {
    const modal = document.getElementById('editModal');
    if (e.target === modal) {
        closeEditModal();
    }
});
