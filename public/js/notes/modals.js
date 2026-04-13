// /public/js/notes/modals.js

/**
 * View Note Modal Lifecycle.
 * @param {number|string} id - The note ID.
 * @returns {void}
 */
function viewNote(id) {
    const note = STATE.notes.find(n => n.id == id);
    if (!note || note.type === 'image' || note.type === 'file') return;

    // Populate the pre element directly to preserve all whitespace
    document.getElementById('note-view-title').textContent = note.title || 'Untitled Note';
    const pre = document.getElementById('note-view-content');
    if (pre) {
        pre.textContent = note.content || '';
    }

    const modal = document.getElementById('note-view-modal');
    if (modal) {
        modal.classList.add('show');
        document.body.classList.add('modal-open');
    }
}

/**
 * Closes the view note modal.
 * @returns {void}
 */
function closeViewModal() {
    const modal = document.getElementById('note-view-modal');
    if (modal) {
        modal.classList.remove('show');
        document.body.classList.remove('modal-open');
    }
}

/**
 * Standard Creation Orchestrator: Finalizes the drafting action.
 * @returns {Promise<void>}
 */
async function executeCreateNote() {
    if (!DRAFT_NOTE) return;

    const { data, id } = DRAFT_NOTE;
    const titleInput   = document.getElementById('create-note-title');
    const editor       = document.getElementById('create-note-editor');

    const title   = titleInput?.value || 'Untitled Note';
    const content = editor?.value || '';
    const color   = document.getElementById('create-note-color')?.value || '#f59e0b';
    const note    = id ? STATE.notes.find(n => n.id == id) : null;

    if (id && !note) {
        showToast('Note no longer exists — it may have been deleted', 'error');
        closeCreateModal();
        return;
    }

    // Type Normalization: Type is derived from the ATTACHMENT if present, otherwise 'text'
    // This allows notes to have both text AND an attachment.
    const attachmentType = DRAFT_NOTE.type === 'text' ? (note?.type || 'text') : DRAFT_NOTE.type;
    const finalType      = attachmentType === 'text' ? 'text' : attachmentType;

    const wrapper = STATE.wrapperEl;
    if (!wrapper) return;
    const canvasCX = (wrapper.scrollLeft + wrapper.clientWidth / 2) / STATE.scale;
    const canvasCY = (wrapper.scrollTop + wrapper.clientHeight / 2) / STATE.scale;

    const coords = id ? {
        x: note.x,
        y: note.y,
        width: note.width,
        height: note.height,
        z_index: note.z_index,
        is_collapsed: note.is_collapsed
    } : {
        x: DRAFT_NOTE.x !== null ? DRAFT_NOTE.x : (Math.round(canvasCX / 10) * 10 - 140),
        y: DRAFT_NOTE.y !== null ? DRAFT_NOTE.y : (Math.round(canvasCY / 10) * 10 - 100),
        z_index: ++STATE.maxZ,
        is_collapsed: 0
    };

    const confirmBtn = document.getElementById('create-note-btn');
    const originalText = confirmBtn.innerHTML;
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = `⌛ Saving...`;

    try {
        // 1. Initial State Sync: Save text and metadata
        const params = {
            id,
            canvas_id: STATE.canvas_id,
            type: finalType,
            title,
            content,
            color,
            layer_id: STATE.activeLayerId,
            ...coords
        };

        const res = await NoteAPI.post('/notes/api/save', params);
        if (res && res.success) {
            const noteId = res.id;
            STATE.last_mutation = res.last_mutation;
            STATE.note_map      = res.note_map || STATE.note_map;

            // 2. Multi-File Persistence
            if (DRAFT_NOTE && DRAFT_NOTE.pendingFiles && DRAFT_NOTE.pendingFiles.length > 0) {
                for (const pending of DRAFT_NOTE.pendingFiles) {
                    const formData = new FormData();
                    formData.append('note_id', noteId);
                    formData.append('canvas_id', STATE.canvas_id);
                    
                    if (pending.file) {
                        formData.append('file', pending.file);
                    } else if (pending.data && pending.data.startsWith('data:')) {
                        // Convert data URL to Blob locally — do not pass a data: URI to NoteAPI.blob
                        // which expects an HTTP endpoint and cannot handle data: URIs.
                        try {
                            const res = await fetch(pending.data);
                            const blob = await res.blob();
                            const timestamp = new Date().getTime();
                            formData.append('file', blob, pending.filename || `paste_${timestamp}.png`);
                        } catch (dataUrlErr) {
                            console.warn('[executeCreateNote] data-URL to Blob conversion failed:', dataUrlErr);
                            continue;
                        }
                    }
                    
                    const uploadRes = await NoteAPI.post('/notes/api/upload', formData);
                    if (uploadRes && uploadRes.success) {
                        STATE.last_mutation = uploadRes.last_mutation;
                    }
                }
            }

            closeCreateModal();
            await loadState(false, STATE.canvas_id);
            showToast(id ? 'Note Updated' : 'Note Created', 'success');
        }
    } catch (err) {
        console.error('Execution Error:', err);
        showToast('Failed to save note', 'error');
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = originalText;
    }
}

/**
 * Drafting Modal Dismissal: Clear metadata state.
 * @returns {void}
 */
function closeCreateModal() {
    const modal = document.getElementById('note-create-modal');
    if (modal) {
        modal.classList.remove('show');
        modal.classList.remove('active');
        document.body.classList.remove('modal-open');
        DRAFT_NOTE = null;
        const titleInput = document.getElementById('create-note-title');
        if (titleInput) titleInput.value = '';
        const preview = document.getElementById('footer-attachment-preview');
        if (preview) preview.innerHTML = '';
    }
}

/**
 * PDF Viewer Logic
 */
function openPDFViewer(blobId, filename) {
    if (STATE.isInitializing) return;
    const modal = document.getElementById('pdf-viewer-modal');
    const frame = document.getElementById('pdf-frame');
    const title = document.getElementById('pdf-viewer-title');
    const dl    = document.getElementById('pdf-download-link');
    
    if (modal && frame) {
        const url = `/notes/attachment/serve/${blobId}`;
        frame.src = url;
        if (title) title.textContent = `📄 ${filename}`;
        if (dl) {
            dl.href = url;
            dl.setAttribute('download', filename);
        }
        modal.classList.add('show');
        document.body.classList.add('modal-open');
    }
}

function closePDFViewer() {
    const modal = document.getElementById('pdf-viewer-modal');
    const frame = document.getElementById('pdf-frame');
    if (modal) {
        modal.classList.remove('show');
        document.body.classList.remove('modal-open');
        if (frame) frame.src = ""; // Stop PDF from playing audio/resource in background
    }
}

/**
 * Image Visualization: Displays board attachments at full scale.
 */
function viewNoteImage(noteId, blobId) {
    if (STATE.isInitializing) return;
    const modal = document.getElementById('image-viewer-modal');
    const img   = document.getElementById('image-viewer-display');
    const title = document.getElementById('image-viewer-title');
    const dl    = document.getElementById('image-download-link');

    if (modal && img) {
        const url = blobId ? `/notes/attachment/serve/${blobId}` : `/notes/serve/${noteId}`;
        img.src   = url;
        
        const note = STATE.notes.find(n => n.id == noteId);
        let filename = (note && note.title) ? note.title : 'Image Preview';
        
        // If we are viewing a specific blob, find its actual filename
        if (blobId && note && note.attachments) {
            const att = note.attachments.find(a => a.blob_id == blobId);
            if (att && att.filename) filename = att.filename;
        }

        if (title) title.textContent = `🖼️ ${filename}`;
        if (dl) dl.href = url;

        modal.classList.add('show');
        document.body.classList.add('modal-open');
    }
}

function closeImageViewer() {
    const modal = document.getElementById('image-viewer-modal');
    if (modal) {
        modal.classList.remove('show');
        document.body.classList.remove('modal-open');
    }
}

/**
 * Level Renaming Engine: Allows users to assign a descriptive alias to an isolation layer.
 * @returns {void}
 */
function renameCurrentLevel() {
    const currentAlias = STATE.layer_map[STATE.activeLayerId] || '';
    
    // Permission Pre-flight: Check if user has edit access to the board
    const currentCanvas = STATE.canvases.find(c => c.id == STATE.canvas_id);
    if (currentCanvas && !currentCanvas.can_edit) {
        showToast('You do not have permission to rename levels on this board.', 'error');
        return;
    }

    window.showConfirmModal({
        title: 'Rename Level ' + STATE.activeLayerId,
        icon: '✏️',
        message: 'Enter a descriptive name for this level:',
        width: 'small',
        autoFocus: true,
        hideCancel: false, 
        input: {
            type: 'text',
            placeholder: 'Level Name (e.g. Household Admin)',
            value: currentAlias,
            maxLength: 100
        },
        confirmText: 'Save',
        onConfirm: async (newName) => {
            try {
                const res = await NoteAPI.post('/notes/api/layer/rename', {
                    canvas_id: STATE.canvas_id,
                    layer_id: STATE.activeLayerId,
                    name: newName.trim()
                });
                
                if (res && res.success) {
                    // Update global state and re-render display
                    STATE.layer_map = res.layer_map || {};
                    if (typeof updateLevelDisplay === 'function') updateLevelDisplay();
                    showToast('Level renamed successfully', 'success');
                } else {
                    showToast(res.error || 'Failed to rename level', 'error');
                }
            } catch (e) {
                console.error('Rename failure:', e);
                showToast('Network error during rename', 'error');
            }
        }
    });
}

/**
 * Search initialization: Opens the search interface.
 * @returns {void}
 */
function openSearchModal() {
    if (STATE.isInitializing) return;
    const modal = document.getElementById('note-search-modal');
    const input = document.getElementById('note-search-input');
    if (!modal || !input) return;

    input.value = '';
    modal.classList.add('show');
    
    // Populate with ALL available notes for the current canvas
    if (typeof filterSearch === 'function') filterSearch('');
    
    // Focus titration for immediate gesture interaction
    setTimeout(() => input.focus(), 100);
}

function closeSearchModal() {
    const modal = document.getElementById('note-search-modal');
    if (modal) {
        modal.classList.remove('show');
        document.body.classList.remove('modal-open');
    }
}

function openCanvasManager() {
    if (STATE.isInitializing) return;
    const modal = document.getElementById('canvas-manager-modal');
    if (modal) {
        renderCanvasList();
        modal.classList.add('active'); // Parity with notes.js (uses .active)
        modal.classList.add('show');
        document.body.classList.add('modal-open');
    }
}

/**
 * Populates the board list in the manager.
 */
function renderCanvasList() {
    const container = document.getElementById('canvas-list-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    STATE.canvases.forEach((canvas, index) => {
        const item = document.createElement('div');
        item.className = `canvas-item ${canvas.id == STATE.canvas_id ? 'active' : ''}`;
        item.draggable = true;
        item.dataset.index = index;
        
        const isOwner = canvas.is_owner;
        
        item.innerHTML = `
            <div class="canvas-drag-handle" title="Drag to reorder">⠿</div>
            <div class="canvas-info" data-canvas-id="${canvas.id}">
                <div class="canvas-name-row">
                    <span class="canvas-name">${escapeHtml(canvas.name)}</span>
                    ${+canvas.is_protected ? `
                        <span class="lock-status-icon clickable" 
                              data-canvas-id="${canvas.id}"
                              title="${STATE.unlockedCanvases.has(canvas.id) ? 'Unlock active (Click to Lock)' : 'Locked (Click to access)'}">
                            ${STATE.unlockedCanvases.has(canvas.id) ? '🔓' : '🔒'}
                        </span>
                    ` : ''}
                </div>
                <div class="canvas-meta">
                    ${isOwner ? 'Owned by you' : 'Shared by ' + (canvas.owner_name || 'System')}
                </div>
            </div>
            <div class="canvas-actions">
                ${isOwner ? `
                    <button class="btn-icon-square btn-sm btn-primary" data-action="settings" data-canvas-id="${canvas.id}" title="Board Settings">
                        ⚙️
                    </button>
                    ${canvas.name !== 'My Notebook' ? `
                        <button class="btn-icon-square btn-sm btn-danger" data-action="delete" data-canvas-id="${canvas.id}" title="Delete Board">
                            🗑️
                        </button>
                    ` : ''}
                ` : ''}
            </div>
        `;

        // Event Delegation for the item
        item.addEventListener('click', (e) => {
            const info     = e.target.closest('.canvas-info');
            const lock     = e.target.closest('.lock-status-icon');
            const settings = e.target.closest('[data-action="settings"]');
            const del      = e.target.closest('[data-action="delete"]');

            if (lock) {
                e.stopPropagation();
                if (STATE.unlockedCanvases.has(canvas.id)) {
                    if (typeof closeCanvasManager === 'function') closeCanvasManager();
                    apiLockCanvas(canvas.id);
                } else {
                    if (typeof closeCanvasManager === 'function') closeCanvasManager();
                    switchCanvas(canvas.id); // Initialize context transition for lock overlay visibility.
                }
                return;
            }

            if (settings) {
                e.stopPropagation();
                openBoardSettings(canvas.id);
                return;
            }

            if (del) {
                e.stopPropagation();
                deleteCanvas(e, canvas.id);
                return;
            }

            if (info) {
                switchCanvas(canvas.id);
            }
        });

        // ID-Based D&D Handshake
        item.ondragstart = (e) => {
            e.dataTransfer.setData('source-id', canvas.id);
            item.classList.add('is-dragging');
        };

        item.ondragend = () => {
            item.classList.remove('is-dragging');
            container.querySelectorAll('.canvas-item').forEach(el => el.classList.remove('drag-over'));
        };

        item.ondragover = (e) => {
            e.preventDefault();
            item.classList.add('drag-over');
        };

        item.ondragleave = () => {
            item.classList.remove('drag-over');
        };

        item.ondrop = (e) => {
            e.preventDefault();
            const sourceId = parseInt(e.dataTransfer.getData('source-id'));
            const targetId = canvas.id;
            
            if (sourceId === targetId) return;

            // Reconstruct array locally
            const sourceIndex = STATE.canvases.findIndex(c => c.id === sourceId);
            const targetIndex = STATE.canvases.findIndex(c => c.id === targetId);

            if (sourceIndex !== -1 && targetIndex !== -1) {
                const movedItem = STATE.canvases.splice(sourceIndex, 1)[0];
                STATE.canvases.splice(targetIndex, 0, movedItem);
                
                renderCanvasList();
                syncCanvasOrder();
            }
        };

        container.appendChild(item);
    });
}

/**
 * Persists the current board sequence to the database.
 */
async function syncCanvasOrder() {
    const orderMap = STATE.canvases.map((c, i) => ({ id: c.id, order: i }));
    await NoteAPI.post('/notes/api/canvases/reorder', orderMap);
}

/**
 * Switches the active whiteboard context.
 */
async function switchCanvas(id, targetNoteId = null) {
    if (id == STATE.canvas_id) {
        closeCanvasManager();
        return;
    }
    
    try {
        if (typeof saveViewportImmediate === 'function') {
            await saveViewportImmediate();
        }
        
        showLoadingOverlay('Cleaning canvas...');
        // Do not mutate STATE.canvas_id here; loadState resolves and assigns it
        // from the server response (data.canvas_id at line 888 of core.js).
        await loadState(true, id, targetNoteId);
        window.setupHeartbeat();
        // Persist the new context as the most recent immediately
        if (typeof saveViewportImmediate === 'function') await saveViewportImmediate();
        showToast('Switched board', 'success');
    } finally {
        hideLoadingOverlay();
        closeCanvasManager();
    }
}

/**
 * Orchestrates new board creation.
 */
async function createCanvas(name) {
    const res = await NoteAPI.post('/notes/api/canvases/create', { name });
    if (res && res.success) {
        document.getElementById('new-canvas-name').value = '';
        switchCanvas(res.id);
    }
}

/**
 * Owner-only board renaming.
 * @param {number} id - Canvas ID to rename.
 * @param {string} name - New board name.
 * @returns {Promise<void>}
 */
async function updateBoardName(id, name) {
    const res = await NoteAPI.post('/notes/api/canvases/rename', { canvas_id: id, name });
    if (res && res.success) {
        showToast('Board renamed successfully', 'success');
        
        if (id == STATE.canvas_id) {
            const pill = document.getElementById('active-board-name-pill');
            if (pill) pill.textContent = name;
        }

        await loadState(false, STATE.canvas_id);
        
        const modal = document.getElementById('canvas-settings-modal');
        if (modal) {
            modal.classList.remove('show');
            modal.classList.remove('active');
            document.body.classList.remove('modal-open');
            if (typeof openCanvasManager === 'function') openCanvasManager();
        }
    } else {
        showToast(res.error || 'Failed to rename board', 'error');
    }
}

/**
 * Owner-only board purging.
 */
async function deleteCanvas(e, id) {
    if (e) e.stopPropagation();

    // Use is_owner flag for robust ownership checking
    const ownedCanvases = STATE.canvases.filter(c => c.is_owner);
    if (ownedCanvases.length <= 1) {
        showToast('Retention Error: You must maintain at least one Notebook.', 'error');
        return;
    }
    
    window.showConfirmModal({
        title: 'Delete Board?',
        icon: '🗑️',
        message: 'This will permanently destroy all notes and images on this board. This action cannot be undone.',
        danger: true,
        hideCancel: true,
        confirmText: 'DELETE',
        confirmIcon: '🗑️',
        onConfirm: async () => {
            const res = await NoteAPI.post('/notes/api/canvases/delete', { canvas_id: id });
            if (res && res.success) {
                if (id == STATE.canvas_id) {
                    await loadState(true);
                } else {
                    await loadState(false, STATE.canvas_id);
                }
                renderCanvasList();
                showToast('Board destroyed', 'success');
            } else {
                throw new Error(res.error || 'Failed to destroy board');
            }
        }
    });
}

function closeCanvasManager() {
    const modal = document.getElementById('canvas-manager-modal');
    if (modal) {
        modal.classList.remove('show');
        modal.classList.remove('active');
        document.body.classList.remove('modal-open');
    }
}

function openMoveModal(e, id) {
    e.stopPropagation();
    const modal = document.getElementById('move-note-modal');
    const list  = document.getElementById('move-canvas-list');
    if (!modal || !list) return;
    
    list.innerHTML = '';
    STATE.canvases.filter(c => c.id != STATE.canvas_id && c.can_edit).forEach(canvas => {
        const item = document.createElement('div');
        item.className = 'canvas-item';
        item.onclick = () => copyNoteToBoard(id, canvas.id);
        item.innerHTML = `
            <div class="canvas-info">
                <div class="canvas-name-row">
                    <span class="canvas-name">${escapeHtml(canvas.name)}</span>
                </div>
                <div class="canvas-meta">Owned by ${escapeHtml(canvas.owner_name || 'System')}</div>
            </div>
            <div class="canvas-actions">
                <button class="btn-icon-square btn-sm btn-primary">
                    📦
                </button>
            </div>
        `;
        list.appendChild(item);
    });
    
    if (list.children.length === 0) {
        list.innerHTML = '<p class="empty-board-hint">No other editable boards found.</p>';
    }

    modal.classList.add('show');
    modal.classList.add('active');
}

function closeMoveModal() {
    const modal = document.getElementById('move-note-modal');
    if (modal) {
        modal.classList.remove('show');
        modal.classList.remove('active');
        document.body.classList.remove('modal-open');
    }
}

/**
 * Board Settings Orchestrator: Fetches fresh ACL data before opening UI.
 * @param {number} id - Board ID.
 */
async function openBoardSettings(id) {
    const modal = document.getElementById('canvas-settings-modal');
    if (!modal) return;
    
    // Refresh board state to ensure ACL/Share list is current
    const res = await NoteAPI.get(`/notes/api/state?canvas_id=${id}`);
    if (!res || !res.success) {
        showToast('Failed to fetch board settings', 'error');
        return;
    }

    const board = res.canvases.find(c => c.id == id);
    if (!board) return;
    
    // Pattern: Standardized Row Input with dynamic hydration
    // Handles Emoji Picker isolation and standard Rendler horizontal styling.
    const row = window.renderRowInput(document.getElementById('board-name-input-row'), {
        id: 'edit-canvas-name',
        value: board.name,
        placeholder: 'Board name...',
        buttonText: 'Save',
        buttonIcon: '💾'
    });
    
    if (row && row.button) {
        row.button.dataset.canvasId = board.id;
        row.button.onclick = () => updateBoardName(id, row.input.value);
    }
    
    const userSearchInput = document.getElementById('user-search-input');
    if (userSearchInput) {
        userSearchInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                addUserToBoard(id, userSearchInput.value);
                userSearchInput.value = '';
            }
        };
    }

    renderShareList(id, res.share_list);
    renderBoardSecurity(board);
    
    // Idempotent Listener Management: Clear old listeners before re-attaching.
    const container = document.getElementById('board-security-content');
    if (container) {
        container.removeEventListener('click', handleSecurityPanelClick);
        container.addEventListener('click', handleSecurityPanelClick);
    }
    
    modal.classList.add('show');
    modal.classList.add('active');
    document.body.classList.add('modal-open');
}

/**
 * Privacy Management UI: Populates the Security tab with password controls.
 */
function renderBoardSecurity(board) {
    const container = document.getElementById('board-security-content');
    if (!container) return;

    if (!board.is_protected) {
        container.innerHTML = `
            <div class="security-item">
                <h5>Enable Password Protection</h5>
                <p>Set a password to lock this board. Required for everyone, including you.</p>
                <div class="settings-vertical-stack">
                    <input type="password" id="new-security-pass" placeholder="New password..." class="create-modal-input">
                    <input type="password" id="confirm-security-pass" placeholder="Confirm password..." class="create-modal-input">
                    <button class="btn-primary" data-action="set" data-canvas-id="${board.id}">🔒 Set Password</button>
                </div>
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="security-item">
                <h5>Change Password</h5>
                <div class="settings-vertical-stack">
                    <input type="password" id="cur-security-pass" placeholder="Current password..." class="create-modal-input">
                    <input type="password" id="new-security-pass" placeholder="New password..." class="create-modal-input">
                    <input type="password" id="confirm-security-pass" placeholder="Confirm new password..." class="create-modal-input">
                    <button class="btn-primary" data-action="update" data-canvas-id="${board.id}">🔄 Update Password</button>
                </div>
            </div>
            <div class="security-item">
                <h5>Remove Protection</h5>
                <p>Clear the password to make this board publicly accessible to your collaborators.</p>
                <div class="settings-vertical-stack">
                    <input type="password" id="clear-security-pass" placeholder="Confirm with current password..." class="create-modal-input">
                    <button class="btn-danger" data-action="clear" data-canvas-id="${board.id}">🔓 Remove Password</button>
                </div>
            </div>
        `;
    }
}

/**
 * Event Delegation for Security Panel: Replaces inline onclick handlers for CSP compliance.
 */
function handleSecurityPanelClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    
    const canvasId = btn.dataset.canvasId;
    const action   = btn.dataset.action;
    
    if (action === 'set')         setBoardPassword(canvasId, false);
    else if (action === 'update') setBoardPassword(canvasId, true);
    else if (action === 'clear')  clearBoardPassword(canvasId);
}

async function setBoardPassword(canvasId, isUpdate = false) {
    const newPass = document.getElementById('new-security-pass')?.value;
    const confirm = document.getElementById('confirm-security-pass')?.value;
    const oldPass = document.getElementById('cur-security-pass')?.value;

    if (!newPass || newPass.length < 1) return showToast('Password cannot be empty', 'error');
    if (newPass !== confirm) return showToast('Passwords do not match', 'error');
    if (isUpdate && !oldPass) return showToast('Current password required to verify authority', 'error');

    const params = { canvas_id: canvasId, password: newPass };
    if (isUpdate) params.old_password = oldPass;

    showLoadingOverlay('Securing board...');
    try {
        const res = await NoteAPI.post('/notes/api/canvas/password/set', params);
        if (res && res.success) {
            showToast('Privacy settings updated', 'success');
            
            // State Invalidation: Force full fetch on next heartbeat/load
            STATE.note_map_hash = null;
            // Local State Sync: Reflect self-unlock immediately
            STATE.unlockedCanvases.add(parseInt(canvasId));

            // Optimization: Contextual alignment of the settings modal
            const board = STATE.canvases.find(c => c.id == canvasId);
            if (board) {
                board.is_protected = true;
                renderBoardSecurity(board);
            }
            renderCanvasList(); 
        } else {
            showToast((res && res.error) || 'Failed to update password', 'error');
        }
    } finally {
        hideLoadingOverlay();
    }
}

async function clearBoardPassword(canvasId) {
    const pass = document.getElementById('clear-security-pass')?.value;
    if (!pass) return showToast('Password required to verify intent', 'error');

    showLoadingOverlay('Removing protection...');
    try {
        const res = await NoteAPI.post('/notes/api/canvas/password/clear', { canvas_id: canvasId, password: pass });
        if (res && res.success) {
            showToast('Protection removed', 'success');
            
            // Optimization: Architectural alignment
            const board = STATE.canvases.find(c => c.id == canvasId);
            if (board) {
                board.is_protected = false;
                renderBoardSecurity(board);
            }

            // State Maintenance: Cleanup stale ID from the unlock set
            STATE.unlockedCanvases.delete(parseInt(canvasId));
            // Delta Synchronization: Invalidate fingerprint to force full fetch
            STATE.note_map_hash = null;
            // UI Synchronization: Maintain consistency between board state and the visual list.
            if (parseInt(canvasId) === STATE.canvas_id && typeof window.loadState === 'function') {
                try {
                    // Preservation: Pass activeLayerId to prevent silent viewport resets
                    await window.loadState(false, STATE.canvas_id, null, STATE.activeLayerId);
                } catch (loadErr) {
                    console.warn('clearBoardPassword: state refresh failed post-clear:', loadErr.message);
                    renderCanvasList();
                }
            } else {
                renderCanvasList();
            }
        } else {
            showToast((res && res.error) || 'Failed to clear password', 'error');
        }
    } finally {
        hideLoadingOverlay();
    }
}

/**
 * ACL Discovery Engine: Facilitates adding new collaborators to a board.
 */
async function addUserToBoard(canvasId, username) {
    const res = await NoteAPI.post('/notes/api/canvases/share', { canvas_id: canvasId, username, can_edit: 1 });
    if (res && res.success) {
        if (canvasId == STATE.canvas_id) STATE.share_list = res.share_list;
        renderShareList(canvasId, res.share_list);
        showToast('Shared successfully', 'success');
    }
}

async function updateSharePermission(canvasId, username, canEdit) {
    const res = await NoteAPI.post('/notes/api/canvases/share', { canvas_id: canvasId, username, can_edit: canEdit });
    if (res && res.success) {
        if (canvasId == STATE.canvas_id) STATE.share_list = res.share_list;
        showToast('Permissions updated', 'success');
    }
}

function confirmRevoke(canvasId, username) {
    window.showConfirmModal({
        title: 'Revoke Access',
        message: `Are you sure you want to revoke access for <strong>${username}</strong>?`,
        subMessage: 'They will immediately lose all permissions to this board.',
        icon: '🗑️',
        danger: true,
        hideCancel: true,
        confirmText: 'DELETE',
        confirmIcon: '🗑️',
        onConfirm: async () => {
            const res = await NoteAPI.post('/notes/api/canvases/share', { canvas_id: canvasId, username, revoke: 1 });
            if (res && res.success) {
                if (canvasId == STATE.canvas_id) STATE.share_list = res.share_list;
                renderShareList(canvasId, res.share_list);
                showToast('Access revoked', 'info');
            }
        }
    });
}

function closeBoardSettings() {
    const modal = document.getElementById('canvas-settings-modal');
    if (modal && (modal.classList.contains('show') || modal.classList.contains('active'))) {
        modal.classList.remove('show');
        modal.classList.remove('active');
        document.body.classList.remove('modal-open');
        // Return to Canvas Manager for continuity
        if (typeof openCanvasManager === 'function') openCanvasManager();
    }
}

function openBinModal() {
    if (STATE.isInitializing) return;
    const modal = document.getElementById('note-bin-modal');
    if (modal) {
        renderBinList();
        modal.classList.add('active'); // Parity with notes.js (uses .active)
        modal.classList.add('show');
        document.body.classList.add('modal-open');
    }
}

function closeBinModal() {
    const modal = document.getElementById('note-bin-modal');
    if (modal) {
        modal.classList.remove('show');
        modal.classList.remove('active');
        document.body.classList.remove('modal-open');
    }
}

function copyViewContent() {
    const content = document.getElementById('note-view-content')?.textContent;
    if (content) {
        navigator.clipboard.writeText(content);
        showToast('Content copied to clipboard', 'success');
    }
}

/**
 * Displays a tabbed information modal explaining whiteboard features.
 * Tabs: Formatting | Links & Embeds | Bookmarks | Controls
 * Tab switching is handled via delegated click on #globalConfirmModalContent
 * using data-action="guide-tab" — no inline handlers.
 * @returns {void}
 */
function showBoardInfo() {
    const helpContent = `
        <nav class="guide-tab-nav">
            <button class="guide-tab-btn active" data-action="guide-tab" data-tab="controls">⌨️ Controls</button>
            <button class="guide-tab-btn" data-action="guide-tab" data-tab="formatting">✏️ Formatting</button>
            <button class="guide-tab-btn" data-action="guide-tab" data-tab="embeds">🔗 Links &amp; Embeds</button>
            <button class="guide-tab-btn" data-action="guide-tab" data-tab="bookmarks">🔖 Bookmarks</button>
        </nav>

        <div class="guide-tab-panel active" data-panel="controls">
            <p class="board-guide-subheading">Canvas</p>
            <ul class="board-guide-list">
                <li><strong>Double-click canvas</strong> — Create a new note at cursor</li>
                <li><strong>Double-click note</strong> — Pick up and move it (edit mode only)</li>
                <li><strong>Click &amp; drag</strong> — Pan the board</li>
                <li><strong>Mouse Wheel</strong> — Pan vertically</li>
                <li><strong>Shift + Wheel</strong> — Pan horizontally</li>
                <li><strong>Ctrl + Wheel</strong> — Zoom in / out (anchored to cursor)</li>
                <li><strong>Ctrl+V</strong> — Paste image or file as a new note</li>
                <li><strong>Pinch (touch)</strong> — Zoom in / out</li>
            </ul>
            <p class="board-guide-subheading">Keyboard</p>
            <ul class="board-guide-list">
                <li><strong>Ctrl+F</strong> — Open board search</li>
                <li><strong>Ctrl+E</strong> — Toggle edit mode on hovered note / exit if already editing</li>
                <li><strong>Ctrl+S</strong> — Save active note (incremental while editing)</li>
                <li><strong>Ctrl+Enter</strong> — Save and exit edit mode</li>
                <li><strong>Escape</strong> — Discard changes &amp; exit / cancel move / close modals</li>
            </ul>
        </div>

        <div class="guide-tab-panel" data-panel="formatting">
            <div class="guide-cheatsheet">
                <code class="guide-cs-code"># Header</code>     <span class="guide-cs-preview"><strong style="font-size: 1.1rem;">Header</strong></span>
                <code class="guide-cs-code">## Sub</code>       <span class="guide-cs-preview"><strong style="font-size: 0.9rem;">Sub</strong></span>
                <code class="guide-cs-code">**Bold**</code>       <span class="guide-cs-preview"><strong>Bold</strong></span>
                <code class="guide-cs-code">*Italic*</code>       <span class="guide-cs-preview"><em>Italic</em></span>
                <code class="guide-cs-code">~~Strike~~</code>     <span class="guide-cs-preview"><del>Strike</del></span>
                <code class="guide-cs-code">\`code\`</code>        <span class="guide-cs-preview"><code class="guide-cs-inline">code</code></span>
                <code class="guide-cs-code">- item</code>         <span class="guide-cs-preview">• Bullet</span>
                <code class="guide-cs-code">1. item</code>        <span class="guide-cs-preview">1. Number</span>
                <code class="guide-cs-code">- [ ] / [x]</code>   <span class="guide-cs-preview">☐ / ☑ Checklist</span>
                <code class="guide-cs-code">---</code>            <span class="guide-cs-preview"><span class="guide-cs-hr"></span></span>
            </div>

            <p class="board-guide-subheading board-guide-subheading--spaced">Advanced Components</p>
            <div class="guide-cheatsheet">
                <code class="guide-cs-code">[size:lg]...[/size]</code> <span class="guide-cs-preview" style="font-size: 1.1rem;">Large</span>
                <code class="guide-cs-code">[bg:hex]...[/bg]</code>     <span class="guide-cs-preview"><span style="background: #f59e0b; color: #000; padding: 0 4px; border-radius: 3px;">Highlight</span></span>
                <code class="guide-cs-code">[progress:75|Label]</code>  <span class="guide-cs-preview">Progress Bar</span>
                <code class="guide-cs-code">[date:YYYY-MM-DD]</code>    <span class="guide-cs-preview">📅 Date Tag</span>
                <code class="guide-cs-code">[tag:Label|color]</code>    <span class="guide-cs-preview"><span class="note-badge badge-info" style="margin:0;">Tag</span></span>
                <code class="guide-cs-code">[divider:Title]</code>      <span class="guide-cs-preview">Labelled HR</span>
                <code class="guide-cs-code">[spoiler:Title]...[/spoiler]</code> <span class="guide-cs-preview">Accordion</span>
            </div>

            <p class="board-guide-subheading board-guide-subheading--spaced">[color:name]text[/color]</p>
            <div class="guide-color-swatches">
                <span class="guide-color-swatch"><span class="guide-color-dot guide-color-dot--yellow"></span>yellow</span>
                <span class="guide-color-swatch"><span class="guide-color-dot guide-color-dot--orange"></span>orange</span>
                <span class="guide-color-swatch"><span class="guide-color-dot guide-color-dot--red"></span>red</span>
                <span class="guide-color-swatch"><span class="guide-color-dot guide-color-dot--pink"></span>pink</span>
                <span class="guide-color-swatch"><span class="guide-color-dot guide-color-dot--green"></span>green</span>
                <span class="guide-color-swatch"><span class="guide-color-dot guide-color-dot--blue"></span>blue</span>
                <span class="guide-color-swatch"><span class="guide-color-dot guide-color-dot--indigo"></span>indigo</span>
                <span class="guide-color-swatch"><span class="guide-color-dot guide-color-dot--violet"></span>violet</span>
                <span class="guide-color-swatch"><span class="guide-color-dot guide-color-dot--slate"></span>slate</span>
                <span class="guide-color-swatch"><span class="guide-color-dot guide-color-dot--hex"></span>#HEX</span>
            </div>
        </div>

        <div class="guide-tab-panel" data-panel="embeds">
            <p class="board-guide-subheading">Link to other notes</p>
            <ul class="board-guide-list">
                <li><strong>[note:ID]</strong> — Jump link to another note</li>
                <li><strong>[image:ID]</strong> — Embed an image note inline</li>
                <li><strong>[file:ID]</strong> — Embed a file download</li>
            </ul>
            <p class="board-guide-subheading">External links</p>
            <ul class="board-guide-list">
                <li>Paste any <strong>https://…</strong> URL — it becomes a clickable link automatically</li>
                <li><strong>[link:url|Label]</strong> — Link with custom display text</li>
                <li><strong>[Label](url)</strong> — Alternative compact link format</li>
                <li><strong>[iframe:url|height]</strong> — Embed an external webpage inline</li>
            </ul>
        </div>

        <div class="guide-tab-panel" data-panel="bookmarks">
            <p class="board-guide-subheading">What is a bookmark note?</p>
            <ul class="board-guide-list">
                <li>Write every line as <strong>Label | URL</strong> and the note becomes a visual bookmark tile list</li>
                <li>Add a leading emoji to use it as the icon — e.g. <strong>🏠 Home | https://…</strong></li>
            </ul>
            <p class="board-guide-subheading">Optional extras</p>
            <ul class="board-guide-list">
                <li><strong>Label | URL | iconURL</strong> — Use a custom icon image</li>
                <li>Add <strong>[emoji]:1</strong> anywhere in the note to force emoji icons on every tile</li>
            </ul>
        </div>
    `;

    window.showConfirmModal({
        title: 'Guide',
        icon: 'ℹ️',
        message: helpContent,
        confirmText: '🎉 Got it',
        hideCancel: true,
        width: 'large'
    });

    // Delegated tab switching: wired after showConfirmModal renders the DOM synchronously.
    const modalContent = document.getElementById('globalConfirmModalContent');
    if (!modalContent) return;

    modalContent.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="guide-tab"]');
        if (!btn) return;

        const tab = btn.dataset.tab;

        modalContent.querySelectorAll('.guide-tab-btn').forEach(b => b.classList.remove('active'));
        modalContent.querySelectorAll('.guide-tab-panel').forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        const panel = modalContent.querySelector(`.guide-tab-panel[data-panel="${tab}"]`);
        if (panel) panel.classList.add('active');
    });
}

/**
 * Triggers the 'Jump to Level' global modal prompt.
 * Allows the user to rapidly navigate to any numeric isolation level.
 * @returns {void}
 */
function openJumpToLevelModal() {
    const activeLevel = parseInt(STATE.activeLayerId);
    
    // Internal: Shared Modal Cleanup Engine
    const cleanupModal = () => {
        const modalContent = document.getElementById('globalConfirmModalContent');
        if (modalContent) {
            const injection = modalContent.querySelector('.level-navigator-injection');
            if (injection) injection.remove();
        }
    };

    // 1. Data Aggregation: Calculate note counts for each level used in the current canvas
    const levelStats = {};
    (STATE.notes || []).forEach(n => {
        const lid = parseInt(n.layer_id);
        levelStats[lid] = (levelStats[lid] || 0) + 1;
    });

    // 2. Structure Discovery: Combine populated levels AND levels with aliases (Names)
    const discoverySet = new Set(Object.keys(levelStats).map(id => parseInt(id)));
    // Include any levels from the layer_map that have defined names/aliases
    Object.keys(STATE.layer_map || {}).forEach(id => {
        const lid = parseInt(id);
        if (STATE.layer_map[id]) discoverySet.add(lid);
    });

    // 3. Extraction: Exclude the active level and sort
    const targetLevels = Array.from(discoverySet)
        .filter(id => id != activeLevel)
        .sort((a, b) => a - b);

    window.showConfirmModal({
        title: 'Jump to Level',
        icon: '📚',
        message: 'Select a layer to navigate to:',
        width: 'small',
        hideCancel: true,
        noEmoji: true,
        autoFocus: true,
        onCancel: cleanupModal
    });

    // Interaction UX: Align Go button with the numeric input using the global helper
    const promptContainer = document.getElementById('globalConfirmPromptContainer');
    const actionsContainer = document.getElementById('globalConfirmModalActions');

    if (promptContainer && actionsContainer) {
        actionsContainer.classList.add('hidden');
        
        const row = window.renderRowInput(promptContainer, {
            id: 'jump-level-input',
            placeholder: 'Level #...',
            buttonText: 'Go',
            buttonIcon: '➤',
            noEmoji: true // Navigation is numeric
        });
        
        if (row && row.button) {
            const submitLevel = () => {
                const val = row.input.value;
                const level = Math.floor(Math.abs(parseInt(val)));
                if (!isNaN(level) && level >= 1 && level <= 99) {
                    cleanupModal();
                    if (typeof window.switchLevel === 'function') window.switchLevel(level);
                    window.closeConfirmModal();
                } else {
                    showToast('Valid level # required', 'error');
                }
            };
            row.button.onclick = submitLevel;
            row.input.type = 'number';
            row.input.min = 1;
            row.input.max = 99;
            row.input.onkeydown = (e) => { 
                if (e.key === 'Enter') { 
                    e.preventDefault(); 
                    submitLevel(); 
                } 
            };
        }
    }

    // High-Fidelity Navigation: Inject the Vertical Card List
    if (targetLevels.length > 0) {
        const modalContent = document.getElementById('globalConfirmModalContent');
        if (modalContent) {
            const existing = modalContent.querySelector('.level-navigator-injection');
            if (existing) existing.remove();

            const injection = document.createElement('div');
            injection.className = 'level-navigator-injection';
            
            let listHtml = '<div class="level-list-container">';
            targetLevels.forEach(id => {
                const alias = STATE.layer_map[id];
                const count = levelStats[id] || 0;
                listHtml += `
                    <div class="level-item" onclick="(${cleanupModal.toString()})(); if (typeof window.switchLevel === 'function') window.switchLevel(${id}); window.closeConfirmModal();">
                        <div class="level-icon-stack">${count > 0 ? '📚' : '📄'}</div>
                        <div class="level-info-main">
                            <span class="level-title-row">Level ${id} ${alias ? `— ${window.escapeHtml(alias)}` : ''}</span>
                            <span class="level-meta-row">${count > 0 ? `${count} ${count === 1 ? 'note' : 'notes'} on this layer` : 'No notes yet'}</span>
                        </div>
                        <div class="level-jump-arrow">❯</div>
                    </div>
                `;
            });
            listHtml += '</div>';

            injection.innerHTML = `<hr class="modal-divider-short">${listHtml}`;
            promptContainer.parentNode.appendChild(injection);
        }
    }
}

/**
 * Renders the collaborators for a specific board into the settings modal.
 */
function renderShareList(id, shares = null) {
    const shareList = document.getElementById('canvas-share-list');
    if (!shareList) return;

    shareList.innerHTML = '';
    const targetList = shares || STATE.share_list;
    
    targetList.forEach(share => {
        const item = document.createElement('div');
        item.className = 'share-item';
        item.innerHTML = `
            <div class="share-user-info">
                <span class="user-icon-pill">${window.getUserIcon(share.username)}</span>
                <span class="share-username">${window.escapeHtml(share.username)}</span>
            </div>
            <div class="share-actions">
                <div class="permission-toggle-group">
                    <span class="permission-label">Edit Access</span>
                    <label class="switch">
                        <input type="checkbox" ${share.can_edit ? 'checked' : ''}
                               data-canvas-id="${id}" data-username="${window.escapeHtml(share.username)}">
                        <span class="slider"></span>
                    </label>
                </div>
                <button class="btn-icon-delete" data-canvas-id="${id}" data-username="${window.escapeHtml(share.username)}" title="Revoke Access">
                    🗑️
                </button>
            </div>
        `;

        const checkbox = item.querySelector('input[type="checkbox"]');
        if (checkbox) {
            checkbox.addEventListener('change', function() {
                if (typeof updateSharePermission === 'function') {
                    updateSharePermission(this.dataset.canvasId, this.dataset.username, this.checked ? 1 : 0);
                }
            });
        }

        const revokeBtn = item.querySelector('.btn-icon-delete');
        if (revokeBtn) {
            revokeBtn.addEventListener('click', function() {
                if (typeof confirmRevoke === 'function') {
                    confirmRevoke(this.dataset.canvasId, this.dataset.username);
                }
            });
        }

        shareList.appendChild(item);
    });
}

let SEARCH_DEBOUNCE_TIMER = null;
let CURRENT_SEARCH_RESULTS = [];

/**
 * Discovery Engine: Orchestrates local filtering or global board-wide search.
 */
async function filterSearch(queryText) {
    const globalToggle = document.getElementById('search-global-toggle');
    const query = queryText.trim();
    const isGlobal = globalToggle && globalToggle.checked;

    clearTimeout(SEARCH_DEBOUNCE_TIMER);

    if (query === '') {
        renderSearchResults(STATE.notes, false);
        return;
    }

    SEARCH_DEBOUNCE_TIMER = setTimeout(async () => {
        if (isGlobal) {
            const data = await NoteAPI.get(`/notes/api/search?q=${encodeURIComponent(query)}`);
            renderSearchResults(data || [], true);
        } else {
            const q = query.toLowerCase();
            const results = (STATE.notes || []).filter(n => 
                (n.title && n.title.toLowerCase().includes(q)) || 
                (n.content && n.content.toLowerCase().includes(q)) ||
                (n.filename && n.filename.toLowerCase().includes(q))
            );
            renderSearchResults(results, false);
        }
    }, 250);
}

/**
 * Result Rendering Engine: Generates the search result grid with board context.
 */
function renderSearchResults(results, isGlobal) {
    const container = document.getElementById('search-results-container');
    if (!container) return;

    CURRENT_SEARCH_RESULTS = results || [];

    if (CURRENT_SEARCH_RESULTS.length === 0) {
        container.innerHTML = `
            <div class="search-empty-state">
                <span class="global-icon">🔍</span>
                <p>No matches found in ${isGlobal ? 'any of your whiteboards' : 'the current board'}</p>
            </div>
        `;
        return;
    }

    container.innerHTML = CURRENT_SEARCH_RESULTS.map(note => `
        <div class="search-result-item" style="--note-accent: ${note.color || '#3b82f6'}" onclick="handleSearchResultClick(${note.id})">
            <div class="search-result-icon">
                <span class="global-icon">${note.type === 'image' ? '🖼️' : note.type === 'file' ? '📁' : '✏️'}</span>
            </div>
            <div class="search-result-info">
                <div class="search-result-path">
                    📓 ${window.escapeHtml(note.canvas_name || 'Board')} 
                    <span class="path-separator">❯</span> 
                    Level ${note.layer_id || 1}${note.layer_alias ? ` - ${window.escapeHtml(note.layer_alias)}` : ''} 
                </div>
                <div class="search-result-title">${window.escapeHtml(note.title || 'Untitled Note')}</div>
                <div class="search-result-snippet">${window.escapeHtml(note.content || note.filename || '').substring(0, 80)}${(note.content || note.filename || '').length > 80 ? '...' : ''}</div>
            </div>
            <div class="search-result-action">
                <span class="global-icon">▶️</span>
            </div>
        </div>
    `).join('');
}

/**
 * Search Outcome Orchestrator: Transition across boards and center on the target note.
 */
async function handleSearchResultClick(id) {
    const note = (CURRENT_SEARCH_RESULTS || []).find(n => n.id == id);
    if (!note) return;

    closeSearchModal();
    
    try {
        if (note.canvas_id && note.canvas_id != STATE.canvas_id) {
            if (typeof switchCanvas === 'function') await switchCanvas(note.canvas_id, id);
        } else {
            if (typeof centerOnNote === 'function') await centerOnNote(id);
        }
    } catch (err) {
        console.error('Navigation Error:', err);
    }
}

/**
 * Level Migration Orchestrator: UI for copying a note across the 99-level isolation stack.
 * @param {number|string} id - The note ID.
 */
function openLayerActionModal(id) {
    const note = STATE.notes.find(n => n.id == id);
    if (!note) return;

    window.showConfirmModal({
        title: `Copy to Level`,
        icon: '📚',
        message: 'Select a target level (1-99) to clone this note into:',
        input: {
            type: 'number',
            min: 1,
            max: 99,
            value: STATE.activeLayerId,
            placeholder: 'Level Number...'
        },
        confirmText: "Clone to Level",
        onConfirm: async (targetLevel) => {
            const level = parseInt(targetLevel);
            if (isNaN(level) || level < 1 || level > 99) {
                showToast("Invalid level number", "error");
                return;
            }
            if (typeof copyNoteToLevel === 'function') {
                await copyNoteToLevel(id, level);
            } else {
                showToast('Duplication Engine unavailable', 'error');
            }
        }
    });
}

/**
 * ACL Discovery Engine: Facilitates adding new collaborators to a board.
 */
function setupUserSearch() {
    const input = document.getElementById('user-search-input');
    if (!input) return;

    let debounce = null;
    input.addEventListener('input', (e) => {
        clearTimeout(debounce);
        const query = e.target.value.trim();
        if (query.length < 2) {
            document.getElementById('user-search-results').classList.add('hidden');
            return;
        }

        debounce = setTimeout(async () => {
            const data = await NoteAPI.get(`/notes/api/users/search?q=${encodeURIComponent(query)}`);
            const users = Array.isArray(data) ? data : (data.users || []);
            
            const resultsWrap = document.getElementById('user-search-results');
            resultsWrap.innerHTML = '';
            resultsWrap.classList.remove('hidden');

            if (users.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'search-result-item no-click';
                empty.style.justifyContent = 'center';
                empty.style.color = 'var(--text-dim)';
                empty.textContent = 'No users found';
                resultsWrap.appendChild(empty);
                return;
            }

            users.forEach(user => {
                const item = document.createElement('div');
                item.className = 'search-result-item';
                item.innerHTML = `<span class="user-icon-pill">${window.getUserIcon(user.username)}</span> ${user.username}`;
                item.onclick = () => {
                    const canvasId = document.getElementById('save-canvas-name-btn')?.dataset.canvasId;
                    addUserToBoard(canvasId || STATE.canvas_id, user.username);
                    resultsWrap.classList.add('hidden');
                    input.value = '';
                };
                resultsWrap.appendChild(item);
            });
        }, 300);
    });
}

/**
 * Recycler Rendering Engine: Populates the deleted-note recovery interface.
 */
async function renderBinList() {
    const container = document.getElementById('bin-results-container');
    if (!container) return;

    container.innerHTML = `<div class="loading-bin">⌛ Retrieving archived notes...</div>`;

    try {
        const data = await NoteAPI.get(`/notes/api/bin?canvas_id=${STATE.canvas_id}`);

        if (!data.success || !data.notes || data.notes.length === 0) {
            container.innerHTML = `
                <div class="bin-empty">
                    <span class="bin-icon">📭</span>
                    <p>Your recycle bin is empty</p>
                </div>
            `;
            return;
        }

        container.innerHTML = data.notes.map(note => {
            // Parity with notes.js: Normalize color and use updated_at as deletion timestamp
            const accentColor = (typeof normalizeColorHex === 'function') ? normalizeColorHex(note.color) : (note.color || '#3b82f6');
            const deletionDate = note.updated_at ? new Date(note.updated_at).toLocaleDateString() : 'Unknown Date';
            
            return `
                <div class="bin-item" style="--note-accent: ${accentColor}">
                    <div class="bin-item-icon">${note.type === 'image' ? '🖼️' : note.type === 'file' ? '📁' : '📄'}</div>
                    <div class="bin-item-info">
                        <div class="bin-item-title">${window.escapeHtml(note.title || 'Untitled Note')}</div>
                        <div class="bin-item-meta">
                            <span class="bin-item-board-badge">📂 ${window.escapeHtml(note.canvas_name || 'Deleted Board')}</span>
                            <span>Deleted ${deletionDate} • Level ${note.layer_id}</span>
                        </div>
                    </div>
                    <div class="bin-item-actions">
                        <button class="btn-icon-square btn-success" onclick="restoreNote(${note.id})" title="Restore Note">
                            🔄
                        </button>
                        <button class="btn-icon-square btn-danger" onclick="confirmNotePurge(${note.id})" title="Permanently Delete">
                            🗑️
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        container.innerHTML = '<div class="bin-error">Failed to load recycle bin</div>';
    }
}
/**
 * Unified Creation Modal
 * @param {string} type - Note type.
 * @param {string|null} data - Initial content or data URL.
 * @param {number|string|null} editId - Optional ID if editing.
 * @returns {Promise<void>}
 */
async function showCreateNoteModal(type, data, editId = null, initialText = null, filename = null, coords = null) {
    const modal       = document.getElementById('note-create-modal');
    const container   = document.getElementById('create-note-content');
    const titleInput  = document.getElementById('create-note-title');
    const headerLabel = document.getElementById('draft-header-label');
    const btnIcon     = document.getElementById('draft-btn-icon');
    const btnText     = document.getElementById('draft-btn-text');
    const colorPicker = document.getElementById('create-note-color');
    const colorHex    = document.getElementById('create-note-color-hex');

    if (!modal || !container || !titleInput) return;


    container.innerHTML = '';
    DRAFT_NOTE = { 
        type, 
        data, 
        id: editId, 
        pendingFiles: [],
        x: coords ? coords.x : null,
        y: coords ? coords.y : null
    };
    
    // Clipboard Lifecycle: If we are pasting an image, populate the pending queue immediately
    if (type === 'image' && data) {
        DRAFT_NOTE.pendingFiles.push({ 
            type: 'image', 
            data: data, 
            filename: filename || 'pasted_image.png' 
        });
    }

    let note = null;
    if (editId) {
        note = STATE.notes.find(n => n.id == editId);
        if (!note) return;
        if (headerLabel) headerLabel.textContent = 'Edit Note';
        if (btnText)     btnText.textContent     = 'Save';
        if (btnIcon)     btnIcon.innerHTML       = '💾';
        titleInput.value = note.title || '';
        if (colorPicker) colorPicker.value = (typeof normalizeColorHex === 'function') ? normalizeColorHex(note.color) : (note.color || '#f59e0b');
        if (colorHex)    colorHex.value    = colorPicker.value.toUpperCase();
    } else if (data && typeof data === 'string') {
        if (headerLabel) headerLabel.textContent = 'Paste from Clipboard';
        if (btnText)     btnText.textContent     = 'Save';
        if (btnIcon)     btnIcon.innerHTML       = '💾';
        titleInput.value = (type === 'text' ? 'Pasted Note' : 'Pasted Image');
        if (colorPicker) colorPicker.value = '#f59e0b';
        if (colorHex)    colorHex.value    = '#F59E0B';
    } else {
        if (headerLabel) headerLabel.textContent = 'Add New Note';
        if (btnText)     btnText.textContent     = 'Save';
        if (btnIcon)     btnIcon.innerHTML       = '💾';
        titleInput.value = '';
        titleInput.placeholder = (type === 'text' ? 'Note Title...' : 'Image Title...');
        if (colorPicker) colorPicker.value = '#f59e0b';
        if (colorHex)    colorHex.value    = '#F59E0B';
    }

    // Always create a text editor with elastic height (grows with content)
    const editor = document.createElement('textarea');
    editor.className = 'create-preview-text';
    editor.id        = 'create-note-editor';
    editor.spellcheck = false;
    editor.placeholder = 'Start typing your thoughts...';
    
    // Elastic Engine: Adjust height on every change
    const autoResize = () => {
        editor.style.height = 'auto'; // Reset to calculate true height
        editor.style.height = editor.scrollHeight + 'px';
    };
    editor.addEventListener('input', autoResize);
    
    if (note) {
        editor.value = note.content || '';
    } else if (data && typeof data === 'string' && type === 'text') {
        editor.value = data;
    } else if (initialText) {
        editor.value = initialText;
    }

    container.appendChild(editor);
    
    // Initial Size Synchronizer: Trigger growth after content population and DOM insertion
    setTimeout(autoResize, 0);

    // Fetch and clear the footer attachment wrapper
    const footerPreviewWrap = document.getElementById('footer-attachment-preview');
    if (footerPreviewWrap) footerPreviewWrap.innerHTML = '';

    // Hydrate the visual preview in the footer if needed
    if (note && footerPreviewWrap) {
        if (typeof renderCreateFooterReel === 'function') renderCreateFooterReel(note.attachments || []);
    } else if (data && footerPreviewWrap) {
        // Handle pasted data if any: renderCreateFooterReel will automatically pick up DRAFT_NOTE.pendingFiles
        if (typeof renderCreateFooterReel === 'function') renderCreateFooterReel([]);    // Attachment UI Sync
    }




    modal.classList.add('show');
    modal.classList.add('active'); // State Sync (Synchronized with closure engine)
    document.body.classList.add('modal-open');
    setTimeout(() => {
        titleInput.focus();
        titleInput.select();
    }, 100);

    // Reset attachment state for new draft context
    const fileInput = document.getElementById('create-note-file-input');
    if (fileInput) fileInput.value = '';
}

/**
 * Triggers the restoration of a archived note.
 * Full Parity Implementation: Confirmation modal, centering logic, and state re-hydration.
 * @param {number} id - Target note ID.
 */
async function restoreNote(id) {
    window.showConfirmModal({
        title: 'Restore Note',
        icon: '🔄',
        message: `Restore this note to the current board at level ${STATE.activeLayerId}?`,
        confirmText: 'RESTORE',
        confirmIcon: '🔄',
        hideCancel: true,
        onConfirm: async () => {
            showLoadingOverlay('Restoring piece...');
            
            // Calculate current logical center for placement
            const wrapper = STATE.wrapperEl;
            const canvasCX = (wrapper.scrollLeft + wrapper.clientWidth / 2) / STATE.scale;
            const canvasCY = (wrapper.scrollTop + wrapper.clientHeight / 2) / STATE.scale;

            const res = await NoteAPI.post('/notes/api/restore', { 
                id: id, 
                canvas_id: STATE.canvas_id, 
                layer_id: STATE.activeLayerId,
                x: Math.round(canvasCX / 10) * 10 - 140, // Match creation centering logic
                y: Math.round(canvasCY / 10) * 10 - 100
            });
            hideLoadingOverlay();

            if (res && res.success) {
                showToast('Note restored to current board', 'success');
                // Refresh local state to show the restored note
                await loadState(false, STATE.canvas_id);
                if (typeof openBinModal === 'function') openBinModal(); // Refresh bin list
            } else {
                showToast(res.error || 'Restoration failed', 'error');
            }
        }
    });
}

/**
 * Confirmation logic for permanent deletion of a specific archived note.
 * @param {number} id - Target note ID.
 */
function confirmNotePurge(id) {
    window.showConfirmModal({
        title: 'Permanent Delete',
        icon: '🗑️',
        message: 'Are you sure you want to permanently delete this note? This action cannot be undone.',
        danger: true,
        confirmText: 'PURGE',
        confirmIcon: '🗑️',
        hideCancel: true,
        onConfirm: async () => {
            const res = await NoteAPI.post('/notes/api/purge', { id: id });
            if (res && res.success) {
                if (typeof openBinModal === 'function') openBinModal(); // Refresh Bin List
                showToast('Note permanently removed', 'success');
            }
        }
    });
}




// Global Exposure
window.viewNote = viewNote;
window.closeViewModal = closeViewModal;
window.executeCreateNote = executeCreateNote;
window.closeCreateModal = closeCreateModal;
window.showCreateNoteModal = showCreateNoteModal;
window.openPDFViewer = openPDFViewer;
window.openSearchModal = openSearchModal;
window.closeSearchModal = closeSearchModal;
window.openCanvasManager = openCanvasManager;
window.renderCanvasList = renderCanvasList;
window.closeCanvasManager = closeCanvasManager;
window.openMoveModal = openMoveModal;
window.closeMoveModal = closeMoveModal;
window.openBoardSettings = openBoardSettings;
window.closeBoardSettings = closeBoardSettings;
window.renderShareList = renderShareList;
window.setupUserSearch = setupUserSearch;
window.addUserToBoard = addUserToBoard;
window.updateSharePermission = updateSharePermission;
window.confirmRevoke = confirmRevoke;
window.openBinModal = openBinModal;
window.closeBinModal = closeBinModal;
window.renderBinList = renderBinList;
window.restoreNote = restoreNote;
window.confirmNotePurge = confirmNotePurge;
window.copyViewContent = copyViewContent;
window.openJumpToLevelModal = openJumpToLevelModal;

/**
 * Legacy compatibility alias for showCreateNoteModal.
 * @param {string} type - The note type ('text', 'image').
 */
function createNote(type) {
    if (typeof showCreateNoteModal === 'function') {
        showCreateNoteModal(type);
    }
}
window.createNote = createNote;

/**
 * Legacy compatibility alias for renderCanvasList.
 */
function loadCanvases() {
    if (typeof renderCanvasList === 'function') {
        renderCanvasList();
    }
}
window.loadCanvases = loadCanvases;

/**
 * Legacy compatibility alias for renderBinList.
 */
function renderBin() {
    if (typeof renderBinList === 'function') {
        renderBinList();
    }
}
window.renderBin = renderBin;

/**
 * Legacy compatibility alias for renderShareList.
 * @param {number|string} canvasId - The board ID.
 * @param {Array} shares - The collaborator list.
 */
function renderBoardShares(canvasId, shares) {
    if (typeof renderShareList === 'function') {
        renderShareList(canvasId, shares);
    }
}
window.renderBoardShares = renderBoardShares;
window.renderCanvasList = typeof renderCanvasList !== 'undefined' ? renderCanvasList : null;

// ─────────────────────────────────────────────────────────────────────────────
// Canvas Quick-Switcher (Pill Dropdown)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Populates the quick-switcher list from STATE.canvases.
 * Called each time the panel opens to reflect the latest canvas roster.
 */
function renderQuickSwitcher() {
    const list = document.getElementById('cqs-list');
    if (!list) return;

    list.innerHTML = '';
    (STATE.canvases || []).forEach(canvas => {
        const isActive = canvas.id == STATE.canvas_id;
        const icon     = isActive ? '📖' : (canvas.is_owner ? '📒' : '🔗');
        const meta     = canvas.is_owner
            ? 'Owned by you'
            : `Shared by ${canvas.owner_name || 'System'}`;

        const item = document.createElement('div');
        item.className = `cqs-item${isActive ? ' cqs-item--active' : ''}`;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', isActive ? 'true' : 'false');
        item.innerHTML = `
            <div class="cqs-item-icon">${icon}</div>
            <div class="cqs-item-body">
                <div class="cqs-item-name">
                    ${escapeHtml(canvas.name)}
                    ${+canvas.is_protected ? `
                        <span class="cqs-lock-icon clickable" 
                              data-canvas-id="${canvas.id}"
                              title="${STATE.unlockedCanvases.has(canvas.id) ? 'Unlock active (Click to Lock)' : 'Locked (Click to access)'}">
                            ${STATE.unlockedCanvases.has(canvas.id) ? '🔓' : '🔒'}
                        </span>
                    ` : ''}
                </div>
                <div class="cqs-item-meta">${meta}</div>
            </div>
            ${isActive ? '<span class="cqs-item-badge">Active</span>' : ''}
        `;

        item.addEventListener('click', (e) => {
            const lock = e.target.closest('.cqs-lock-icon');
            if (lock) {
                e.stopPropagation();
                if (STATE.unlockedCanvases.has(canvas.id)) {
                    // UI Cleanliness: Close the switcher before locking to prevent 
                    // overlay stacking and visual confusion.
                    closeCanvasQuickSwitch();
                    apiLockCanvas(canvas.id);
                } else {
                    closeCanvasQuickSwitch();
                    switchCanvas(canvas.id); // Trigger switch to show overlay
                }
                return;
            }

            if (!isActive) {
                closeCanvasQuickSwitch();
                switchCanvas(canvas.id);
            }
        });
        list.appendChild(item);
    });
}

/**
 * Toggles the quick-switcher panel open/closed.
 * Transitioning to class-based visibility (Zero Style Manipulation).
 */
function toggleCanvasQuickSwitch() {
    const panel = document.getElementById('canvas-quick-switcher');
    const pill  = document.getElementById('active-board-branding');
    if (!panel) return;

    const isHidden = panel.classList.contains('hidden');
    if (isHidden) {
        if (typeof renderQuickSwitcher === 'function') renderQuickSwitcher();
        panel.classList.remove('hidden');
        if (pill) pill.setAttribute('aria-expanded', 'true');
    } else {
        closeCanvasQuickSwitch();
    }
}

/**
 * Closes the quick-switcher panel.
 */
function closeCanvasQuickSwitch() {
    const panel = document.getElementById('canvas-quick-switcher');
    const pill  = document.getElementById('active-board-branding');
    if (panel) panel.classList.add('hidden');
    if (pill)  pill.setAttribute('aria-expanded', 'false');
}

/**
 * Header Interactions Initializer.
 * Binds all header-level actions to prevent legacy inline onclick hooks.
 */
function setupHeaderInteractions() {
    // 1. Branding Pill (Canvas Switcher)
    const brandingPill = document.getElementById('active-board-branding');
    if (brandingPill) {
        brandingPill.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleCanvasQuickSwitch();
        });
    }

    // 2. Switcher Close Button
    const closeBtn = document.querySelector('.cqs-close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeCanvasQuickSwitch();
        });
    }

    // 3. Level Layer Navigation
    const levelUp = document.querySelector('.btn-level-up');
    if (levelUp) {
        levelUp.addEventListener('click', () => {
            if (typeof moveLevel === 'function') moveLevel(-1);
        });
    }

    const levelDown = document.querySelector('.btn-level-down');
    if (levelDown) {
        levelDown.addEventListener('click', () => {
            if (typeof moveLevel === 'function') moveLevel(1);
        });
    }

    const levelDisplay = document.getElementById('level-display');
    if (levelDisplay) {
        levelDisplay.addEventListener('click', () => {
            if (typeof openJumpToLevelModal === 'function') openJumpToLevelModal();
        });
    }

}

// Dismiss panel when clicking outside
document.addEventListener('click', (e) => {
    const panel = document.getElementById('canvas-quick-switcher');
    const pill  = document.getElementById('active-board-branding');
    if (!panel || panel.classList.contains('hidden')) return;
    if (panel.contains(e.target) || pill.contains(e.target)) return;
    closeCanvasQuickSwitch();
}, true);

window.toggleCanvasQuickSwitch = toggleCanvasQuickSwitch;
window.closeCanvasQuickSwitch  = closeCanvasQuickSwitch;
window.renderQuickSwitcher     = renderQuickSwitcher;
window.setupHeaderInteractions = setupHeaderInteractions;

// Initialization: Register listeners on module load
document.addEventListener('DOMContentLoaded', setupHeaderInteractions);
