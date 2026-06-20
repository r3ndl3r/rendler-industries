// /public/js/fuel.js

/**
 * Fuel Management Controller
 *
 * This module manages vehicle fuel logs, dual-image uploads, AI extraction
 * review, and vehicle configuration from a single state-driven interface.
 *
 * Features:
 * - Real-time ledger rendering from consolidated server state
 * - Dual image upload with unordered odometer and pump photos
 * - Manual review workflow for uncertain AI extraction
 * - Inline vehicle management through a custom modal
 *
 * Dependencies:
 * - default.js: For apiGet, apiPost, modal helpers, and shared escaping
 * - toast.js: For user feedback
 */

/**
 * --- Module Configuration & State ---
 */
const CONFIG = {
    SYNC_INTERVAL_MS: 300000,
    DEBOUNCE_MS: 300,
    FUEL_UPLOAD_MAX_EDGE: 1280,
    FUEL_UPLOAD_JPEG_QUALITY: 0.82
};

let STATE = {
    logs: [],
    vehicles: [],
    activeVehicles: [],
    stations: [],
    uploaders: [],
    summary: {},
    currentUser: '',
    isAdmin: false,
    refinedBlobs: { image1: null, image2: null },
    uploadErrors: { image1: null, image2: null },
    uploadProcessing: { image1: false, image2: false },
    uploadTokens: { image1: 0, image2: 0 }
};

let UPLOAD_PREVIEW_URLS = {
    image1: null,
    image2: null
};
let MODAL_IMAGE_URL = null;

const MANUAL_UPLOAD_FIELDS = ['uploadOdometer', 'uploadLitres', 'uploadTotal', 'uploadStation'];

/**
 * Bootstraps state loading, filters, uploads, and modal behavior.
 *
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', () => {
    loadState(true);
    setupFilters();
    setupUploadInputs();
    setupUploadMode();
    setupGlobalModalClosing(['modal-overlay'], [
        closeUploadModal,
        closeEditModal,
        closeVehicleModal,
        closeImageModal,
        closeConfirmModal
    ]);
    setInterval(loadState, CONFIG.SYNC_INTERVAL_MS);
});

/**
 * Synchronizes fuel state from the server.
 *
 * @async
 * @param {boolean} force - Whether to bypass focus and modal guards.
 * @returns {Promise<void>}
 */
async function loadState(force = false) {
    const anyModalOpen = document.querySelector('.modal-overlay.show');
    const inputFocused = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'SELECT');
    if (!force && (anyModalOpen || inputFocused) && STATE.logs.length > 0) return;
    if (!force && typeof navigator !== 'undefined' && navigator.onLine === false) return;

    const params = new URLSearchParams(getActiveFilters());
    const data = await apiGet(`/fuel/api/state?${params.toString()}`);
    if (!data || !data.success) return;

    STATE.logs = data.logs || [];
    STATE.vehicles = data.vehicles || [];
    STATE.activeVehicles = data.active_vehicles || [];
    STATE.stations = data.station_names || [];
    STATE.uploaders = data.uploaders || [];
    STATE.summary = data.summary || {};
    STATE.currentUser = data.current_user || '';
    STATE.isAdmin = !!data.is_admin;

    renderSummary();
    renderLogs();
    updateDropdowns();
    renderVehicleList();
}

/**
 * Wires filter controls with debounced state refresh.
 *
 * @returns {void}
 */
function setupFilters() {
    const filterIds = ['filterSearch', 'filterVehicle', 'filterTime', 'filterAI', 'filterUploader'];
    filterIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const eventType = el.tagName === 'SELECT' ? 'change' : 'input';
        let timer = null;
        el.addEventListener(eventType, () => {
            clearTimeout(timer);
            timer = setTimeout(() => loadState(true), CONFIG.DEBOUNCE_MS);
        });
    });

    const reset = document.getElementById('resetFilters');
    if (reset) {
        reset.addEventListener('click', () => {
            filterIds.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            loadState(true);
        });
    }
}

/**
 * Captures current filter values for the state endpoint.
 *
 * @returns {Object} Active filter values.
 */
function getActiveFilters() {
    return {
        search: document.getElementById('filterSearch')?.value || '',
        vehicle_id: document.getElementById('filterVehicle')?.value || '',
        days: document.getElementById('filterTime')?.value || '',
        ai_status: document.getElementById('filterAI')?.value || '',
        uploader: document.getElementById('filterUploader')?.value || ''
    };
}

/**
 * Renders dashboard metrics from the current state.
 *
 * @returns {void}
 */
function renderSummary() {
    const container = document.getElementById('fuelSummaryContainer');
    if (!container) return;

    const summary = STATE.summary || {};
    const priceDelta = Number(summary.current_month_price || 0) - Number(summary.previous_month_price || 0);
    const priceSub = Number(summary.previous_month_price || 0) > 0
        ? `${priceDelta >= 0 ? '+' : ''}$${priceDelta.toFixed(3)} vs last month`
        : 'No previous month';

    container.innerHTML = `
        <div class="fuel-stat-tile">
            <span class="fuel-stat-label">Current Efficiency</span>
            <span class="fuel-stat-value">${formatOptional(summary.current_l_per_100km, ' L/100km')}</span>
            <span class="fuel-stat-sub">${formatOptional(summary.current_cost_per_km, ' $/km')}</span>
        </div>
        <div class="fuel-stat-tile">
            <span class="fuel-stat-label">Monthly Spend</span>
            <span class="fuel-stat-value">$${formatMoney(summary.month_total)}</span>
            <span class="fuel-stat-sub">$${formatMoney(summary.week_total)} this week</span>
        </div>
        <div class="fuel-stat-tile">
            <span class="fuel-stat-label">Monthly Volume</span>
            <span class="fuel-stat-value">${Number(summary.month_litres || 0).toFixed(2)} L</span>
            <span class="fuel-stat-sub">$${formatMoney(summary.year_total)} this year</span>
        </div>
        <div class="fuel-stat-tile">
            <span class="fuel-stat-label">Average Price</span>
            <span class="fuel-stat-value">$${Number(summary.current_month_price || 0).toFixed(3)}</span>
            <span class="fuel-stat-sub">${escapeHtml(priceSub)}</span>
        </div>
    `;
}

/**
 * Renders fuel logs into the ledger table.
 *
 * @returns {void}
 */
function renderLogs() {
    const tbody = document.getElementById('fuelTableBody');
    if (!tbody) return;

    if (STATE.logs.length === 0) {
        tbody.innerHTML = '<tr class="fuel-empty-row"><td colspan="8" class="fuel-empty-ledger">📭 No fuel logs yet.</td></tr>';
        return;
    }

    tbody.innerHTML = STATE.logs.map(log => {
        const station = log.station_name || 'Unknown station';
        const vehicle = vehicleLabel(log);
        const status = log.ai_status || 'pending';
        const canEdit = (log.uploaded_by === STATE.currentUser || STATE.isAdmin);
        const discount = Number(log.discount_per_litre || 0);
        const discountText = discount > 0 ? ` (-${discount.toFixed(discount % 1 === 0 ? 0 : 1)}c/L)` : '';
        const imageHtml = hasFuelPhotos(log)
            ? `
                <div class="fuel-image-pair">
                    <img src="/fuel/serve/${log.id}/1" class="fuel-thumb" alt="" onclick="openImageModal(${log.id}, 1)">
                    <img src="/fuel/serve/${log.id}/2" class="fuel-thumb" alt="" onclick="openImageModal(${log.id}, 2)">
                </div>
            `
            : '<span class="fuel-no-photos">No photos</span>';
        return `
            <tr id="fuel-row-${log.id}">
                <td data-label="Images">${imageHtml}</td>
                <td data-label="Vehicle">
                    <strong>${escapeHtml(vehicle)}</strong>
                    <br><span class="fuel-muted">${escapeHtml(station)}</span>
                </td>
                <td data-label="Date">${escapeHtml(log.formatted_date || '-')}</td>
                <td data-label="Odometer">${log.odometer ? `${Number(log.odometer).toLocaleString()} km` : '-'}</td>
                <td data-label="Fuel">
                    <span class="fuel-amount">$${formatMoney(log.total_amount)}</span>
                    <br><span class="fuel-muted">${formatOptional(log.litres, ' L')} @ $${Number(log.price_per_litre || 0).toFixed(3)}${discountText}</span>
                </td>
                <td data-label="Economy">
                    ${log.litres_per_100km ? `${Number(log.litres_per_100km).toFixed(2)} L/100km` : '-'}
                    <br><span class="fuel-muted">${log.distance_km ? `${Number(log.distance_km).toLocaleString()} km` : 'insufficient data'}</span>
                </td>
                <td data-label="Status">
                    <span class="fuel-status ${escapeHtml(status)}">${statusLabel(status)}</span>
                </td>
                <td class="col-actions" data-label="Actions">
                    <div class="action-buttons">
                        ${canEdit ? `
                            <button type="button" class="btn-icon-edit" onclick="openEditModal(${log.id})" title="Edit">✏️</button>
                            <button type="button" class="btn-icon-delete" onclick="confirmDeleteFuel(${Number(log.id)}, ${escapeHtml(JSON.stringify(vehicle || ''))})" title="Delete">🗑️</button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Keeps vehicle and station inputs synchronized with state.
 *
 * @returns {void}
 */
function updateDropdowns() {
    syncVehicleSelect(document.getElementById('filterVehicle'), true);
    syncVehicleSelect(document.getElementById('uploadVehicle'), false);
    syncVehicleSelect(document.getElementById('editVehicle'), false, STATE.vehicles);

    const uploader = document.getElementById('filterUploader');
    if (uploader) {
        const selected = uploader.value;
        uploader.innerHTML = '<option value="">All Uploaders</option>' + STATE.uploaders.map(user => {
            const username = user.username || '';
            return `<option value="${escapeHtml(username)}" ${username === selected ? 'selected' : ''}>${escapeHtml(username)}</option>`;
        }).join('');
    }

    const stations = document.getElementById('station_list');
    if (stations) {
        stations.innerHTML = STATE.stations.map(name => `<option value="${escapeHtml(name)}">`).join('');
    }
}

/**
 * Synchronizes one vehicle select element.
 *
 * @param {HTMLSelectElement|null} select - Select element to update.
 * @param {boolean} includeAll - Whether to include an all-vehicles option.
 * @param {Array|null} sourceOverride - Optional vehicle collection.
 * @returns {void}
 */
function syncVehicleSelect(select, includeAll, sourceOverride = null) {
    if (!select) return;
    const selected = select.value;
    const source = sourceOverride || (includeAll ? STATE.vehicles : STATE.activeVehicles);
    const first = includeAll ? '<option value="">All Vehicles</option>' : '<option value="">Select Vehicle</option>';
    select.innerHTML = first + source.map(vehicle => {
        const label = vehicleLabel(vehicle);
        return `<option value="${vehicle.id}" ${String(vehicle.id) === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
}

/**
 * Configures dual drag-and-drop upload controls.
 *
 * @returns {void}
 */
function setupUploadInputs() {
    setupDropZone('dropZone1', 'image1', 'fileName1');
    setupDropZone('dropZone2', 'image2', 'fileName2');
}

/**
 * Wires the upload modal mode switch.
 *
 * @returns {void}
 */
function setupUploadMode() {
    const mode = document.getElementById('uploadMode');
    if (!mode) return;
    mode.addEventListener('change', () => setUploadMode(mode.value));
    setUploadMode(mode.value || 'photos');
}

/**
 * Toggles the upload modal between photo scanning and manual entry.
 *
 * @param {string} mode - Selected upload mode.
 * @returns {void}
 */
function setUploadMode(mode) {
    const manual = mode === 'manual';
    const photoFields = document.getElementById('photoEntryFields');
    const manualFields = document.getElementById('manualEntryFields');
    const submit = document.getElementById('uploadSubmitBtn');
    const date = document.getElementById('uploadDate');
    const image1 = document.getElementById('image1');
    const image2 = document.getElementById('image2');

    if (photoFields) photoFields.classList.toggle('hidden', manual);
    if (manualFields) manualFields.classList.toggle('hidden', !manual);
    if (submit) submit.innerHTML = manual ? 'Save' : 'Upload & Scan';
    if (date) date.required = manual;

    [image1, image2].forEach(input => {
        if (!input) return;
        input.required = !manual;
        input.disabled = manual;
    });

    MANUAL_UPLOAD_FIELDS.forEach(id => {
        const input = document.getElementById(id);
        if (!input) return;
        input.required = manual;
        input.disabled = !manual;
    });
}

/**
 * Wires one file drop zone to its file input.
 *
 * @param {string} zoneId - Drop zone element id.
 * @param {string} inputId - File input id.
 * @param {string} labelId - Filename label id.
 * @returns {void}
 */
function setupDropZone(zoneId, inputId, labelId) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    if (!zone || !input) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(name => {
        zone.addEventListener(name, event => {
            event.preventDefault();
            event.stopPropagation();
        });
    });

    zone.addEventListener('dragover', () => zone.classList.add('dragover'));
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', event => {
        zone.classList.remove('dragover');
        if (!event.dataTransfer.files.length) return;
        input.files = event.dataTransfer.files;
        input.dispatchEvent(new Event('change'));
    });

    input.addEventListener('change', () => {
        renderFuelUploadPreview(inputId);
    });
}

/**
 * Opens a fuel photo picker for one fixed upload slot.
 *
 * @param {string} inputId - File input id.
 * @returns {void}
 */
function openFuelFileInput(inputId) {
    const input = document.getElementById(inputId);
    if (input) input.click();
}

/**
 * Renders a thumbnail preview for one selected fuel photo.
 *
 * @param {string} inputId - File input id.
 * @returns {Promise<void>}
 */
async function renderFuelUploadPreview(inputId) {
    const input = document.getElementById(inputId);
    const slot = document.getElementById(inputId === 'image1' ? 'previewSlot1' : 'previewSlot2');
    if (!input || !slot) return;

    if (UPLOAD_PREVIEW_URLS[inputId]) {
        URL.revokeObjectURL(UPLOAD_PREVIEW_URLS[inputId]);
        UPLOAD_PREVIEW_URLS[inputId] = null;
    }

    if (!input.files || input.files.length === 0) {
        STATE.uploadTokens[inputId] += 1;
        slot.innerHTML = emptyFuelPreviewHtml(inputId);
        STATE.refinedBlobs[inputId] = null;
        STATE.uploadErrors[inputId] = null;
        STATE.uploadProcessing[inputId] = false;
        return;
    }

    const file = input.files[0];
    const token = STATE.uploadTokens[inputId] + 1;
    STATE.uploadTokens[inputId] = token;
    STATE.refinedBlobs[inputId] = null;
    STATE.uploadErrors[inputId] = null;
    STATE.uploadProcessing[inputId] = true;
    slot.innerHTML = `
        <div class="empty-preview-hint">
            <span>Processing photo...</span>
        </div>
    `;

    let displayFile;
    try {
        displayFile = await prepareFuelUploadImage(file);
        if (STATE.uploadTokens[inputId] !== token) return;
        STATE.refinedBlobs[inputId] = displayFile;
    } catch (err) {
        if (STATE.uploadTokens[inputId] !== token) return;
        console.error("Fuel image preparation failed", err);
        STATE.uploadErrors[inputId] = 'Could not process this photo. Please retry or use manual entry.';
        slot.innerHTML = emptyFuelPreviewHtml(inputId);
        if (typeof showToast === 'function') showToast(STATE.uploadErrors[inputId], 'error');
        return;
    } finally {
        if (STATE.uploadTokens[inputId] === token) STATE.uploadProcessing[inputId] = false;
    }

    const url = URL.createObjectURL(displayFile);
    UPLOAD_PREVIEW_URLS[inputId] = url;
    const label = inputId === 'image1' ? 'Photo One' : 'Photo Two';

    slot.innerHTML = `
        <div class="fuel-upload-preview-card">
            <img src="${url}" class="fuel-upload-thumb" alt="${escapeHtml(file.name)}">
            <button type="button" class="preview-remove" onclick="event.stopPropagation(); removeFuelUploadPhoto('${inputId}')" title="Remove photo">×</button>
            <div class="fuel-upload-caption">
                <strong>${label}</strong>
                <span>${escapeHtml(file.name)}</span>
            </div>
        </div>
    `;
}

/**
 * Converts any supported fuel photo into a bounded JPEG upload blob.
 *
 * @param {File|Blob} file - Selected upload image.
 * @returns {Promise<Blob>} JPEG blob ready for storage and AI analysis.
 */
async function prepareFuelUploadImage(file) {
    let source = file;
    const low = (file.name || '').toLowerCase();
    if (low.endsWith('.heic') || low.endsWith('.heif')) {
        if (typeof showToast === 'function') showToast('Processing modern image format...', 'info');
        const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: CONFIG.FUEL_UPLOAD_JPEG_QUALITY });
        source = Array.isArray(converted) ? converted[0] : converted;
    }

    const image = await loadFuelImage(source);
    const scale = Math.min(1, CONFIG.FUEL_UPLOAD_MAX_EDGE / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not available');
    ctx.drawImage(image, 0, 0, width, height);

    return await new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error('JPEG export failed'));
        }, 'image/jpeg', CONFIG.FUEL_UPLOAD_JPEG_QUALITY);
    });
}

/**
 * Loads an upload blob into an image element for canvas resizing.
 *
 * @param {Blob} blob - Image blob to decode.
 * @returns {Promise<HTMLImageElement>} Loaded image element.
 */
function loadFuelImage(blob) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(blob);
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Image decode failed'));
        };
        img.src = url;
    });
}

/**
 * Removes one selected fuel photo and restores the chooser state.
 *
 * @param {string} inputId - File input id.
 * @returns {void}
 */
function removeFuelUploadPhoto(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.value = '';
    renderFuelUploadPreview(inputId);
}

/**
 * Generates the empty upload slot markup.
 *
 * @param {string} inputId - File input id.
 * @returns {string} Empty preview HTML.
 */
function emptyFuelPreviewHtml(inputId) {
    const label = inputId === 'image1' ? 'Photo One' : 'Photo Two';
    return `
        <div class="empty-preview-hint">
            <span>📷</span>
            <strong>${label}</strong>
            <button type="button" class="fuel-photo-btn" onclick="event.stopPropagation(); openFuelFileInput('${inputId}')">Choose Photo</button>
        </div>
    `;
}

/**
 * Opens the fuel upload modal.
 *
 * @returns {void}
 */
function openUploadModal() {
    const modal = document.getElementById('uploadModal');
    const form = document.getElementById('uploadForm');
    if (form) {
        form.reset();
        removeFuelUploadPhoto('image1');
        removeFuelUploadPhoto('image2');
        setUploadMode('photos');
        const date = document.getElementById('uploadDate');
        if (date && typeof getLocalISOString === 'function') date.value = getLocalISOString().slice(0, 10);
        setValue('uploadDiscount', 0);
    }
    if (modal) modal.classList.add('show');
    document.body.classList.add('modal-open');
}

/**
 * Closes the fuel upload modal.
 *
 * @returns {void}
 */
function closeUploadModal() {
    const modal = document.getElementById('uploadModal');
    const form = document.getElementById('uploadForm');
    if (modal) modal.classList.remove('show');
    if (form) form.reset();
    removeFuelUploadPhoto('image1');
    removeFuelUploadPhoto('image2');
    document.body.classList.remove('modal-open');
}

/**
 * Uploads both images and opens review when needed.
 *
 * @async
 * @param {Event} event - Form submission event.
 * @returns {Promise<void>}
 */
async function handleUpload(event) {
    if (event) event.preventDefault();
    const form = document.getElementById('uploadForm');
    const btn = document.getElementById('uploadSubmitBtn');
    if (!form || !btn) return;

    const mode = document.getElementById('uploadMode')?.value === 'manual' ? 'manual' : 'photos';
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = mode === 'manual' ? 'Saving...' : 'Scanning...';
    if (typeof showLoadingOverlay === 'function') {
        const detail = mode === 'manual' ? 'Saving manual fuel log.' : 'Uploading images and extracting values.';
        showLoadingOverlay('Processing fuel log...', detail);
    }

    try {
        const endpoint = mode === 'manual' ? '/fuel/api/manual' : '/fuel/api/upload';
        const formData = new FormData(form);

        if (mode === 'photos') {
            if (STATE.uploadProcessing.image1 || STATE.uploadProcessing.image2) {
                throw new Error('Still processing photos. Please try again in a moment.');
            }
            const error = STATE.uploadErrors.image1 || STATE.uploadErrors.image2;
            if (error) throw new Error(error);
            if (!STATE.refinedBlobs.image1 || !STATE.refinedBlobs.image2) {
                throw new Error('Please choose two valid photos before uploading.');
            }
            formData.delete('image1');
            formData.append('image1', STATE.refinedBlobs.image1, 'image1.jpg');
            formData.delete('image2');
            formData.append('image2', STATE.refinedBlobs.image2, 'image2.jpg');
        }

        const result = await apiPost(endpoint, formData, mode === 'manual' ? undefined : 90000);
        if (result && result.success) {
            closeUploadModal();
            await loadState(true);
            if (mode === 'photos' && result.log && result.log.id) openEditModal(result.log.id);
        }
    } catch (err) {
        if (typeof showToast === 'function') showToast(err.message || 'Fuel upload failed', 'error');
    } finally {
        if (typeof hideLoadingOverlay === 'function') hideLoadingOverlay();
        btn.disabled = false;
        btn.innerHTML = original;
    }
}

/**
 * Opens the review editor for a fuel log.
 *
 * @param {number} id - Fuel log identifier.
 * @returns {void}
 */
function openEditModal(id) {
    const log = STATE.logs.find(item => Number(item.id) === Number(id));
    const modal = document.getElementById('editModal');
    const form = document.getElementById('editForm');
    if (!log || !modal || !form) return;

    form.dataset.logId = log.id;
    const editImage1 = document.getElementById('editImage1');
    const editImage2 = document.getElementById('editImage2');
    const noPhotos = document.getElementById('editNoPhotos');
    const hasPhotos = hasFuelPhotos(log);
    if (editImage1) {
        editImage1.src = hasPhotos ? `/fuel/serve/${log.id}/1` : '';
        editImage1.classList.toggle('hidden', !hasPhotos);
    }
    if (editImage2) {
        editImage2.src = hasPhotos ? `/fuel/serve/${log.id}/2` : '';
        editImage2.classList.toggle('hidden', !hasPhotos);
    }
    if (noPhotos) noPhotos.classList.toggle('hidden', hasPhotos);
    setValue('editVehicle', log.vehicle_id || '');
    setValue('editDate', log.log_date || '');
    setValue('editFillType', log.fill_type || 'full');
    setValue('editOdometer', log.odometer || '');
    setValue('editLitres', log.litres || '');
    setValue('editDiscount', log.discount_per_litre || 0);
    setValue('editTotal', log.total_amount || '');
    setValue('editStation', log.station_name || '');
    setValue('editDescription', log.description || '');

    const editLitres = document.getElementById('editLitres');
    const editTotal = document.getElementById('editTotal');
    const editPrice = document.getElementById('editPrice');
    /**
     * Calculates price per litre from litres and total fields.
     * @returns {void}
     */
    function recalcPrice() {
        const l = parseFloat(editLitres?.value) || 0;
        const t = parseFloat(editTotal?.value) || 0;
        if (editPrice) {
            editPrice.value = l > 0 ? (t / l).toFixed(3) : '';
        }
    }
    if (editLitres) editLitres.oninput = recalcPrice;
    if (editTotal) editTotal.oninput = recalcPrice;
    recalcPrice();

    renderReviewReasons(log);

    const scan = document.getElementById('btnScanAI');
    if (scan) {
        scan.disabled = !hasPhotos;
        scan.innerHTML = hasPhotos ? '🔍 Rescan' : 'No Photos To Scan';
        scan.onclick = () => runFuelScan(log.id, true);
    }

    modal.classList.add('show');
    document.body.classList.add('modal-open');
}

/**
 * Closes the fuel review modal.
 *
 * @returns {void}
 */
function closeEditModal() {
    const modal = document.getElementById('editModal');
    const editImage1 = document.getElementById('editImage1');
    const editImage2 = document.getElementById('editImage2');
    if (modal) modal.classList.remove('show');
    if (editImage1) editImage1.src = '';
    if (editImage2) editImage2.src = '';
    document.body.classList.remove('modal-open');
}

/**
 * Saves reviewed fuel log metadata.
 *
 * @async
 * @param {Event} event - Form submission event.
 * @returns {Promise<void>}
 */
async function handleEditSubmit(event) {
    if (event) event.preventDefault();
    const form = document.getElementById('editForm');
    if (!form || !form.dataset.logId) return;

    const btn = form.querySelector('button[type="submit"]');
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⌛ Saving...';

    try {
        const result = await apiPost(`/fuel/api/update/${form.dataset.logId}`, new FormData(form));
        if (result && result.success) {
            closeEditModal();
            await loadState(true);
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = original;
    }
}

/**
 * Runs AI extraction for an existing log.
 *
 * @async
 * @param {number} id - Fuel log identifier.
 * @param {boolean} reopen - Whether to reopen the editor after refresh.
 * @returns {Promise<void>}
 */
async function runFuelScan(id, reopen = false) {
    const log = STATE.logs.find(item => Number(item.id) === Number(id));
    if (log && !hasFuelPhotos(log)) return;

    const btn = document.getElementById('btnScanAI');
    const original = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⌛ Scanning...';
    }

    try {
        const result = await apiPost(`/fuel/api/ai_analyze/${id}`, {}, 90000);
        if (result && result.success) {
            await loadState(true);
            if (reopen) openEditModal(id);
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = original || '🔍 Rescan';
        }
    }
}

/**
 * Confirms deletion of a fuel log.
 *
 * @param {number} id - Fuel log identifier.
 * @param {string} label - Vehicle display label.
 * @returns {void}
 */
function confirmDeleteFuel(id, label) {
    showConfirmModal({
        title: 'Delete Fuel Log',
        message: `Permanently remove fuel log for <strong>${escapeHtml(label)}</strong>?`,
        danger: true,
        confirmText: 'Delete',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const result = await apiPost(`/fuel/api/delete/${id}`);
            if (result && result.success) {
                STATE.logs = STATE.logs.filter(log => Number(log.id) !== Number(id));
                renderLogs();
                await loadState(true);
            }
        }
    });
}

/**
 * Opens the full-size image viewer.
 *
 * @param {number} id - Fuel log identifier.
 * @param {number} image - Image slot number.
 * @returns {Promise<void>}
 */
async function openImageModal(id, image) {
    const log = STATE.logs.find(item => Number(item.id) === Number(id));
    if (log && !hasFuelPhotos(log)) return;

    const modal = document.getElementById('imageModal');
    const img = document.getElementById('modalImg');
    if (!modal || !img) return;

    modal.classList.add('show');
    document.body.classList.add('modal-open');
    img.src = ''; // Clear previous

    try {
        const response = await fetch(`/fuel/serve/${id}/${image}`);
        const blob = await response.blob();
        let displayBlob = blob;

        if (blob.type === 'image/heic' || blob.type === 'image/heif') {
            if (typeof heic2any === 'function') {
                const conv = await heic2any({ blob: blob, toType: 'image/jpeg', quality: 0.8 });
                displayBlob = Array.isArray(conv) ? conv[0] : conv;
            }
        }

        if (MODAL_IMAGE_URL) URL.revokeObjectURL(MODAL_IMAGE_URL);
        MODAL_IMAGE_URL = URL.createObjectURL(displayBlob);
        img.src = MODAL_IMAGE_URL;
    } catch (err) {
        console.error("Failed to load/convert image", err);
        img.src = `/fuel/serve/${id}/${image}`; // Fallback to raw
    }
}

/**
 * Closes the full-size image viewer.
 *
 * @returns {void}
 */
function closeImageModal() {
    const modal = document.getElementById('imageModal');
    const img = document.getElementById('modalImg');
    if (modal) modal.classList.remove('show');
    document.body.classList.remove('modal-open');
    if (img) img.src = '';
    if (MODAL_IMAGE_URL) {
        URL.revokeObjectURL(MODAL_IMAGE_URL);
        MODAL_IMAGE_URL = null;
    }
}

/**
 * Opens the vehicle management modal.
 *
 * @returns {void}
 */
function openVehicleModal() {
    resetVehicleForm();
    renderVehicleList();
    const modal = document.getElementById('vehicleModal');
    if (modal) modal.classList.add('show');
    document.body.classList.add('modal-open');
}

/**
 * Closes the vehicle management modal.
 *
 * @returns {void}
 */
function closeVehicleModal() {
    const modal = document.getElementById('vehicleModal');
    if (modal) modal.classList.remove('show');
    document.body.classList.remove('modal-open');
}

/**
 * Saves a vehicle profile.
 *
 * @async
 * @param {Event} event - Form submission event.
 * @returns {Promise<void>}
 */
async function handleVehicleSubmit(event) {
    if (event) event.preventDefault();
    const form = document.getElementById('vehicleForm');
    const id = document.getElementById('vehicleId')?.value || '';
    const btn = document.getElementById('vehicleSaveBtn');
    if (!form || !btn) return;

    const formData = new FormData(form);
    formData.set('is_active', document.getElementById('vehicleActive').checked ? 1 : 0);

    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⌛ Saving...';

    try {
        const url = id ? `/fuel/api/vehicles/update/${id}` : '/fuel/api/vehicles/add';
        const result = await apiPost(url, formData);
        if (result && result.success) {
            resetVehicleForm();
            await loadState(true);
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = original;
    }
}

/**
 * Renders vehicle management rows.
 *
 * @returns {void}
 */
function renderVehicleList() {
    const list = document.getElementById('vehicleList');
    if (!list) return;

    if (STATE.vehicles.length === 0) {
        list.innerHTML = '<div class="fuel-empty-ledger">No vehicles configured.</div>';
        return;
    }

    list.innerHTML = STATE.vehicles.map(vehicle => `
        <div class="vehicle-row">
            <div>
                <div class="vehicle-title">${escapeHtml(vehicle.name || '')}</div>
                <div class="vehicle-detail">${escapeHtml(vehicleDetail(vehicle))}</div>
                <div class="fuel-muted">${vehicle.is_active == 1 ? 'Active' : 'Archived'}</div>
            </div>
            <div class="action-buttons">
                <button type="button" class="btn-icon-edit" onclick="editVehicle(${vehicle.id})" title="Edit">✏️</button>
                ${vehicle.is_active == 1 ? `<button type="button" class="btn-icon-delete" onclick="archiveVehicle(${Number(vehicle.id)}, ${escapeHtml(JSON.stringify(vehicle.name || ''))})" title="Archive">🗑️</button>` : ''}
            </div>
        </div>
    `).join('');
}

/**
 * Fills the vehicle form for editing.
 *
 * @param {number} id - Vehicle identifier.
 * @returns {void}
 */
function editVehicle(id) {
    const vehicle = STATE.vehicles.find(item => Number(item.id) === Number(id));
    if (!vehicle) return;
    setValue('vehicleId', vehicle.id || '');
    setValue('vehicleName', vehicle.name || '');
    setValue('vehicleMake', vehicle.make || '');
    setValue('vehicleModel', vehicle.model || '');
    setValue('vehicleYear', vehicle.year || '');
    const active = document.getElementById('vehicleActive');
    if (active) active.checked = vehicle.is_active == 1;
}

/**
 * Archives a vehicle profile.
 *
 * @param {number} id - Vehicle identifier.
 * @param {string} name - Vehicle display name.
 * @returns {void}
 */
function archiveVehicle(id, name) {
    showConfirmModal({
        title: 'Archive Vehicle',
        message: `Archive <strong>${escapeHtml(name)}</strong>? Historical logs will remain visible.`,
        danger: true,
        confirmText: 'Archive',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const result = await apiPost(`/fuel/api/vehicles/delete/${id}`);
            if (result && result.success) await loadState(true);
        }
    });
}

/**
 * Clears the vehicle form for a new entry.
 *
 * @returns {void}
 */
function resetVehicleForm() {
    const form = document.getElementById('vehicleForm');
    if (form) form.reset();
    setValue('vehicleId', '');
    const active = document.getElementById('vehicleActive');
    if (active) active.checked = true;
}

/**
 * Renders review reasons for the selected log.
 *
 * @param {Object} log - Fuel log state object.
 * @returns {void}
 */
function renderReviewReasons(log) {
    const box = document.getElementById('reviewReasons');
    if (!box) return;

    const reasons = parseJsonArray(log.review_reasons);
    if (!log.needs_review || reasons.length === 0) {
        box.classList.add('hidden');
        box.innerHTML = '';
        return;
    }

    box.innerHTML = `<strong>Needs review:</strong> ${reasons.map(escapeHtml).join(', ')}`;
    box.classList.remove('hidden');
}

/**
 * Converts a JSON array string into an array.
 *
 * @param {string|null} value - JSON string from the server.
 * @returns {Array} Parsed string values.
 */
function parseJsonArray(value) {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
    } catch (err) {
        return [];
    }
}

/**
 * Assigns a value to an input if it exists.
 *
 * @param {string} id - Element id.
 * @param {string|number} value - Value to assign.
 * @returns {void}
 */
function setValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
}

/**
 * Formats vehicle details into a compact label.
 *
 * @param {Object} vehicle - Vehicle data.
 * @returns {string} Vehicle metadata label.
 */
function vehicleDetail(vehicle) {
    return [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'No vehicle details';
}

/**
 * Formats a vehicle or log record into a display label.
 *
 * @param {Object} item - Vehicle or fuel log data.
 * @returns {string} Vehicle label.
 */
function vehicleLabel(item) {
    if (!item) return 'Unknown vehicle';
    const name = item.vehicle_name || item.name || 'Vehicle';
    const detail = [item.year, item.make, item.model].filter(Boolean).join(' ');
    return detail ? `${name} (${detail})` : name;
}

/**
 * Checks whether a fuel log has both stored source photos.
 *
 * @param {Object} log - Fuel log state object.
 * @returns {boolean} Whether image thumbnails can be rendered.
 */
function hasFuelPhotos(log) {
    return !!(log && log.image1_file_size && log.image2_file_size);
}

/**
 * Formats a status identifier for display.
 *
 * @param {string} status - Status identifier.
 * @returns {string} Display label.
 */
function statusLabel(status) {
    const labels = {
        complete: 'Complete',
        needs_review: 'Needs Review',
        pending: 'Pending',
        failed: 'Failed'
    };
    return labels[status] || 'Pending';
}

/**
 * Formats a nullable number with an optional suffix.
 *
 * @param {string|number|null} value - Numeric value.
 * @param {string} suffix - Suffix to append.
 * @returns {string} Formatted value or fallback.
 */
function formatOptional(value, suffix) {
    if (value === null || value === undefined || value === '') return '-';
    return `${Number(value).toFixed(suffix.includes('$/km') ? 3 : 2)}${suffix}`;
}

/**
 * Formats a nullable currency value.
 *
 * @param {string|number|null} value - Numeric value.
 * @returns {string} Two-decimal value.
 */
function formatMoney(value) {
    return Number(value || 0).toFixed(2);
}

/**
 * --- Global Exposure ---
 */
window.loadState = loadState;
window.openUploadModal = openUploadModal;
window.closeUploadModal = closeUploadModal;
window.handleUpload = handleUpload;
window.setUploadMode = setUploadMode;
window.openFuelFileInput = openFuelFileInput;
window.removeFuelUploadPhoto = removeFuelUploadPhoto;
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
window.handleEditSubmit = handleEditSubmit;
window.runFuelScan = runFuelScan;
window.confirmDeleteFuel = confirmDeleteFuel;
window.openImageModal = openImageModal;
window.closeImageModal = closeImageModal;
window.openVehicleModal = openVehicleModal;
window.closeVehicleModal = closeVehicleModal;
window.handleVehicleSubmit = handleVehicleSubmit;
window.editVehicle = editVehicle;
window.archiveVehicle = archiveVehicle;
