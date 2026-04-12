// /public/js/notes/interactions.js

/**
 * Resize engine initialization
 * @param {HTMLElement} el - The note element.
 * @param {Object} note - The note data object.
 * @returns {void}
 */
/**
 * Resize engine initialization (Legacy - No-Op)
 * Replaced by delegated mousedown handler in handleCanvasMouseDown.
 */
function initResizable(el, note) {
    // Delegation-based architecture handles resizing dynamically.
}

let resizeFrame = null;

/**
 * Resolves the handle orientation string ('nw', 'ne', 'sw', 'se') from class list.
 */
function resolveDirection(handle) {
    const classes = ['nw', 'ne', 'sw', 'se'];
    for (const c of classes) if (handle.classList.contains(c)) return c;
    return 'se';
}

/**
 * Initiates the resizing state machine via delegated interaction.
 */
function handleResizeStart(e, handle) {
    if (STATE.isInitializing || !STATE.editMode) return;
    const noteEl = handle.closest('.sticky-note');
    const id     = noteEl?.dataset.id;
    const note   = STATE.notes.find(n => n.id == id);
    if (!note || !noteEl) return;

    e.preventDefault();
    e.stopPropagation();

    const rect = STATE.wrapperEl.getBoundingClientRect();
    STATE.resizingContext = {
        id, el: noteEl, note,
        direction: resolveDirection(handle),
        startX: e.clientX,
        startY: e.clientY,
        startWidth: noteEl.offsetWidth,
        startHeight: noteEl.offsetHeight,
        startLeft: note.x,
        startTop: note.y,
        startScrollLeft: STATE.wrapperEl.scrollLeft,
        startScrollTop: STATE.wrapperEl.scrollTop,
        startRectLeft: rect.left,
        startRectTop: rect.top
    };

    STATE.isResizing = id;
    noteEl.classList.add('resizing');
    
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
}

/**
 * Paint-aligned entry point for resizing movement.
 * Throttles high-frequency pointer events into the 60fps frame cycle.
 */
function handleResizeMove(e) {
    STATE.lastResizeEvent = e;
    if (resizeFrame) return;

    resizeFrame = requestAnimationFrame(() => {
        if (STATE.resizingContext && STATE.lastResizeEvent) {
            executeResizeMath(STATE.lastResizeEvent);
        }
        resizeFrame = null;
    });
}

/**
 * Computes coordinate deltas and applies snapped transformations to the DOM.
 */
function executeResizeMath(e) {
    const ctx = STATE.resizingContext;
    if (!ctx) return;

    const wrapper = STATE.wrapperEl;
    const currentRect = wrapper.getBoundingClientRect();
    const snap = STATE.snapGrid || 10;
    const minW = 240; 
    const minH = 54;

    const currentMouseX = (e.clientX - currentRect.left + wrapper.scrollLeft) / STATE.scale;
    const currentMouseY = (e.clientY - currentRect.top  + wrapper.scrollTop)  / STATE.scale;
    
    const baseMouseX = (ctx.startX - ctx.startRectLeft + ctx.startScrollLeft) / STATE.scale;
    const baseMouseY = (ctx.startY - ctx.startRectTop  + ctx.startScrollTop)  / STATE.scale;

    const deltaX = currentMouseX - baseMouseX;
    const deltaY = currentMouseY - baseMouseY;

    let { startWidth: newW, startHeight: newH, startLeft: newX, startTop: newY } = ctx;

    const fixedRight  = ctx.startLeft + ctx.startWidth;
    const fixedBottom = ctx.startTop  + ctx.startHeight;

    switch (ctx.direction) {
        case 'se': 
            newW = Math.round((ctx.startWidth + deltaX) / snap) * snap;
            newH = Math.round((ctx.startHeight + deltaY) / snap) * snap;
            break;
        case 'sw': {
            const snpL = Math.round((ctx.startLeft + deltaX) / snap) * snap;
            newW = fixedRight - snpL;
            newH = Math.round((ctx.startHeight + deltaY) / snap) * snap;
            newX = newW < minW ? fixedRight - minW : snpL;
            break;
        }
        case 'ne': {
            const snpT = Math.round((ctx.startTop + deltaY) / snap) * snap;
            newW = Math.round((ctx.startWidth + deltaX) / snap) * snap;
            newH = fixedBottom - snpT;
            newY = newH < minH ? fixedBottom - minH : snpT;
            break;
        }
        case 'nw': {
            const snpL = Math.round((ctx.startLeft + deltaX) / snap) * snap;
            const snpT = Math.round((ctx.startTop  + deltaY) / snap) * snap;
            newW = fixedRight - snpL;
            newH = fixedBottom - snpT;
            newX = newW < minW ? fixedRight - minW : snpL;
            newY = newH < minH ? fixedBottom - minH : snpT;
            break;
        }
    }

    // Clamping & Canvas Boundaries
    newW = Math.max(minW, newW);
    newH = Math.max(minH, newH);
    const maxXY = STATE.canvasSize - 100;
    newX = Math.max(0, Math.min(newX, maxXY));
    newY = Math.max(0, Math.min(newY, maxXY));

    // Application
    ctx.el.style.width  = `${newW}px`;
    ctx.el.style.height = `${newH}px`;
    ctx.el.style.left   = `${newX}px`;
    ctx.el.style.top    = `${newY}px`;

    // State Persistence
    ctx.note.width  = newW;
    ctx.note.height = newH;
    ctx.note.x = newX;
    ctx.note.y = newY;
}

/**
 * Terminates the resizing transaction and triggers persistence.
 * Safe State Teardown: DOM cleanup occurs before context nullification.
 */
function handleResizeEnd() {
    if (!STATE.resizingContext) return;
    
    const ctx = STATE.resizingContext;
    const id  = ctx.id;
    
    ctx.el.classList.remove('resizing');
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEnd);
    
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = null;

    STATE.isResizing = null;
    STATE.resizingContext = null;
    
    if (typeof syncNotePosition === 'function') syncNotePosition(id, 'normal', 300);
}

/**
 * Initiates or terminates the 'Pick & Place' interaction sequence.
 * Toggles flight mode for a note, caching baseline dimensions and viewport metrics.
 * @param {MouseEvent} e - The triggering mouse event.
 * @param {string|number} id - The unique identifier of the note.
 * @returns {void}
 */
function toggleStickyMove(e, id) {
    if (STATE.isInitializing) return;
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

    // Capture moving baseline: Viewport and Canvas metrics
    const wrapper = STATE.wrapperEl;
    const rect    = wrapper?.getBoundingClientRect();
    STATE.activeRectBaseline = rect;
    
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

    el.classList.add('in-flight');

    STATE.pickedNoteId = intId;
    STATE.pickedWidth  = el.offsetWidth;
    STATE.pickedHeight = el.offsetHeight;
    STATE.lastPickTime = Date.now();
    STATE.originalPos  = { x: note.x, y: note.y, z: el.style.zIndex };
    
    el.classList.add('note-picked');
    
    document.addEventListener('mousemove', updateStickyMove);
    showToast('Note picked up', 'info');
}

/**
 * Synchronizes note coordinates with the cursor during flight mode.
 * Accounts for canvas scale, scroll offset, and the established grid snap.
 * @param {MouseEvent} e - The active movement event.
 * @returns {void}
 */
function updateStickyMove(e) {
    if (!STATE.pickedNoteId) return;
    
    STATE.autoScroll.lastEvent = e;
    if (typeof checkAutoScrollProximity === 'function') checkAutoScrollProximity(e);

    const el = document.getElementById(`note-${STATE.pickedNoteId}`);
    if (!el) return;

    const wrapper = STATE.wrapperEl;
    const rect    = STATE.activeRectBaseline;
    if (!rect) return;
    
    let newX = (e.clientX - rect.left + wrapper.scrollLeft) / STATE.scale;
    let newY = (e.clientY - rect.top  + wrapper.scrollTop)  / STATE.scale;

    newX -= STATE.dragOffset.x;
    newY -= STATE.dragOffset.y;

    newX = Math.round(newX / STATE.snapGrid) * STATE.snapGrid;
    newY = Math.round(newY / STATE.snapGrid) * STATE.snapGrid;

    newX = Math.max(0, Math.min(newX, STATE.canvasSize - STATE.pickedWidth));
    newY = Math.max(0, Math.min(newY, STATE.canvasSize - STATE.pickedHeight));

    const note = STATE.notes.find(n => n.id == STATE.pickedNoteId);
    if (!note) return;

    note.x = newX;
    note.y = newY;

    el.style.left = `${newX}px`;
    el.style.top  = `${newY}px`;
}

/**
 * Evaluates cursor proximity to viewport edges to trigger directional auto-panning.
 * Prevents pan-chaining if manual board navigation is currently active.
 * @param {MouseEvent} e - The active interaction event.
 * @returns {void}
 */
function checkAutoScrollProximity(e) {
    const wrapper = STATE.wrapperEl;
    if (!wrapper) return;

    if (STATE.isPanning) {
        stopAutoScroll();
        return;
    }

    const rect = wrapper.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top  || e.clientY > rect.bottom) {
        stopAutoScroll();
        return;
    }

    const { margin } = STATE.autoScroll;
    
    let velX = 0;
    let velY = 0;

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

    const isNearEdge = (velX !== 0 || velY !== 0);
    const shouldBypass = STATE.autoScroll.active || STATE.isResizing;

    if (shouldBypass) {
        if (isNearEdge) startAutoScroll(velX, velY);
        else stopAutoScroll();
        return;
    }

    if (isNearEdge) {
        if (!STATE.autoScroll.startTime) {
            STATE.autoScroll.startTime = Date.now();
        } else if (Date.now() - STATE.autoScroll.startTime >= STATE.autoScroll.delay) {
            startAutoScroll(velX, velY);
        }
    } else {
        STATE.autoScroll.startTime = null;
    }
}

/**
 * Converts edge-proximity distance into a normalized scroll velocity.
 * @param {number} dist - The depth of the cursor into the scroll margin.
 * @returns {number} The calculated horizontal or vertical speed.
 */
function normalizeSpeed(dist) {
    const ratio = Math.min(dist / STATE.autoScroll.margin, 1);
    return ratio * STATE.autoScroll.maxSpeed;
}

/**
 * Commences the auto-scroll animation sequence.
 * Continuously pushes viewport coordinates based on calculated velocities.
 * @param {number} vx - Horizontal velocity component.
 * @param {number} vy - Vertical velocity component.
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
        if (lastE) {
            if (STATE.pickedNoteId) updateStickyMove(lastE);

            if (STATE.activeResizeHandler) STATE.activeResizeHandler(lastE);
        }

        STATE.autoScroll.frame = requestAnimationFrame(loop);
    };

    STATE.autoScroll.frame = requestAnimationFrame(loop);
}

/**
 * Terminates the auto-scroll animation loop and resets temporal triggers.
 * @returns {void}
 */
function stopAutoScroll() {
    STATE.autoScroll.startTime = null;
    if (!STATE.autoScroll.active) return;
    STATE.autoScroll.active = false;
    if (STATE.autoScroll.frame) {
        cancelAnimationFrame(STATE.autoScroll.frame);
    }
}

/**
 * Finalizes the 'Pick & Place' sequence and persists coordinates to the database.
 * De-promotes the note from its GPU layer and resets global interaction state.
 * @returns {void}
 */
function dropStickyNote() {
    if (!STATE.pickedNoteId) return;
    
    stopAutoScroll();

    const id = STATE.pickedNoteId;
    const el = document.getElementById(`note-${id}`);
    
    STATE.pickedNoteId      = null; 
    STATE.activeRectBaseline = null;
    STATE.originalPos        = null;
    
    if (el) {
        el.classList.add('note-settling');
        el.classList.remove('note-picked');
        el.classList.remove('in-flight');
        setTimeout(() => el.classList.remove('note-settling'), 600);
    }
    document.removeEventListener('mousemove', updateStickyMove);
    
    if (typeof syncNotePosition === 'function') syncNotePosition(id, 'normal', 500);
    showToast('Note placed', 'success');
}

/**
 * Aborts the active interaction and restores the note to its original coordinates.
 * Ensures state cleanup (classes and listeners) even if restoration baseline is absent.
 * @returns {void}
 */
function cancelStickyMove() {
    if (!STATE.pickedNoteId) return;
    
    stopAutoScroll();
    
    const id = STATE.pickedNoteId;
    const el = document.getElementById(`note-${id}`);
    const note = STATE.notes.find(n => n.id == id);
    
    if (el && note) {
        if (STATE.originalPos) {
            el.style.left   = `${STATE.originalPos.x}px`;
            el.style.top    = `${STATE.originalPos.y}px`;
            el.style.zIndex = STATE.originalPos.z;

            note.x = STATE.originalPos.x;
            note.y = STATE.originalPos.y;
            if (STATE.originalPos.z !== undefined) note.z_index = STATE.originalPos.z;

            if (typeof syncNotePosition === 'function') syncNotePosition(id, 'silent');
        }

        el.classList.add('note-settling');
        el.classList.remove('note-picked');
        el.classList.remove('in-flight');
        setTimeout(() => el.classList.remove('note-settling'), 600);
    }
    
    STATE.pickedNoteId       = null; 
    STATE.activeRectBaseline = null;
    STATE.originalPos        = null;
    
    document.removeEventListener('mousemove', updateStickyMove);
    showToast('Move cancelled', 'info');
}

function releaseActiveEditLock() {
    if (!STATE.isEditingNote) return;

    const noteId = STATE.isEditingNote;
    STATE.isEditingNote = null;

    const params = new URLSearchParams();
    params.append('id', noteId);
    params.append('session_id', STATE.sessionId);

    // Resilience: navigator.sendBeacon is the gold standard for reliable teardown transport
    navigator.sendBeacon('/notes/api/unlock', params);
}

// Global Lifecycle Persistence: Use pagehide for teardown beacons
window.addEventListener('pagehide', releaseActiveEditLock);

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
    if (STATE.isInitializing) return;
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
    
    // Ctrl + S: Board-wide Save Interception
    // Prevents the annoying browser "Save Page" dialog from appearing while on the whiteboard.
    if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        
        // If a note is currently being edited, trigger a save for it even if focus is lost
        if (STATE.isEditingNote) {
            const activeNote = document.querySelector('.sticky-note.is-editing');
            if (activeNote) {
                const id = activeNote.dataset.id;
                if (id) saveNoteInline(id, true);
            }
        }
    }

    // Ctrl + E: Toggle Edit Mode for the hovered or active note
    if (e.ctrlKey && e.key === 'e') {
        e.preventDefault();
        const targetId = STATE.isEditingNote || STATE.hoveredNoteId;
        if (targetId) {
            const btn = document.querySelector(`#note-${targetId} .btn-icon-edit`);
            if (btn && typeof toggleInlineEdit === 'function') {
                toggleInlineEdit(btn, targetId);
            }
        }
    }

    // Ctrl + F: Board-wide Search Interception
    // Overrides browser default search which often fails on oversized absolute canvas elements.
    if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        if (typeof openSearchModal === 'function') openSearchModal();
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
 * Atomic sync for scale mutations. Prevents coordinate drift by rolling back
 * STATE.scale if the visual applyScale synchronization fails.
 * @param {number} candidate - The prospective scale level.
 * @returns {boolean} Success status.
 */
function atomicApplyScale(candidate) {
    const backup = STATE.scale;
    try {
        if (typeof applyScale !== 'function') throw new Error('applyScale_missing');
        STATE.scale = candidate;
        applyScale();
        return true;
    } catch (e) {
        STATE.scale = backup;
        console.error('[AtomicScale] Sync Failure - State Reverted:', e);
        return false;
    }
}

/**
 * Normalizes wheel deltas based on the event's deltaMode.
 * Prevents intent misclassification on devices reporting in lines or pages.
 */
function normalizeWheelDeltas(e) {
    const LINE_PX = 16;
    const PAGE_PX = window.innerHeight;

    switch (e.deltaMode) {
        case WheelEvent.DOM_DELTA_LINE:
            return { dx: e.deltaX * LINE_PX, dy: e.deltaY * LINE_PX };
        case WheelEvent.DOM_DELTA_PAGE:
            return { dx: e.deltaX * PAGE_PX, dy: e.deltaY * PAGE_PX };
        case WheelEvent.DOM_DELTA_PIXEL:
        default:
            return { dx: e.deltaX, dy: e.deltaY };
    }
}

/**
 * Evaluates whether a wheel event should be shielded from the whiteboard
 * to allow a nested scrollable element (like a note's text area) to consume it.
 * 
 * Policy:
 * - Horizontal intent always belongs to the board (notes have no x-scroll).
 * - Vertical intent belongs to the note ONLY if it has vertical room to move.
 * - At top/bottom boundaries, intent is handed back to the board.
 * 
 * @param {WheelEvent} e - The wheel event.
 * @returns {boolean} True if the event should be shielded (consumed by note).
 */
function shouldShieldWheelFromBoard(e) {
    const s = e.target.closest('.note-text-viewer, .note-attachment-stack, textarea');
    if (!s) return false;

    // Normalize deltas to pixels for cross-device magnitude comparison
    const { dx, dy } = normalizeWheelDeltas(e);
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    // 1. Horizontal Intent: Primarily horizontal movements always belong to the board.
    // This ensures trackpad swipes/sideways gestures work smoothly over notes.
    if (absX > absY) return false;

    // 2. Vertical Capacity: If the note cannot scroll vertically, it cannot own the event.
    const canScrollVert = s.scrollHeight > s.clientHeight;
    if (!canScrollVert) return false;

    const goingDown = dy > 0;
    const goingUp   = dy < 0;

    // 3. Boundary Detection: Hand interaction back to board at boundaries.
    const atTop = s.scrollTop <= 0;
    const atBottom = Math.ceil(s.scrollTop + s.clientHeight) >= s.scrollHeight;

    if (goingDown && !atBottom) return true;
    if (goingUp && !atTop) return true;

    return false;
}

/**
 * Zooms the canvas in by one step (10%), snapping to the nearest decile.
 * @returns {void}
 */
function zoomIn() {
    const wrapper  = STATE.wrapperEl;
    if (!wrapper) return;
    const oldScale = STATE.scale;

    const step = SCALE_STEP || 0.1;
    const precision = (step.toString().split('.')[1] || '').length || 1;
    const f = Math.pow(10, precision);

    const candidate = Math.min(SCALE_MAX, Math.round((STATE.scale + step) * f) / f);

    // Canvas coordinate at the current viewport centre
    const canvasCX = (wrapper.scrollLeft + wrapper.clientWidth  / 2) / oldScale;
    const canvasCY = (wrapper.scrollTop  + wrapper.clientHeight / 2) / oldScale;

    if (atomicApplyScale(candidate)) {
        // Restore scroll so the same canvas point stays centred
        wrapper.scrollLeft = canvasCX * STATE.scale - wrapper.clientWidth  / 2;
        wrapper.scrollTop  = canvasCY * STATE.scale - wrapper.clientHeight / 2;
    }

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

    const step = SCALE_STEP || 0.1;
    const precision = (step.toString().split('.')[1] || '').length || 1;
    const f = Math.pow(10, precision);

    const candidate = Math.max(SCALE_MIN, Math.round((STATE.scale - step) * f) / f);

    const canvasCX = (wrapper.scrollLeft + wrapper.clientWidth  / 2) / oldScale;
    const canvasCY = (wrapper.scrollTop  + wrapper.clientHeight / 2) / oldScale;

    if (atomicApplyScale(candidate)) {
        wrapper.scrollLeft = canvasCX * STATE.scale - wrapper.clientWidth  / 2;
        wrapper.scrollTop  = canvasCY * STATE.scale - wrapper.clientHeight / 2;
    }

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
        // Migration: NoteAPI handles CSRF and error management internally
        const res = await NoteAPI.post('/notes/api/viewport', item.params, { keepalive: true });
        if (!res) failedItems.push(item);
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

    // Persistence Layer: Centralized transport handles CSRF and lifecycle signals
    const res = await NoteAPI.post('/notes/api/viewport', params, { keepalive: true });
    if (!res) {
        // Failure Recovery: If the direct commit fails, queue it for background retry
        STATE.syncQueue.push({ params: params.toString(), token: csrfToken, ts: Date.now() });
    }
}

/**
 * Canvas Mouse Down: Initiates panning orchestration.
 * @param {MouseEvent} e - The mouse event.
 */
function handleCanvasMouseDown(e) {
    if (STATE.isInitializing) return;
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

    // 2. Delegated Resize: If the user clicks a resizing handle
    const resizeHandle = e.target.closest('.note-resize-handle');
    if (resizeHandle && e.button === 0) {
        handleResizeStart(e, resizeHandle);
        return;
    }

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
    STATE.wrapperEl?.classList.add('is-panning-board');
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
    STATE.isPanning = false;
    STATE.wrapperEl?.classList.remove('is-panning-board');
    document.body.style.cursor = '';
    
    // Viewport persistence is automatically handled by the wrapper's scroll listener
}

/**
 * Canvas Wheel Interface: Handles zooming and high-speed directional panning.
 * @param {WheelEvent} e - The wheel event.
 */
function handleCanvasWheel(e) {
    // 1. Initialization & Modal Shields: Prevent background interaction during hydration or active UI states
    if (STATE.isInitializing || document.body.classList.contains('modal-open')) {
        // If the interaction is inside a modal or lock overlay, return EARLY without calling preventDefault()
        // This allows the browser to perform native scrolling for the UI at high fidelity.
        if (e.target.closest('.modal-overlay, .canvas-lock-overlay')) return;

        // Otherwise, if we are over the background canvas while a modal is up, block panning.
        if (!e.target.closest('.sticky-note')) e.preventDefault();
        return;
    }

    const wrapper = STATE.wrapperEl;
    if (!wrapper) return;

    // 2. Mutual Exclusion: Manual wheel activity overrides the auto-scroll engine
    if (typeof stopAutoScroll === 'function') stopAutoScroll();

    // 3. CTRL + Wheel: Anchored Zooming
    if (e.ctrlKey) {
        e.preventDefault(); // Always block browser zoom when within the whiteboard context

        const oldScale = STATE.scale;
        const step = SCALE_STEP || 0.1;
        const precision = (step.toString().split('.')[1] || '').length || 1;
        const f = Math.pow(10, precision);
        
        let candidate;
        if (e.deltaY < 0) {
            candidate = Math.min(SCALE_MAX, Math.round((STATE.scale + step) * f) / f);
        } else {
            candidate = Math.max(SCALE_MIN, Math.round((STATE.scale - step) * f) / f);
        }

        if (candidate === oldScale) return;

        const rect = wrapper.getBoundingClientRect();
        const mouseVX = e.clientX - rect.left;
        const mouseVY = e.clientY - rect.top;

        const canvasMX = (wrapper.scrollLeft + mouseVX) / oldScale;
        const canvasMY = (wrapper.scrollTop  + mouseVY) / oldScale;

        if (atomicApplyScale(candidate)) {
            wrapper.scrollLeft = canvasMX * STATE.scale - mouseVX;
            wrapper.scrollTop  = canvasMY * STATE.scale - mouseVY;
        }

        if (typeof updateRadar === 'function') updateRadar();
        if (typeof scheduleViewportSave === 'function') scheduleViewportSave();
    } else {
        // 4. Gesture Shielding: Prevent board pan/zoom while scrolling note internals.
        // Axis-aware: allows horizontal panning and boundary handoff.
        if (shouldShieldWheelFromBoard(e)) return;

        // 5. Plane Panning: Scrolling with no keys pressed
        
        // Continuity Guard: If we are already panning the board (via drag or recent wheel scroll),
        // we do not allow notes to hijack the interaction.
        const isContinuingBoardScroll = (Date.now() - (STATE.lastBoardScrollTime || 0)) < 250;
        const panLocked = STATE.isPanning || isContinuingBoardScroll;

        // Contextual Interaction Check: Determine if the wheel event should be consumed 
        // by a scrollable sub-element of a sticky note.
        let shouldConsume = false;

        const scrollable = e.target.closest('.note-text-viewer, .note-attachment-stack, textarea');
        let capturedY = false;

        if (scrollable && !panLocked) {
            const isScrollable = scrollable.scrollHeight > scrollable.clientHeight;
            if (isScrollable) {
                // If the user is scrolling horizontally (or Shift+Wheel), we do NOT capture the gesture
                // for the note, as notes only have vertical scrollbars.
                if (e.deltaX === 0 && !e.shiftKey) {
                    capturedY = true;
                    // Yield to native engine for purely vertical scroll
                    return; 
                }
                capturedY = true;
            }
        }

        if (!capturedY || e.deltaX !== 0 || e.shiftKey) {
            e.preventDefault();

            // Mark the intent as "Board Scroll" to maintain continuity
            STATE.lastBoardScrollTime = Date.now();
            
            // Interaction Physics: 1.5x multiplier to compensate for large canvas distances
            const multiplier = 1.5;

            // Shift + Vertical Wheel = Horizontal Scroll (Browser Parity)
            if (e.shiftKey && !e.deltaX) {
                wrapper.scrollLeft += (e.deltaY * multiplier);
            } else {
                wrapper.scrollLeft += (e.deltaX * multiplier);
                // Only move the board vertically if the note hasn't captured that axis
                if (!capturedY) {
                    wrapper.scrollTop  += (e.deltaY * multiplier);
                }
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
    if (STATE.isInitializing) return;
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
async function saveNoteInline(id, stayInEditMode = false) {
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
    if (typeof window.addActiveSync === 'function') window.addActiveSync(id);

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
        is_collapsed: note.is_collapsed
    };

    try {
        const res = await NoteAPI.post('/notes/api/save', params);
        if (res && res.success) {
            // State: Finalize UI before record merge
            if (!stayInEditMode && STATE.isEditingNote === id) {
                // Collaborative Locking: Clear state FIRST to block teardown races
                STATE.isEditingNote = null;
                
                el.classList.remove('is-editing');
                if (textarea) textarea.readOnly = true;
                
                const btnIcon = el.querySelector('.btn-icon-edit');
                if (btnIcon) {
                    btnIcon.innerHTML = '✏️';
                    btnIcon.title     = 'Edit Content';
                    btnIcon.classList.remove('pulse-glow');
                }

                const unlockRes = await NoteAPI.unlock(id);
                if (!unlockRes || !unlockRes.success) {
                    console.warn('[NoteAPI] Post-save unlock failed for note', id, unlockRes?.error);
                }
            }

            // Sync Lockout Release: Clear the 'in-flight' status before merging to allow the authoritative update
            if (typeof window.removeActiveSync === 'function') window.removeActiveSync(id);

            if (res.notes && typeof window.mergeNoteState === 'function') {
                window.mergeNoteState(res.notes);
            } else if (res.notes) {
                STATE.notes = res.notes;
            }
            STATE.last_mutation = res.last_mutation;
            
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
                    const renameRes = await NoteAPI.post('/notes/api/attachment/rename', {
                        note_id:   id,
                        blob_id:   blobId,
                        canvas_id: STATE.canvas_id,
                        filename:  newName
                    });
                    if (renameRes && renameRes.success) {
                        if (renameRes.notes && typeof window.mergeNoteState === 'function') {
                            window.mergeNoteState(renameRes.notes);
                        } else if (renameRes.notes) {
                            STATE.notes = renameRes.notes;
                        }
                        STATE.last_mutation = renameRes.last_mutation;
                    }
                }
            }

            // Sync Accent Color
            const accentColor = typeof normalizeColorHex === 'function' ? normalizeColorHex(color) : color;
            el.style.setProperty('--note-accent', accentColor);
            
            showToast('Note Saved', 'success');
        }
    } finally {
        el.classList.remove('pending');
        if (typeof window.removeActiveSync === 'function') window.removeActiveSync(id);
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
        const res = await NoteAPI.post('/notes/api/geometry', {
            id: id,
            canvas_id: STATE.canvas_id,
            is_collapsed: note.is_collapsed,
            x: note.x,
            y: note.y,
            width: note.width,
            height: note.height,
            z_index: note.z_index,
            layer_id: note.layer_id || 1
        });
        
        if (res && res.success) {
            if (res.notes && typeof window.mergeNoteState === 'function') {
                window.mergeNoteState(res.notes);
            } else if (res.notes) {
                STATE.notes = res.notes;
            }
            STATE.last_mutation = res.last_mutation;
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
 * @param {boolean} isAbort - Optional flag to revert changes without saving.
 */
async function toggleInlineEdit(btn, id, isAbort = false) {
    const el   = document.getElementById(`note-${id}`);
    const note = STATE.notes.find(n => n.id == id);
    if (!el || !note) return;

    const textarea  = el.querySelector('textarea');
    
    let lockAcquired = false;

    // Collaborative Locking: Prevention & Acquisition
    if (!el.classList.contains('is-editing')) {
        const lockRes = await NoteAPI.lock(id);
        if (!lockRes || !lockRes.success) return;
        lockAcquired = true;
    }

    // Visual geometry restoration for accurate dimension calculation.
    if (!el.classList.contains('is-editing') && note.is_collapsed) {
        try {
            await toggleCollapse(id);
        } catch (e) {
            if (lockAcquired) await NoteAPI.unlock(id);
            return;
        }
    }

    const isEditing = el.classList.toggle('is-editing');

    if (isEditing) {
        // UI Logic: Unified termination reset
        STATE.isEditingNote  = id;
        
        btn.innerHTML = '💾';
        btn.title     = 'Save Changes';
        btn.classList.add('pulse-glow');

        // Note: CSS handles visibility of child controls via parent .is-editing state.

        const textSect = el.querySelector('.note-text-section');
        if (textSect) textSect.classList.remove('hidden'); // Ensure editor container is visible

        // Interaction State: Enable inline field modifications
        const filenameDisplay = el.querySelector('.note-hero-container .file-name-display');
        if (filenameDisplay) {
            filenameDisplay.contentEditable = 'true';
            filenameDisplay.classList.add('is-editing-text');
        }
        
        el.querySelectorAll('.attachment-item-stack .file-name-display').forEach(fd => {
            fd.contentEditable = 'true';
            fd.classList.add('is-editing-text');
        });

        if (textarea) {
            textarea.readOnly = false;
            textarea.focus();

            // UI Logic: Dynamic height adaptation for text entry
            // Optimization: Skip auto-expansion for Dashboard notelets to prevent layout jumps 
            // when editing long URL lists. Let the textarea handle internal scrolling instead.
            const isDashboard = el.classList.contains('is-dashboard-note');
            
            const adaptNoteHeight = () => {
                if (isDashboard) return; // Maintain stable footprint for dashboards
                if (textarea.scrollHeight > textarea.clientHeight) {
                    const diff = textarea.scrollHeight - textarea.clientHeight;
                    el.style.height = `${el.offsetHeight + diff}px`;
                }
            };
            
            textarea.removeEventListener('input', textarea._adaptNoteHeight);
            textarea._adaptNoteHeight = adaptNoteHeight;
            textarea.addEventListener('input', textarea._adaptNoteHeight);
            
            setTimeout(adaptNoteHeight, 10);
        }
    } else {
        // Mode Termination: Atomic Persistence
        if (isAbort) {
            // UI State: Restore content from local state
            const txtArea = el.querySelector('textarea');
            if (txtArea && note) txtArea.value = note.content || '';
            
            STATE.isEditingNote = null;
        } else if (typeof saveNoteInline === 'function') {
            // Sequential Lifecycle: Await the save to ensure lock release doesn't race
            await saveNoteInline(id);
        }

        // UI Logic: Unified termination reset
        const txtArea = el.querySelector('textarea');
        if (txtArea) txtArea.readOnly = true;
        
        btn.innerHTML = '✏️';
        btn.title     = 'Edit Content';
        btn.classList.remove('pulse-glow');
        
        const txt = txtArea ? txtArea.value : '';
        const textSect = el.querySelector('.note-text-section');
        if (textSect && (!txt || txt.trim() === '')) {
            textSect.classList.add('hidden'); // Visibility gating for empty containers
        }

        const filenameDisplay = el.querySelector('.note-hero-container .file-name-display');
        if (filenameDisplay) {
            filenameDisplay.contentEditable = 'false';
            filenameDisplay.classList.remove('is-editing-text');
        }
        el.querySelectorAll('.attachment-item-stack .file-name-display').forEach(fd => {
            fd.contentEditable = 'false';
            fd.classList.remove('is-editing-text');
        });

        // Collaborative Locking: Explicit release for the Abort path.
        if (isAbort) {
            const unlockRes = await NoteAPI.unlock(id);
            if (!unlockRes || !unlockRes.success) {
                console.warn('[NoteAPI] Abort-path unlock failed for note', id, unlockRes?.error);
            }
        }
    }
}

/**
 * Keyboard Interface for Inline Editor.
 * Facilitates rapid 'Ctrl+Enter' commits and 'Esc' aborts.
 * @param {KeyboardEvent} e - The keydown event.
 * @param {number|string} id - The note ID.
 */
async function handleNoteKeydown(e, id) {
    // Ctrl + Enter: Instant Save & Close
    if (e.ctrlKey && e.key === 'Enter') {
        const btn = document.querySelector(`#note-${id} .btn-icon-edit`);
        if (btn && document.getElementById(`note-${id}`).classList.contains('is-editing')) {
            e.preventDefault();
            toggleInlineEdit(btn, id);
        }
    } 
    // Ctrl + S: Incremental Save (Stay in Editor)
    else if (e.ctrlKey && e.key === 's') {
        const el = document.getElementById(`note-${id}`);
        if (el && el.classList.contains('is-editing')) {
            e.preventDefault();  // Stop Browser Save Dialog
            e.stopPropagation(); // Stop event from bubbling to global handler
            saveNoteInline(id, true);
        }
    }
    // Ctrl + E: Exit/Save Edit Mode
    else if (e.ctrlKey && e.key === 'e') {
        const btn = document.querySelector(`#note-${id} .btn-icon-edit`);
        if (btn && document.getElementById(`note-${id}`).classList.contains('is-editing')) {
            e.preventDefault();
            e.stopPropagation();
            toggleInlineEdit(btn, id);
        }
    }
    else if (e.key === 'Escape') {
        const btn = document.querySelector(`#note-${id} .btn-icon-edit`);
        if (btn && document.getElementById(`note-${id}`).classList.contains('is-editing')) {
            await toggleInlineEdit(btn, id, true);
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

    const note = STATE.notes.find(n => n.id == id);
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
    // State Sync: Direct mutation of the note object (Source of Truth)
    note.content = newContent;
    
    // Safety Sync: Ensure the metadata registry is also updated to prevent stale [note:id] renders
    if (STATE.note_map[id]) STATE.note_map[id].content = newContent;

    // UI Synchronization: Immediate feedback for the user to prevent interaction lag
    const el = document.getElementById(`note-${id}`);
    if (el) {
        const viewer   = el.querySelector('.note-text-viewer');
        const textarea = el.querySelector('textarea');
        if (viewer)   viewer.innerHTML = formatNoteContent(note.content, id);
        if (textarea) textarea.value   = note.content;
    }

    // Persistent Sync: Commitment to the database
    if (typeof saveNoteInline === 'function') {
        await saveNoteInline(id);
    }
}
/**
 * System Clipboard Interface: Synchronizes text and optionally image data to the local OS.
 * Gracefully handles unsecured contexts (non-HTTPS) via legacy fallback.
 * @param {string} text - The text payload to copy.
 * @param {Blob} imageBlob - Optional PNG blob for rich media copying.
 * @returns {Promise<boolean>} - Success state.
 */
async function copyToClipboard(text, imageBlob = null) {
    if ((typeof text !== 'string' || text.length === 0) && !imageBlob) return false;

    // 1. Primary Strategy: Modern Clipboard API (Secure Context Required)
    if (navigator.clipboard && window.isSecureContext) {
        try {
            if (imageBlob && window.ClipboardItem) {
                // Construct a multi-type clipboard item (Text + Image)
                const data = {
                    'text/plain': new Blob([text || ''], { type: 'text/plain' })
                };
                
                // Note: Standard browser clipboard API strictly requires PNG for image storage
                if (imageBlob.type === 'image/png') {
                    data['image/png'] = imageBlob;
                }
                
                const item = new ClipboardItem(data);
                await navigator.clipboard.write([item]);
                return true;
            } else if (text) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (err) {
            console.warn('Modern Clipboard API failed, attempting fallback:', err);
        }
    }

    // 2. Secondary Strategy: Dynamic Textarea Elevation (Unsecured Context Fallback)
    // IMPORTANT: Images CANNOT be copied in non-secure contexts due to browser security policies.
    if (!text) return false;
    try {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "0";
        document.body.appendChild(textArea);
        
        textArea.focus();
        textArea.select();
        textArea.setSelectionRange(0, 99999);
        
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        return successful;
    } catch (err) {
        console.error('Unified Clipboard Failure:', err);
        return false;
    }
}

/**
 * Universal Clipboard Interface: Handles both full-note copying and specific asset extraction.
 * @param {number|string} id - The note ID.
 * @param {number|string|null} targetBlobId - Optional specific attachment to copy.
 * @returns {Promise<void>}
 */
async function copyNoteToClipboard(id, targetBlobId = null) {
    const note = STATE.notes.find(n => n.id == id) || STATE.note_map[id];
    if (!note) {
        showToast('Note data not found', 'error');
        return;
    }

    let text = note.content || '';
    const attachments = note.attachments || [];
    
    // Multi-Item Detection: Determines if we should pivot from standard 'Rich Copy' to 'Granular Copy'
    const hasText = text.trim().length > 0;
    const isMultiItem = (attachments.length > 1) || (attachments.length === 1 && hasText);

    // CASE A: Targeted Copy (Single Image from a multi-item stack)
    if (targetBlobId) {
        const imageBlob = await fetchAndNormalizeImage(targetBlobId);
        if (imageBlob && await copyToClipboard(null, imageBlob)) {
            showToast('Image Copied to Clipboard', 'success');
        } else {
            showToast(imageBlob ? 'Clipboard access denied' : 'Failed to prepare image for clipboard', 'error');
        }
        return;
    }

    // CASE B: Global Note Copy (The title bar 📋 action)
    // If the note has multiple items, the title bar button only targets the text for clarity.
    if (isMultiItem) {
        if (!text.trim()) {
            showToast('Use the 📋 buttons on each image to copy', 'info');
            return;
        }
        if (await copyToClipboard(text)) {
            showToast('Text Content Copied', 'success');
        } else {
            showToast('Clipboard access denied', 'error');
        }
        return;
    }

    // CASE C: Legacy/Simple Note Copy (Rich Media Strategy)
    const firstBlobId = note.blob_id || (attachments[0] ? attachments[0].blob_id : null);
    
    // 1. Build Comprehensive Text Payload (Names + Public URLs)
    const attachmentLines = new Set();
    const publicUrls      = [];
    
    if (note.filename) attachmentLines.add(note.filename);
    attachments.forEach(a => {
        if (a.filename) attachmentLines.add(a.filename);
        if (a.blob_id) publicUrls.push(`${window.location.origin}/notes/attachment/serve/${a.blob_id}`);
    });

    if (firstBlobId && publicUrls.length === 0) {
        publicUrls.push(`${window.location.origin}/notes/attachment/serve/${firstBlobId}`);
    }

    if (attachmentLines.size > 0 || publicUrls.length > 0) {
        let attSection = Array.from(attachmentLines).join('\n');
        if (publicUrls.length > 0) {
            attSection += (attSection ? '\n' : '') + publicUrls.join('\n');
        }
        text = text ? `${text}\n\n${attSection}` : attSection;
    }

    if ((!text || text.trim().length === 0) && note.title) {
        text = note.title;
    }

    // 2. Rich Media Hybrid: Attempt to fetch and copy the first image payload alongside text
    let imageBlob = null;
    const firstImageAtt = attachments.find(a => a.mime_type?.startsWith('image/'));
    const isImageNote   = note.type === 'image' || !!firstImageAtt;
    const fallbackBlobId  = firstImageAtt ? firstImageAtt.blob_id : (note.blob_id || firstBlobId);

    if (isImageNote && fallbackBlobId && window.isSecureContext) {
        imageBlob = await fetchAndNormalizeImage(fallbackBlobId);
    }

    if (!text?.trim() && !imageBlob) {
        showToast('Note is empty', 'info');
        return;
    }

    if (await copyToClipboard(text, imageBlob)) {
        showToast(imageBlob ? 'Image & Content Copied' : 'Content Copied', 'success');
    } else {
        showToast('Clipboard access denied', 'error');
    }
}

/**
 * Fetches an image, normalizes it to PNG, and prepares it for clipboard ingestion.
 * @param {number|string} blobId - Database blob ID.
 */
async function fetchAndNormalizeImage(blobId) {
    if (!window.isSecureContext) return null;
    try {
        // Centralized media transport with silent abort support
        const raw = await NoteAPI.blob(`/notes/attachment/serve/${blobId}`);
        if (!raw) return null; // Aborted or session expired
        
        // Browsers strictly require PNG (and sometimes JPEG) for clipboard storage.
        if (raw.type !== 'image/png') {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = URL.createObjectURL(raw);
            
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = () => reject(new Error('Image load failed'));
            });
            
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            
            const pngBlob = await new Promise(r => canvas.toBlob(r, 'image/png'));
            URL.revokeObjectURL(img.src);
            return pngBlob;
        }
        return raw;
    } catch (e) {
        console.warn(`[fetchAndNormalizeImage] Failed for blob ${blobId}:`, e);
        return null;
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
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('canvas_id', STATE.canvas_id);
    url.searchParams.set('note_id',   id);
    if (STATE.activeLayerId > 1) {
        url.searchParams.set('layer_id', STATE.activeLayerId);
    }
    
    if (await copyToClipboard(url.toString())) {
        showToast('Direct View Link Copied', 'success');
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
        const step = window.SCALE_STEP || 0.1;
        const precision = (step.toString().split('.')[1] || '').length || 1;
        const f = Math.pow(10, precision);
        
        const newScale = Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, STATE.pinchStartScale * zoomRatio)) * f) / f;
        
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

/**
 * Orchestrates the 'Jump to Level' right-click management suite.
 * Spawns a premium glassmorphism menu with 'Rename' and 'Move Level' capabilities.
 */
function showLevelContextMenu(e) {
    if (STATE.isInitializing) return;
    e.preventDefault();
    e.stopPropagation();

    const pill = document.getElementById('level-display');
    if (!pill) return;

    // Cleanup: Remove any existing context menus before spawning a new one
    document.querySelectorAll('.context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    
    // Logic: Absolute Anchoring. Position the menu relative to the pill's right edge
    const rect = pill.getBoundingClientRect();
    const x = rect.right + 15; // 15px gap from the pill
    const y = rect.top + (rect.height / 2); // Pill's vertical center
    
    menu.style.left = `${x}px`;
    menu.style.top  = `${y}px`;

    menu.innerHTML = `
        <div class="context-menu-item" onclick="showLevelRenameModal()">
            <span class="item-icon">✏️</span>
            <span>Rename Level</span>
        </div>
        <div class="context-menu-item" onclick="showLevelMoveModal()">
            <span class="item-icon">🚀</span>
            <span>Move Level to...</span>
        </div>
    `;

    document.body.appendChild(menu);

    // Global: Close menu on any subsequent click elsewhere
    const closeMenu = () => {
        menu.remove();
        document.removeEventListener('click', closeMenu);
    };
    // Defer attachment to prevent the current menu-spawning click from closing it immediately
    setTimeout(() => document.addEventListener('click', closeMenu), 10);
}

/**
 * Triggers the themed Rename Layer dialog.
 */
function showLevelRenameModal() {
    const currentName = STATE.layer_map[STATE.activeLayerId] || '';
    
    window.showConfirmModal({
        title: 'Rename Level ' + STATE.activeLayerId,
        icon: '✏️',
        message: 'Provide a descriptive name for this layer:',
        confirmText: 'Save',
        confirmIcon: '💾',
        input: {
            type: 'text',
            placeholder: 'e.g. Drafts, Planning, Archive...',
            value: currentName
        },
        hideCancel: true,
        onConfirm: async (val) => {
            const res = await NoteAPI.post('/notes/api/layer/rename', {
                canvas_id: STATE.canvas_id,
                layer_id: STATE.activeLayerId,
                name: val
            });
            
            if (res && res.success) {
                if (res.layer_map) STATE.layer_map = res.layer_map;
                if (typeof updateLevelDisplay === 'function') updateLevelDisplay();
                showToast('Level renamed', 'success');
            }
        }
    });
}

/**
 * Triggers the themed Move Layer migration dialog.
 */
function showLevelMoveModal() {
    window.showConfirmModal({
        title: 'Move Level Content',
        icon: '🚀',
        message: `<div style="color: #ef4444;">Migrate all notes from Level ${STATE.activeLayerId} to a new destination.<br><div style="text-align: center; font-weight: bold; font-size: 0.85rem; margin-top: 10px;">Target layer content will be merged.</div></div>`,
        confirmText: 'Migrate Content',
        confirmIcon: '🚀',
        danger: true,
        input: {
            type: 'number',
            placeholder: 'Target Level (1-99)',
            min: 1,
            max: 99
        },
        hideCancel: true,
        onConfirm: async (val) => {
            const targetId = parseInt(val);
            if (isNaN(targetId) || targetId < 1 || targetId > 99) {
                showToast('Invalid target level', 'error');
                throw new Error('Invalid level');
            }
            if (targetId === STATE.activeLayerId) {
                showToast('Cannot move to current level', 'warning');
                return;
            }

            showLoadingOverlay('Migrating notes...');
            try {
                const res = await NoteAPI.post('/notes/api/layers/move', {
                    canvas_id: STATE.canvas_id,
                    from_id: STATE.activeLayerId,
                    to_id: targetId
                });

                if (res && res.success) {
                    showToast(res.message || 'Notes migrated', 'success');
                    // Context Switch: Automatically jump to the target level to see the results
                    if (typeof window.switchLevel === 'function') await window.switchLevel(targetId);
                }
            } finally {
                hideLoadingOverlay();
            }
        }
    });
}

// Initialization: Attach listeners once the UI core is ready
const setupLevelManagement = () => {
    const pill = document.getElementById('level-display');
    if (pill) {
        pill.addEventListener('contextmenu', showLevelContextMenu);
        // Also allow left-clicking the pill to jump (optional, depends on if we want to keep dblclick logic)
    }
};

const setupSecurityInteractions = () => {
    const unlockInput = document.getElementById('unlock-password');
    if (!unlockInput || unlockInput.dataset.listenerActive) return;

    const unlockBtn = document.getElementById('btn-unlock-canvas');
    if (unlockBtn) {
        unlockBtn.addEventListener('click', () => {
            if (typeof window.apiUnlockCanvas === 'function') window.apiUnlockCanvas();
        });
    }

    unlockInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (typeof window.apiUnlockCanvas === 'function') window.apiUnlockCanvas();
        }
    });

    // Flag written AFTER all listeners are registered — accurately
    // provides authoritative signal for listener registration state.
    unlockInput.dataset.listenerActive = 'true';
};

// Export hooks for global availability
window.showLevelContextMenu = showLevelContextMenu;
window.setupLevelManagement = setupLevelManagement;
window.showLevelRenameModal = showLevelRenameModal;
window.showLevelMoveModal   = showLevelMoveModal;
window.setupSecurityInteractions = setupSecurityInteractions;

/**
 * Hover Intent: Armed Action Rail
 * Prevents accidental action triggers on tiny notes by requiring a 500ms
 * dwell time before action buttons become interactive. This ensures that
 * quick mouse-overs for drag-pickup remain safe and clear.
 */
const ARMED_TIMERS = new Map();

window.setupArmedActions = function setupArmedActions() {
    const wrapper = STATE.wrapperEl;
    if (!wrapper || wrapper.dataset.armedActionsActive) return;

    // Use delegation on the wrapper to catch all current and future note interactions
    wrapper.addEventListener('mouseover', (e) => {
        const header = e.target.closest('.note-header');
        if (!header) return;

        // Atomic Check: Skip if already armed OR if a timer is already counting for this specific header
        if (header.classList.contains('actions-armed') || ARMED_TIMERS.has(header)) return;

        const timer = setTimeout(() => {
            if (header.matches(':hover')) {
                header.classList.add('actions-armed');
            }
            ARMED_TIMERS.delete(header);
        }, 500);

        ARMED_TIMERS.set(header, timer);
    });

    wrapper.addEventListener('mouseout', (e) => {
        const header = e.target.closest('.note-header');
        if (!header) return;

        // Hierarchy Guard: Only teardown if we are actually exiting the header boundary, 
        // not just moving between children (buttons/input).
        const related = e.relatedTarget;
        if (related && header.contains(related)) return;

        // Immediate Teardown: Clear pending timers and remove armed state
        if (ARMED_TIMERS.has(header)) {
            clearTimeout(ARMED_TIMERS.get(header));
            ARMED_TIMERS.delete(header);
        }
        header.classList.remove('actions-armed');
    });

    wrapper.dataset.armedActionsActive = 'true';
};
