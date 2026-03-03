// /public/js/receipts.js

/**
 * Receipt Ledger Controller Module
 * 
 * This module manages the Receipt Management and AI Analysis interface. It 
 * handles large file uploads, specialized client-side image cropping,
 * and integration with the Gemini-powered OCR digitization engine.
 * 
 * Features:
 * - Real-time ledger filtering (Search, Store, Date, AI Status, Uploader)
 * - Intelligent expenditure statistics with mobile-responsive breakdowns
 * - Integrated client-side image cropping (Cropper.js) for pre and post-upload refinement
 * - One-click AI digitization workflow with electronic receipt rendering
 * - HEIC/HEIF image conversion support for cross-platform compatibility
 * - Drag-and-drop file upload zone with 1GB capacity support
 * 
 * Dependencies:
 * - default.js: For apiPost, getLoadingHtml, getIcon, and modal helpers
 * - cropperjs: For image manipulation
 * - heic2any: For modern image format conversion
 */

/**
 * Application State
 * Maintains collection metadata, stats summary, and interactive UI states
 */
let cropper         = null;         // Cropper.js instance
let currentReceipts = [];           // Active list of receipt objects {id, store_name, total_amount, ...}
let storeNames      = [];           // Unified list of stores for filter dropdowns
let uploaders       = [];           // Unified list of uploaders for filter dropdowns
let summary         = {};           // Aggregated spend totals (week, month, year)
let breakdown       = {};           // Store-specific breakdowns for the stats tiles
let isAdmin         = false;        // Permission context
let currentUser     = '';           // Current session username for ownership logic
let currentOffset   = 0;            // Pagination pointer
let refinedBlob     = null;         // Local store for cropped image data during upload
let refinedName     = '';           // Processed filename for refined uploads
const LIMIT         = 10;           // Pagination page size

/**
 * Initialization System
 * Boots the ledger state and establishes filter event delegation
 */
document.addEventListener('DOMContentLoaded', function() {
    // Bootstrap initial collection
    loadState();

    // Setup debounced filtering for high-performance searching
    const filterIds = ['filterSearch', 'filterStore', 'filterTime', 'filterAI', 'filterUploader', 'filterMinAmount'];
    filterIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        
        const eventType = el.tagName === 'SELECT' ? 'change' : 'input';
        let debounceTimer;
        
        el.addEventListener(eventType, () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                currentOffset = 0; // Reset pagination on new filter
                loadState();
            }, 300);
        });
    });

    // Interaction: Filter reset logic
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

    // Interaction: Pagination loader
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (loadMoreBtn) {
        loadMoreBtn.onclick = loadMore;
    }

    // Interaction: File upload drop-zone orchestration
    const dropZone        = document.getElementById('dropZone');
    const fileInput       = document.getElementById('file');

    if (dropZone && fileInput) {
        // Handle drag states
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
        
        // Process file drops
        dropZone.addEventListener('drop', e => {
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                fileInput.files = files;
                fileInput.dispatchEvent(new Event('change'));
            }
        }, false);

        // Process manual selections and trigger refinement workflow
        fileInput.addEventListener('change', function() {
            if (this.files.length > 0) {
                const file = this.files[0];
                updateFileName(file.name);
                refinedBlob = null; // Reset refinement state for new file
                const lowerName = file.name.toLowerCase();
                if (file.type.startsWith('image/') || lowerName.endsWith('.heic') || lowerName.endsWith('.heif')) {
                    // Transition to refinement interface
                    closeUploadModal();
                    initPreUploadCrop(file);
                }
            }
        });
    }

    // Form: Submission handling
    const uploadForm = document.getElementById('uploadForm');
    if (uploadForm) {
        uploadForm.addEventListener('submit', handleUpload);
    }

    const editForm = document.getElementById('editForm');
    if (editForm) {
        editForm.onsubmit = handleEditSubmit;
    }

    // Modal: Configure unified click-outside behavior
    setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay', 'image-modal-overlay'], [
        closeReceiptModal, closeEditModal, closeCropModal, closePreUploadCropModal, closeEReceiptModal, closeConfirmModal
    ]);
});

/**
 * --- API and State Management ---
 */

/**
 * Fetches the master ledger state including receipts, metadata, and stats.
 * 
 * @returns {Promise<void>}
 */
async function loadState() {
    const filters = getActiveFilters();
    const params = new URLSearchParams(filters);
    
    try {
        const response = await fetch(`/receipts/api/state?${params.toString()}`);
        const data = await response.json();

        if (data.success) {
            // Update comprehensive module state
            currentReceipts = data.receipts;
            storeNames = data.store_names;
            uploaders = data.uploaders;
            summary = data.summary;
            breakdown = data.breakdown;
            if (data.is_admin !== undefined) isAdmin = data.is_admin;
            if (data.current_user !== undefined) currentUser = data.current_user;
            currentOffset = currentReceipts.length;

            // Trigger UI layer updates
            updateFilterDropdowns();
            renderStats();
            renderReceipts(false);
            
            // Manage pagination visibility
            const loadMoreBtn = document.getElementById('loadMoreBtn');
            if (loadMoreBtn) {
                loadMoreBtn.style.display = (data.has_more || currentReceipts.length >= 10) ? 'inline-block' : 'none';
            }
        }
    } catch (e) {
        console.error("loadState Error:", e);
    }
}

/**
 * Fetches subsequent pages of receipt data for the ledger.
 * 
 * @returns {Promise<void>}
 */
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
            // Append to master state
            currentReceipts = [...currentReceipts, ...newItems];
            
            // Perform incremental DOM update
            renderReceipts(true, newItems);
            
            currentOffset += newItems.length;
            
            if (loadMoreBtn) {
                loadMoreBtn.style.display = data.has_more ? 'inline-block' : 'none';
            }
        }
    } catch (e) {
        console.error("loadMore Error:", e);
    } finally {
        if (loadMoreBtn) {
            loadMoreBtn.disabled = false;
            loadMoreBtn.innerHTML = getIcon('expand') + ' Load More';
        }
    }
}

/**
 * UI Component: renderStats
 * Generates the spend aggregate tiles with hidden breakdown sections.
 */
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
 * Toggles expanded breakdown state for stat tiles on mobile devices.
 * 
 * @param {HTMLElement} el - Clicked tile
 */
function toggleStatTile(el) {
    const icon = el.querySelector('.tile-toggle-icon');
    // Device check: only trigger if the toggle icon is visible (CSS media query dependency)
    if (icon && getComputedStyle(icon).display !== 'none') {
        el.classList.toggle('expanded');
    }
}

/**
 * UI Engine: renderReceipts
 * Generates the master ledger table from current state.
 * 
 * @param {boolean} append - Whether to append or replace existing rows
 * @param {Array|null} itemsToAppend - Subset of items for incremental rendering
 */
function renderReceipts(append = false, itemsToAppend = null) {
    const tbody = document.getElementById('receiptsTableBody');
    if (!tbody) return;

    // Handle empty state
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

/**
 * Action: handleUpload
 * Manages multipart file uploads with optional refined blob support.
 * 
 * @param {Event} e - Form submission event
 * @returns {Promise<void>}
 */
async function handleUpload(e) {
    if (e) e.preventDefault();
    const form = document.getElementById('uploadForm');
    const formData = new FormData(form);
    
    // Check if we should override the raw selection with a refined crop blob
    if (refinedBlob) {
        formData.delete('file');
        formData.append('file', refinedBlob, refinedName || 'receipt.png');
    }

    showLoadingOverlay('Uploading receipt...', 'Please wait while we scan and extract details.');
    
    try {
        const response = await fetch('/receipts/api/upload', {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        
        if (result.success) {
            showToast(result.message, 'success');
            
            // Reset UI state
            if (form) form.reset();
            const fileName = document.getElementById('fileName');
            if (fileName) fileName.style.display = 'none';

            closeUploadModal();
            
            // Insert into active view and refresh summaries
            currentReceipts.unshift(result.receipt);
            summary = result.summary;
            breakdown = result.breakdown;
            
            renderStats();
            renderReceipts(false);
        } else {
            showToast(result.error || 'Upload failed.', 'error');
        }
    } catch (e) {
        console.error("handleUpload Error:", e);
    } finally {
        hideLoadingOverlay();
    }
}

/**
 * Action: handleEditSubmit
 * Updates existing receipt metadata.
 * 
 * @param {Event} e - Form submission event
 * @returns {Promise<void>}
 */
async function handleEditSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const id = form.dataset.receiptId;
    const formData = new FormData(form);
    
    const btn = form.querySelector('button[type="submit"]');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Saving...`;
    
    try {
        const response = await fetch(`/receipts/api/update/${id}`, {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        
        if (result.success) {
            showToast(result.message, 'success');
            closeEditModal();
            
            // Update local master collection
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
        console.error("handleEditSubmit Error:", e);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Action: confirmDeleteReceipt
 * Orchestrates the Mandatory Action deletion flow for a specific receipt.
 * 
 * @param {number} id - Receipt identifier
 * @param {string} name - Merchant/filename for confirmation text
 */
function confirmDeleteReceipt(id, name) {
    const text = document.getElementById('deleteReceiptText');
    const btn = document.getElementById('confirmDeleteReceiptBtn');
    const modal = document.getElementById('deleteReceiptModal');

    if (text) text.innerHTML = `Are you sure you want to permanently delete the receipt for <strong>${escapeHtml(name)}</strong>?`;
    
    if (btn) {
        btn.onclick = async () => {
            const originalHtml = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = `${getIcon('waiting')} Deleting...`;
            
            try {
                const response = await fetch(`/receipts/api/delete/${id}`, { method: 'POST' });
                const result = await response.json();
                
                // Lifecycle Cleanup: restore button state
                btn.disabled = false;
                btn.innerHTML = originalHtml;

                if (result.success) {
                    showToast(result.message, 'success');
                    currentReceipts = currentReceipts.filter(r => r.id != id);
                    closeLocalModal('deleteReceiptModal');
                    renderStats();
                    renderReceipts(false);
                } else {
                    showToast(result.error || 'Failed to delete receipt.', 'error');
                }
            } catch (e) {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
                console.error("deleteReceipt Error:", e);
                showToast("Network error during deletion", "error");
            }
        };
    }
    
    if (modal) modal.style.display = 'flex';
}

/**
 * Interface: closeLocalModal
 * Utility for closing localized single-button modals.
 * 
 * @param {string} id - Modal identifier
 */
function closeLocalModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.style.display = 'none';
}

/**
 * Action: deleteReceipt (Legacy - Retained for API compatibility)
...
 */
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
        console.error("deleteReceipt Error:", e);
        showToast("Network error during deletion", "error");
    }
}

/**
 * --- UI Helpers & Utilities ---
 */

/**
 * Syncs the filter select elements with dynamic store and uploader lists.
 */
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

/**
 * Captures current values of all ledger filter inputs.
 * 
 * @returns {Object} - Active filter state
 */
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

/**
 * Resolves store branding assets from filesystem based on name.
 * 
 * @param {string} name - Merchant name
 * @returns {string|null} - Path to branding image or null
 */
function getStoreIcon(name) {
    if (!name) return null;
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    return `/images/shops/${slug}.png`;
}

/**
 * Prevents XSS by sanitizing dynamic HTML injections.
 * 
 * @param {string} text - Raw input
 * @returns {string} - Sanitized HTML
 */
function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * --- Crop and Refinement Workflow ---
 */

/**
 * Workflow: initPreUploadCrop
 * Initializes the refinement interface for new uploads.
 * Handles HEIC to JPEG conversion for browser-side cropping.
 * 
 * @param {File} file - Raw uploaded file
 * @returns {Promise<void>}
 */
async function initPreUploadCrop(file) {
    let displayFile    = file;
    const lowerName    = file.name.toLowerCase();
    
    // Compatibility: convert HEIC formats for preview display
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

    const modal = document.getElementById('preUploadCropModal');
    const img   = document.getElementById('preUploadCropImg');
    const applyBtn = document.querySelector('#preUploadCropModal .btn-primary');
    
    if (modal && img) {
        // Cleanup previous instances to prevent memory leaks
        if (cropper) {
            cropper.destroy();
            cropper = null;
        }

        if (applyBtn) {
            applyBtn.disabled = true;
            applyBtn.innerHTML = 'Initializing...';
        }

        const objectUrl = URL.createObjectURL(displayFile);
        
        img.onload = async function() {
            try {
                if (img.decode) await img.decode();
                
                modal.style.display = 'flex';
                
                // Initialize Cropper engine with automated area detection
                cropper = new Cropper(img, { 
                    viewMode: 1, 
                    autoCropArea: 1, 
                    responsive: true,
                    checkOrientation: true,
                    ready() {
                        if (applyBtn) {
                            applyBtn.disabled = false;
                            applyBtn.innerHTML = 'Apply Crop';
                        }
                    }
                });
            } catch (err) {
                console.error("Cropper init error", err);
                showToast("Failed to initialize cropping engine", "error");
            }
            
            // Lifecycle: revoke URL to free memory after safe margin
            setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
        };
        
        img.onerror = (err) => {
            showToast("Failed to load image preview", "error");
        };

        img.src = objectUrl;
    }
}

/**
 * Action: applyPreUploadCrop
 * Captures the current crop area and stores it as a blob for subsequent upload.
 */
function applyPreUploadCrop() {
    if (!cropper) return;
    
    const btn = document.querySelector('#preUploadCropModal .btn-primary');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Refining...';

    // Captures with white background to prevent black padding in non-square crops
    const canvas = cropper.getCroppedCanvas({ fillColor: '#fff' });
    
    if (!canvas) {
        showToast('Error generating refined image', 'error');
        btn.disabled = false;
        btn.innerHTML = originalHtml;
        return;
    }

    canvas.toBlob((blob) => {
        if (!blob) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
            return;
        }

        // Store refinement data for the handleUpload hook
        refinedBlob = blob;
        const fileInput = document.getElementById('file');
        refinedName = fileInput.files[0].name.replace(/\.[^/.]+$/, "") + ".png";
        
        updateFileName("(Refined) " + refinedName);
        showToast('Image refined! Ready to upload.', 'success');
        
        if (cropper) {
            cropper.destroy();
            cropper = null;
        }
        
        closePreUploadCropModal();
        
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }, 'image/png');
}

/**
 * UI: updateFileName
 * Updates the display name in the upload zone.
 * 
 * @param {string} name - Filename
 */
function updateFileName(name) {
    const fileNameDisplay = document.getElementById('fileName');
    if (fileNameDisplay) {
        fileNameDisplay.textContent = name;
        fileNameDisplay.style.display = 'block';
    }
}

/**
 * --- Interface Handlers & Legacy Actions ---
 */

/**
 * Interface: openReceiptModal
 * Displays the full-size receipt image in a lightbox.
 */
window.openReceiptModal = function(id) {
    const modalImg = document.getElementById('modalImg');
    const modal    = document.getElementById('receiptModal');
    if (modalImg && modal) {
        modalImg.src            = '/receipts/serve/' + id;
        modal.style.display     = 'flex';
    }
};

/**
 * Interface: openEditModal
 * Pre-fills the metadata editor and manages AI data application buttons.
 * 
 * @param {Object} receipt - Receipt record
 */
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
        
        // Context: only show AI button if structured data exists
        if (btnAI) {
            if (receipt.ai_json && receipt.ai_json.trim().startsWith('{')) {
                btnAI.style.display = 'flex';
                btnAI.onclick = () => {
                    try {
                        const data = JSON.parse(receipt.ai_json);
                        if (data.store_name) document.getElementById('editStoreName').value = data.store_name;
                        if (data.total_amount) document.getElementById('editAmount').value = data.total_amount;
                        // Transform date format for HTML input compatibility
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

/**
 * Interface: openCropModal
 * Initializes post-upload refinement for an existing record.
 * 
 * @param {number} id - Receipt ID
 */
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
        
        // Format check: convert HEIC if necessary
        if (blob.type === 'image/heic' || blob.type === 'image/heif') {
            showToast('Converting HEIC for preview...', 'info');
            const convertedBlob = await heic2any({ blob: blob, toType: 'image/jpeg', quality: 0.8 });
            displayBlob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
        }
        
        const objectUrl = URL.createObjectURL(displayBlob);
        img.onload = function() {
            if (cropper) cropper.destroy();
            cropper = new Cropper(img, { 
                viewMode: 1, 
                autoCropArea: 1, 
                responsive: true,
                checkOrientation: true
            });
            showToast('Ready to crop.', 'success');
            URL.revokeObjectURL(objectUrl);
        };
        img.src = objectUrl;
        
        // Scope the save button to this specific record ID
        window.saveCrop = async function() {
            if (!cropper) return;
            const btn = document.querySelector('#cropModal .btn-primary');
            const originalHtml = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = 'Saving...';

            const canvas = cropper.getCroppedCanvas({ fillColor: '#fff' });
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
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = originalHtml;
                }
            }, 'image/png');
        };
    } catch (err) {
        console.error('Failed to load image for cropping:', err);
        showToast('Error loading image.', 'error');
        closeCropModal();
    }
};

/**
 * Action: triggerOCR
 * Initiates the AI-driven OCR scan for a specific receipt.
 * 
 * @param {number} id - Receipt ID
 */
window.triggerOCR = function(id) {
    const btn             = document.getElementById('ocr-btn-' + id);
    const originalContent = btn.innerHTML;
    if (!btn) return;

    btn.disabled   = true;
    btn.innerHTML  = `${getIcon('waiting')} ...`;
    showToast('Scanning receipt... please wait.', 'info');
    
    fetch('/receipts/api/ocr/' + id, { method: 'POST' })
        .then(r => r.json())
        .then(data => {
            btn.disabled  = false;
            btn.innerHTML = originalContent;
            if (data.success) {
                showToast('OCR complete! Reviewing details.', 'success');
                // Open editor with extracted AI data
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

/**
 * Workflow: reScanReceipt
 * Orchestrates the Mandatory Action confirmation flow for receipt re-digitization.
 */
window.reScanReceipt = function() {
    const parentModal = document.getElementById('eReceiptModal');
    const receiptId = parentModal ? parentModal.dataset.receiptId : null;
    if (!receiptId) return;

    const btn = document.getElementById('confirmRescanBtn');
    const modal = document.getElementById('confirmRescanModal');

    if (btn) {
        // Logic: bind dynamic execution handler to the centered confirmation button
        btn.onclick = async () => {
            const originalHtml = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = `${getIcon('waiting')} Rescanning...`;

            try {
                // Execute the actual scan via the primary interface helper
                await viewElectronicReceipt(receiptId, 1);
                closeLocalModal('confirmRescanModal');
            } catch (err) {
                console.error("Rescan failed:", err);
            } finally {
                // Lifecycle Cleanup: Restore button state
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
        };
    }

    if (modal) modal.style.display = 'flex';
};

/**
 * Workflow: viewElectronicReceipt
 * Orchestrates the AI analysis or retrieval of structured receipt data.
 * Generates the "Electronic Receipt" visual fragment.
 * 
 * @param {number} id - Receipt ID
 * @param {number} force - Forced re-analysis flag (1/0)
 * @param {string|null} preLoadedData - Existing AI JSON string
 * @param {string|null} initialIcon - Merchant branding path
 */
window.viewElectronicReceipt = function(id, force = 0, preLoadedData = null, initialIcon = null) {
    const modal = document.getElementById('eReceiptModal');
    const content = document.getElementById('eReceiptContent');
    const rescanBtn = document.querySelector('.btn-ereceipt-rescan');
    const originalRescanHtml = rescanBtn ? rescanBtn.innerHTML : '';
    
    if (modal) {
        modal.style.display = 'flex';
        modal.dataset.receiptId = id;
    }

    // Optimization: avoid network call if valid data is provided and not forced
    if (preLoadedData && preLoadedData.trim() !== '' && !force) {
        try {
            const data = JSON.parse(preLoadedData);
            if (data && data.store_name) {
                renderEReceipt(data, initialIcon);
                return;
            }
        } catch(e) {}
    }

    if (content) content.innerHTML = getLoadingHtml('Digitizing...', 'Analyzing items and structured data', true);

    fetch(`/receipts/api/ai_analyze/${id}`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, 
        body: new URLSearchParams({ force: force }) 
    })
    .then(r => r.json())
    .then(res => {
        if (rescanBtn) {
            rescanBtn.disabled = false;
            rescanBtn.innerHTML = originalRescanHtml;
        }
        if (res.success) {
            showToast("AI Analysis complete", "success");
            loadState(); // Sync state to show AI badge in ledger
            renderEReceipt(res.data, initialIcon);
        } else {
            showToast(res.error || "AI analysis failed", "error");
            if (content) content.innerHTML = `<div class="alert alert-error">${res.error || 'AI analysis failed'}</div>`;
        }
    })
    .catch(() => {
        if (rescanBtn) {
            rescanBtn.disabled = false;
            rescanBtn.innerHTML = originalRescanHtml;
        }
    });
};

/**
 * UI Component: renderEReceipt
 * Generates the digital receipt view from AI-structured data.
 * 
 * @param {Object} data - Structured receipt data {store_name, items, total_amount, ...}
 * @param {string|null} iconUrl - Branding asset path
 */
function renderEReceipt(data, iconUrl = null) {
    const content = document.getElementById('eReceiptContent');
    if (!content) return;

    let displayDate = data.date || '';
    // Format date from YYYY-MM-DD to DD-MM-YYYY for display
    if (displayDate && displayDate.includes('-')) {
        const [y, m, d] = displayDate.split('-');
        if (y && m && d && y.length === 4) displayDate = `${d}-${m}-${y}`;
    }
    
    // Resolve icon if not provided
    if (!iconUrl && data.store_name) {
        const slug = data.store_name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
        iconUrl = `/images/shops/${slug}.png`;
    }

    // Build items list
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

/**
 * --- Modal Closures ---
 */
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
    if (modal && modal.style.display !== 'none') {
        modal.style.display = 'none';
        if (cropper) {
            cropper.destroy();
            cropper = null;
        }
        openUploadModal();
    }
}

function closeEReceiptModal() {
    const modal = document.getElementById('eReceiptModal');
    if (modal) modal.style.display = 'none';
}

function openUploadModal() {
    const modal = document.getElementById('uploadModal');
    if (modal) modal.style.display = 'flex';
}

function closeUploadModal() {
    const modal = document.getElementById('uploadModal');
    if (modal) modal.style.display = 'none';
    refinedBlob = null; // Clear state on closure
}

/**
 * Global Exposure
 * Necessary for event handling in templates and cross-module interaction.
 */
window.closeReceiptModal = closeReceiptModal;
window.closeEditModal = closeEditModal;
window.closeCropModal = closeCropModal;
window.closePreUploadCropModal = closePreUploadCropModal;
window.closeEReceiptModal = closeEReceiptModal;
window.openUploadModal = openUploadModal;
window.closeUploadModal = closeUploadModal;
window.initPreUploadCrop = initPreUploadCrop;
window.applyPreUploadCrop = applyPreUploadCrop;
window.updateFileName = updateFileName;
window.handleUpload = handleUpload;
window.loadState = loadState;
window.loadMore = loadMore;
window.triggerOCR = triggerOCR;
window.reScanReceipt = reScanReceipt;
window.viewElectronicReceipt = viewElectronicReceipt;
window.openEditModal = openEditModal;
window.openCropModal = openCropModal;
window.confirmDeleteReceipt = confirmDeleteReceipt;
window.closeLocalModal = closeLocalModal;
window.toggleStatTile = toggleStatTile;
