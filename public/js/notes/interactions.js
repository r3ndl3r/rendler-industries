// /public/js/notes/interactions.js

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

    // 1. Logic Scoped Hoisting: Both handlers are declared at the initResizable scope
    // to ensure they are accessible to the event listeners below.
    const doResize = (e) => {
        if (!isResizing) return;
        
        let newWidth  = startWidth + (e.clientX - startX) / STATE.scale;
        let newHeight = startHeight + (e.clientY - startY) / STATE.scale;
        
        newWidth  = Math.round(newWidth / STATE.snapGrid) * STATE.snapGrid;
        newHeight = Math.round(newHeight / STATE.snapGrid) * STATE.snapGrid;
        
        const maxWidth  = STATE.canvasSize - note.x;
        const maxHeight = STATE.canvasSize - note.y;
        
        newWidth  = Math.max(240, Math.min(newWidth, maxWidth));
        newHeight = Math.max(54, Math.min(newHeight, maxHeight));
        
        el.style.width  = `${newWidth}px`;
        el.style.height = `${newHeight}px`;
    };

    const stopResize = () => {
        if (!isResizing) return;
        isResizing = false;
        STATE.isResizing = false;
        
        document.removeEventListener('mousemove', doResize);
        document.removeEventListener('mouseup', stopResize);
        el.classList.remove('resizing');
        
        const finalWidth  = parseInt(el.style.width, 10);
        const finalHeight = parseInt(el.style.height, 10);
        
        note.width  = finalWidth;
        note.height = finalHeight;
        
        if (typeof syncNotePosition === 'function') syncNotePosition(note.id);
    };

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
}

/**
 * Hardware-accelerated dragging engine with 10px grid snapping.
 * @param {HTMLElement} el - The note element.
 * @returns {void}
 */
/**
 * Pick & Place (Sticky Move) Orchestrator.
 * Transitions a note into 'flight mode' where it follows the cursor without a held click.
 * @param {MouseEvent} e - The click event.
 * @param {number|string} id - The note ID.
 * @returns {void}
 */
function toggleStickyMove(e, id) {
    const el = document.getElementById(`note-${id}`);
    const intId = parseInt(id);
    
    // Safety Guard: Disable Pick and Place if the note is in Active Edit Mode
    if (el && el.classList.contains('is-editing')) return;

    if (STATE.pickedNoteId) {
        dropStickyNote();
        return;
    }

    const note = STATE.notes.find(n => n.id == intId);
    if (!note || !el) return;

    // Capture the dynamic delta between the cursor and the note's origin
    const wrapper = STATE.wrapperEl;
    const rect    = wrapper?.getBoundingClientRect();
    
    // Logic: (Current Cursor Position on Canvas) - (Note Origin)
    const cursorX = (e.clientX - rect.left + wrapper.scrollLeft) / STATE.scale;
    const cursorY = (e.clientY - rect.top  + wrapper.scrollTop)  / STATE.scale;
    
    STATE.dragOffset = {
        x: cursorX - note.x,
        y: cursorY - note.y
    };

    // --- 1. Focus Management (Z-Index Promotion) ---
    // Optimization: Skip re-scanning all notes. Use cached STATE.maxZ.
    if (note.z_index < STATE.maxZ) {
        const newZ = ++STATE.maxZ;
        note.z_index = newZ;
        el.style.zIndex = newZ;
        if (typeof syncNotePosition === 'function') syncNotePosition(intId, 'silent');
    }

    // --- 2. Activation Logic (Flight Mode) ---
    STATE.pickedNoteId = intId;
    STATE.lastPickTime = Date.now(); // Interaction Guard: Prevents immediate drop re-triggering
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
    if (typeof checkAutoScrollProximity === 'function') checkAutoScrollProximity(e);

    const el = document.getElementById(`note-${STATE.pickedNoteId}`);
    if (!el) return;

    const wrapper = STATE.wrapperEl;
    const rect    = wrapper?.getBoundingClientRect();
    
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
    const wrapper = STATE.wrapperEl;
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

        const wrapper = STATE.wrapperEl;
        wrapper.scrollLeft += STATE.autoScroll.vx;
        wrapper.scrollTop  += STATE.autoScroll.vy;

        const lastE = STATE.autoScroll.lastEvent;
        if (lastE && STATE.pickedNoteId) {
            // Re-trigger the active move logic with the latest event
            updateStickyMove(lastE);
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
    if (typeof syncNotePosition === 'function') syncNotePosition(id);
    showToast('Note placed', 'success');
}

/**
 * Aborts the current 'Pick & Place' action, restoring the note to its original coordinates.
 * @returns {void}
 */
function cancelStickyMove() {
    if (!STATE.pickedNoteId || !STATE.originalPos) return;
    
    stopAutoScroll(); // Atomic termination of physics/auto-scroll engine
    
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
        // Isolation Guard: If we just picked this up (<300ms ago), prevent the current click 
        // bubble from triggering an immediate drop.
        if (STATE.lastPickTime && (Date.now() - STATE.lastPickTime < 300)) return;

        // Targeted Guard: Only absorb the click if it's on the drag handle of the CURRENTLY picked note.
        // This allows clicking on OTHER notes' handles to proceed to a drop-and-pick sequence.
        const clickedNote = e.target.closest('.sticky-note');
        if (clickedNote && String(clickedNote.dataset.id) === String(STATE.pickedNoteId)) {
            if (e.target.closest('.note-drag-handle-container')) return;
        }
        
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
            e.preventDefault();
            e.stopPropagation();
            cancelStickyMove();
            return; // Terminate signal to prevent modal closing if picking was active
        }
        
        // Also close any active modals
        if (typeof closeViewModal === 'function') closeViewModal();
        if (typeof closeCreateModal === 'function') closeCreateModal();
        if (typeof closeSearchModal === 'function') closeSearchModal();
    }
}


/**
 * Centers the oversized canvas viewport on absolute coordinates.
 * @returns {void}
 */
function centerView() {
    const wrapper = STATE.wrapperEl;
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
    // 1. Resolve State: Prioritize the layer-filtered current view, fallback to global map
    const note = STATE.notes.find(n => n.id == id) || STATE.note_map[id];
    if (!note) return;

    // 2. Perspective Restoration: Switch level if the target note is not in the active viewport
    let switched = false;
    if (note.layer_id && note.layer_id != STATE.activeLayerId) {
        if (typeof switchLevel === 'function') {
            await switchLevel(note.layer_id);
            switched = true;
        }
    }

    const wrapper = STATE.wrapperEl;
    if (!wrapper) return;

    // Helper: Execute the actual scroll and highlight
    const doCenter = () => {
        const noteEl  = document.querySelector(`.sticky-note[data-id="${id}"]`);
        
        // 3. Coordinate Resolution: Force casting to Number to prevent NaN propagation
        const nx = Number(note.x || 2500);
        const ny = Number(note.y || 2500);
        const nw = Number(note.width  || (noteEl ? noteEl.offsetWidth  : 280));
        const nh = Number(note.height || (noteEl ? noteEl.offsetHeight : 200));

        const centerX = nx + (nw / 2);
        
        // Smart Vertical Anchor: For long notes, prioritize showing the header.
        // We anchor to 25% of the viewport height if the note is tall, keeping the title bar visible.
        const viewportHeight = wrapper.clientHeight / STATE.scale;
        const centerY        = ny + Math.min(nh / 2, viewportHeight / 4);

        const scrollX = (centerX * STATE.scale) - (wrapper.clientWidth  / 2);
        const scrollY = (centerY * STATE.scale) - (wrapper.clientHeight / 2);

        wrapper.scrollTo({ left: scrollX, top: scrollY, behavior: 'smooth' });
        
        // 4. Visual Feedback: Highlight the target note
        if (noteEl) {
            noteEl.classList.add('highlight-pulse');
            setTimeout(() => noteEl.classList.remove('highlight-pulse'), 2000);
        }
    };

    // Initial pass
    doCenter();

    // Secondary sync pass if we switched layers (give DOM 100ms to settle)
    if (switched) {
        setTimeout(doCenter, 150);
    }
}

/**
 * Applies STATE.scale to the canvas element via CSS transform.
 * Uses transform-origin: 0 0 so coords stay relative to the top-left.
 * Synchronizes the visual CSS scale with the scrollable layout area.
 * @returns {void}
 */
function applyScale() {
    const canvas = STATE.canvasEl;
    const wrapper = STATE.wrapperEl;
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
    const wrapper  = STATE.wrapperEl;
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

    if (typeof updateRadar === 'function') updateRadar();
    scheduleViewportSave();
}

/**
 * Zooms the canvas out by one step (10%), snapping to the nearest decile.
 * @returns {void}
 */
function zoomOut() {
    const wrapper  = STATE.wrapperEl;
    if (!wrapper) return;
    const oldScale = STATE.scale;

    // Removes any incremental scale drift during decile snapping
    STATE.scale = Math.max(SCALE_MIN, Math.round((STATE.scale - SCALE_STEP) * 10) / 10);

    const canvasCX = (wrapper.scrollLeft + wrapper.clientWidth  / 2) / oldScale;
    const canvasCY = (wrapper.scrollTop  + wrapper.clientHeight / 2) / oldScale;

    applyScale();

    wrapper.scrollLeft = canvasCX * STATE.scale - wrapper.clientWidth  / 2;
    wrapper.scrollTop  = canvasCY * STATE.scale - wrapper.clientHeight / 2;

    if (typeof updateRadar === 'function') updateRadar();
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
    if (typeof updateRadar === 'function') {
        requestAnimationFrame(updateRadar);
    }
    
    // CRITICAL: Scroll events MUST trigger the debounced save to capture panning
    STATE.viewportDirty = true; // Shield: Protect this local scroll from heartbeat overrides
    scheduleViewportSave();
}

/**
 * Persistence Tier: Mirrors the current perspective to the browser's persistent storage.
 * This provides zero-latency restoration and protects against session-destroying crashes.
 */
function updateLocalViewportCache() {
    if (!STATE.canvas_id || !STATE.activeLayerId || !STATE.user_id) return;
    
    const wrapper = STATE.wrapperEl;
    if (!wrapper) return;

    const cacheKey = `whiteboard_vp_u${STATE.user_id}_c${STATE.canvas_id}_l${STATE.activeLayerId}`;
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
    if (!STATE.user_id) return null;
    const cacheKey = `whiteboard_vp_u${STATE.user_id}_c${canvasId}_l${layerId}`;
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
        if (key && key.startsWith('whiteboard_vp_')) {
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
    STATE.vpSaveTimer = setTimeout(persistViewport, 800); // Tightened window (1.5s -> 0.8s) for better responsiveness
}

/**
 * Perspective Persistence: Synchronizes the current camera state with the backend.
 * Integrates with the Retry Queue to handle network instability.
 */
async function persistViewport() {
    const wrapper = STATE.wrapperEl;
    if (!wrapper || STATE.isInitializing) return;

    // Logic: Once the debounce timer triggers, we treat the local mutation as 'committing'.
    // This allows heartbeats to resume synchronization while the async save is in flight.
    STATE.viewportDirty = false; 
    await saveViewportImmediate();
}

/**
 * Persistent Viewport Handshake: Captures and commits the current perspective.
 * Used during lifecycle transitions (layer/canvas switches) to prevent state loss.
 */
async function saveViewportImmediate() {
    const wrapper = STATE.wrapperEl;
    if (!wrapper) return;

    // Clear flags: Local state is now safe to be overwritten by server truth
    STATE.viewportDirty = false;
    clearTimeout(STATE.vpSaveTimer);

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
            method:  'POST',
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-CSRF-Token': csrfToken 
            },
            // keepalive: true ensures the request survives a page teardown (beforeunload)
            keepalive: true,
            body: params.toString()
        });
        
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
        // Fallback: If immediate save fails, queue it for the Reliability Guardian
        STATE.syncQueue.push({ params: params.toString(), token: csrfToken, ts: Date.now() });
    }
}

/**
 * Canvas Mouse Down: Initiates panning orchestration.
 * @param {MouseEvent} e - The mouse event.
 */
function handleCanvasMouseDown(e) {
    // 1. Note Header Actions: Centralized delegation for all note-level buttons
    const hashBtn    = e.target.closest('.note-id-hash');
    const collapseBtn = e.target.closest('.btn-icon-collapse');
    const editBtn     = e.target.closest('.btn-icon-edit');
    const linkBtn     = e.target.closest('.btn-icon-link');
    const uploadBtn   = e.target.closest('.btn-icon-upload');
    const moveBtn     = e.target.closest('.btn-icon-move');
    const levelBtn    = e.target.closest('.btn-icon-level-copy');
    const viewBtn     = e.target.closest('.btn-icon-view');
    const deleteBtn   = e.target.closest('.btn-icon-delete:not(.reel-action-btn):not(.hero-action-btn)');

    if (e.button === 0) {
        const noteEl = e.target.closest('.sticky-note');
        if (noteEl) {
            const id = noteEl.dataset.id;
            if (id) {
                if (hashBtn && typeof copyNoteToClipboard === 'function') {
                    copyNoteToClipboard(id);
                    return;
                }
                if (collapseBtn && typeof toggleCollapse === 'function') {
                    toggleCollapse(id);
                    return;
                }
                if (editBtn && typeof toggleInlineEdit === 'function') {
                    toggleInlineEdit(editBtn, id);
                    return;
                }
                if (linkBtn && typeof copyNoteLink === 'function') {
                    copyNoteLink(id);
                    return;
                }
                if (uploadBtn && typeof triggerInlineUpload === 'function') {
                    triggerInlineUpload(id);
                    return;
                }
                if (moveBtn && typeof openMoveModal === 'function') {
                    openMoveModal(e, id);
                    return;
                }
                if (levelBtn && typeof openLayerActionModal === 'function') {
                    openLayerActionModal(id);
                    return;
                }
                if (viewBtn && typeof viewNote === 'function') {
                    viewNote(id);
                    return;
                }
                if (deleteBtn && typeof deleteNote === 'function') {
                    deleteNote(id);
                    return;
                }
            }
        }
    }

    // 2. Pick & Place Detection: If the user clicks a note's title bar/drag handle
    const handle = e.target.closest('.note-drag-handle-container');
    if (handle && e.button === 0) {
        const noteId = handle.closest('.sticky-note')?.dataset.id;
        if (noteId) {
            toggleStickyMove(e, noteId);
            return; // Exit: Do not initiate panning if picking a note
        }
    }

    // 2. Standard Panning: Initiated by Left-Click on the workspace background or container wrapper.
    if (e.target.id !== 'notes-canvas' && e.target.id !== 'canvas-wrapper') return;
    if (e.button !== 0) return; // Parity: Left-click only for focal background panning

    const wrapper = STATE.wrapperEl;
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
 * Canvas Mouse Move: Updates the perspective coordinates during panning.
 * @param {MouseEvent} e - The mouse event.
 */
function handleCanvasMouseMove(e) {
    if (!STATE.isPanning) return;

    const wrapper = STATE.wrapperEl;
    if (!wrapper) return;

    const dx = e.clientX - STATE.panStart.x;
    const dy = e.clientY - STATE.panStart.y;

    // Direct Sync: Scroll opposite to drag direction to simulate 'moving the paper'
    wrapper.scrollLeft = STATE.panStart.scrollX - dx;
    wrapper.scrollTop  = STATE.panStart.scrollY - dy;
}

/**
 * Canvas Mouse Up: Terminates active panning operations.
 * @returns {void}
 */
function handleCanvasMouseUp() {
    if (!STATE.isPanning) return;
    
    STATE.isPanning = false;
    document.body.style.cursor = '';
    
    // Viewport persistence is automatically handled by the wrapper's scroll listener
}

/**
 * Canvas Wheel Interface: Handles zooming and high-speed directional panning.
 * @param {WheelEvent} e - The wheel event.
 */
function handleCanvasWheel(e) {
    const wrapper = STATE.wrapperEl;
    if (!wrapper) return;

    // CTRL + Wheel: Anchored Zooming
    if (e.ctrlKey) {
        e.preventDefault();

        const oldScale = STATE.scale;
        const step     = 0.1;
        
        // Scale Clamps: 0.1 (Radar only) to 2.0 (High Precision)
        if (e.deltaY < 0) {
            STATE.scale = Math.min(2.0, Math.round((STATE.scale + step) * 10) / 10);
        } else {
            STATE.scale = Math.max(0.1, Math.round((STATE.scale - step) * 10) / 10);
        }

        if (STATE.scale === oldScale) return;

        // Viewport-relative mouse positions for anchor calculation
        const rect = wrapper.getBoundingClientRect();
        const mouseVX = e.clientX - rect.left;
        const mouseVY = e.clientY - rect.top;

        // Canvas-space coordinates under the cursor for focal consistency
        const canvasMX = (wrapper.scrollLeft + mouseVX) / oldScale;
        const canvasMY = (wrapper.scrollTop  + mouseVY) / oldScale;

        if (typeof applyScale === 'function') {
            applyScale();
        }

        // Adjust scroll to keep the cursor fixed on the canvas coordinate (Anchor effect)
        wrapper.scrollLeft = canvasMX * STATE.scale - mouseVX;
        wrapper.scrollTop  = canvasMY * STATE.scale - mouseVY;

        if (typeof updateRadar === 'function') updateRadar();
        if (typeof scheduleViewportSave === 'function') scheduleViewportSave();
    } else {
        // Plane Panning: Scrolling with no keys pressed
        // ONLY hijack scroll if we are not hovering over a sticky note's scrollable content
        if (!e.target.closest('.sticky-note')) {
            e.preventDefault();
            
            // Shift + Vertical Wheel = Horizontal Scroll (Browser Parity)
            if (e.shiftKey && !e.deltaX) {
                wrapper.scrollLeft += e.deltaY;
            } else {
                wrapper.scrollLeft += e.deltaX;
                wrapper.scrollTop  += e.deltaY;
            }
            
            if (typeof updateRadar === 'function') updateRadar();
        }
    }
}

/**
 * Handle Canvas Double Click.
 * Triggers the creation modal for a new text note at the current cursor coordinates.
 * @param {MouseEvent} e - The double-click event.
 * @returns {void}
 */
function handleCanvasDoubleClick(e) {
    if (!STATE.editMode || STATE.pickedNoteId) return;

    // Creation Logic: Only allow new note creation on the actual background layers.
    if (e.target.id !== 'notes-canvas' && e.target.id !== 'canvas-wrapper') return;

    const wrapper = STATE.wrapperEl;
    if (!wrapper) return;
    
    const rect = wrapper.getBoundingClientRect();
    
    // Geometry Calculation: Offset cursor by scroll/scale to find absolute whiteboard space
    const x = (e.clientX - rect.left + wrapper.scrollLeft) / STATE.scale;
    const y = (e.clientY - rect.top  + wrapper.scrollTop)  / STATE.scale;

    if (typeof showCreateNoteModal === 'function') {
        showCreateNoteModal('text', { x, y });
    }
}

/**
 * Persists inline edits (title, content, color, filename) to the backend.
 * This function handles targeted DOM updates to prevent full board re-renders.
 * @param {number|string} id - The note ID.
 * @returns {Promise<void>}
 */
async function saveNoteInline(id) {
    const el   = document.getElementById(`note-${id}`);
    const note = STATE.note_map[id]; // Use global map for SSO truth
    if (!el || !note) return;

    const titleInput = el.querySelector('.inline-title-input');
    const title      = titleInput ? titleInput.value : (note.title || 'Untitled Note');
    
    const textarea = el.querySelector('textarea');
    // Logic: If the editor is active (not readonly), prioritize the DOM. 
    // Otherwise (e.g. for checkbox toggles), use the RAM state (SSO).
    const isLiveEditor = textarea && !textarea.readOnly;
    const content      = isLiveEditor ? textarea.value : note.content;
    
    const colorInput = el.querySelector('.inline-color-input');
    const color      = colorInput ? colorInput.value : (note.color || '#fef3c7');

    // Filename Sync: Collect per-blob renames from the DOM.
    // Each .file-name-display[data-blob-id] maps a blob to its updated name.
    // For hero image notes the hidden display holds the note-level filename.
    const filenameDisplays = el.querySelectorAll('.file-name-display[data-blob-id]');
    const noteFilenameEl   = el.querySelector('.file-name-display:not([data-blob-id])');
    const noteLevelFilename = noteFilenameEl ? noteFilenameEl.textContent.trim() : (note.filename || '');

    el.classList.add('pending');
    
    // Interaction Locking: Maintain state integrity during flight
    const params = {
        id: id,
        canvas_id: STATE.canvas_id,
        title: title,
        content: content,
        filename: noteLevelFilename,
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
            STATE.notes         = res.notes;
            STATE.last_mutation = res.last_mutation;
            STATE.note_map      = res.note_map || STATE.note_map;
            
            // Targeted DOM Update: Refresh viewer and title without board re-render
            const viewer = el.querySelector('.note-text-viewer');
            const slot   = el.querySelector('.note-title-slot');
            if (viewer) viewer.innerHTML = formatNoteContent(content, id);
            if (slot)   slot.textContent = title || 'Untitled Note';

            // Per-Blob Rename: Fire individual rename calls for any changed attachment names
            const updatedNote = STATE.notes.find(n => n.id == id);
            const blobMap     = {};
            if (updatedNote && updatedNote.attachments) {
                updatedNote.attachments.forEach(a => { blobMap[a.blob_id] = a.filename; });
            }

            for (const display of filenameDisplays) {
                const blobId   = display.dataset.blobId;
                const newName  = display.textContent.trim();
                const origName = blobMap[blobId];
                if (blobId && newName && newName !== origName) {
                    const renameRes = await apiPost('/notes/api/attachment/rename', {
                        note_id:   id,
                        blob_id:   blobId,
                        canvas_id: STATE.canvas_id,
                        filename:  newName
                    });
                    if (renameRes && renameRes.success) {
                        STATE.notes         = renameRes.notes;
                        STATE.last_mutation = renameRes.last_mutation;
                    }
                }
            }

            // Sync Accent Color
            const accentColor = typeof normalizeColorHex === 'function' ? normalizeColorHex(color) : color;
            el.style.setProperty('--note-accent', accentColor);
            
            STATE.isEditingNote = false;
            
            // UI Cleanup: Exit edit mode visually and restore button state
            el.classList.remove('is-editing');
            if (textarea) textarea.readOnly = true;

            const btnIcon = el.querySelector('.btn-icon-edit');
            if (btnIcon) {
                btnIcon.innerHTML = '✏️';
                btnIcon.title     = 'Edit Content';
                btnIcon.classList.remove('pulse-glow');
            }

            showToast('Note Saved', 'success');
        }
    } finally {
        el.classList.remove('pending');
        // Always release the edit guard so the heartbeat is not permanently inhibited after a failed save
        STATE.isEditingNote = false;
    }
}

/**
 * Toggles the collapsed state of a note.
 * Optimistically updates the UI before syncing state to the backend.
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
        }
    } finally {
        el.classList.remove('pending');
    }
}

/**
 * Legacy compatibility alias for starting inline editing.
 * Useful for keyboard shortcuts or direct programmatic triggers.
 * @param {number|string} id - The note ID.
 */
function editNote(id) {
    const note = STATE.notes.find(n => n.id == id);
    if (!note) return;

    const btn = document.querySelector(`#note-${id} .btn-icon-edit`);
    if (btn && typeof toggleInlineEdit === 'function') {
        toggleInlineEdit(btn, id);
    }
}

/**
 * Transitions a note between 'display' and 'edit' modes.
 * Full Parity Implementation: Handles collation expansion, title/filename editing, 
 * and dynamic resizing.
 * @param {HTMLElement} btn - The trigger button.
 * @param {number|string} id - The note ID.
 */
async function toggleInlineEdit(btn, id) {
    const el   = document.getElementById(`note-${id}`);
    const note = STATE.notes.find(n => n.id == id);
    if (!el || !note) return;

    const textarea  = el.querySelector('textarea');
    
    // Expand collapsed notes before editing to prevent dimension corruption
    if (!el.classList.contains('is-editing') && note.is_collapsed) {
        await toggleCollapse(id);
    }

    const isEditing = el.classList.toggle('is-editing');

    if (isEditing) {
        // Mode Transition: Enable Interaction & Focus
        STATE.isEditingNote  = true;
        
        btn.innerHTML = '💾';
        btn.title     = 'Save Changes';
        btn.classList.add('pulse-glow');

        // CSS drives upload button visibility via .is-editing on the parent note.
        // No inline style override needed here.

        const textSect = el.querySelector('.note-text-section');
        if (textSect) textSect.classList.remove('hidden'); // force show empty editor

        // Enable inline rename on hero image filename display
        const filenameDisplay = el.querySelector('.note-hero-container .file-name-display');
        if (filenameDisplay) {
            filenameDisplay.contentEditable = 'true';
            filenameDisplay.classList.add('is-editing-text');
        }
        // Multi-attachment stacks: enable rename on each individual item filename
        el.querySelectorAll('.attachment-item-stack .file-name-display').forEach(fd => {
            fd.contentEditable = 'true';
            fd.classList.add('is-editing-text');
        });

        if (textarea) {
            textarea.readOnly = false;
            textarea.focus();

            // Dynamic height adaptation for seamless text entry
            const adaptNoteHeight = () => {
                if (textarea.scrollHeight > textarea.clientHeight) {
                    const diff = textarea.scrollHeight - textarea.clientHeight;
                    el.style.height = `${el.offsetHeight + diff}px`;
                }
            };
            
            textarea.removeEventListener('input', textarea._adaptNoteHeight);
            textarea._adaptNoteHeight = adaptNoteHeight;
            textarea.addEventListener('input', textarea._adaptNoteHeight);
            
            // Trigger initially to expand immediately if overflowing
            setTimeout(adaptNoteHeight, 10);
        }
    } else {
        // Mode Termination: Atomic Persistence
        if (typeof saveNoteInline === 'function') {
            saveNoteInline(id);
        }

        // CSS hides the upload button and filename displays when .is-editing is removed.
        // No inline style override needed.
        
        const txt = textarea ? textarea.value : '';
        const textSect = el.querySelector('.note-text-section');
        if (textSect && (!txt || txt.trim() === '')) {
            textSect.classList.add('hidden'); // hide if empty after save
        }

        const filenameDisplay = el.querySelector('.note-hero-container .file-name-display');
        if (filenameDisplay) {
            filenameDisplay.contentEditable = 'false';
            filenameDisplay.classList.remove('is-editing-text');
            // CSS (.sticky-note.is-editing .note-hero-container .file-name-display) handles visibility.
        }
        // Reset contentEditable on all stack item filenames
        el.querySelectorAll('.attachment-item-stack .file-name-display').forEach(fd => {
            fd.contentEditable = 'false';
            fd.classList.remove('is-editing-text');
        });
    }
}

/**
 * Keyboard Interface for Inline Editor.
 * Facilitates rapid 'Ctrl+Enter' commits and 'Esc' aborts.
 * @param {KeyboardEvent} e - The keydown event.
 * @param {number|string} id - The note ID.
 */
function handleNoteKeydown(e, id) {
    // Ctrl + Enter: Instant Save
    if (e.ctrlKey && e.key === 'Enter') {
        const btn = document.querySelector(`#note-${id} .btn-icon-edit`);
        if (btn && document.getElementById(`note-${id}`).classList.contains('is-editing')) {
            e.preventDefault();
            toggleInlineEdit(btn, id);
        }
    } else if (e.key === 'Escape') {
        const el = document.getElementById(`note-${id}`);
        if (el && el.classList.contains('is-editing')) {
            const btn = el.querySelector('.btn-icon-edit');
            const textarea = el.querySelector('textarea');
            const note = STATE.notes.find(n => n.id == id);
            
            // Abort: Revert textarea to state
            if (note) textarea.value = note.content || '';
            
            el.classList.remove('is-editing');
            if (textarea) textarea.readOnly = true;
            if (btn) {
                btn.innerHTML = '✏️';
                btn.classList.remove('pulse-glow');
            }
            STATE.isEditingNote = false;
        }
    }
}

/**
 * Interactive Navigation: Focuses and centers the workspace on a target note.
 * Handles cross-layer transitions automatically.
 * @param {number|string} id - The target note ID.
 */
async function handleNoteLinkClick(id) {
    const note = STATE.note_map[id];
    if (!note) {
        showToast('Note not found', 'error');
        return;
    }

    // A. Board Context: If the note lives on a different canvas, trigger an atomic context switch.
    if (note.canvas_id != STATE.canvas_id) {
        if (typeof switchCanvas === 'function') {
            // switchCanvas will call loadState internally with the targetNoteId
            await switchCanvas(note.canvas_id, id);
            return; // Handed off to switchCanvas -> loadState -> centerOnNote lifecycle
        }
    }

    // B. Perspective Transition: Switch layers if note is in isolation on the CURRENT board
    if (note.layer_id != STATE.activeLayerId) {
        if (typeof switchLevel === 'function') {
            await switchLevel(note.layer_id);
        }
    }

    // C. Precise Centering: Smooth scroll to align the note in the viewport center
    const wrapper = STATE.wrapperEl;
    if (wrapper) {
        const rect   = wrapper.getBoundingClientRect();
        const center = { 
            x: rect.width  / 2, 
            y: rect.height / 2 
        };

        // D. Coordinate Resolution: Force casting to Number (Coordinates are resolved from note_map)
        const nx = Number(note.x || 2500);
        const ny = Number(note.y || 2500);
        const nw = Number(note.width  || 300);
        const nh = Number(note.height || 200);

        const targetX = (nx * STATE.scale) - center.x + (nw * STATE.scale / 2);
        const targetY = (ny * STATE.scale) - center.y + (nh * STATE.scale / 2);
        
        wrapper.scrollTo({
            left: Math.max(0, targetX),
            top:  Math.max(0, targetY),
            behavior: 'smooth'
        });
    }

    // D. Temporary Peak & Highlight: Signal the user that the note has been located
    const el = document.getElementById(`note-${id}`);
    if (el) {
        el.classList.add('pulse-glow');
        const oldZ = el.style.zIndex;
        
        // Promotion: Temporary foreground priority during highlighting.
        // We use maxZ + 1 but don't persist it globally since it's transient.
        el.style.zIndex = STATE.maxZ + 1;
        
        setTimeout(() => {
            if (el) {
                el.classList.remove('pulse-glow');
                el.style.zIndex = oldZ;
            }
        }, 3000);
    }
}

/**
 * Interactive Todo-List Interface: Toggles checkbox state in-place.
 * @param {Event} event - The triggering click event.
 * @param {number|string} id - The parent note ID.
 * @param {number} lineIndex - Line number within the content.
 */
async function toggleNoteCheckbox(event, id, lineIndex) {
    if (event) event.stopPropagation(); // Shield from background canvas triggers

    const note = STATE.note_map[id];
    if (!note) return;

    const lines = (note.content || '').split('\n');
    if (lineIndex < 0 || lineIndex >= lines.length) return;

    let line = lines[lineIndex];
    const match = line.match(/^(\s*)\[( |x|)\](.*)$/);
    if (!match) return; // Safety: Line has changed since render

    const prefix = match[1];
    const state  = match[2];
    const text   = match[3];

    // Simple Toggle: x -> [ ] | anything else -> [x]
    const newState = (state === 'x') ? ' ' : 'x';
    
    // Update local content state
    const newContent = lines.map((l, i) => i === lineIndex ? `${prefix}[${newState}]${text}` : l).join('\n');
    note.content = newContent;
    if (STATE.note_map[id]) STATE.note_map[id].content = newContent;

    
    // UI Synchronization: Update the visual viewer and the hidden textarea
    const el = document.getElementById(`note-${id}`);
    if (el) {
        const viewer   = el.querySelector('.note-text-viewer');
        const textarea = el.querySelector('textarea');
        if (viewer)   viewer.innerHTML = formatNoteContent(note.content, id);
        if (textarea) textarea.value   = note.content;
    }

    // Persistent Sync: Avoid disrupting user perspective with full re-renders
    if (typeof saveNoteInline === 'function') {
        await saveNoteInline(id);
    }
}
/**
 * Universal Clipboard Driver: Synchronizes text to the OS clipboard.
 * Gracefully handles unsecured contexts (non-HTTPS) via legacy fallback.
 * @param {string} text - The payload to copy.
 * @returns {Promise<boolean>} - Success state.
 */
async function copyToClipboard(text) {
    if (!text) return false;

    // 1. Primary Strategy: Modern Clipboard API (Secure Context Required)
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (err) {
            console.warn('Modern Clipboard API failed, attempting fallback:', err);
        }
    }

    // 2. Secondary Strategy: Dynamic Textarea Elevation (Unsecured Context Fallback)
    try {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        
        // Hide from layout and perspective
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "0";
        document.body.appendChild(textArea);
        
        textArea.focus();
        textArea.select();
        
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        return successful;
    } catch (err) {
        console.error('Unified Clipboard Failure:', err);
        return false;
    }
}

/**
 * System Clipboard Interface: Synchronizes note content to the local OS clipboard.
 * Formats the payload as a structured text block (Title + Content).
 * @param {number|string} id - The note ID.
 * @returns {Promise<void>}
 */
async function copyNoteToClipboard(id) {
    const note = STATE.note_map[id];
    if (!note) {
        showToast('Note data not found', 'error');
        return;
    }

    const text = `${note.title || 'Untitled Note'}\n${'='.repeat(note.title ? note.title.length : 13)}\n\n${note.content || ''}`;

    if (await copyToClipboard(text)) {
        showToast('Note Copied', 'success');
    } else {
        showToast('Copy failed: Unsecured context?', 'error');
    }
}

/**
 * Copies the raw Note ID to the clipboard.
 * @param {number|string} id - The note ID.
 * @returns {Promise<void>}
 */
async function copyNoteId(id) {
    if (!id) return;
    if (await copyToClipboard(`${id}`)) {
        showToast('ID Copied', 'success');
    } else {
        showToast('Copy failed', 'error');
    }
}

/**
 * Copies the internal note reference tag to the clipboard.
 * @param {number|string} id - The note ID.
 */
async function copyNoteLink(id) {
    if (await copyToClipboard(`[note:${id}]`)) {
        showToast('Link Tag Copied', 'success');
    } else {
        showToast('Copy failed', 'error');
    }
}

/**
 * Mobile Touch Start: Initiates panning or pinch-zooming.
 * @param {TouchEvent} e - The touch event.
 */
function handleCanvasTouchStart(e) {
    const wrapper = STATE.wrapperEl;
    if (!wrapper) return;

    if (e.touches.length === 1) {
        // Single Finger: Panning (Matches handleCanvasMouseDown)
        const touch = e.touches[0];
        
        // Audit: Ensure we aren't touching a note's interactive content
        if (e.target.closest('.sticky-note')) return;

        STATE.isPanning = true;
        STATE.panStart = {
            x: touch.clientX,
            y: touch.clientY,
            scrollX: wrapper.scrollLeft,
            scrollY: wrapper.scrollTop
        };
        e.preventDefault();
    } else if (e.touches.length === 2) {
        // Dual Finger: Pinch-to-Zoom Baseline
        STATE.isPanning = false; // Disable panning during zoom
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        
        STATE.pinchStartDist = Math.hypot(
            touch2.clientX - touch1.clientX,
            touch2.clientY - touch1.clientY
        );
        STATE.pinchStartScale = STATE.scale;
        e.preventDefault();
    }
}

/**
 * Mobile Touch Move: Updates coordinates for panning or scaling.
 * @param {TouchEvent} e - The touch event.
 */
function handleCanvasTouchMove(e) {
    const wrapper = STATE.wrapperEl;
    if (!wrapper) return;

    if (e.touches.length === 1 && STATE.isPanning) {
        // Panning: Update scroll offsets
        const touch = e.touches[0];
        const dx = touch.clientX - STATE.panStart.x;
        const dy = touch.clientY - STATE.panStart.y;
        
        wrapper.scrollLeft = STATE.panStart.scrollX - dx;
        wrapper.scrollTop  = STATE.panStart.scrollY - dy;
        
        if (typeof updateRadar === 'function') updateRadar();
        e.preventDefault();
    } else if (e.touches.length === 2 && STATE.pinchStartDist) {
        // Pinch-to-Zoom: Calculating scale delta
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        
        const currentDist = Math.hypot(
            touch2.clientX - touch1.clientX,
            touch2.clientY - touch1.clientY
        );
        
        const zoomRatio = currentDist / STATE.pinchStartDist;
        const newScale = Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, STATE.pinchStartScale * zoomRatio)) * 10) / 10;
        
        if (newScale !== STATE.scale) {
            const oldScale = STATE.scale;
            STATE.scale = newScale;
            
            // Focal Point: Calculate the center between the two fingers
            const rect = wrapper.getBoundingClientRect();
            const centerX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
            const centerY = (touch1.clientY + touch2.clientY) / 2 - rect.top;
            
            // Canvas-space anchoring
            const canvasX = (wrapper.scrollLeft + centerX) / oldScale;
            const canvasY = (wrapper.scrollTop  + centerY) / oldScale;
            
            if (typeof applyScale === 'function') applyScale();
            
            // Adjust scroll to keep pinch-center fixed
            wrapper.scrollLeft = canvasX * STATE.scale - centerX;
            wrapper.scrollTop  = canvasY * STATE.scale - centerY;
            
            if (typeof updateRadar === 'function') updateRadar();
            if (typeof scheduleViewportSave === 'function') scheduleViewportSave();
        }
        e.preventDefault();
    }
}

/**
 * Mobile Touch End: Lifecycle cleanup.
 * @param {TouchEvent} e - The touch event.
 */
function handleCanvasTouchEnd(e) {
    STATE.isPanning = false;
    STATE.pinchStartDist = null;
    STATE.pinchStartScale = null;
}
