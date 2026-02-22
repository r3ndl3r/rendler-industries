/* /public/js/swear.js */

function updateFine() {
    const select = document.getElementById('perp_select');
    const amountInput = document.getElementById('fine_amount');
    const selectedOption = select.options[select.selectedIndex];
    const defaultFine = selectedOption.getAttribute('data-fine');
    
    if (defaultFine && defaultFine > 0) {
        amountInput.value = defaultFine;
    }
}

function openImageModal(src) {
    const modal = document.getElementById('imageModal');
    const img = document.getElementById('modalImage');
    img.src = src;
    modal.style.display = 'flex';
}

function closeImageModal() {
    const modal = document.getElementById('imageModal');
    modal.style.display = 'none';
}

// Close modal when clicking outside the content
window.onclick = function(event) {
    const modal = document.getElementById('imageModal');
    if (event.target == modal) {
        closeImageModal();
    }
}
