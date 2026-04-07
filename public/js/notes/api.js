// /public/js/notes/api.js

/**
 * Standard AJAX Wrapper with CSRF Protection.
 * @param {string} url - API endpoint.
 * @param {Object|FormData} params - Request payload.
 * @returns {Promise<Object>} - Server response.
 */
async function apiPost(url, params) {
    const isFormData = params instanceof FormData;
    const csrfToken  = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');

    const headers = {
        'X-CSRF-Token': csrfToken
    };

    if (!isFormData) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    const body = isFormData ? params : new URLSearchParams(params);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: body
        });
        
        if (response.status === 403) {
            const data = await response.json();
            if (data.error) {
                showToast(data.error, 'error');
            } else {
                console.error('CSRF/Auth Failure (403) for:', url);
                showToast('Session mismatch or expired. Please refresh the page.', 'error');
            }
            return { success: false, error: 'Unauthorized' };
        }

        const data = await response.json();
        if (data.error && !data.success) {
            showToast(data.error, 'error');
        }
        return data;
    } catch (err) {
        console.error('API Post Error:', err);
        showToast('Network request failed', 'error');
        return { success: false, error: 'Network Error' };
    }
}

async function apiGet(url) {
    try {
        const response = await fetch(url);
        return await response.json();
    } catch (err) {
        console.error('API Get Error:', err);
        return { success: false, error: 'Network Error' };
    }
}

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
            const res = await apiPost('/notes/api/delete', { id: id, canvas_id: STATE.canvas_id });
            if (res && res.success) {
                STATE.notes         = res.notes;
                STATE.last_mutation = res.last_mutation;
                if (typeof renderUI === 'function') renderUI();
                showToast('Note moved to Recycle Bin', 'success');
            }
        }
    });
}

/**
 * Synchronizes position data to the backend.
 */
async function syncNotePosition(id, type = 'normal') {
    const el = document.getElementById(`note-${id}`);
    const note = STATE.notes.find(n => n.id == id);
    if (!el || !note) return;

    if (type !== 'silent') el.classList.add('pending');

    const params = {
        id: id,
        canvas_id: STATE.canvas_id,
        title: note.title,
        x: parseInt(el.style.left),
        y: parseInt(el.style.top),
        width:  note.is_collapsed ? (note.width  || el.offsetWidth)  : el.offsetWidth,
        height: note.is_collapsed ? (note.height || el.offsetHeight) : el.offsetHeight,
        z_index: el.style.zIndex,
        content: STATE.note_map[id]?.content || note.content,
        filename: note.filename,
        color: note.color,
        layer_id: note.layer_id || 1,
        is_collapsed: note.is_collapsed,
        is_options_expanded: note.is_options_expanded || 0
    };

    try {
        const res = await apiPost('/notes/api/save', params);
        if (res && res.success) {
            STATE.notes = res.notes; // State Sync
            STATE.last_mutation = res.last_mutation;
            STATE.note_map      = res.note_map || STATE.note_map;
        }
    } finally {
        if (type !== 'silent') el.classList.remove('pending');
    }
}

/**
 * Toggles the checkbox state within a note and persists to the backend.
 */
async function toggleNoteCheckbox(event, noteId, lineIndex) {
    if (event) event.stopPropagation();
    const note = STATE.notes.find(n => n.id == noteId);
    if (!note) return;

    const isChecked = event.target.checked !== undefined ? event.target.checked : !/\[[xX\*]\]/.test(note.content.split('\n')[lineIndex]);
    const lines = note.content.split('\n');
    const line  = lines[lineIndex];

    if (line) {
        if (isChecked) {
            lines[lineIndex] = line.replace(/\[[ ]?\]/, '[x]');
        } else {
            lines[lineIndex] = line.replace(/\[[xX\*]\]/, '[ ]');
        }
    }

    const newContent = lines.join('\n');
    note.content     = newContent; // Optimistic UI update

    const el = document.getElementById(`note-${noteId}`);
    const params = {
        id: noteId,
        canvas_id: STATE.canvas_id,
        title: note.title,
        content: newContent,
        filename: note.filename || '',
        color: note.color,
        layer_id: note.layer_id || STATE.activeLayerId,
        x: note.x,
        y: note.y,
        width:  note.is_collapsed ? (note.width  || (el ? el.offsetWidth : 0))  : (el ? el.offsetWidth : note.width),
        height: note.is_collapsed ? (note.height || (el ? el.offsetHeight : 0)) : (el ? el.offsetHeight : note.height),
        z_index: el ? el.style.zIndex : note.z_index,
        is_collapsed: note.is_collapsed
    };

    try {
        const res = await apiPost('/notes/api/save', params);
        if (res && res.success) {
            STATE.notes         = res.notes;
            STATE.last_mutation = res.last_mutation;
            STATE.note_map      = res.note_map || STATE.note_map;
            
            const viewer = el ? el.querySelector('.note-text-viewer') : null;
            if (viewer && typeof formatNoteContent === 'function') {
                viewer.innerHTML = formatNoteContent(newContent, noteId);
            }
        }
    } catch (err) {
        console.error('Checkbox sync failed:', err);
        showToast('Failed to sync checkbox state', 'error');
    }
}

/**
 * Recycle Bin Fetch
 */
async function loadBin() {
    return await apiGet('/notes/api/bin');
}

/**
 * Restoration Engine
 */
async function restoreNote(id, canvas_id, layer_id, x, y) {
    return await apiPost('/notes/api/restore', { id, canvas_id, layer_id, x, y });
}

/**
 * Permanent Purge
 */
async function purgeNote(id) {
    return await apiPost('/notes/api/purge', { id: id });
}

/**
 * Canvas Management
 */
async function renameCanvas(canvas_id, name) {
    return await apiPost('/notes/api/canvases/rename', { canvas_id, name });
}

async function deleteCanvasApi(canvas_id) {
    return await apiPost('/notes/api/canvases/delete', { canvas_id });
}

async function createCanvas(name) {
    return await apiPost('/notes/api/canvases/create', { name });
}

/**
 * Sharing & ACL
 */
async function addShare(canvas_id, username) {
    const res = await apiPost('/notes/api/canvases/share', { canvas_id, username, can_edit: 1 });
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
    const res = await apiPost('/notes/api/canvases/share', { canvas_id: canvasId, username, can_edit: canEdit });
    if (res && res.success) {
        if (canvasId == STATE.canvas_id) {
            STATE.share_list = res.share_list;
        }
        showToast('Permissions updated', 'success');
    }
    return res;
}

async function revokeShare(canvasId, username) {
    const res = await apiPost('/notes/api/canvases/share', { canvas_id: canvasId, username, revoke: 1 });
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
    return await apiPost('/notes/api/canvases/share', params);
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
    const res = await apiPost('/notes/api/notes/copy', { id, canvas_id });
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
        const res = await apiPost('/notes/api/save', {
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
            is_collapsed: note.is_collapsed,
            layer_id: newLevelId
        });

        if (res && res.success) {
            STATE.notes         = res.notes;
            STATE.last_mutation = res.last_mutation;
            STATE.note_map      = res.note_map || STATE.note_map;
            showToast(`Note copied to Level ${newLevelId}`, 'success');
            
            // If we copied to the SAME level, re-render immediately.
            // If we copied to a DIFFERENT level, the note won't appear until we switch.
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
