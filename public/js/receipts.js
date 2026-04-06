// /public/js/receipts.js

/**
 * Receipt Management Controller
 * 
 * This module manages the Receipt Ledger and AI-powered digitization pipeline.
 * It handles multipart binary transfers, client-side image manipulation,
 * and high-fidelity electronic receipt generation via Gemini 2.0.
 * 
 * Features:
 * - Real-time state-driven ledger with dynamic filtering and pagination
 * - Multi-stage image refinement (Cropper.js) for pre and post-upload flows
 * - Integrated AI OCR and structured data extraction
 * - HEIC/HEIF conversion for mobile cross-platform compatibility
 * - Automatic spend aggregation and merchant breakdown tiles
 * 
 * Dependencies:
 * - default.js: For apiPost, getLoadingHtml, getIcon, and modal helpers
 * - cropper.js: For high-resolution image manipulation
 */

/**
 * --- Module Configuration & State ---
 */
const CONFIG = {
    LIMIT: 10,                      // Pagination page density
    DEBOUNCE_MS: 300                // Search input throttle threshold
};

let STATE = {
    receipts: [],                   // Metadata collection for the active ledger
    stores: [],                     // Unique merchant roster for autocomplete
    uploaders: [],                  // User roster for permission filtering
    summary: {},                    // Spend aggregates (week, month, year)
    breakdown: {},                  // Merchant-specific totals for stats tiles
    isAdmin: false,                 // Authorization gate for destructive actions
    currentUser: '',                // Owner identification for ACL logic
    offset: 0,                      // Current pagination pointer
    cropper: null,                  // Active Cropper.js instance
    refinedBlob: null,              // Refined image data for upload pipeline
    refinedName: ''                 // Sanitized filename for refined uploads
};

/**
 * Bootstraps the module state and establishes event delegation.
 * 
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', () => {
    // Initial state synchronization
    loadState(true);

    // Event Delegation: Real-time Ledger Filtering
    const filterIds = ['filterSearch', 'filterStore', 'filterTime', 'filterAI', 'filterUploader', 'filterMinAmount'];
    filterIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        
        const eventType = el.tagName === 'SELECT' ? 'change' : 'input';
        let debounceTimer;
        
        el.addEventListener(eventType, () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                STATE.offset = 0;
                loadState(true);
            }, CONFIG.DEBOUNCE_MS);
        });
    });

    // Action: Filter Reset
    const resetBtn = document.getElementById('resetFilters');
    if (resetBtn) {
        resetBtn.onclick = () => {
            filterIds.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            STATE.offset = 0;
            loadState(true);
        };
    }

    // Action: Pagination
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (loadMoreBtn) loadMoreBtn.onclick = loadMore;

    // Interaction: Drop Zone Orchestration
    setupUploadOrchestration();

    // Modal: Global Closure Logic
    setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay', 'image-modal-overlay'], [
        closeReceiptModal, closeEditModal, closeCropModal, closePreUploadCropModal, closeEReceiptModal, closeConfirmModal, closeUploadModal
    ]);
});

/**
 * --- Core Logic & API Operations ---
 */

/**
 * Synchronizes the module state with the server (Single Source of Truth).
 * 
 * @async
 * @param {boolean} force - Whether to bypass sync inhibition guards.
 * @returns {Promise<void>}
 */
async function loadState(force = false) {
    const anyModalOpen = document.querySelector('.modal-overlay.show, .modal-overlay.active, .delete-modal-overlay.show, .delete-modal-overlay.active');
    const inputFocused = document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA';
    if (!force && (anyModalOpen || inputFocused)) return;

    const filters = getActiveFilters();
    const params = new URLSearchParams(filters);
    
    try {
        const response = await fetch(`/receipts/api/state?${params.toString()}`);
        const data = await response.json();

        if (data.success) {
            STATE.receipts = data.receipts;
            STATE.stores = data.store_names;
            STATE.uploaders = data.uploaders;
            STATE.summary = data.summary;
            STATE.breakdown = data.breakdown;
            STATE.isAdmin = data.is_admin || false;
            STATE.currentUser = data.current_user || '';
            STATE.offset = STATE.receipts.length;

            renderStats();
            renderReceipts(false);
            updateFilterDropdowns();
            
            const btn = document.getElementById('loadMoreBtn');
            if (btn) btn.classList.toggle('hidden', !(data.has_more || STATE.receipts.length >= CONFIG.LIMIT));
        }
    } catch (err) {
        console.error("loadState failure:", err);
    }
}

/**
 * Appends subsequent pages of data to the active ledger.
 * 
 * @async
 * @returns {Promise<void>}
 */
async function loadMore() {
    const btn = document.getElementById('loadMoreBtn');
    if (!btn) return;

    const anyModalOpen = document.querySelector('.modal-overlay.show, .modal-overlay.active, .delete-modal-overlay.show, .delete-modal-overlay.active');
    if (anyModalOpen) return;

    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `⌛ Loading...`;

    const filters = getActiveFilters();
    const params = new URLSearchParams({ ...filters, offset: STATE.offset });

    try {
        const response = await fetch(`/receipts/api/list?${params.toString()}`);
        const data = await response.json();

        if (data.success && data.receipts) {
            STATE.receipts = [...STATE.receipts, ...data.receipts];
            renderReceipts(true, data.receipts);
            STATE.offset = STATE.receipts.length;
            btn.classList.toggle('hidden', !data.has_more);
        }
    } catch (err) {
        console.error("loadMore failure:", err);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * UI Component: renderStats
 * Generates the spend aggregate tiles with merchant breakdowns.
 * 
 * @returns {void}
 */
function renderStats() {
    const container = document.getElementById('spendingSummaryContainer');
    if (!container) return;

    const periods = ['week', 'month', 'year'];
    const labels = { week: 'Weekly Spend', month: 'Monthly Spend', year: 'Yearly Spend' };

    container.innerHTML = periods.map(period => {
        const total = STATE.summary[period + '_total'] || 0;
        const sub = STATE.breakdown[period] || [];
        
        return `
            <div class="stat-tile" onclick="toggleStatTile(this)">
                <span class="stat-label">${labels[period]}</span>
                <span class="stat-value">
                    $${parseFloat(total).toFixed(2)}
                    <span class="tile-toggle-icon">🔽</span>
                </span>
                <div class="stat-breakdown">
                    ${sub.map(s => `
                        <div class="breakdown-row">
                            <span class="breakdown-store">
                                ${getStoreLogoHtml(s.store_name)}
                                ${escapeHtml(s.store_name)}
                            </span>
                            <span class="breakdown-total">$${parseFloat(s.total).toFixed(2)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }).join('');
}

/**
 * UI Engine: renderReceipts
 * Generates the master ledger from the current state.
 * 
 * @param {boolean} append - Whether to preserve existing rows.
 * @param {Array|null} batch - Subset of items for incremental updates.
 * @returns {void}
 */
function renderReceipts(append = false, batch = null) {
    const tbody = document.getElementById('receiptsTableBody');
    if (!tbody) return;

    if (!append && STATE.receipts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="receipt-empty-ledger">📭 No resources found in the vault.</td></tr>';
        return;
    }

    const items = append ? (batch || []) : STATE.receipts;
    const html = items.map(r => `
        <tr id="receipt-row-${r.id}">
            <td class="col-icon receipt-col-preview" data-label="Preview">
                ${r.mime_type.startsWith('image/') ? `
                    <div class="receipt-thumbnail-wrapper" onclick="openReceiptModal('${r.id}')">
                        <img src="/receipts/serve/${r.id}" class="receipt-thumb">
                    </div>
                ` : `<span class="receipt-fallback-icon">🧾</span>`}
            </td>
            <td data-label="Filename"><small>${escapeHtml(r.original_filename)}</small></td>
            <td data-label="Store">
                <div class="store-icon-wrapper">
                    ${getStoreLogoHtml(r.store_name)}
                    <strong>${escapeHtml(r.store_name || 'Unknown')}</strong>
                    ${r.ai_json ? `<span class="ai-badge" title="AI Digitized">🧠</span>` : ''}
                </div>
                ${r.description ? `<br><small class="receipt-description">${escapeHtml(r.description)}</small>` : ''}
            </td>
            <td data-label="Date">${r.formatted_date || '-'}</td>
            <td data-label="Total" class="receipt-total-value">$${parseFloat(r.total_amount || 0).toFixed(2)}</td>
            <td data-label="Uploaded By"><small>${escapeHtml(r.uploaded_by)}</small></td>
            <td class="col-actions">
                <div class="action-buttons">
                    <a href="/receipts/serve/${r.id}" target="_blank" class="btn-icon-view" title="Original">👁️</a>
                    <button type="button" 
                            class="btn-icon-ai" 
                            data-receipt-id="${r.id}"
                            data-ai-json="${escapeHtml(r.ai_json || "")}"
                            data-store-icon="${getStoreLogoUrl(r.store_name)}"
                            onclick="viewElectronicReceipt(this.dataset.receiptId, 0, this.dataset.aiJson, this.dataset.storeIcon)" 
                            title="Electronic">🧠</button>
                    ${(r.uploaded_by === STATE.currentUser || STATE.isAdmin) ? `
                        <button type="button" class="btn-icon-crop" onclick="openCropModal('${r.id}')" title="Refine">✂️</button>
                        <button type="button" class="btn-icon-bonus" onclick="triggerOCR('${r.id}')" title="OCR Scan" id="ocr-btn-${r.id}">🔍</button>
                        <button type="button" class="btn-icon-edit" onclick="openEditModal(this.dataset.receipt)" data-receipt='${escapeHtml(JSON.stringify(r))}' title="Edit">✏️</button>
                        <button type="button" class="btn-icon-delete" onclick="confirmDeleteReceipt('${r.id}', '${escapeHtml(r.store_name || r.original_filename)}')" title="Delete">🗑️</button>
                    ` : ''}
                </div>
            </td>
        </tr>
    `).join('');

    if (append) tbody.insertAdjacentHTML('beforeend', html);
    else tbody.innerHTML = html;
}

/**
 * --- Action Handlers ---
 */

/**
 * Orchestrates the multipart upload pipeline.
 * 
 * @async
 * @param {Event} e - Form submission event.
 * @returns {Promise<void>}
 */
async function handleUpload(e) {
    if (e) e.preventDefault();
    const form = document.getElementById('uploadForm');
    const formData = new FormData(form);
    const btn = document.getElementById('uploadSubmitBtn');
    
    if (STATE.refinedBlob) {
        formData.delete('file');
        formData.append('file', STATE.refinedBlob, STATE.refinedName || 'receipt.png');
    }

    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `⌛ Uploading...`;
    btn.classList.add('receipt-btn-waiting');

    showLoadingOverlay('Processing receipt...', 'Performing binary scan and OCR extraction.');
    
    try {
        const result = await apiPost('/receipts/api/upload', formData);
        if (result && result.success) {
            form.reset();
            const display = document.getElementById('fileName');
            if (display) display.classList.add('hidden');
            closeUploadModal();
            loadState(true);
            showToast('Receipt uploaded successfully', 'success');
        }
    } finally {
        hideLoadingOverlay();
        btn.disabled = false;
        btn.innerHTML = originalHtml;
        btn.classList.remove('receipt-btn-waiting');
    }
}

/**
 * Updates metadata for an existing record.
 * 
 * @async
 * @param {Event} e - Form submission event.
 * @returns {Promise<void>}
 */
async function handleEditSubmit(e) {
    if (e) e.preventDefault();
    const form = e.target;
    const id = form.dataset.receiptId;
    const formData = new FormData(form);
    
    const btn = form.querySelector('button[type="submit"]');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `⌛ Syncing...`;
    
    try {
        const result = await apiPost(`/receipts/api/update/${id}`, formData);
        if (result && result.success) {
            closeEditModal();
            loadState(true);
            showToast('Record updated', 'success');
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Orchestrates the Mandatory Action deletion flow.
 * 
 * @param {number} id - Target identifier.
 * @param {string} name - Merchant context.
 * @returns {void}
 */
function confirmDeleteReceipt(id, name) {
    showConfirmModal({
        title: 'Delete Receipt',
        message: `Permanently delete record for <strong>${escapeHtml(name)}</strong>?`,
        danger: true,
        confirmText: 'Delete',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const result = await apiPost(`/receipts/api/delete/${id}`);
            if (result && result.success) {
                loadState(true);
                showToast('Record permanently removed', 'success');
            }
        }
    });
}

/**
 * --- Interface & Utility Helpers ---
 */

/**
 * Configures the drag-and-drop orchestration.
 * 
 * @returns {void}
 */
function setupUploadOrchestration() {
    const zone = document.getElementById('dropZone');
    const input = document.getElementById('file');
    if (!zone || !input) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(e => {
        zone.addEventListener(e, evt => { evt.preventDefault(); evt.stopPropagation(); });
    });
    
    zone.addEventListener('dragover', () => zone.classList.add('dragover'));
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', evt => {
        if (evt.dataTransfer.files.length) {
            input.files = evt.dataTransfer.files;
            input.dispatchEvent(new Event('change'));
        }
    });

    input.addEventListener('change', function() {
        if (this.files.length > 0) {
            const file = this.files[0];
            updateFileName(file.name);
            STATE.refinedBlob = null;
            const low = file.name.toLowerCase();
            if (file.type.startsWith('image/') || low.endsWith('.heic') || low.endsWith('.heif')) {
                // Hide modal manually instead of calling closeUploadModal() to preserve form state
                const m = document.getElementById('uploadModal');
                if (m) m.classList.remove('show');
                initPreUploadCrop(file);
            }
        }
    });
}

/**
 * Synchronizes the filter and editor datalists with current state.
 * 
 * @returns {void}
 */
function updateFilterDropdowns() {
    const storeSel = document.getElementById('filterStore');
    const dataList = document.getElementById('edit_store_list');
    
    // 1. Synchronize Store Filter (preserve selection)
    if (storeSel) {
        const val = storeSel.value;
        storeSel.innerHTML = '<option value="">All Stores</option>' + 
            STATE.stores.map(n => `<option value="${escapeHtml(n)}" ${n === val ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('');
    }
    
    // 2. Synchronize Edit Datalist
    if (dataList) {
        dataList.innerHTML = STATE.stores.map(n => `<option value="${escapeHtml(n)}">`).join('');
    }

    // 3. Synchronize Uploader Filter (preserve selection)
    const upSel = document.getElementById('filterUploader');
    if (upSel) {
        const val = upSel.value;
        upSel.innerHTML = '<option value="">All Uploaders</option>' + 
            STATE.uploaders.map(u => `<option value="${escapeHtml(u.username)}" ${u.username === val ? 'selected' : ''}>${escapeHtml(u.username)}</option>`).join('');
    }
}

/**
 * Captures active ledger filter values.
 * 
 * @returns {Object} - Active filters.
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
 * Toggles expanded breakdown for stats tiles on mobile.
 * 
 * @param {HTMLElement} el - Clicked tile.
 * @returns {void}
 */
function toggleStatTile(el) {
    const icon = el.querySelector('.tile-toggle-icon');
    if (icon && getComputedStyle(icon).display !== 'none') el.classList.toggle('expanded');
}

/**
 * Generates URL for merchant branding assets.
 * 
 * @param {string} name - Merchant name.
 * @returns {string} - Asset URL.
 */
function getStoreLogoUrl(name) {
    if (!name) return '';
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    return `/images/shops/${slug}.png`;
}

/**
 * Generates HTML for merchant branding assets.
 * 
 * @param {string} name - Merchant name.
 * @returns {string} - IMG tag or empty.
 */
function getStoreLogoHtml(name) {
    const url = getStoreLogoUrl(name);
    if (!url) return '';
    return `<img src="${url}" class="store-logo" alt="" onerror="this.classList.add('hidden')">`;
}

/**
 * --- Image Refinement & AI Digitization ---
 */

/**
 * Initializes the pre-upload image manipulation flow.
 * 
 * @async
 * @param {File} file - Raw source file.
 * @returns {Promise<void>}
 */
async function initPreUploadCrop(file) {
    let source = file;
    const low = file.name.toLowerCase();
    
    if (low.endsWith('.heic') || low.endsWith('.heif')) {
        showToast('Processing modern image format...', 'info');
        try {
            const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.8 });
            source = Array.isArray(blob) ? blob[0] : blob;
        } catch (err) {
            showToast('Conversion failed', 'error');
            return;
        }
    }

    const modal = document.getElementById('preUploadCropModal');
    const img   = document.getElementById('preUploadCropImg');
    const btn   = document.querySelector('#preUploadCropModal .btn-primary');
    
    if (!modal || !img) return;
    if (STATE.cropper) STATE.cropper.destroy();

    const url = URL.createObjectURL(source);
    img.onload = async () => {
        if (img.decode) await img.decode();
        modal.classList.add('show');
        STATE.cropper = new Cropper(img, { 
            viewMode: 1, 
            autoCropArea: 1, 
            responsive: true,
            checkOrientation: true
        });
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    };
    img.src = url;
}

/**
 * Captures the refined image area for the upload queue.
 * 
 * @returns {void}
 */
function applyPreUploadCrop() {
    if (!STATE.cropper) return;
    
    const btn = document.querySelector('#preUploadCropModal .btn-primary');
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `⌛ Refining...`;

    STATE.cropper.getCroppedCanvas({ fillColor: '#fff' }).toBlob(blob => {
        if (blob) {
            STATE.refinedBlob = blob;
            const input = document.getElementById('file');
            STATE.refinedName = input.files[0].name.replace(/\.[^/.]+$/, "") + ".png";
            updateFileName("(Refined) " + STATE.refinedName);
            showToast('Image optimized', 'success');
            STATE.cropper.destroy();
            STATE.cropper = null;
            closePreUploadCropModal();
        }
        btn.disabled = false;
        btn.innerHTML = original;
    }, 'image/png');
}

/**
 * Updates the display name in the drop zone.
 * 
 * @param {string} name - Target filename.
 * @returns {void}
 */
function updateFileName(name) {
    const el = document.getElementById('fileName');
    if (el) { el.textContent = name; el.classList.remove('hidden'); }
    
    const btn = document.getElementById('uploadSubmitBtn');
    if (btn) btn.classList.remove('hidden');
}

/**
 * Displays the full-size receipt Lightbox.
 * 
 * @param {number} id - Target identifier.
 * @returns {void}
 */
function openReceiptModal(id) {
    const img = document.getElementById('modalImg');
    const modal = document.getElementById('receiptModal');
    if (img && modal) { img.src = '/receipts/serve/' + id; modal.classList.add('show'); }
}

/**
 * Pre-fills the metadata editor.
 * 
 * @param {string} rawJson - Stringified record data.
 * @returns {void}
 */
function openEditModal(rawJson) {
    const r = JSON.parse(rawJson);
    const modal = document.getElementById('editModal');
    const form  = document.getElementById('editForm');
    const btnAI = document.getElementById('btnApplyAI');

    if (!modal || !form) return;
    form.dataset.receiptId = r.id;
    document.getElementById('editStoreName').value   = r.store_name   || '';
    document.getElementById('editDate').value        = r.receipt_date || '';
    document.getElementById('editAmount').value      = r.total_amount || '';
    document.getElementById('editDescription').value = r.description || '';
    
    if (btnAI) {
        btnAI.classList.toggle('hidden', !r.ai_json);
        btnAI.onclick = () => {
            try {
                const data = JSON.parse(r.ai_json);
                if (data.store_name) document.getElementById('editStoreName').value = data.store_name;
                if (data.total_amount) document.getElementById('editAmount').value = data.total_amount;
                if (data.date) {
                    let d = data.date;
                    // Handle DD/MM/YYYY or DD-MM-YYYY
                    if (d.match(/^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/)) {
                        const parts = d.split(/[/-]/);
                        d = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                    }
                    // Handle YY.MM.DD or YYYY.MM.DD
                    else if (d.match(/^\d{2,4}\.\d{1,2}\.\d{1,2}$/)) {
                        const parts = d.split('.');
                        let y = parts[0];
                        if (y.length === 2) y = '20' + y;
                        d = `${y}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
                    }
                    document.getElementById('editDate').value = d;
                }
                showToast("AI data synchronized", "success");
            } catch (err) { console.error("AI apply error:", err); }
        };
    }
    modal.classList.add('show');
}

/**
 * Initializes the post-upload manipulation flow.
 * 
 * @async
 * @param {number} id - Target identifier.
 * @returns {Promise<void>}
 */
async function openCropModal(id) {
    const modal = document.getElementById('cropModal');
    const img   = document.getElementById('cropImg');
    if (!modal || !img) return;
    modal.classList.add('show');
    
    try {
        const response = await fetch('/receipts/serve/' + id);
        const blob = await response.blob();
        let display = blob;
        
        if (blob.type === 'image/heic' || blob.type === 'image/heif') {
            const conv = await heic2any({ blob: blob, toType: 'image/jpeg', quality: 0.8 });
            display = Array.isArray(conv) ? conv[0] : conv;
        }
        
        const url = URL.createObjectURL(display);
        img.onload = () => {
            if (STATE.cropper) STATE.cropper.destroy();
            STATE.cropper = new Cropper(img, { viewMode: 1, autoCropArea: 1, responsive: true, checkOrientation: true });
            URL.revokeObjectURL(url);
        };
        img.src = url;
        
        window.saveCrop = async () => {
            if (!STATE.cropper) return;
            const btn = document.querySelector('#cropModal .btn-primary');
            const original = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = `⌛ Saving...`;

            STATE.cropper.getCroppedCanvas({ fillColor: '#fff' }).toBlob(async b => {
                const fd = new FormData();
                fd.append('cropped_image', b, 'receipt_cropped.png');
                const res = await apiPost('/receipts/api/crop/' + id, fd);
                if (res && res.success) {
                    showToast('Optimized', 'success');
                    closeCropModal();
                    loadState(true);
                }
                btn.disabled = false;
                btn.innerHTML = original;
            }, 'image/png');
        };
    } catch (err) {
        closeCropModal();
    }
}

/**
 * Initiates an AI OCR scan for an existing record.
 * 
 * @async
 * @param {number} id - Target identifier.
 * @returns {Promise<void>}
 */
async function triggerOCR(id) {
    const btn = document.getElementById('ocr-btn-' + id);
    if (!btn) return;

    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `⌛ ...`;
    
    try {
        const data = await apiPost('/receipts/api/ocr/' + id);
        if (data && data.success) {
            loadState(true);
            showToast('Scan complete', 'success');
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = original;
    }
}

/**
 * Displays the AI-structured electronic receipt view.
 * 
 * @async
 * @param {number} id - Target identifier.
 * @param {number} force - Forced rescan flag.
 * @param {string|null} preLoaded - Existing AI JSON.
 * @param {string|null} initialIcon - Merchant branding path.
 * @returns {Promise<void>}
 */
async function viewElectronicReceipt(id, force = 0, preLoaded = null, initialIcon = null) {
    const modal = document.getElementById('eReceiptModal');
    const content = document.getElementById('eReceiptContent');
    if (!modal || !content) return;

    modal.classList.add('show');
    modal.dataset.receiptId = id;
    modal.dataset.initialIcon = initialIcon || '';

    if (preLoaded && !force) {
        try {
            // Decode entities (like &#39;) before parsing
            const doc = new DOMParser().parseFromString(preLoaded, 'text/html');
            const decoded = doc.documentElement.textContent;
            const data = JSON.parse(decoded);
            if (data && data.store_name) { renderEReceipt(data, initialIcon); return; }
        } catch(e) {
            console.error("Failed to parse pre-loaded AI data:", e);
        }
    }

    content.innerHTML = getLoadingHtml('Digitizing...', 'Analyzing structured data', true);

    try {
        const res = await apiPost(`/receipts/api/ai_analyze/${id}`, new URLSearchParams({ force: force }));
        if (res && res.success) {
            loadState(true);
            renderEReceipt(res.data, initialIcon);
        } else {
            const errorMsg = res.error || 'AI Analysis failed';
            content.innerHTML = `
                <div class="alert alert-error">
                    <p>⚙️ <strong>Analysis Failed</strong></p>
                    <p class="error-detail">${errorMsg}</p>
                </div>`;
        }
    } catch (err) {
        content.innerHTML = `<div class="alert alert-error">❌ Network error</div>`;
    }
}

/**
 * Normalizes time strings to HH:MM AM/PM format.
 * 
 * @param {string} timeStr - Raw time string.
 * @returns {string} - Formatted time.
 */
function formatTime(timeStr) {
    if (!timeStr) return '';
    
    // Attempt to parse standard 24h or 12h formats
    const match = timeStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(\s*[AaPp][Mm])?$/);
    if (match) {
        let h = parseInt(match[1]);
        const m = match[2];
        let ampm = match[4] ? match[4].trim().toUpperCase() : (h >= 12 ? 'PM' : 'AM');
        
        h = h % 12 || 12; // Convert to 12h format
        return `${h}:${m} ${ampm}`;
    }
    
    return timeStr;
}

/**
 * Generates the digital receipt visual fragment.
 * 
 * @param {Object} data - Structured data.
 * @param {string|null} iconUrl - Merchant branding path.
 * @returns {void}
 */
function renderEReceipt(data, iconUrl = null) {
    const content = document.getElementById('eReceiptContent');
    if (!content) return;

    let d = data.date || '';
    if (d && d.includes('-')) {
        const [y, m, day] = d.split('-');
        if (y.length === 4) d = `${day}-${m}-${y}`;
    }
    
    const displayTime = formatTime(data.time || '');
    
    // Fallback if iconUrl not provided
    if (!iconUrl && data.store_name) {
        iconUrl = getStoreLogoUrl(data.store_name);
    }

    const items = (data.items || []).map(i => `
        <div class="ereceipt-item">
            <div class="ereceipt-item-content">
                <div class="ereceipt-item-desc">${escapeHtml(i.desc || 'Item')}</div>
                ${i.qty ? `<small class="ereceipt-item-qty">Qty: ${i.qty}</small>` : ''}
            </div>
            <div class="ereceipt-item-price">$${parseFloat(i.line_total || i.price || 0).toFixed(2)}</div>
        </div>
    `).join('');

    content.innerHTML = `
        <div class="ereceipt-body">
            <div class="ereceipt-summary">
                ${iconUrl ? `<img src="${iconUrl}" class="ereceipt-store-logo" onerror="this.classList.add('hidden')">` : ''}
                <h2 class="ereceipt-store-name">${escapeHtml(data.store_name || 'Merchant')}</h2>
                <p class="ereceipt-datetime">${d} ${displayTime}</p>
            </div>
            <div class="ereceipt-items-list">${items || '<div class="ereceipt-empty-items">No items extracted</div>'}</div>
            <div class="ereceipt-total-container">
                <div class="ereceipt-total-row"><span>TOTAL</span><span>$${parseFloat(data.total_amount || 0).toFixed(2)}</span></div>
            </div>
        </div>
    `;
}

/**
 * Orchestrates receipt re-digitization.
 * 
 * @async
 * @returns {Promise<void>}
 */
async function reScanReceipt() {
    const modal = document.getElementById('eReceiptModal');
    if (modal?.dataset.receiptId) {
        showConfirmModal({
            title: 'Full Rescan',
            icon: 'ai',
            message: 'Overwrite existing digitized data?',
            confirmText: 'Rescan',
            confirmIcon: 'search',
            hideCancel: true,
            alignment: 'center',
            onConfirm: async () => { await viewElectronicReceipt(modal.dataset.receiptId, 1, null, modal.dataset.initialIcon); }
        });
    }
}

/**
 * --- Modal Management ---
 */

/**
 * Hides the full-size receipt Lightbox.
 * 
 * @returns {void}
 */
function closeReceiptModal() { const m = document.getElementById('receiptModal'); if (m) m.classList.remove('show'); }

/**
 * Hides the metadata editor.
 * 
 * @returns {void}
 */
function closeEditModal() { const m = document.getElementById('editModal'); if (m) m.classList.remove('show'); }

/**
 * Hides the post-upload refinement interface.
 * 
 * @returns {void}
 */
function closeCropModal() { const m = document.getElementById('cropModal'); if (m) m.classList.remove('show'); }

/**
 * Hides the AI-structured data view.
 * 
 * @returns {void}
 */
function closeEReceiptModal() { const m = document.getElementById('eReceiptModal'); if (m) m.classList.remove('show'); }

/**
 * Displays the binary transfer interface.
 * 
 * @returns {void}
 */
function openUploadModal() { const m = document.getElementById('uploadModal'); if (m) m.classList.add('show'); }

/**
 * Hides the binary transfer interface and clears pending state.
 * 
 * @returns {void}
 */
function closeUploadModal() { 
    const m = document.getElementById('uploadModal'); 
    if (m) m.classList.remove('show'); 
    
    const form = document.getElementById('uploadForm');
    if (form) form.reset();

    const display = document.getElementById('fileName');
    if (display) display.classList.add('hidden');

    const btn = document.getElementById('uploadSubmitBtn');
    if (btn) btn.classList.add('hidden');

    STATE.refinedBlob = null; 
}

/**
 * Hides the pre-upload image refinement modal.
 * 
 * @returns {void}
 */
function closePreUploadCropModal() {
    const m = document.getElementById('preUploadCropModal');
    if (m && m.classList.contains('show')) {
        m.classList.remove('show');
        if (STATE.cropper) { STATE.cropper.destroy(); STATE.cropper = null; }
        openUploadModal();
    }
}

/**
 * --- Global Exposure ---
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
window.toggleStatTile = toggleStatTile;
window.handleEditSubmit = handleEditSubmit;