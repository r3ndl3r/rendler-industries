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
                const file = this.files[0];
                updateFileName(file.name);
                
                const lowerName = file.name.toLowerCase();
                // If it's an image (including HEIC/HEIF which browser might not flag as image/), offer cropping
                if (file.type.startsWith('image/') || lowerName.endsWith('.heic') || lowerName.endsWith('.heif')) {
                    initPreUploadCrop(file);
                }
            }
        });

        async function initPreUploadCrop(file) {
            let displayFile = file;

            // Handle HEIC/HEIF conversion for browser display
            const lowerName = file.name.toLowerCase();
            if (lowerName.endsWith('.heic') || lowerName.endsWith('.heif')) {
                showToast('Converting HEIC for preview...', 'info');
                try {
                    const blob = await heic2any({
                        blob: file,
                        toType: 'image/jpeg',
                        quality: 0.8
                    });
                    // If multiple images in HEIC, it returns array. Take first.
                    displayFile = Array.isArray(blob) ? blob[0] : blob;
                } catch (err) {
                    console.error('HEIC conversion failed:', err);
                    showToast('Could not convert HEIC for preview.', 'error');
                    return;
                }
            }

            const reader = new FileReader();
            reader.onload = function(e) {
                const modal = document.getElementById('cropModal');
                const img = document.getElementById('cropImg');
                if (modal && img) {
                    img.src = e.target.result;
                    modal.style.display = 'flex';
                    
                    // Delay init to ensure image is visible
                    setTimeout(() => {
                        if (cropper) cropper.destroy();
                        cropper = new Cropper(img, {
                            viewMode: 1,
                            autoCropArea: 1,
                            responsive: true
                        });
                    }, 100);
                }
            };
            reader.readAsDataURL(displayFile);
        }

        window.applyPreUploadCrop = function() {
            if (!cropper) return;
            
            const canvas = cropper.getCroppedCanvas();
            canvas.toBlob((blob) => {
                // Create a new File object from the blob
                const croppedFile = new File([blob], fileInput.files[0].name, {
                    type: 'image/png',
                    lastModified: new Date().getTime()
                });

                // Use DataTransfer to programmatically set the file input
                const dt = new DataTransfer();
                dt.items.add(croppedFile);
                fileInput.files = dt.files;

                showToast('Image refined successfully!', 'success');
                closeCropModal();
            }, 'image/png');
        };

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

    // Crop Modal Handlers
    let cropper = null;
    let currentCropId = null;

    window.openCropModal = async function(id) {
        currentCropId = id;
        const modal = document.getElementById('cropModal');
        const img = document.getElementById('cropImg');
        
        if (modal && img) {
            modal.style.display = 'flex';
            showToast('Loading image...', 'info');

            try {
                const response = await fetch('/receipts/serve/' + id);
                const blob = await response.blob();
                let displayBlob = blob;

                // Check for HEIC/HEIF MIME types or file extension
                if (blob.type === 'image/heic' || blob.type === 'image/heif') {
                    showToast('Converting HEIC for preview...', 'info');
                    const convertedBlob = await heic2any({
                        blob: blob,
                        toType: 'image/jpeg',
                        quality: 0.8
                    });
                    displayBlob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
                }

                const reader = new FileReader();
                reader.onload = function(e) {
                    img.src = e.target.result;
                    
                    // Wait for image to load before initializing cropper
                    img.onload = function() {
                        if (cropper) cropper.destroy();
                        cropper = new Cropper(img, {
                            viewMode: 1,
                            autoCropArea: 1,
                            responsive: true
                        });
                        showToast('Ready to crop.', 'success');
                    };
                };
                reader.readAsDataURL(displayBlob);

            } catch (err) {
                console.error('Failed to load image for cropping:', err);
                showToast('Error loading image.', 'error');
                closeCropModal();
            }
        }
    };

    window.closeCropModal = function() {
        if (cropper) {
            cropper.destroy();
            cropper = null;
        }
        document.getElementById('cropModal').style.display = 'none';
        
        // If we were in pre-upload and cancelled without applying, 
        // the file is still selected but maybe user wants to re-select.
        // We ensure the filename display is still accurate.
        if (fileInput && fileInput.files.length > 0) {
            updateFileName(fileInput.files[0].name);
        } else if (fileNameDisplay) {
            fileNameDisplay.textContent = '';
            fileNameDisplay.style.display = 'none';
        }
    };

    window.saveCrop = async function() {
        if (!cropper || !currentCropId) return;

        const canvas = cropper.getCroppedCanvas();
        canvas.toBlob(async (blob) => {
            const formData = new FormData();
            formData.append('cropped_image', blob, 'receipt_cropped.png');

            try {
                const response = await fetch('/receipts/crop/' + currentCropId, {
                    method: 'POST',
                    body: formData
                });
                const result = await response.json();

                if (result.success) {
                    showToast('Receipt cropped successfully!', 'success');
                    closeCropModal();
                    setTimeout(() => window.location.reload(), 1000);
                } else {
                    showToast('Failed to save crop: ' + (result.error || 'Unknown error'), 'error');
                }
            } catch (err) {
                showToast('Request failed', 'error');
            }
        }, 'image/png');
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
        const cropModal = document.getElementById('cropModal');
        if (e.target === receiptModal) closeReceiptModal();
        if (e.target === editModal) closeEditModal();
        if (e.target === cropModal) closeCropModal();
    });
});
