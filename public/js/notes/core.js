// /public/js/notes/core.js

/**
 * Whiteboard Module: Core Logic & Context Orchestrator
 * 
 * 📂 MODULE STRUCTURE:
 * 1. core.js (This File): Central state container, initialization, and heartbeat synchronization.
 * 2. api.js: Backend integration, position syncing, and security token management.
 * 3. rendering.js: DOM generation, markdown parsing, and UI refresh orchestration.
 * 4. interactions.js: Physics engines (Drag/Resize/Sticky), navigation, and grid snapping.
 * 5. attachments.js: Binary file operations and multi-file management interface.
 * 6. modals.js: Lifecycle management for all overlays and form population.
 * 7. radar.js: Minimap rendering and precision viewport navigation.
 */

/**
 * Global State Container: Single Source of Truth
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
    maxZ:           1,     // Global Depth Tracking: Accelerates "Bring to Front" actions to O(1)
    pickedNoteId:   null,  // Active 'Pick & Place' record
    lastPickTime:   null,  // Interaction Guard: Prevent immediate drop re-triggering
    originalPos:    null,  // Restore-point for 'Escape-to-Cancel'
    dragOffset:     { x: 0, y: 0 }, // Dynamic delta for 'Pick & Place'
    isPanning:      false,          // Drag-to-Scroll State
    panStart:       { x:0, y:0, scrollX:0, scrollY:0 },
    last_mutation:  null,           // Synchronization Baseline
    heartbeatTimer: null,           // Active Polling Reference
    lastPolledCanvasId: null,      // Context Shift Guard: Prevents redundant timer resets
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
    pinchStartDist: null,             // Mobile Gestures: Distance baseline
    pinchStartScale: null,            // Mobile Gestures: Scale baseline
    wrapperEl:      null,             // Cached DOM Handle: #canvas-wrapper
    canvasEl:       null              // Cached DOM Handle: #notes-canvas
};

/**
 * Unified Draft Context for New/Pasted Notes
 */
let DRAFT_NOTE = null;

// Scale bounds
const SCALE_MIN  = 0.1;
const SCALE_MAX  = 3.00;
const SCALE_STEP = 0.1;

window.addEventListener('load', () => {
    initNotes();
});

// State Synchronization: Save viewport before reload
window.addEventListener('beforeunload', () => {
    if (!STATE.isInitializing) {
        if (typeof saveViewportImmediate === 'function') {
            saveViewportImmediate();
        }
    }
});

/**
 * Initializes the whiteboard module.
 * @returns {void}
 */
async function initNotes() {
    // 1. Initial Cache: Establish DOM handles BEFORE any logic runs
    STATE.canvasEl  = document.getElementById('notes-canvas');
    STATE.wrapperEl = document.getElementById('canvas-wrapper');

    // 2. Hydration: Pull state from backend (now has access to handles for scroll/positioning)
    await loadState(true); 
    
    // 3. Synchronization: Establish the reactive heartbeat after initial hydration
    setupHeartbeat();
    // Event Delegation for Canvas Interactions
    const canvas  = STATE.canvasEl;
    const wrapper = STATE.wrapperEl;
    if (canvas && wrapper) {
        if (typeof handleCanvasDoubleClick === 'function') canvas.addEventListener('dblclick', handleCanvasDoubleClick);
        if (typeof handleCanvasMouseDown === 'function') canvas.addEventListener('mousedown', handleCanvasMouseDown);
        if (typeof handleCanvasWheel === 'function') wrapper.addEventListener('wheel', handleCanvasWheel, { passive: false });

        // Mobile Support: Unified Touch Delegation (Registered once during init)
        if (typeof handleCanvasTouchStart === 'function') canvas.addEventListener('touchstart', handleCanvasTouchStart, { passive: false });
        if (typeof handleCanvasTouchMove === 'function')  canvas.addEventListener('touchmove',  handleCanvasTouchMove,  { passive: false });
        if (typeof handleCanvasTouchEnd === 'function')   canvas.addEventListener('touchend',   handleCanvasTouchEnd,   { passive: false });
        if (typeof handleCanvasTouchCancel === 'function') canvas.addEventListener('touchcancel', handleCanvasTouchEnd,  { passive: false });
    }
    
    // Global Panning & Scrubbing Listeners
    window.addEventListener('mousemove', (e) => {
        if (typeof handleCanvasMouseMove === 'function') handleCanvasMouseMove(e);
        if (typeof handleRadarMouseMove === 'function') handleRadarMouseMove(e);
    });
    window.addEventListener('mouseup', (e) => {
        if (typeof handleCanvasMouseUp === 'function') handleCanvasMouseUp(e);
        if (typeof handleRadarMouseUp === 'function') handleRadarMouseUp(e);
    });
    
    // Window Resize Bridge: Recalculate spatial metadata on geometry changes
    window.addEventListener('resize', () => {
        if (typeof updateRadar === 'function') updateRadar();
    });
    
    if (document.getElementById('zoom-in')) document.getElementById('zoom-in').addEventListener('click', zoomIn);
    if (document.getElementById('zoom-out')) document.getElementById('zoom-out').addEventListener('click', zoomOut);
    if (document.getElementById('add-text-note')) document.getElementById('add-text-note').addEventListener('click', () => showCreateNoteModal('text'));
    if (document.getElementById('center-view')) document.getElementById('center-view').addEventListener('click', centerView);
    if (document.getElementById('focus-recent')) document.getElementById('focus-recent').addEventListener('click', focusMostRecentNote);
    if (document.getElementById('open-search')) document.getElementById('open-search').addEventListener('click', openSearchModal);
    if (document.getElementById('open-canvas-manager')) document.getElementById('open-canvas-manager').addEventListener('click', openCanvasManager);
    if (document.getElementById('open-note-bin')) document.getElementById('open-note-bin').addEventListener('click', openBinModal);
    
    const openInfoBtn = document.getElementById('open-info');
    if (openInfoBtn) {
        openInfoBtn.addEventListener('click', showBoardInfo);
    }

    // Radar Minimap Listener: Teleport, Scrubbing & Quick-Zoom
    const radar = document.getElementById('radar-container');
    const rView = document.getElementById('radar-viewport');
    if (radar && rView) {
        if (typeof handleRadarMouseDown === 'function') radar.addEventListener('mousedown', handleRadarMouseDown);
        if (typeof handleRadarWheel === 'function') radar.addEventListener('wheel',     handleRadarWheel, { passive: false });
    }

    // Radar Initial State Sync
    if (typeof renderRadarState === 'function') renderRadarState();

    // Search Input Listener
    const searchInput = document.getElementById('note-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => filterSearch(e.target.value));
    }
    // Interaction: Global Clipboard Sync (Ctrl+V)
    document.addEventListener('paste', handleGlobalClipPaste);

    const createConfirmBtn = document.getElementById('create-note-btn');
    if (createConfirmBtn) {
        createConfirmBtn.addEventListener('click', executeCreateNote);
    }
    
    // Attachment Layer: Handle local file selection triggers
    const uploadBtn = document.getElementById('upload-note-btn');
    const fileInput = document.getElementById('create-note-file-input');


    if (uploadBtn && fileInput) {
        uploadBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', handleFileSelection);
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

    if (typeof setupUserSearch === 'function') setupUserSearch();

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

    // Toggle Drawer & Focus Listener (Delegated)
    if (canvas) {
        // 1. Z-Index focus on mousedown: Ensuring notes jump to front immediately
        canvas.addEventListener('mousedown', (e) => {
            const noteEl = e.target.closest('.sticky-note');
            if (noteEl) {
                const noteId = noteEl.dataset.id;
                const note   = STATE.notes.find(n => n.id == noteId);

                // --- 1. Interaction Guard ---
                const isTrigger = e.target.closest('.note-check-trigger, .note-link-trigger, .reel-action-btn, .btn-icon-drawer');
                
                // --- 2. Focus Management (Z-Index) ---
                // Logic: Promote to foreground only if not already top-level
                if (note && note.z_index < STATE.maxZ) {
                    const newZ = ++STATE.maxZ;
                    note.z_index = newZ;
                    noteEl.style.zIndex = newZ;
                    if (typeof syncNotePosition === 'function') syncNotePosition(noteId, 'silent');
                }
            }
        }, { passive: true });

        // 2. Interactive Action Listener (Delegated)
        canvas.addEventListener('click', (e) => {
            const noteEl = e.target.closest('.sticky-note');
            if (noteEl) {
                const noteId = noteEl.dataset.id;
                const note   = STATE.notes.find(n => n.id == noteId);

                // --- 2. Action Drawer Toggle ---
                const toggleBtn = e.target.closest('.btn-icon-drawer');
                if (toggleBtn) {
                    const drawer = document.getElementById(`drawer-${noteId}`);
                    if (drawer && note) {
                        drawer.classList.toggle('expanded');
                        note.is_options_expanded = drawer.classList.contains('expanded') ? 1 : 0;
                        toggleBtn.classList.toggle('active', !!note.is_options_expanded);
                        if (typeof syncNotePosition === 'function') syncNotePosition(noteId, 'silent');
                    }
                    return; // Terminate signal for drawer action
                }

                // --- 3. Note Link Jump Navigation ---
                const linkTrigger = e.target.closest('.note-link-trigger');
                if (linkTrigger) {
                    e.stopPropagation();
                    const targetId = linkTrigger.dataset.targetId;
                    if (typeof handleNoteLinkClick === 'function') {
                        handleNoteLinkClick(targetId);
                    }
                    return; // Terminate signal for link jump
                }

                // --- 4. Interactive Todo Checkbox ---
                const checkTrigger = e.target.closest('.note-check-trigger');
                if (checkTrigger) {
                    e.stopPropagation();
                    const noteId    = checkTrigger.dataset.noteId;
                    const lineIndex = parseInt(checkTrigger.dataset.index);
                    if (typeof toggleNoteCheckbox === 'function') {
                        toggleNoteCheckbox(e, noteId, lineIndex);
                    }
                    return; // Terminate signal for checkbox action
                }
            }
        });
    }

    if (typeof setupGlobalModalClosing === 'function') {
        setupGlobalModalClosing(['modal-overlay'], [
            closeViewModal, closeCreateModal, closeSearchModal, 
            closeCanvasManager, closeMoveModal, closeBoardSettings, 
            closeBinModal, closeImageViewer, closePDFViewer
        ]);
    }
    
    // Robust Event Delegation: Handles all close triggers (static & dynamic)
    document.addEventListener('click', (e) => {
        const closeBtn = e.target.closest('[data-close="modal"]');
        if (closeBtn) {
            if (typeof closeViewModal === 'function') closeViewModal();
            if (typeof closeCreateModal === 'function') closeCreateModal();
            if (typeof closeSearchModal === 'function') closeSearchModal();
            if (typeof closeCanvasManager === 'function') closeCanvasManager();
            if (typeof closeMoveModal === 'function') closeMoveModal();
            if (typeof closeBoardSettings === 'function') closeBoardSettings();
            if (typeof closeBinModal === 'function') closeBinModal();
            if (typeof closeImageViewer === 'function') closeImageViewer();
            if (typeof closePDFViewer === 'function') closePDFViewer();
        }
    });

    // Copy button in the view modal
    if (document.getElementById('note-view-copy-btn')) {
        document.getElementById('note-view-copy-btn').addEventListener('click', copyViewContent);
    }

    // Persist scroll position on scroll (debounced)
    if (wrapper) {
        if (typeof onViewportScroll === 'function') wrapper.addEventListener('scroll', onViewportScroll);
    }

    // Interaction: Activate Drag-and-Drop File Engine
    if (typeof initDropZones === 'function') {
        initDropZones();
    }

    // Global Interface: Keydown Listeners (ESC/Arrows)
    if (typeof handleGlobalKeydown === 'function') document.addEventListener('keydown', handleGlobalKeydown);
    
    // Global Click Listener for 'Pick & Place' Drop Conclusion
    if (typeof handleGlobalClick === 'function') document.addEventListener('click', handleGlobalClick, true);

    // Icon Registry Initialization: Read from the non-inline data anchor
    if (canvas && canvas.dataset.icons) {
        try {
            window.GLOBAL_ICONS = JSON.parse(canvas.dataset.icons);
        } catch (e) {
            console.error('Icon Registry hydration failed:', e);
        }
    }

    // Global Exposure: Required for high-fidelity interactive elements and onclick handlers
    // We assign these inside initNotes to ensure all modules have loaded and their functions are defined.
    window.openBinModal = openBinModal;
    window.closeBinModal = closeBinModal;
    window.restoreNote = typeof restoreNote !== 'undefined' ? restoreNote : null;

    window.deleteNote = typeof deleteNote !== 'undefined' ? deleteNote : null;
    window.removePendingUpload = typeof removePendingUpload !== 'undefined' ? removePendingUpload : null;
    window.toggleInlineEdit = typeof toggleInlineEdit !== 'undefined' ? toggleInlineEdit : null;
    window.copyNoteLink = typeof copyNoteLink !== 'undefined' ? copyNoteLink : null;
    window.openMoveModal = typeof openMoveModal !== 'undefined' ? openMoveModal : null;
    window.openLayerActionModal = typeof openLayerActionModal !== 'undefined' ? openLayerActionModal : null;
    window.viewNote = typeof viewNote !== 'undefined' ? viewNote : null;
    window.toggleCollapse = typeof toggleCollapse !== 'undefined' ? toggleCollapse : null;
    window.updateNoteAccent = typeof updateNoteAccent !== 'undefined' ? updateNoteAccent : null;
    window.handleNoteLinkClick = typeof handleNoteLinkClick !== 'undefined' ? handleNoteLinkClick : null;
    window.copyNoteToClipboard = typeof copyNoteToClipboard !== 'undefined' ? copyNoteToClipboard : null;
    window.copyNoteId = typeof copyNoteId !== 'undefined' ? copyNoteId : null;
    window.triggerInlineUpload = typeof triggerInlineUpload !== 'undefined' ? triggerInlineUpload : null;
    window.handleInlineFileSelection = typeof handleInlineFileSelection !== 'undefined' ? handleInlineFileSelection : null;
    window.viewNoteImage = typeof viewNoteImage !== 'undefined' ? viewNoteImage : null;
    window.closeImageViewer = typeof closeImageViewer !== 'undefined' ? closeImageViewer : null;
    window.openPDFViewer  = typeof openPDFViewer  !== 'undefined' ? openPDFViewer  : null;
    window.closePDFViewer = typeof closePDFViewer !== 'undefined' ? closePDFViewer : null;
    window.copyViewContent = typeof copyViewContent !== 'undefined' ? copyViewContent : null;
    window.zoomIn = typeof zoomIn !== 'undefined' ? zoomIn : null;
    window.zoomOut = typeof zoomOut !== 'undefined' ? zoomOut : null;
    window.centerView = typeof centerView !== 'undefined' ? centerView : null;
    window.focusMostRecentNote = typeof focusMostRecentNote !== 'undefined' ? focusMostRecentNote : null;
    window.openSearchModal = typeof openSearchModal !== 'undefined' ? openSearchModal : null;
    window.openCanvasManager = typeof openCanvasManager !== 'undefined' ? openCanvasManager : null;
    window.showBoardInfo = typeof showBoardInfo !== 'undefined' ? showBoardInfo : null;
    window.updateLevelDisplay = typeof updateLevelDisplay !== 'undefined' ? updateLevelDisplay : null;
    window.renameCurrentLevel = typeof renameCurrentLevel !== 'undefined' ? renameCurrentLevel : null;
    window.filterSearch = typeof filterSearch !== 'undefined' ? filterSearch : null;
    window.toggleNoteCheckbox = typeof toggleNoteCheckbox !== 'undefined' ? toggleNoteCheckbox : null;
    window.moveLevel = typeof moveLevel !== 'undefined' ? moveLevel : null;
    window.openJumpToLevelModal = typeof openJumpToLevelModal !== 'undefined' ? openJumpToLevelModal : null;
    window.switchLevel = typeof switchLevel !== 'undefined' ? switchLevel : null;
    window.saveNoteInline = typeof saveNoteInline !== 'undefined' ? saveNoteInline : null;
    window.editNote = typeof editNote !== 'undefined' ? editNote : null;
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
    STATE.isSyncing = true;
    if (initial) STATE.isInitializing = true; // Protect interface state during initial hydration

    // Reset rendering error baseline on every state hydration to allow re-reporting of persistent issues
    if (window._renderErrors) window._renderErrors.clear();
    
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
        
        // Logic Gate PRE-FLIGHT: Calculate if this is a context change BEFORE we update STATE
        const isContextChange = (tid && tid != STATE.canvas_id) || (layer_id && layer_id != STATE.activeLayerId);

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
            
            // Interaction Optimization: Calculate global Z-index baseline once per hydration
            STATE.maxZ = STATE.notes.reduce((max, n) => Math.max(max, n.z_index || 1), 1);
            
            // Sync Branding Pill
            const canvasObj = STATE.canvases.find(c => c.id == STATE.canvas_id);
            const pill      = document.getElementById('active-board-name-pill');
            if (canvasObj && pill) {
                pill.textContent = canvasObj.name;
            }

            // URL Parameter Lifecycle: Standardize on a clean, board-agnostic URL.
            const url = new URL(window.location.href);
            if (url.searchParams.has('canvas_id') || url.searchParams.has('note_id') || url.searchParams.has('layer_id')) {
                url.searchParams.delete('canvas_id');
                url.searchParams.delete('note_id');
                url.searchParams.delete('layer_id');
                window.history.replaceState({ canvas_id: STATE.canvas_id }, '', url);
            }

            // --- Layer Context Synchronization ---
            if (layer_id) {
                STATE.activeLayerId = parseInt(layer_id);
                if (typeof updateLevelDisplay === 'function') updateLevelDisplay();
            } 
            else if (data.viewport && data.viewport.layer_id) {
                STATE.activeLayerId = parseInt(data.viewport.layer_id);
            }

            // --- Viewport Restoration Strategy ---
            const localVp = (typeof getLocalViewport === 'function') ? getLocalViewport(tid || STATE.canvas_id, STATE.activeLayerId) : null;
            
            let serverTs = 0;
            if (data.viewport && data.viewport.updated_at) {
                const parts = data.viewport.updated_at.split(/[- :]/);
                serverTs = new Date(parts[0], parts[1]-1, parts[2], parts[3], parts[4], parts[5]).getTime();
            }
            
            let useLocal = localVp && (localVp.ts > serverTs);

            // This prevents the 2s heartbeat from "jumping" the camera back to a stale position while the user is panning.
            const shouldRestoreViewport = initial || nid || isContextChange;

            if (shouldRestoreViewport && (useLocal || data.viewport)) {
                const vp = useLocal ? localVp : data.viewport;
                
                STATE.scale = parseFloat(vp.scale) || 1.0;
                
                if (typeof applyScale === 'function') applyScale();

                if (vp.layer_id) {
                    STATE.activeLayerId = parseInt(vp.layer_id);
                    if (typeof updateLevelDisplay === 'function') updateLevelDisplay();
                } else {
                    if (typeof updateLevelDisplay === 'function') updateLevelDisplay();
                }

                // Force a layout reflow for accurate scrollWidth/Height
                const wrapper = STATE.wrapperEl;
                if (wrapper) {
                    const centerX = parseFloat(vp.scroll_x) || (STATE.canvasSize / 2);
                    const centerY = parseFloat(vp.scroll_y) || (STATE.canvasSize / 2);

                    wrapper.scrollTo({
                        left: (centerX * STATE.scale) - (wrapper.clientWidth  / 2),
                        top: (centerY * STATE.scale) - (wrapper.clientHeight / 2),
                        behavior: 'auto'
                    });
                }
                
                // Release the guard after stabilization
                setTimeout(() => { STATE.isInitializing = false; }, 200);
            } else {
                if (initial && !nid) {
                    if (typeof centerView === 'function') centerView();
                }
                
                if (tid) STATE.canvas_id = parseInt(tid);
                if (layer_id) STATE.activeLayerId = parseInt(layer_id);

                if (!nid) STATE.isInitializing = false;
            }

            // --- Reliability Guardian ---
            if (initial && !window.SYNC_GUARDIAN_INIT) {
                window.SYNC_GUARDIAN_INIT = true;
                if (typeof processSyncQueue === 'function') setInterval(processSyncQueue, 30000);
                if (typeof pruneLocalStorage === 'function') pruneLocalStorage();
            }

            // Remote Centering Dispatch
            if (nid) {
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        if (typeof centerOnNote === 'function') {
                            centerOnNote(nid).finally(() => {
                                STATE.isInitializing = false;
                            });
                        } else {
                            STATE.isInitializing = false;
                        }
                    }, 300);
                });
            }
        } else {
            showToast('Failed to load whiteboard state', 'error');
            if (initial) STATE.notes = [];
        }
    } catch (err) {
        console.error('loadState Error:', err);
        if (initial) STATE.notes = [];
    } finally {
        STATE.isSyncing = false;
        // Global Safety Reset: Ensure interface is unlocked if not in a designated stabilization phase (centering callback owns it)
        if (!nid) STATE.isInitializing = false;
    }

    // Render UI after all state is consolidated
    if (typeof renderUI === 'function') renderUI();

    return true;
}

/**
 * Reactive Heartbeat Engine
 * Periodically polls the server for workspace mutations.
 * 
 * Exposed on `window` to allow auxiliary modules (modals.js, api.js) to trigger
 * a polling reset after context switches without importing core.js.
 * @returns {void}
 */
window.setupHeartbeat = function setupHeartbeat() {
    const canvasId = STATE.canvas_id;
    if (!canvasId) return;

    // Fast-Exit Guard: Avoid unintended debouncing if heartrate is already aligned
    if (STATE.heartbeatTimer && STATE.lastPolledCanvasId === canvasId) {
        return;
    }

    // Synchronous Teardown: Ensure no duplicate intervals exist during context shifts
    if (STATE.heartbeatTimer) {
        clearInterval(STATE.heartbeatTimer);
        STATE.heartbeatTimer = null;
    }
    
    // Lock the context immediately to prevent race conditions during async initialization
    STATE.lastPolledCanvasId = canvasId;
    
    STATE.heartbeatTimer = setInterval(async () => {
        // Inner Guard: Protect against mid-teardown ticks or race conditions
        if (!STATE.canvas_id || STATE.isInitializing) return;

        // Interaction Inhibition: Prevent state hydration during active gestures
        const isInteracting = STATE.isPanning      || 
                              STATE.isDragging     || 
                              STATE.isResizing     || 
                              STATE.isEditingNote  || 
                              STATE.pickedNoteId   || 
                              document.querySelector('.modal-overlay.show') || 
                              ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) ||
                              document.hidden;

        if (isInteracting || STATE.isSyncing) return;
        
        try {
            // Heartbeat remains stable across level switches (dynamic STATE read)
            const res = await fetch(`/notes/api/heartbeat/${STATE.canvas_id}?layer_id=${STATE.activeLayerId}`);
            const data = await res.json();
            
            if (data.success && data.last_mutation !== STATE.last_mutation) {
                await loadState(false, STATE.canvas_id, null, STATE.activeLayerId);
            }
        } catch (e) {
            // Heartbeat failures are non-critical (Network jitter)
        }
    }, 2000); // 2s Cycle: Responsive real-time experience
}

/**
 * Cache Invalidation: Nullifies DOM handles to prevent stale references 
 * across full-board re-renders or dynamic context switches.
 */
function clearDOMCache() {
    STATE.wrapperEl = null;
    STATE.canvasEl  = null;
}

// Global Exposure Block
window.loadState = loadState;
window.initNotes = initNotes;
window.clearDOMCache = clearDOMCache;
window.STATE = STATE;
