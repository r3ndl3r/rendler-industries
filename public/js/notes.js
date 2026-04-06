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
    canvasSize: 50000,
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
    heartbeatTimer: null,           // Active Polling Reference
    isDragging:     false,          // Note Movement State
    isResizing:     false,          // Note Dimensions State
    isEditingNote:  false,          // Inline Editor Active State
    activeLayerId:  1,               // Level Isolation Filter (1-99)
    layer_map:      {},              // Shared Level Aliases { layer_id => alias }
    isSwitchingLayer: false,         // Interaction Guard: Prevents overlapping transitions
    note_map:       {},              // Metadata Registry for [note:#] resolution
    autoScroll: {
        lastEvent: null,
        frame:     null,
        active:    false,
        margin:    80,             // Proximity triggers (px)
        maxSpeed:  15              // Peak velocity at absolute edge
    },
    syncQueue:      [],              // Transactional Retry Container
    isSyncing:      false,           // Flow Control: Prevents concurrent flush cycles
    aliasTimer:     null,            // Lifecycle Handle: Auto-hide delay for level names
    isScrubbing:    false,           // Interaction Layer: Active radar-panning state
    radarScrubLast: { x: 0, y: 0 },   // Delta Tracking: Powering the 'Precision Gearbox'
    showRadar:      localStorage.getItem('notes_show_radar') === 'true' // Persistence: Defaults to closed
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
    
    // Global Panning & Scrubbing Listeners
    window.addEventListener('mousemove', (e) => {
        handleCanvasMouseMove(e);
        handleRadarMouseMove(e);
    });
    window.addEventListener('mouseup', (e) => {
        handleCanvasMouseUp(e);
        handleRadarMouseUp(e);
    });
    
    document.getElementById('zoom-in').addEventListener('click', zoomIn);
    document.getElementById('zoom-out').addEventListener('click', zoomOut);
    document.getElementById('add-text-note').addEventListener('click', () => showCreateNoteModal('text'));
    document.getElementById('center-view').addEventListener('click', centerView);
    document.getElementById('focus-recent').addEventListener('click', focusMostRecentNote);
    document.getElementById('open-search').addEventListener('click', openSearchModal);
    document.getElementById('open-canvas-manager').addEventListener('click', openCanvasManager);
    document.getElementById('open-note-bin').addEventListener('click', openBinModal);
    
    const openInfoBtn = document.getElementById('open-info');
    if (openInfoBtn) {
        openInfoBtn.addEventListener('click', showBoardInfo);
    }

    // Radar Minimap Listener: Teleport, Scrubbing & Quick-Zoom
    const radar = document.getElementById('radar-container');
    const rView = document.getElementById('radar-viewport');
    if (radar && rView) {
        radar.addEventListener('mousedown', handleRadarMouseDown);
        radar.addEventListener('wheel',     handleRadarWheel, { passive: false });
    }

    // Radar Initial State Sync
    renderRadarState();

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
    setupGlobalModalClosing(['modal-overlay'], [closeViewModal, closeCreateModal, closeSearchModal, closeCanvasManager, closeMoveModal, closeBoardSettings, closeBinModal]);
    
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
            closeBinModal();
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
 * Restores viewport scale and scroll position during initial onboarding OR level switching.
 * @param {boolean} initial - Whether this is the initial load.
 * @param {number|null} canvas_id - Optional specific canvas ID.
 * @param {number|null} targetNoteId - Optional target note for centering.
 * @param {number|null} layer_id - Optional target layer for perspective restoration.
 * @returns {Promise<void>}
 */
async function loadState(initial = false, canvas_id = null, targetNoteId = null, layer_id = null) {
    if (initial) STATE.isInitializing = true; // Protect interface state during initial hydration
    
    // Resolve context: Prioritize URL param -> Current State -> Backend Default (null)
    const urlParams = new URLSearchParams(window.location.search);
    const tid = canvas_id || urlParams.get('canvas_id') || STATE.canvas_id;
    const nid = targetNoteId || urlParams.get('note_id'); // Deep-link or search-target detection

    try {
        let query = tid ? `?canvas_id=${tid}` : '';
        if (nid) query += (query ? '&' : '?') + `note_id=${nid}`;
        if (layer_id) query += (query ? '&' : '?') + `layer_id=${layer_id}`;

        const response = await fetch(`/notes/api/state${query}`);
        const data = await response.json();
        
        if (data.success) {
            STATE.notes    = data.notes    || [];
            STATE.canvases = data.canvases || [];
            STATE.user_id  = data.user_id;
            STATE.canvas_id  = data.canvas_id; // Resolved active context
            
            // State Synchronization: Baseline alignment with backend truth
            STATE.last_mutation = data.last_mutation;
            STATE.note_map      = data.note_map || {};
            STATE.layer_map     = data.layer_map || {};

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

            // --- Layer Context Synchronization ---
            // If a specific level was requested, we must anchor the STATE and UI immediately,
            // even if no viewport history exists for that level yet.
            if (layer_id) {
                STATE.activeLayerId = parseInt(layer_id);
                updateLevelDisplay();
            }

            // --- Viewport Restoration Strategy ---
            // 1. Mirror Check: Prioritize the local optimistic cache if it's fresher than the server state
            const localVp = getLocalViewport(canvas_id, layer_id || STATE.activeLayerId);
            
            // Cross-Browser Safety: Parse SQL format strings manually for reliable epoch comparison
            let serverTs = 0;
            if (data.viewport && data.viewport.updated_at) {
                const parts = data.viewport.updated_at.split(/[- :]/);
                serverTs = new Date(parts[0], parts[1]-1, parts[2], parts[3], parts[4], parts[5]).getTime();
            }
            
            let useLocal = localVp && (localVp.ts > serverTs);

            if ((initial || layer_id) && !nid && (useLocal || data.viewport)) {
                const vp = useLocal ? localVp : data.viewport;
                
                STATE.scale = parseFloat(vp.scale) || 1.0;
                applyScale();

                if (vp.layer_id) {
                    STATE.activeLayerId = parseInt(vp.layer_id);
                    updateLevelDisplay();
                }

                requestAnimationFrame(() => {
                    const wrapper = document.getElementById('canvas-wrapper');
                    if (!wrapper) return;

                    const centerX = parseFloat(vp.scroll_x) || (STATE.canvasSize / 2);
                    const centerY = parseFloat(vp.scroll_y) || (STATE.canvasSize / 2);

                    wrapper.scrollTo({
                        left: (centerX * STATE.scale) - (wrapper.clientWidth  / 2),
                        top: (centerY * STATE.scale) - (wrapper.clientHeight / 2),
                        behavior: (initial || useLocal) ? 'auto' : 'smooth'
                    });
                    
                    setTimeout(() => { STATE.isInitializing = false; }, 200);
                });
            } else {
                if (initial && !nid) centerView();
                STATE.isInitializing = false;
            }

            // --- Reliability Guardian ---
            // Initialize the Transactional Sync Worker if this is the first boot
            if (initial && !window.SYNC_GUARDIAN_INIT) {
                window.SYNC_GUARDIAN_INIT = true;
                setInterval(processSyncQueue, 30000);
                
                // --- Resource Maintenance ---
                // Prune stale viewport caches to prevent LocalStorage bloat
                pruneLocalStorage();
                
                console.debug("Whiteboard: Transactional Sync Guardian active.");
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
    
    STATE.heartbeatTimer = setInterval(async () => {
        // Interaction Inhibition Check: Strictly prevent background hydration during active user engagement.
        const isInteracting = STATE.isInitializing || 
                              STATE.isPanning      || 
                              STATE.isDragging     || 
                              STATE.isResizing     || 
                              STATE.isEditingNote  || 
                              STATE.pickedNoteId   || 
                              document.querySelector('.modal-overlay.show') || 
                              ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);

        if (isInteracting) return;

        try {
            // High-Precision Sync: Include layer_id to only trigger updates when the active perspective changes.
            const resp = await fetch(`/notes/api/sync/heartbeat/${canvasId}?layer_id=${STATE.activeLayerId}`);
            const data = await resp.json();

            if (data.success && data.last_mutation) {
                // Reactive Trigger: If the server reports a newer mutation than our local state
                if (STATE.last_mutation && data.last_mutation > STATE.last_mutation) {
                    // Execution Reality: Only update the local baseline AFTER successful state re-hydration.
                    if (await loadState(false, canvasId, null, STATE.activeLayerId)) {
                        STATE.last_mutation = data.last_mutation;
                    }
                } else {
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
        // Isolation Filter: Only render notes belonging to the current active level
        if (note.layer_id != STATE.activeLayerId) return;

        const noteEl = createNoteElement(note, canEdit);
        canvas.appendChild(noteEl);
        
        if (STATE.editMode && canEdit) {
            makeDraggable(noteEl);
            initResizable(noteEl, note);
        }
    });

    // Radar Integration: Update the Birds-Eye perspective in atomic sync
    updateRadar();
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
        const viewerHtml = formatNoteContent(note.content, note.id);
        contentHtml = `
            <div class="note-content">
                <div class="note-text-viewer" data-id="${note.id}">${viewerHtml}</div>
                <textarea readonly onkeydown="handleNoteKeydown(event, ${note.id})">${window.escapeHtml(note.content || '')}</textarea>
            </div>
        `;
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
            <span class="note-id-hash" onclick="copyNoteId(event, ${note.id})" title="Click to copy Note ID #${note.id}">#</span>
            <input type="color" class="inline-color-input" value="${accentColor}" 
                   oninput="updateNoteAccent(this, ${note.id})" title="Change Note Color" ${canEdit ? '' : 'disabled'}>
            
            <div class="note-drag-handle-container" onclick="toggleStickyMove(event, ${note.id})" title="Click anywhere in the title bar to Pick and Place (Sticky Move)">
                <div class="note-title-slot">
                    ${escapeHtml(note.title || 'Untitled Note')}
                </div>
                <input type="text" class="inline-title-input" value="${escapeHtml(note.title || '')}" 
                       onclick="event.stopPropagation()"
                       placeholder="Note Title..." autocomplete="off">
            </div>
            <div class="note-actions">
                <div class="note-actions-drawer ${note.is_options_expanded ? 'expanded' : ''}" id="drawer-${note.id}">
                    <button class="btn-icon-copy" onclick="copyNoteToClipboard(${note.id})" title="Copy to Clipboard">
                        📋
                    </button>
                    <button class="btn-icon-link" onclick="copyNoteLink(${note.id})" title="Copy Direct Link">
                        🔗
                    </button>
                    <button class="btn-icon-move" onclick="openMoveModal(event, ${note.id})" title="Copy to Canvas" ${canEdit ? '' : 'disabled'}>
                        📦
                    </button>
                    <button class="btn-icon-level-copy" onclick="openLayerActionModal(${note.id})" title="Copy to Level" ${canEdit ? '' : 'disabled'}>
                        📚
                    </button>
                    <button class="btn-icon-view" onclick="viewNote(${note.id})" title="Quick View">
                        👁️
                    </button>
                    <button class="btn-icon-collapse" onclick="toggleCollapse(${note.id})" title="Toggle Collapse">
                        ${note.is_collapsed ? '🔻' : '🔺'}
                    </button>
                    <button class="btn-icon-edit" onclick="toggleInlineEdit(this, ${note.id})" title="Edit Content" ${canEdit ? '' : 'disabled'}>
                        ✏️
                    </button>
                    <button class="btn-icon-delete" onclick="deleteNote(${note.id})" title="Delete Note" ${canEdit ? '' : 'disabled'}>
                        🗑️
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

    // Interaction: Focus-driven z-index promotion (Seamless Click-to-Front)
    div.addEventListener('mousedown', () => {
        if (!canEdit || STATE.isInitializing) return;
        
        const currentZ = parseInt(div.style.zIndex || 1);
        const maxZ     = Math.max(...STATE.notes.map(n => n.z_index || 0), 0);
        
        if (currentZ <= maxZ) {
            const newZ = maxZ + 1;
            div.style.zIndex = newZ;
            note.z_index     = newZ;
            
            // Interaction Synchronization: Persist layering focus to MariaDB (Silent Mode)
            // Silent mode skips the .pending UI lockout to ensure follow-up 'click' events 
            // for Sticky Move (Pick & Place) are not swallowed.
            syncNotePosition(note.id, 'silent');
        }
    });

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
        STATE.isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        const style = window.getComputedStyle(el);
        startWidth = parseInt(style.width, 10);
        startHeight = parseInt(style.height, 10);
        
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
        STATE.isResizing = false;
        
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
        
        // Safety Guard: If clicking an interactive input, release control to the browser
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        // Check if the click was on the header or an icon within it
        if (!e.target.closest('.note-drag-handle-container')) return;
        
        e.preventDefault();
        
        // Logic-Pure Movement: Layering is handled by the focus listener
        el.classList.add('dragging');
        STATE.isDragging = true;
        
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.addEventListener('mouseup', closeDragElement);
        document.addEventListener('mousemove', elementDrag);
    }

    function elementDrag(e) {
        e.preventDefault();
        
        // Context Capture: Required for asynchronous auto-scroll updates
        STATE.autoScroll.lastEvent = e;
        checkAutoScrollProximity(e);

        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;

        // Scale-Aware Vector Displacement: Divide delta by current viewport scale
        let newX = el.offsetLeft - (pos1 / STATE.scale);
        let newY = el.offsetTop - (pos2 / STATE.scale);

        // 10px Grid Snapping and Canvas-Boundary Entrapment (50,000px)
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
        STATE.isDragging = false;
        stopAutoScroll(); // Clear active animation loops
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
    const el = document.getElementById(`note-${id}`);
    
    // Safety Guard: Disable Pick and Place if the note is in Active Edit Mode
    if (el && el.classList.contains('is-editing')) return;

    if (STATE.pickedNoteId) {
        dropStickyNote();
        return;
    }

    const note = STATE.notes.find(n => n.id == id);
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
    
    // Context Capture: Required for asynchronous auto-scroll updates
    STATE.autoScroll.lastEvent = e;
    checkAutoScrollProximity(e);

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

    // 10px Grid Snapping and Canvas-Boundary Entrapment (50,000px)
    newX = Math.round(newX / STATE.snapGrid) * STATE.snapGrid;
    newY = Math.round(newY / STATE.snapGrid) * STATE.snapGrid;

    newX = Math.max(0, Math.min(newX, STATE.canvasSize - el.offsetWidth));
    newY = Math.max(0, Math.min(newY, STATE.canvasSize - el.offsetHeight));

    el.style.left = `${newX}px`;
    el.style.top  = `${newY}px`;
}

/**
 * Dynamic Edge Detection: Evaluates cursor proximity to viewport boundaries
 * @param {MouseEvent} e - The mouse event.
 * @returns {void}
 */
function checkAutoScrollProximity(e) {
    const wrapper = document.getElementById('canvas-wrapper');
    if (!wrapper) return;

    const rect = wrapper.getBoundingClientRect();
    const { margin } = STATE.autoScroll;
    
    let velX = 0;
    let velY = 0;

    // Threshold Analysis: Proportional speed based on edge proximity
    if (e.clientX < rect.left + margin) {
        velX = -normalizeSpeed(rect.left + margin - e.clientX);
    } else if (e.clientX > rect.right - margin) {
        velX = normalizeSpeed(e.clientX - (rect.right - margin));
    }

    if (e.clientY < rect.top + margin) {
        velY = -normalizeSpeed(rect.top + margin - e.clientY);
    } else if (e.clientY > rect.bottom - margin) {
        velY = normalizeSpeed(e.clientY - (rect.bottom - margin));
    }

    if (velX !== 0 || velY !== 0) {
        startAutoScroll(velX, velY);
    } else {
        stopAutoScroll();
    }
}

/**
 * Velocity Normalizer: Converts pixel proximity into controlled scroll velocity
 * @param {number} dist - Distance into the margin.
 * @returns {number} - Calculated speed.
 */
function normalizeSpeed(dist) {
    const ratio = Math.min(dist / STATE.autoScroll.margin, 1);
    return ratio * STATE.autoScroll.maxSpeed;
}

/**
 * Initiates the Auto-Scroll animation loop.
 * @param {number} vx - Horizontal velocity.
 * @param {number} vy - Vertical velocity.
 * @returns {void}
 */
function startAutoScroll(vx, vy) {
    STATE.autoScroll.vx = vx;
    STATE.autoScroll.vy = vy;

    if (STATE.autoScroll.active) return;
    STATE.autoScroll.active = true;

    const loop = () => {
        if (!STATE.autoScroll.active) return;

        const wrapper = document.getElementById('canvas-wrapper');
        wrapper.scrollLeft += STATE.autoScroll.vx;
        wrapper.scrollTop  += STATE.autoScroll.vy;

        // Force Re-calculation: Re-trigger the active drag/move logic with the latest event
        const lastE = STATE.autoScroll.lastEvent;
        if (lastE) {
            if (STATE.isDragging) {
                // For direct drag, we dispatch a new event to trigger transition calculations
                const event = new MouseEvent('mousemove', {
                    clientX: lastE.clientX,
                    clientY: lastE.clientY,
                    bubbles: true
                });
                document.dispatchEvent(event);
            } else if (STATE.pickedNoteId) {
                // For Pick & Place, we can call the update directly
                updateStickyMove(lastE);
            }
        }

        STATE.autoScroll.frame = requestAnimationFrame(loop);
    };

    STATE.autoScroll.frame = requestAnimationFrame(loop);
}

/**
 * Terminates the Auto-Scroll animation sequence.
 * @returns {void}
 */
function stopAutoScroll() {
    if (!STATE.autoScroll.active) return;
    STATE.autoScroll.active = false;
    if (STATE.autoScroll.frame) {
        cancelAnimationFrame(STATE.autoScroll.frame);
    }
}

/**
 * Finalizes the 'Pick & Place' action, anchoring the note and syncing to MariaDB.
 * @returns {void}
 */
function dropStickyNote() {
    if (!STATE.pickedNoteId) return;
    
    stopAutoScroll(); // Clear active animation loops

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
 * @param {string} [type] - Optional synchronization mode ('silent' skips UI lockout).
 * @returns {Promise<void>}
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
        content: note.content,
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
 * Layer-Aware Focus Detection: Locates the most recently modified note 
 * on the ACTIVE isolation layer and centers the viewport.
 * @returns {void}
 */
function focusMostRecentNote() {
    // Isolation Filter: Only consider notes on the current active level
    const levelNotes = STATE.notes.filter(n => n.layer_id == STATE.activeLayerId);

    if (levelNotes.length === 0) {
        centerView();
        showToast(`No notes found on Level ${STATE.activeLayerId}`, 'info');
        return;
    }

    // Find the note with the most recent modification (Highest updated_at timestamp)
    const recentNote = levelNotes.reduce((prev, current) => (prev.updated_at > current.updated_at) ? prev : current);

    if (recentNote) {
        centerOnNote(recentNote.id);
        showToast(`Focused on recent note on Level ${STATE.activeLayerId}`, 'success');
    }
}

/**
 * Centering Engine: Smooth-scrolls the viewport to anchor a specific note.
 * Recalculates offsets based on the current STATE.scale to ensure precision centering.
 * @param {number|string} id - The note ID.
 * @returns {void}
 */
async function centerOnNote(id) {
    const note = STATE.notes.find(n => n.id == id);
    if (!note) return;

    // Level Isolation Recovery: Switch level if the target note is not on the active layer
    if (note.layer_id && note.layer_id != STATE.activeLayerId) {
        await switchLevel(note.layer_id);
    }

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
 * Synchronizes the visual CSS scale with the scrollable layout area.
 * @returns {void}
 */
function applyScale() {
    const canvas = document.getElementById('notes-canvas');
    const wrapper = document.getElementById('canvas-wrapper');
    if (!canvas || !wrapper) return;

    // Apply visual transformation
    canvas.style.transform = `scale(${STATE.scale})`;
    canvas.style.transformOrigin = '0 0';

    // Synchronize scrollable area via an in-flow spacer
    // Since #notes-canvas is absolute, we need this to define the container's scrollWidth/scrollHeight
    let spacer = document.getElementById('canvas-scroll-spacer');
    if (!spacer) {
        spacer = document.createElement('div');
        spacer.id = 'canvas-scroll-spacer';
        // Add after canvas to avoid z-index/overlap issues if any
        wrapper.appendChild(spacer);
    }
    
    const scaledSize = Math.ceil(STATE.canvasSize * STATE.scale);
    spacer.style.width  = scaledSize + 'px';
    spacer.style.height = scaledSize + 'px';

    // Force a synchronous reflow to ensure the container's scrollHeight/scrollWidth 
    // are updated before any immediate scrollTo calls (e.g., in centering logic).
    void wrapper.scrollWidth;

    // Update the scale indicator badge
    const badge = document.getElementById('scale-badge');
    if (badge) badge.textContent = Math.round(STATE.scale * 100) + '%';
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

    updateRadar();
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

    updateRadar();
    scheduleViewportSave();
}

/**
 * Debounced handler for scroll events that persists the current viewport.
 * @returns {void}
 */
function onViewportScroll() {
    if (STATE.isInitializing) return; // Respect the Shield
    
    // Throttled Refresh: Use requestAnimationFrame to prevent event-loop congestion 
    // during high-speed scrolls. Saves significant paint cycles on the radar canvas.
    requestAnimationFrame(updateRadar);
    
    scheduleViewportSave();
}

/**
 * Persistence Tier: Mirrors the current perspective to the browser's persistent storage.
 * This provides zero-latency restoration and protects against session-destroying crashes.
 */
function updateLocalViewportCache() {
    if (!STATE.canvas_id || !STATE.activeLayerId || !STATE.userid) return;
    
    const wrapper = document.getElementById('canvas-wrapper');
    if (!wrapper) return;

    const cacheKey = `whiteboard_vp_u${STATE.userid}_c${STATE.canvas_id}_l${STATE.activeLayerId}`;
    const payload = {
        scale:    STATE.scale,
        scroll_x: (wrapper.scrollLeft + wrapper.clientWidth  / 2) / STATE.scale,
        scroll_y: (wrapper.scrollTop  + wrapper.clientHeight / 2) / STATE.scale,
        ts:       Date.now()
    };
    
    try {
        localStorage.setItem(cacheKey, JSON.stringify(payload));
    } catch (e) {
        // Silently fail if storage is full
    }
}

/**
 * Retrieval Tier: Fetches the last known optimistic state for a given context.
 */
function getLocalViewport(canvasId, layerId) {
    if (!STATE.userid) return null;
    const cacheKey = `whiteboard_vp_u${STATE.userid}_c${canvasId}_l${layerId}`;
    const raw = localStorage.getItem(cacheKey);
    if (!raw) return null;
    
    try {
        const parsed = JSON.parse(raw);
        // Expiration check: If it's older than 7 days, ignore it
        if (Date.now() - parsed.ts > 86400000 * 7) return null;
        return parsed;
    } catch (e) {
        return null;
    }
}

/**
 * Reliability Guardian: Processes the synchronization queue to ensure no state is lost.
 */
async function processSyncQueue() {
    if (STATE.isSyncing || STATE.syncQueue.length === 0) return;
    
    STATE.isSyncing = true;
    const items = [...STATE.syncQueue];
    STATE.syncQueue = []; // Clear for processing
    
    const failedItems = [];
    
    for (const item of items) {
        try {
            const res = await fetch('/notes/api/viewport', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-CSRF-Token': item.token 
                },
                body: item.params,
                keepalive: true
            });
            
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (e) {
            failedItems.push(item);
        }
    }
    
    if (failedItems.length > 0) {
        STATE.syncQueue = [...failedItems, ...STATE.syncQueue];
    }
    
    STATE.isSyncing = false;
}

/**
 * Maintenance Engine: Prunes stale viewport cache entries to prevent LocalStorage bloat.
 * Follows an LRU (Least Recently Used) policy: Removes entries older than 30 days
 * or caps the total unique board/layer caches at 50.
 */
function pruneLocalStorage() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('whiteboard_vp_')) {
            try {
                const val = JSON.parse(localStorage.getItem(key));
                keys.push({ key, ts: val.ts || 0 });
            } catch (e) {
                // Corrupt data: Prune immediately
                localStorage.removeItem(key);
            }
        }
    }

    // Sort by timestamp (Oldest First)
    keys.sort((a, b) => a.ts - b.ts);

    const THIRTY_DAYS = 86400000 * 30;
    const now = Date.now();
    const limit = 50;

    // Prune logic: Expired or Over-limit
    keys.forEach((item, index) => {
        const isExpired = (now - item.ts > THIRTY_DAYS);
        const isOverLimit = (keys.length - index > limit);
        
        if (isExpired || isOverLimit) {
            localStorage.removeItem(item.key);
        }
    });
    
    if (keys.length > limit) {
        console.debug(`Whiteboard: Memory Pruning complete. Removed ${keys.length - limit} stale perspective(s).`);
    }
}

/**
 * Schedules a debounced viewport save to the backend.
 * Also mirrors the state to local storage for zero-latency restoration.
 * @returns {void}
 */
function scheduleViewportSave() {
    if (STATE.isInitializing) return;
    
    updateLocalViewportCache(); // Optimistic mirror (Synchronous)

    clearTimeout(STATE.vpSaveTimer);
    STATE.vpSaveTimer = setTimeout(persistViewport, 1500);
}

/**
 * Perspective Persistence: Synchronizes the current camera state with the backend.
 * Integrates with the Retry Queue to handle network instability.
 */
async function persistViewport() {
    const wrapper = document.getElementById('canvas-wrapper');
    if (!wrapper || STATE.isInitializing) return;

    await saveViewportImmediate();
}

/**
 * Persistent Viewport Handshake: Captures and commits the current perspective.
 * Used during lifecycle transitions (layer/canvas switches) to prevent state loss.
 */
async function saveViewportImmediate() {
    const wrapper = document.getElementById('canvas-wrapper');
    if (!wrapper) return;

    // Persist Canonical Canvas-Center Coordinates (Scale-Independent)
    const centerX = (wrapper.scrollLeft + wrapper.clientWidth  / 2) / STATE.scale;
    const centerY = (wrapper.scrollTop  + wrapper.clientHeight / 2) / STATE.scale;

    // Security: Inject CSRF token from meta tags for authoritative state commitment
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');

    const params = new URLSearchParams({
        canvas_id:  STATE.canvas_id,
        scale:      STATE.scale,
        scroll_x:   centerX,
        scroll_y:   centerY,
        layer_id:   STATE.activeLayerId
    });

    try {
        const res = await fetch('/notes/api/viewport', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-CSRF-Token': csrfToken 
            },
            body: params,
            keepalive: true
        });
        
        if (!res.ok) throw new Error(`Server responded with ${res.status}`);
        return res;
    } catch (err) {
        console.debug('Sync delayed: Pushing perspective to retry queue.', err);
        
        // Context-Aware De-duplication: If an item for this canvas/layer is already pending,
        // remove it so the new (fresher) perspective takes precedence.
        const cid = STATE.canvas_id;
        const lid = STATE.activeLayerId;
        STATE.syncQueue = STATE.syncQueue.filter(item => {
            const p = new URLSearchParams(item.params);
            return !(p.get('canvas_id') == cid && p.get('layer_id') == lid);
        });

        STATE.syncQueue.push({ params: params.toString(), token: csrfToken, ts: Date.now() });
    }
}

/**
 * Master Radar Orchestrator: Atomically refreshes both the regional pings and the viewport frame.
 * @returns {void}
 */
function updateRadar() {
    drawRadarPings();
    syncRadarViewport();
}

/**
 * Radar Engine: Renders simplified note "pings" onto the minimap canvas.
 * Now features 'Linked Magnification': The radar zooms as you zoom into the main board.
 */
function drawRadarPings() {
    const canvas = document.getElementById('radar-pings');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const wrapper = document.getElementById('canvas-wrapper');
    if (!wrapper) return;

    // Clear the radar surface
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // --- Magnifier Math (Upgraded for High-Precision Regional View) ---
    // Instead of showing the whole world, the radar now shows a context-window around the camera.
    // Dynamic Multiplier: As we zoom in, we shrink the 'Peripheral' view to increase scrubbing precision.
    // Logic: 5x window at 1.0 zoom -> 2x window at 3.0 zoom.
    const contextMultiplier = Math.max(2, 5 - (STATE.scale - 1) * 1.5);
    
    // Guard: Prevent divide-by-zero if the wrapper hasn't finished painting (Logical min 1000px)
    const vw_raw = wrapper.clientWidth  || window.innerWidth;
    const vh_raw = wrapper.clientHeight || window.innerHeight;
    
    const logicalVW = Math.max(1000, vw_raw / STATE.scale);
    
    // Calculate the logical window shown by the radar (capped at whole-world size)
    const logicalWindow = Math.min(STATE.canvasSize, logicalVW * contextMultiplier); 
    const minimapScale  = canvas.width / logicalWindow;

    // Logical Center of the main camera
    const canvasCX = (wrapper.scrollLeft + vw_raw / 2) / STATE.scale;
    const canvasCY = (wrapper.scrollTop  + vh_raw / 2) / STATE.scale;

    // Determine the logical start-point for the radar window (Clamped securely)
    const radarStartX = Math.max(0, Math.min(canvasCX - logicalWindow/2, STATE.canvasSize - logicalWindow));
    const radarStartY = Math.max(0, Math.min(canvasCY - logicalWindow/2, STATE.canvasSize - logicalWindow));

    // Persist context for coordinate translation in other modules
    STATE.radarWindow = { x: radarStartX, y: radarStartY, miniScale: minimapScale };

    // Scan-line iteration: Draw rects for all notes on the current level
    STATE.notes.forEach(note => {
        if (note.layer_id != STATE.activeLayerId) return;

        // Chroma Pings: Mirror the actual note color for high-precision awareness (with fallback)
        const rawColor = normalizeColorHex(note.color);
        ctx.fillStyle = (rawColor && rawColor.startsWith('#')) ? rawColor : `#${rawColor}`;
        ctx.globalAlpha = 0.9;

        // Translate logical coordinate -> Radar-relative coordinate
        const rx = (note.x - radarStartX) * minimapScale;
        const ry = (note.y - radarStartY) * minimapScale;

        // Visibility Boost: Enforce a 2px minimum size so tiny notes don't vanish
        const rw = Math.max(2, (note.width  || 250) * minimapScale);
        const rh = Math.max(2, (note.height || 200) * minimapScale);

        ctx.fillRect(rx, ry, rw, rh);
    });
}

/**
 * Radar Sync: Transposes the main viewport's coordinates onto the Magnifier window.
 */
function syncRadarViewport() {
    const wrapper = document.getElementById('canvas-wrapper');
    const view    = document.getElementById('radar-viewport');
    if (!wrapper || !view || !STATE.radarWindow) return;

    const { x, y, miniScale } = STATE.radarWindow;

    // Calculate logical viewport bounds
    const vw = (wrapper.clientWidth  / STATE.scale) * miniScale;
    const vh = (wrapper.clientHeight / STATE.scale) * miniScale;
    
    // Translate logical scroll position to radar-relative position
    const vx = ((wrapper.scrollLeft / STATE.scale) - x) * miniScale;
    const vy = ((wrapper.scrollTop  / STATE.scale) - y) * miniScale;

    view.style.width  = `${vw}px`;
    view.style.height = `${vh}px`;
    view.style.left   = `${vx}px`;
    view.style.top    = `${vy}px`;
}

/**
 * Radar Navigation: Teleports or Scrubs the main camera.
 * @param {MouseEvent} e - The mouse event.
 */
function handleRadarMouseDown(e) {
    // Bubble Guard: If clicking the toggle handle, abort to prevent accidental teleportation
    if (e.target.closest('.radar-handle')) return;

    const view = document.getElementById('radar-viewport');
    if (e.target === view) {
        STATE.isScrubbing = true;
        STATE.radarScrubLast = { x: e.clientX, y: e.clientY };
        e.preventDefault();
        return;
    }

    // Direct Teleport: If clicking outside the frame
    processRadarNavigation(e);
}

/**
 * Real-time 'Scrubbing' coordinator for minimap panning.
 */
function handleRadarMouseMove(e) {
    if (!STATE.isScrubbing) return;
    processRadarNavigation(e, 'instant');
}

/**
 * Terminates the scrubbing session.
 */
function handleRadarMouseUp() {
    STATE.isScrubbing = false;
}

/**
 * Translational Engine: Converts radar-clicks into canvas-scrolls.
 * @param {MouseEvent} e - Interaction event.
 * @param {string} mode - 'smooth' or 'instant' scroll behavior.
 */
function processRadarNavigation(e, mode = 'smooth') {
    const container = document.getElementById('radar-container');
    const wrapper   = document.getElementById('canvas-wrapper');
    if (!container || !wrapper || !STATE.radarWindow) return;

    const rect = container.getBoundingClientRect();
    const rx   = e.clientX - rect.left;
    const ry   = e.clientY - rect.top;

    // Bounds check: Only return early if clicking a teleport point. 
    // During active scrubbing, we allow momentum to flow beyond the radar surface.
    if (!STATE.isScrubbing && (rx < 0 || rx > rect.width || ry < 0 || ry > rect.height)) return;

    const { x, y, miniScale } = STATE.radarWindow;
    const modeIsScrub = (mode === 'instant' && STATE.isScrubbing);

    if (modeIsScrub) {
        // --- Precision Gearbox (Relative Delta Mode) ---
        // Instead of absolute positioning (which is sensitive), we use a dampened delta.
        // Sensitivity: 0.2 (Moves the camera 5x slower than mouse motion)
        const sensitivity = 0.25;
        const deltaMX = e.clientX - STATE.radarScrubLast.x;
        const deltaMY = e.clientY - STATE.radarScrubLast.y;
        
        // Logical Delta: Translate mousepx -> logicalpx -> apply dampening
        const logicalDeltaX = (deltaMX / miniScale) * sensitivity;
        const logicalDeltaY = (deltaMY / miniScale) * sensitivity;

        wrapper.scrollLeft += logicalDeltaX * STATE.scale;
        wrapper.scrollTop  += logicalDeltaY * STATE.scale;

        STATE.radarScrubLast = { x: e.clientX, y: e.clientY };
    } else {
        // --- Standard Mode (Teleport / Absolute Move) ---
        // Map radar-relative -> logical coordinate -> target scroll
        const cx = x + (rx / miniScale);
        const cy = y + (ry / miniScale);

        wrapper.scrollTo({
            left: cx * STATE.scale - (wrapper.clientWidth / 2),
            top:  cy * STATE.scale - (wrapper.clientHeight / 2),
            behavior: mode === 'instant' ? 'auto' : 'smooth'
        });
    }
}

/**
 * Radar Quick-Zoom: Allows magnification centered on the hovered minimap logical coordinate.
 * @param {WheelEvent} e - Interaction event.
 */
function handleRadarWheel(e) {
    // Prevent page-level scroll artifacts
    e.preventDefault();

    const wrapper = document.getElementById('canvas-wrapper');
    const container = document.getElementById('radar-container');
    if (!wrapper || !container || !STATE.radarWindow) return;

    const oldScale = STATE.scale;
    const step     = 0.1;
    
    // Calculate new magnification level using centralized constants
    if (e.deltaY < 0) {
        STATE.scale = Math.min(SCALE_MAX, Math.round((STATE.scale + step) * 10) / 10);
    } else {
        STATE.scale = Math.max(SCALE_MIN, Math.round((STATE.scale - step) * 10) / 10);
    }

    if (STATE.scale === oldScale) return;

    // Translation Logic: Map radar-hover position to logical canvas coordinates
    const rect = container.getBoundingClientRect();
    const rx   = e.clientX - rect.left;
    const ry   = e.clientY - rect.top;

    const { x, y, miniScale } = STATE.radarWindow;
    const canvasCX = x + (rx / miniScale);
    const canvasCY = y + (ry / miniScale);

    // Apply scaling and re-center the main camera on the target logical spot
    applyScale();
    
    wrapper.scrollLeft = canvasCX * STATE.scale - wrapper.clientWidth  / 2;
    wrapper.scrollTop  = canvasCY * STATE.scale - wrapper.clientHeight / 2;

    updateRadar();
    scheduleViewportSave();
}

/**
 * Note Deletion Bridge (Soft-Delete)
 * Moves a note to the Recycle Bin rather than immediate destruction.
 * @param {number} id - Target note ID.
 */
/**
 * Radar Visibility Orchestrator: Toggles the minimap drawer with persistent memory.
 * @returns {void}
 */
function toggleRadar() {
    STATE.showRadar = !STATE.showRadar;
    localStorage.setItem('notes_show_radar', STATE.showRadar);
    renderRadarState();
}

/**
 * Applies the visual state and 'is-open' class based on the global Radar visibility.
 * @returns {void}
 */
function renderRadarState() {
    const radar = document.getElementById('radar-container');
    if (!radar) return;

    if (STATE.showRadar) {
        radar.classList.add('is-open');
    } else {
        radar.classList.remove('is-open');
    }
}

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
                renderUI();
                showToast('Note moved to Recycle Bin', 'success');
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
    // Only trigger panning if clicking directly on the canvas background or the wrapper
    if (e.target.id !== 'notes-canvas' && e.target.id !== 'canvas-wrapper') return;
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
    // Primary Interaction: Use the wheel for zooming by default (no CTRL required).
    // This aligns with professional whiteboard/mapping tools when panning-by-drag is active.
    e.preventDefault();

    const wrapper = document.getElementById('canvas-wrapper');
    if (!wrapper) return;

    const oldScale = STATE.scale;
    const step     = 0.1;
    
    if (e.deltaY < 0) {
        STATE.scale = Math.min(SCALE_MAX, Math.round((STATE.scale + step) * 10) / 10);
    } else {
        STATE.scale = Math.max(SCALE_MIN, Math.round((STATE.scale - step) * 10) / 10);
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

    updateRadar();
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
 * Inline Core: Toggles the editing state for a specific note element.
 * @param {HTMLElement} btn - The clicked button reference.
 * @param {number|string} id - The note ID.
 * @returns {Promise<void>}
 */
async function toggleInlineEdit(btn, id) {
    const el   = document.getElementById(`note-${id}`);
    const note = STATE.notes.find(n => n.id == id);
    if (!el || !note) return;

    const textarea  = el.querySelector('textarea');
    const titleInp  = el.querySelector('.inline-title-input');
    
    // Expand collapsed notes before editing to prevent dimension corruption
    if (!el.classList.contains('is-editing') && note.is_collapsed) {
        await toggleCollapse(id);
    }

    const isEditing = el.classList.toggle('is-editing');

    if (isEditing) {
        // Mode Transition: Enable Interaction & Focus
        STATE.isEditingNote  = true;
        if (textarea) {
            textarea.readOnly = false;
            textarea.focus();
        }
        
        btn.innerHTML = '💾';
        btn.title     = 'Save Changes';
        btn.classList.add('pulse-glow');
    } else {
        // Mode Termination: Atomic Persistence
        saveNoteInline(id);
    }
}

/**
 * State Persistence: Synchronizes DOM values and persists note modifications directly.
 * @param {number|string} id - The note ID.
 * @returns {Promise<void>}
 */
async function saveNoteInline(id) {
    const el   = document.getElementById(`note-${id}`);
    const note = STATE.notes.find(n => n.id == id);
    if (!el || !note) return;

    const title    = el.querySelector('.inline-title-input').value;
    const textarea = el.querySelector('textarea');
    const content  = textarea ? textarea.value : '';
    const color    = el.querySelector('.inline-color-input').value;
    const editBtn  = el.querySelector('.btn-icon-edit');

    el.classList.add('pending');
    
    // Interaction Locking: Maintain state integrity during flight
    const params = {
        id: id,
        canvas_id: STATE.canvas_id,
        title: title,
        content: content,
        color: color,
        layer_id: note.layer_id || STATE.activeLayerId,
        x: note.x,
        y: note.y,
        width:  note.is_collapsed ? (note.width  || el.offsetWidth)  : el.offsetWidth,
        height: note.is_collapsed ? (note.height || el.offsetHeight) : el.offsetHeight,
        z_index: el.style.zIndex,
        is_collapsed: note.is_collapsed,
        is_options_expanded: note.is_options_expanded
    };

    try {
        const res = await apiPost('/notes/api/save', params);
        if (res && res.success) {
            STATE.notes         = res.notes; // State Sync baseline
            STATE.last_mutation = res.last_mutation;
            STATE.note_map      = res.note_map || STATE.note_map;
            
            // Targeted DOM Update: Refresh viewer and title without board re-render
            const viewer = el.querySelector('.note-text-viewer');
            const slot   = el.querySelector('.note-title-slot');
            if (viewer) viewer.innerHTML = formatNoteContent(content, id);
            if (slot)   slot.textContent = title || 'Untitled Note';
            
            // Sync Accent Color
            el.style.setProperty('--note-accent', normalizeColorHex(color));
            
            el.classList.remove('is-editing');
            if (textarea) textarea.readOnly = true;
            if (editBtn) {
                editBtn.innerHTML = '✏️';
                editBtn.title     = 'Edit Content';
                editBtn.classList.remove('pulse-glow');
            }

            STATE.isEditingNote = false;
            showToast('Note Saved', 'success');
        }
    } finally {
        el.classList.remove('pending');
    }
}

/**
 * Real-time Feedback: Update note accent color during editing.
 */
function updateNoteAccent(inp, id) {
    const el = document.getElementById(`note-${id}`);
    if (el) {
        el.style.setProperty('--note-accent', inp.value);
    }
}

function editNote(id) {
    const note = STATE.notes.find(n => n.id == id);
    if (!note) return;

    // Backward compatibility for keyboard shortcuts or global triggers
    const btn = document.querySelector(`#note-${id} .btn-icon-edit`);
    if (btn) toggleInlineEdit(btn, id);
}

/**
 * Keyboard Interface: Handles productivity shortcuts within the inline editor.
 */
function handleNoteKeydown(e, id) {
    // Ctrl + Enter: Instant Save
    if (e.ctrlKey && e.key === 'Enter') {
        const btn = document.querySelector(`#note-${id} .btn-icon-edit`);
        if (btn && document.getElementById(`note-${id}`).classList.contains('is-editing')) {
            e.preventDefault();
            toggleInlineEdit(btn, id);
        }
    }
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

    // Optimistic UI: Immediate visual transition
    note.is_collapsed = note.is_collapsed ? 0 : 1;
    el.classList.toggle('collapsed', !!note.is_collapsed);
    
    // Reflect new collapse state in the toggle button
    const collapseBtn = el.querySelector('.btn-icon-collapse');
    if (collapseBtn) {
        collapseBtn.innerHTML = note.is_collapsed ? '🔻' : '🔺';
    }

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
            z_index: note.z_index,
            layer_id: note.layer_id || 1
        });
        
        if (res && res.success) {
            STATE.notes         = res.notes;
            STATE.last_mutation = res.last_mutation;
            STATE.note_map      = res.note_map || STATE.note_map;
            // Interaction: Silent success (renderUI suppressed to prevent flash)
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
        // Update baseline immediately to prevent heartbeat races
        STATE.last_mutation = uploadRes.last_mutation;
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
        if (btnIcon)     btnIcon.innerHTML       = '💾';

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
            tip.innerHTML = `ℹ️ Image content is preserved`;
            container.appendChild(tip);
        }
    } else if (data) {
        // Initialization for pasted notes
        if (headerLabel) headerLabel.textContent = 'Paste from Clipboard';
        if (btnText)     btnText.textContent     = 'Create Note';
        if (btnIcon)     btnIcon.innerHTML       = '📋';

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
        if (btnIcon)     btnIcon.innerHTML       = '📋';

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
    confirmBtn.innerHTML = `⌛ Saving...`;

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
                layer_id: STATE.activeLayerId,
                ...coords
            };
            const res = await apiPost('/notes/api/save', params);
            if (res && res.success) {
                STATE.last_mutation = res.last_mutation;
                STATE.note_map      = res.note_map || STATE.note_map;
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
                layer_id: STATE.activeLayerId,
                ...coords
            };
            
            const res = await apiPost('/notes/api/save', params);
            if (res && res.success) {
                const noteId = res.id;
                STATE.last_mutation = res.last_mutation;
                STATE.note_map      = res.note_map || STATE.note_map;
                
                if (data && data.startsWith('data:')) {
                    const blob = await (await fetch(data)).blob();
                    const formData = new FormData();
                    formData.append('file', blob, 'creation_image.png');
                    formData.append('note_id', noteId);
                    formData.append('canvas_id', STATE.canvas_id);

                    const uploadRes = await apiPost('/notes/api/upload', formData);
                    if (uploadRes && uploadRes.success) {
                        STATE.last_mutation = uploadRes.last_mutation;
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
 * Command Palette: Orchestrates the Layer Action modal for cloning notes.
 * @param {number|string} id - The source note ID.
 */
function openLayerActionModal(id) {
    window.showConfirmModal({
        title: 'Clone to Level',
        icon: '📚',
        message: 'Specify the target level:',
        width: 'small',
        hideCancel: true,
        noEmoji: true,
        autoFocus: true,
        input: {
            type: 'number',
            placeholder: 'Level #',
            value: ''
        },
        confirmText: 'Clone',
        confirmIcon: '📚',
        onConfirm: async (val) => {
            const level = parseInt(val);
            if (isNaN(level) || level < 1 || level > 99) {
                showToast('Please enter a valid level (1-99)', 'error');
                throw new Error('Invalid level');
            }
            await copyNoteToLevel(id, level);
        }
    });
}

/**
 * Triggers the 'Jump to Level' global modal prompt.
 * Allows the user to rapidly navigate to any numeric isolation level.
 * 
 * @returns {void}
 */
window.openJumpToLevelModal = function() {
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
            await window.switchLevel(level);
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
            goBtn.style.padding = '0.75rem 1.25rem';
            goBtn.onclick = () => {
                const val = promptInput.value;
                const level = Math.floor(Math.abs(parseInt(val)));
                if (isNaN(level) || level < 1 || level > 99) {
                    showToast('Please enter a valid level (1-99)', 'error');
                } else {
                    cleanupModal(); // Local cleanup before closure
                    window.switchLevel(level);
                    window.closeConfirmModal();
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
                            return `<a href="javascript:void(0)" class="quick-jump-link" onclick="(${cleanupModal.toString()})(); window.switchLevel(${id}); window.closeConfirmModal();">${window.escapeHtml(label)}</a>`;
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
 * Orchestrates Cross-Level Duplication.
 * @param {number|string} id - The source note ID.
 * @param {number} newLevelId - Target Level (1-4).
 * @returns {Promise<void>}
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
            if (newLevelId == STATE.activeLayerId) {
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
 * Orchestrates level-specific isolation by switching the active layer.
 * Implements Perspective Persistence: Saves current viewport before transitioning.
 * @param {number} id - The Level ID (1-4).
 * @returns {Promise<void>}
 */
window.switchLevel = async function(id) {
    if (id == STATE.activeLayerId || STATE.isSwitchingLayer) return;
    
    // Perspective Lock: Save the outgoing level's camera state
    STATE.isSwitchingLayer = true;
    await saveViewportImmediate();
    
    // State Stabilization: Clear interaction flags
    STATE.isEditingNote = false;
    
    // Interaction Guard: Prevent overlapping transitions
    showLoadingOverlay('Transitioning Perspective...');
    
    try {
        // Hydrate the target level's unique perspective and notes
        await loadState(false, STATE.canvas_id, null, id);
    } finally {
        hideLoadingOverlay();
        STATE.isSwitchingLayer = false;
    }
}

/**
 * Directional Navigation: Moves the isolation layer context up or down.
 * @param {number} direction - -1 (Up) or 1 (Down).
 */
window.moveLevel = async function(direction) {
    if (STATE.isSwitchingLayer) return;

    // Type Safety: Ensure activeLayerId is treated as a number to prevent string concatenation
    let nextLevel = Number(STATE.activeLayerId) + direction;
    
    // Circular Loop Resolution: 1 <-> 99 wrapping
    if (nextLevel > 99) nextLevel = 1;
    if (nextLevel < 1) nextLevel = 99;
    
    await switchLevel(nextLevel);
}

/**
 * Updates the visual level indicator, displaying descriptive aliases if configured.
 * @returns {void}
 */
function updateLevelDisplay() {
    const display = document.getElementById('level-display');
    if (!display) return;
    
    // Retrieve the shared alias from the global metadata map
    const alias = STATE.layer_map[STATE.activeLayerId];
    
    if (alias) {
        // High-Fidelity Branding: Show Level Number + Descriptive Alias
        // The .is-active class triggers a blue glow around the pill
        display.classList.add('is-active');
        display.innerHTML = `
            <span class="level-num">${STATE.activeLayerId}</span>
            <span class="level-alias-meta">
                &nbsp;-&nbsp;<span class="level-alias">${window.escapeHtml(alias)}</span>
            </span>
        `;
        display.title = `Level ${STATE.activeLayerId}: ${alias} (Click to Jump/Rename)`;

        // Perspective Persistence: Auto-hide the alias after 2 seconds to keep the UI minimalist
        const meta = display.querySelector('.level-alias-meta');
        if (meta) {
            clearTimeout(STATE.aliasTimer);
            STATE.aliasTimer = setTimeout(() => {
                meta.classList.add('is-hidden');
                display.classList.remove('is-active');
            }, 2000);
        }
    } else {
        // Minimalist Fallback: Show Number Only
        display.textContent = `${STATE.activeLayerId}`;
        display.title = `Level ${STATE.activeLayerId} (Click to Jump/Rename)`;
    }
}

/**
 * Opens the interactive level renaming modal.
 * Persists the new alias to the shared canvas_layers registry.
 * @returns {void}
 */
window.renameCurrentLevel = function() {
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
        hideCancel: true, // Simplified UI: No cancel button
        input: {
            type: 'text',
            placeholder: 'Level Name (e.g. Household Admin)',
            value: currentAlias,
            maxLength: 100
        },
        confirmText: 'Save', // Cleaned up label
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
                    updateLevelDisplay();
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
                <span class="global-icon">🔍</span>
                <p>No matches found in ${isGlobal ? 'any of your whiteboards' : 'the current board'}</p>
            </div>
        `;
        return;
    }

    container.innerHTML = results.map(note => `
        <div class="search-result-item" style="--note-accent: ${note.color || '#3b82f6'}" onclick="handleSearchResultClick(${note.id})">
            <div class="search-result-icon">
                <span class="global-icon">${note.type === 'image' ? '🖼️' : '✏️'}</span>
            </div>
            <div class="search-result-info">
                <div class="search-result-path">
                    📓 ${escapeHtml(note.canvas_name || 'Board')} 
                    <span class="path-separator">❯</span> 
                    Level ${note.layer_id || 1}${note.layer_alias ? ` - ${escapeHtml(note.layer_alias)}` : ''} 
                </div>
                <div class="search-result-title">${escapeHtml(note.title || 'Untitled Note')}</div>
                <div class="search-result-snippet">${escapeHtml(note.content || '').substring(0, 80)}${note.content && note.content.length > 80 ? '...' : ''}</div>
            </div>
            <div class="search-result-action">
                <span class="global-icon">▶️</span>
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
            // Local focus navigation: Await layer transition before moving camera
            await centerOnNote(id);
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

/**
 * Copies the Note's numeric ID to the clipboard.
 * @param {Event} e - Click event.
 * @param {number|string} id - The note ID.
 */
async function copyNoteId(e, id) {
    if (e) e.stopPropagation();
    
    try {
        await navigator.clipboard.writeText(id);
        showToast(`Note ID #${id} copied to clipboard`, 'success');
    } catch (err) {
        console.error('Copy Note ID failed:', err);
        showToast('Failed to copy ID', 'error');
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
                    ${canvas.id == STATE.canvas_id ? `<span class="active-badge">🧠 Active</span>` : ''}
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
                ` : ''}
                ${isOwner && canvas.name !== 'Your Notebook' ? `
                    <button class="btn-icon-square btn-sm btn-danger" onclick="deleteCanvas(event, ${canvas.id})" title="Delete Board">
                        🗑️
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
    
    try {
        // Perspective Lock: Save the outgoing canvas state before switching context
        await saveViewportImmediate();
        
        STATE.canvas_id = id;
        showLoadingOverlay('Cleaning canvas...');
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
        icon: '🗑️',
        message: 'This will permanently destroy all notes and images on this board. This action cannot be undone.',
        danger: true,
        hideCancel: true,
        confirmText: 'DELETE',
        confirmIcon: '🗑️',
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
                    🗑️
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
            results.classList.add('hidden');
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
                        results.classList.add('hidden');
                        input.value = '';
                    };
                    results.appendChild(div);
                });
                results.classList.remove('hidden');
            } else {
                results.classList.add('hidden');
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
        icon: '🗑️',
        danger: true,
        hideCancel: true,
        confirmText: 'DELETE',
        confirmIcon: '🗑️',
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
                    📦
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

/**
 * Transforms Markdown-style checkbox syntax into interactive HTML checkboxes.
 * @param {string} content - The raw note text.
 * @param {number|string} noteId - The associated note ID for event binding.
 * @returns {string} - Formatted HTML string.
 */
function formatNoteContent(content, noteId) {
    if (!content) return '';
    const lines = content.split('\n');
    const result = lines.map((line, index) => {
        // Precise Detection: Identify leading whitespace, optional list markers (- or *), checkbox markers, and optional separator space
        // Supports: [ ], [x], [X], [*], - [ ], * [ ]
        const todoMatch = line.match(/^([\s]*)(?:[\-\*][ ]+)?(\[[ xX\*]?\])([ ]?)(.*)$/);

        if (todoMatch) {
            const prefix    = todoMatch[1]; // Preserve indentation
            const marker    = todoMatch[2]; // The [ ] or [x] part
            const isChecked = /\[[xX\*]\]/.test(marker);
            const separator = todoMatch[3]; // The optional single space after marker
            const text      = todoMatch[4]; // Extract remaining text

            const checkedAttr  = isChecked ? 'checked' : '';
            const checkedClass = isChecked ? 'checked' : '';

            // Inline Transformation: Replace checkbox marker with a functional wrapper
            return `<label class="todo-inline-wrap"><span class="prefix">${prefix}</span><input type="checkbox" class="note-todo-checkbox" ${checkedAttr} onchange="toggleNoteCheckbox(event, ${noteId}, ${index})"><span class="note-todo-text ${checkedClass}">${window.escapeHtml(text)}</span></label>`;
        }

        // Literal Line Passthrough: Maintain original structure for non-checkbox lines
        return window.escapeHtml(line);
    }).map(line => {        // Post-Escaping Transformation: Resolve [note:#] deep links and rich text
        let formatted = line.replace(/\[note:(\d+)\]/g, (match, id) => {
            const meta = STATE.note_map && STATE.note_map[id];
            if (meta) {
                return `<span class="note-link" onclick="handleNoteLinkClick(${id})" title="Jump to: ${window.escapeHtml(meta.title)}">🔗 ${window.escapeHtml(meta.title)}</span>`;
            }
            return `<span class="note-link-broken" title="Note #${id} not found or inaccessible">⚠️ [note:${id}]</span>`;
        });

        // 1. Bold & Italic Emphasis
        formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong class="note-bold">$1</strong>');
        formatted = formatted.replace(/\*([^\*]+)\*/g, '<em class="note-italic">$1</em>');

        // 2. Inline Code Formatting
        formatted = formatted.replace(/`([^`]+)`/g, (match, code) => {
            return `<code class="note-code-inline">${code}</code>`;
        });

        // 2. External Links (Sanitized for http/https only)
        formatted = formatted.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g, (match, label, url) => {
            return `<a class="note-external-link" href="${url}" target="_blank" rel="noopener noreferrer">${label} 🔗</a>`;
        });

        // 3. Color Tags (Themed names or Custom HEX)
        formatted = formatted.replace(/\[color:(\w+|#[0-9a-fA-F]{3,6})\](.*?)\[\/color\]/g, (match, selector, text) => {
            const isHex = selector.startsWith('#');
            const style = isHex ? `style="color: ${selector}"` : '';
            const className = isHex ? '' : `note-text-${selector.toLowerCase()}`;
            return `<span class="${className}" ${style}>${text}</span>`;
        });

        // 4. Embedded Image Notes: [image:id:scale]
        formatted = formatted.replace(/\[image:(\d+):?(\d*\.?\d+)?\]/g, (match, id, scaleFactor) => {
            const meta = STATE.note_map && STATE.note_map[id];
            
            // Validation: Ensure the note exists and is an image type
            if (meta && meta.type === 'image') {
                const scale = parseFloat(scaleFactor) || 1.0;
                const width = Math.min(Math.max(scale * 100, 10), 100); // Bounds: 10% - 100%
                
                return `<div class="note-embedded-wrap" style="width: ${width}%;" onclick="handleNoteLinkClick(${id})"><img src="/notes/serve/${id}" class="note-embedded-img" alt="${window.escapeHtml(meta.title)}" loading="lazy"><div class="note-embedded-caption">🖼️ ${window.escapeHtml(meta.title || `Image #${id}`)}</div></div>`;
            }
            
            // Fallback: Broken/Missing Image Reference
            return `<div class="note-embedded-broken">⚠️ [image:${id}] - Reference not found</div>`;
        });

        return formatted;
    }).join('\n');

    // Neutralizes line breaks for consistent block-to-inline transitions in pre-formatted areas
    return result.replace(/\n(<div class="note-embedded-(wrap|broken)"[^>]*>)/g, '$1').replace(/(<\/div>)\n/g, '$1');
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
                <li><strong>Mouse Wheel</strong> - Zoom in/out to scale the perspective</li>
            </ul>
        </div>
    `;

    showConfirmModal({
        title: 'Guide',
        icon: 'ℹ️',
        message: helpContent,
        confirmText: 'Got it',
        confirmIcon: 'ℹ️',
        hideCancel: true,
        width: 'medium'
    });
}

/**
 * Note Link Interaction Handler
 * Manages local centering or cross-canvas transitions for [note:#] links.
 * @param {number|string} id - The target note ID.
 */
function handleNoteLinkClick(id) {
    const meta = STATE.note_map[id];
    if (!meta) return;

    // Orchestration Logic: Local Viewport Shift vs Cross-Canvas Transposition
    if (meta.canvas_id == STATE.canvas_id) {
        centerOnNote(id);
    } else {
        switchCanvas(meta.canvas_id, id);
    }
}

/**
 * Toggles the checkbox state within a note and persists to the backend.
 * @param {Event} event - The checkbox change event.
 * @param {number|string} noteId - The note ID.
 * @param {number} lineIndex - The zero-based line index to update.
 * @returns {Promise<void>}
 */
async function toggleNoteCheckbox(event, noteId, lineIndex) {
    event.stopPropagation();
    const note = STATE.notes.find(n => n.id == noteId);
    if (!note) return;

    const isChecked = event.target.checked;
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

    // Background Sync: Use the established save pattern
    const el = document.getElementById(`note-${noteId}`);
    const params = {
        id: noteId,
        canvas_id: STATE.canvas_id,
        title: note.title,
        content: newContent,
        color: note.color,
        layer_id: note.layer_id || STATE.activeLayerId,
        x: note.x,
        y: note.y,
        width:  note.is_collapsed ? (note.width  || (el ? el.offsetWidth : 0))  : (el ? el.offsetWidth : note.width),
        height: note.is_collapsed ? (note.height || (el ? el.offsetHeight : 0)) : (el ? el.offsetHeight : note.height),
        z_index: el ? el.style.zIndex : note.z_index,
        is_collapsed: note.is_collapsed,
        is_options_expanded: note.is_options_expanded
    };

    try {
        const res = await apiPost('/notes/api/save', params);
        if (res && res.success) {
            STATE.notes         = res.notes; // State transition reconciliation
            STATE.last_mutation = res.last_mutation;
            STATE.note_map      = res.note_map || STATE.note_map;
            
            // Targeted Refresh: Update only the viewer to reflect checkbox state (strikethrough)
            const viewer = el ? el.querySelector('.note-text-viewer') : null;
            if (viewer) {
                viewer.innerHTML = formatNoteContent(newContent, noteId);
            }
        }
    } catch (err) {
        console.error('[TODO] Checkbox sync failed:', err);
        showToast('Failed to sync checkbox state', 'error');
    }
}

// Global Exposure: Required for inline event handlers
window.formatNoteContent = formatNoteContent;
window.toggleNoteCheckbox = toggleNoteCheckbox;
window.handleNoteLinkClick = handleNoteLinkClick;

/**
 * Recycle Bin Persistence & Interface Orchestration
 */

async function openBinModal() {
    const modal = document.getElementById('note-bin-modal');
    if (!modal) return;
    
    // Initial Load: Fetch deleted items before showing
    const res = await apiGet('/notes/api/bin');
    if (res && res.success) {
        renderBin(res.notes);
        modal.classList.add('show');
        document.body.classList.add('modal-open');
    } else {
        showToast('Failed to load Recycle Bin', 'error');
    }
}

function closeBinModal() {
    const modal = document.getElementById('note-bin-modal');
    if (modal) {
        modal.classList.remove('show');
        document.body.classList.remove('modal-open');
    }
}

/**
 * Renders the list of deleted notes within the bin modal.
 * @param {Array} notes - Deleted note objects.
 */
function renderBin(notes) {
    const container = document.getElementById('bin-results-container');
    if (!container) return;

    container.innerHTML = '';

    if (notes.length === 0) {
        container.innerHTML = `
            <div class="bin-empty-state">
                📭
                <p>Recycle Bin is empty.</p>
            </div>
        `;
        return;
    }

    notes.forEach(note => {
        const item = document.createElement('div');
        item.className = 'bin-item';
        
        const accentColor = normalizeColorHex(note.color);
        item.style.setProperty('--note-accent', accentColor);

        item.innerHTML = `
            <div class="bin-item-icon">${note.type === 'image' ? '🖼️' : '📄'}</div>
            <div class="bin-item-info">
                <div class="bin-item-title">${escapeHtml(note.title || 'Untitled Note')}</div>
                <div class="bin-item-meta">
                    <span class="bin-item-board-badge">
                        📂 ${escapeHtml(note.canvas_name || 'Deleted Board')}
                    </span>
                    <span>Deleted ${new Date(note.updated_at).toLocaleDateString()}</span>
                </div>
            </div>
            <div class="bin-item-actions">
                <button class="btn-icon-square btn-success" onclick="restoreNote(${note.id})" title="Restore Note">
                    🔄
                </button>
                <button class="btn-icon-square btn-danger" onclick="confirmPurge(${note.id})" title="Delete Permanently">
                    🗑️
                </button>
            </div>
        `;
        container.appendChild(item);
    });
}

/**
 * Restores a note from the bin and triggers a workspace refresh.
 * @param {number} id - Target note ID.
 */
async function restoreNote(id) {
    showConfirmModal({
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
                openBinModal(); // Refresh bin list
            } else {
                showToast(res.error || 'Restoration failed', 'error');
            }
        }
    });
}

/**
 * High-Stakes Confirmation: Permanent Purge
 * @param {number} id - Target note ID.
 */
function confirmPurge(id) {
    showConfirmModal({
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
                openBinModal(); // Refresh Bin
                showToast('Note permanently removed', 'success');
            }
        }
    });
}

// Global Exposure: Required for high-fidelity interactive elements
window.openBinModal = openBinModal;
window.closeBinModal = closeBinModal;
window.restoreNote = restoreNote;
window.confirmPurge = confirmPurge;
window.deleteNote = deleteNote;
window.toggleInlineEdit = window.toggleInlineEdit || (typeof toggleInlineEdit !== 'undefined' ? toggleInlineEdit : null);
window.copyNoteLink = window.copyNoteLink || (typeof copyNoteLink !== 'undefined' ? copyNoteLink : null);
window.openMoveModal = window.openMoveModal || (typeof openMoveModal !== 'undefined' ? openMoveModal : null);
window.openLayerActionModal = window.openLayerActionModal || (typeof openLayerActionModal !== 'undefined' ? openLayerActionModal : null);

