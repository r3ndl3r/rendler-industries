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
    viewportDirty:  false, // Mutation Guard: Prevents heartbeat from overwriting unsaved local scrolls
    selectedNoteIds: new Set(), // Bulk Operations: Tracks notes captured by the Marquee/Lasso
    lassoNoteCache:  null,      // Performance: Cached note rects for marquee hit-testing
    pickedNoteId:   null,  // Active 'Pick & Place' record
    lastPickTime:   null,  // Interaction Guard: Prevent immediate drop re-triggering
    originalPos:    null,  // Restore-point for 'Escape-to-Cancel'
    groupBaseline:  null,  // Snapshot of positions for bulk dragging
    dragOffset:     { x: 0, y: 0 }, // Dynamic delta for 'Pick & Place'
    isPanning:      false,          // Drag-to-Scroll State
    panStart:       { x:0, y:0, scrollX:0, scrollY:0 },
    isLassoing:          false,          // Bulk Selection State
    lassoStart:          { x:0, y:0 },  // Marquee Anchor (Absolute Board Coords)
    lassoJustFinished:   false,          // Transient: suppresses contextmenu for 50ms after right-click lasso release
    last_mutation:  null,           // Synchronization Baseline
    heartbeatTimer: null,           // Active Polling Reference
    heartbeatController: null,      // AbortController: Standardizes request cancellation
    lastPolledCanvasId: null,      // Context Shift Guard: Prevents redundant timer resets
    isResizing:     null,          // Interaction ID: Stores active Note ID for merging (formerly boolean)
    isEditingNote:  null,          // Interaction ID: Stores active Note ID for merging (formerly boolean)
    activeLayerId:  1,               // Level Isolation Filter (1-99)
    layer_map:      {},              // Shared Level Aliases { layer_id => alias }
    isSwitchingLayer: false,         // Interaction Guard: Prevents overlapping transitions
    note_map:       {},              // Metadata Registry for [note:#] resolution
    note_map_hash:  null,            // Synchronization Fingerprint: Enables O(1) heartbeat handshake
    autoScroll: {
        lastEvent: null,
        frame:     null,
        active:    false,
        margin:    15,             // Proximity triggers (px)
        maxSpeed:  15,             // Peak velocity at absolute edge
        startTime: null,           // Intentionality Timestamp
        delay:     200             // Milliseconds of hold required to trigger
    },
    activeSyncs: new Map(),        // Anti-Regression Registry: Tracks Note IDs with in-flight API transactions
    lastBoardScrollTime: 0,        // Continuity Guard: Prevents note-hijack during board scrolling
    syncQueue:      [],              // Transactional Retry Container
    isSyncing:      false,           // Flow Control: Prevents concurrent flush cycles
    pendingContext: null,            // Context Queue: Stores board/layer switches blocked by active sync
    aliasTimer:     null,            // Lifecycle Handle: Auto-hide delay for level names
    isScrubbing:    false,           // Interaction Layer: Active radar-panning state
    radarScrubLast: { x: 0, y: 0 },   // Delta Tracking: Powering the 'Precision Gearbox'
    pinchStartDist: null,             // Mobile Gestures: Distance baseline
    pinchStartScale: null,            // Mobile Gestures: Scale baseline
    wrapperEl:      null,             // Cached DOM Handle: #canvas-wrapper
    canvasEl:       null,             // Cached DOM Handle: #notes-canvas
    unlockedCanvases: new Set(),      // Session Privacy: Tracks IDs of protected boards currently unlocked
    isLocked:       false,            // Privacy State: Single source of truth for visibility
    hoveredNoteId:  null,             // Interactivity Context: ID of the note currently under the cursor
    pickedWidth:    0,                // Cache: Width captured at start of flight
    pickedHeight:   0,                // Cache: Height captured at start of flight
    activeRectBaseline: null,         // Cache: Wrapper BoundingClientRect at flight start
    sessionId: (() => {
        const genId = () => {
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                return crypto.randomUUID().replace(/-/g, '').substring(0, 16);
            }
            const buf = new Uint8Array(8);
            if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
                crypto.getRandomValues(buf);
                return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
            }
            return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`.slice(0, 16);
        };

        const k = 'notes_session_id';
        try {
            let id = sessionStorage.getItem(k);
            if (!id) {
                id = genId();
                sessionStorage.setItem(k, id);
            }
            return id;
        } catch (e) {
            return genId();
        }
    })() // Tab-level Identity: Distinguishes sessions across refreshes
};

/**
 * Registers a note as 'in-flight' to the API.
 * This prevents the heartbeat from overwriting the DOM while a save is pending.
 * @param {number|string} noteId - The identifier of the note.
 * @returns {void}
 */
window.addActiveSync = function(noteId) {
    const key = String(noteId); // Boundary Normalization: Ensures Map lookup parity
    const count = STATE.activeSyncs.get(key) || 0;
    STATE.activeSyncs.set(key, count + 1);
};

/**
 * Unregisters a note once the API call completes.
 * @param {number|string} noteId - The identifier of the note.
 * @returns {void}
 */
window.removeActiveSync = function(noteId) {
    const key = String(noteId); // Boundary Normalization: Ensures Map lookup parity
    const count = STATE.activeSyncs.get(key);
    if (count > 1) {
        STATE.activeSyncs.set(key, count - 1);
    } else {
        STATE.activeSyncs.delete(key);
    }
};

/**
 * Unified Draft Context for New/Pasted Notes
 */
let DRAFT_NOTE = null;

// Selection Containment: Blinder Pattern state
let _selBlocked = [];
let _selectionGuardInit = false;



// Scale bounds
const SCALE_MIN  = 0.1;
const SCALE_MAX  = 3.00;
const SCALE_STEP = 0.1;

/**
 * Renders the privacy shield over the canvas area.
 * @param {boolean} autoFocus - Whether to focus the password field immediately.
 * @returns {void}
 */
window.showLockedOverlay = function(autoFocus = true) {
    const overlay = document.getElementById('canvas-lock-overlay');
    if (!overlay) return;

    STATE.isLocked = true;
    STATE.notes = [];
    STATE.note_map = {};
    STATE.note_map_hash = null;
    overlay.style.display = 'flex';

    const input = document.getElementById('unlock-password');
    if (input) {
        input.value = '';
        if (autoFocus) input.focus();
    }
};

/**
 * Removes the privacy shield and restores canvas clarity.
 * @returns {void}
 */
window.hideLockedOverlay = function() {
    const overlay = document.getElementById('canvas-lock-overlay');
    if (!overlay) return;

    STATE.isLocked = false;
    overlay.style.display = 'none';
};


/**
 * Communicates with the backend to verify password and unlock the board.
 * @returns {Promise<void>}
 */
window.apiUnlockCanvas = async function() {
    const input = document.getElementById('unlock-password');
    const password = input?.value;
    if (!password) return showToast('Password is required', 'error');

    const targetCanvasId = STATE.canvas_id;
    const targetLayerId  = STATE.activeLayerId;
    showLoadingOverlay(`⏳ Unlocking...`);
    try {
        const res = await NoteAPI.post('/notes/api/unlock_canvas', { 
            canvas_id: targetCanvasId, 
            password: password 
        });

        if (res && res.success) {
            // Context Drift Guard: Ensure user hasn't navigated away during the request
            if (STATE.canvas_id !== targetCanvasId || STATE.activeLayerId !== targetLayerId) {
                hideLoadingOverlay();
                return;
            }

            // Sync unlock state from server response immediately so canvas manager/switcher
            // reflect the new status even if loadState is delayed below.
            if (res.unlocked_canvases) {
                STATE.unlockedCanvases = new Set(res.unlocked_canvases.map(id => parseInt(id)));
            }

            // Spin-wait for any concurrent sync to clear before hydrating state.
            // Prevents isSyncing guard from silently returning false and leaving isLocked=true.
            if (STATE.isSyncing) {
                await new Promise(resolve => {
                    const deadline = Date.now() + 3000;
                    const poll = setInterval(() => {
                        if (!STATE.isSyncing || Date.now() >= deadline) { 
                            clearInterval(poll); 
                            resolve(); 
                        }
                    }, 30);
                });
            }

            if (STATE.canvas_id !== targetCanvasId || STATE.activeLayerId !== targetLayerId) {
                hideLoadingOverlay();
                return;
            }

            try {
                // State Synchronization: Defer hiding the overlay until AFTER data is loaded.
                // Ensures if loadState fails, the user is still presented with the lock/retry interface.
                await loadState(false, targetCanvasId, null, targetLayerId);

                if (!STATE.isLocked) {
                    // Success Path: loadState confirmed the board is accessible.
                    // Note: hideLockedOverlay() is already called within loadState's successful else branch.
                    showToast('Access granted', 'success');
                } else {
                    // Concurrent Restriction: Handle board state transition during content fetch.
                    showToast('Board was re-locked. Please try again.', 'error');
                }
            } catch (loadErr) {
                if (STATE.canvas_id === targetCanvasId && STATE.activeLayerId === targetLayerId) {
                    if (typeof showLockedOverlay === 'function') showLockedOverlay();
                }
                
                // Authoritative Error Feedback: Ensure no failure path is silent.
                // The normalization contract in loadState ensures a consistent rejection experience.
                showToast('Failed to load board content. Please try again.', 'error');
            }
        } else {
            // Enhanced Feedback: Show error toast on failure
            showToast(res?.error || 'Access denied', 'error');

            const card = document.querySelector('.lock-card');
            if (card) {
                card.classList.add('lock-shake');
                setTimeout(() => card.classList.remove('lock-shake'), 500);
            }
            if (input) {
                input.value = '';
                input.focus();
            }
        }
    } catch (e) {
        console.error('Unlock error:', e);
        showToast('Failed to contact server. Please try again.', 'error');
        if (STATE.canvas_id === targetCanvasId && STATE.activeLayerId === targetLayerId) {
            if (typeof showLockedOverlay === 'function') showLockedOverlay();
        }
    } finally {
        hideLoadingOverlay();
    }
};

/**
 * Manually locks a board by clearing its session-unlock status.
 * @param {number|string} canvasId - The canvas ID to lock.
 * @returns {Promise<void>}
 */
window.apiLockCanvas = async function(canvasId) {
    if (!canvasId) return;

    showLoadingOverlay(`⏳ Locking...`);
    try {
        const res = await NoteAPI.post('/notes/api/lock_canvas', { canvas_id: canvasId });
        if (res && res.success) {
            showToast('Board locked', 'info');
            
            // Global State Sync
            if (res.unlocked_canvases) {
                STATE.unlockedCanvases = new Set(res.unlocked_canvases.map(id => parseInt(id)));
            } else {
                STATE.unlockedCanvases.delete(parseInt(canvasId));
            }

            // If we locked the CURRENT board, we must blur it immediately
            if (canvasId == STATE.canvas_id) {
                try {
                    // State Idempotency: Interaction triggers are handled by loadState.
                    // Correctly handles UI transition, preventing double-animation and double-focus flashes.
                    await loadState(false, canvasId, null, STATE.activeLayerId);
                } catch (loadErr) {
                    // State fetch failed post-lock: heartbeat will correct 
                    // STATE.isLocked within the next 2s tick.
                    showToast('Failed to refresh board state. Please wait.', 'error');
                }
            }
            // Always refresh lock-status UIs regardless of which canvas was locked.
            if (typeof renderQuickSwitcher === 'function') renderQuickSwitcher();
            if (typeof renderCanvasList === 'function') renderCanvasList();
        } else {
            showToast(res?.error || 'Failed to lock board', 'error');
        }
    } catch (e) {
        console.error('Locking error:', e);
        showToast('Failed to lock board. Please try again.', 'error');
    } finally {
        hideLoadingOverlay();
    }
};

window.addEventListener('load', initNotes);

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
 * Attaches global listeners and hydrates initial state.
 * @returns {Promise<void>}
 */
async function initNotes() {
    // 1. Initial Cache: Establish DOM handles BEFORE any logic runs
    STATE.canvasEl  = document.getElementById('notes-canvas');
    STATE.wrapperEl = document.getElementById('canvas-wrapper');

    // 2. Hydration: Pull state from backend (now has access to handles for scroll/positioning)
    await loadState(true); 
    
    // 3. Synchronization: Establish the reactive heartbeat after initial hydration
    setupHeartbeat();

    // Marquee Element: Injected once at startup; visibility toggled via the 'show' class during lasso.
    if (STATE.canvasEl && !document.getElementById('lasso-marquee')) {
        const marquee = document.createElement('div');
        marquee.id = 'lasso-marquee';
        marquee.className = 'selection-marquee';
        STATE.canvasEl.appendChild(marquee);
    }

    // Event Delegation for Canvas Interactions
    const canvas  = STATE.canvasEl;
    const wrapper = STATE.wrapperEl;
    if (canvas && wrapper) {
        if (typeof handleCanvasDoubleClick === 'function') canvas.addEventListener('dblclick', handleCanvasDoubleClick);
        if (typeof handleCanvasMouseDown === 'function') canvas.addEventListener('mousedown', handleCanvasMouseDown);
        // Suppress browser context menu so right-click drag can drive the lasso without interruption.
        canvas.addEventListener('contextmenu', e => {
            if (STATE.lassoJustFinished || e.target === STATE.canvasEl || e.target === STATE.wrapperEl) {
                e.preventDefault();
            }
        });
        if (typeof handleCanvasWheel === 'function') wrapper.addEventListener('wheel', handleCanvasWheel, { passive: false });

        // Mobile Support: Unified Touch Delegation (Registered once during init)
        if (typeof handleCanvasTouchStart === 'function') canvas.addEventListener('touchstart', handleCanvasTouchStart, { passive: false });
        if (typeof handleCanvasTouchMove === 'function')  canvas.addEventListener('touchmove',  handleCanvasTouchMove,  { passive: false });
        if (typeof handleCanvasTouchEnd === 'function')   canvas.addEventListener('touchend',   handleCanvasTouchEnd,   { passive: false });
        if (typeof handleCanvasTouchCancel === 'function') canvas.addEventListener('touchcancel', handleCanvasTouchEnd,  { passive: false });
        
        // 4. Interaction Layer: Attach specialized module managers
        if (typeof setupLevelManagement === 'function') setupLevelManagement();
    }
    
    // Global Panning & Scrubbing Listeners
    window.addEventListener('mousemove', (e) => {
        // Track the note currently under the mouse to enable context-aware keyboard shortcuts (CTRL+E)
        const noteEl = e.target.closest?.('.sticky-note');
        STATE.hoveredNoteId = noteEl ? noteEl.dataset.id : null;

        if (typeof handleCanvasMouseMove === 'function') handleCanvasMouseMove(e);
        if (typeof handleRadarMouseMove === 'function') handleRadarMouseMove(e);
        // Free-roam auto-pan: evaluate edge proximity on every mouse move
        if (typeof checkAutoScrollProximity === 'function') checkAutoScrollProximity(e);
    });
    window.addEventListener('mouseup', (e) => {
        if (typeof handleCanvasMouseUp === 'function') handleCanvasMouseUp(e);
        if (typeof handleRadarMouseUp === 'function') handleRadarMouseUp(e);
    });

    // Stop auto-pan when mouse exits the browser viewport (taskbar, OS chrome, etc.)
    document.addEventListener('mouseleave', () => {
        if (typeof stopAutoScroll === 'function') stopAutoScroll();
    });

    // Stop auto-pan when the window loses focus (Alt+Tab, clicking taskbar, etc.)
    window.addEventListener('blur', () => {
        if (typeof stopAutoScroll === 'function') stopAutoScroll();
    });

    // ─── Selection Containment ── Selection Blinder Pattern ───────────────────
    // REASON: Chrome's drag-selection pipeline is synchronous and extends into
    // adjacent DOM nodes before any JS selectionchange handler can intervene.
    // By setting user-select: none on all OTHER note viewers at mousedown, the
    // browser has no selectable targets to spill into.
    // Restored unconditionally on mouseup to leave no permanent style side-effects.
    if (!_selectionGuardInit) {
        document.addEventListener('mousedown', (e) => {
            const sourceNote = e.target.closest('.sticky-note');
            if (!sourceNote) {
                _selBlocked.forEach(el => {
                    el.style.removeProperty('user-select');
                    el.style.removeProperty('-webkit-user-select');
                });
                _selBlocked = [];
                return;
            }

            _selBlocked = [];
            document.querySelectorAll('.note-text-viewer').forEach((el) => {
                if (sourceNote.contains(el)) return;  // leave source note alone
                el.style.setProperty('user-select',         'none', 'important');
                el.style.setProperty('-webkit-user-select', 'none', 'important');
                _selBlocked.push(el);
            });
        }, { capture: true });

        document.addEventListener('mouseup', () => {
            _selBlocked.forEach((el) => {
                el.style.removeProperty('user-select');
                el.style.removeProperty('-webkit-user-select');
            });
            _selBlocked = [];
        }, { capture: true });

        _selectionGuardInit = true;
    }

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
    const radarHandle = document.getElementById('radar-handle-toggle');
    if (radarHandle && typeof toggleRadar === 'function') radarHandle.addEventListener('click', toggleRadar);

    // Radar Initial State Sync
    if (typeof renderRadarState === 'function') renderRadarState();

    // Search Input Listener
    const searchInput = document.getElementById('note-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => filterSearch(e.target.value));
    }
    const globalToggle = document.getElementById('search-global-toggle');
    if (globalToggle) {
        globalToggle.checked = true;
        globalToggle.addEventListener('change', () => filterSearch(document.getElementById('note-search-input').value));
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
                // Logic: Promote to foreground only if not already top-level and not clicking a trigger
                if (!isTrigger && note && note.z_index < STATE.maxZ) {
                    const newZ = ++STATE.maxZ;
                    note.z_index = newZ;
                    noteEl.style.zIndex = newZ;
                    if (typeof syncNotePosition === 'function') syncNotePosition(noteId, 'silent');
                }
            }
        }, { passive: true });

        // 2. Interactive Action Listener (Delegated)
        canvas.addEventListener('click', (e) => {
            // A. Identity Acquisition: Attempt to find the hosting note element
            const noteEl = e.target.closest('.sticky-note');
            const noteId = noteEl ? noteEl.dataset.id : null;
            const note   = noteId ? STATE.notes.find(n => n.id == noteId) : null;

            // B. Action Dispatch: Retrieve the semantic action from the interaction target
            const actionTrigger = e.target.closest('[data-action]');
            const action = actionTrigger ? actionTrigger.dataset.action : null;

            if (action === 'stop-propagation') {
                e.stopPropagation();
                return;
            }

            // --- 3. Note Link Jump Navigation ---
            const linkTrigger = e.target.closest('.note-link-trigger');
            if (linkTrigger) {
                e.stopPropagation();
                const targetId = linkTrigger.dataset.targetId;
                if (typeof handleNoteLinkClick === 'function') {
                    handleNoteLinkClick(targetId);
                }
                return;
            }

            // --- 3b. Note Copy to Clipboard ---
            const copyTrigger = e.target.closest('.note-copy-trigger');
            if (copyTrigger) {
                e.stopPropagation();
                const targetId = copyTrigger.dataset.targetId;
                if (typeof handleNoteCopyClick === 'function') {
                    handleNoteCopyClick(targetId);
                }
                return;
            }

            // --- 3c. Inline Text Copy Block ---
            const inlineCopyTrigger = e.target.closest('.note-inline-copy');
            if (inlineCopyTrigger) {
                e.stopPropagation();
                const text = inlineCopyTrigger.textContent || '';
                navigator.clipboard.writeText(text)
                    .then(() => {
                        inlineCopyTrigger.classList.add('copied');
                        setTimeout(() => inlineCopyTrigger.classList.remove('copied'), 600);
                        showToast('Copied to clipboard', 'success');
                    })
                    .catch(() => showToast('Clipboard access denied', 'error'));
                return;
            }

            // --- 4. Interactive Todo Checkbox ---
            const checkTrigger = e.target.closest('.note-check-trigger');
            if (checkTrigger) {
                e.stopPropagation();
                const tid    = checkTrigger.dataset.noteId;
                const lineIndex = parseInt(checkTrigger.dataset.index);
                if (typeof toggleNoteCheckbox === 'function') {
                    toggleNoteCheckbox(e, tid, lineIndex);
                }
                return;
            }

            // --- 5. New Standardized Data-Actions ---
            if (!action || !noteId) return;

            if (action === 'toggle-drawer') {
                e.stopPropagation();
                if (note) {
                    const newExpanded = note.is_options_expanded ? 0 : 1;

                    note.is_options_expanded = newExpanded;
                    
                    // Single Source of Truth: Sync the global map to prevent save-regression
                    if (STATE.note_map && STATE.note_map[noteId]) {
                        STATE.note_map[noteId].is_options_expanded = newExpanded;
                    }
                    
                    // Interaction: Toggle UI classes
                    const actionsRail = noteEl.querySelector('.note-actions-rail');
                    const headerTab   = noteEl.querySelector('.note-header-tab');

                    if (actionsRail) actionsRail.classList.toggle('expanded', !!newExpanded);
                    if (headerTab)   headerTab.classList.toggle('active', !!newExpanded);

                    // Persist state to the database.
                    // syncNotePosition owns the addActiveSync/removeActiveSync lifecycle internally.
                    if (typeof syncNotePosition === 'function') {
                        syncNotePosition(noteId, 'silent');
                    }
                }
                return;
            }

            if (action === 'view-attachment') {
                e.stopPropagation();
                const blobId = actionTrigger.dataset.blobId;
                if (noteEl && noteEl.classList.contains('is-editing')) return; // Gating: No view in edit mode
                if (typeof viewNoteImage === 'function') viewNoteImage(noteId, blobId);
            }
            else if (action === 'view-note') {
                e.stopPropagation();
                if (typeof handleNoteLinkClick === 'function') handleNoteLinkClick(noteId);
            }
            else if (action === 'copy-attachment') {
                e.stopPropagation();
                const blobId = actionTrigger.dataset.blobId;
                if (typeof copyNoteToClipboard === 'function') copyNoteToClipboard(noteId, blobId);
            }
            else if (action === 'remove-attachment') {
                e.stopPropagation();
                const blobId = actionTrigger.dataset.blobId;
                if (typeof confirmAttachmentRemoval === 'function') confirmAttachmentRemoval(noteId, blobId);
            }
            else if (action === 'open-attachment') {
                if (noteEl && noteEl.classList.contains('is-editing')) return;
                e.stopPropagation();
                const blobId   = actionTrigger.dataset.blobId;
                const filename = actionTrigger.dataset.filename;
                const isPdf    = actionTrigger.dataset.isPdf === 'true';

                if (isPdf && typeof openPDFViewer === 'function') {
                    openPDFViewer(blobId, filename);
                } else {
                    const a = document.createElement('a');
                    a.href = `/notes/attachment/serve/${blobId}`;
                    a.download = filename;
                    a.click();
                }
            }
            else if (action === 'inline-upload') {
                 // Trigger the hidden file input
                 const fileInput = noteEl?.querySelector('input[type="file"]');
                 if (fileInput) fileInput.click();
            }
        });

        // 3. Centralized Mutation & Input Observers (Delegated)
        canvas.addEventListener('input', (e) => {
            const trigger = e.target.closest('[data-action]');
            if (!trigger) return;

            const noteId = e.target.closest('.sticky-note')?.dataset.id;
            if (!noteId) return;

            if (trigger.dataset.action === 'update-accent') {
                if (typeof updateNoteAccent === 'function') updateNoteAccent(e.target, noteId);
            }
        });

        canvas.addEventListener('change', (e) => {
            const trigger = e.target.closest('[data-action]');
            if (!trigger) return;

            const noteId = e.target.closest('.sticky-note')?.dataset.id;
            if (!noteId) return;

            if (trigger.dataset.action === 'inline-upload') {
                if (typeof handleInlineFileSelection === 'function') handleInlineFileSelection(e, noteId);
            }
        });

        canvas.addEventListener('keydown', (e) => {
            const trigger = e.target.closest('[data-action]');
            if (!trigger) return;

            const noteId = e.target.closest('.sticky-note')?.dataset.id;
            if (!noteId) return;

            if (trigger.dataset.action === 'note-keydown') {
                if (typeof handleNoteKeydown === 'function') handleNoteKeydown(e, noteId);
            }
        });

        // 4. System Integrity Observers: Capturing non-bubbling asset signals
        canvas.addEventListener('error', (e) => {
            if (e.target.dataset?.action === 'favicon-cascade') {
                if (typeof handleFaviconError === 'function') handleFaviconError(e.target);
            }
        }, true); // Capture phase required for non-bubbling 'error'

        canvas.addEventListener('load', (e) => {
            if (e.target.dataset?.action === 'favicon-cascade') {
                if (typeof handleFaviconLoad === 'function') handleFaviconLoad(e.target);
            }
        }, true); // Capture phase required for non-bubbling 'load'
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
        
        // Stop auto-pan immediately when cursor exits the canvas viewport
        wrapper.addEventListener('mouseleave', () => {
            if (typeof stopAutoScroll === 'function') stopAutoScroll();
        });
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
    window.editNote = typeof editNote !== 'undefined' ? editNote : null;
    window.saveNoteInline = typeof saveNoteInline !== 'undefined' ? saveNoteInline : null;

    // 5. Security Context: Attach privacy lock listeners
    if (typeof setupSecurityInteractions === 'function') setupSecurityInteractions();
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
    if (STATE.isSyncing) {
        // Anti-Dropout Protocol: Only queue IF this is a genuine context change (not a recurrent heartbeat)
        const isExplicitSwitch = initial 
            || (canvas_id && canvas_id != STATE.canvas_id) 
            || targetNoteId 
            || (layer_id && layer_id != STATE.activeLayerId);

        if (isExplicitSwitch) {
            STATE.pendingContext = { initial, canvas_id, targetNoteId, layer_id };
        }
        return false; 
    }
    // Resolve context: Prioritize URL param -> Current State -> Backend Default (null)
    const urlParams = new URLSearchParams(window.location.search);
    const tid = canvas_id || urlParams.get('canvas_id') || STATE.canvas_id;
    const nid = targetNoteId || urlParams.get('note_id'); // Deep-link or search-target detection
    // Context Transition Logic: Initial loads are intentionally treated as full switches 
    // to ensure downstream UI (viewports, centering) hydrates correctly on first load.
    const isContextChange = initial || (tid && tid != STATE.canvas_id) || (layer_id && layer_id != STATE.activeLayerId);

    // Atomic Context Switch: Only terminate signals if we are moving to a different board/session
    // This allows heartbeat-triggered refreshes to proceed without aborting their own orchestrator.
    if (isContextChange) {
        if (STATE.heartbeatController) STATE.heartbeatController.abort();
        if (STATE.heartbeatTimer) clearTimeout(STATE.heartbeatTimer);
    }

    STATE.isSyncing = true;
    if (initial) STATE.isInitializing = true; // Protect interface state during initial hydration

    // Reset rendering error baseline on every state hydration to allow re-reporting of persistent issues
    if (window._renderErrors) window._renderErrors.clear();

    let data = null;
    try {
        let query = tid ? `?canvas_id=${tid}` : '';
        if (nid) query += (query ? '&' : '?') + `note_id=${nid}`;
        if (layer_id) query += (query ? '&' : '?') + `layer_id=${layer_id}`;
        
        // 🚀 Protocol Enhancement: Delta-Sync Handshake
        // Supplying the local hash allows the server to skip the heavy metadata payload.
        if (STATE.note_map_hash) query += (query ? '&' : '?') + `note_map_hash=${encodeURIComponent(STATE.note_map_hash)}`;

        data = await NoteAPI.get(`/notes/api/state${query}`);
        if (!data) return; // Aborted or session expired
        
        // Logic Gate PRE-FLIGHT: Update UI only if not aborted (tid/layer already resolved above)

        if (data.success) {
            if (data.unlocked_canvases) {
                STATE.unlockedCanvases = new Set(data.unlocked_canvases.map(id => parseInt(id)));
            }

            if (data.is_locked) {
                STATE.notes = [];
                STATE.note_map = {};
                STATE.note_map_hash = null;
                if (typeof showLockedOverlay === 'function') showLockedOverlay(false);
            } else {
                if (typeof hideLockedOverlay === 'function') hideLockedOverlay();
                if (typeof mergeNoteState === 'function') {
                    mergeNoteState(data.notes || []);
                } else {
                    STATE.notes = data.notes || [];
                }
            }

            STATE.canvases = data.canvases || [];
            STATE.user_id  = data.user_id;
            STATE.canvas_id  = data.canvas_id; // Resolved active context
            
            // State Synchronization: Baseline alignment with backend truth
            STATE.last_mutation = data.last_mutation;
            
            // Delta Resolution: Only hydrate metadata if the server provided a fresh object AND the board is unlocked.
            // This prevents metadata leakage and delta-sync corruption (STATE.note_map_hash overwriting NULL).
            if (!data.is_locked) {
                if (data.note_map) STATE.note_map = data.note_map;
                STATE.note_map_hash = data.note_map_hash;
            }

            STATE.layer_map     = data.layer_map || {};
            STATE.share_list    = data.share_list || [];
            
            // Interaction Optimization: Calculate global Z-index baseline once per hydration
            STATE.maxZ = STATE.notes.reduce((max, n) => Math.max(max, n.z_index || 1), 1);
            
            // Sync Branding Pill
            const canvasObj = STATE.canvases.find(c => c.id == STATE.canvas_id);
            const pill      = document.getElementById('active-board-name-pill');
            if (canvasObj && pill) {
                pill.textContent = canvasObj.name;
            }

            // Standardize the URL to reflect current context. Defer navigation cleanup if nid is present.
            const url = new URL(window.location.href);
            // Defer cleanup if nid is present; handled after centering in completion block below.
            if (!nid && (url.searchParams.has('canvas_id') || url.searchParams.has('note_id') || url.searchParams.has('layer_id'))) {
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

            // Prevent heartbeats from jumping the viewport to stale coordinates while local mutations are pending.
            const shouldRestoreViewport = (initial || isContextChange) && !STATE.viewportDirty;

            if (shouldRestoreViewport && (useLocal || data.viewport)) {
                const vp = useLocal ? localVp : data.viewport;
                
                // 1. Perspective Sync: Always restore scale and layer identity
                STATE.scale = parseFloat(vp.scale) || 1.0;
                if (typeof applyScale === 'function') applyScale();

                if (vp.layer_id) {
                    STATE.activeLayerId = parseInt(vp.layer_id);
                }
                if (typeof updateLevelDisplay === 'function') updateLevelDisplay();

                // 2. Navigation Sync: Skip coordinate restoration if focusing a specific note_id.
                // Centering (triggered below) takes priority over the general session viewport.
                if (!nid) {
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

                    setTimeout(() => { STATE.isInitializing = false; }, 200);
                } else if (typeof centerOnNote !== 'function') {
                    setTimeout(() => { STATE.isInitializing = false; }, 200);
                }
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
                            Promise.resolve(centerOnNote(nid)).finally(() => {
                                STATE.isInitializing = false;
                                // Return to a clean, board-agnostic URL after centering navigation completes.
                                const url = new URL(window.location.href);
                                if (url.searchParams.has('canvas_id') || url.searchParams.has('note_id') || url.searchParams.has('layer_id')) {
                                    url.searchParams.delete('canvas_id');
                                    url.searchParams.delete('note_id');
                                    url.searchParams.delete('layer_id');
                                    window.history.replaceState({ canvas_id: STATE.canvas_id }, '', url);
                                }
                            });
                        } else {
                            STATE.isInitializing = false;
                            // Clean temporal intent from URL after completion or fallback.
                            const url = new URL(window.location.href);
                            if (url.searchParams.has('canvas_id') || url.searchParams.has('note_id') || url.searchParams.has('layer_id')) {
                                url.searchParams.delete('canvas_id');
                                url.searchParams.delete('note_id');
                                url.searchParams.delete('layer_id');
                                window.history.replaceState({ canvas_id: STATE.canvas_id }, '', url);
                            }
                        }
                    }, 300);
                });
            }
        } else {
            // Failure Path: Clear volatile state before any exit to prevent 
            // stale content rendering in the finally renderUI() call.
            STATE.notes = [];
            STATE.note_map = {};
            STATE.note_map_hash = null;

            if (initial) {
                showToast('Failed to load whiteboard state', 'error');
            } else {
                throw new Error('STATE_LOAD_FAILED');
            }
        }
    } catch (err) {
        // All failure paths now clear state before reaching catch.
        // Only non-STATE_LOAD_FAILED errors (network/parse failures) need logging.
        if (err.message !== 'STATE_LOAD_FAILED') {
            console.error('loadState Error:', err);
            STATE.notes = [];
            STATE.note_map = {};
            STATE.note_map_hash = null;
        }
        if (!initial) {
            // Authoritative Propagation: Normalise all non-initial failure classes to 
            // a single signal type. Preserves STATE_LOAD_FAILED identity; wraps all other 
            // classes so callers receive a consistent rejection regardless of origin.
            throw err.message === 'STATE_LOAD_FAILED' ? err : new Error('STATE_LOAD_FAILED');
        }
    } finally {
        STATE.isSyncing = false;
        
        // Context Dequeue: Trigger the most recent queued switch once the lock is released
        if (STATE.pendingContext) {
            const ctx = STATE.pendingContext;
            STATE.pendingContext = null; // Atomic clearance to prevent re-entrant loops
            
            // Execute the queued switch. Non-blocking call ensures current stack completes.
            loadState(ctx.initial, ctx.canvas_id, ctx.targetNoteId, ctx.layer_id);
        }

        // Global Safety Reset: Ensure interface is unlocked if not in a designated stabilization phase (centering callback owns it)
        // Only defer the isInitializing reset if the centering callback will own it.
        // On any failure path the centering callback never runs; reset unconditionally.
        const centeringWillRun = nid && data && data.success && typeof centerOnNote === 'function';
        if (!centeringWillRun) {
            STATE.isInitializing = false;
        }

        // Render UI after all state is consolidated
        if (typeof renderUI === 'function') renderUI();
    }
    // Non-throwing paths return true to preserve the established return contract.
    // Throwing paths (initial=false failures) propagate the throw before reaching this line.
    return true;
}

/**
 * Surgical State Hydration.
 * Merges incoming note data while preserving local state for notes currently being manipulated.
 * @param {Array} incomingNotes - Fresh note records from the backend.
 * @param {number|string|null} forceUpdateId - Force merge for this specific ID (bypasses edit-mode lockout).
 * @returns {void}
 */
function mergeNoteState(incomingNotes, forceUpdateId = null) {
    const activeIds = new Set();
    if (STATE.pickedNoteId !== null) activeIds.add(String(STATE.pickedNoteId));
    if (STATE.isResizing   !== null) activeIds.add(String(STATE.isResizing));
    if (STATE.isEditingNote !== null) activeIds.add(String(STATE.isEditingNote));
    
    // Anti-Regression Lockout: Preserve local state for notes in-flight to the API
    STATE.activeSyncs.forEach((count, id) => {
        if (count > 0) activeIds.add(String(id));
    });

    // 1. Integration: Update existing and inject new records
    incomingNotes.forEach(incoming => {
        const idStr = String(incoming.id);
        
        // Lockout Check: Skip merge if the note is active, UNLESS it is the forceUpdateId target
        if (activeIds.has(idStr) && idStr !== String(forceUpdateId)) return;

        // Data Normalization: Ensure boolean flags are treated as integers
        if (incoming.hasOwnProperty('is_collapsed')) incoming.is_collapsed = parseInt(incoming.is_collapsed ?? 0);
        if (incoming.hasOwnProperty('is_options_expanded')) incoming.is_options_expanded = parseInt(incoming.is_options_expanded ?? 0);

        const existing = STATE.notes.find(n => n.id == incoming.id);
        if (existing) {
            Object.assign(existing, incoming);
        } else {
            STATE.notes.push(incoming);
        }
    });

    // 2. Pruning: Remove notes that are missing from the server scope
    const incomingIds = new Set(incomingNotes.map(n => String(n.id)));
    STATE.notes = STATE.notes.filter(n => {
        const idStr = String(n.id);
        // Safety: Keep notes even if missing from server if they are active (prevents deletion mid-drag)
        return incomingIds.has(idStr) || activeIds.has(idStr);
    });

    // 3. Mapping Reliability: Rebuild the note_map from the provided server data.
    // We rebuild from 'incomingNotes' to ensure we only update entries that were 
    // actually provided, respecting the 'activeIds' locks inside the merge loop above.
    incomingNotes.forEach(n => {
        if (!activeIds.has(String(n.id))) STATE.note_map[n.id] = n;
    });
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

    // Synchronous Teardown: Ensure no duplicate intervals/controllers exist during context shifts
    if (STATE.heartbeatTimer) {
        clearTimeout(STATE.heartbeatTimer);
        STATE.heartbeatTimer = null;
    }
    
    // Abort in-flight requests from the previous context to prevent stale hydration
    if (STATE.heartbeatController) {
        STATE.heartbeatController.abort();
        STATE.heartbeatController = null;
    }

    // Lock the context immediately to prevent race conditions during async initialization
    STATE.lastPolledCanvasId = canvasId;
    
    // Lifecycle Management: Session-based signal for background polling
    STATE.heartbeatController = new AbortController();

    async function poll() {
        // Inner Guard: Protect against mid-teardown ticks or race conditions
        if (!STATE.canvas_id || STATE.isInitializing) {
            STATE.heartbeatTimer = setTimeout(poll, 2000);
            return;
        }

        const layerId = STATE.activeLayerId; // Capture current context baseline
        
        // Interaction Inhibition: Prevent state hydration during active gestures
        const isInteracting = STATE.isPanning      || 
                              STATE.isResizing     || 
                              STATE.isEditingNote  || 
                              STATE.pickedNoteId   || 
                              document.querySelector('.modal-overlay.show') || 
                              ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) ||
                              document.hidden;

        if (isInteracting || STATE.isSyncing) {
            STATE.heartbeatTimer = setTimeout(poll, 2000);
            return;
        }

        try {
            const res = await NoteAPI.get(`/notes/api/heartbeat/${STATE.canvas_id}?layer_id=${STATE.activeLayerId}`, { 
                signal: STATE.heartbeatController.signal 
            });
            
            if (res && res.success) {
                if (res.is_locked && !STATE.isLocked) {
                    // External Lock State: Canvas accessibility restricted following security baseline mutation.
                    if (STATE.canvas_id === canvasId && STATE.activeLayerId === layerId) {
                        STATE.notes = [];
                        STATE.note_map = {};
                        STATE.note_map_hash = null;
                        if (res.unlocked_canvases) {
                            STATE.unlockedCanvases = new Set(res.unlocked_canvases.map(id => parseInt(id)));
                        } else {
                            STATE.unlockedCanvases.delete(parseInt(canvasId));
                        }
                        if (typeof showLockedOverlay === 'function') showLockedOverlay(false);
                        if (typeof renderUI === 'function') renderUI();
                        // Refresh canvas list UIs to show updated lock icon state immediately.
                        if (typeof renderQuickSwitcher === 'function') renderQuickSwitcher();
                        if (typeof renderCanvasList === 'function') renderCanvasList();
                        // Advance the mutation baseline so the next heartbeat does not
                        // redundantly trigger a loadState on the already-handled lock transition.
                        STATE.last_mutation = res.last_mutation;
                    }
                } 
                else if (!res.is_locked && STATE.isLocked) {
                    // External Unlock Path: Content accessibility restoration after protection removal.
                    // Full loadState required to fetch content now that protection is lifted.
                    if (STATE.canvas_id === canvasId && STATE.activeLayerId === layerId) {
                        try {
                            await loadState(false, STATE.canvas_id, null, STATE.activeLayerId);
                        } catch (loadErr) {
                            // Resilience: Concurrent heartbeat will attempt authorization restoration.
                            console.warn('Heartbeat unlock hydration failed:', loadErr.message);
                        }
                    }
                }
                else if (res.last_mutation !== STATE.last_mutation) {
                    // Consistency: Execute hydration while ensuring canvas context remains stable.
                    if (STATE.canvas_id === canvasId && STATE.activeLayerId === layerId) {
                        try {
                            await loadState(false, STATE.canvas_id, null, STATE.activeLayerId);
                        } catch (loadErr) {
                            console.warn('Heartbeat mutation hydration failed:', loadErr.message);
                        }
                    }
                }
            }
        } catch (e) {
            // Error Handling: Standard network failures are handled by NoteAPI.
            // Local processing errors are logged here.
            if (e.name !== 'AbortError') {
                console.error('Heartbeat Processing Error:', e);
            }
        } finally {
            // Generation Check: Only reschedule if this loop is still the active context baseline.
            // This prevents a 'ghost loop' from resurrecting after an AbortError during context switch.
            if (STATE.lastPolledCanvasId === canvasId) {
                STATE.heartbeatTimer = setTimeout(poll, 2000);
            }
        }
    }

    // Initiate the recursive loop
    STATE.heartbeatTimer = setTimeout(poll, 2000);
}


/**
 * Favicon Cascade Intelligence: Manages icon fallbacks for dashboard notes.
 * Transitions from Custom Icon -> Origin favicon.ico -> Google Proxy -> Emoji.
 * @param {HTMLImageElement} img - The failing icon element.
 */
window.handleFaviconError = (img) => {
    if (img.dataset.customUrl && !img.dataset.triedFavicon) {
        img.dataset.customUrl = ''; // Mark custom attempt as exhausted
        img.dataset.triedFavicon = 'true';
        img.src = img.dataset.faviconUrl;
    } else if (!img.dataset.triedProxy) {
        img.dataset.triedProxy = 'true';
        img.src = img.dataset.proxyUrl;
    } else {
        img.style.display = 'none';
        if (img.nextElementSibling) img.nextElementSibling.style.display = 'flex';
    }
};

/**
 * Favicon Load Finalizer: Ensures fallback emoji is hidden when an icon resolves.
 */
window.handleFaviconLoad = (img) => {
    img.classList.add('loaded');
    if (img.nextElementSibling) img.nextElementSibling.style.display = 'none';
};

// Global Exposure Block
window.loadState = loadState;
window.initNotes = initNotes;
window.mergeNoteState = mergeNoteState;

window.STATE = STATE;
