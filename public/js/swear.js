/* /public/js/swear.js */

function updateFine() {
    const select = document.getElementById('perp_select');
    const amountInput = document.getElementById('fine_amount');
    const selectedOption = select.options[select.selectedIndex];
    if (!selectedOption) return;
    
    const defaultFine = selectedOption.getAttribute('data-fine');
    
    if (defaultFine && defaultFine > 0) {
        amountInput.value = defaultFine;
    }
}

function openImageModal(src) {
    const modal = document.getElementById('imageModal');
    const img = document.getElementById('modalImage');
    if (img) img.src = src;
    if (modal) modal.style.display = 'flex';
}

function closeImageModal() {
    const modal = document.getElementById('imageModal');
    if (modal) modal.style.display = 'none';
}

function confirmDeleteMember(id, name) {
    const modal = document.getElementById('deleteConfirmModal');
    const nameEl = document.getElementById('deleteMemberName');
    const idInput = document.getElementById('deleteMemberId');
    
    if (nameEl) nameEl.textContent = name;
    if (idInput) idInput.value = id;
    if (modal) modal.style.display = 'flex';
}

function closeDeleteModal() {
    const modal = document.getElementById('deleteConfirmModal');
    if (modal) modal.style.display = 'none';
}

// Close modals when clicking outside
window.onclick = function(event) {
    const imageModal = document.getElementById('imageModal');
    const deleteModal = document.getElementById('deleteConfirmModal');
    
    if (event.target == imageModal) {
        closeImageModal();
    }
    if (event.target == deleteModal) {
        closeDeleteModal();
    }
}
