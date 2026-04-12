// /public/js/notes/api.js

/**
 * NoteAPI: Centralized AJAX Orchestrator for the Whiteboard Module.
 * Provides a standardized, signal-aware transport layer with built-in CSRF 
 * protection, session management, and silent abort handling.
 */
window.NoteAPI = {
    /**
     * Standard GET Wrapper.
     * @param {string} url - Target endpoint.
     * @param {Object} options - { signal: AbortSignal }
     */
    async get(url, options = {}) {
        try {
            const response = await fetch(url, { signal: options.signal });
            
            // Session Guard: Centralized 403 handling
            if (response.status === 403) {
                let body403 = null;
                try { body403 = await response.json(); } catch (_) {}
                
                if (body403 && (body403.error === 'Canvas is locked' || body403.error === 'Note is locked by another session')) {
                    if (body403.error === 'Canvas is locked' && typeof showLockedOverlay === 'function') {
                        showLockedOverlay();
                    }
                    return body403;
                }
                
                window.location.href = '/login';
                return null;
            }

            if (!response.ok) {
                console.error(`NoteAPI Get: HTTP ${response.status} for ${url}`);
                return null;
            }

            const data = await response.json();
            if (data.error && !data.success) {
                showToast(data.error, 'error');
            }
            return data;
        } catch (err) {
            // Signal Management: Silence intentional context-switch abortions
            if (err.name === 'AbortError') return null;
            console.error('NoteAPI Get Error:', err);
            showToast('Network request failed', 'error');
            return null;
        }
    },

    /**
     * Standard POST Wrapper (Supports JSON, Form-encoded, and FormData).
     * @param {string} url - Target endpoint.
     * @param {Object|FormData} params - Payload.
     * @param {Object} options - { signal: AbortSignal }
     */
    async post(url, params, options = {}) {
        const isFormData = params instanceof FormData;
        const csrfToken  = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');

        const headers = { 'X-CSRF-Token': csrfToken };
        let body;

        if (isFormData) {
            body = params;
            if (typeof STATE !== 'undefined' && STATE.sessionId && !params.has('session_id')) {
                params.append('session_id', STATE.sessionId);
            }
        } else if (Array.isArray(params)) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(params);
        } else {
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
            params = params || {};
            if (typeof STATE !== 'undefined' && STATE.sessionId && !params.session_id) {
                params.session_id = STATE.sessionId;
            }
            body = new URLSearchParams(params);
        }

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: body,
                signal: options.signal,
                keepalive: options.keepalive
            });
            
            // Session Guard: Hard redirect on expiry
            if (response.status === 403) {
                let body403 = null;
                try { body403 = await response.json(); } catch (_) {}
                
                if (body403 && (body403.error === 'Canvas is locked' || body403.error === 'Note is locked by another session')) {
                    if (body403.error === 'Canvas is locked' && typeof showLockedOverlay === 'function') {
                        showLockedOverlay();
                    }
                    return body403;
                }
                
                window.location.href = '/login';
                return null;
            }

            if (!response.ok) {
                console.error(`NoteAPI Post: HTTP ${response.status} for ${url}`);
                return null;
            }

            const data = await response.json();
            if (data.error && !data.success) {
                showToast(data.error, 'error');
            }
            return data;
        } catch (err) {
            if (err.name === 'AbortError') return null;
            console.error('NoteAPI Post Error:', err);
            showToast('Network request failed', 'error');
            return null;
        }
    },

    /**
     * Binary Fragment/Image Orchestrator.
     * Ensures consistent security handling even for media transfers.
     */
    async blob(url, options = {}) {
        try {
            const response = await fetch(url, { signal: options.signal });
            
            // Binary Session Guard: Redirect on 403 to prevent silent binary failure.
            // Canvas lock returns plain text 'Canvas Locked'; session expiry returns login HTML.
            if (response.status === 403) {
                const text = await response.text();
                if (text === 'Canvas Locked') {
                    if (typeof showLockedOverlay === 'function') showLockedOverlay();
                    return null;
                }
                window.location.href = '/login';
                return null;
            }

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.blob();
        } catch (err) {
            if (err.name === 'AbortError') return null;
            console.error('NoteAPI Blob Error:', err);
            showToast('Media fetch failed', 'error');
            return null;
        }
    },

    /**
     * Collaborative Locking: Attempts to acquire an exclusive edit lock.
     * @param {number|string} id - The note ID.
     */
    async lock(id) {
        return await this.post('/notes/api/lock', { id });
    },

    /**
     * Collaborative Locking: Releases an active edit lock.
     * @param {number|string} id - The note ID.
     */
    async unlock(id) {
        return await this.post('/notes/api/unlock', { id });
    }
};

/**
 * Positional Sync Orchestration: Prevents server saturation during rapid coordinate 
 * adjustments by collapsing multiple micro-moves into a single "Final State" save.
 */
const POSITION_SYNC_TIMERS   = new Map();
const POSITION_SYNC_PROMISES = new Map(); // Global registry for debounced settlement contexts

/**
 * Note Deletion Bridge (Soft-Delete)
 * Moves a note to the Recycle Bin rather than immediate destruction.
 * @param {number} id - Target note ID.
 */
function deleteNote(id) {
    showConfirmModal({
        title: 'Delete Note',
        icon: '🗑️',
        message: 'Are you sure you want to remove this sticky note? It will be moved to the Recycle Bin.',
        danger: true,
        confirmText: 'DELETE',
        confirmIcon: '🗑️',
        hideCancel: true,
        onConfirm: async () => {
            const sid = String(id);
            // Atomic Cleanup: Flush any pending positional syncs before deletion
            if (POSITION_SYNC_TIMERS.has(sid)) {
                clearTimeout(POSITION_SYNC_TIMERS.get(sid));
                POSITION_SYNC_TIMERS.delete(sid);
                POSITION_SYNC_PROMISES.delete(sid);
                if (typeof window.removeActiveSync === 'function') window.removeActiveSync(sid);
            }

            const res = await NoteAPI.post('/notes/api/delete', { id: id, canvas_id: STATE.canvas_id });
            if (res && res.success) {
                if (res.notes && typeof window.mergeNoteState === 'function') {
                    window.mergeNoteState(res.notes);
                } else if (res.notes) {
                    STATE.notes = res.notes;
                }
                STATE.last_mutation = res.last_mutation;
                if (typeof renderUI === 'function') renderUI();
                showToast('Note moved to Recycle Bin', 'success');
            }
        }
    });
}

/**
 * Atomic Synchronization: Persists note state to the backend.
 * Handles both immediate and debounced (moving/resizing) updates.
 * @param {number|string} id - The note ID.
 * @param {string} type - 'normal' (standard) or 'silent' (background sync).
 * @param {number} debounceMs - Delay in milliseconds before firing the API call.
 * @returns {Promise<Object>} - The backend response.
 */
async function syncNotePosition(id, type = 'normal', debounceMs = 0) {
    const el = document.getElementById(`note-${id}`);
    const note = STATE.notes.find(n => n.id == id);
    if (!el || !note) return Promise.resolve({ success: 0, error: 'Note not found' });

    const sid = String(id); // Standardize ID to string for Map key consistency

    // --- Debounce Strategy ---
    if (debounceMs > 0) {
        // Lifecycle Tracking: If no promise is pending for this ID, initialize a new settlement context.
        // This allows multiple 'jitter' calls to wait for the same eventual result.
        if (!POSITION_SYNC_PROMISES.has(sid)) {
            let resolve, reject;
            const promise = new Promise((res, rej) => {
                resolve = res;
                reject = rej;
            });
            POSITION_SYNC_PROMISES.set(sid, { promise, resolve, reject });
        }

        // Atomic Lock Acquisition: Ensure the note is protected while the user is still 'jittering'
        if (!POSITION_SYNC_TIMERS.has(sid)) {
            if (typeof window.addActiveSync === 'function') window.addActiveSync(sid);
        }

        if (POSITION_SYNC_TIMERS.has(sid)) {
            clearTimeout(POSITION_SYNC_TIMERS.get(sid));
        }

        const timerToken = {};
        POSITION_SYNC_TIMERS._tokens = POSITION_SYNC_TIMERS._tokens || new Map();
        POSITION_SYNC_TIMERS._tokens.set(sid, timerToken);

        const timer = setTimeout(async () => {
            // Ownership check: bail if a newer timer has replaced us or an immediate sync ran.
            if (POSITION_SYNC_TIMERS._tokens.get(sid) !== timerToken) return;

            const context = POSITION_SYNC_PROMISES.get(sid);
            if (context) {
                POSITION_SYNC_PROMISES.delete(sid);
                POSITION_SYNC_TIMERS.delete(sid);
                POSITION_SYNC_TIMERS._tokens.delete(sid);

                // Abort if the note was deleted while the debounce timer was pending
                if (!STATE.notes.find(n => n.id == id)) {
                    if (typeof window.removeActiveSync === 'function') window.removeActiveSync(sid);
                    context.resolve({ success: 0, error: 'Note deleted' });
                    return;
                }

                // Re-capture fresh DOM coordinates at the moment the timer fires
                const latestColorInput = el.querySelector('.inline-color-input');
                const latestParams = {
                    id: id,
                    canvas_id: STATE.canvas_id,
                    x: parseInt(el.style.left),
                    y: parseInt(el.style.top),
                    width:  note.is_collapsed ? (note.width  || el.offsetWidth)  : el.offsetWidth,
                    height: note.is_collapsed ? (note.height || el.offsetHeight) : el.offsetHeight,
                    z_index: el.style.zIndex,
                    layer_id: note.layer_id || 1,
                    is_collapsed: note.is_collapsed,
                    color: latestColorInput ? latestColorInput.value : note.color
                };

                try {
                    const res = await NoteAPI.post('/notes/api/geometry', latestParams);
                    if (res && res.success) {
                        if (res.notes && typeof window.mergeNoteState === 'function') {
                            window.mergeNoteState(res.notes);
                        } else if (res.notes) {
                            STATE.notes = res.notes;
                        }
                        STATE.last_mutation = res.last_mutation;
                        context.resolve(res);
                    } else {
                        context.reject(new Error(res?.error || 'Save failed'));
                    }
                } catch (e) {
                    console.error(`[syncNotePosition] Debounced save failed for note ${id}:`, e);
                    context.reject(e);
                } finally {
                    // Only release the sync guard if no new timer was registered for this sid
                    // while the API call was in flight (i.e. we are still the active owner).
                    if (!POSITION_SYNC_TIMERS.has(sid)) {
                        if (typeof window.removeActiveSync === 'function') window.removeActiveSync(sid);
                    }
                }
            }
        }, debounceMs);

        POSITION_SYNC_TIMERS.set(sid, timer);
        return POSITION_SYNC_PROMISES.get(sid).promise;
    }

    // --- Immediate Fire Path (Legacy & Administrative Syncs) ---
    // Cleanup: If there is a pending debounced timer/promise, clear it now to prevent race conditions.
    if (POSITION_SYNC_TIMERS.has(sid)) {
        clearTimeout(POSITION_SYNC_TIMERS.get(sid));
        POSITION_SYNC_TIMERS.delete(sid);
    }
    const pendingContext = POSITION_SYNC_PROMISES.get(sid);
    POSITION_SYNC_PROMISES.delete(sid);

    if (type !== 'silent') el.classList.add('pending');
    if (typeof window.addActiveSync === 'function') window.addActiveSync(sid);

    const colorInput = el.querySelector('.inline-color-input');
    const params = {
        id: id,
        canvas_id: STATE.canvas_id,
        x: parseInt(el.style.left),
        y: parseInt(el.style.top),
        width:  note.is_collapsed ? (note.width  || el.offsetWidth)  : el.offsetWidth,
        height: note.is_collapsed ? (note.height || el.offsetHeight) : el.offsetHeight,
        z_index: el.style.zIndex,
        layer_id: note.layer_id || 1,
        is_collapsed: note.is_collapsed,
        color: colorInput ? colorInput.value : note.color
    };

    try {
        const res = await NoteAPI.post('/notes/api/geometry', params);
        if (res && res.success) {
            if (res.notes && typeof window.mergeNoteState === 'function') {
                window.mergeNoteState(res.notes);
            } else if (res.notes) {
                STATE.notes = res.notes;
            }
            STATE.last_mutation = res.last_mutation;
            if (pendingContext) pendingContext.resolve(res);
            return res;
        } else {
            const error = new Error(res?.error || 'Save failed');
            if (pendingContext) pendingContext.reject(error);
            throw error;
        }
    } catch (e) {
        console.error(`[syncNotePosition] Immediate save failed for note ${id}:`, e);
        if (pendingContext) pendingContext.reject(e);
        throw e;
    } finally {
        if (type !== 'silent') el.classList.remove('pending');
        if (typeof window.removeActiveSync === 'function') window.removeActiveSync(sid);
    }
}



/**
 * Recycle Bin Fetch
 */
async function loadBin() {
    return await NoteAPI.get('/notes/api/bin');
}

/**
 * Restoration Engine
 */
async function restoreNote(id, canvas_id, layer_id, x, y) {
    return await NoteAPI.post('/notes/api/restore', { id, canvas_id, layer_id, x, y });
}



/**
 * Canvas Management
 */
async function renameCanvas(canvas_id, name) {
    return await NoteAPI.post('/notes/api/canvases/rename', { canvas_id, name });
}

async function deleteCanvasApi(canvas_id) {
    return await NoteAPI.post('/notes/api/canvases/delete', { canvas_id });
}

async function createCanvas(name) {
    return await NoteAPI.post('/notes/api/canvases/create', { name });
}

/**
 * Sharing & ACL
 */
async function addShare(canvas_id, username) {
    const res = await NoteAPI.post('/notes/api/canvases/share', { canvas_id, username, can_edit: 1 });
    if (res && res.success) {
        // State Synchronization: Only update if the modified board is active
        if (canvas_id == STATE.canvas_id) {
            STATE.share_list = res.share_list;
        }
        if (typeof renderShareList === 'function') {
            renderShareList(canvas_id, res.share_list);
        }
        showToast('Shared successfully', 'success');
    }
    return res;
}

async function updateSharePermission(canvasId, username, canEdit) {
    const res = await NoteAPI.post('/notes/api/canvases/share', { canvas_id: canvasId, username, can_edit: canEdit });
    if (res && res.success) {
        if (canvasId == STATE.canvas_id) {
            STATE.share_list = res.share_list;
        }
        showToast('Permissions updated', 'success');
    }
    return res;
}

async function revokeShare(canvasId, username) {
    const res = await NoteAPI.post('/notes/api/canvases/share', { canvas_id: canvasId, username, revoke: 1 });
    if (res && res.success) {
        // State Synchronization: Re-align shared list baseline
        if (canvasId == STATE.canvas_id) {
            STATE.share_list = res.share_list;
        }
        if (typeof renderShareList === 'function') {
            renderShareList(canvasId, res.share_list);
        }
        showToast('Access revoked', 'info');
    }
    return res;
}

/**
 * Sharing & ACL
 */
async function updateShare(canvas_id, username, can_edit, revoke = 0) {
    const params = { canvas_id, username, can_edit };
    if (revoke) params.revoke = 1;
    return await NoteAPI.post('/notes/api/canvases/share', params);
}

/**
 * Navigation
 */
async function switchLevel(id) {
    if (id == STATE.activeLayerId || STATE.isSwitchingLayer) return;
    
    STATE.isSwitchingLayer = true;
    if (typeof saveViewportImmediate === 'function') await saveViewportImmediate();
    
    STATE.isEditingNote = false;
    showLoadingOverlay('Transitioning Perspective...');
    
    try {
        if (typeof loadState === 'function') await loadState(false, STATE.canvas_id, null, id);
        // Persist the new Layer ID as the 'most recent' immediately to survive page reloads
        if (typeof saveViewportImmediate === 'function') await saveViewportImmediate();
    } finally {
        hideLoadingOverlay();
        STATE.isSwitchingLayer = false;
    }
}

/**
 * Directional Navigation: Moves the isolation layer context up or down.
 * @param {number} direction - -1 (Up) or 1 (Down).
 */
async function moveLevel(direction) {
    if (STATE.isSwitchingLayer) return;

    // Type Safety: Ensure activeLayerId is treated as a number to prevent string concatenation
    let nextLevel = Number(STATE.activeLayerId) + direction;

    // Circular Loop Resolution: 1 <-> 99 wrapping
    if (nextLevel > 99) nextLevel = 1;
    if (nextLevel < 1) nextLevel = 99;

    await switchLevel(nextLevel);
}

/**
 * Copy/Clone Actions
 */
async function copyNoteToBoard(id, canvas_id) {
    const res = await NoteAPI.post('/notes/api/notes/copy', { id, canvas_id });
    if (res && res.success) {
        showToast('Note copied to board', 'success');
        if (typeof closeMoveModal === 'function') closeMoveModal();
    }
    return res;
}

/**
 * Copy/Clone Actions
 * Deep-copies a note across isolation layers within the same board.
 */
async function copyNoteToLevel(id, newLevelId) {
    const note = STATE.notes.find(n => n.id == id);
    if (!note) return;

    // Interaction Locking
    const el = document.getElementById(`note-${id}`);
    if (el) el.classList.add('pending');

    try {
        const res = await NoteAPI.post('/notes/api/save', {
            id: null, // Force creation of a NEW record
            source_id: id, // Link for binary deep-copy (images)
            canvas_id: STATE.canvas_id,
            type: note.type || 'text', // Preserve 'image' vs 'text' identity
            title: note.title, // Clean clone: No (Copy) suffix
            content: note.content,
            filename: note.filename || '',
            x: note.x + 20, // Offset horizontally for clarity
            y: note.y + 20, // Offset vertically for clarity
            width: note.width,
            height: note.height,
            color: note.color,
            z_index: note.z_index,
            is_collapsed: note.is_collapsed
        });

        if (res && res.success) {
            if (res.notes && typeof window.mergeNoteState === 'function') {
                window.mergeNoteState(res.notes);
            } else if (res.notes) {
                STATE.notes = res.notes;
            }
            STATE.last_mutation = res.last_mutation;
            if (newLevelId == STATE.activeLayerId && typeof renderUI === 'function') {
                renderUI();
            }
        }
    } catch (e) {
        console.error("Duplication failure:", e);
        showToast("Failed to copy note between levels", "error");
    } finally {
        if (el) el.classList.remove('pending');
    }
}
