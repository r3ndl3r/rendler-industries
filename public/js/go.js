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
                // Visual feedback for successful copy (Green Checkmark)
                const originalHTML = this.innerHTML;
                this.innerHTML = `<svg width="16" height="16" fill="none" stroke="#4ade80" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
                
                setTimeout(() => {
                    this.innerHTML = originalHTML;
                }, 2000);
            }).catch(err => {
                console.error('Failed to copy text: ', err);
            });
        });
    });
});

// Populates and displays the edit modal for a specific go link.
// Parameters:
//   id          : DB ID of the link (Int)
//   keyword     : Current short keyword (String)
//   url         : Current destination URL (String)
//   description : Current description (String)
// Returns: Void
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

// Hides the edit modal and resets visibility state.
// Parameters: None
// Returns: Void
function closeEditModal() {
    const modal = document.getElementById('editModal');
    modal.style.display = 'none';
}

// Close modal on escape key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        const modal = document.getElementById('editModal');
        if (modal && modal.style.display === 'flex') {
            closeEditModal();
        }
    }
});

// Close modal when clicking outside the content box
document.addEventListener('click', function(e) {
    const modal = document.getElementById('editModal');
    if (e.target === modal) {
        closeEditModal();
    }
});