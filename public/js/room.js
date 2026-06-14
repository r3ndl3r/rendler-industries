// /public/js/room.js

/**
 * Room Cleaning Tracker Controller
 * 
 * Manages daily room photo submissions, admin reviews, and configuration.
 * Uses a state-driven architecture with internal binary storage.
 */

let STATE = {
    is_admin: false,
    is_child: false,
    today_status: [],
    is_blackout: false,
    pending_submissions: [],
    room_configs: [],
    blackout_dates: [],
    all_users: []
};

// Persistent queue for prepared multi-photo uploads
let UPLOAD_QUEUE = [];
let UPLOAD_TOKEN = 0;
let roomStateRequestSeq = 0;
let hasLoadedRoomState = false;

/**
 * Normalizes a room submission status to a known safe value.
 * 
 * @param {*} status - Raw status value from the server.
 * @returns {string} One of 'pending', 'passed', or 'failed'.
 */
function normalizeRoomStatus(status) {
    const value = String(status || '').toLowerCase();
    return ['pending', 'passed', 'failed'].includes(value) ? value : 'pending';
}

/**
 * Ensures a value is an array, falling back to an empty array.
 * 
 * @param {*} value - The value to check.
 * @returns {Array} The original array or an empty array.
 */
function asArray(value) {
    return Array.isArray(value) ? value : [];
}

/**
 * Normalizes raw API state with safe defaults for collection fields.
 * 
 * @param {Object} data - Raw state object from /room/api/state.
 * @returns {Object} State object with normalized collections.
 */
function normalizeRoomState(data) {
    return {
        ...data,
        today_status: asArray(data.today_status),
        pending_submissions: asArray(data.pending_submissions),
        room_configs: asArray(data.room_configs),
        blackout_dates: asArray(data.blackout_dates),
        all_users: asArray(data.all_users),
        daily_summary: asArray(data.daily_summary),
        storage_stats: data.storage_stats && typeof data.storage_stats === 'object' ? data.storage_stats : null
    };
}

/**
 * Checks whether any room modal is currently visible.
 * 
 * @returns {boolean} True if at least one room modal has the .show class.
 */
function hasOpenRoomModal() {
    return !!document.querySelector([
        '#uploadModal.show',
        '#photoModal.show',
        '#userSettingsModal.show',
        '#globalConfirmActionModal.show'
    ].join(', '));
}

const CONFIG = {
    SYNC_INTERVAL_MS: 30000,
    ROOM_UPLOAD_JPEG_QUALITY: 0.82,
    ROOM_UPLOAD_TIMEOUT_MS: 90000
};

document.addEventListener('DOMContentLoaded', () => {
    loadState();
    setInterval(loadState, CONFIG.SYNC_INTERVAL_MS);
    setupUploadInput();

    // Global modal closure integration
    setupGlobalModalClosing(['modal-overlay'], [closeUploadModal, closePhotoModal, closeSettingsModal]);

    if (sessionStorage.getItem('room_camera_pending')) {
        sessionStorage.removeItem('room_camera_pending');
        showToast('It looks like the app restarted while the camera was open. Please try uploading again.', 'error');
    }
});

/**
 * Synchronizes the module state with the server via the consolidated state endpoint.
 * Inhibit background sync if a modal is active or user is typing.
 * 
 * @param {boolean} [force=false] - Bypass inhibition checks.
 * @returns {Promise<void>}
 */
async function loadState(force = false) {
    const anyModalOpen = document.querySelector('.modal-overlay.show');
    const inputFocused = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');

    if (!force && hasLoadedRoomState && (anyModalOpen || inputFocused)) return;

    try {
        const requestSeq = ++roomStateRequestSeq;
        const data = await apiGet('/room/api/state');
        if (requestSeq !== roomStateRequestSeq) return;

        if (data && data.success) {
            STATE = { ...STATE, ...normalizeRoomState(data) };
            hasLoadedRoomState = true;
            renderUI();
        }
    } catch (err) {
        console.error("loadState failure:", err);
    }
}

/**
 * Orchestrates UI rendering based on role.
 * 
 * @returns {void}
 */
function renderUI() {
    const teenView = document.getElementById('teenView');
    const adminView = document.getElementById('adminView');
    const noAccessView = document.getElementById('noAccessView');
    
    if (STATE.is_admin) {
        if (adminView) adminView.classList.remove('hidden');
        if (teenView) teenView.classList.add('hidden');
        if (noAccessView) noAccessView.classList.add('hidden');
        renderAdminTabs();
    } else if (STATE.is_child && STATE.is_tracked) {
        if (teenView) teenView.classList.remove('hidden');
        if (adminView) adminView.classList.add('hidden');
        if (noAccessView) noAccessView.classList.add('hidden');
        renderTeenStatus();
    } else {
        if (teenView) teenView.classList.add('hidden');
        if (adminView) adminView.classList.add('hidden');
        if (noAccessView) noAccessView.classList.remove('hidden');
    }
}

/**
 * --- Teen View Logic ---
 */

/**
 * Renders the daily submission status card and gallery for teens.
 * 
 * @returns {void}
 */
function renderTeenStatus() {
    const card = document.getElementById('todayStatusCard');
    if (!card) return;

    const icon = card.querySelector('.status-icon');
    const title = document.getElementById('statusTitle');
    const desc = document.getElementById('statusDesc');
    const gallery = document.getElementById('todayGallery');
    const container = document.getElementById('todayGalleryContainer');
    if (icon) icon.style.color = '';

    if (STATE.is_blackout) {
        icon.innerHTML = '📅';
        title.innerText = "Enjoy Your Day!";
        desc.innerText = "Today is a blackout day. No room check required.";
        card.querySelector('.status-action').classList.add('hidden');
        if (container) container.classList.add('hidden');
        return;
    }

    card.querySelector('.status-action').classList.remove('hidden');

    const submissions = STATE.today_status;
    if (submissions.length === 0) {
        icon.innerHTML = '⌛';
        title.innerText = "Ready for Review?";
        desc.innerText = "You haven't uploaded your room photos for today yet.";
        if (container) container.classList.add('hidden');
        if (gallery) gallery.innerHTML = '';
    } else {
        const failed = submissions.filter(s => normalizeRoomStatus(s.status) === 'failed');
        const pending = submissions.filter(s => normalizeRoomStatus(s.status) === 'pending');
        
        if (failed.length > 0) {
            icon.innerHTML = '❌';
            icon.style.color = "#ef4444";
            title.innerText = "Revision Needed";
            desc.innerText = `Admin has requested changes on ${failed.length} photo(s).`;
        } else if (pending.length > 0) {
            icon.innerHTML = '⌛';
            title.innerText = "Pending Review";
            desc.innerText = "Photos uploaded! Waiting for a parent to check.";
        } else {
            icon.innerHTML = '✅';
            icon.style.color = "#10b981";
            title.innerText = "Room Approved!";
            desc.innerText = "Great job! Your room is officially clean for today.";
        }

        if (container) container.classList.remove('hidden');
        if (gallery) {
            gallery.innerHTML = submissions.map(s => {
                const status = normalizeRoomStatus(s.status);
                return `
                <div class="submission-item">
                    <div class="photo-container" onclick="openPhotoModal(${s.id})">
                        <img src="/room/serve/${s.id}" class="submission-thumb">
                        <span class="status-badge status-${status}">${status.toUpperCase()}</span>
                    </div>
                    ${status === 'failed' && s.admin_comment ? `
                        <div class="photo-feedback">
                            <strong>Feedback:</strong>
                            ${escapeHtml(s.admin_comment)}
                        </div>
                    ` : ''}
                </div>
                `;
            }).join('');
        }
    }
}

/**
 * --- Admin View Logic ---
 */

/**
 * Entry point for rendering all administrative tab contents.
 * 
 * @returns {void}
 */
function renderAdminTabs() {
    renderDailySummary();
    renderReviewQueue();
    renderSettings();
    renderStorageStats();
    renderBlackouts();
}

/**
 * Renders the storage management card with data size and trim options.
 * 
 * @returns {void}
 */
function renderStorageStats() {
    const container = document.getElementById('storageSummary');
    if (!container || !STATE.storage_stats) return;

    const stats = STATE.storage_stats;
    const totalSize = formatBytes(stats.total_size);
    const oldSize = formatBytes(stats.old_size);

    container.innerHTML = `
        <div class="storage-info">
            <div class="storage-main">
                📂 <strong>Storage Usage:</strong> ${totalSize} (${stats.total_count} photos)
            </div>
            <div class="storage-detail">
                🗑️ ${stats.old_count} photos older than 30 days can be trimmed to free <strong>${oldSize}</strong>.
            </div>
        </div>
        <div class="storage-action">
            <button class="btn-primary btn-small ${stats.old_count === 0 ? 'disabled' : ''}" 
                    onclick="${stats.old_count > 0 ? 'confirmTrimData()' : ''}"
                    ${stats.old_count === 0 ? 'disabled' : ''}>
                🗑️ Trim Old Data
            </button>
        </div>
    `;
}

/**
 * Formats bytes into human-readable strings (MB, GB, etc).
 * 
 * @param {number} bytes - Raw byte count.
 * @returns {string} - Formatted string.
 */
function formatBytes(bytes) {
    const b = parseInt(bytes);
    if (isNaN(b) || b <= 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Triggers confirmation before deleting old data.
 * 
 * @returns {void}
 */
function confirmTrimData() {
    showConfirmModal({
        title: 'Trim Room Data',
        message: 'Are you sure you want to delete all photos older than 30 days? This action cannot be undone.',
        confirmText: 'Trim Now',
        onConfirm: async () => {
            const result = await apiPost('/room/api/trim');
            if (result && result.success) {
                showToast(`Trim complete! Deleted ${result.deleted} records.`, "success");
                loadState(true);
            }
        }
    });
}

/**
 * Renders a bird's-eye view of today's progress for all tracked users.
 * 
 * @returns {void}
 */
function renderDailySummary() {
    const container = document.getElementById('dailyProgressSummary');
    if (!container || !STATE.daily_summary) return;

    if (STATE.daily_summary.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = `
        <div class="progress-grid glass">
            <div class="progress-grid-header">
                <h4>🧹 Daily Cleaning Progress</h4>
            </div>
            <div class="progress-badges">
                ${STATE.daily_summary.map(u => {
                    let statusLabel = "Awaiting Upload";
                    let statusClass = "status-pending";
                    let icon = 'waiting';

                    if (u.total_photos > 0) {
                        if (u.pending_photos > 0) {
                            statusLabel = "Needs Review";
                            statusClass = "status-review";
                            icon = 'search';
                        } else if (u.failed_photos > 0) {
                            statusLabel = "Awaiting Correction";
                            statusClass = "status-failed";
                            icon = 'error';
                        } else {
                            statusLabel = "Completed";
                            statusClass = "status-passed";
                            icon = 'check';
                        }
                    }

                    return `
                        <div class="progress-badge-item ${statusClass}">
                            <div class="user-info">
                                ${window.getUserIcon(u.username)} <strong>${escapeHtml(u.username)}</strong>
                            </div>
                            <div class="status-info">
                                ${{ 'waiting': '⌛', 'search': '🔍', 'error': '⚠️', 'check': '✅' }[icon] || '❓'} ${statusLabel}
                                ${u.total_photos > 0 ? `<small>(${u.passed_photos}/${u.total_photos})</small>` : ''}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

/**
 * Renders the queue of pending submissions grouped by user and date.
 * 
 * @returns {void}
 */
function renderReviewQueue() {
    const container = document.getElementById('reviewQueue');
    if (!container) return;

    if (STATE.pending_submissions.length === 0) {
        container.innerHTML = '<div class="empty-state glass">🎉 No pending reviews! All rooms are handled.</div>';
        return;
    }

    const groups = {};
    STATE.pending_submissions.forEach(s => {
        const key = `${s.user_id}_${s.submission_date}`;
        if (!groups[key]) groups[key] = { 
            username: s.username, 
            user_id: s.user_id, 
            date: s.submission_date, 
            photos: [] 
        };
        groups[key].photos.push(s);
    });

    container.innerHTML = Object.values(groups).map(g => `
        <div class="review-group glass">
            <div class="review-header">
                <h3>${window.getUserIcon(g.username)} ${escapeHtml(g.username)} <small>(${g.date})</small></h3>
            </div>
            <div class="submission-grid">
                ${g.photos.map(p => {
                    const status = normalizeRoomStatus(p.status);
                    return `
                    <div class="review-photo-card ${status === 'failed' ? 'failed' : ''}">
                        <div class="submission-item" onclick="openPhotoModal(${p.id})">
                            <div class="photo-container">
                                <img src="/room/serve/${p.id}" class="submission-thumb">
                                <span class="status-badge status-${status}">${status.toUpperCase()}</span>
                            </div>
                        </div>
                        <div class="photo-controls">
                            <div class="action-buttons">
                                <button type="button" class="btn-icon-view" onclick="updateStatus(${p.id}, 'passed', this)" title="Pass">
                    ✅
                </button>
                <button type="button" class="btn-icon-edit" onclick="showFailComment(${p.id})" title="Fail">
                    ×
                </button>
                <button type="button" class="btn-icon-delete" onclick="confirmDeleteSubmission(${p.id})" title="Delete">
                    🗑️
                </button>
                            </div>
                        </div>
                        <div id="fail-box-${p.id}" class="${status === 'failed' ? '' : 'hidden'}">
                            <textarea id="comment-${p.id}" class="game-input fail-comment-box" placeholder="Why did it fail?">${escapeHtml(p.admin_comment || '')}</textarea>
                            <button class="btn-primary btn-small full-width" onclick="updateStatus(${p.id}, 'failed', this)">Update Feedback</button>
                        </div>
                    </div>
                    `;
                }).join('')}
            </div>
        </div>
    `).join('');
}

/**
 * Renders the clickable user configuration cards in the Management tab.
 * 
 * @returns {void}
 */
function renderSettings() {
    const container = document.getElementById('userConfigs');
    if (!container) return;

    container.innerHTML = STATE.all_users.filter(u => u.is_child && !u.is_admin).map(u => {
        const config = STATE.room_configs.find(c => c.user_id === u.id) || { alert_start_time: '17:00:00', is_active: 0 };
        const statusIcon = config.is_active ? '✅' : '⚠️';
        const statusClass = config.is_active ? 'text-success' : 'text-danger';
        const alertTimeShort = normalizeAlertTime(config.alert_start_time);
        const formattedTime = formatTimeAMPM(alertTimeShort);
        
        return `
            <div class="setting-card glass clickable" data-user-id="${u.id}" data-username="${escapeHtml(u.username)}" data-time="${alertTimeShort}" data-active="${config.is_active ? 1 : 0}" onclick="handleSettingsCardClick(this)">
                <div class="setting-card-header">
                    <h4>${window.getUserIcon(u.username)} ${escapeHtml(u.username)}</h4>
                    <span class="status-indicator ${statusClass}">${statusIcon}</span>
                </div>
                <div class="setting-card-body">
                    <div class="config-summary">
                        <small>🕒 ${formattedTime}</small>
                    </div>
                </div>
                <input type="hidden" class="config-time" value="${alertTimeShort}">
                <input type="checkbox" class="config-active hidden" ${config.is_active ? 'checked' : ''}>
            </div>
        `;
    }).join('');
}

/**
 * Handles extraction of card metadata to populate the settings modal.
 * 
 * @param {HTMLElement} el - The clicked card.
 * @returns {void}
 */
function handleSettingsCardClick(el) {
    const userId = el.getAttribute('data-user-id');
    const username = el.getAttribute('data-username');
    const time = el.querySelector('.config-time').value;
    const isActive = el.querySelector('.config-active').checked;
    
    openSettingsModal(userId, username, time, isActive);
}

/**
 * Renders the scheduled blackout dates.
 * 
 * @returns {void}
 */
function renderBlackouts() {
    const list = document.getElementById('blackoutList');
    if (!list) return;

    list.innerHTML = STATE.blackout_dates.map(b => `
        <div class="blackout-item glass">
            <div>
                <strong>${b.blackout_date}</strong>
                ${b.reason ? `<br><small>${escapeHtml(b.reason)}</small>` : ''}
            </div>
            <button class="btn-icon-delete" onclick="deleteBlackout(${b.id})">🗑️</button>
        </div>
    `).join('');
}

/**
 * --- Action Handlers ---
 */

/**
 * Formats a 24-hour time string (HH:MM:SS) to AM/PM format.
 * 
 * @param {string} time24 - 24h time string.
 * @returns {string} - Formatted time.
 */
function normalizeAlertTime(timeValue) {
    const match = String(timeValue || '').match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
    return match ? `${match[1]}:${match[2]}` : '17:00';
}

function formatTimeAMPM(time24) {
    const normalized = normalizeAlertTime(time24);
    let [h, m] = normalized.split(':');
    h = parseInt(h);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ampm}`;
}

/**
 * Displays the user configuration modal.
 * 
 * @param {number} userId - Target user ID.
 * @param {string} username - Target username.
 * @param {string} time - 24h alert time.
 * @param {boolean} isActive - Status flag.
 * @returns {void}
 */
function openSettingsModal(userId, username, time, isActive) {
    document.getElementById('settingsUserId').value = userId;
    document.getElementById('settingsModalUser').innerHTML = `${window.getUserIcon(username)} ${escapeHtml(username)}`;
    document.getElementById('settingsAlertTime').value = time;
    document.getElementById('settingsIsActive').checked = !!isActive;
    document.getElementById('userSettingsModal').classList.add('show');
    document.body.classList.add('modal-open');
}

/**
 * Hides the user settings modal.
 * 
 * @returns {void}
 */
function closeSettingsModal() {
    const modal = document.getElementById('userSettingsModal');
    if (modal) modal.classList.remove('show');
    if (!hasOpenRoomModal()) document.body.classList.remove('modal-open');
}

/**
 * Commits modal configuration directly to the database.
 * 
 * @returns {Promise<void>}
 */
async function applySettingsModal() {
    const userId = document.getElementById('settingsUserId').value;
    const time = document.getElementById('settingsAlertTime').value;
    const active = document.getElementById('settingsIsActive').checked ? 1 : 0;
    
    const result = await apiPost('/room/api/save_config', new URLSearchParams({
        user_id: userId,
        alert_start_time: time,
        is_active: active
    }));

    if (result && result.success) {
        closeSettingsModal();
        showToast("Settings saved", "success");
        loadState(true);
    }
}

/**
 * Renders all files currently in the UPLOAD_QUEUE.
 * 
 * @returns {void}
 */
function renderUploadPreviews() {
    const previewContainer = document.getElementById('filePreviews');
    const uploadBtn = document.getElementById('uploadBtn');
    if (!previewContainer || !uploadBtn) return;

    previewContainer.innerHTML = '';
    
    if (UPLOAD_QUEUE.length > 0) {
        uploadBtn.classList.remove('hidden');
        previewContainer.classList.add('file-previews');
        UPLOAD_QUEUE.forEach(item => {
            const div = document.createElement('div');
            div.className = 'upload-preview-item';

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'preview-remove';
            btn.textContent = '×';
            btn.disabled = item.processing;
            btn.onclick = () => removeQueueItem(item.id);

            if (item.processing) {
                div.innerHTML = `
                    <div class="empty-preview-hint">
                        <span>⌛</span>
                        <strong>Processing...</strong>
                    </div>
                `;
            } else if (item.previewUrl) {
                const img = document.createElement('img');
                img.className = 'preview-thumb';
                img.src = item.previewUrl;
                img.alt = item.name;
                div.appendChild(img);
            }

            div.appendChild(btn);
            previewContainer.appendChild(div);
        });
    } else {
        uploadBtn.classList.add('hidden');
        previewContainer.classList.remove('file-previews');
        previewContainer.innerHTML = `
            <div class="empty-preview-hint">
                <span>🖼️</span>
                No photos added yet
            </div>
        `;
    }
}

/**
 * Removes a specific file from the upload queue.
 * 
 * @param {number} index - Queue index.
 * @returns {void}
 */
function removeFromQueue(index) {
    const item = UPLOAD_QUEUE[index];
    if (!item) return;
    removeQueueItem(item.id);
}

/**
 * Processes multi-photo binary uploads.
 * 
 * @param {Event} event - Submission event.
 * @returns {Promise<void>}
 */
async function handleUpload(event) {
    event.preventDefault();
    if (UPLOAD_QUEUE.length === 0) return;
    if (UPLOAD_QUEUE.some(item => item.processing)) {
        showToast('Still processing photos. Please wait a moment.', 'error');
        return;
    }

    const btn = document.getElementById('uploadBtn');
    const formData = new FormData();
    
    UPLOAD_QUEUE.forEach(item => {
        formData.append('files[]', item.blob, item.uploadName);
    });
    
    btn.disabled = true;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = `⌛ Uploading ${UPLOAD_QUEUE.length} photos...`;
    if (typeof showLoadingOverlay === 'function') {
        showLoadingOverlay('Uploading room photos...', 'Preparing your submission for review.');
    }
    
    try {
        const result = await apiPost('/room/api/upload', formData, CONFIG.ROOM_UPLOAD_TIMEOUT_MS);
        if (result && result.success) {
            closeUploadModal();
            loadState(true);
        }
    } catch (err) {
        console.error("Upload process failed:", err);
    } finally {
        if (typeof hideLoadingOverlay === 'function') hideLoadingOverlay();
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Updates status and feedback for a photo.
 * 
 * @param {number} id - Record ID.
 * @param {string} status - 'passed'|'failed'.
 * @returns {Promise<void>}
 */
async function updateStatus(id, status, btn = null) {
    if (btn && btn.disabled) return;
    const originalDisabled = btn ? btn.disabled : false;
    if (btn) btn.disabled = true;

    const comment = status === 'failed'
        ? (document.getElementById(`comment-${id}`)?.value || '')
        : '';
    try {
        const result = await apiPost('/room/api/update_status', new URLSearchParams({
            id: id,
            status: status,
            comment: comment
        }));
        if (result && result.success) {
            showToast(`Photo marked as ${status}`, "success");
            if (status === 'failed') showFailComment(id);
            loadState(true);
        }
    } finally {
        if (btn) btn.disabled = originalDisabled;
    }
}

/**
 * Schedules a new blackout date for the family.

 * 
 * @param {Event} event - Submission event.
 * @returns {Promise<void>}
 */
async function addBlackout(event) {
    event.preventDefault();
    const form = event.target;
    const params = new URLSearchParams({
        date: form.date.value,
        reason: form.reason.value
    });
    const result = await apiPost('/room/api/add_blackout', params);
    if (result && result.success) {
        form.reset();
        showToast("Blackout date added", "success");
        loadState(true);
    }
}

/**
 * Deletes a blackout date.
 * 
 * @param {number} id - Record ID.
 * @returns {Promise<void>}
 */
async function deleteBlackout(id) {
    const result = await apiPost('/room/api/delete_blackout', new URLSearchParams({ id: id }));
    if (result && result.success) {
        showToast("Blackout removed", "success");
        loadState(true);
    }
}

/**
 * --- UI Helpers ---
 */

/**
 * Manages administrative tab transitions.
 * 
 * @param {string} tab - Tab name.
 * @param {HTMLElement} btn - Clicked button.
 * @returns {void}
 */
function switchTab(tab, btn) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    
    const targetTab = document.getElementById(tab + 'Tab');
    if (targetTab) {
        targetTab.classList.remove('hidden');
        renderAdminTabs();
    }
    
    if (btn) {
        btn.classList.add('active');
    } else if (window.event && window.event.currentTarget) {
        window.event.currentTarget.classList.add('active');
    }
}

/**
 * Toggles the failure comment textarea.
 * 
 * @param {number} id - Record ID.
 * @returns {void}
 */
function showFailComment(id) {
    const box = document.getElementById(`fail-box-${id}`);
    if (box) box.classList.toggle('hidden');
}

/**
 * Displays the upload modal.
 */
function openUploadModal() {
    document.getElementById('uploadModal').classList.add('show');
    clearUploadQueue();
    renderUploadPreviews();
    document.body.classList.add('modal-open');
}

/**
 * Resets and hides the upload modal.
 */
function closeUploadModal() {
    const modal = document.getElementById('uploadModal');
    if (modal) modal.classList.remove('show');
    const form = document.getElementById('uploadForm');
    if (form) form.reset();
    clearUploadQueue();
    if (!hasOpenRoomModal()) document.body.classList.remove('modal-open');
}

/**
 * Opens the full-screen photo modal.
 * 
 * @param {number} id - Record ID.
 */
function openPhotoModal(id) {
    const modal = document.getElementById('photoModal');
    const img = document.getElementById('modalImg');
    if (modal && img) {
        img.src = `/room/serve/${id}`;
        modal.classList.add('show');
        document.body.classList.add('modal-open');
    }
}

/**
 * Hides the photo modal.
 */
function closePhotoModal() {
    const modal = document.getElementById('photoModal');
    if (modal) modal.classList.remove('show');
    const img = document.getElementById('modalImg');
    if (img) img.removeAttribute('src');
    if (!hasOpenRoomModal()) document.body.classList.remove('modal-open');
}

/**
 * Triggers a confirmation modal before permanently removing a submission.
 * 
 * @param {number} id - Submission ID.
 * @returns {void}
 */
function confirmDeleteSubmission(id) {
    showConfirmModal({
        title: 'Delete Photo',
        message: 'Are you sure you want to remove this photo? It will be permanently deleted from the vault.',
        confirmText: 'DELETE',
        danger: true,
        hideCancel: true,
        onConfirm: async () => {
            const result = await apiPost(`/room/api/delete/${id}`);
            if (result && result.success) {
                showToast("Photo removed", "success");
                loadState(true);
            }
        }
    });
}

/**
 * Opens the persistent room upload input and marks the camera round-trip as active.
 */
function openRoomFileInput() {
    const input = document.getElementById('roomUploadInput');
    if (!input) return;
    sessionStorage.setItem('room_camera_pending', '1');
    const clearPendingIfCanceled = () => {
        setTimeout(() => {
            if (!input.files || input.files.length === 0) {
                sessionStorage.removeItem('room_camera_pending');
            }
        }, 500);
    };
    window.addEventListener('focus', clearPendingIfCanceled, { once: true });
    input.click();
}

/**
 * Wires the persistent upload input used by the mobile camera flow.
 *
 * @returns {void}
 */
function setupUploadInput() {
    const input = document.getElementById('roomUploadInput');
    if (!input) return;

    input.addEventListener('change', async () => {
        sessionStorage.removeItem('room_camera_pending');

        const files = Array.from(input.files || []);
        input.value = '';

        if (files.length === 0) {
            showToast('No photo was captured. Please try again.', 'error');
            return;
        }

        await addRoomUploadFiles(files);
    });
}

/**
 * Adds selected files to the upload queue after client-side normalization.
 *
 * @param {File[]} files - Selected camera/gallery files.
 * @returns {Promise<void>}
 */
function isRoomImageFile(file) {
    const name = (file?.name || '').toLowerCase();
    return !!file && (
        (file.type && file.type.toLowerCase().startsWith('image/')) ||
        name.endsWith('.heic') ||
        name.endsWith('.heif')
    );
}

async function addRoomUploadFiles(files) {
    const token = ++UPLOAD_TOKEN;
    const validFiles = files.filter(file => file && file.size > 0 && isRoomImageFile(file));
    const badCount = files.length - validFiles.length;

    if (badCount > 0) {
        showToast('One or more selected files were empty or not images.', 'error');
    }
    if (validFiles.length === 0) return;

    const queueItems = validFiles.map((file, index) => ({
        id: `${Date.now()}-${token}-${index}`,
        name: file.name || `room-photo-${UPLOAD_QUEUE.length + index + 1}`,
        uploadName: normalizedUploadName(file.name, token, index),
        processing: true,
        blob: null,
        previewUrl: null
    }));

    UPLOAD_QUEUE = [...UPLOAD_QUEUE, ...queueItems];
    renderUploadPreviews();

    await Promise.all(queueItems.map(async (item, index) => {
        const file = validFiles[index];
        if (!file) return;

        try {
            const prepared = await prepareRoomUploadImage(file);
            if (token !== UPLOAD_TOKEN || !UPLOAD_QUEUE.some(queueItem => queueItem.id === item.id)) return;
            item.blob = prepared;
            item.processing = false;
            item.previewUrl = URL.createObjectURL(prepared);
        } catch (err) {
            console.error('Room image preparation failed', err);
            item.processing = false;
            removeQueueItem(item.id, false);
            showToast(`Could not process ${file.name || 'this photo'}. Please try again.`, 'error');
        } finally {
            renderUploadPreviews();
        }
    }));
}

/**
 * Converts modern mobile photos when needed without resizing room images.
 *
 * @param {File|Blob} file - Selected image file.
 * @returns {Promise<File|Blob>} Prepared upload payload.
 */
async function prepareRoomUploadImage(file) {
    const low = (file.name || '').toLowerCase();
    if ((low.endsWith('.heic') || low.endsWith('.heif')) && typeof heic2any === 'function') {
        showToast('Processing modern image format...', 'info');
        const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: CONFIG.ROOM_UPLOAD_JPEG_QUALITY });
        return Array.isArray(converted) ? converted[0] : converted;
    }
    return file;
}

/**
 * Clears the upload queue and releases preview URLs.
 *
 * @returns {void}
 */
function clearUploadQueue() {
    UPLOAD_TOKEN++;
    UPLOAD_QUEUE.forEach(item => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    UPLOAD_QUEUE = [];
}

/**
 * Removes a queued item and optionally refreshes previews.
 *
 * @param {string} id - Queue item id.
 * @param {boolean} rerender - Whether to refresh the preview grid.
 * @returns {void}
 */
function removeQueueItem(id, rerender = true) {
    const index = UPLOAD_QUEUE.findIndex(item => item.id === id);
    if (index === -1) return;
    const [item] = UPLOAD_QUEUE.splice(index, 1);
    if (item && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    if (rerender) renderUploadPreviews();
}

/**
 * Normalizes a queue filename for upload.
 *
 * @param {string} name - Source filename.
 * @param {number} token - Selection token.
 * @param {number} index - Selection index.
 * @returns {string} Upload filename.
 */
function normalizedUploadName(name, token, index) {
    const base = (name || `room-photo-${token}-${index + 1}`).replace(/\.[^.]*$/, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'room-photo';
    return `${base}-${token}-${index + 1}.jpg`;
}
