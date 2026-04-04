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
    canvas_id:  1,        // Active Whiteboard Context
    vpSaveTimer: null,    // Debounce handle for viewport persistence
    isInitializing: false, // Shield to prevent save-during-load race conditions
    pickedNoteId:   null,  // Active 'Pick & Place' record
    originalPos:    null,  // Restore-point for 'Escape-to-Cancel'
    dragOffset:     { x: 0, y: 0 } // Dynamic delta for 'Pick & Place'
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
    const canvas = document.getElementById('notes-canvas');
    if (canvas) {
        canvas.addEventListener('dblclick', handleCanvasDoubleClick);
    }
    
    document.getElementById('zoom-in').addEventListener('click', zoomIn);
    document.getElementById('zoom-out').addEventListener('click', zoomOut);
    document.getElementById('add-text-note').addEventListener('click', () => showCreateNoteModal('text'));
    document.getElementById('center-view').addEventListener('click', centerView);
    document.getElementById('focus-recent').addEventListener('click', focusMostRecentNote);
    document.getElementById('open-search').addEventListener('click', openSearchModal);

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
    setupGlobalModalClosing(['modal-overlay'], [closeViewModal, closeCreateModal, closeSearchModal]);
    document.querySelectorAll('[data-close="modal"]').forEach(btn => {
        btn.onclick = () => {
            closeViewModal();
            closeCreateModal();
            closeSearchModal();
        };
    });

    // Copy button in the view modal
    document.getElementById('note-view-copy-btn').addEventListener('click', copyViewContent);

    // Persist scroll position on scroll (debounced)
    const wrapper = document.getElementById('canvas-wrapper');
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
async function loadState(initial = false, canvas_id = null) {
    if (initial) STATE.isInitializing = true; // Activate Shield for initial restoration
    
    // Default to the current state context if no ID is provided
    const tid = canvas_id || STATE.canvas_id || 1;

    try {
        const response = await fetch(`/notes/api/state?canvas_id=${tid}`);
        const data = await response.json();
        
        if (data.success) {
            STATE.notes     = data.notes;
            STATE.user_id   = data.user_id;
            STATE.canvas_id = data.canvas_id || tid;

            // Only restore perspective if this is the initial load
            if (initial && data.viewport) {
                STATE.scale = parseFloat(data.viewport.scale) || 1.0;
                applyScale();

                // Restore canonical perspective (X, Y Center) across scale levels
                requestAnimationFrame(() => {
                    const wrapper = document.getElementById('canvas-wrapper');
                    if (!wrapper) return;

                    // Calculate the scroll position from the canonical canvas-center coordinates
                    const centerX = parseFloat(data.viewport.scroll_x) || (STATE.canvasSize / 2);
                    const centerY = parseFloat(data.viewport.scroll_y) || (STATE.canvasSize / 2);

                    wrapper.scrollLeft = (centerX * STATE.scale) - (wrapper.clientWidth  / 2);
                    wrapper.scrollTop  = (centerY * STATE.scale) - (wrapper.clientHeight / 2);
                    
                    // Deactivate Shield after a micro-delay stabilizers
                    setTimeout(() => { STATE.isInitializing = false; }, 200);
                });
            } else if (initial) {
                centerView();
                STATE.isInitializing = false;
            }

            renderUI();
        } else {
            showToast('Failed to load whiteboard state', 'error');
            if (initial) STATE.isInitializing = false;
        }
    } catch (err) {
        console.error('loadState Error:', err);
        if (initial) STATE.isInitializing = false;
    }
}

/**
 * Renders all sticky notes and updates the UI state.
 * @returns {void}
 */
function renderUI() {
    const canvas = document.getElementById('notes-canvas');
    if (!canvas) return;
    
    // Purge existing elements (Except for permanent overlays/skeletons)
    const existingNotes = canvas.querySelectorAll('.sticky-note');
    existingNotes.forEach(n => n.remove());
    
    // Hide skeleton if populated
    const skeleton = document.getElementById('canvas-skeleton');
    if (skeleton && STATE.notes.length > 0) skeleton.classList.add('hidden');

    STATE.notes.forEach(note => {
        const noteEl = createNoteElement(note);
        canvas.appendChild(noteEl);
        if (STATE.editMode) {
            makeDraggable(noteEl);
            initResizable(noteEl, note);
        }
    });
}

/**
 * Creates the DOM element for a sticky note.
 * @param {Object} note - The note data object.
 * @returns {HTMLElement} - The created note element.
 */
function createNoteElement(note) {
    const div = document.createElement('div');
    div.className = `sticky-note ${note.is_collapsed ? 'collapsed' : ''}`;
    div.id = `note-${note.id}`;
    div.dataset.id = note.id;
    
    // Apply custom accent color via CSS variable for high-precision rendering
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
            <div class="note-drag-handle-container">
                <div class="note-title-slot">${escapeHtml(note.title || 'Untitled Note')}</div>
                <div class="note-drag-handle">${getIcon('move')}</div>
            </div>
            <div class="note-actions">
                <div class="note-actions-drawer ${note.is_options_expanded ? 'expanded' : ''}" id="drawer-${note.id}">
                    <button class="btn-icon-sticky" onclick="toggleStickyMove(event, ${note.id})" title="Pick & Place (Sticky Move)">
                        ${getIcon('pin')}
                    </button>
                    <button class="btn-icon-view" onclick="viewNote(${note.id})" title="Quick View">
                        ${getIcon('view')}
                    </button>
                    <button class="btn-icon-collapse" onclick="toggleCollapse(${note.id})" title="Toggle Collapse">
                        ${getIcon(note.is_collapsed ? 'expand' : 'collapse')}
                    </button>
                    <button class="btn-icon-edit" onclick="editNote(${note.id})" title="Edit Content">
                        ${getIcon('edit')}
                    </button>
                    <button class="btn-icon-delete" onclick="deleteNote(${note.id})" title="Delete Note">
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
        if (btnText)     btnText.textContent     = 'Save Changes';
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

/**
 * Live-Filtering Logic: Scrutinizes notes across title and content fields.
 * @param {string} query - The search query.
 * @returns {void}
 */
function filterSearch(query) {
    const container = document.getElementById('search-results-container');
    if (!container) return;

    const q = query.toLowerCase().trim();
    const results = q === '' 
        ? STATE.notes 
        : STATE.notes.filter(n => 
            (n.title && n.title.toLowerCase().includes(q)) || 
            (n.content && n.content.toLowerCase().includes(q))
          );

    if (results.length === 0) {
        container.innerHTML = `
            <div class="search-empty-state">
                <span class="global-icon">${getIcon('search')}</span>
                <p>${q === '' ? 'No notes found on this canvas' : 'No matches found for "' + query + '"'}</p>
            </div>
        `;
        return;
    }

    container.innerHTML = results.map(note => `
        <div class="search-result-item" style="--note-accent: ${note.color || '#3b82f6'}" onclick="handleSearchResultClick(${note.id})">
            <div class="search-result-icon">
                <span class="global-icon">${getIcon(note.type === 'image' ? 'file_image' : 'edit')}</span>
            </div>
            <div class="search-result-info">
                <div class="search-result-title">${escapeHtml(note.title || 'Untitled Note')}</div>
                <div class="search-result-snippet">${escapeHtml(note.content || '').substring(0, 80)}${note.content && note.content.length > 80 ? '...' : ''}</div>
            </div>
            <div class="search-result-action">
                <span class="global-icon">${getIcon('chevron-right')}</span>
            </div>
        </div>
    `).join('');
}

/**
 * Search Outcome Orchestrator: Centers the view and dismisses the interface.
 * @param {number|string} id - The note ID.
 * @returns {void}
 */
function handleSearchResultClick(id) {
    const modal = document.getElementById('note-search-modal');
    if (modal) modal.classList.remove('show');
    
    centerOnNote(id);
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
