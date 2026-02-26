// /public/js/receipts.js

/**
 * Receipt Management and AI Analysis Logic
 */

// Define functions first to ensure they are available for hoisting/reference
function closeReceiptModal() {
    const modal = document.getElementById('receiptModal');
    if (modal) modal.style.display = 'none';
}

function closeEditModal() {
    const modal = document.getElementById('editModal');
    if (modal) modal.style.display = 'none';
}

function closeCropModal() {
    const modal = document.getElementById('cropModal');
    if (modal) modal.style.display = 'none';
}

function closeEReceiptModal() {
    const modal = document.getElementById('eReceiptModal');
    if (modal) modal.style.display = 'none';
}

function closeConfirmModal() {
    const modal = document.getElementById('confirmActionModal');
    if (modal) modal.style.display = 'none';
}

// Global Exports
window.closeReceiptModal = closeReceiptModal;
window.closeEditModal = closeEditModal;
window.closeCropModal = closeCropModal;
window.closeEReceiptModal = closeEReceiptModal;
window.closeConfirmModal = closeConfirmModal;

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
                if (file.type.startsWith('image/') || lowerName.endsWith('.heic') || lowerName.endsWith('.heif')) {
                    initPreUploadCrop(file);
                }
            }
        });

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

    // Standardize modal closing using global helper from default.js
    if (typeof setupGlobalModalClosing === 'function') {
        setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay', 'image-modal-overlay'], [
            closeReceiptModal, closeEditModal, closeCropModal, closeEReceiptModal, closeConfirmModal
        ]);
    }

    // --- Confirmation Modal Functions ---

    window.openConfirmModal = function(title, text, confirmClass, confirmLabel, onConfirm) {
        const modal = document.getElementById('confirmActionModal');
        const btn = document.getElementById('confirmModalBtn');
        
        document.getElementById('confirmModalTitle').textContent = title;
        document.getElementById('confirmModalText').textContent = text;
        
        btn.className = `btn ${confirmClass}`;
        btn.textContent = confirmLabel;
        btn.onclick = () => {
            onConfirm();
            closeConfirmModal();
        };
        
        modal.style.display = 'flex';
    };

    window.confirmDeleteReceipt = function(id, label) {
        window.openConfirmModal(
            'Delete Receipt',
            `Are you sure you want to permanently delete the receipt for "${label}"?`,
            'btn-danger-confirm',
            'Delete Receipt',
            () => {
                const form = document.createElement('form');
                form.method = 'POST';
                form.action = `/receipts/delete/${id}`;
                document.body.appendChild(form);
                form.submit();
            }
        );
    };

    // --- Upload Page Functions ---

    async function initPreUploadCrop(file) {
        let displayFile    = file;
        const lowerName    = file.name.toLowerCase();
        if (lowerName.endsWith('.heic') || lowerName.endsWith('.heif')) {
            showToast('Converting HEIC for preview...', 'info');
            try {
                const blob  = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.8 });
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
                setTimeout(() => {
                    if (cropper) cropper.destroy();
                    cropper = new Cropper(img, { viewMode: 1, autoCropArea: 1, responsive: true });
                }, 100);
            }
        };
        reader.readAsDataURL(displayFile);
    }

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

    function updateFileName(name) {
        if (fileNameDisplay) {
            fileNameDisplay.textContent = name;
            fileNameDisplay.style.display = 'block';
        }
    }

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

    // --- Edit Modal ---

    window.openEditModal = function(receipt) {
        const modal = document.getElementById('editModal');
        const form  = document.getElementById('editForm');
        if (modal && form) {
            form.dataset.receiptId = receipt.id;
            document.getElementById('editStoreName').value   = receipt.store_name   || '';
            document.getElementById('editDate').value        = receipt.receipt_date || '';
            document.getElementById('editAmount').value      = receipt.total_amount || '';
            document.getElementById('editDescription').value = receipt.notes || receipt.description || '';
            modal.style.display = 'flex';
        }
    };

    const editForm = document.getElementById('editForm');
    if (editForm) {
        editForm.onsubmit = async function(e) {
            e.preventDefault();
            if (editForm.dataset.submitting) return;
            
            const id = editForm.dataset.receiptId;
            const formData = new FormData(editForm);
            editForm.dataset.submitting = "true";
            
            try {
                const response = await fetch(`/receipts/update/${id}`, {
                    method: 'POST',
                    body:   formData
                });
                
                if (!response.ok) throw new Error('Network response was not ok');
                const result = await response.json();
                
                if (result.success) {
                    showToast(result.message, 'success');
                    closeEditModal();
                    
                    // Replace the specific row in the table
                    const row = document.getElementById(`receipt-row-${id}`);
                    if (row && result.html) {
                        row.outerHTML = result.html;
                        
                        // Wait a microtask for the DOM to update before finding new row
                        setTimeout(() => {
                            const newRow = document.getElementById(`receipt-row-${id}`);
                            if (newRow) {
                                newRow.style.transition = 'background-color 1s';
                                newRow.style.backgroundColor = 'rgba(59, 130, 246, 0.2)';
                                setTimeout(() => { newRow.style.backgroundColor = 'transparent'; }, 1000);
                            }
                        }, 10);
                    }
                } else {
                    showToast(result.error || 'Failed to update receipt.', 'error');
                }
            } catch (err) {
                console.error('Update failed:', err);
                showToast('Network error during update.', 'error');
            } finally {
                delete editForm.dataset.submitting;
            }
        };
    }

    // --- Crop Modal ---

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
            if (blob.type === 'image/heic' || blob.type === 'image/heif') {
                showToast('Converting HEIC for preview...', 'info');
                const convertedBlob = await heic2any({ blob: blob, toType: 'image/jpeg', quality: 0.8 });
                displayBlob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
            }
            const reader = new FileReader();
            reader.onload = function(e) {
                img.src = e.target.result;
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
                        notes:        data.notes
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

    // --- Pagination and Filtering Logic ---
    let currentOffset = 10;
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    const filterInputs = ['filterSearch', 'filterStore', 'filterTime', 'filterAI', 'filterUploader', 'filterMinAmount'];

    function getActiveFilters() {
        return {
            search:     document.getElementById('filterSearch').value,
            store:      document.getElementById('filterStore').value,
            days:       document.getElementById('filterTime').value,
            ai_status:  document.getElementById('filterAI').value,
            uploader:   document.getElementById('filterUploader').value,
            min_amount: document.getElementById('filterMinAmount').value
        };
    }

    async function refreshLedger() {
        currentOffset = 0;
        const filters = getActiveFilters();
        const params  = new URLSearchParams({ ...filters, offset: 0 });
        
        try {
            const response = await fetch(`/api/receipts/list?${params.toString()}`);
            const data = await response.json();
            
            if (data.success) {
                const tbody = document.querySelector('.files-table tbody');
                tbody.innerHTML = data.html || `<tr><td colspan="7" class="receipt-empty-ledger">📭 No receipts match your filters.</td></tr>`;
                
                const rowsAdded = (data.html?.match(/<tr/g) || []).length;
                currentOffset = rowsAdded;
                
                if (loadMoreBtn) {
                    loadMoreBtn.style.display = data.has_more ? 'inline-block' : 'none';
                }
            }
        } catch (err) {
            console.error("Filtering failed:", err);
            showToast("Failed to filter results", "error");
        }
    }

    // Attach listeners to all filter inputs
    filterInputs.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        
        const eventType = el.tagName === 'SELECT' ? 'change' : 'input';
        let debounceTimer;
        
        el.addEventListener(eventType, () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(refreshLedger, 300);
        });
    });

    // Reset button logic
    const resetBtn = document.getElementById('resetFilters');
    if (resetBtn) {
        resetBtn.onclick = () => {
            filterInputs.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            refreshLedger();
        };
    }

    if (loadMoreBtn) {
        loadMoreBtn.onclick = async function() {
            loadMoreBtn.disabled = true;
            const originalText = loadMoreBtn.innerHTML;
            loadMoreBtn.innerHTML = 'Loading...';

            const filters = getActiveFilters();
            const params  = new URLSearchParams({ ...filters, offset: currentOffset });

            try {
                const response = await fetch(`/api/receipts/list?${params.toString()}`);
                const data = await response.json();

                if (data.success && data.html) {
                    const tbody = document.querySelector('.files-table tbody');
                    tbody.insertAdjacentHTML('beforeend', data.html);
                    
                    const rowsAdded = (data.html.match(/<tr/g) || []).length;
                    currentOffset += rowsAdded;
                    
                    if (!data.has_more) {
                        loadMoreBtn.style.display = 'none';
                    }
                } else {
                    loadMoreBtn.style.display = 'none';
                }
            } catch (err) {
                console.error("Failed to load more receipts:", err);
                showToast("Error loading more receipts.", "error");
            } finally {
                loadMoreBtn.disabled = false;
                if (loadMoreBtn.style.display !== 'none') {
                    loadMoreBtn.innerHTML = originalText;
                }
            }
        };
    }

    // --- Electronic Receipt Functions ---

    let currentEReceiptId = null;
    let currentStoreIcon = null;

    window.viewElectronicReceipt = function(id, force = 0, preLoadedData = null, initialIcon = null) {
        currentEReceiptId = id;
        currentStoreIcon = initialIcon;
        const modal = document.getElementById('eReceiptModal');
        const content = document.getElementById('eReceiptContent');
        
        modal.style.display = 'flex';

        if (preLoadedData && preLoadedData.trim() !== '' && !force) {
            try {
                const data = JSON.parse(preLoadedData);
                if (data && data.store_name) {
                    renderEReceipt(data, initialIcon);
                    return;
                }
            } catch(e) { 
                console.warn("Pre-loaded JSON invalid, falling back to API", e); 
            }
        }

        content.innerHTML = `
            <div class="ereceipt-loading">
                <div class="ereceipt-scan-line"></div>
                <span class="ereceipt-loading-icon">🧠</span>
                <p class="ereceipt-loading-text">${force ? 'Re-digitizing...' : 'Digitizing...'} with AI</p>
                <p class="ereceipt-loading-sub">Analyzing items and structured data</p>
            </div>
        `;

        const params = new URLSearchParams({ force: force });
        fetch(`/receipts/ai_analyze/${id}`, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params
        })
        .then(r => r.json())
        .then(res => {
            if (res.success) {
                showToast(res.message || "AI Analysis complete", "success");
                // Update ledger UI dynamically
                updateLedgerWithAIStatus(id, res.data);
                renderEReceipt(res.data, initialIcon);
            } else {
                showToast(res.error || "AI analysis failed", "error");
                content.innerHTML = `<div class="alert alert-error">${res.error || 'AI analysis failed'}</div>`;
            }
        })
        .catch(err => {
            showToast("Network error during AI scan", "error");
            content.innerHTML = `<div class="alert alert-error">Network error during AI scan.</div>`;
        });
    };

    /**
     * Dynamically updates the ledger row with the AI icon and cached JSON
     */
    function updateLedgerWithAIStatus(id, data) {
        const wrapper = document.getElementById(`store-wrapper-${id}`);
        if (wrapper && !wrapper.querySelector('.ai-badge')) {
            const badge = document.createElement('span');
            badge.className = 'ai-badge';
            badge.title = 'AI Analyzed';
            badge.style.fontSize = '0.8rem';
            badge.style.marginLeft = '5px';
            badge.textContent = '🧠';
            wrapper.appendChild(badge);
        }

        // Update the button's data attribute so next click is instant
        const btn = document.querySelector(`.btn-ai-scan[data-receipt-id="${id}"]`);
        if (btn) {
            btn.dataset.aiJson = JSON.stringify(data);
        }
    }

    window.reScanReceipt = function() {
        window.openConfirmModal(
            'Confirm Full Rescan',
            'This will perform a completely fresh AI analysis. Current electronic receipt data will be overwritten.',
            'btn-danger-confirm',
            'Full Rescan',
            () => {
                viewElectronicReceipt(currentEReceiptId, 1);
            }
        );
    };

    function renderEReceipt(data, iconUrl = null) {
        const content = document.getElementById('eReceiptContent');
        
        // Format date from YYYY-MM-DD to DD-MM-YYYY
        let displayDate = data.date || '';
        if (displayDate && displayDate.includes('-')) {
            const [y, m, d] = displayDate.split('-');
            if (y && m && d && y.length === 4) displayDate = `${d}-${m}-${y}`;
        }

        // If no iconUrl passed (e.g. from a rescan where name changed), try to generate one
        if (!iconUrl && data.store_name) {
            const slug = data.store_name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
            iconUrl = `/images/shops/${slug}.png`;
        }

        let itemsHtml = '';
        if (data.items && Array.isArray(data.items)) {
            itemsHtml = data.items.map(item => {
                const linePrice = parseFloat(item.line_total || item.price || 0).toFixed(2);
                const unitPrice = item.unit_price ? parseFloat(item.unit_price).toFixed(2) : null;
                return `
                    <div class="ereceipt-item">
                        <div class="ereceipt-item-content">
                            <div class="ereceipt-item-desc">${item.desc || 'Item'}</div>
                            ${item.qty ? `<small class="ereceipt-item-qty">Qty: ${item.qty} ${unitPrice ? `@ $${unitPrice}` : ''}</small>` : ''}
                        </div>
                        <div class="ereceipt-item-price">$${linePrice}</div>
                    </div>
                `;
            }).join('');
        }

        content.innerHTML = `
            <div class="ereceipt-body">
                <div class="ereceipt-summary">
                    ${iconUrl ? `<img src="${iconUrl}" class="ereceipt-store-logo" onerror="this.style.display='none'">` : ''}
                    <h2 class="ereceipt-store-name">${data.store_name || 'Store'}</h2>
                    ${data.location ? `<p class="ereceipt-location">${data.location}</p>` : ''}
                    <p class="ereceipt-datetime">${displayDate} ${data.time || ''}</p>
                </div>

                <div class="ereceipt-items-list">
                    ${itemsHtml || '<p class="ereceipt-empty-items">No item details available</p>'}
                </div>

                <div class="ereceipt-total-container">
                    <div class="ereceipt-total-row">
                        <span>TOTAL</span>
                        <span>$${parseFloat(data.total_amount || 0).toFixed(2)} ${data.currency || ''}</span>
                    </div>
                    ${data.payment_method ? `
                        <div class="ereceipt-payment">
                            Paid via: ${data.payment_method}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }
});
