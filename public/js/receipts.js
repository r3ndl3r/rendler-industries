// /public/js/receipts.js

/**
 * Receipt Management and AI Analysis Logic - 100% AJAX SPA
 */

let cropper         = null;
let currentReceipts = [];
let storeNames      = [];
let uploaders       = [];
let summary         = {};
let breakdown       = {};
let isAdmin         = false;
let currentUser     = '';
let currentOffset   = 0;
const LIMIT         = 10;

// --- Modal Management Functions ---

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

function closePreUploadCropModal() {
    const modal = document.getElementById('preUploadCropModal');
    if (modal) modal.style.display = 'none';
    openUploadModal();
}

function openUploadModal() {
    const modal = document.getElementById('uploadModal');
    if (modal) modal.style.display = 'flex';
}

function closeUploadModal() {
    const modal = document.getElementById('uploadModal');
    if (modal) {
        modal.style.display = 'none';
    }
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
window.closePreUploadCropModal = closePreUploadCropModal;
window.closeEReceiptModal = closeEReceiptModal;
window.closeConfirmModal = closeConfirmModal;
window.openUploadModal = openUploadModal;
window.closeUploadModal = closeUploadModal;

document.addEventListener('DOMContentLoaded', function() {
    // Initial State Load
    loadState();

    // Attach listeners to all filter inputs
    const filterIds = ['filterSearch', 'filterStore', 'filterTime', 'filterAI', 'filterUploader', 'filterMinAmount'];
    filterIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        
        const eventType = el.tagName === 'SELECT' ? 'change' : 'input';
        let debounceTimer;
        
        el.addEventListener(eventType, () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                currentOffset = 0;
                loadState();
            }, 300);
        });
    });

    // Reset button logic
    const resetBtn = document.getElementById('resetFilters');
    if (resetBtn) {
        resetBtn.onclick = () => {
            filterIds.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            currentOffset = 0;
            loadState();
        };
    }

    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (loadMoreBtn) {
        loadMoreBtn.onclick = loadMore;
    }

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
                fileInput.dispatchEvent(new Event('change'));
            }
        }, false);

        fileInput.addEventListener('change', function() {
            if (this.files.length > 0) {
                const file = this.files[0];
                updateFileName(file.name);
                const lowerName = file.name.toLowerCase();
                if (file.type.startsWith('image/') || lowerName.endsWith('.heic') || lowerName.endsWith('.heif')) {
                    closeUploadModal();
                    initPreUploadCrop(file);
                }
            }
        });
    }

    const uploadForm = document.getElementById('uploadForm');
    if (uploadForm) {
        uploadForm.addEventListener('submit', handleUpload);
    }

    const editForm = document.getElementById('editForm');
    if (editForm) {
        editForm.onsubmit = handleEditSubmit;
    }

    // --- Confirmation Modal Functions ---

    window.openConfirmModal = function(title, text, confirmClass, confirmLabel, onConfirm, iconName = 'delete') {
        const modal = document.getElementById('confirmActionModal');
        const btn = document.getElementById('confirmModalBtn');
        const iconEl = document.getElementById('confirmModalIcon');
        const titleTextEl = document.getElementById('confirmModalTitleText');
        
        if (titleTextEl) titleTextEl.textContent = title;
        const textEl = document.getElementById('confirmModalText');
        if (textEl) textEl.textContent = text;
        if (iconEl) iconEl.innerHTML = getIcon(iconName);
        
        if (btn) {
            btn.className = `btn ${confirmClass}`;
            btn.textContent = confirmLabel;
            btn.onclick = () => {
                onConfirm();
                closeConfirmModal();
            };
        }
        
        modal.style.display = 'flex';
    };

    window.confirmDeleteReceipt = function(id, label) {
        window.openConfirmModal(
            'Delete Receipt',
            `Are you sure you want to permanently delete the receipt for "${label}"?`,
            'btn-danger-confirm',
            'Delete Receipt',
            () => {
                deleteReceipt(id);
            },
            'delete'
        );
    };

    // Standardize modal closing using global helper from default.js
    if (typeof setupGlobalModalClosing === 'function') {
        setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay', 'image-modal-overlay'], [
            closeReceiptModal, closeEditModal, closeCropModal, closePreUploadCropModal, closeEReceiptModal, closeConfirmModal
        ]);
    }
});

// --- API and State Management ---

async function loadState() {
    const filters = getActiveFilters();
    const params = new URLSearchParams(filters);
    
    try {
        const response = await fetch(`/receipts/api/state?${params.toString()}`);
        const data = await response.json();

        if (data.success) {
            currentReceipts = data.receipts;
            storeNames = data.store_names;
            uploaders = data.uploaders;
            summary = data.summary;
            breakdown = data.breakdown;
            if (data.is_admin !== undefined) isAdmin = data.is_admin;
            if (data.current_user !== undefined) currentUser = data.current_user;
            currentOffset = currentReceipts.length;

            updateFilterDropdowns();
            renderStats();
            renderReceipts(false);
            
            const loadMoreBtn = document.getElementById('loadMoreBtn');
            if (loadMoreBtn) {
                loadMoreBtn.style.display = (data.has_more || currentReceipts.length >= 10) ? 'inline-block' : 'none';
            }
        }
    } catch (e) {
        console.error("LoadState Error:", e);
    }
}

async function loadMore() {
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (loadMoreBtn) {
        loadMoreBtn.disabled = true;
        loadMoreBtn.innerHTML = 'Loading...';
    }

    const filters = getActiveFilters();
    const params = new URLSearchParams({ ...filters, offset: currentOffset });

    try {
        const response = await fetch(`/api/receipts/list?${params.toString()}`);
        const data = await response.json();

        if (data.success && data.receipts) {
            const newItems = data.receipts;
            currentReceipts = [...currentReceipts, ...newItems];
            
            // Render only the new items
            renderReceipts(true, newItems);
            
            currentOffset += newItems.length;
            
            if (loadMoreBtn) {
                loadMoreBtn.style.display = data.has_more ? 'inline-block' : 'none';
            }
        }
    } catch (e) {
        console.error("LoadMore Error:", e);
    } finally {
        if (loadMoreBtn) {
            loadMoreBtn.disabled = false;
            loadMoreBtn.innerHTML = getIcon('expand') + ' Load More';
        }
    }
}

function renderStats() {
    const container = document.getElementById('spendingSummaryContainer');
    if (!container) return;

    const periods = ['week', 'month', 'year'];
    const labels = { week: 'Weekly Spend', month: 'Monthly Spend', year: 'Yearly Spend' };

    let html = '';
    periods.forEach(period => {
        const total = summary[period + '_total'] || 0;
        const periodBreakdown = breakdown[period] || [];
        
        html += `
            <div class="stat-tile" onclick="toggleStatTile(this)">
                <span class="stat-label">${labels[period]}</span>
                <span class="stat-value">
                    $${parseFloat(total).toFixed(2)}
                    <span class="tile-toggle-icon">${getIcon('expand')}</span>
                </span>
                <div class="stat-breakdown">
                    ${periodBreakdown.map(s => {
                        const iconPath = getStoreIcon(s.store_name);
                        return `
                            <div class="breakdown-row">
                                <span class="breakdown-store">
                                    ${iconPath ? `<img src="${iconPath}" class="store-logo" alt="" onerror="this.style.display='none'">` : ''}
                                    ${escapeHtml(s.store_name)}
                                </span>
                                <span class="breakdown-total">$${parseFloat(s.total).toFixed(2)}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

/**
 * Toggles expanded state for stat tiles on mobile.
 */
function toggleStatTile(el) {
    // Only toggle if we are in mobile view (detected by presence of toggle icon visibility)
    const icon = el.querySelector('.tile-toggle-icon');
    if (icon && getComputedStyle(icon).display !== 'none') {
        el.classList.toggle('expanded');
    }
}

window.toggleStatTile = toggleStatTile;

function renderReceipts(append = false, itemsToAppend = null) {
    const tbody = document.getElementById('receiptsTableBody');
    if (!tbody) return;

    if (!append && currentReceipts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="receipt-empty-ledger">📭 No receipts found. Upload one to get started.</td></tr>';
        return;
    }

    const items = append ? (itemsToAppend || []) : currentReceipts;
    
    const html = items.map(r => {
        const iconPath = getStoreIcon(r.store_name);
        const isOwnerOrAdmin = (r.uploaded_by === currentUser || isAdmin);
        
        return `
            <tr id="receipt-row-${r.id}">
                <td class="col-icon receipt-col-preview" data-label="Preview">
                    ${r.mime_type.startsWith('image/') ? `
                        <div class="receipt-thumbnail-wrapper" onclick="openReceiptModal('${r.id}')">
                            <img src="/receipts/serve/${r.id}" class="receipt-thumb">
                        </div>
                    ` : `
                        <span style="font-size: 1.5rem;">${getIcon('receipts')}</span>
                    `}
                </td>
                <td data-label="Filename">
                    <small>${escapeHtml(r.original_filename)}</small>
                </td>
                <td data-label="Store">
                    <div class="store-icon-wrapper" id="store-wrapper-${r.id}">
                        ${iconPath ? `<img src="${iconPath}" class="store-logo" alt="" onerror="this.style.display='none'">` : ''}
                        <strong>${escapeHtml(r.store_name || 'Unknown')}</strong>
                        ${(r.ai_json && r.ai_json.trim().startsWith('{')) ? `
                            <span class="ai-badge" title="AI Analyzed">${getIcon('ai')}</span>
                        ` : ''}
                    </div>
                    ${r.description ? `<br><small class="receipt-description">${escapeHtml(r.description)}</small>` : ''}
                </td>
                <td data-label="Date">${r.formatted_date || '-'}</td>
                <td data-label="Total" class="receipt-total-value">$${parseFloat(r.total_amount || 0).toFixed(2)}</td>
                <td data-label="Uploaded By"><small>${escapeHtml(r.uploaded_by)}</small></td>
                <td class="col-actions">
                    <div class="action-buttons">
                        <a href="/receipts/serve/${r.id}" target="_blank" class="btn-icon-view" title="View Full Image">
                            ${getIcon('view')}
                        </a>
                        <button type="button" 
                                class="btn-icon-ai" 
                                data-receipt-id="${r.id}"
                                data-ai-json="${escapeHtml(r.ai_json || "")}"
                                data-store-icon="${iconPath || ''}"
                                onclick="viewElectronicReceipt(this.dataset.receiptId, 0, this.dataset.aiJson, this.dataset.storeIcon)" 
                                title="Electronic Receipt">
                            ${getIcon('ai')}
                        </button>
                        ${isOwnerOrAdmin ? `
                            <button type="button" class="btn-icon-crop" onclick="openCropModal('${r.id}')" title="Crop Image">
                                ${getIcon('crop')}
                            </button>
                            <button type="button" class="btn-icon-bonus" onclick="triggerOCR('${r.id}')" title="Scan with OCR" id="ocr-btn-${r.id}">
                                ${getIcon('search')}
                            </button>
                            <button type="button" class="btn-icon-edit" onclick="openEditModal(JSON.parse(this.dataset.receipt))" data-receipt='${escapeHtml(JSON.stringify(r))}' title="Edit Details">
                                ${getIcon('edit')}
                            </button>
                            <button type="button" class="btn-icon-delete" onclick="confirmDeleteReceipt('${r.id}', '${escapeHtml(r.store_name || r.original_filename)}')" title="Delete">
                                ${getIcon('delete')}
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    if (append) {
        tbody.insertAdjacentHTML('beforeend', html);
    } else {
        tbody.innerHTML = html;
    }
}

async function handleUpload(e) {
    if (e) e.preventDefault();
    const form = document.getElementById('uploadForm');
    const formData = new FormData(form);
    
    showLoadingOverlay('Uploading receipt...', 'Please wait while we scan and extract details.');
    
    try {
        const response = await fetch('/receipts/api/upload', {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        
        if (result.success) {
            showToast(result.message, 'success');
            
            if (form) form.reset();
            const fileName = document.getElementById('fileName');
            if (fileName) fileName.style.display = 'none';

            closeUploadModal();
            
            currentReceipts.unshift(result.receipt);
            summary = result.summary;
            breakdown = result.breakdown;
            
            renderStats();
            renderReceipts(false);
        } else {
            showToast(result.error || 'Upload failed.', 'error');
        }
    } catch (e) {
        console.error("Upload Error:", e);
    } finally {
        hideLoadingOverlay();
    }
}

async function handleEditSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const id = form.dataset.receiptId;
    const formData = new FormData(form);
    
    try {
        const response = await fetch(`/receipts/api/update/${id}`, {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        
        if (result.success) {
            showToast(result.message, 'success');
            closeEditModal();
            
            const index = currentReceipts.findIndex(r => r.id == id);
            if (index !== -1) {
                currentReceipts[index] = result.receipt;
            }
            summary = result.summary;
            breakdown = result.breakdown;
            
            renderStats();
            renderReceipts(false);
        } else {
            showToast(result.error || 'Failed to update.', 'error');
        }
    } catch (e) {
        console.error("Update Error:", e);
    }
}

async function deleteReceipt(id) {
    try {
        const response = await fetch(`/receipts/api/delete/${id}`, { method: 'POST' });
        const result = await response.json();
        
        if (result.success) {
            showToast(result.message, 'success');
            currentReceipts = currentReceipts.filter(r => r.id != id);
            summary = result.summary;
            breakdown = result.breakdown;
            renderStats();
            renderReceipts(false);
        } else {
            showToast(result.error || 'Failed to delete receipt.', 'error');
        }
    } catch (e) {
        console.error("Delete Error:", e);
        showToast("Network error during deletion", "error");
    }
}

function updateFilterDropdowns() {
    const storeSelect = document.getElementById('filterStore');
    if (storeSelect) {
        const currentVal = storeSelect.value;
        storeSelect.innerHTML = '<option value="">All Stores</option>' + 
            storeNames.map(name => `<option value="${escapeHtml(name)}" ${name === currentVal ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('');
    }

    const uploaderSelect = document.getElementById('filterUploader');
    if (uploaderSelect) {
        const currentVal = uploaderSelect.value;
        uploaderSelect.innerHTML = '<option value="">All Uploaders</option>' + 
            uploaders.map(u => `<option value="${escapeHtml(u.username)}" ${u.username === currentVal ? 'selected' : ''}>${escapeHtml(u.username)}</option>`).join('');
    }
}

function getActiveFilters() {
    return {
        search:     document.getElementById('filterSearch')?.value || '',
        store:      document.getElementById('filterStore')?.value || '',
        days:       document.getElementById('filterTime')?.value || '',
        ai_status:  document.getElementById('filterAI')?.value || '',
        uploader:   document.getElementById('filterUploader')?.value || '',
        min_amount: document.getElementById('filterMinAmount')?.value || ''
    };
}

function getStoreIcon(name) {
    if (!name) return null;
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    return `/images/shops/${slug}.png`;
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// --- Crop and Upload Workflow ---

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
        const modal = document.getElementById('preUploadCropModal');
        const img   = document.getElementById('preUploadCropImg');
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

function applyPreUploadCrop() {
    if (!cropper) return;
    const canvas = cropper.getCroppedCanvas();
    canvas.toBlob((blob) => {
        const fileInput = document.getElementById('file');
        if (!fileInput || !fileInput.files[0]) return;

        const croppedFile = new File([blob], fileInput.files[0].name, {
            type: 'image/png',
            lastModified: new Date().getTime()
        });
        const dt   = new DataTransfer();
        dt.items.add(croppedFile);
        fileInput.files = dt.files;
        
        showToast('Image refined! You can now upload.', 'success');
        closePreUploadCropModal();
        openUploadModal();
    }, 'image/png');
}

function updateFileName(name) {
    const fileNameDisplay = document.getElementById('fileName');
    if (fileNameDisplay) {
        fileNameDisplay.textContent = name;
        fileNameDisplay.style.display = 'block';
    }
}

// --- Legacy Actions (kept for compatibility) ---

window.openReceiptModal = function(id) {
    const modalImg = document.getElementById('modalImg');
    const modal    = document.getElementById('receiptModal');
    if (modalImg && modal) {
        modalImg.src            = '/receipts/serve/' + id;
        modal.style.display     = 'flex';
    }
};

window.openEditModal = function(receipt) {
    const modal = document.getElementById('editModal');
    const form  = document.getElementById('editForm');
    const btnAI = document.getElementById('btnApplyAI');

    if (modal && form) {
        form.dataset.receiptId = receipt.id;
        document.getElementById('editStoreName').value   = receipt.store_name   || '';
        document.getElementById('editDate').value        = receipt.receipt_date || '';
        document.getElementById('editAmount').value      = receipt.total_amount || '';
        document.getElementById('editDescription').value = receipt.description || '';
        
        if (btnAI) {
            if (receipt.ai_json && receipt.ai_json.trim().startsWith('{')) {
                btnAI.style.display = 'flex';
                btnAI.onclick = () => {
                    try {
                        const data = JSON.parse(receipt.ai_json);
                        if (data.store_name) document.getElementById('editStoreName').value = data.store_name;
                        if (data.total_amount) document.getElementById('editAmount').value = data.total_amount;
                        if (data.date) {
                            let dateVal = data.date;
                            if (dateVal.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
                                const parts = dateVal.split('/');
                                dateVal = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                            }
                            document.getElementById('editDate').value = dateVal;
                        }
                        showToast("AI data applied to form fields.", "success");
                    } catch (err) {
                        showToast("Error parsing AI data.", "error");
                    }
                };
            } else {
                btnAI.style.display = 'none';
            }
        }
        modal.style.display = 'flex';
    }
};

window.openCropModal = async function(id) {
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
        
        // Target specific save button logic for post-upload crop
        window.saveCrop = async function() {
            if (!cropper) return;
            const canvas = cropper.getCroppedCanvas();
            canvas.toBlob(async (blob) => {
                const formData = new FormData();
                formData.append('cropped_image', blob, 'receipt_cropped.png');
                try {
                    const response = await fetch('/receipts/api/crop/' + id, { method: 'POST', body: formData });
                    const result = await response.json();
                    if (result.success) {
                        showToast('Receipt cropped successfully!', 'success');
                        closeCropModal();
                        loadState();
                    } else {
                        showToast('Failed to save crop: ' + (result.error || 'Unknown error'), 'error');
                    }
                } catch (err) {
                    showToast('Request failed', 'error');
                }
            }, 'image/png');
        };
    } catch (err) {
        showToast('Error loading image.', 'error');
        closeCropModal();
    }
};

window.triggerOCR = function(id) {
    const btn             = document.getElementById('ocr-btn-' + id);
    const originalContent = btn.innerHTML;
    btn.disabled   = true;
    btn.innerHTML  = '...';
    showToast('Scanning receipt... please wait.', 'info');
    fetch('/receipts/api/ocr/' + id, { method: 'POST' })
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
                    description:  data.description
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

window.viewElectronicReceipt = function(id, force = 0, preLoadedData = null, initialIcon = null) {
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
        } catch(e) {}
    }

    content.innerHTML = getLoadingHtml('Digitizing...', 'Analyzing items and structured data', true);

    fetch(`/receipts/api/ai_analyze/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ force: force }) })
    .then(r => r.json())
    .then(res => {
        if (res.success) {
            showToast("AI Analysis complete", "success");
            loadState(); // Refresh everything to get the AI badge
            renderEReceipt(res.data, initialIcon);
        } else {
            showToast(res.error || "AI analysis failed", "error");
            content.innerHTML = `<div class="alert alert-error">${res.error || 'AI analysis failed'}</div>`;
        }
    });
};

function renderEReceipt(data, iconUrl = null) {
    const content = document.getElementById('eReceiptContent');
    let displayDate = data.date || '';
    if (displayDate && displayDate.includes('-')) {
        const [y, m, d] = displayDate.split('-');
        if (y && m && d && y.length === 4) displayDate = `${d}-${m}-${y}`;
    }
    if (!iconUrl && data.store_name) {
        const slug = data.store_name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
        iconUrl = `/images/shops/${slug}.png`;
    }
    let itemsHtml = (data.items || []).map(item => `
        <div class="ereceipt-item">
            <div class="ereceipt-item-content">
                <div class="ereceipt-item-desc">${escapeHtml(item.desc || 'Item')}</div>
                ${item.qty ? `<small class="ereceipt-item-qty">Qty: ${item.qty}</small>` : ''}
            </div>
            <div class="ereceipt-item-price">$${parseFloat(item.line_total || item.price || 0).toFixed(2)}</div>
        </div>
    `).join('');

    content.innerHTML = `
        <div class="ereceipt-body">
            <div class="ereceipt-summary">
                ${iconUrl ? `<img src="${iconUrl}" class="ereceipt-store-logo" onerror="this.style.display='none'">` : ''}
                <h2 class="ereceipt-store-name">${escapeHtml(data.store_name || 'Store')}</h2>
                <p class="ereceipt-datetime">${displayDate} ${data.time || ''}</p>
            </div>
            <div class="ereceipt-items-list">${itemsHtml}</div>
            <div class="ereceipt-total-container">
                <div class="ereceipt-total-row"><span>TOTAL</span><span>$${parseFloat(data.total_amount || 0).toFixed(2)}</span></div>
            </div>
        </div>
    `;
}

window.initPreUploadCrop = initPreUploadCrop;
window.applyPreUploadCrop = applyPreUploadCrop;
window.showUploadProgress = showUploadProgress;
window.updateFileName = updateFileName;
window.handleUpload = handleUpload;
window.loadState = loadState;
window.loadMore = loadMore;
