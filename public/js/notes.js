// /public/js/notes.js

/**
 * Sticky Notes Whiteboard Engine
 * 
 * Manages the persistent storage and interactive rendering of
 * sticky note records. Handles coordinate synchronization, 10px snap-grid
 * movement, and multipart binary upload flows.
 */

const STATE = {
    notes:      [],
    editMode:   true,     // Permanent Edit Mode: Always draggable
    user_id:    null,
    canvasSize: 5000,
    snapGrid:   10,
    scale:      1.0,      // Current CSS transform scale
    canvas_id:  null,     // Active Whiteboard Context (Dynamic resolution)
    canvases:   [],       // Available boards (Owned + Shared)
    share_list: [],       // ACL for the current board
    vpSaveTimer: null,    // Debounce handle for viewport persistence
    isInitializing: false, // Prevents save-during-load race conditions
    pickedNoteId:   null,  // Active 'Pick & Place' record
    originalPos:    null,  // Restore-point for 'Escape-to-Cancel'
    dragOffset:     { x: 0, y: 0 }, // Dynamic delta for 'Pick & Place'
    isPanning:      false,          // Drag-to-Scroll State
    panStart:       { x:0, y:0, scrollX:0, scrollY:0 },
    last_mutation:  null,           // Synchronization Baseline
    heartbeatTimer: null            // Active Polling Reference
};

/**
 * Unified Draft Context for New/Pasted Notes
 */
let DRAFT_NOTE = null;

// Scale bounds
const SCALE_MIN  = 0.1;
const SCALE_MAX  = 3.00;
const SCALE_STEP = 0.1;

document.addEventListener('DOMContentLoaded', () => {
    initNotes();
});

// State Synchronization: Save viewport before reload
window.addEventListener('beforeunload', () => {
    if (!STATE.isInitializing) {
        saveViewportImmediate();
    }
});

/**
 * Initializes the whiteboard module.
 * @returns {void}
 */
async function initNotes() {
    await loadState(true); // Establish initial perspective

    // Event Delegation for Canvas Interactions
    const canvas  = document.getElementById('notes-canvas');
    const wrapper = document.getElementById('canvas-wrapper');
    if (canvas && wrapper) {
        canvas.addEventListener('dblclick', handleCanvasDoubleClick);
        canvas.addEventListener('mousedown', handleCanvasMouseDown);
        wrapper.addEventListener('wheel', handleCanvasWheel, { passive: false });
    }
    
    // Global Panning Listeners: Attached to window to ensure capture outside canvas bounds
    window.addEventListener('mousemove', handleCanvasMouseMove);
    window.addEventListener('mouseup',   handleCanvasMouseUp);
    
    document.getElementById('zoom-in').addEventListener('click', zoomIn);
    document.getElementById('zoom-out').addEventListener('click', zoomOut);
    document.getElementById('add-text-note').addEventListener('click', () => showCreateNoteModal('text'));
    document.getElementById('center-view').addEventListener('click', centerView);
    document.getElementById('focus-recent').addEventListener('click', focusMostRecentNote);
    document.getElementById('open-search').addEventListener('click', openSearchModal);
    document.getElementById('open-canvas-manager').addEventListener('click', openCanvasManager);

    // Search Input Listener
    const searchInput = document.getElementById('note-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => filterSearch(e.target.value));
    }
    // Interaction: Global Clipboard Sync (Ctrl+V)
    document.addEventListener('paste', handleGlobalClipPaste);

    // Creation Modal Listener
    const createConfirmBtn = document.getElementById('create-note-btn');
    if (createConfirmBtn) {
        createConfirmBtn.addEventListener('click', executeCreateNote);
    }
    
    // Canvas Manager Listeners
    const addCanvasBtn = document.getElementById('add-canvas-btn');
    if (addCanvasBtn) {
        addCanvasBtn.addEventListener('click', () => {
            const name = document.getElementById('new-canvas-name').value;
            if (name) createCanvas(name);
        });
    }

    const canvasNameInput = document.getElementById('new-canvas-name');
    if (canvasNameInput) {
        canvasNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const name = e.target.value;
                if (name) createCanvas(name);
            }
        });
    }

    setupUserSearch();

    // Canvas Settings Listeners
    const saveCanvasNameBtn = document.getElementById('save-canvas-name-btn');
    if (saveCanvasNameBtn) {
        saveCanvasNameBtn.onclick = () => {
            const id = saveCanvasNameBtn.dataset.canvasId;
            const name = document.getElementById('edit-canvas-name').value;
            if (id && name) updateBoardName(id, name);
        };
    }
    
    const createColorPicker = document.getElementById('create-note-color');
    const createColorHex    = document.getElementById('create-note-color-hex');
    
    if (createColorPicker && createColorHex) {
        createColorPicker.addEventListener('input', () => {
            createColorHex.value = createColorPicker.value.toUpperCase();
        });
        
        createColorHex.addEventListener('input', () => {
            const val = createColorHex.value;
            if (/^#[0-9A-F]{6}$/i.test(val)) {
                createColorPicker.value = val;
            }
        });
    }

    // Toggle Drawer Listener (Delegated)
    if (canvas) {
        canvas.addEventListener('click', (e) => {
            const toggleBtn = e.target.closest('.btn-icon-drawer');
            if (toggleBtn) {
                const noteId = toggleBtn.dataset.id;
                const note   = STATE.notes.find(n => n.id == noteId);
                const drawer = document.getElementById(`drawer-${noteId}`);
                
                if (drawer && note) {
                    drawer.classList.toggle('expanded');
                    note.is_options_expanded = drawer.classList.contains('expanded') ? 1 : 0;
                    toggleBtn.innerHTML = note.is_options_expanded ? '&gt;' : '&lt;';
                    
                    // State Synchronization: Persist position across the module
                    syncNotePosition(noteId);
                }
            }
        });
    }

    // Modal Registry: Synchronize all overlays with the global closing engine
    setupGlobalModalClosing(['modal-overlay'], [closeViewModal, closeCreateModal, closeSearchModal, closeCanvasManager, closeMoveModal, closeBoardSettings]);
    
    // Robust Event Delegation: Handles all close triggers (static & dynamic)
    document.addEventListener('click', (e) => {
        const closeBtn = e.target.closest('[data-close="modal"]');
        if (closeBtn) {
            closeViewModal();
            closeCreateModal();
            closeSearchModal();
            closeCanvasManager();
            closeMoveModal();
            closeBoardSettings();
        }
    });

    // Copy button in the view modal
    document.getElementById('note-view-copy-btn').addEventListener('click', copyViewContent);

    // Persist scroll position on scroll (debounced)
    if (wrapper) {
        wrapper.addEventListener('scroll', onViewportScroll);
    }

    // Interaction: Activate Drag-and-Drop File Engine
    initDropZones();

    // Global Interface: Keydown Listeners (ESC/Arrows)
    document.addEventListener('keydown', handleGlobalKeydown);
    
    // Global Click Listener for 'Pick & Place' Drop Conclusion
    document.addEventListener('click', handleGlobalClick, true);

    // Icon Registry Initialization: Read from the non-inline data anchor
    if (canvas && canvas.dataset.icons) {
        try {
            window.GLOBAL_ICONS = JSON.parse(canvas.dataset.icons);
        } catch (e) {
            console.error('Icon Registry hydration failed:', e);
        }
    }
}


/**
 * Fetches the Single Source of Truth state from the backend.
 * Restores viewport scale and scroll position ONLY during the initial onboarding.
 * @param {boolean} initial - Whether this is the initial load.
 * @param {number|null} canvas_id - Optional specific canvas ID.
 * @returns {Promise<void>}
 */
async function loadState(initial = false, canvas_id = null, targetNoteId = null) {
    if (initial) STATE.isInitializing = true; // Protect interface state during initial hydration
    
    // Resolve context: Prioritize URL param -> Current State -> Backend Default (null)
    const urlParams = new URLSearchParams(window.location.search);
    const tid = canvas_id || urlParams.get('canvas_id') || STATE.canvas_id;
    const nid = targetNoteId || urlParams.get('note_id'); // Deep-link or search-target detection

    try {
        let query = tid ? `?canvas_id=${tid}` : '';
        if (nid) {
            query = query ? `${query}&note_id=${nid}` : `?note_id=${nid}`;
        }

        const response = await fetch(`/notes/api/state${query}`);
        const data = await response.json();
        
        if (data.success) {
            STATE.notes    = data.notes    || [];
            STATE.canvases = data.canvases || [];
            STATE.user_id  = data.user_id;
            STATE.canvas_id  = data.canvas_id; // Resolved active context
            
            // State Synchronization: Baseline alignment with backend truth
            STATE.last_mutation = data.last_mutation;

            STATE.share_list = data.share_list || [];
            
            // Sync Branding Pill
            const canvasObj = STATE.canvases.find(c => c.id == STATE.canvas_id);
            const pill      = document.getElementById('active-board-name-pill');
            if (canvasObj && pill) {
                pill.textContent = canvasObj.name;
            }

            // URL Parameter Lifecycle: Standardize on a clean, board-agnostic URL.
            // The backend already persists the 'last viewed' board, so we clear volatile parameters.
            const url = new URL(window.location.href);
            if (url.searchParams.has('canvas_id') || url.searchParams.has('note_id')) {
                url.searchParams.delete('canvas_id');
                url.searchParams.delete('note_id');
                window.history.replaceState({ canvas_id: STATE.canvas_id }, '', url);
            }

            // Only restore perspective if this is the initial load
            if (initial && data.viewport && !nid) {
                STATE.scale = parseFloat(data.viewport.scale) || 1.0;
                applyScale();

                requestAnimationFrame(() => {
                    const wrapper = document.getElementById('canvas-wrapper');
                    if (!wrapper) return;

                    const centerX = parseFloat(data.viewport.scroll_x) || (STATE.canvasSize / 2);
                    const centerY = parseFloat(data.viewport.scroll_y) || (STATE.canvasSize / 2);

                    wrapper.scrollLeft = (centerX * STATE.scale) - (wrapper.clientWidth  / 2);
                    wrapper.scrollTop  = (centerY * STATE.scale) - (wrapper.clientHeight / 2);
                    
                    setTimeout(() => { STATE.isInitializing = false; }, 200);
                });
            } else if (initial && !nid) {
                centerView();
                STATE.isInitializing = false;
            } else {
                STATE.isInitializing = false;
            }

            // Remote Centering Dispatch: If a target note ID is in the context, center it after stabilization
            if (nid) {
                requestAnimationFrame(() => {
                    setTimeout(() => centerOnNote(nid), 300);
                });
            }
        } else {
            showToast('Failed to load whiteboard state', 'error');
            if (initial) {
                STATE.notes = []; // Purge potentially conflicting notes from previous board
                STATE.isInitializing = false;
            }
        }
    } catch (err) {
        console.error('loadState Error:', err);
        if (initial) {
            STATE.notes = [];
            STATE.isInitializing = false;
        }
    }
    // Render UI after all state is consolidated
    renderUI();

    // Context Persistence: Synchronize Mutation Heartbeat to the active board
    setupHeartbeat(STATE.canvas_id);

    return true;
}

/**
 * Reactive AJAX Heartbeat Engine
 * Periodically polls the server for workspace mutations to ensure cross-session consistency.
 * @param {number} canvasId - The workspace to monitor.
 * @returns {void}
 */
function setupHeartbeat(canvasId) {
    if (!canvasId) return;

    // Reset Poller to prevent multi-interval drift
    if (STATE.heartbeatTimer) clearInterval(STATE.heartbeatTimer);

    console.log(`[SYNC] Initializing Mutation Heartbeat for Board ${canvasId}...`);
    
    STATE.heartbeatTimer = setInterval(async () => {
        // Condition: Only poll if we are not currently in an initialization/save cycle
        if (STATE.isInitializing) return;

        try {
            const resp = await fetch(`/notes/api/sync/heartbeat/${canvasId}`);
            const data = await resp.json();

            if (data.success && data.last_mutation) {
                // Reactive Trigger: If the server reports a newer mutation than our local state
                if (STATE.last_mutation && data.last_mutation > STATE.last_mutation) {
                    console.log(`[SYNC] Mutation detected (${data.last_mutation} > ${STATE.last_mutation}). Re-hydrating...`);
                    
                    // Execution Reality: Only update the local baseline AFTER successful state re-hydration.
                    // This ensures the client remains at the previous mutation state if a fetch/render fails.
                    if (await loadState(false, canvasId)) {
                        STATE.last_mutation = data.last_mutation;
                    }
                } else {
                    // Update baseline even if no change (ensures we stay in sync with server clock)
                    STATE.last_mutation = data.last_mutation;
                }
            }
        } catch (err) {
            console.warn('[SYNC] Heartbeat connection failure. Retrying in 2s...');
        }
    }, 2000); // 2-Second Interval: Optimized for a responsive 'real-time' experience.
}

/**
 * Renders all sticky notes and updates the UI state.
 * @returns {void}
 */
function renderUI() {
    const canvas = document.getElementById('notes-canvas');
    if (!canvas) return;
    
    // Remove existing elements (Except for permanent overlays/skeletons)
    const existingNotes = canvas.querySelectorAll('.sticky-note');
    existingNotes.forEach(n => n.remove());
    
    // Hide skeleton if populated
    const skeleton = document.getElementById('canvas-skeleton');
    if (skeleton && STATE.notes.length > 0) skeleton.classList.add('hidden');

    // Verify Permissions: Check if current user has EDIT access to this board
    const currentCanvas = STATE.canvases.find(c => c.id == STATE.canvas_id);
    const canEdit       = currentCanvas ? currentCanvas.can_edit : 1;

    STATE.notes.forEach(note => {
        const noteEl = createNoteElement(note, canEdit);
        canvas.appendChild(noteEl);
        
        if (STATE.editMode && canEdit) {
            makeDraggable(noteEl);
            initResizable(noteEl, note);
        }
    });
}

/**
 * Creates the DOM element for a sticky note.
 * @param {Object} note - The note data object.
 * @param {boolean} canEdit - Permission flag.
 * @returns {HTMLElement} - The created note element.
 */
function createNoteElement(note, canEdit = true) {
    const div = document.createElement('div');
    div.className = `sticky-note ${note.is_collapsed ? 'collapsed' : ''}`;
    div.id = `note-${note.id}`;
    div.dataset.id = note.id;
    
    // Apply custom accent color via CSS variable
    const accentColor = normalizeColorHex(note.color);
    div.style.setProperty('--note-accent', accentColor);
    
    // Apply position and z-index (Absolute coordinates 0-5000)
    div.style.left = `${note.x}px`;
    div.style.top = `${note.y}px`;
    if (note.width)  div.style.width = `${note.width}px`;
    if (note.height) div.style.height = `${note.height}px`;
    div.style.zIndex = note.z_index || 1;

    let contentHtml = '';
    if (note.type === 'text') {
        contentHtml = `<div class="note-content"><textarea readonly>${escapeHtml(note.content || '')}</textarea></div>`;
    } else if (note.type === 'image') {
        contentHtml = `
            <div class="note-content">
                <div class="note-image-container">
                    <img src="/notes/serve/${note.id}" class="note-image" loading="lazy">
                </div>
            </div>`;
    }

    div.innerHTML = `
        <div class="note-header">
            <div class="note-drag-handle-container" onclick="toggleStickyMove(event, ${note.id})" title="Click anywhere in the title bar to Pick and Place (Sticky Move)">
                <div class="note-title-slot">
                    ${escapeHtml(note.title || 'Untitled Note')}
                </div>
            </div>
            <div class="note-actions">
                <div class="note-actions-drawer ${note.is_options_expanded ? 'expanded' : ''}" id="drawer-${note.id}">
                    <button class="btn-icon-copy" onclick="copyNoteToClipboard(${note.id})" title="Copy to Clipboard">
                        ${getIcon('copy')}
                    </button>
                    <button class="btn-icon-link" onclick="copyNoteLink(${note.id})" title="Copy Direct Link">
                        ${getIcon('link')}
                    </button>
                    <button class="btn-icon-move" onclick="openMoveModal(event, ${note.id})" title="Copy to Canvas" ${canEdit ? '' : 'disabled style="opacity:0.5"'}>
                        ${getIcon('move')}
                    </button>
                    <button class="btn-icon-view" onclick="viewNote(${note.id})" title="Quick View">
                        ${getIcon('view')}
                    </button>
                    <button class="btn-icon-collapse" onclick="toggleCollapse(${note.id})" title="Toggle Collapse">
                        ${getIcon(note.is_collapsed ? 'expand' : 'collapse')}
                    </button>
                    <button class="btn-icon-edit" onclick="editNote(${note.id})" title="Edit Content" ${canEdit ? '' : 'disabled style="opacity:0.5"'}>
                        ${getIcon('edit')}
                    </button>
                    <button class="btn-icon-delete" onclick="deleteNote(${note.id})" title="Delete Note" ${canEdit ? '' : 'disabled style="opacity:0.5"'}>
                        ${getIcon('delete')}
                    </button>
                </div>
                <button class="btn-icon-drawer" data-id="${note.id}" title="Toggle Actions">
                    ${note.is_options_expanded ? '&gt;' : '&lt;'}
                </button>
            </div>
        </div>
        ${contentHtml}
        <div class="note-resize-handle" title="Resize Note"></div>
    `;

    return div;
}

/**
 * Resize engine initialization
 * @param {HTMLElement} el - The note element.
 * @param {Object} note - The note data object.
 * @returns {void}
 */
function initResizable(el, note) {
    const handle = el.querySelector('.note-resize-handle');
    if (!handle) return;

    let startX, startY, startWidth, startHeight;
    let isResizing = false;

    handle.addEventListener('mousedown', (e) => {
        if (!STATE.editMode) return;
        e.stopPropagation();
        e.preventDefault();
        
        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        const style = window.getComputedStyle(el);
        startWidth = parseInt(style.width, 10);
        startHeight = parseInt(style.height, 10);
        
        // Z-Index Promotion
        const maxZ = Math.max(...STATE.notes.map(n => n.z_index || 0), 0) + 1;
        el.style.zIndex = maxZ;

        document.addEventListener('mousemove', doResize);
        document.addEventListener('mouseup', stopResize);
        el.classList.add('resizing');
    });

    function doResize(e) {
        if (!isResizing) return;
        
        // Resolution-independent sizing with scale-awareness
        let newWidth  = startWidth + (e.clientX - startX) / STATE.scale;
        let newHeight = startHeight + (e.clientY - startY) / STATE.scale;
        
        // 10px Grid Snapping Parity
        newWidth  = Math.round(newWidth / STATE.snapGrid) * STATE.snapGrid;
        newHeight = Math.round(newHeight / STATE.snapGrid) * STATE.snapGrid;
        
        // Constraint Logic: Min-Size and Canvas-Boundary Entrapment
        const maxWidth  = STATE.canvasSize - note.x;
        const maxHeight = STATE.canvasSize - note.y;
        
        newWidth  = Math.max(240, Math.min(newWidth, maxWidth));
        newHeight = Math.max(54, Math.min(newHeight, maxHeight));
        
        el.style.width  = `${newWidth}px`;
        el.style.height = `${newHeight}px`;
    }

    function stopResize() {
        if (!isResizing) return;
        isResizing = false;
        
        document.removeEventListener('mousemove', doResize);
        document.removeEventListener('mouseup', stopResize);
        el.classList.remove('resizing');
        
        // State Synchronization: Persist dimensions to the database
        const finalWidth  = parseInt(el.style.width, 10);
        const finalHeight = parseInt(el.style.height, 10);
        
        note.width  = finalWidth;
        note.height = finalHeight;
        
        // Trigger atomic save
        syncNotePosition(note.id);
    }
}

/**
 * Hardware-accelerated dragging engine with 10px grid snapping.
 * @param {HTMLElement} el - The note element.
 * @returns {void}
 */
function makeDraggable(el) {
    const handle = el.querySelector('.note-drag-handle-container');
    if (!handle) return;
    
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    handle.addEventListener('mousedown', dragMouseDown);

    function dragMouseDown(e) {
        if (!STATE.editMode) return;
        // Check if the click was on the header or an icon within it
        if (!e.target.closest('.note-drag-handle-container')) return;
        
        e.preventDefault();
        
        // Elevate z-index during flight (Consolidated Logic)
        const maxZ = Math.max(...STATE.notes.map(n => n.z_index || 0), 0) + 1;
        el.style.zIndex = maxZ;
        el.classList.add('dragging');
        
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.addEventListener('mouseup', closeDragElement);
        document.addEventListener('mousemove', elementDrag);
    }

    function elementDrag(e) {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;

        // Scale-Aware Vector Displacement: Divide delta by current viewport scale
        let newX = el.offsetLeft - (pos1 / STATE.scale);
        let newY = el.offsetTop - (pos2 / STATE.scale);

        // 10px Grid Snapping and Canvas-Boundary Entrapment (5000px)
        newX = Math.round(newX / STATE.snapGrid) * STATE.snapGrid;
        newY = Math.round(newY / STATE.snapGrid) * STATE.snapGrid;

        // Clamping Logic: Coordinate overflow is prevented
        newX = Math.max(0, Math.min(newX, STATE.canvasSize - el.offsetWidth));
        newY = Math.max(0, Math.min(newY, STATE.canvasSize - el.offsetHeight));

        el.style.left = `${newX}px`;
        el.style.top = `${newY}px`;
    }

    function closeDragElement() {
        el.classList.remove('dragging');
        document.removeEventListener('mouseup', closeDragElement);
        document.removeEventListener('mousemove', elementDrag);
        
        // State Synchronization: Persist position to the database
        syncNotePosition(el.dataset.id);
    }
}

/**
 * Pick & Place (Sticky Move) Orchestrator.
 * Transitions a note into 'flight mode' where it follows the cursor without a held click.
 * @param {MouseEvent} e - The click event.
 * @param {number|string} id - The note ID.
 * @returns {void}
 */
function toggleStickyMove(e, id) {
    if (STATE.pickedNoteId) {
        dropStickyNote();
        return;
    }

    const note = STATE.notes.find(n => n.id == id);
    const el   = document.getElementById(`note-${id}`);
    if (!note || !el) return;

    // Capture the dynamic delta between the cursor and the note's origin
    const wrapper = document.getElementById('canvas-wrapper');
    const rect    = wrapper.getBoundingClientRect();
    
    // Logic: (Current Cursor Position on Canvas) - (Note Origin)
    const cursorX = (e.clientX - rect.left + wrapper.scrollLeft) / STATE.scale;
    const cursorY = (e.clientY - rect.top  + wrapper.scrollTop)  / STATE.scale;
    
    STATE.dragOffset = {
        x: cursorX - note.x,
        y: cursorY - note.y
    };

    STATE.pickedNoteId = id;
    STATE.originalPos  = { x: note.x, y: note.y, z: el.style.zIndex };
    
    // Elevate z-index for the flight path
    const maxZ = Math.max(...STATE.notes.map(n => n.z_index || 0), 0) + 1;
    el.style.zIndex = maxZ;
    el.classList.add('note-picked');
    
    document.addEventListener('mousemove', updateStickyMove);
    showToast('Note picked up', 'info');
}

/**
 * Real-time coordinate synchronization for notes in 'flight mode'.
 * @param {MouseEvent} e - The mouse move event.
 * @returns {void}
 */
function updateStickyMove(e) {
    if (!STATE.pickedNoteId) return;
    
    const el = document.getElementById(`note-${STATE.pickedNoteId}`);
    if (!el) return;

    const wrapper = document.getElementById('canvas-wrapper');
    const rect    = wrapper.getBoundingClientRect();
    
    // Calculate cursor position relative to the canvas origin, accounting for scroll and scale
    let newX = (e.clientX - rect.left + wrapper.scrollLeft) / STATE.scale;
    let newY = (e.clientY - rect.top  + wrapper.scrollTop)  / STATE.scale;

    // Apply the dynamic delta captured during pick-up
    newX -= STATE.dragOffset.x;
    newY -= STATE.dragOffset.y;

    // 10px Grid Snapping and Canvas-Boundary Entrapment (5000px)
    newX = Math.round(newX / STATE.snapGrid) * STATE.snapGrid;
    newY = Math.round(newY / STATE.snapGrid) * STATE.snapGrid;

    newX = Math.max(0, Math.min(newX, STATE.canvasSize - el.offsetWidth));
    newY = Math.max(0, Math.min(newY, STATE.canvasSize - el.offsetHeight));

    el.style.left = `${newX}px`;
    el.style.top  = `${newY}px`;
}

/**
 * Finalizes the 'Pick & Place' action, anchoring the note and syncing to MariaDB.
 * @returns {void}
 */
function dropStickyNote() {
    if (!STATE.pickedNoteId) return;
    
    const id = STATE.pickedNoteId;
    const el = document.getElementById(`note-${id}`);
    
    STATE.pickedNoteId = null;
    STATE.originalPos  = null;
    
    if (el) el.classList.remove('note-picked');
    document.removeEventListener('mousemove', updateStickyMove);
    
    // State Synchronization: Persist position to the database
    syncNotePosition(id);
    showToast('Note placed', 'success');
}

/**
 * Aborts the current 'Pick & Place' action, restoring the note to its original coordinates.
 * @returns {void}
 */
function cancelStickyMove() {
    if (!STATE.pickedNoteId || !STATE.originalPos) return;
    
    const id = STATE.pickedNoteId;
    const el = document.getElementById(`note-${id}`);
    const note = STATE.notes.find(n => n.id == id);
    
    if (el && note) {
        el.style.left   = `${STATE.originalPos.x}px`;
        el.style.top    = `${STATE.originalPos.y}px`;
        el.style.zIndex = STATE.originalPos.z;
        el.classList.remove('note-picked');
        
        // Revert local state object
        note.x = STATE.originalPos.x;
        note.y = STATE.originalPos.y;
    }
    
    STATE.pickedNoteId = null;
    STATE.originalPos  = null;
    document.removeEventListener('mousemove', updateStickyMove);
    showToast('Move cancelled', 'info');
}

/**
 * Global Click Orchestrator.
 * Handles drop logic for the 'Pick & Place' engine.
 * @param {MouseEvent} e - The click event.
 * @returns {void}
 */
function handleGlobalClick(e) {
    if (STATE.pickedNoteId) {
        // If we just clicked the 'pin' button to pick it up, don't drop it immediately
        if (e.target.closest('.btn-icon-sticky')) return;
        
        e.preventDefault();
        e.stopPropagation();
        dropStickyNote();
    }
}

/**
 * Global Keyboard Interface.
 * @param {KeyboardEvent} e - The keydown event.
 * @returns {void}
 */
function handleGlobalKeydown(e) {
    if (e.key === 'Escape') {
        if (STATE.pickedNoteId) {
            cancelStickyMove();
        }
        
        // Also close any active modals
        closeViewModal();
        closeCreateModal();
        closeSearchModal();
    }
}

/**
 * Synchronizes position data to the backend.
 * @param {number|string} id - The note ID.
 * @returns {Promise<void>}
 */
async function syncNotePosition(id) {
    const el = document.getElementById(`note-${id}`);
    const note = STATE.notes.find(n => n.id == id);
    if (!el || !note) return;

    el.classList.add('pending');

    const params = {
        id: id,
        canvas_id: STATE.canvas_id,
        title: note.title,
        x: parseInt(el.style.left),
        y: parseInt(el.style.top),
        width: el.offsetWidth,
        height: el.offsetHeight,
        z_index: el.style.zIndex,
        content: note.content,
        color: note.color,
        is_collapsed: note.is_collapsed,
        is_options_expanded: note.is_options_expanded || 0
    };

    try {
        const res = await apiPost('/notes/api/save', params);
        if (res && res.success) {
            STATE.notes = res.notes; // State Sync
        }
    } finally {
        el.classList.remove('pending');
    }
}

/**
 * Centers the oversized canvas viewport on absolute coordinates.
 * @returns {void}
 */
function centerView() {
    const wrapper = document.getElementById('canvas-wrapper');
    if (!wrapper) return;
    const scrollX = (STATE.canvasSize / 2) * STATE.scale - (wrapper.clientWidth / 2);
    const scrollY = (STATE.canvasSize / 2) * STATE.scale - (wrapper.clientHeight / 2);
    wrapper.scrollTo({ left: scrollX, top: scrollY, behavior: 'smooth' });
}

/**
 * Focus detection: Locates the most recently created note (Max ID) 
 * and centers the viewport on its coordinates.
 * @returns {void}
 */
function focusMostRecentNote() {
    if (STATE.notes.length === 0) {
        centerView();
        return;
    }

    // Find the note with the most recent modification (Highest updated_at timestamp)
    const recentNote = STATE.notes.reduce((prev, current) => (prev.updated_at > current.updated_at) ? prev : current);

    if (recentNote) {
        centerOnNote(recentNote.id);
        showToast('Focused on most recent note', 'success');
    }
}

/**
 * Centering Engine: Smooth-scrolls the viewport to anchor a specific note.
 * Recalculates offsets based on the current STATE.scale to ensure precision centering.
 * @param {number|string} id - The note ID.
 * @returns {void}
 */
function centerOnNote(id) {
    const note = STATE.notes.find(n => n.id == id);
    if (!note) return;

    const wrapper = document.getElementById('canvas-wrapper');
    const noteEl  = document.querySelector(`.sticky-note[data-id="${id}"]`);
    if (!wrapper) return;
    
    // Use stored coordinates for the logical center calculation
    const noteW = note.width  || (noteEl ? noteEl.offsetWidth  : 280);
    const noteH = note.height || (noteEl ? noteEl.offsetHeight : 200);

    const centerX = note.x + (noteW / 2);
    const centerY = note.y + (noteH / 2);

    const scrollX = (centerX * STATE.scale) - (wrapper.clientWidth  / 2);
    const scrollY = (centerY * STATE.scale) - (wrapper.clientHeight / 2);

    wrapper.scrollTo({ left: scrollX, top: scrollY, behavior: 'smooth' });
    
    // Sub-Tactile Feedback: Highlight the note visually
    if (noteEl) {
        noteEl.classList.add('highlight-pulse');
        setTimeout(() => noteEl.classList.remove('highlight-pulse'), 2000);
    }
}

/**
 * Applies STATE.scale to the canvas element via CSS transform.
 * Uses transform-origin: 0 0 so coords stay relative to the top-left.
 * @returns {void}
 */
function applyScale() {
    const canvas = document.getElementById('notes-canvas');
    if (!canvas) return;
    canvas.style.transform       = `scale(${STATE.scale})`;
    canvas.style.transformOrigin = '0 0';

    // Update the scale indicator badge
    const badge = document.getElementById('scale-badge');
    if (badge) badge.textContent = `${Math.round(STATE.scale * 100)}%`;
}

/**
 * Zooms the canvas in by one step (10%), snapping to the nearest decile.
 * @returns {void}
 */
function zoomIn() {
    const wrapper  = document.getElementById('canvas-wrapper');
    if (!wrapper) return;
    const oldScale = STATE.scale;

    // Removes any incremental scale drift during decile snapping
    STATE.scale = Math.min(SCALE_MAX, Math.round((STATE.scale + SCALE_STEP) * 10) / 10);

    // Canvas coordinate at the current viewport centre
    const canvasCX = (wrapper.scrollLeft + wrapper.clientWidth  / 2) / oldScale;
    const canvasCY = (wrapper.scrollTop  + wrapper.clientHeight / 2) / oldScale;

    applyScale();

    // Restore scroll so the same canvas point stays centred
    wrapper.scrollLeft = canvasCX * STATE.scale - wrapper.clientWidth  / 2;
    wrapper.scrollTop  = canvasCY * STATE.scale - wrapper.clientHeight / 2;

    scheduleViewportSave();
}

/**
 * Zooms the canvas out by one step (10%), snapping to the nearest decile.
 * @returns {void}
 */
function zoomOut() {
    const wrapper  = document.getElementById('canvas-wrapper');
    if (!wrapper) return;
    const oldScale = STATE.scale;

    // Removes any incremental scale drift during decile snapping
    STATE.scale = Math.max(SCALE_MIN, Math.round((STATE.scale - SCALE_STEP) * 10) / 10);

    const canvasCX = (wrapper.scrollLeft + wrapper.clientWidth  / 2) / oldScale;
    const canvasCY = (wrapper.scrollTop  + wrapper.clientHeight / 2) / oldScale;

    applyScale();

    wrapper.scrollLeft = canvasCX * STATE.scale - wrapper.clientWidth  / 2;
    wrapper.scrollTop  = canvasCY * STATE.scale - wrapper.clientHeight / 2;

    scheduleViewportSave();
}

/**
 * Debounced handler for scroll events that persists the current viewport.
 * @returns {void}
 */
function onViewportScroll() {
    if (STATE.isInitializing) return; // Respect the Shield
    scheduleViewportSave();
}

/**
 * Schedules a debounced viewport save to the backend.
 * @returns {void}
 */
function scheduleViewportSave() {
    clearTimeout(STATE.vpSaveTimer);
    STATE.vpSaveTimer = setTimeout(persistViewport, 1000);
}

/**
 * Sends the current scale and scroll position to the backend for persistence.
 * @returns {Promise<void>}
 */
async function persistViewport() {
    const wrapper = document.getElementById('canvas-wrapper');
    if (!wrapper) return;

    // Persist Canonical Canvas-Center Coordinates (Scale-Independent)
    const centerX = (wrapper.scrollLeft + wrapper.clientWidth  / 2) / STATE.scale;
    const centerY = (wrapper.scrollTop  + wrapper.clientHeight / 2) / STATE.scale;

    await apiPost('/notes/api/viewport', {
        canvas_id: STATE.canvas_id,
        scale:    STATE.scale,
        scroll_x: centerX,
        scroll_y: centerY
    });
}

/**
 * Immediate Persistence: Bypasses the debounce timer for lifecycle events.
 * @returns {void}
 */
function saveViewportImmediate() {
    const wrapper = document.getElementById('canvas-wrapper');
    if (!wrapper) return;

    // Persist Canonical Canvas-Center Coordinates (Scale-Independent)
    const centerX = (wrapper.scrollLeft + wrapper.clientWidth  / 2) / STATE.scale;
    const centerY = (wrapper.scrollTop  + wrapper.clientHeight / 2) / STATE.scale;

    // Use raw fetch with keepalive for absolute persistence during unload
    const params = new URLSearchParams({
        canvas_id: STATE.canvas_id,
        scale:    STATE.scale,
        scroll_x: centerX,
        scroll_y: centerY
    });

    fetch('/notes/api/viewport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
        keepalive: true
    }).catch(err => console.debug('Immediate save silent-failed during unload:', err));
}

/**
 * Note Deletion Bridge.
 * @param {number|string} id - The note ID.
 * @returns {void}
 */
function deleteNote(id) {
    showConfirmModal({
        title: `${getIcon('trash')} Delete Note`,
        message: 'Are you sure you want to permanently remove this sticky note?',
        danger: true,
        confirmText: 'DELETE',
        hideCancel: true,
        onConfirm: async () => {
            const res = await apiPost('/notes/api/delete', { id: id, canvas_id: STATE.canvas_id });
            if (res && res.success) {
                STATE.notes = res.notes;
                renderUI();
                showToast('Note Deleted', 'success');
            }
        }
    });
}

/**
 * Handle Canvas MouseDown to start panning.
 * @param {MouseEvent} e - The mouse event.
 * @returns {void}
 */
function handleCanvasMouseDown(e) {
    // Only trigger panning if clicking directly on the canvas background
    if (e.target.id !== 'notes-canvas') return;
    if (e.button !== 0) return; // Left-click only

    const wrapper = document.getElementById('canvas-wrapper');
    if (!wrapper) return;

    STATE.isPanning = true;
    STATE.panStart = {
        x: e.clientX,
        y: e.clientY,
        scrollX: wrapper.scrollLeft,
        scrollY: wrapper.scrollTop
    };

    document.body.style.cursor = 'grabbing';
    e.preventDefault();
}

/**
 * Global MouseMove handler for active panning.
 * @param {MouseEvent} e - The mouse event.
 * @returns {void}
 */
function handleCanvasMouseMove(e) {
    if (!STATE.isPanning) return;

    const wrapper = document.getElementById('canvas-wrapper');
    if (!wrapper) return;

    const dx = e.clientX - STATE.panStart.x;
    const dy = e.clientY - STATE.panStart.y;

    // Movement is -dx/-dy because we are scrolling the container opposite to drag direction
    wrapper.scrollLeft = STATE.panStart.scrollX - dx;
    wrapper.scrollTop  = STATE.panStart.scrollY - dy;
}

/**
 * Global MouseUp handler to terminate panning.
 * @returns {void}
 */
function handleCanvasMouseUp() {
    if (!STATE.isPanning) return;
    
    STATE.isPanning = false;
    document.body.style.cursor = '';
    
    // Viewport persistence is automatically handled by the wrapper's scroll listener
}

/**
 * Handle Mouse Wheel Zooming: Cursor-Centric Magnification.
 * @param {WheelEvent} e - The wheel event.
 * @returns {void}
 */
function handleCanvasWheel(e) {
    if (!e.ctrlKey) return; // Only zoom when Ctrl is held
    e.preventDefault();

    const wrapper = document.getElementById('canvas-wrapper');
    if (!wrapper) return;

    const oldScale = STATE.scale;
    const step     = 0.1;
    
    if (e.deltaY < 0) {
        STATE.scale = Math.min(3.0, Math.round((STATE.scale + step) * 10) / 10);
    } else {
        STATE.scale = Math.max(0.1, Math.round((STATE.scale - step) * 10) / 10);
    }

    if (STATE.scale === oldScale) return;

    // Viewport-relative mouse positions
    const rect = wrapper.getBoundingClientRect();
    const mouseVX = e.clientX - rect.left;
    const mouseVY = e.clientY - rect.top;

    // Canvas-space coordinates under the cursor
    const canvasMX = (wrapper.scrollLeft + mouseVX) / oldScale;
    const canvasMY = (wrapper.scrollTop  + mouseVY) / oldScale;

    applyScale();

    // Adjust scroll to keep the cursor fixed on the canvas coordinate
    wrapper.scrollLeft = canvasMX * STATE.scale - mouseVX;
    wrapper.scrollTop  = canvasMY * STATE.scale - mouseVY;

    scheduleViewportSave();
}

/**
 * Handle Canvas Double Click to create notes.
 * @param {MouseEvent} e - The mouse event.
 * @returns {void}
 */
function handleCanvasDoubleClick(e) {
    if (!STATE.editMode) return;
    if (e.target.id !== 'notes-canvas') return;

    createNote('text');
}

/**
 * Creates a new note at the center of the current viewport.
 * @param {string} type - Note type ('text' or 'image').
 * @returns {void}
 */
function createNote(type) {
    showCreateNoteModal(type);
}

/**
 * View Note Modal Lifecycle.
 * @param {number|string} id - The note ID.
 * @returns {void}
 */
function viewNote(id) {
    const note = STATE.notes.find(n => n.id == id);
    if (!note || note.type === 'image') return;

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
 * Copies the currently viewed note content to the clipboard.
 * @returns {Promise<void>}
 */
/**
 * Copies a persistent deep-link for a specific note to the clipboard.
 * @param {number|string} id - The note ID.
 * @returns {void}
 */
function copyNoteLink(id) {
    const url = new URL(window.location.href);
    url.searchParams.set('note_id', id);
    const link = url.toString();

    navigator.clipboard.writeText(link).then(() => {
        showToast('Direct Link Copied', 'success');
    }).catch(err => {
        console.error('Clipboard copy failed:', err);
        showToast('Failed to copy link', 'error');
    });
}

/**
 * Copies the currently viewed note content to the clipboard.
 * @returns {Promise<void>}
 */
async function copyViewContent() {
    const pre = document.getElementById('note-view-content');
    if (!pre) return;
    const content = pre.textContent;
    try {
        await navigator.clipboard.writeText(content);
        showToast('Copied to clipboard', 'success');
    } catch (err) {
        showToast('Copy failed', 'error');
    }
}

/**
 * Edit Note Modal Integration.
 * @param {number|string} id - The note ID.
 * @returns {void}
 */
function editNote(id) {
    const note = STATE.notes.find(n => n.id == id);
    if (!note) return;

    // Trigger the Unified Drafting Modal in 'edit' mode
    showCreateNoteModal(note.type, null, id);
}

/**
 * Normalizes legacy color names to hex codes.
 * @param {string} color - The color name or hex code.
 * @returns {string} - The normalized hex code.
 */
function normalizeColorHex(color) {
    if (/^#[0-9A-F]{6}$/i.test(color)) return color;
    
    const map = {
        'amber':   '#f59e0b',
        'blue':    '#3b82f6',
        'emerald': '#10b981',
        'rose':    '#f43f5e',
        'violet':  '#8b5cf6',
        'indigo':  '#6366f1',
        'slate':   '#64748b',
        'green':   '#22c55e',
        'red':     '#ef4444'
    };
    
    return map[color] || '#f59e0b';
}

/**
 * Collapse/Expand Synchronization.
 * @param {number|string} id - The note ID.
 * @returns {Promise<void>}
 */
async function toggleCollapse(id) {
    const note = STATE.notes.find(n => n.id == id);
    const el = document.getElementById(`note-${id}`);
    if (!note || !el) return;

    note.is_collapsed = note.is_collapsed ? 0 : 1;
    el.classList.add('pending');
    
    try {
        const res = await apiPost('/notes/api/save', {
            id: id,
            canvas_id: STATE.canvas_id,
            title: note.title,
            is_collapsed: note.is_collapsed,
            is_options_expanded: note.is_options_expanded,
            content: note.content,
            x: note.x,
            y: note.y,
            width: note.width,
            height: note.height,
            color: note.color,
            z_index: note.z_index
        });
        
        if (res && res.success) {
            STATE.notes = res.notes;
            renderUI();
        }
    } finally {
        el.classList.remove('pending');
    }
}

/**
 * Drag-and-Drop Image Integration.
 * @returns {void}
 */
function initDropZones() {
    const canvas = document.getElementById('notes-canvas');
    if (!canvas) return;

    canvas.addEventListener('dragover', (e) => {
        e.preventDefault();
        canvas.classList.add('drag-active');
    });

    canvas.addEventListener('dragleave', () => {
        canvas.classList.remove('drag-active');
    });

    canvas.addEventListener('drop', async (e) => {
        e.preventDefault();
        canvas.classList.remove('drag-active');

        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].type.startsWith('image/')) {
            await handleImageDrop(files[0], e.offsetX, e.offsetY);
        }
    });
}

/**
 * Multipart Image Upload Orchestrator.
 * @param {File} file - The image file.
 * @param {number} x - Horizontal coordinate.
 * @param {number} y - Vertical coordinate.
 * @param {string|null} customTitle - Optional title.
 * @returns {Promise<void>}
 */
async function handleImageDrop(file, x, y, customTitle = null) {
    if (!file) return;

    const formData = new FormData();
    formData.append('file',      file);
    formData.append('x',         Math.round(x));
    formData.append('y',         Math.round(y));
    formData.append('z_index',   STATE.notes.length + 1);
    formData.append('canvas_id', STATE.canvas_id);
    
    if (customTitle) {
        formData.append('title', customTitle);
    }

    const uploadRes = await apiPost('/notes/api/upload', formData);
    if (uploadRes && uploadRes.success) {
        await loadState(false, STATE.canvas_id); // Refresh notes only
        showToast('Image Note Created', 'success');
    }
}

/**
 * Global Keyboard Interface: Detects clipboard pasting (Ctrl+V) across the viewport.
 * @param {ClipboardEvent} e - The clipboard event.
 * @returns {Promise<void>}
 */
async function handleGlobalClipPaste(e) {
    // If we're already interacting with a modal or input, don't trigger new note
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;

    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    
    for (const item of items) {
        // Priority 1: Images
        if (item.type.startsWith('image/')) {
            const blob = item.getAsFile();
            const reader = new FileReader();
            reader.onload = (ev) => showCreateNoteModal('image', ev.target.result);
            reader.readAsDataURL(blob);
            return;
        }
        // Priority 2: Text
        if (item.type === 'text/plain') {
            item.getAsString((text) => {
                if (text && text.trim().length > 0) {
                    showCreateNoteModal('text', text);
                }
            });
            return;
        }
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
    const container   = document.getElementById('create-note-preview');
    const titleInput  = document.getElementById('create-note-title');
    const headerLabel = document.getElementById('draft-header-label');
    const btnIcon     = document.getElementById('draft-btn-icon');
    const btnText     = document.getElementById('draft-btn-text');
    const colorPicker = document.getElementById('create-note-color');
    const colorHex    = document.getElementById('create-note-color-hex');

    if (!modal || !container || !titleInput) return;

    container.innerHTML = '';
    DRAFT_NOTE = { type, data, id: editId };

    if (editId) {
        const note = STATE.notes.find(n => n.id == editId);
        if (!note) return;

        // Edit Mode Initialization
        if (headerLabel) headerLabel.textContent = 'Edit Note';
        if (btnText)     btnText.textContent     = 'Save';
        if (btnIcon)     btnIcon.innerHTML       = getIcon('save');

        titleInput.value = note.title || '';
        if (colorPicker) colorPicker.value = normalizeColorHex(note.color);
        if (colorHex)    colorHex.value    = colorPicker.value.toUpperCase();

        if (type === 'text') {
            const editor = document.createElement('textarea');
            editor.className = 'create-preview-text';
            editor.id        = 'create-note-editor';
            editor.spellcheck = false;
            editor.value     = note.content || '';
            container.appendChild(editor);
        } else if (type === 'image') {
            const img = document.createElement('img');
            img.className = 'create-preview-image';
            img.src       = `/notes/serve/${note.id}`;
            container.appendChild(img);
            
            // Subtle Indicator: Images are immutable via this interface
            const tip = document.createElement('div');
            tip.className = 'create-edit-tip';
            tip.innerHTML = `${getIcon('info')} Image content is preserved`;
            container.appendChild(tip);
        }
    } else if (data) {
        // Initialization for pasted notes
        if (headerLabel) headerLabel.textContent = 'Paste from Clipboard';
        if (btnText)     btnText.textContent     = 'Create Note';
        if (btnIcon)     btnIcon.innerHTML       = getIcon('checklist');

        titleInput.value = (type === 'text' ? 'Pasted Note' : 'Pasted Image');
        if (colorPicker) colorPicker.value = '#f59e0b';
        if (colorHex)    colorHex.value    = '#F59E0B';

        if (type === 'text') {
            const editor = document.createElement('textarea');
            editor.className = 'create-preview-text';
            editor.id        = 'create-note-editor';
            editor.spellcheck = false;
            editor.value     = data;
            container.appendChild(editor);
        } else if (type === 'image') {
            const img = document.createElement('img');
            img.className = 'create-preview-image';
            img.src       = data; // Data URL from FileReader
            container.appendChild(img);
        }
    } else {
        // New Note Mode
        if (headerLabel) headerLabel.textContent = 'Add New Note';
        if (btnText)     btnText.textContent     = 'Create Note';
        if (btnIcon)     btnIcon.innerHTML       = getIcon('checklist');

        titleInput.value = '';
        titleInput.placeholder = (type === 'text' ? 'Note Title...' : 'Image Title...');
        if (colorPicker) colorPicker.value = '#f59e0b';
        if (colorHex)    colorHex.value    = '#F59E0B';

        if (type === 'text') {
            const editor = document.createElement('textarea');
            editor.className = 'create-preview-text';
            editor.id        = 'create-note-editor';
            editor.spellcheck = false;
            editor.placeholder = 'Start typing your thoughts...';
            container.appendChild(editor);
        }
    }

    modal.classList.add('show');
    modal.classList.add('active'); // State Sync (Synchronized with closure engine)
    document.body.classList.add('modal-open');
    setTimeout(() => {
        titleInput.focus();
        titleInput.select();
    }, 100);
}

/**
 * Standard Creation Orchestrator: Finalizes the drafting action.
 * @returns {Promise<void>}
 */
async function executeCreateNote() {
    if (!DRAFT_NOTE) return;

    const { type, data, id } = DRAFT_NOTE;
    const titleInput = document.getElementById('create-note-title');
    const title = titleInput?.value || (type === 'text' ? 'New Note' : 'New Image');
    const colorPicker = document.getElementById('create-note-color');
    const color = colorPicker?.value || '#f59e0b';
    const note  = id ? STATE.notes.find(n => n.id == id) : null;
    
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
    confirmBtn.innerHTML = `${getIcon('waiting')} Saving...`;

    try {
        if (type === 'text') {
            const editor = document.getElementById('create-note-editor');
            const content = editor?.value || '';
            const params = {
                id,
                canvas_id: STATE.canvas_id,
                type: 'text',
                title,
                content,
                color,
                ...coords
            };
            const res = await apiPost('/notes/api/save', params);
            if (res && res.success) {
                closeCreateModal();
                await loadState(false, STATE.canvas_id);
                showToast(id ? 'Note Updated' : 'Note Created', 'success');
            }
        } else if (type === 'image') {
            const params = {
                id,
                canvas_id: STATE.canvas_id,
                type: 'image',
                title,
                content: note ? note.content : '',
                color,
                ...coords
            };
            
            const res = await apiPost('/notes/api/save', params);
            if (res && res.success) {
                const noteId = res.id;
                
                if (data && data.startsWith('data:')) {
                    const blob = await (await fetch(data)).blob();
                    const formData = new FormData();
                    formData.append('file', blob, 'creation_image.png');
                    formData.append('note_id', noteId);
                    formData.append('canvas_id', STATE.canvas_id);

                    const uploadRes = await apiPost('/notes/api/upload', formData);
                    if (uploadRes && uploadRes.success) {
                        closeCreateModal();
                        await loadState(false, STATE.canvas_id);
                        showToast('Image Note Created', 'success');
                    }
                } else {
                    closeCreateModal();
                    showToast('Image Header Updated', 'success');
                    await loadState(false, STATE.canvas_id);
                }
            }
        }
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
        modal.classList.remove('active'); // Clear active state
        document.body.classList.remove('modal-open'); // Release scroll lock
        DRAFT_NOTE = null;
        const titleInput = document.getElementById('create-note-title');
        if (titleInput) titleInput.value = '';
        const preview = document.getElementById('create-note-preview');
        if (preview) preview.innerHTML = '';
    }
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
    filterSearch('');
    
    // Focus titration for immediate gesture interaction
    setTimeout(() => input.focus(), 100);
}

let SEARCH_DEBOUNCE_TIMER;
let CURRENT_SEARCH_RESULTS = [];

/**
 * Discovery Engine: Orchestrates local filtering or global board-wide search.
 * @param {string} queryText - The raw search input.
 * @returns {void}
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

    // Unify Debounce: Ensures performance even for local filter cycles
    SEARCH_DEBOUNCE_TIMER = setTimeout(async () => {
        if (isGlobal) {
            const res = await fetch(`/notes/api/search?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            renderSearchResults(data, true);
        } else {
            const q = query.toLowerCase();
            const results = STATE.notes.filter(n => 
                (n.title && n.title.toLowerCase().includes(q)) || 
                (n.content && n.content.toLowerCase().includes(q))
            );
            renderSearchResults(results, false);
        }
    }, 250);
}

/**
 * Result Rendering Engine: Generates the search result grid with board context.
 * @param {Array} results - The note result set.
 * @param {boolean} isGlobal - Whether global indicators should match.
 * @returns {void}
 */
function renderSearchResults(results, isGlobal) {
    const container = document.getElementById('search-results-container');
    if (!container) return;

    CURRENT_SEARCH_RESULTS = results;

    if (results.length === 0) {
        container.innerHTML = `
            <div class="search-empty-state">
                <span class="global-icon">${window.getIcon('search')}</span>
                <p>No matches found in ${isGlobal ? 'any of your whiteboards' : 'the current board'}</p>
            </div>
        `;
        return;
    }

    container.innerHTML = results.map(note => `
        <div class="search-result-item" style="--note-accent: ${note.color || '#3b82f6'}" onclick="handleSearchResultClick(${note.id})">
            <div class="search-result-icon">
                <span class="global-icon">${window.getIcon(note.type === 'image' ? 'file_image' : 'edit')}</span>
            </div>
            <div class="search-result-info">
                <div class="search-result-path">
                    ${window.getIcon('notebook')} ${escapeHtml(note.canvas_name || 'Board')} <span class="path-separator">❯</span>
                </div>
                <div class="search-result-title">${escapeHtml(note.title || 'Untitled Note')}</div>
                <div class="search-result-snippet">${escapeHtml(note.content || '').substring(0, 80)}${note.content && note.content.length > 80 ? '...' : ''}</div>
            </div>
            <div class="search-result-action">
                <span class="global-icon">${window.getIcon('chevron-right')}</span>
            </div>
        </div>
    `).join('');
}

/**
 * Search Outcome Orchestrator: Transition across boards and center on the target note.
 * @param {number|string} id - The note ID.
 * @returns {void}
 */
async function handleSearchResultClick(id) {
    const note = CURRENT_SEARCH_RESULTS.find(n => n.id == id);
    if (!note) return;

    // Early Modal Dismissal: Clean the view before asynchronous transposition
    const modal = document.getElementById('note-search-modal');
    if (modal) modal.classList.remove('show');
    
    try {
        // Cross-Board Orchestration Logic
        if (note.canvas_id && note.canvas_id != STATE.canvas_id) {
            await switchCanvas(note.canvas_id, id);
        } else {
            // Local focus navigation: Move viewport immediately
            centerOnNote(id);
        }
    } catch (err) {
        console.error('Navigation Error:', err);
        showToast('Navigation failed: Unable to reach target note', 'error');
        hideLoadingOverlay();
    }
}
/**
 * Search Engine Logic: Dismissal of the search interface.
 * @returns {void}
 */
function closeSearchModal() {
    const modal = document.getElementById('note-search-modal');
    if (modal) modal.classList.remove('show');
    document.body.classList.remove('modal-open');
}

/**
 * Copy Orchestrator: Captures note content (text) or binary image data (blobs) to the clipboard.
 * @param {number|string} id - The note ID.
 * @returns {Promise<void>}
 */
async function copyNoteToClipboard(id) {
    const note = STATE.notes.find(n => n.id == id);
    if (!note) return;

    try {
        if (note.type === 'image') {
            // Binary Sync: Fetch the original blob data
            showToast('Fetching image data...', 'info');
            const response = await fetch(`/notes/serve/${id}`);
            const blob = await response.blob();
            
            // Utilize the ClipboardItem API for binary data synchronization
            const item = new ClipboardItem({ [blob.type]: blob });
            await navigator.clipboard.write([item]);
            showToast('Image data copied to clipboard', 'success');
        } else {
            // Standard Text Sync: Direct string write
            const targetText = note.content || '';
            await navigator.clipboard.writeText(targetText);
            showToast('Note content copied to clipboard', 'success');
        }
    } catch (err) {
        console.error('Clipboard Sync Failed:', err);
        showToast('Failed to copy content', 'error');
    }
}

// --- Multi-Canvas & Sharing UI Logic ---

/**
 * Open the Board Management modal.
 */
function openCanvasManager() {
    const modal = document.getElementById('canvas-manager-modal');
    if (!modal) return;
    
    modal.classList.add('active');
    loadCanvases();
}

function closeCanvasManager() {
    const modal = document.getElementById('canvas-manager-modal');
    if (modal) modal.classList.remove('active');
    // Clear scroll-lock
    document.body.classList.remove('modal-open');
}

/**
 * Populates the board list in the manager.
 */
function loadCanvases() {
    const container = document.getElementById('canvas-list-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    STATE.canvases.forEach(canvas => {
        const item = document.createElement('div');
        item.className = `canvas-item ${canvas.id == STATE.canvas_id ? 'active' : ''}`;
        
        const isOwner = canvas.user_id == STATE.user_id;
        
        item.innerHTML = `
            <div class="canvas-info" onclick="switchCanvas(${canvas.id})">
                <div class="canvas-name-row">
                    <span class="canvas-name">${escapeHtml(canvas.name)}</span>
                    ${canvas.id == STATE.canvas_id ? `<span class="active-badge">${window.getIcon('ai')} Active</span>` : ''}
                </div>
                <div class="canvas-meta">
                    ${isOwner ? 'Owned by you' : 'Shared by ' + (canvas.owner_name || 'System')}
                </div>
            </div>
            <div class="canvas-actions">
                ${isOwner ? `
                    <button class="btn-icon-square btn-sm btn-primary" onclick="openBoardSettings(${canvas.id})" title="Board Settings">
                        ${window.getIcon('settings')}
                    </button>
                ` : ''}
                ${isOwner && canvas.name !== 'Your Notebook' ? `
                    <button class="btn-icon-square btn-sm btn-danger" onclick="deleteCanvas(event, ${canvas.id})" title="Delete Board">
                        ${window.getIcon('delete')}
                    </button>
                ` : ''}
            </div>
        `;
        container.appendChild(item);
    });
}

/**
 * Renames a board using the global prompt system.
 */
/**
 * Switches the active whiteboard context.
 */
async function switchCanvas(id, targetNoteId = null) {
    if (id == STATE.canvas_id) {
        closeCanvasManager();
        return;
    }
    
    STATE.canvas_id = id;
    showLoadingOverlay('Cleaning canvas...');
    
    try {
        await loadState(true, id, targetNoteId);
    } finally {
        // Zero-Trust Termination: Always clear the splash screen
        hideLoadingOverlay();
        closeCanvasManager();
    }
    
    showToast('Switched board', 'success');
}

/**
 * Creates a new canonical workspace.
 */
async function createCanvas(name) {
    const res = await apiPost('/notes/api/canvases/create', { name });
    if (res && res.success) {
        document.getElementById('new-canvas-name').value = '';
        await loadState(false, res.id);
        switchCanvas(res.id);
    }
}

/**
 * Opens the unified Board Settings (Rename + Sharing).
 */
async function openBoardSettings(id) {
    const canvas = STATE.canvases.find(c => c.id == id);
    if (!canvas) return;

    // First, close the Manager list to clear the POV
    closeCanvasManager();

    const modal = document.getElementById('canvas-settings-modal');
    if (!modal) return;

    // Reset Context
    document.getElementById('edit-canvas-name').value = canvas.name;
    document.getElementById('save-canvas-name-btn').dataset.canvasId = id;
    document.getElementById('user-search-input').dataset.canvasId = id;

    // If this is NOT the current active board, we need to fetch its specific share list
    // However, for consistency and avoiding state confusion, we fetch it every time we open settings.
    try {
        const res = await fetch(`/notes/api/state?canvas_id=${id}`);
        const data = await res.json();
        if (data.success) {
            renderBoardShares(id, data.share_list || []);
        }
    } catch (e) {
        console.error("Failed to fetch board ACL", e);
        renderBoardShares(id, []);
    }

    modal.classList.add('active');
    document.body.classList.add('modal-open');
}

/**
 * Handles the board renaming from the settings modal.
 */
async function updateBoardName(id, name) {
    const res = await apiPost('/notes/api/canvases/rename', { canvas_id: id, name });
    if (res && res.success) {
        showToast('Board renamed successfully', 'success');
        
        // Update local state and pill if active
        if (id == STATE.canvas_id) {
            const pill = document.getElementById('active-board-name-pill');
            if (pill) pill.textContent = name;
        }

        await loadState(false, STATE.canvas_id); // Refresh boards list
        
        // Auto-close modal on success
        const modal = document.getElementById('canvas-settings-modal');
        if (modal) {
            modal.classList.remove('active');
            document.body.classList.remove('modal-open');
            
            // UX Enhancement: Bring back the Board Manager for faster navigation
            openCanvasManager();
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

    // 1. Retention Check: Prevent users from deleting their ONLY owned workspace
    const ownedCanvases = STATE.canvases.filter(c => c.is_owner);
    if (ownedCanvases.length <= 1) {
        showToast('Retention Error: You must maintain at least one Notebook.', 'error');
        return;
    }
    
    window.showConfirmModal({
        title: 'Delete Board?',
        icon: 'delete',
        message: 'This will permanently destroy all notes and images on this board. This action cannot be undone.',
        danger: true,
        hideCancel: true,
        confirmText: 'DELETE',
        confirmIcon: 'delete',
        onConfirm: async () => {
            const res = await apiPost('/notes/api/canvases/delete', { canvas_id: id });
            if (res && res.success) {
                // If we deleted the current board, switch back to the first available
                if (id == STATE.canvas_id) {
                    await loadState(true);
                } else {
                    // Just refresh the list
                    await loadState(false, STATE.canvas_id);
                }
                loadCanvases();
                showToast('Board destroyed', 'success');
            } else {
                throw new Error(res.error || 'Failed to destroy board');
            }
        }
    });
}

/**
 * Closes the Board Settings modal.
 */
function closeBoardSettings() {
    const modal = document.getElementById('canvas-settings-modal');
    if (modal && modal.classList.contains('active')) {
        modal.classList.remove('active');
        // Clear scroll-lock
        document.body.classList.remove('modal-open');
        // Return context to the Boards Manager list (as requested in Step 28)
        openCanvasManager();
    }
}

/**
 * Renders the collaborators for a specific board into the settings modal.
 */
function renderBoardShares(id, shares = null) {
    const shareList = document.getElementById('canvas-share-list');
    if (!shareList) return;

    shareList.innerHTML = '';
    // Use the provided list (for per-board settings) or fall back to the global state
    const targetList = shares || STATE.share_list;
    
    targetList.forEach(share => {
        const item = document.createElement('div');
        item.className = 'share-item';
        item.innerHTML = `
            <div class="share-user-info">
                <span class="share-username">${escapeHtml(share.username)}</span>
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
                    ${window.getIcon('delete')}
                </button>
            </div>
        `;
        shareList.appendChild(item);
    });
}

/**
 * Setup search-as-you-type for user selection.
 */
function setupUserSearch() {
    const input = document.getElementById('user-search-input');
    const results = document.getElementById('user-search-results');
    if (!input || !results) return;

    let searchTimer;
    input.addEventListener('input', (e) => {
        const q = e.target.value;
        clearTimeout(searchTimer);
        if (q.length < 2) {
            results.style.display = 'none';
            return;
        }

        searchTimer = setTimeout(async () => {
            const res = await fetch(`/notes/api/users/search?q=${encodeURIComponent(q)}`);
            const users = await res.json();
            
            results.innerHTML = '';
            if (users.length > 0) {
                users.forEach(u => {
                    const div = document.createElement('div');
                    div.className = 'search-result-item';
                    div.textContent = u.username;
                    div.onclick = () => {
                        addShare(input.dataset.canvasId, u.username);
                        results.style.display = 'none';
                        input.value = '';
                    };
                    results.appendChild(div);
                });
                results.style.display = 'block';
            } else {
                results.style.display = 'none';
            }
        }, 300);
    });
}

async function addShare(canvasId, username) {
    const res = await apiPost('/notes/api/canvases/share', { canvas_id: canvasId, username, can_edit: 1 });
    if (res && res.success) {
        // Update local state ONLY if it's the currently active board
        if (canvasId == STATE.canvas_id) {
            STATE.share_list = res.share_list;
        }
        renderBoardShares(canvasId, res.share_list);
        showToast('Shared successfully', 'success');
    }
}

async function updateSharePermission(canvasId, username, canEdit) {
    const res = await apiPost('/notes/api/canvases/share', { canvas_id: canvasId, username, can_edit: canEdit });
    if (res && res.success) {
        STATE.share_list = res.share_list;
        showToast('Permissions updated', 'success');
    }
}

/**
 * Triggers a themed confirmation before revoking access.
 */
function confirmRevoke(canvasId, username) {
    showConfirmModal({
        title: 'Revoke Access',
        message: `Are you sure you want to revoke access for <strong>${username}</strong>?`,
        subMessage: 'They will immediately lose all permissions to this board.',
        icon: 'delete',
        danger: true,
        hideCancel: true,
        confirmText: 'DELETE',
        confirmIcon: 'delete',
        onConfirm: async () => {
            await revokeShare(canvasId, username);
        }
    });
}

async function revokeShare(canvasId, username) {
    const res = await apiPost('/notes/api/canvases/share', { canvas_id: canvasId, username, revoke: 1 });
    if (res && res.success) {
        // Update local state ONLY if it's the currently active board
        if (canvasId == STATE.canvas_id) {
            STATE.share_list = res.share_list;
        }
        renderBoardShares(canvasId, res.share_list);
        showToast('Access revoked', 'info');
    }
}

// --- Note Migration (Send to Canvas) ---

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
                    ${window.getIcon('move')}
                </button>
            </div>
        `;
        list.appendChild(item);
    });
    
    if (list.children.length === 0) {
        list.innerHTML = '<p style="text-align:center; padding:20px; color:#64748b;">No other editable boards found.</p>';
    }

    modal.classList.add('active');
}

function closeMoveModal() {
    const modal = document.getElementById('move-note-modal');
    if (modal) modal.classList.remove('active');
}

/**
 * Board Duplication Logic: Clones the record onto the target board.
 * @param {number|string} id - The note ID.
 * @param {number|string} canvas_id - The target canvas ID.
 * @returns {Promise<void>}
 */
async function copyNoteToBoard(id, canvas_id) {
    const res = await apiPost('/notes/api/notes/copy', { id, canvas_id });
    if (res && res.success) {
        showToast('Note copied to board successfully', 'success');
        closeMoveModal(); // Corrected modal termination handler
    } else {
        showToast(res.error || 'Duplication Failed', 'error');
    }
}
