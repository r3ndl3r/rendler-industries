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

    // Type Normalization: Type is derived from the ATTACHMENT if present, otherwise 'text'
    // This allows notes to have both text AND an attachment.
    const attachmentType = DRAFT_NOTE.type === 'text' ? (note?.type || 'text') : DRAFT_NOTE.type;
    const finalType      = attachmentType === 'text' ? 'text' : attachmentType;

    const wrapper = document.getElementById('canvas-wrapper');
    if (!wrapper) return;
    const canvasCX = (wrapper.scrollLeft + wrapper.clientWidth / 2) / STATE.scale;
    const canvasCY = (wrapper.scrollTop + wrapper.clientHeight / 2) / STATE.scale;

    const coords = id ? {
        x: note.x,
        y: note.y,
        width: note.width,
        height: note.height,
        z_index: note.z_index,
        is_collapsed: note.is_collapsed,
        is_options_expanded: note.is_options_expanded
    } : {
        x: Math.round(canvasCX / 10) * 10 - 140,
        y: Math.round(canvasCY / 10) * 10 - 100,
        z_index: Math.max(...STATE.notes.map(n => n.z_index || 0), 0) + 1,
        is_collapsed: 0,
        is_options_expanded: 0
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

        const res = await apiPost('/notes/api/save', params);
        if (res && res.success) {
            const noteId = res.id;
            STATE.last_mutation = res.last_mutation;
            STATE.note_map      = res.note_map || STATE.note_map;

            // 2. Multi-File Persistence
            if (DRAFT_NOTE.pendingFiles && DRAFT_NOTE.pendingFiles.length > 0) {
                for (const pending of DRAFT_NOTE.pendingFiles) {
                    const formData = new FormData();
                    formData.append('note_id', noteId);
                    formData.append('canvas_id', STATE.canvas_id);
                    
                    if (pending.file) {
                        formData.append('file', pending.file);
                    } else if (pending.data && pending.data.startsWith('data:')) {
                        const blob = await (await fetch(pending.data)).blob();
                        const timestamp = new Date().getTime();
                        formData.append('file', blob, pending.filename || `paste_${timestamp}.png`);
                    }
                    
                    const uploadRes = await apiPost('/notes/api/upload', formData);
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
        STATE.pendingDeletes = [];
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
                const res = await apiPost('/notes/api/layer/rename', {
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
            <div class="canvas-info" onclick="switchCanvas(${canvas.id})">
                <div class="canvas-name-row">
                    <span class="canvas-name">${escapeHtml(canvas.name)}</span>
                </div>
                <div class="canvas-meta">
                    ${isOwner ? 'Owned by you' : 'Shared by ' + (canvas.owner_name || 'System')}
                </div>
            </div>
            <div class="canvas-actions">
                ${isOwner ? `
                    <button class="btn-icon-square btn-sm btn-primary" onclick="openBoardSettings(${canvas.id})" title="Board Settings">
                        ⚙️
                    </button>
                    ${canvas.name !== 'My Notebook' ? `
                        <button class="btn-icon-square btn-sm btn-danger" onclick="deleteCanvas(event, ${canvas.id})" title="Delete Board">
                            🗑️
                        </button>
                    ` : ''}
                ` : ''}
            </div>
        `;

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
    await apiPost('/notes/api/canvases/reorder', orderMap);
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
        
        STATE.canvas_id = id;
        showLoadingOverlay('Cleaning canvas...');
        await loadState(true, id, targetNoteId);
        // Persist the new context as the most recent immediately
        if (typeof saveViewportImmediate === 'function') await saveViewportImmediate();
    } finally {
        hideLoadingOverlay();
        closeCanvasManager();
    }
    
    showToast('Switched board', 'success');
}

/**
 * Orchestrates new board creation.
 */
async function createCanvas(name) {
    const res = await apiPost('/notes/api/canvases/create', { name });
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
    const res = await apiPost('/notes/api/canvases/rename', { canvas_id: id, name });
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
            const res = await apiPost('/notes/api/canvases/delete', { canvas_id: id });
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
    const res = await apiGet(`/notes/api/state?canvas_id=${id}`);
    if (!res || !res.success) {
        showToast('Failed to fetch board settings', 'error');
        return;
    }

    const board = res.canvases.find(c => c.id == id);
    if (!board) return;
    
    const nameInput = document.getElementById('edit-canvas-name');
    if (nameInput) nameInput.value = board.name;
    
    const saveBtn = document.getElementById('save-canvas-name-btn');
    if (saveBtn) {
        saveBtn.dataset.canvasId = board.id;
        saveBtn.onclick = () => updateBoardName(id, nameInput.value);
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
    
    modal.classList.add('show');
    modal.classList.add('active');
    document.body.classList.add('modal-open');
}

/**
 * ACL Discovery Engine: Facilitates adding new collaborators to a board.
 */
async function addUserToBoard(canvasId, username) {
    const res = await apiPost('/notes/api/canvases/share', { canvas_id: canvasId, username, can_edit: 1 });
    if (res && res.success) {
        if (canvasId == STATE.canvas_id) STATE.share_list = res.share_list;
        renderShareList(canvasId, res.share_list);
        showToast('Shared successfully', 'success');
    }
}

async function updateSharePermission(canvasId, username, canEdit) {
    const res = await apiPost('/notes/api/canvases/share', { canvas_id: canvasId, username, can_edit: canEdit });
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
            const res = await apiPost('/notes/api/canvases/share', { canvas_id: canvasId, username, revoke: 1 });
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
 * Displays a formatted information modal explaining whiteboard features.
 */
function showBoardInfo() {
    const helpContent = `
        <div class="board-guide-section nav">
            <h4>🔗 Navigation & Rendering</h4>
            <ul class="board-guide-list">
                <li><strong>[note:#]</strong> - Link to another note by its ID</li>
                <li><strong>[image:#:scale]</strong> - Embed an image note (scale: 0.1 - 1.0)</li>
                <li><strong>[file:#]</strong> - Embed a file download link</li>
                <li><strong>[Label](url)</strong> - Create an external link</li>
            </ul>
        </div>
        <div class="board-guide-divider"></div>
        <div class="board-guide-section edit">
            <h4>✏️ Rich Text Formatting</h4>
            <ul class="board-guide-list">
                <li><strong>**Bold**</strong> and <strong>*Italic*</strong> for emphasis</li>
                <li><strong>\`code\`</strong> - Monospace code block</li>
                <li><strong>[color:selector]text[/color]</strong> - Highlight text (Semantic or HEX)</li>
                <li><strong>- [ ]</strong> or <strong>- [x]</strong> - Interactive checklists</li>
            </ul>
        </div>
        <div class="board-guide-divider"></div>
        <div class="board-guide-section move">
            <h4>📦 Whiteboard Controls</h4>
            <ul class="board-guide-list">
                <li><strong>Double Click</strong> - Create a new note at cursor</li>
                <li><strong>Ctrl+V</strong> - Paste image to create an Image Note</li>
                <li><strong>Mouse Wheel</strong> - Pan in any direction</li>
                <li><strong>Ctrl + Mouse Wheel</strong> - Zoom in/out to scale the perspective</li>
            </ul>
        </div>
    `;

    window.showConfirmModal({
        title: 'Whiteboard Guide',
        icon: 'ℹ️',
        message: helpContent,
        confirmText: 'Got it',
        confirmIcon: 'ℹ️',
        hideCancel: true,
        width: 'medium'
    });
}

/**
 * Triggers the 'Jump to Level' global modal prompt.
 * Allows the user to rapidly navigate to any numeric isolation level.
 * @returns {void}
 */
function openJumpToLevelModal() {
    // Internal: Shared Modal Cleanup Engine
    // Restores the global modal to its default state after custom layout modifications.
    const cleanupModal = () => {
        const promptContainer = document.getElementById('globalConfirmPromptContainer');
        const actionsContainer = document.getElementById('globalConfirmModalActions');
        const modalContent = document.getElementById('globalConfirmModalContent');

        if (promptContainer) {
            promptContainer.classList.remove('modal-prompt-row');
            const goBtn = promptContainer.querySelector('.btn-go-row');
            if (goBtn) goBtn.remove();
        }
        if (actionsContainer) actionsContainer.classList.remove('hidden');
        if (modalContent) {
            const injection = modalContent.querySelector('.quick-access-injection');
            if (injection) injection.remove();
        }
    };

    // Analytics: Identify all layers that currently contain notes, excluding the active one
    const activeLayers = [...new Set(STATE.notes.map(n => n.layer_id))]
        .filter(id => id != STATE.activeLayerId)
        .sort((a,b) => a - b);

    window.showConfirmModal({
        title: 'Jump to Level',
        icon: '📚',
        message: 'Specify level to view:',
        width: 'small',
        hideCancel: true,
        noEmoji: true,
        autoFocus: true,
        input: {
            type: 'number',
            placeholder: 'Level #',
            min: 1,
            max: 99,
            value: ''
        },
        confirmText: 'Go',
        confirmIcon: '📚',
        onCancel: cleanupModal, // Clean up if dismissed via Esc/X/Overlay
        onConfirm: async (val) => {
            const level = Math.floor(Math.abs(parseInt(val)));
            if (isNaN(level) || level < 1 || level > 99) {
                showToast('Please enter a valid level (1-99)', 'error');
                throw new Error('Invalid level');
            }
            cleanupModal(); // Clean up before navigation/close
            if (typeof window.switchLevel === 'function') await window.switchLevel(level);
        }
    });

    // Interaction UX: Move the Go button next to the input for a more compact row
    const promptContainer = document.getElementById('globalConfirmPromptContainer');
    const actionsContainer = document.getElementById('globalConfirmModalActions');
    const promptInput     = document.getElementById('globalConfirmPromptInput');

    if (promptContainer && actionsContainer && promptInput) {
        // Hide standard actions and switch prompt to a row layout
        actionsContainer.classList.add('hidden');
        promptContainer.classList.add('modal-prompt-row');

        // Inject the Go button next to the input if not already present
        if (!promptContainer.querySelector('.btn-go-row')) {
            const goBtn = document.createElement('button');
            goBtn.className = 'btn-primary btn-go-row';
            goBtn.innerHTML = '➤ Go';
            
            const submitLevel = () => {
                const val = promptInput.value;
                const level = Math.floor(Math.abs(parseInt(val)));
                if (isNaN(level) || level < 1 || level > 99) {
                    showToast('Please enter a valid level (1-99)', 'error');
                } else {
                    cleanupModal(); // Local cleanup before closure
                    if (typeof window.switchLevel === 'function') window.switchLevel(level);
                    window.closeConfirmModal();
                }
            };

            goBtn.onclick = submitLevel;
            
            // Standard keyboard interaction: Allow Enter key to trigger submission
            promptInput.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    submitLevel();
                }
            };

            promptContainer.appendChild(goBtn);
        }
    }

    // UX Enhancement: Inject the Quick Access section if active layers are detected
    if (activeLayers.length > 0) {
        const modalContent = document.getElementById('globalConfirmModalContent');
        if (modalContent) {
            // Sanitization: Remove any previous injections to prevent duplication
            const existing = modalContent.querySelector('.quick-access-injection');
            if (existing) existing.remove();

            const quickAccessHtml = `
                <hr class="modal-divider-short">
                <div class="quick-jump-section">
                    <div class="quick-jump-title">🚀 QUICK ACCESS</div>
                    <div class="quick-jump-list">
                        ${activeLayers.map(id => {
                            const alias = STATE.layer_map[id];
                            const label = alias ? `${id} - ${alias}` : `Level ${id}`;
                            return `<a href="javascript:void(0)" class="quick-jump-link" onclick="(${cleanupModal.toString()})(); if (typeof window.switchLevel === 'function') window.switchLevel(${id}); window.closeConfirmModal();">${window.escapeHtml(label)}</a>`;
                        }).join('')}
                    </div>
                </div>
            `;
            const div = document.createElement('div');
            div.className = 'quick-access-injection';
            div.innerHTML = quickAccessHtml;
            modalContent.appendChild(div);
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
                        onchange="updateSharePermission(${id}, '${share.username}', this.checked ? 1 : 0)">
                        <span class="slider"></span>
                    </label>
                </div>
                <button class="btn-icon-delete" onclick="confirmRevoke(${id}, '${share.username}')" title="Revoke Access">
                    🗑️
                </button>
            </div>
        `;
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
            const data = await apiGet(`/notes/api/search?q=${encodeURIComponent(query)}`);
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
            const data = await apiGet(`/notes/api/users/search?q=${encodeURIComponent(query)}`);
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
        const data = await apiGet(`/notes/api/bin?canvas_id=${STATE.canvas_id}`);

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
                        <button class="btn-icon-square btn-danger" onclick="confirmPurge(${note.id})" title="Permanently Delete">
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
async function showCreateNoteModal(type, data, editId = null) {
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
    DRAFT_NOTE = { type, data, id: editId, pendingFiles: [] };
    
    // Clipboard Lifecycle: If we are pasting an image, populate the pending queue immediately
    if (type === 'image' && data) {
        DRAFT_NOTE.pendingFiles.push({ type: 'image', data: data, filename: 'pasted_image.png' });
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
    } else if (data) {
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

    // Always create a text editor
    const editor = document.createElement('textarea');
    editor.className = 'create-preview-text';
    editor.id        = 'create-note-editor';
    editor.spellcheck = false;
    editor.placeholder = 'Start typing your thoughts...';
    
    if (note) {
        editor.value = note.content || '';
    } else if (data && typeof data === 'string' && type === 'text') {
        // Guard: only accept string payloads (clipboard paste). Objects (e.g. {x,y} from double-click) are discarded.
        editor.value = data;
    }
    container.appendChild(editor);

    // Fetch and clear the footer attachment wrapper
    const footerPreviewWrap = document.getElementById('footer-attachment-preview');
    if (footerPreviewWrap) footerPreviewWrap.innerHTML = '';

    // Hydrate the visual preview in the footer if needed
    if (note && footerPreviewWrap) {
        STATE.pendingDeletes = []; // Reset deletions queue
        if (typeof renderCreateFooterReel === 'function') renderCreateFooterReel(note.attachments || []);
    } else if (data && footerPreviewWrap) {
        // Handle pasted data if any: renderCreateFooterReel will automatically pick up DRAFT_NOTE.pendingFiles
        if (typeof renderCreateFooterReel === 'function') renderCreateFooterReel([]);
    }

    // Attachment UI Sync
    const purgeBtn = document.getElementById('purge-attachment-btn');
    if (purgeBtn) {
        // Ownership Gate: Only the note creator can purge all attachments
        const isOwner = note ? (note.user_id == STATE.user_id) : true;
        const hasAttachments = (note && note.attachments && note.attachments.length > 0) || 
                               (DRAFT_NOTE && DRAFT_NOTE.pendingFiles && DRAFT_NOTE.pendingFiles.length > 0);
        purgeBtn.classList.toggle('hidden', !(hasAttachments && isOwner));
        purgeBtn.onclick = () => { if (typeof confirmPurgeAll === 'function') confirmPurgeAll(); };
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
            const wrapper = document.getElementById('canvas-wrapper');
            const canvasCX = (wrapper.scrollLeft + wrapper.clientWidth / 2) / STATE.scale;
            const canvasCY = (wrapper.scrollTop + wrapper.clientHeight / 2) / STATE.scale;

            const res = await apiPost('/notes/api/restore', { 
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
function confirmPurge(id) {
    window.showConfirmModal({
        title: 'Permanent Delete',
        icon: '🗑️',
        message: 'Are you sure you want to permanently delete this note? This action cannot be undone.',
        danger: true,
        confirmText: 'PURGE',
        confirmIcon: '🗑️',
        hideCancel: true,
        onConfirm: async () => {
            const res = await apiPost('/notes/api/purge', { id: id });
            if (res && res.success) {
                if (typeof openBinModal === 'function') openBinModal(); // Refresh Bin List
                showToast('Note permanently removed', 'success');
            }
        }
    });
}

/**
 * Draft Context Helper: Purges all attachments from the current draft note.
 */
function confirmPurgeAll() {
    window.showConfirmModal({
        title: 'Purge All Attachments',
        icon: '🗑️',
        message: 'Are you sure you want to remove ALL attachments from this note? They will be permanently deleted once you SAVE.',
        danger: true,
        confirmText: 'Purge All',
        onConfirm: () => {
            // 1. Queue all existing for deletion
            if (DRAFT_NOTE && DRAFT_NOTE.id) {
                const note = STATE.notes.find(n => n.id == DRAFT_NOTE.id);
                if (note && note.attachments) {
                    note.attachments.forEach(att => {
                        if (!STATE.pendingDeletes.includes(att.blob_id)) {
                            STATE.pendingDeletes.push(att.blob_id);
                        }
                    });
                }
            }
            // 2. Clear pending uploads
            if (DRAFT_NOTE) DRAFT_NOTE.pendingFiles = [];
            
            // 3. Refresh UI
            const note = DRAFT_NOTE && DRAFT_NOTE.id ? STATE.notes.find(n => n.id == DRAFT_NOTE.id) : null;
            if (typeof renderCreateFooterReel === 'function') {
                renderCreateFooterReel(note ? note.attachments : []);
            }
            showToast('All attachments marked for removal', 'warning');
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
window.confirmPurge = confirmPurge;
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
                <div class="cqs-item-name">${escapeHtml(canvas.name)}</div>
                <div class="cqs-item-meta">${meta}</div>
            </div>
            ${isActive ? '<span class="cqs-item-badge">Active</span>' : ''}
        `;

        if (!isActive) {
            item.addEventListener('click', () => {
                closeCanvasQuickSwitch();
                switchCanvas(canvas.id);
            });
        }
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
            if (typeof moveLevel === 'function') moveLevel(1);
        });
    }

    const levelDown = document.querySelector('.btn-level-down');
    if (levelDown) {
        levelDown.addEventListener('click', () => {
            if (typeof moveLevel === 'function') moveLevel(-1);
        });
    }

    const levelDisplay = document.getElementById('level-display');
    if (levelDisplay) {
        levelDisplay.addEventListener('click', () => {
            if (typeof openJumpToLevelModal === 'function') openJumpToLevelModal();
        });
    }

    const levelRename = document.querySelector('.btn-level-rename');
    if (levelRename) {
        levelRename.addEventListener('click', () => {
            if (typeof renameCurrentLevel === 'function') renameCurrentLevel();
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
