// /public/js/receipts.js

document.addEventListener('DOMContentLoaded', function() {
    const dropZone        = document.getElementById('dropZone');
    const fileInput       = document.getElementById('file');
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
                // Offer cropping for images, including HEIC/HEIF which browsers may not
                // flag with an image/ MIME type
                if (file.type.startsWith('image/') || lowerName.endsWith('.heic') || lowerName.endsWith('.heif')) {
                    initPreUploadCrop(file);
                }
            }
        });

        // Intercept form submission to show a blocking progress overlay.
        // Without this, the user sees nothing for 5-20s while the server runs
        // the ImageMagick pre-processing and Tesseract OCR pipeline (OCR.pm).
        // We locate the form via the file input rather than requiring a fixed ID.
        const uploadForm = fileInput.closest('form');
        if (uploadForm) {
            uploadForm.addEventListener('submit', function() {
                const submitBtn = uploadForm.querySelector('[type="submit"]');
                if (submitBtn) {
                    submitBtn.disabled    = true;
                    submitBtn.textContent = 'Processing...';
                }
                showUploadProgress();
            });
        }
    }

    // --- Upload Page Functions ---

    // Converts HEIC/HEIF to JPEG for browser display, then opens the crop
    // modal so the user can refine the image before it is uploaded.
    async function initPreUploadCrop(file) {
        let displayFile    = file;
        const lowerName    = file.name.toLowerCase();
        if (lowerName.endsWith('.heic') || lowerName.endsWith('.heif')) {
            showToast('Converting HEIC for preview...', 'info');
            try {
                const blob  = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.8 });
                // heic2any returns an array when the HEIC contains multiple frames
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
            const img   = document.getElementById('cropImg');
            if (modal && img) {
                img.src                 = e.target.result;
                modal.style.display     = 'flex';
                // Delay Cropper.js init to ensure the image is rendered and has dimensions
                setTimeout(() => {
                    if (cropper) cropper.destroy();
                    cropper = new Cropper(img, { viewMode: 1, autoCropArea: 1, responsive: true });
                }, 100);
            }
        };
        reader.readAsDataURL(displayFile);
    }

    // Reads the cropped canvas back into the file input via DataTransfer so
    // the cropped version — not the original — is sent with the form POST.
    window.applyPreUploadCrop = function() {
        if (!cropper) return;
        const canvas = cropper.getCroppedCanvas();
        canvas.toBlob((blob) => {
            const croppedFile = new File([blob], fileInput.files[0].name, {
                type: 'image/png',
                lastModified: new Date().getTime()
            });
            const dt   = new DataTransfer();
            dt.items.add(croppedFile);
            fileInput.files = dt.files;
            showToast('Image refined successfully!', 'success');
            closeCropModal();
        }, 'image/png');
    };

    // Updates the filename label beneath the drop zone after a file is selected
    // or a pre-upload crop is applied.
    function updateFileName(name) {
        if (fileNameDisplay) {
            fileNameDisplay.textContent = name;
            fileNameDisplay.style.display = 'block';
        }
    }

    // Builds and injects a full-page loading overlay with a spinner and cycling
    // status messages. Message timings are tuned to the OCR.pm pipeline:
    //   0s  — multipart upload transmitting to server
    //   3s  — ImageMagick: grayscale / unsharp / deskew / threshold
    //   6s  — Tesseract: primary pass (psm 6 / oem 1)
    //  11s  — Tesseract: fallback pass (200% resize, triggered when date or total absent)
    //  16s  — DB write and redirect
    // The overlay stays alive until the browser navigates away on server response.
    function showUploadProgress() {
        const overlay       = document.createElement('div');
        overlay.className   = 'upload-progress-overlay';
        overlay.innerHTML   = `
            <div class="upload-progress-inner">
                <div class="upload-spinner"></div>
                <p id="uploadProgressLabel" class="upload-progress-label">Uploading receipt...</p>
                <p class="upload-progress-sub">Please wait while we scan and extract details.</p>
            </div>
        `;
        document.body.appendChild(overlay);

        const stages = [
            [0,     'Uploading receipt...'],
            [3000,  'Processing image...'],
            [6000,  'Scanning for text...'],
            [11000, 'Extracting details...'],
            [16000, 'Almost done...'],
        ];
        stages.forEach(([delay, text]) => {
            setTimeout(() => {
                const label = document.getElementById('uploadProgressLabel');
                if (label) label.textContent = text;
            }, delay);
        });
    }

    // --- Receipt Viewer Modal ---

    window.openReceiptModal = function(id) {
        const modalImg = document.getElementById('modalImg');
        const modal    = document.getElementById('receiptModal');
        if (modalImg && modal) {
            modalImg.src            = '/receipts/serve/' + id;
            modal.style.display     = 'flex';
        }
    };

    window.closeReceiptModal = function() {
        const modal = document.getElementById('receiptModal');
        if (modal) modal.style.display = 'none';
    };

    // --- Edit Modal ---

    window.openEditModal = function(receipt) {
        const modal = document.getElementById('editModal');
        const form  = document.getElementById('editForm');
        if (modal && form) {
            form.action = '/receipts/update/' + receipt.id;
            document.getElementById('editStoreName').value   = receipt.store_name   || '';
            document.getElementById('editDate').value        = receipt.receipt_date || '';
            document.getElementById('editAmount').value      = receipt.total_amount || '';
            document.getElementById('editDescription').value = receipt.description  || '';
            modal.style.display = 'flex';
        }
    };

    window.closeEditModal = function() {
        const modal = document.getElementById('editModal');
        if (modal) modal.style.display = 'none';
    };

    // --- Crop Modal (post-upload, applied to existing records) ---

    let cropper      = null;
    let currentCropId = null;

    window.openCropModal = async function(id) {
        currentCropId    = id;
        const modal      = document.getElementById('cropModal');
        const img        = document.getElementById('cropImg');
        if (!(modal && img)) return;
        modal.style.display = 'flex';
        showToast('Loading image...', 'info');
        try {
            const response = await fetch('/receipts/serve/' + id);
            const blob     = await response.blob();
            let displayBlob = blob;
            // Server may store HEIC originals; convert before passing to Cropper.js
            if (blob.type === 'image/heic' || blob.type === 'image/heif') {
                showToast('Converting HEIC for preview...', 'info');
                const convertedBlob = await heic2any({ blob: blob, toType: 'image/jpeg', quality: 0.8 });
                displayBlob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
            }
            const reader = new FileReader();
            reader.onload = function(e) {
                img.src = e.target.result;
                // Defer Cropper.js init until the img element has painted and has dimensions
                img.onload = function() {
                    if (cropper) cropper.destroy();
                    cropper = new Cropper(img, { viewMode: 1, autoCropArea: 1, responsive: true });
                    showToast('Ready to crop.', 'success');
                };
            };
            reader.readAsDataURL(displayBlob);
        } catch (err) {
            console.error('Failed to load image for cropping:', err);
            showToast('Error loading image.', 'error');
            closeCropModal();
        }
    };

    window.closeCropModal = function() {
        if (cropper) {
            cropper.destroy();
            cropper = null;
        }
        const cropModal = document.getElementById('cropModal');
        if (cropModal) cropModal.style.display = 'none';
        // Restore the filename label if we were in pre-upload crop mode and the
        // user cancelled; the original file selection is still intact
        if (fileInput && fileInput.files.length > 0) {
            updateFileName(fileInput.files[0].name);
        } else if (fileNameDisplay) {
            fileNameDisplay.textContent  = '';
            fileNameDisplay.style.display = 'none';
        }
    };

    // POSTs the cropped canvas blob to the server to replace the stored binary.
    // Uses fetch so the page does not reload mid-crop.
    window.saveCrop = async function() {
        if (!cropper || !currentCropId) return;
        const canvas = cropper.getCroppedCanvas();
        canvas.toBlob(async (blob) => {
            const formData = new FormData();
            formData.append('cropped_image', blob, 'receipt_cropped.png');
            try {
                const response = await fetch('/receipts/crop/' + currentCropId, {
                    method: 'POST',
                    body:   formData
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

    // --- OCR Trigger ---

    // Sends an AJAX request to re-run OCR on an already-stored image, then
    // pre-fills the edit modal with extracted data for user review before saving.
    window.triggerOCR = function(id) {
        const btn             = document.getElementById('ocr-btn-' + id);
        const originalContent = btn.innerHTML;
        btn.disabled   = true;
        btn.innerHTML  = '...';
        showToast('Scanning receipt... please wait.', 'info');
        fetch('/receipts/ocr/' + id, { method: 'POST' })
            .then(r => r.json())
            .then(data => {
                btn.disabled  = false;
                btn.innerHTML = originalContent;
                if (data.success) {
                    showToast('OCR complete! Reviewing details.', 'success');
                    openEditModal({
                        id:           id,
                        store_name:   data.store_name,
                        receipt_date: data.receipt_date,
                        total_amount: data.total_amount,
                        description:  data.raw_text
                    });
                } else {
                    showToast('OCR failed: ' + (data.error || 'Unknown error'), 'error');
                }
            })
            .catch(() => {
                btn.disabled  = false;
                btn.innerHTML = originalContent;
                showToast('Server error during scan.', 'error');
            });
    };

    // Close any open modal when the user clicks the darkened overlay behind it
    window.addEventListener('click', function(e) {
        const receiptModal = document.getElementById('receiptModal');
        const editModal    = document.getElementById('editModal');
        const cropModal    = document.getElementById('cropModal');
        if (e.target === receiptModal) closeReceiptModal();
        if (e.target === editModal)    closeEditModal();
        if (e.target === cropModal)    closeCropModal();
    });
});
