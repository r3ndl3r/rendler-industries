// public/js/receipts.js

document.addEventListener('DOMContentLoaded', function() {
    console.log('Receipts module loaded');

    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('file');
    const fileNameDisplay = document.getElementById('fileName');

    if (dropZone && fileInput) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, e => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
        });

        dropZone.addEventListener('drop', e => {
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                fileInput.files = files;
                updateFileName(files[0].name);
            }
        }, false);

        fileInput.addEventListener('change', function() {
            if (this.files.length > 0) {
                updateFileName(this.files[0].name);
            }
        });

        function updateFileName(name) {
            if (fileNameDisplay) {
                fileNameDisplay.textContent = name;
                fileNameDisplay.style.display = 'block';
            }
        }
    }

    // Global Modal Handlers
    window.openReceiptModal = function(id) {
        const modalImg = document.getElementById('modalImg');
        const modal = document.getElementById('receiptModal');
        if (modalImg && modal) {
            modalImg.src = '/receipts/serve/' + id;
            modal.style.display = 'flex';
        }
    };

    window.closeReceiptModal = function() {
        const modal = document.getElementById('receiptModal');
        if (modal) modal.style.display = 'none';
    };

    // Edit Modal Handlers
    window.openEditModal = function(receipt) {
        const modal = document.getElementById('editModal');
        const form = document.getElementById('editForm');
        if (modal && form) {
            form.action = '/receipts/update/' + receipt.id;
            document.getElementById('editStoreName').value = receipt.store_name || '';
            document.getElementById('editDate').value = receipt.receipt_date || '';
            document.getElementById('editAmount').value = receipt.total_amount || '';
            document.getElementById('editDescription').value = receipt.description || '';
            modal.style.display = 'flex';
        }
    };

    window.closeEditModal = function() {
        const modal = document.getElementById('editModal');
        if (modal) modal.style.display = 'none';
    };

    // AJAX OCR Trigger
    window.triggerOCR = function(id) {
        const btn = document.getElementById('ocr-btn-' + id);
        const originalContent = btn.innerHTML;
        
        btn.disabled = true;
        btn.innerHTML = '...';
        showToast('Scanning receipt... please wait.', 'info');

        $.post('/receipts/ocr/' + id, function(data) {
            btn.disabled = false;
            btn.innerHTML = originalContent;

            if (data.success) {
                showToast('OCR complete! Reviewing details.', 'success');
                // Open edit modal with new data
                openEditModal({
                    id: id,
                    store_name: data.store_name,
                    receipt_date: data.receipt_date,
                    total_amount: data.total_amount,
                    description: data.raw_text
                });
            } else {
                showToast('OCR failed: ' + (data.error || 'Unknown error'), 'error');
            }
        }).fail(function(xhr) {
            btn.disabled = false;
            btn.innerHTML = originalContent;
            showToast('Server error during scan.', 'error');
        });
    };

    // Close modals on overlay click
    window.addEventListener('click', function(e) {
        const receiptModal = document.getElementById('receiptModal');
        const editModal = document.getElementById('editModal');
        if (e.target === receiptModal) closeReceiptModal();
        if (e.target === editModal) closeEditModal();
    });
});
