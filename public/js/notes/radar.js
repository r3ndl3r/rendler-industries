// /public/js/notes/radar.js

/**
 * Radar Engine: Renders simplified note "pings" onto the minimap canvas.
 * Now features 'Linked Magnification': The radar zooms as you zoom into the main board.
 */
function updateRadar() {
    drawRadarPings();
    syncRadarViewport();
}

function drawRadarPings() {
    const canvas = document.getElementById('radar-pings');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const wrapper = STATE.wrapperEl;
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
    const logicalVH = Math.max(1000, vh_raw / STATE.scale);
    // Use the larger of width/height so the radar window covers the full visible area
    // on both landscape and portrait viewports.
    const logicalViewMax = Math.max(logicalVW, logicalVH);

    // Calculate the logical window shown by the radar (capped at whole-world size)
    const logicalWindow = Math.min(STATE.canvasSize, logicalViewMax * contextMultiplier); 
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
    ctx.globalAlpha = 0.9;
    STATE.notes.forEach(note => {
        if (note.layer_id != STATE.activeLayerId) return;

        // Chroma Pings: Mirror the actual note color for high-precision awareness (with fallback)
        const rawColor = typeof normalizeColorHex === 'function' ? normalizeColorHex(note.color) : note.color;
        ctx.fillStyle = (rawColor && rawColor.startsWith('#')) ? rawColor : (rawColor ? `#${rawColor}` : '#f59e0b');

        // Translate logical coordinate -> Radar-relative coordinate
        const rx = (note.x - radarStartX) * minimapScale;
        const ry = (note.y - radarStartY) * minimapScale;

        // Visibility Boost: Enforce a 2px minimum size so tiny notes don't vanish
        const rw = Math.max(2, (note.width  || 250) * minimapScale);
        const rh = Math.max(2, (note.height || 200) * minimapScale);

        ctx.fillRect(rx, ry, rw, rh);
    });

    // Reset alpha state to prevent leakage into subsequent canvas context operations
    ctx.globalAlpha = 1.0;
}

/**
 * Radar Sync: Transposes the main viewport's coordinates onto the Magnifier window.
 */
function syncRadarViewport() {
    const wrapper = STATE.wrapperEl;
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
    const wrapper   = STATE.wrapperEl;
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
        const sensitivity = 0.2;
        const deltaMX = e.clientX - STATE.radarScrubLast.x;
        const deltaMY = e.clientY - STATE.radarScrubLast.y;
        
        // Logical Delta: Apply dampening directly to the mouse movement, then convert to board units
        const logicalDeltaX = (deltaMX * sensitivity) / miniScale;
        const logicalDeltaY = (deltaMY * sensitivity) / miniScale;

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

    const wrapper = STATE.wrapperEl;
    const container = document.getElementById('radar-container');
    if (!wrapper || !container || !STATE.radarWindow) return;

    const oldScale = STATE.scale;
    const step     = 0.1;

    let candidate;
    if (e.deltaY < 0) {
        candidate = Math.min(SCALE_MAX, Math.round((STATE.scale + step) * 10) / 10);
    } else {
        candidate = Math.max(SCALE_MIN, Math.round((STATE.scale - step) * 10) / 10);
    }

    if (candidate === oldScale) return;

    // Abort scale mutation if the visual apply function is unavailable.
    if (typeof applyScale !== 'function') return;

    // Atomic Commitment: Ensure STATE.scale is only mutated if applyScale succeeds.
    // This prevents corruption of downstream coordinate math if the DOM isn't ready.
    const backup = STATE.scale;
    try {
        STATE.scale = candidate;

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
        if (typeof scheduleViewportSave === 'function') scheduleViewportSave();
    } catch (err) {
        console.warn('[handleRadarWheel] applyScale failed, rolling back scale:', err);
        STATE.scale = backup;
    }
    }
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
