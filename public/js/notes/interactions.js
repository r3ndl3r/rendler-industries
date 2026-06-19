// /public/js/notes/interactions.js

/**
 * Interactions Module: Physics engines (Drag/Resize/Sticky), navigation, and grid snapping.
 * Handles all user interactions including click-to-edit, inline editing,
 * keyboard shortcuts, save/abort lifecycle, and mode switching between
 * click-to-edit and raw textarea editors.
 */

// --- Wikilink Autocomplete ---

(function () {
    let _dropdown = null;
    let _triggerStart = -1;
    let _consumeAfter = 0;

    let _insertTemplate = (title) => `[[${title}]]`;

    function buildDropdown(matches, textarea, template) {
        removeDropdown();
        if (template) _insertTemplate = template;
        if (!matches.length) return;

        _dropdown = document.createElement('div');
        _dropdown.className = 'wikilink-dropdown';

        matches.forEach(({ id, title, canvas_name }) => {
            const item = document.createElement('div');
            item.className = 'wikilink-dropdown-item';
            item.textContent = canvas_name ? `${title} (${canvas_name})` : title;
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                insertWikilink(textarea, title);
            });
            _dropdown.appendChild(item);
        });

        positionDropdown(textarea);
    }

    function positionDropdown(textarea) {
        const rect       = textarea.getBoundingClientRect();
        const scale      = (typeof STATE !== 'undefined' && STATE.scale) || 1;
        const linesBefore = textarea.value.substring(0, textarea.selectionStart).split('\n').length - 1;
        const lineHeight  = parseFloat(getComputedStyle(textarea).lineHeight) || 20;
        const scaledLine  = lineHeight * scale;
        const rawY        = linesBefore * scaledLine - textarea.scrollTop * scale;
        const cursorY     = Math.max(0, Math.min(rawY, rect.height - scaledLine));

        // Append with .measuring (visibility:hidden) so offsetHeight is available before reveal
        _dropdown.classList.add('measuring');
        document.body.appendChild(_dropdown);
        const ddH = _dropdown.offsetHeight;
        _dropdown.classList.remove('measuring');

        const gap       = 4;
        const belowTop  = rect.top + cursorY + scaledLine + gap;
        const aboveTop  = rect.top + cursorY - ddH - gap;
        const top       = (belowTop + ddH <= window.innerHeight) ? belowTop : Math.max(0, aboveTop);

        _dropdown.style.left = `${rect.left + window.scrollX}px`;
        _dropdown.style.top  = `${top + window.scrollY}px`;
    }

    function removeDropdown() {
        if (_dropdown) { _dropdown.remove(); _dropdown = null; }
        _triggerStart = -1;
        _consumeAfter = 0;
        _insertTemplate = (title) => `[[${title}]]`;
    }

    function insertWikilink(textarea, title) {
        const val    = textarea.value;
        const cursor = textarea.selectionStart;
        const before = val.substring(0, _triggerStart);
        const result = _insertTemplate(title);
        const after  = val.substring(cursor + _consumeAfter);
        const text   = typeof result === 'object' ? result.text : result;
        const newCursor = _triggerStart + (typeof result === 'object' ? result.cursor : text.length);
        textarea.value = `${before}${text}${after}`;
        textarea.setSelectionRange(newCursor, newCursor);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        removeDropdown();
    }

    function getTagMatches(query) {
        const lq = query.toLowerCase();
        const seen = new Set();
        (STATE.notes || []).forEach(n => {
            const matches = (n.content || '').matchAll(/\[tag:([^\]|]+)/g);
            for (const m of matches) seen.add(m[1].trim());
        });
        return [...seen]
            .filter(t => t.toLowerCase().includes(lq))
            .sort((a, b) => a.toLowerCase().indexOf(lq) - b.toLowerCase().indexOf(lq) || a.localeCompare(b))
            .slice(0, 8)
            .map(t => ({ id: null, title: t, canvas_name: null }));
    }

    function getStaticMatches(query, options) {
        const lq = query.toLowerCase();
        return options
            .filter(o => o.includes(lq))
            .sort((a, b) => a.indexOf(lq) - b.indexOf(lq) || a.localeCompare(b))
            .map(o => ({ id: null, title: o, canvas_name: null }));
    }

    function buildCalendar(textarea) {
        removeDropdown();
        _insertTemplate = (dateStr) => `[date:${dateStr}]`;

        let calYear  = new Date().getFullYear();
        let calMonth = new Date().getMonth();

        _dropdown = document.createElement('div');
        _dropdown.className = 'wikilink-calendar';

        function renderCalGrid() {
            const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
            const firstDay    = new Date(calYear, calMonth, 1).getDay();
            const monthName   = new Date(calYear, calMonth).toLocaleString('default', { month: 'long' });
            const today       = new Date();

            _dropdown.innerHTML = `
                <div class="cal-header">
                    <button class="cal-nav" data-dir="-1">&#8249;</button>
                    <span class="cal-title">${monthName} ${calYear}</span>
                    <button class="cal-nav" data-dir="1">&#8250;</button>
                </div>
                <div class="cal-days-header">
                    <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
                </div>
                <div class="cal-grid"></div>
            `;

            const grid = _dropdown.querySelector('.cal-grid');

            for (let i = 0; i < firstDay; i++) {
                const empty = document.createElement('span');
                empty.className = 'cal-day cal-empty';
                grid.appendChild(empty);
            }

            for (let d = 1; d <= daysInMonth; d++) {
                const isToday = d === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear();
                const cell = document.createElement('span');
                cell.className = 'cal-day' + (isToday ? ' cal-today' : '');
                cell.textContent = d;
                cell.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    const mm = String(calMonth + 1).padStart(2, '0');
                    const dd = String(d).padStart(2, '0');
                    insertWikilink(textarea, `${calYear}-${mm}-${dd}`);
                });
                grid.appendChild(cell);
            }

            _dropdown.querySelectorAll('.cal-nav').forEach(btn => {
                btn.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    calMonth += parseInt(btn.dataset.dir);
                    if (calMonth < 0)  { calMonth = 11; calYear--; }
                    if (calMonth > 11) { calMonth = 0;  calYear++; }
                    renderCalGrid();
                    positionDropdown(textarea);
                });
            });
        }

        renderCalGrid();

        positionDropdown(textarea);
    }

    function getBlobMatches(query) {
        const lq = query.toLowerCase();
        const map = STATE.note_map || {};
        const seen = {};
        return Object.values(map)
            .filter(n => n.title && n.title.toLowerCase().includes(lq) && (n.blob_id || (n.attachments && n.attachments.length > 0)))
            .sort((a, b) => {
                const ai = a.title.toLowerCase().indexOf(lq);
                const bi = b.title.toLowerCase().indexOf(lq);
                return ai - bi || a.title.localeCompare(b.title);
            })
            .reduce((acc, n) => {
                if (!seen[n.title]) {
                    const hasDupe = Object.values(map).filter(x => x.title === n.title).length > 1;
                    acc.push({ id: n.id, title: n.title, canvas_name: hasDupe ? n.canvas_name : null });
                    seen[n.title] = true;
                }
                return acc;
            }, [])
            .slice(0, 8);
    }

    function getSortedMatches(query) {
        const lq = query.toLowerCase();
        const map = STATE.note_map || {};
        const seen = {};

        return Object.values(map)
            .filter(n => n.title && n.title.toLowerCase().includes(lq))
            .sort((a, b) => {
                const ai = a.title.toLowerCase().indexOf(lq);
                const bi = b.title.toLowerCase().indexOf(lq);
                return ai - bi || a.title.localeCompare(b.title);
            })
            .reduce((acc, n) => {
                if (!seen[n.title]) {
                    const hasDupe = Object.values(map).filter(x => x.title === n.title).length > 1;
                    acc.push({ id: n.id, title: n.title, canvas_name: hasDupe ? n.canvas_name : null });
                    seen[n.title] = true;
                }
                return acc;
            }, [])
            .slice(0, 8);
    }

    document.addEventListener('input', (e) => {
        const textarea = e.target;
        if (!textarea.matches('textarea[data-action="note-keydown"]')) return;

        const val    = textarea.value;
        const cursor = textarea.selectionStart;
        const before = val.substring(0, cursor);

        // [copy: / [img: / [image: / [file: triggers
        const COLORS = ['yellow', 'blue', 'pink', 'orange', 'violet', 'indigo', 'slate', 'green', 'red', 'accent', 'info', 'success', 'danger', 'warning'];
        const SIZES  = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'];

        const BOOKMARK_FLAGS = [
            'copy', 'copylink', 'sort=id', 'sort=title', 'sort=x', 'sort=y', 'sort=created',
            'type=text', 'type=image', 'type=file',
            'tag=', 'filter=',
            'list', 'compact', 'title'
        ];

        function getBookmarkFlagMatches(query) {
            const parts = query.split(':');
            const lastPart = parts[parts.length - 1].toLowerCase();
            const usedKeys = new Set();
            for (const part of parts) {
                if (part.includes('=')) usedKeys.add(part.split('=')[0].toLowerCase());
                else usedKeys.add(part.toLowerCase());
            }
            return BOOKMARK_FLAGS
                .filter(f => {
                    const key = f.includes('=') ? f.split('=')[0].toLowerCase() : f.toLowerCase();
                    return f.toLowerCase().includes(lastPart) && !usedKeys.has(key);
                })
                .slice(0, 8)
                .map(f => ({ id: null, title: f, canvas_name: null }));
        }

        const staticTriggers = [
            { prefix: '[color:',  options: COLORS, template: (t) => `[color:${t}][/color]`,   cursorOffset: 8 },
            { prefix: '[colour:', options: COLORS, template: (t) => `[colour:${t}][/colour]`, cursorOffset: 9 },
            { prefix: '[bg:',    options: COLORS, template: (t) => `[bg:${t}][/bg]`,       cursorOffset: 5 },
            { prefix: '[size:',  options: SIZES,  template: (t) => `[size:${t}][/size]`,   cursorOffset: 7 },
        ];
        for (const { prefix, options, template, cursorOffset } of staticTriggers) {
            const idx = before.lastIndexOf(prefix);
            if (idx !== -1) {
                const between = before.substring(idx + prefix.length);
                if (!between.includes(']') && !between.includes('\n')) {
                    const matches = getStaticMatches(between, options);
                    buildDropdown(matches, textarea, (t) => {
                        const inserted = template(t);
                        // Position cursor inside the opening tag, before closing tag
                        return { text: inserted, cursor: inserted.length - cursorOffset };
                    });
                    _triggerStart = idx;
                    return;
                }
            }
        }

        // [date: calendar trigger
        const dateIdx = before.lastIndexOf('[date:');
        if (dateIdx !== -1) {
            const between = before.substring(dateIdx + 6);
            if (!between.includes(']') && !between.includes('\n')) {
                buildCalendar(textarea);
                _triggerStart = dateIdx;
                return;
            }
        }

        // [tag:Label| colour trigger — second param after the pipe separator
        const tagColorMatch = before.match(/\[tag:([^\]|\n]+)\|([^\]|\n]*)$/);
        if (tagColorMatch) {
            const label      = tagColorMatch[1];
            const colorQuery = tagColorMatch[2];
            const tagStart   = before.lastIndexOf('[tag:');
            const matches    = getStaticMatches(colorQuery, COLORS);
            buildDropdown(matches, textarea, (color) => `[tag:${label}|${color}]`);
            _triggerStart = tagStart;
            return;
        }

        const bracketTriggers = [
            { prefix: '[copy:',       template: (t) => `[copy:${t}]`,       matcher: getSortedMatches       },
            { prefix: '[img:',        template: (t) => `[img:${t}]`,        matcher: getBlobMatches          },
            { prefix: '[image:',      template: (t) => `[image:${t}]`,      matcher: getBlobMatches          },
            { prefix: '[file:',       template: (t) => `[file:${t}]`,       matcher: getBlobMatches          },
            { prefix: '[embed:',      template: (t) => `[embed:${t}]`,      matcher: getSortedMatches        },
            { prefix: '[tag:',        template: (t) => `[tag:${t}]`,        matcher: getTagMatches           },
        ];
        for (const { prefix, template, matcher } of bracketTriggers) {
            const idx = before.lastIndexOf(prefix);
            if (idx !== -1) {
                const between = before.substring(idx + prefix.length);
                if (!between.includes(']') && !between.includes('\n')) {
                    const matches = matcher(between);
                    buildDropdown(matches, textarea, template);
                    _triggerStart = idx;
                    return;
                }
            }
        }

        // [bookmarks: — special handling: preserves existing flags, avoids double ]
        const bmIdx = before.lastIndexOf('[bookmarks:');
        if (bmIdx !== -1) {
            const bmBetween = before.substring(bmIdx + '[bookmarks:'.length);
            if (!bmBetween.includes(']') && !bmBetween.includes('\n')) {
                const matches = getBookmarkFlagMatches(bmBetween);
                buildDropdown(matches, textarea, (flag) => {
                    const lastColon = bmBetween.lastIndexOf(':');
                    const existing  = lastColon !== -1 ? bmBetween.substring(0, lastColon) : '';
                    const newContent = existing ? `${existing}:${flag}` : flag;
                    const afterCursor = val.substring(cursor);
                    const hasClose = afterCursor.startsWith(']');
                    _consumeAfter = hasClose ? 1 : 0;
                    return { text: `[bookmarks:${newContent}]`, cursor: `[bookmarks:${newContent}]`.length };
                });
                _triggerStart = bmIdx;
                return;
            }
        }

        // [[ trigger
        const lastOpen = before.lastIndexOf('[[');
        if (lastOpen === -1) { removeDropdown(); return; }

        const between = before.substring(lastOpen + 2);
        if (between.includes(']]') || between.includes('\n')) { removeDropdown(); return; }

        const matches = getSortedMatches(between);
        buildDropdown(matches, textarea);
        // Set after buildDropdown — buildDropdown calls removeDropdown() which resets _triggerStart
        _triggerStart = lastOpen;
    });

    document.addEventListener('keydown', (e) => {
        if (!_dropdown) return;
        if (e.key === 'Escape') { removeDropdown(); return; }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const items = _dropdown.querySelectorAll('.wikilink-dropdown-item');
            const active = _dropdown.querySelector('.active');
            const next = active ? active.nextElementSibling : items[0];
            if (active) active.classList.remove('active');
            if (next) next.classList.add('active');
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            const items = _dropdown.querySelectorAll('.wikilink-dropdown-item');
            const active = _dropdown.querySelector('.active');
            const prev = active ? active.previousElementSibling : items[items.length - 1];
            if (active) active.classList.remove('active');
            if (prev) prev.classList.add('active');
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
            const active = _dropdown.querySelector('.active');
            if (active) {
                e.preventDefault();
                active.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            }
        }
    });

    document.addEventListener('click', (e) => {
        if (_dropdown && !_dropdown.contains(e.target)) removeDropdown();
    });

    document.addEventListener('focusout', (e) => {
        if (e.target.matches('textarea[data-action="note-keydown"]') && _dropdown) {
            removeDropdown();
        }
    });
})();

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
let _noteContextMenuTimer = null;
let _ribbonTextarea = null;
const pendingNoteHeightFits = new Set();
let noteHeightFitFrame = null;

/**
 * Resolves the edge orientation string from a resize handle.
 */
function resolveDirection(handle) {
    const classes = ['n', 's', 'e', 'w'];
    for (const c of classes) if (handle.classList.contains(c)) return c;
    return 'w';
}

/**
 * Initiates the resizing state machine via delegated interaction.
 */
function isTouchInteraction(e) {
    return !!(e && (e.touches || e.changedTouches || e.pointerType === 'touch'));
}

function getTouchById(touches, touchId) {
    if (!touches || touches.length === 0) return null;
    if (touchId === null || touchId === undefined) return touches[0];
    return Array.from(touches).find(touch => touch.identifier === touchId) || null;
}

function handleResizeStart(e, handle) {
    if (STATE.isInitializing || !STATE.editMode) return;
    
    // Safety: Prevent multiple dispatch if touch and synthesized mouse events fire in sequence
    if (STATE.isResizing) return;

    const noteEl = handle.closest('.sticky-note');
    if (!noteEl) return;

    const id = noteEl.dataset.id;
    const note = STATE.notes.find(n => n.id == id);
    if (!note) return;

    // Touch resize is intentionally gated by note edit mode; mouse behavior is unchanged.
    if (isTouchInteraction(e) && !noteEl.classList.contains('is-editing')) return;

    // Normalization: Capture precise start point regardless of input type
    const pointer = e.touches ? getTouchById(e.touches, null) : e;
    if (!pointer) return;
    const resizeTouchId = pointer.identifier !== undefined ? pointer.identifier : null;
    
    // Critical: Stop bubble and prevent default browser behaviors (scrolling/selection)
    // before they can be hijacked by background canvas listeners.
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();

    const rect = STATE.wrapperEl.getBoundingClientRect();
    STATE.resizingContext = {
        id, el: noteEl, note,
        touchId: resizeTouchId,
        direction: resolveDirection(handle),
        startX: pointer.clientX,
        startY: pointer.clientY,
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
    document.addEventListener('touchmove', handleResizeMove, { passive: false });
    document.addEventListener('touchend', handleResizeEnd);
    document.addEventListener('touchcancel', handleResizeEnd);
}

/**
 * Paint-aligned entry point for resizing movement.
 * Throttles high-frequency pointer events into the 60fps frame cycle.
 */
function handleResizeMove(e) {
    // Normalization: Extract primary pointer data
    const pointer = e.touches
        ? getTouchById(e.touches, STATE.resizingContext?.touchId)
        : e;
    if (!pointer) return;

    // Safety: Prevent board scrolling on mobile during active resize
    if (e.touches && e.cancelable) e.preventDefault();

    STATE.lastResizeEvent = {
        clientX: pointer.clientX,
        clientY: pointer.clientY,
        shiftKey: e.shiftKey
    };

    if (resizeFrame) return;

    resizeFrame = requestAnimationFrame(() => {
        if (!STATE.resizingContext) { resizeFrame = null; return; }
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

    var isFence = window.isFenceNote ? window.isFenceNote(ctx.note) : false;

    switch (ctx.direction) {
        case 's':
            if (!isFence) return;
            newH = Math.round((ctx.startHeight + deltaY) / snap) * snap;
            break;
        case 'n': {
            if (!isFence) return;
            const snpT = Math.round((ctx.startTop + deltaY) / snap) * snap;
            newH = fixedBottom - snpT;
            newY = newH < minH ? fixedBottom - minH : snpT;
            break;
        }
        case 'e':
            newW = Math.round((ctx.startWidth + deltaX) / snap) * snap;
            break;
        case 'w': {
            const snpL = Math.round((ctx.startLeft + deltaX) / snap) * snap;
            newW = fixedRight - snpL;
            newX = newW < minW ? fixedRight - minW : snpL;
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
function handleResizeEnd(e) {
    if (!STATE.resizingContext) return;

    // Multi-Touch Guard: If this is a TouchEvent, only terminate if the 
    // finger that started the resize is the one that was lifted.
    if (e && e.changedTouches && STATE.resizingContext.touchId !== null) {
        const lifted = Array.from(e.changedTouches).find(t => t.identifier === STATE.resizingContext.touchId);
        if (!lifted) return;
    }
    
    const ctx = STATE.resizingContext;
    const id  = ctx.id;
    
    // Listener Management: Remove document-level listeners to prevent accumulation.
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEnd);
    document.removeEventListener('touchmove', handleResizeMove);
    document.removeEventListener('touchend', handleResizeEnd);
    document.removeEventListener('touchcancel', handleResizeEnd);

    ctx.el.classList.remove('resizing');
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = null;

    STATE.isResizing = null;
    STATE.resizingContext = null;
    
    if (typeof fitNoteHeight === 'function') fitNoteHeight(id);
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
    
    // Mouse drag is blocked while editing; touch drag requires edit mode.
    const touchInteraction = isTouchInteraction(e);
    if (el && el.classList.contains('is-editing')) {
        if (!touchInteraction) return;
    } else if (touchInteraction) {
        return;
    }

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
    var pointer = e.touches ? getTouchById(e.touches, null) : e;
    if (!pointer) return;
    const cursorX = (pointer.clientX - rect.left + wrapper.scrollLeft) / STATE.scale;
    const cursorY = (pointer.clientY - rect.top  + wrapper.scrollTop)  / STATE.scale;
    
    STATE.dragOffset = {
        x: cursorX - note.x,
        y: cursorY - note.y
    };

    // --- 1. Focus Management (Z-Index Promotion) ---
    // Optimization: Skip re-scanning all notes. Use cached STATE.maxZ.
    if (!window.isFenceNote?.(note) && note.z_index < STATE.maxZ) {
        const newZ = ++STATE.maxZ;
        note.z_index = newZ;
        el.style.zIndex = newZ;
        if (typeof syncNotePosition === 'function') syncNotePosition(intId, 'silent');
    }

    el.classList.add('in-flight');

    STATE.pickedNoteId = intId;
    STATE.pickedWidth  = el.offsetWidth;
    STATE.pickedHeight = el.offsetHeight;
    STATE.pickedTouchId = pointer.identifier !== undefined ? pointer.identifier : null;
    STATE.lastPickTime = Date.now();
    STATE.originalPos  = { x: note.x, y: note.y, z: window.getNoteZIndex?.(note) || el.style.zIndex };
    
    // --- 2. Bulk Operation Baseline ---
    // If the picked note is part of a selection, we capture the relative baseline
    // for all siblings to enable synchronized "swarm" movement.
    if (STATE.selectedNoteIds.has(String(intId))) {
        STATE.groupBaseline = new Map();
        
        // Z-Index Parity: When moving a swarm, promote ALL members to the foreground
        // to prevent them from slipping behind unselected notes during the move.
        STATE.selectedNoteIds.forEach(sid => {
            const snote = STATE.notes.find(n => n.id == sid);
            if (snote) {
                STATE.groupBaseline.set(sid, { x: snote.x, y: snote.y, z: window.getNoteZIndex?.(snote) || snote.z_index });
                const selEl = document.getElementById(`note-${sid}`);
                if (selEl) {
                    selEl.classList.add('in-flight', 'note-picked');
                    // Per-member Z-Promotion: each note gets its own unique foreground Z
                    if (!window.isFenceNote?.(snote)) {
                        const memberZ = ++STATE.maxZ;
                        snote.z_index = memberZ;
                        selEl.style.zIndex = memberZ;
                    } else {
                        snote.z_index = 1;
                        selEl.style.zIndex = 1;
                    }
                }
            }
        });

        // Batch Sync Z-Index (Z-only sync is handled via 'silent' calls if needed, 
        // but batch move will eventually sync full coords)
    }

    el.classList.add('note-picked');
    
    document.addEventListener('mousemove', updateStickyMove);
    document.addEventListener('touchmove', updateStickyMove, { passive: false });
    document.addEventListener('touchend', handleStickyMoveTouchEnd);
    document.addEventListener('touchcancel', handleStickyMoveTouchEnd);
    showToast(STATE.groupBaseline ? `Moving ${STATE.selectedNoteIds.size} notes` : 'Note picked up', 'info');
}

/**
 * Synchronizes note coordinates with the cursor during flight mode.
 * Accounts for canvas scale, scroll offset, and the established grid snap.
 * @param {MouseEvent} e - The active movement event.
 * @returns {void}
 */
function updateStickyMove(e) {
    if (!STATE.pickedNoteId) return;
    
    var pointer = e.touches ? getTouchById(e.touches, STATE.pickedTouchId) : e;
    if (!pointer) return;
    if (e.touches && e.cancelable) e.preventDefault();
    STATE.autoScroll.lastEvent = pointer;
    if (typeof checkAutoScrollProximity === 'function') checkAutoScrollProximity(pointer);

    const el = document.getElementById(`note-${STATE.pickedNoteId}`);
    if (!el) return;

    const wrapper = STATE.wrapperEl;
    const rect    = STATE.activeRectBaseline;
    if (!rect) return;
    
    let newX = (pointer.clientX - rect.left + wrapper.scrollLeft) / STATE.scale;
    let newY = (pointer.clientY - rect.top  + wrapper.scrollTop)  / STATE.scale;

    newX -= STATE.dragOffset.x;
    newY -= STATE.dragOffset.y;

    newX = Math.round(newX / STATE.snapGrid) * STATE.snapGrid;
    newY = Math.round(newY / STATE.snapGrid) * STATE.snapGrid;

    newX = Math.max(0, Math.min(newX, STATE.canvasSize - STATE.pickedWidth));
    newY = Math.max(0, Math.min(newY, STATE.canvasSize - STATE.pickedHeight));

    // --- Bulk Transformation Logic ---
    if (STATE.groupBaseline) {
        const dx = newX - STATE.originalPos.x;
        const dy = newY - STATE.originalPos.y;

        STATE.groupBaseline.forEach((pos, sid) => {
            const snote = STATE.notes.find(n => n.id == sid);
            const selEl = document.getElementById(`note-${sid}`);
            if (snote && selEl) {
                const nw = snote.width || 280;
                const nh = snote.height || 200;
                const targetX = Math.max(0, Math.min(pos.x + dx, STATE.canvasSize - nw));
                const targetY = Math.max(0, Math.min(pos.y + dy, STATE.canvasSize - nh));

                snote.x = targetX;
                snote.y = targetY;
                selEl.style.left = `${targetX}px`;
                selEl.style.top  = `${targetY}px`;
            }
        });
    } else {
        // Standard Single-Note Move
        const note = STATE.notes.find(n => n.id == STATE.pickedNoteId);
        if (note) {
            note.x = newX;
            note.y = newY;
            el.style.left = `${newX}px`;
            el.style.top  = `${newY}px`;
        }
    }

    if (typeof updateRadar === 'function') updateRadar();
}

function handleStickyMoveTouchEnd(e) {
    if (!STATE.pickedNoteId) return;
    if (STATE.pickedTouchId !== null && STATE.pickedTouchId !== undefined) {
        const lifted = getTouchById(e.changedTouches, STATE.pickedTouchId);
        if (!lifted) return;
    }
    dropStickyNote();
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
    
    // Capture context for persistence before clearing state
    const isGroupMove = !!STATE.groupBaseline;
    const selection   = isGroupMove ? Array.from(STATE.selectedNoteIds) : null;

    STATE.pickedNoteId      = null;
    STATE.pickedTouchId     = null;
    STATE.activeRectBaseline = null;
    STATE.originalPos        = null;

    if (el) {
        el.classList.add('note-settling');
        el.classList.remove('note-picked');
        el.classList.remove('in-flight');
        setTimeout(() => el.classList.remove('note-settling'), 600);
    }

    if (isGroupMove && selection) {
        selection.forEach(sid => {
            const selEl = document.getElementById(`note-${sid}`);
            if (selEl) {
                selEl.classList.add('note-settling');
                selEl.classList.remove('note-picked', 'in-flight');
                setTimeout(() => selEl.classList.remove('note-settling'), 600);
            }
        });
        STATE.groupBaseline = null;
        if (typeof syncBatchNotePositions === 'function') {
            syncBatchNotePositions(selection);
        }
    } else {
        if (typeof syncNotePosition === 'function') syncNotePosition(id, 'normal', 500);
    }

    document.removeEventListener('mousemove', updateStickyMove);
    document.removeEventListener('touchmove', updateStickyMove);
    document.removeEventListener('touchend', handleStickyMoveTouchEnd);
    document.removeEventListener('touchcancel', handleStickyMoveTouchEnd);
    showToast(isGroupMove ? 'Group placed' : 'Note placed', 'success');
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

    // --- Bulk Rollback Logic ---
    if (STATE.groupBaseline) {
        STATE.groupBaseline.forEach((pos, sid) => {
            const snote = STATE.notes.find(n => n.id == sid);
            const selEl = document.getElementById(`note-${sid}`);
            if (snote && selEl) {
                snote.x = pos.x;
                snote.y = pos.y;
                selEl.style.left = `${pos.x}px`;
                selEl.style.top  = `${pos.y}px`;

                if (pos.z !== undefined) {
                    snote.z_index = pos.z;
                    selEl.style.zIndex = pos.z;
                }

                selEl.classList.add('note-settling');
                selEl.classList.remove('note-picked', 'in-flight');
                setTimeout(() => selEl.classList.remove('note-settling'), 600);
            }
        });

        if (el) {
            el.classList.add('note-settling');
            el.classList.remove('note-picked', 'in-flight');
            setTimeout(() => el.classList.remove('note-settling'), 600);
        }
        STATE.groupBaseline = null;
    } else {
        // Standard Single-Note Rollback
        const note = STATE.notes.find(n => n.id == id);
        if (el && note && STATE.originalPos) {
            el.style.left   = `${STATE.originalPos.x}px`;
            el.style.top    = `${STATE.originalPos.y}px`;
            el.style.zIndex = STATE.originalPos.z;

            note.x = STATE.originalPos.x;
            note.y = STATE.originalPos.y;
            if (STATE.originalPos.z !== undefined) note.z_index = STATE.originalPos.z;

            if (typeof syncNotePosition === 'function') syncNotePosition(id, 'silent');

            el.classList.add('note-settling');
            el.classList.remove('note-picked', 'in-flight');
            setTimeout(() => el.classList.remove('note-settling'), 600);
        }
    }

    STATE.pickedNoteId       = null;
    STATE.pickedTouchId      = null;
    STATE.activeRectBaseline = null;
    STATE.originalPos        = null;

    document.removeEventListener('mousemove', updateStickyMove);
    document.removeEventListener('touchmove', updateStickyMove);
    document.removeEventListener('touchend', handleStickyMoveTouchEnd);
    document.removeEventListener('touchcancel', handleStickyMoveTouchEnd);
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
 * Global keyboard shortcut dispatcher.
 * Handles Ctrl+E (toggle edit mode, Shift for raw), Escape (abort edit, close modals,
 * clear selection, cancel move), Ctrl+A (select all notes), Ctrl+S (suppress browser
 * save dialog), Ctrl+F (find), and Ctrl+I (open in iframe).
 * @param {KeyboardEvent} e - The keydown event.
 * @returns {void}
 */
function handleGlobalKeydown(e) {
    const key = e.key.toLowerCase();
    const commandKey = e.ctrlKey || e.metaKey;

    // Ctrl + E: Toggle Edit Mode for the hovered or active note.
    // Intercept before initialization guard so Firefox does not steal focus.
    if (e.ctrlKey && key === 'e') {
        e.preventDefault();
        e.stopPropagation();
        if (STATE.isInitializing) return;

        const targetId = STATE.isEditingNote || STATE.hoveredNoteId;
        if (targetId) {
            const btn = document.querySelector(`#note-${targetId} .btn-icon-edit`);
            if (btn && typeof toggleInlineEdit === 'function') {
                toggleInlineEdit(btn, targetId, false, e.shiftKey);
            }
        }
        return;
    }

    if (STATE.isInitializing) return;

    if (e.key === 'Escape') {
        const openNoteModal = [
            ['note-view-modal', typeof closeViewModal === 'function' ? closeViewModal : null],
            ['note-create-modal', typeof closeCreateModal === 'function' ? closeCreateModal : null],
            ['note-search-modal', typeof closeSearchModal === 'function' ? closeSearchModal : null]
        ].find(([modalId]) => {
            const modal = document.getElementById(modalId);
            return modal && (modal.classList.contains('show') || modal.classList.contains('active'));
        });
        if (openNoteModal?.[1]) {
            e.preventDefault();
            e.stopPropagation();
            openNoteModal[1]();
            return;
        }
        if (document.body.classList.contains('modal-open')) return;

        const hasSelection = STATE.selectedNoteIds && STATE.selectedNoteIds.size > 0;
        
        if (STATE.pickedNoteId) {
            e.preventDefault();
            e.stopPropagation();
            cancelStickyMove();
            return; // Terminate signal to prevent modal closing if picking was active
        }

        if (STATE.isLassoing) {
            e.preventDefault();
            e.stopPropagation();
            resetLasso(true); // User-requested: Clear everything on Escape
            return;
        }

        if (hasSelection) {
            // Hardening: Prevent event bubbling if we are clearing a selection.
            // This ensures that hitting Esc over an input clears the selection FIRST
            // before standard input "Blur/Abort" behavior if desired.
            e.preventDefault();
            e.stopPropagation();
            resetLasso(true);
            showToast('Selection cleared', 'info');
            return;
        }

        // Exit note edit mode when no inline editor is active
        if (STATE.isEditingNote) {
            e.preventDefault();
            e.stopPropagation();
            var editBtn = document.querySelector('#note-' + STATE.isEditingNote + ' .btn-icon-edit');
            if (editBtn && typeof toggleInlineEdit === 'function') {
                toggleInlineEdit(editBtn, STATE.isEditingNote, true);
            }
        }
    }
    
    // Ctrl + A: Select All Notes on current isolation level
    if (e.ctrlKey && e.key === 'a') {
        // Guard: Prevent hijacking default "Select All Text" behavior if we are inside 
        // an input, textarea, or contenteditable.
        const isEntry = e.target.closest('input, textarea, [contenteditable="true"]');
        if (!isEntry) {
            e.preventDefault();
            
            // UI Reset
            STATE.selectedNoteIds.clear();
            
            const currentLayerId = STATE.activeLayerId;
            let count = 0;
            
            STATE.notes.forEach(n => {
                if (currentLayerId == null || n.layer_id == currentLayerId) {
                    const idStr = String(n.id);
                    STATE.selectedNoteIds.add(idStr);
                    const el = document.getElementById(`note-${idStr}`);
                    el?.classList.add('is-selected');
                    count++;
                }
            });
            
            if (count > 0) {
                showToast(`Selected all ${count} notes on Level ${currentLayerId}`, 'info');
            }
        }
    }
    
    // Ctrl + S: Board-wide Save Interception
    // Prevents the annoying browser "Save Page" dialog from appearing while on the whiteboard.
    if (e.ctrlKey && key === 's') {
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

    // Ctrl + F: Board-wide Search Interception
    // Overrides browser default search which often fails on oversized absolute canvas elements.
    if (commandKey && key === 'f') {
        e.preventDefault();
        if (typeof window.openSearchModal === 'function') window.openSearchModal();
        return;
    }

    // Delete / Backspace: Bulk Deletion for the current selection
    // Guard: Only triggers if notes are selected AND the user is not focused on an input field.
    if (e.key === 'Delete' || e.key === 'Backspace') {
        const hasSelection = STATE.selectedNoteIds && STATE.selectedNoteIds.size > 0;
        const isEntry = e.target.closest('input, textarea, [contenteditable="true"]');
        
        if (hasSelection && !isEntry) {
            e.preventDefault();
            if (typeof deleteNote === 'function') {
                // Calling deleteNote with no parameters triggers the bulk path defined in api.js
                deleteNote();
            }
        }
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
        
        // Coordinate Resolution: Anchor strictly on the note's title bar (top origin).
        const centerY = ny;

        const scrollX = (centerX * STATE.scale) - (wrapper.clientWidth  / 2);
        const scrollY = (centerY * STATE.scale) - (wrapper.clientHeight / 8);

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
    
    try {
        for (const item of items) {
            // Migration: NoteAPI handles CSRF and error management internally
            const res = await NoteAPI.post('/notes/api/viewport', item.params, { keepalive: true, silent: true });
            if (!res || !res.success) failedItems.push(item);
        }
        
        if (failedItems.length > 0) {
            STATE.syncQueue = [...failedItems, ...STATE.syncQueue];
        }
    } finally {
        STATE.isSyncing = false;

        // Drain any context switch that was blocked by our isSyncing lock
        if (STATE.pendingContext) {
            const ctx = STATE.pendingContext;
            STATE.pendingContext = null;
            loadState(ctx.initial, ctx.canvas_id, ctx.targetNoteId, ctx.layer_id);
        }
    }
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
    const res = await NoteAPI.post('/notes/api/viewport', params, { keepalive: true, silent: true });
    if (!res) {
        // Failure Recovery: If the direct commit fails, queue it for background retry
        STATE.syncQueue.push({ params: params.toString(), token: csrfToken, ts: Date.now() });
    }
}

/**
 * Universal mouse-down entry point on the canvas.
 * Dispatches to note-header button actions (edit, raw-edit, delete, link, upload, view),
 * resize handles, shift-click selection management, Pick & Place drag initiation,
 * marquee/lasso selection on background, and canvas panning.
 * @param {MouseEvent} e - The raw trigger event.
 */
function handleCanvasMouseDown(e) {
    if (STATE.isInitializing) return;

    // 1. Note Header Actions: Centralized delegation for all note-level buttons
    const hashBtn    = e.target.closest('.note-id-hash');
    const editBtn     = e.target.closest('.btn-icon-edit');
    const rawEditBtn  = e.target.closest('.btn-icon-raw-edit');
    const aiFormatBtn = e.target.closest('.btn-icon-ai-format');
    const linkBtn     = e.target.closest('.btn-icon-link');
    const uploadBtn   = e.target.closest('.btn-icon-upload');
    const viewBtn     = e.target.closest('.btn-icon-view');
    const deleteBtn   = e.target.closest('.btn-icon-delete:not(.reel-action-btn):not(.hero-action-btn)');

    // 3. Delegated Resize: If the user clicks a resizing handle
    const resizeHandle = e.target.closest('.note-resize-handle');
    if (resizeHandle && e.button === 0) {
        handleResizeStart(e, resizeHandle);
        return;
    }

    if (e.button === 0) {
        const noteEl = e.target.closest('.sticky-note');
        if (noteEl) {
            const id = noteEl.dataset.id;
            const idStr = String(id);
            if (id) {
                // --- 2A. Selection Management (Shift-Click / Note click) ---
                if (e.shiftKey) {
                    // Toggle Pattern: Shift-Click toggles inclusion in the selection
                    if (STATE.selectedNoteIds.has(idStr)) {
                        STATE.selectedNoteIds.delete(idStr);
                        noteEl.classList.remove('is-selected');
                    } else {
                        STATE.selectedNoteIds.add(idStr);
                        noteEl.classList.add('is-selected');
                    }
                    e.preventDefault();
                    return; // Stop processing to avoid immediate drag initialization if clicking handle
                } else if (!STATE.selectedNoteIds.has(idStr)) {
                    // Focus Pattern: Clicking an unselected note without Shift clears others.
                    // This prevents the "swarming" bug where you accidentally move a forgotten lassoed group.
                    if (STATE.selectedNoteIds.size > 0) {
                        STATE.selectedNoteIds.clear();
                        document.querySelectorAll('.sticky-note.is-selected').forEach(el => el.classList.remove('is-selected'));
                    }
                }

                if (hashBtn && typeof copyNoteToClipboard === 'function') {
                    copyNoteToClipboard(id); return;
                }
                if (editBtn && typeof toggleInlineEdit === 'function') {
                    toggleInlineEdit(editBtn, id, false, noteEl.classList.contains('is-raw-editing'));
                    return;
                }
                if (rawEditBtn && typeof toggleInlineEdit === 'function') {
                    toggleInlineEdit(noteEl.querySelector('.btn-icon-edit') || rawEditBtn, id, false, true);
                    return;
                }
                if (aiFormatBtn && typeof aiFormatNote === 'function') {
                    aiFormatNote(id, aiFormatBtn); return;
                }
                if (linkBtn && typeof copyNoteLink === 'function') {
                    copyNoteLink(id); return;
                }
                if (uploadBtn && typeof triggerInlineUpload === 'function') {
                    triggerInlineUpload(id); return;
                }
                if (viewBtn && typeof viewNote === 'function') {
                    viewNote(id); return;
                }
                if (deleteBtn && typeof deleteNote === 'function') {
                    deleteNote(id); return;
                }
            }
        }
    }

    // 4. Pick & Place Detection: If the user clicks a note's title bar/drag handle
    const handle = e.target.closest('.note-drag-handle-container');
    const isAction = e.target.closest('.note-header-tab, .note-check-trigger, .note-link-trigger, .reel-action-btn, .hero-action-btn, .btn-icon-drawer, [data-action].btn-icon, [data-action].reel-action-btn, [data-action].hero-action-btn');
    const isTitle = e.target.closest('.note-title-slot, .inline-title-input');

    if (handle && !isAction && !isTitle && e.button === 0) {
        const noteId = handle.closest('.sticky-note')?.dataset.id;
        if (noteId) {
            const currentCanvas = STATE.canvases.find(c => c.id == STATE.canvas_id);
            const canEdit = currentCanvas ? Number(currentCanvas.can_edit) === 1 : true;
            if (!canEdit) {
                showToast('This board is read-only.', 'warning');
                return;
            }
            toggleStickyMove(e, noteId);
            return;
        }
    }

    // 5. Standard Panning or Marquee Selection:
    // Shift+left-click drag on the background initiates lasso; unmodified left-click
    // on the background initiates panning.
    const wrapper = STATE.wrapperEl;
    if (!wrapper) return;

    if (e.button === 0 && e.shiftKey && !handle && !isAction && !isTitle) {
        // --- 5A. Marquee Selection (Lasso) — Shift+Left-Click Drag ---
        e.preventDefault(); // Prevents browser text-selection during drag
        STATE.isLassoing = true;
        const rect = wrapper.getBoundingClientRect();

        // Origin: Absolute board coordinates (translated for scale/scroll)
        STATE.lassoStart = {
            x: (e.clientX - rect.left + wrapper.scrollLeft) / STATE.scale,
            y: (e.clientY - rect.top  + wrapper.scrollTop)  / STATE.scale
        };

        // UI Reset: Clear existing selection
        STATE.selectedNoteIds.clear();
        document.querySelectorAll('.sticky-note.is-selected').forEach(el => el.classList.remove('is-selected'));

        // Performance Optimization: Cache current note states for O(1) hit-testing
        const currentLayerId = STATE.activeLayerId;
        STATE.lassoNoteCache = STATE.notes
            .filter(n => currentLayerId == null || n.layer_id == currentLayerId)
            .map(n => ({
                id:   String(n.id),
                x:    n.x,
                y:    n.y,
                w:    n.width  || 280,
                h:    n.height || 200,
                el:   document.getElementById(`note-${n.id}`)
            }));

        const marquee = document.getElementById('lasso-marquee');
        if (marquee) {
            marquee.style.left   = `${STATE.lassoStart.x}px`;
            marquee.style.top    = `${STATE.lassoStart.y}px`;
            marquee.style.width  = '0px';
            marquee.style.height = '0px';
            marquee.classList.add('show');
        }

        // Off-canvas escape hatch: capture mouseup at document level so a
        // release outside the viewport always terminates the lasso.
        document.addEventListener('mouseup', handleCanvasMouseUp, { once: true });
    } else if (e.button === 0 && !e.shiftKey && !handle && !isAction && !isTitle &&
               !e.target.closest('input, textarea, [contenteditable], select, .note-text-viewer, a[href], a[data-action], button:not([data-pan-passthrough]), .note-check-trigger, .note-link-trigger, [data-action].btn-icon, [data-action].reel-action-btn, [data-action].hero-action-btn')) {
        // --- 5B. Standard Panning — Left-Click on Background ---
        // UX Consistency: Only clear lasso selection when clicking true background,
        // not when panning originates from a note body (preserves multi-selection).
        const onBackground = e.target === STATE.canvasEl || e.target === STATE.wrapperEl;
        if (onBackground && STATE.selectedNoteIds && STATE.selectedNoteIds.size > 0) {
            resetLasso(true);
        }

        STATE.isPanning = true;
        STATE.panMoved  = false;
        STATE.panStart = {
            x: e.clientX,
            y: e.clientY,
            scrollX: wrapper.scrollLeft,
            scrollY: wrapper.scrollTop
        };
    }
}

/**
 * Canvas Mouse Move: Updates the perspective coordinates during panning or hit-testing during lasso.
 * @param {MouseEvent} e - The mouse event.
 */
function handleCanvasMouseMove(e) {
    if (STATE.isLassoing) {
        const wrapper = STATE.wrapperEl;
        const marquee = document.getElementById('lasso-marquee');
        if (!wrapper || !marquee || !STATE.lassoNoteCache) return;

        const rect = wrapper.getBoundingClientRect();
        const currentX = (e.clientX - rect.left + wrapper.scrollLeft) / STATE.scale;
        const currentY = (e.clientY - rect.top  + wrapper.scrollTop)  / STATE.scale;

        const left   = Math.min(STATE.lassoStart.x, currentX);
        const top    = Math.min(STATE.lassoStart.y, currentY);
        const width  = Math.abs(currentX - STATE.lassoStart.x);
        const height = Math.abs(currentY - STATE.lassoStart.y);

        marquee.style.left   = `${left}px`;
        marquee.style.top    = `${top}px`;
        marquee.style.width  = `${width}px`;
        marquee.style.height = `${height}px`;

        // --- Real-time Hit Testing (Optimized via Cache) ---
        const right  = left + width;
        const bottom = top + height;

        STATE.lassoNoteCache.forEach(note => {
            const nx = note.x;
            const ny = note.y;
            const nw = note.w;
            const nh = note.h;

            const intersects = (nx < right && nx + nw > left && ny < bottom && ny + nh > top);
            
            if (intersects) {
                if (!STATE.selectedNoteIds.has(note.id)) {
                    STATE.selectedNoteIds.add(note.id);
                    note.el?.classList.add('is-selected');
                }
            } else {
                if (STATE.selectedNoteIds.has(note.id)) {
                    STATE.selectedNoteIds.delete(note.id);
                    note.el?.classList.remove('is-selected');
                }
            }
        });
        return;
    }

    if (!STATE.isPanning || !STATE.panStart) return;
    const wrapper = STATE.wrapperEl;
    if (!wrapper) return;

    const dx = e.clientX - STATE.panStart.x;
    const dy = e.clientY - STATE.panStart.y;

    // --- Interaction Guard: Movement Threshold ---
    // UX Logic: Defer indicators until movement is confirmed. This allows
    // stationary dblclick events to reach the note body without interference
    // and eliminates cursor flashing on single clicks.
    if (!STATE.panMoved) {
        const threshold = 4;
        if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
        
        STATE.panMoved = true;
        STATE.wrapperEl?.classList.add('is-panning-board');
        document.body.style.cursor = 'grabbing';
    }

    // Prevent text selection during active pan gesture
    // This does NOT suppress the dblclick event chain (established at mousedown)
    e.preventDefault();

    wrapper.scrollLeft = STATE.panStart.scrollX - dx;
    wrapper.scrollTop  = STATE.panStart.scrollY - dy;
}

/**
 * Canvas Mouse Up: Terminates active panning operations or lasso selection.
 * @param {MouseEvent} e - The mouseup event.
 * @returns {void}
 */
function handleCanvasMouseUp(e) {
    if (STATE.isLassoing) {
        const count = STATE.selectedNoteIds.size;
        resetLasso(false); // Finish selection without purging state
        if (count > 0) {
            showToast(`Selected ${count} notes`, 'info');
        }
        return;
    }

    STATE.isPanning = false;
    STATE.panMoved  = false;
    STATE.wrapperEl?.classList.remove('is-panning-board');
    document.body.style.cursor = '';
}



/**
 * Atomic Reset for Bulk Selection State.
 * Orchestrates UI cleanup and state flushing to guarantee system parity.
 * @param {boolean} clearData - If true, the internal selection set is purged in addition to UI cleanup.
 */
function resetLasso(clearData = false) {
    STATE.isLassoing = false;
    STATE.lassoNoteCache = null;
    
    if (clearData) {
        STATE.selectedNoteIds.clear();
        document.querySelectorAll('.sticky-note.is-selected').forEach(el => el.classList.remove('is-selected'));
    }

    const marquee = document.getElementById('lasso-marquee');
    if (marquee) marquee.classList.remove('show');
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
            // Delegate the full shield decision (including boundary detection) to the
            // authoritative shouldShieldWheelFromBoard function to avoid duplicate logic.
            if (shouldShieldWheelFromBoard(e)) {
                // Yield to native scroll engine; do not call e.preventDefault()
                return;
            }
            // Element exists but cannot or should not capture (boundary or horizontal): 
            // mark capturedY only for purely vertical intent so the board pans instead
            const isScrollable = scrollable.scrollHeight > scrollable.clientHeight;
            if (isScrollable && e.deltaX === 0 && !e.shiftKey) {
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

    if (e.target.closest('.note-floating-actions-rail')) return;

    // 1. Note Detection: Resolve identity via standard 'id' or user-specified 'noteId'
    const noteEl = e.target.closest('.sticky-note, [data-note-id], [data-id]');
    if (!noteEl) {
        if (!STATE.editMode || STATE.pickedNoteId) return;
        if (e.target.id !== 'notes-canvas' && e.target.id !== 'canvas-wrapper') return;
        const wrapper = STATE.wrapperEl;
        if (!wrapper) return;
        const rect = wrapper.getBoundingClientRect();
        const x = (e.clientX - rect.left + wrapper.scrollLeft) / STATE.scale;
        const y = (e.clientY - rect.top  + wrapper.scrollTop)  / STATE.scale;
        if (typeof showCreateNoteModal === 'function') {
            showCreateNoteModal('text', null, null, null, null, { x, y });
        }
        return;
    }

    // SSO Resolution: Extract the raw ID for state lookups
    const id = noteEl.dataset.id || noteEl.dataset.noteId || noteEl.closest('.sticky-note')?.dataset.id;
    if (!id) return;

    // --- Path A: Collapse Toggle (Targeting the Header Slot) ---
    const titleSlot = e.target.closest('.note-title-slot');
    if (titleSlot) {
        if (STATE.pickedNoteId && typeof cancelStickyMove === 'function') cancelStickyMove();
        toggleCollapse(id);
        return;
    }

    // --- Path B: Floating Actions Rail Toggle ---
    var actionable = e.target.closest('.btn-icon, .note-resize-handle, .note-drag-handle-container, .note-header-tab, .note-check-trigger, .note-link-trigger, .note-id-hash, .inline-title-input, .reel-action-btn, .hero-action-btn, .btn-icon-drawer');
    if (actionable) return;

    e.preventDefault();
    e.stopPropagation();

    if (STATE.floatingRailNoteId == id) {
        hideFloatingActionsRail();
    } else {
        showFloatingActionsRail(e, id);
    }
}
/*
 * Floating Actions Rail: shared element appended to body, toggled by
 * double-clicking an unactionable area of a note body. Uses position:fixed
 * at the double-click coordinates.
 */
function ensureFloatingActionsRail() {
    var existing = document.querySelector('.note-floating-actions-rail');
    if (existing) return existing;

    var rail = document.createElement('div');
    rail.className = 'note-floating-actions-rail';
    rail.setAttribute('role', 'toolbar');
    rail.setAttribute('aria-label', 'Note actions');
    rail.setAttribute('aria-hidden', 'true');
    rail.innerHTML =
        '<button type="button" class="btn-icon btn-icon-edit" title="Edit Content" aria-label="Edit content">✏️</button>' +
        '<button type="button" class="btn-icon btn-icon-raw-edit" title="Raw Edit Content" aria-label="Raw edit content">📝</button>' +
        '<button type="button" class="btn-icon btn-icon-ai-format" title="Clone and AI Format" aria-label="Clone and AI format">✨</button>' +
        '<button type="button" class="btn-icon btn-icon-link" title="Copy Direct Link" aria-label="Copy direct link">🔗</button>' +
        '<button type="button" class="btn-icon btn-icon-upload note-inline-upload-btn" title="Add Attachment" aria-label="Add attachment">📎</button>' +
        '<button type="button" class="btn-icon btn-icon-view" title="Quick View" aria-label="Quick view">👁️</button>' +
        '<button type="button" class="btn-icon btn-icon-delete" title="Delete Note" aria-label="Delete note">🗑️</button>' +
        '<button type="button" class="btn-icon btn-icon-close" title="Close and Discard Changes" aria-label="Close and discard changes">×</button>';
    rail.querySelectorAll('button').forEach(button => { button.tabIndex = -1; });

    rail.addEventListener('click', function (ev) {
        var btn = ev.target.closest('button');
        if (!btn) return;
        var id = rail.dataset.noteId;
        if (!id) return;

        ev.preventDefault();
        ev.stopPropagation();

        const noteEl = document.getElementById(`note-${id}`);
        const editBtn = noteEl?.querySelector('.btn-icon-edit');

        if (btn.classList.contains('btn-icon-close')) {
            hideFloatingActionsRail();
            if (noteEl?.classList.contains('is-editing') && editBtn && typeof toggleInlineEdit === 'function') {
                toggleInlineEdit(editBtn, id, true);
            }
        } else if (btn.classList.contains('btn-icon-edit')) {
            if (editBtn && typeof toggleInlineEdit === 'function') {
                toggleInlineEdit(editBtn, id);
            }
        } else if (btn.classList.contains('btn-icon-raw-edit')) {
            if (editBtn && typeof toggleInlineEdit === 'function') {
                toggleInlineEdit(editBtn, id, false, true);
            }
        } else if (btn.classList.contains('btn-icon-ai-format')) {
            if (typeof aiFormatNote === 'function') aiFormatNote(id, btn);
        } else if (btn.classList.contains('btn-icon-link')) {
            if (typeof copyNoteLink === 'function') copyNoteLink(id);
        } else if (btn.classList.contains('btn-icon-upload')) {
            if (typeof triggerInlineUpload === 'function') triggerInlineUpload(id);
        } else if (btn.classList.contains('btn-icon-view')) {
            if (typeof viewNote === 'function') viewNote(id);
        } else if (btn.classList.contains('btn-icon-delete')) {
            if (typeof deleteNote === 'function') deleteNote(id);
        }
    });

    document.body.appendChild(rail);
    return rail;
}

function showFloatingActionsRail(e, noteId) {
    var rail = ensureFloatingActionsRail();
    rail.dataset.noteId = noteId;
    STATE.floatingRailNoteId = noteId;
    rail.setAttribute('aria-hidden', 'false');
    rail.querySelectorAll('button').forEach(button => { button.tabIndex = 0; });
    updateEditModeIndicators(noteId);

    var x = e.clientX;
    var y = e.clientY;
    rail.style.left = x + 'px';

    // Prefer above the cursor; flip below if it would overflow the viewport
    rail.classList.add('show');
    var rect = rail.getBoundingClientRect();
    var placedY = y - rect.height - 8;
    if (placedY < 4) placedY = y + 12;
    const maxY = Math.max(4, window.innerHeight - rect.height - 4);
    rail.style.top = Math.max(4, Math.min(placedY, maxY)) + 'px';

    var maxX = Math.max(4, window.innerWidth - rect.width - 4);
    if (x > maxX) rail.style.left = maxX + 'px';
    if (x < 4) rail.style.left = '4px';
}

function hideFloatingActionsRail() {
    var rail = document.querySelector('.note-floating-actions-rail');
    STATE.floatingRailNoteId = null;
    if (!rail) return;
    rail.classList.remove('show');
    rail.setAttribute('aria-hidden', 'true');
    rail.querySelectorAll('button').forEach(button => { button.tabIndex = -1; });
    if (rail.contains(document.activeElement)) document.activeElement.blur();
    delete rail.dataset.noteId;
}

function updateEditModeIndicators(noteId) {
    const noteEl = document.getElementById(`note-${noteId}`);
    const editing = !!noteEl?.classList.contains('is-editing');
    const rawEditing = editing && noteEl.classList.contains('is-raw-editing');
    const targets = [];

    if (noteEl) targets.push(noteEl);
    const rail = document.querySelector('.note-floating-actions-rail');
    if (rail && String(rail.dataset.noteId) === String(noteId)) targets.push(rail);

    targets.forEach(target => {
        const editButton = target.querySelector('.btn-icon-edit');
        const rawEditButton = target.querySelector('.btn-icon-raw-edit');
        editButton?.classList.toggle('edit-mode-active', editing && !rawEditing);
        rawEditButton?.classList.toggle('edit-mode-active', rawEditing);
        editButton?.setAttribute('aria-pressed', editing && !rawEditing ? 'true' : 'false');
        rawEditButton?.setAttribute('aria-pressed', rawEditing ? 'true' : 'false');
    });
}

/**
 * Persists inline edits (title, content, color, filename) to the backend.
 * This function handles targeted DOM updates to prevent full board re-renders.
 * @param {number|string} id - The note ID.
 * @returns {Promise<void>}
 */
function applyMeasuredNoteHeight(el, height) {
    if (!el || !height) return;

    const id = el.dataset.id;
    const note = STATE.notes.find(n => n.id == id);
    const alreadyFitted = el.dataset.heightFitted === '1';
    const savedTransition = el.style.transition;

    if (!alreadyFitted) el.style.transition = 'none';
    el.style.height = `${height}px`;
    el.dataset.heightFitted = '1';

    if (note) note.height = height;
    if (STATE.note_map && STATE.note_map[id]) STATE.note_map[id].height = height;

    if (!alreadyFitted) {
        void el.offsetHeight;
        el.style.transition = savedTransition;
    }
}

function flushNoteHeightFits() {
    const targets = [];

    pendingNoteHeightFits.forEach(id => {
        const el = document.getElementById(`note-${id}`);
        if (!el || el.classList.contains('collapsed') || el.classList.contains('is-fence-note')) return;

        const rawTextarea = el.classList.contains('is-raw-editing')
            ? el.querySelector('.note-text-section > textarea[data-action="note-keydown"]:not([readonly])')
            : null;
        const savedTextareaHeight = rawTextarea ? rawTextarea.style.height : '';
        if (rawTextarea) {
            rawTextarea.style.height = 'auto';
            rawTextarea.style.height = `${rawTextarea.scrollHeight}px`;
        }

        el.classList.add('note-height-measuring');
        targets.push({ el, rawTextarea, savedTextareaHeight });
    });
    pendingNoteHeightFits.clear();

    if (targets.length === 0) {
        noteHeightFitFrame = null;
        return;
    }

    requestAnimationFrame(() => {
        const measurements = targets.map(target => ({
            ...target,
            height: target.el.isConnected
                && !target.el.classList.contains('collapsed')
                && !target.el.classList.contains('is-fence-note')
                ? Math.max(120, Math.ceil(target.el.offsetHeight) + 2)
                : null
        }));

        measurements.forEach(({ el, rawTextarea, savedTextareaHeight, height }) => {
            el.classList.remove('note-height-measuring');
            if (rawTextarea) rawTextarea.style.height = savedTextareaHeight;
            if (height) applyMeasuredNoteHeight(el, height);
        });

        noteHeightFitFrame = null;
        if (pendingNoteHeightFits.size > 0) {
            noteHeightFitFrame = requestAnimationFrame(flushNoteHeightFits);
        }
    });
}

function fitNoteHeight(id) {
    if (id === null || id === undefined) return;
    pendingNoteHeightFits.add(String(id));
    if (!noteHeightFitFrame) noteHeightFitFrame = requestAnimationFrame(flushNoteHeightFits);
}

function handleNoteContentLoad(e) {
    if (!e.target.matches('img')) return;
    const noteEl = e.target.closest('.sticky-note');
    if (noteEl) fitNoteHeight(noteEl.dataset.id);
}

function handleNoteContentToggle(e) {
    if (!e.target.matches('details')) return;
    const noteEl = e.target.closest('.sticky-note');
    if (noteEl) fitNoteHeight(noteEl.dataset.id);
}

async function moveNotesToCanvasCenter(ids) {
    if (!ids || ids.length === 0) return;

    const noteEls = ids
        .map(id => document.getElementById(`note-${id}`))
        .filter(Boolean);
    if (noteEls.length === 0) return;

    const canvasCenterX = STATE.canvasSize / 2;
    const canvasCenterY = STATE.canvasSize / 2;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    noteEls.forEach(el => {
        const x = parseFloat(el.style.left) || 0;
        const y = parseFloat(el.style.top) || 0;
        const w = el.offsetWidth || 0;
        const h = el.offsetHeight || 0;

        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
    });

    const deltaX = canvasCenterX - ((minX + maxX) / 2);
    const deltaY = canvasCenterY - ((minY + maxY) / 2);

    noteEls.forEach(el => {
        const nextX = Math.round((parseFloat(el.style.left) || 0) + deltaX);
        const nextY = Math.round((parseFloat(el.style.top)  || 0) + deltaY);
        el.style.left = `${nextX}px`;
        el.style.top  = `${nextY}px`;
    });

    const label = noteEls.length > 1 ? `${noteEls.length} notes` : 'Note';
    if (typeof showToast === 'function') showToast(`Moving ${label.toLowerCase()} to center...`, 'info');

    const res = noteEls.length > 1 && typeof syncBatchNotePositions === 'function'
        ? await syncBatchNotePositions(ids)
        : await syncNotePosition(ids[0]);

    if (res && res.success) {
        if (typeof showToast === 'function') showToast(`${label} moved to center`, 'success');
    }
}

/**
 * Clones a note, asks the server to AI-format the clone, and hydrates the result.
 * @param {number|string} id - Source note ID.
 * @param {HTMLElement} button - Triggering button.
 * @returns {Promise<void>}
 */
async function aiFormatNote(id, button) {
    const note = STATE.notes.find(n => n.id == id);
    if (!note || !button || button.disabled) return;

    if (typeof window.showConfirmModal === 'function') {
        window.showConfirmModal({
            title: 'AI Format Clone',
            icon: '✨',
            message: 'Clone this note and ask AI to reformat the clone?',
            subMessage: 'The original note will stay untouched. Add optional instructions below to steer the formatting.',
            confirmText: 'Clone & Format',
            confirmIcon: '✨',
            cancelText: 'Cancel',
            loadingText: 'Formatting...',
            width: 'large',
            autoFocus: true,
            onConfirm: async () => {
                const input = document.getElementById('ai-format-custom-prompt');
                await runAiFormatNote(id, button, input?.value || '');
            }
        });

        const promptContainer = document.getElementById('globalConfirmPromptContainer');
        if (promptContainer) {
            promptContainer.classList.remove('hidden');
            promptContainer.innerHTML = `
                <label class="modal-sub-label" for="ai-format-custom-prompt">Custom AI instructions</label>
                <textarea id="ai-format-custom-prompt"
                          class="create-modal-textarea no-emoji"
                          rows="6"
                          placeholder="Optional: e.g. keep both units in the exact same checklist format, make dates prominent, avoid tables unless the source is already tabular."></textarea>
            `;
            setTimeout(() => document.getElementById('ai-format-custom-prompt')?.focus(), 50);
        }
        return;
    }

    await runAiFormatNote(id, button, '');
}

/**
 * Executes the AI formatting request after confirmation.
 * @param {number|string} id - Source note ID.
 * @param {HTMLElement} button - Triggering button.
 * @param {string} customPrompt - User-provided AI instructions.
 * @returns {Promise<void>}
 */
async function runAiFormatNote(id, button, customPrompt = '') {
    const note = STATE.notes.find(n => n.id == id);
    if (!note || !button || button.disabled) return;
    if (button.dataset.aiFormatLoading === '1') return;

    button.dataset.aiFormatLoading = '1';
    button.disabled = true;
    button.classList.add('pulse-glow');
    const originalText = button.innerHTML;
    button.innerHTML = '...';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
        const res = await NoteAPI.post('/notes/api/notes/ai-format', {
            id,
            custom_prompt: customPrompt
        }, {
            signal: controller.signal,
            silent: true
        });
        clearTimeout(timeoutId);

        if (!res || !res.success) {
            const cloneMsg = res?.clone_id ? ` Clone ${res.clone_id} was retained.` : '';
            const error = res?.error || (controller.signal.aborted
                ? 'AI format start request timed out.'
                : 'AI format failed to start.');
            if (typeof showToast === 'function') showToast(`${error}${cloneMsg}`, 'error');
            return;
        }

        if (typeof showToast === 'function') showToast('AI formatting started. A cloned note will update when ready.', 'success');

        if (typeof window.loadState === 'function') {
            try {
                await window.loadState(false, STATE.canvas_id, res.note_id || null, STATE.activeLayerId);
            } catch (error) {
                console.error('Could not refresh AI formatting placeholder:', error);
            }
        }
    } catch (_) {
        const error = controller.signal.aborted
            ? 'AI format start request timed out.'
            : 'AI format request failed.';
        if (typeof showToast === 'function') showToast(error, 'error');
    } finally {
        clearTimeout(timeoutId);
        delete button.dataset.aiFormatLoading;
        button.disabled = false;
        button.classList.remove('pulse-glow');
        button.innerHTML = originalText;
    }
}

/**
 * Persists the current content of an inline-edited note to the server.
 * Handles UI state transitions and error feedback.
 * @param {number|string} id - The note ID.
 * @param {boolean} [stayInEditMode=false] - Whether to remain in edit mode after saving.
 * @returns {Promise<boolean>} Whether the save completed successfully.
 */
async function saveNoteInline(id, stayInEditMode = false) {
    const el   = document.getElementById(`note-${id}`);
    const note = STATE.notes.find(n => n.id == id);
    if (!el || !note) return false;

    flushActiveClickToEditEditor(el);

    const titleInput = el.querySelector('.inline-title-input');
    const title      = titleInput ? titleInput.value : (note.title || 'Untitled Note');
    
    const textarea = el.querySelector('.note-text-section > textarea[data-action="note-keydown"]');
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
        z_index: window.getNoteZIndex?.(note) || el.style.zIndex,
        is_collapsed: note.is_collapsed,
        is_options_expanded: note.is_options_expanded ?? 0
    };

    let saveCommitted = false;
    try {
        const res = await NoteAPI.post('/notes/api/save', params);
        if (res && res.success) {
            saveCommitted = true;
            // State: Finalize UI before record merge
            if (!stayInEditMode && String(STATE.isEditingNote) === String(id)) {
                // Collaborative Locking: Clear state FIRST to block teardown races
                delete el.dataset.lockHeld;
                STATE.isEditingNote = null;
                
                el.classList.remove('is-editing', 'is-raw-editing');
                if (textarea) textarea.readOnly = true;
                if (getNoteFind().noteId && String(getNoteFind().noteId) === String(id)) closeNoteFindBar(false);
                
                const btnIcon = el.querySelector('.btn-icon-edit');
                if (btnIcon) {
                    btnIcon.innerHTML = '✏️';
                    btnIcon.title     = 'Edit Content';
                    btnIcon.classList.remove('pulse-glow');
                }

                const unlockRes = await NoteAPI.unlock(id);
                if (!unlockRes || !unlockRes.success) {
                    console.warn('[NoteAPI] Post-save unlock failed for note', id, unlockRes?.error);
                    // Schedule a retry to prevent the collaborative lock from being permanently stuck
                    setTimeout(async () => {
                        try { await NoteAPI.unlock(id); } catch (_) {}
                    }, 3000);
                }
            }

            if (res.notes && typeof window.mergeNoteState === 'function') {
                window.mergeNoteState(res.notes, id);
            } else if (res.notes) {
                STATE.notes = res.notes;
            }
            STATE.last_mutation = res.last_mutation;

            // Targeted DOM Update: Refresh viewer and title without board re-render
            const viewer = el.querySelector('.note-text-viewer');
            const slot   = el.querySelector('.note-title-slot');
            const updatedNote = STATE.notes.find(n => n.id == id) || { ...note, title, content, color };
            const displayTitle = (typeof window.displayNoteTitle === 'function')
                ? window.displayNoteTitle(updatedNote)
                : (title || 'Untitled Note');
            if (viewer) viewer.innerHTML = formatNoteContent(content, id);
            if (typeof fitNoteHeight === 'function') fitNoteHeight(id);
            if (slot) {
                const isDashboardNote = el.classList.contains('is-dashboard-note');
                if (isDashboardNote && typeof NoteParser !== 'undefined') {
                    slot.innerHTML = NoteParser.renderHeader(displayTitle) || window.escapeHtml(displayTitle);
                } else {
                    slot.textContent = displayTitle;
                }
                slot.dataset.renderedTitle = `${isDashboardNote && typeof NoteParser !== 'undefined' ? 'dashboard' : 'plain'}::${window.escapeHtml(`${updatedNote.title || ''}::${displayTitle}`)}`;
            }
            if (typeof window.isFenceNote === 'function') {
                el.classList.toggle('is-fence-note', window.isFenceNote(updatedNote));
            }
            if (typeof window.getNoteZIndex === 'function') {
                el.style.zIndex = window.getNoteZIndex(updatedNote);
            }

            // Per-Blob Rename: Fire individual rename calls for any changed attachment names
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
            
            // Backlinks sidebar must reflect the current link graph after every save
            const sidebar = document.getElementById('backlinks-sidebar');
            if (sidebar && !sidebar.classList.contains('hidden') && sidebar.dataset.noteId) {
                const sidebarNoteId = sidebar.dataset.noteId;
                const sidebarMeta   = STATE.note_map?.[sidebarNoteId];
                const sidebarTitle  = sidebarMeta?.title || 'Note';
                if (typeof loadBacklinks === 'function') {
                    delete sidebar.dataset.noteId; // force re-fetch even for same note
                    loadBacklinks(sidebarNoteId, sidebarTitle);
                }
            }

            refreshEmbedsOf(id, title, content);

            showToast('Note Saved', 'success');
            return true;
        }
        showToast(res?.error || 'Failed to save note', 'error');
        return false;
    } catch (error) {
        console.error('[Notes] Inline save failed:', error);
        if (saveCommitted) {
            showToast('Note saved, but some follow-up updates failed', 'warning');
            return true;
        }
        showToast('Failed to save note', 'error');
        return false;
    } finally {
        el.classList.remove('pending');
        if (typeof window.removeActiveSync === 'function') window.removeActiveSync(id);
    }
}

/**
 * Re-renders any note on the current canvas that embeds the just-saved note.
 * Also updates embed_cache so cross-canvas embedders reflect the new content.
 * @param {number|string} savedId      - ID of the note that was saved.
 * @param {string}        savedTitle   - Title of the saved note.
 * @param {string}        savedContent - New content of the saved note.
 */
function refreshEmbedsOf(savedId, savedTitle, savedContent) {
    const idStr    = String(savedId);
    const titleLow = (savedTitle || '').toLowerCase();

    if (STATE.embed_cache && STATE.embed_cache[idStr]) {
        STATE.embed_cache[idStr] = Object.assign({}, STATE.embed_cache[idStr], { content: savedContent });
    }

    (STATE.notes || []).forEach(note => {
        if (String(note.id) === idStr) return;
        const content    = note.content || '';
        const contentLow = content.toLowerCase();

        const hasEmbed = content.includes(`[embed:${savedId}]`)
            || (titleLow && contentLow.includes(`[embed:${titleLow}]`));
        if (!hasEmbed) return;

        const noteEl = document.getElementById(`note-${note.id}`);
        if (!noteEl) return;
        const viewer = noteEl.querySelector('.note-text-viewer');
        if (!viewer) return;

        viewer.innerHTML = formatNoteContent(content, note.id);
        if (typeof fitNoteHeight === 'function') fitNoteHeight(note.id);
        noteEl.dataset.lastContent = content;
    });
}

/**
 * Real-time Accent Color Synchronization.
 * Updates the note's visual identity instantly and persists the change to the backend.
 *
 * Persistence Route: /notes/api/geometry (Surgical update).
 * Timer Isolation: el._colorSaveTimer is scoped to the DOM node, completely
 * independent of POSITION_SYNC_TIMERS. A concurrent drag/drop that resets the
 * position debounce cannot cancel a pending color save.
 *
 * @param {HTMLInputElement} input - The color picker element.
 * @param {number|string} id - The note ID.
 */
function updateNoteAccent(input, id) {
    const el   = document.getElementById(`note-${id}`);
    const note = STATE.notes.find(n => n.id == id);
    if (!el || !note) return;

    const color     = input.value;
    // Only snapshot the rollback baseline on the first event of a rapid sequence.
    // Subsequent calls must not overwrite it with an already-mutated optimistic value.
    // Snapshot rollback base when no timer is pending AND no request is in-flight.
    // When in-flight, note.color is already the optimistic value; the correct
    // rollback base is the last value we successfully committed (stored separately)
    // or the current note.color if no commit has occurred yet in this session.
    if (!el._colorSaveTimer && !el._colorSaveInflight) {
        el._colorRollbackBase = note.color;
    } else if (el._colorSaveInflight && el._colorRollbackBase === null) {
        // In-flight completed and nulled the base before this new interaction;
        // re-anchor to current state value which reflects last confirmed save.
        el._colorRollbackBase = note.color;
    }
    const prevColor = el._colorRollbackBase;
    const normalize = window.normalizeColorHex || (c => c);

    // Optimistic UI: immediate visual feedback regardless of network state
    el.style.setProperty('--note-accent', normalize(color));
    note.color = color;
    if (STATE.note_map[id]) STATE.note_map[id].color = color;

    // Debounce: color picker fires 'input' on every pointer pixel during drag.
    // 800ms window collapses rapid-fire events into a single API call.
    // el._colorSaveTimer is node-scoped — safe from syncNotePosition timer resets.
    
    // Atomic Lock Acquisition: Ensure the note is protected from heartbeats while the user is still 'jittering'
    if (!el._colorSaveTimer && !el._colorSaveInflight && typeof window.addActiveSync === 'function') {
        window.addActiveSync(String(id));
    }

    clearTimeout(el._colorSaveTimer);
    el._colorSaveTimer = setTimeout(async () => {
        el._colorSaveTimer = null;
        el._colorSaveInflight = true;
        const sid = String(id);
        try {
            // Re-capture fresh DOM coordinates at the moment the timer fires to prevent 
            // coordinate revert if the user moved the note while the color timer was pending.
            const res = await NoteAPI.post('/notes/api/geometry', {
                id:           id,
                canvas_id:    STATE.canvas_id,
                x:            el.style.left ? parseInt(el.style.left) : note.x,
                y:            el.style.top  ? parseInt(el.style.top)  : note.y,
                width:        note.is_collapsed ? (note.width  || el.offsetWidth)  : el.offsetWidth,
                height:       note.is_collapsed ? (note.height || el.offsetHeight) : el.offsetHeight,
                z_index:      window.getNoteZIndex?.(note) || el.style.zIndex,
                layer_id:     note.layer_id || STATE.activeLayerId,
                is_collapsed: note.is_collapsed,
                is_options_expanded: note.is_options_expanded ?? 0,
                color:        note.color
            });

            if (res && res.success) {
                // /notes/api/geometry does not return res.notes; optimistic STATE is authoritative.
                if (res.last_mutation && (!STATE.last_mutation || res.last_mutation > STATE.last_mutation)) {
                    STATE.last_mutation = res.last_mutation;
                }
            } else {
                throw new Error(res?.error || 'Color save failed');
            }
        } catch (err) {
            // Hard rollback: revert DOM and STATE to last confirmed server color
            const rollback = typeof prevColor === 'string' ? prevColor : '#d4b896';
            el.style.setProperty('--note-accent', normalize(rollback));
            note.color = rollback;
            if (STATE.note_map[id]) STATE.note_map[id].color = rollback;
            if (input && input.value !== rollback) input.value = rollback;
            showToast('Color could not be saved', 'error');
        } finally {
            el._colorSaveInflight = false;
            el._colorRollbackBase = null;
            // Mirror syncNotePosition pattern (api.js:315-317):
            // Only release the guard if no new timer was queued while this request
            // was in-flight. el._colorSaveTimer is null here only when no subsequent
            // updateNoteAccent call re-armed it during the await.
            if (!el._colorSaveTimer && typeof window.removeActiveSync === 'function') {
                window.removeActiveSync(sid);
            }
        }
    }, 800);
}
window.updateNoteAccent = updateNoteAccent;

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

    const prevCollapsed = note.is_collapsed;

    // Optimistic UI: Immediate visual transition
    note.is_collapsed = note.is_collapsed ? 0 : 1;
    
    // Single Source of Truth: Sync the global map to prevent save-regression
    if (STATE.note_map && STATE.note_map[id]) {
        STATE.note_map[id].is_collapsed = note.is_collapsed;
    }

    el.classList.toggle('collapsed', !!note.is_collapsed);
    if (!note.is_collapsed && typeof fitNoteHeight === 'function') fitNoteHeight(id);

    el.classList.add('pending');
    
    const colorInput = el.querySelector('.inline-color-input');
    try {
        const res = await NoteAPI.post('/notes/api/geometry', {
            id:           id,
            canvas_id:    STATE.canvas_id,
            is_collapsed: note.is_collapsed,
            x:            note.x,
            y:            note.y,
            width:        note.width,
            height:       note.height,
            z_index:      window.getNoteZIndex?.(note) || note.z_index,
            layer_id:     note.layer_id || 1,
            is_options_expanded: note.is_options_expanded ?? 0,
            color:        colorInput ? colorInput.value : note.color
        });
        
        if (res && res.success) {
            if (res.notes && typeof window.mergeNoteState === 'function') {
                window.mergeNoteState(res.notes);
            } else if (res.notes) {
                STATE.notes = res.notes;
            }
            STATE.last_mutation = res.last_mutation;
        } else if (res) {
            // Rollback optimistic mutation on confirmed server failure
            note.is_collapsed = prevCollapsed;
            if (STATE.note_map && STATE.note_map[id]) {
                STATE.note_map[id].is_collapsed = prevCollapsed;
            }
            el.classList.toggle('collapsed', !!prevCollapsed);
            const collapseBtn = el.querySelector('.btn-icon-collapse');
            if (collapseBtn) collapseBtn.innerHTML = prevCollapsed ? '🔻' : '🔺';
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
        const el = document.getElementById(`note-${id}`);
        toggleInlineEdit(btn, id, false, !!el?.classList.contains('is-raw-editing'));
    }
}

/**
 * Flushes any active click-to-edit inline editor (line or block) by blurring it.
 * @param {HTMLElement} el - The note element.
 * @returns {boolean} True if an active editor was found and blurred.
 */
function flushActiveClickToEditEditor(el) {
    const activeEditor = el?.querySelector('.note-line-editor, .note-block-editor');
    if (!activeEditor) return false;
    activeEditor.blur();
    return true;
}

/**
 * Configures the note's editing surface between click-to-edit and raw textarea modes.
 * Toggles the .is-raw-editing class, manages the edit ribbon visibility, sets the
 * textarea value/readOnly state, and wires up auto-height adaptation for raw mode.
 * @param {HTMLElement} el - The note element.
 * @param {Object} note - The note data object.
 * @param {HTMLTextAreaElement|null} textarea - The note's textarea element.
 * @param {boolean} useRawEditor - Whether to switch to raw textarea mode.
 */
function configureNoteTextEditMode(el, note, textarea, useRawEditor) {
    const wasRawEditor = el.classList.contains('is-raw-editing');

    if (!useRawEditor && wasRawEditor && textarea && !textarea.readOnly) {
        note.content = textarea.value;
        if (STATE.note_map && STATE.note_map[note.id]) {
            STATE.note_map[note.id].content = note.content;
        }
        refreshClickToEditViewer(note.id, note);
    }

    if (useRawEditor) {
        flushActiveClickToEditEditor(el);
    }

    el.classList.toggle('is-raw-editing', !!useRawEditor);

    const ribbon = document.getElementById('notes-edit-ribbon');
    if (!textarea) {
        if (ribbon && !useRawEditor) {
            _ribbonTextarea = null;
            ribbon.classList.remove('show');
        }
        return;
    }

    textarea.value = note.content || '';
    textarea.readOnly = !useRawEditor;

    if (ribbon) {
        _ribbonTextarea = useRawEditor ? textarea : null;
        ribbon.classList.toggle('show', !!useRawEditor);
    }

    if (textarea._adaptNoteHeight) {
        textarea.removeEventListener('input', textarea._adaptNoteHeight);
        textarea._adaptNoteHeight = null;
    }

    if (useRawEditor) {
        textarea._adaptNoteHeight = function() {
            var _id = note.id;
            requestAnimationFrame(function() {
                if (typeof fitNoteHeight === 'function') fitNoteHeight(_id);
            });
        };
        textarea.addEventListener('input', textarea._adaptNoteHeight);
        textarea._adaptNoteHeight();
        try {
            textarea.focus({ preventScroll: true });
        } catch (_) {
            textarea.focus();
        }
    }
    updateEditModeIndicators(note.id);
}

/**
 * Transitions a note between 'display' and 'edit' modes.
 * Handles collaborative lock acquisition, collapsed note expansion, content snapshot
 * for abort, click-to-edit initialization, and mode switching between click-to-edit
 * and raw textarea editors. On exit, saves or aborts based on the isAbort flag.
 * @param {HTMLElement} btn - The trigger button.
 * @param {number|string} id - The note ID.
 * @param {boolean} isAbort - Optional flag to revert changes without saving.
 * @param {boolean} useRawEditor - Optional flag to use the full raw textarea editor.
 */
async function toggleInlineEdit(btn, id, isAbort = false, useRawEditor = false) {
    const el   = document.getElementById(`note-${id}`);
    const note = STATE.notes.find(n => n.id == id);
    if (!el || !note) return;

    const textarea  = el.querySelector('.note-text-section > textarea[data-action="note-keydown"]');
    
    let lockAcquired = false;

    // Collaborative Locking: Prevention & Acquisition
    // Re-check class synchronously after the await to prevent double-entry
    // from concurrent calls that both passed the initial guard.
    if (!el.classList.contains('is-editing')) {
        // Guard: Prevent any concurrent invocation from proceeding while lock is in-flight or held
        if (el.dataset.lockPending === 'true' || el.dataset.lockHeld === 'true') return;
        el.dataset.lockPending = 'true';
        
        let lockRes;
        try {
            lockRes = await NoteAPI.lock(id);
        } finally {
            delete el.dataset.lockPending;
        }

        if (!lockRes || !lockRes.success) return;

        // Re-check: another concurrent call may have entered edit mode while we awaited
        if (el.classList.contains('is-editing')) {
            await NoteAPI.unlock(id);
            return;
        }

        el.dataset.lockHeld = 'true';
        lockAcquired = true;
    } else {
        // Only allow toggle-off if a lock is actually held by this session
        if (!el.dataset.lockHeld) return;
    }

    // Visual geometry restoration for accurate dimension calculation.
    if (!el.classList.contains('is-editing') && note.is_collapsed) {
        el.dataset.wasCollapsed = 'true'; // Preserve initial collapsed state for restoration.
        const collapsedBefore = note.is_collapsed;
        try {
            await toggleCollapse(id);
        } catch (e) {
            // Roll back the optimistic collapse-state mutation that toggleCollapse applied
            // before its API call failed, so memory and DOM are consistent with the server.
            note.is_collapsed = collapsedBefore;
            el.classList.toggle('collapsed', !!collapsedBefore);
            const btn = el.querySelector('.btn-icon-collapse');
            if (btn) btn.innerHTML = collapsedBefore ? '🔻' : '🔺';
            if (lockAcquired) await NoteAPI.unlock(id);
            return;
        }
    }

    if (el.classList.contains('is-editing') && !isAbort) {
        const isRawEditor = el.classList.contains('is-raw-editing');
        if (isRawEditor !== !!useRawEditor) {
            configureNoteTextEditMode(el, note, textarea, useRawEditor);
            return;
        }
    }

    if (el.classList.contains('is-editing') && !isAbort) {
        flushActiveClickToEditEditor(el);
    }

    const actionsRail = el.querySelector('.note-actions-rail');
    const suppressRailCollapse = el.classList.contains('is-editing')
        && actionsRail
        && !actionsRail.classList.contains('expanded');
    if (suppressRailCollapse) actionsRail.classList.add('suppress-collapse-transition');

    const isEditing = el.classList.toggle('is-editing');

    if (!isEditing && suppressRailCollapse) {
        void actionsRail.offsetWidth;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => actionsRail.classList.remove('suppress-collapse-transition'));
        });
    }

    if (isEditing) {
        // UI Logic: Unified termination reset
        STATE.isEditingNote  = id;

        // Snapshot original content so Abort can discard local click-to-edit commits.
        el.dataset.originalContent = note.content || '';
        if (STATE.note_map && STATE.note_map[id]) {
            el.dataset.originalMapContent = STATE.note_map[id].content || '';
        }
        el._editFieldSnapshot = {
            title: el.querySelector('.inline-title-input')?.value || note.title || '',
            color: el.querySelector('.inline-color-input')?.value || note.color || '',
            filenames: Array.from(el.querySelectorAll('.file-name-display')).map(display => display.textContent)
        };

        if (typeof initClickToEdit === 'function') {
            initClickToEdit(el, id);
        }
        
        btn.innerHTML = '💾';
        btn.title     = 'Save';
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
            configureNoteTextEditMode(el, note, textarea, useRawEditor);
        }
    } else {
        // Mode Termination: Atomic Persistence
        if (getNoteFind().noteId && String(getNoteFind().noteId) === String(id)) closeNoteFindBar(false);
        if (isAbort) {
            delete el.dataset.lockHeld;
            // UI State: Restore content from local state
            const txtArea = el.querySelector('.note-text-section > textarea[data-action="note-keydown"]');
            if (note && el.dataset.originalContent !== undefined) {
                note.content = el.dataset.originalContent;
                if (STATE.note_map && STATE.note_map[id]) {
                    STATE.note_map[id].content = el.dataset.originalMapContent !== undefined
                        ? el.dataset.originalMapContent
                        : note.content;
                }
                delete el.dataset.originalContent;
                delete el.dataset.originalMapContent;
            }
            if (txtArea && note) txtArea.value = note.content || '';
            const viewer = el.querySelector('.note-text-viewer');
            if (viewer && note) viewer.innerHTML = formatNoteContent(note.content || '', id);
            if (typeof fitNoteHeight === 'function') fitNoteHeight(id);
            el.dataset.lastContent = note.content || '';

            const fieldSnapshot = el._editFieldSnapshot;
            if (fieldSnapshot) {
                const titleInput = el.querySelector('.inline-title-input');
                if (titleInput) titleInput.value = fieldSnapshot.title;
                note.title = fieldSnapshot.title;
                if (STATE.note_map && STATE.note_map[id]) STATE.note_map[id].title = fieldSnapshot.title;

                el.querySelectorAll('.file-name-display').forEach((display, index) => {
                    if (fieldSnapshot.filenames[index] !== undefined) {
                        display.textContent = fieldSnapshot.filenames[index];
                    }
                });

                const colorInput = el.querySelector('.inline-color-input');
                if (colorInput && fieldSnapshot.color && colorInput.value !== fieldSnapshot.color) {
                    colorInput.value = fieldSnapshot.color;
                    updateNoteAccent(colorInput, id);
                }
                delete el._editFieldSnapshot;
            }
            
            STATE.isEditingNote = null;
        } else if (typeof saveNoteInline === 'function') {
            // Sequential Lifecycle: Await the save to ensure lock release doesn't race
            const saved = await saveNoteInline(id);
            if (!saved) {
                el.classList.add('is-editing');
                updateEditModeIndicators(id);
                return;
            }
            delete el.dataset.originalContent;
            delete el.dataset.originalMapContent;
            delete el._editFieldSnapshot;
        }

        // Restore initial collapsed state if editing began in a collapsed view.
        if (el.dataset.wasCollapsed === 'true') {
            delete el.dataset.wasCollapsed;
            await toggleCollapse(id);
        }

        // UI Logic: Unified termination reset
        const txtArea = el.querySelector('.note-text-section > textarea[data-action="note-keydown"]');
        if (txtArea) txtArea.readOnly = true;
        el.classList.remove('is-raw-editing');
        
        btn.innerHTML = '✏️';
        btn.title     = 'Edit Content';
        btn.classList.remove('pulse-glow');

        // Deactivate the formatting ribbon
        const ribbon = document.getElementById('notes-edit-ribbon');
        if (ribbon) {
            _ribbonTextarea = null;
            ribbon.classList.remove('show');
        }

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
    updateEditModeIndicators(id);
}

/**
 * Find and Replace Interface for Inline Editor.
 * Provides real-time highlighting and atomic replacement within active note textareas.
 */

/**
 * Retrieves or initializes the Find/Replace state object within global STATE.
 * @returns {Object} The Note Find state object.
 */
function getNoteFind() {
    if (!STATE.noteFind) {
        STATE.noteFind = {
            noteId: null,
            textarea: null,
            bar: null,
            findInput: null,
            replaceInput: null,
            countEl: null,
            highlightLayer: null,
            highlightContent: null,
            onTextareaInput: null,
            onTextareaScroll: null,
            matches: [],
            index: -1
        };
    }
    return STATE.noteFind;
}

/**
 * Closes the Find/Replace bar and cleans up UI layers and event listeners.
 * @param {boolean} [focusTextarea=true] - Whether to return focus to the textarea.
 * @returns {void}
 */
function closeNoteFindBar(focusTextarea = true) {
    const textarea = getNoteFind().textarea;
    if (getNoteFind().bar) getNoteFind().bar.remove();
    if (textarea && getNoteFind().onTextareaInput) textarea.removeEventListener('input', getNoteFind().onTextareaInput);
    if (textarea && getNoteFind().onTextareaScroll) textarea.removeEventListener('scroll', getNoteFind().onTextareaScroll);
    if (getNoteFind().highlightLayer) getNoteFind().highlightLayer.remove();
    getNoteFind().noteId = null;
    getNoteFind().textarea = null;
    getNoteFind().bar = null;
    getNoteFind().findInput = null;
    getNoteFind().replaceInput = null;
    getNoteFind().countEl = null;
    getNoteFind().highlightLayer = null;
    getNoteFind().highlightContent = null;
    getNoteFind().onTextareaInput = null;
    getNoteFind().onTextareaScroll = null;
    getNoteFind().matches = [];
    getNoteFind().index = -1;
    if (focusTextarea && textarea && !textarea.readOnly) textarea.focus({ preventScroll: true });
}

/**
 * Updates the match counter display in the Find/Replace bar.
 * @returns {void}
 */
function updateNoteFindCount() {
    if (!getNoteFind().countEl) return;
    getNoteFind().countEl.textContent = getNoteFind().matches.length
        ? `${getNoteFind().index + 1} / ${getNoteFind().matches.length}`
        : '0 / 0';
}

/**
 * Scans the current textarea for all occurrences of the query.
 * @param {string} query - The text to search for.
 * @returns {Array<Object>} List of match objects containing start and end indices.
 */
function collectNoteFindMatches(query) {
    const textarea = getNoteFind().textarea;
    if (!textarea || !query) return [];

    const haystack = textarea.value.toLowerCase();
    const needle = query.toLowerCase();
    const matches = [];
    let pos = 0;

    while ((pos = haystack.indexOf(needle, pos)) !== -1) {
        matches.push({ start: pos, end: pos + query.length });
        pos += Math.max(needle.length, 1);
    }

    return matches;
}

/**
 * Escapes HTML special characters in a string for safe DOM injection.
 * @param {string} value - The raw string to escape.
 * @returns {string} The HTML-safe string.
 */
function escapeNoteFindHtml(value) {
    return (window.escapeHtml ? window.escapeHtml(value) : String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;'));
}

/**
 * Synchronizes the highlight layer scroll position with the textarea.
 * @returns {void}
 */
function syncNoteFindHighlightScroll() {
    if (getNoteFind().highlightLayer && getNoteFind().highlightContent && getNoteFind().textarea) {
        getNoteFind().highlightContent.style.transform =
            `translate(${-getNoteFind().textarea.scrollLeft}px, ${-getNoteFind().textarea.scrollTop}px)`;
    }
}

/**
 * Renders the search highlights as a background layer behind the textarea.
 * @returns {void}
 */
function renderNoteFindHighlights() {
    const textarea = getNoteFind().textarea;
    const content = getNoteFind().highlightContent;
    if (!textarea || !content) return;

    if (!getNoteFind().matches.length) {
        content.textContent = '';
        return;
    }

    let html = '';
    let cursor = 0;
    getNoteFind().matches.forEach((match, idx) => {
        html += escapeNoteFindHtml(textarea.value.substring(cursor, match.start));
        const active = idx === getNoteFind().index ? ' is-active' : '';
        html += `<mark class="note-find-highlight${active}">${escapeNoteFindHtml(textarea.value.substring(match.start, match.end))}</mark>`;
        cursor = match.end;
    });
    html += escapeNoteFindHtml(textarea.value.substring(cursor));
    content.innerHTML = html;
    content.style.width = `${textarea.scrollWidth}px`;
    content.style.minHeight = `${textarea.scrollHeight}px`;
    syncNoteFindHighlightScroll();
}

/**
 * Ensures the highlight layer exists and is correctly layered behind the target textarea.
 * @param {HTMLTextAreaElement} textarea - The target textarea element.
 * @returns {void}
 */
function ensureNoteFindHighlightLayer(textarea) {
    const host = textarea?.parentElement;
    if (!host) return;

    if (!getNoteFind().highlightLayer || getNoteFind().highlightLayer.parentElement !== host) {
        if (getNoteFind().highlightLayer) getNoteFind().highlightLayer.remove();

        const layer = document.createElement('div');
        layer.className = 'note-find-highlight-layer';
        layer.innerHTML = '<div class="note-find-highlight-content"></div>';
        host.insertBefore(layer, textarea);
        getNoteFind().highlightLayer = layer;
        getNoteFind().highlightContent = layer.firstElementChild;
    }

    if (!getNoteFind().onTextareaScroll) {
        getNoteFind().onTextareaScroll = syncNoteFindHighlightScroll;
        textarea.addEventListener('scroll', getNoteFind().onTextareaScroll);
    }

    if (!getNoteFind().onTextareaInput) {
        getNoteFind().onTextareaInput = () => refreshNoteFindMatches(textarea.selectionStart);
        textarea.addEventListener('input', getNoteFind().onTextareaInput);
    }
}

/**
 * Scrolls the textarea and the canvas to reveal a specific match.
 * @param {HTMLTextAreaElement} textarea - The target textarea.
 * @param {Object} match - The match object to reveal.
 * @returns {void}
 */
function scrollNoteFindTextareaToMatch(textarea, match) {
    const host = textarea?.parentElement;
    if (!host || !match) return;

    const measure = document.createElement('div');
    const marker = document.createElement('span');
    measure.className = 'note-find-measure';
    marker.className = 'note-find-measure-marker';
    marker.textContent = textarea.value.charAt(match.start) || '\u200b';
    measure.textContent = textarea.value.substring(0, match.start);
    measure.appendChild(marker);
    host.appendChild(measure);

    const targetTop = marker.offsetTop - (textarea.clientHeight * 0.35);
    textarea.scrollTop = Math.max(0, targetTop);

    const wrapper = STATE.wrapperEl || document.getElementById('canvas-wrapper');
    if (wrapper) {
        const scale = (typeof STATE !== 'undefined' && STATE.scale) || 1;
        const textareaRect = textarea.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();
        const matchY = textareaRect.top + ((marker.offsetTop - textarea.scrollTop) * scale);
        const targetY = wrapperRect.top + (wrapper.clientHeight * 0.42);
        const deltaY = matchY - targetY;

        if (Math.abs(deltaY) > 24) {
            wrapper.scrollBy({ top: deltaY, behavior: 'auto' });
        }
    }

    measure.remove();
}

/**
 * Triggers a visual pulse animation on the textarea to indicate selection.
 * @param {HTMLTextAreaElement} textarea - The target textarea.
 * @returns {void}
 */
function pulseNoteFindSelection(textarea) {
    textarea.classList.remove('note-find-selection-pulse');
    void textarea.offsetWidth;
    textarea.classList.add('note-find-selection-pulse');
}

/**
 * Selects a match by index, updating UI and scrolling into view.
 * @param {number} index - The index of the match to select.
 * @param {boolean} [keepFindFocus=true] - Whether to maintain focus on the find input.
 * @returns {void}
 */
function selectNoteFindMatch(index, keepFindFocus = true) {
    const textarea = getNoteFind().textarea;
    if (!textarea || !getNoteFind().matches.length) {
        getNoteFind().index = -1;
        updateNoteFindCount();
        return;
    }

    getNoteFind().index = (index + getNoteFind().matches.length) % getNoteFind().matches.length;
    const match = getNoteFind().matches[getNoteFind().index];
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(match.start, match.end);
    scrollNoteFindTextareaToMatch(textarea, match);
    textarea.setSelectionRange(match.start, match.end);
    pulseNoteFindSelection(textarea);
    renderNoteFindHighlights();
    if (keepFindFocus && getNoteFind().findInput) getNoteFind().findInput.focus({ preventScroll: true });
    updateNoteFindCount();
}

/**
 * Re-scans the text and updates the selection based on an optional anchor position.
 * @param {number|null} [anchor=null] - Optional character index to start the search from.
 * @param {boolean} [keepFindFocus=true] - Whether to maintain focus on the find input.
 * @returns {void}
 */
function refreshNoteFindMatches(anchor = null, keepFindFocus = true) {
    const query = getNoteFind().findInput ? getNoteFind().findInput.value : '';
    getNoteFind().matches = collectNoteFindMatches(query);

    if (!getNoteFind().matches.length) {
        getNoteFind().index = -1;
        updateNoteFindCount();
        renderNoteFindHighlights();
        return;
    }

    const startAt = anchor ?? getNoteFind().textarea.selectionStart ?? 0;
    const nextIdx = getNoteFind().matches.findIndex(m => m.start >= startAt);
    selectNoteFindMatch(nextIdx === -1 ? 0 : nextIdx, keepFindFocus);
}

/**
 * Replaces the currently selected match with the replacement text.
 * @returns {void}
 */
function replaceCurrentNoteFindMatch() {
    if (!getNoteFind().textarea || !getNoteFind().matches.length || getNoteFind().index < 0) return;

    const textarea = getNoteFind().textarea;
    const match = getNoteFind().matches[getNoteFind().index];
    const replacement = getNoteFind().replaceInput ? getNoteFind().replaceInput.value : '';
    textarea.value = textarea.value.substring(0, match.start)
        + replacement
        + textarea.value.substring(match.end);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    refreshNoteFindMatches(match.start + replacement.length, true);
}

/**
 * Replaces all occurrences of the search query with replacement text.
 * @returns {void}
 */
function replaceAllNoteFindMatches() {
    const textarea = getNoteFind().textarea;
    const query = getNoteFind().findInput ? getNoteFind().findInput.value : '';
    if (!textarea || !query) return;

    const replacement = getNoteFind().replaceInput ? getNoteFind().replaceInput.value : '';
    const original = textarea.value;
    const lowerOriginal = original.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let cursor = 0;
    let count = 0;
    let output = '';
    let pos;

    while ((pos = lowerOriginal.indexOf(lowerQuery, cursor)) !== -1) {
        output += original.substring(cursor, pos) + replacement;
        cursor = pos + query.length;
        count++;
    }

    if (!count) return;

    textarea.value = output + original.substring(cursor);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    refreshNoteFindMatches(0, true);
    if (typeof showToast === 'function') showToast(`Replaced ${count} match${count === 1 ? '' : 'es'}`, 'success');
}

/**
 * Initializes and displays the Find/Replace bar for a specific note.
 * @param {number|string} id - The note ID.
 * @param {HTMLTextAreaElement} textarea - The target textarea.
 * @returns {void}
 */
function openNoteFindBar(id, textarea) {
    if (!textarea || textarea.readOnly) return;

    if (getNoteFind().bar && String(getNoteFind().noteId) !== String(id)) {
        closeNoteFindBar(false);
    }

    getNoteFind().noteId = id;
    getNoteFind().textarea = textarea;
    ensureNoteFindHighlightLayer(textarea);

    if (!getNoteFind().bar) {
        const bar = document.createElement('div');
        bar.className = 'note-find-bar';
        bar.innerHTML = `
            <div class="note-find-row">
                <span class="note-find-icon">🔎</span>
                <input type="text" class="note-find-input" placeholder="Find..." autocomplete="off">
                <span class="note-find-count">0 / 0</span>
                <button type="button" class="note-find-btn" data-action="note-find-next" title="Next match">↓</button>
                <button type="button" class="note-find-btn" data-action="note-find-prev" title="Previous match">↑</button>
                <button type="button" class="note-find-btn" data-action="note-find-close" title="Close">×</button>
            </div>
            <div class="note-find-row">
                <span class="note-find-icon">↳</span>
                <input type="text" class="note-find-replace-input" placeholder="Replace..." autocomplete="off">
                <button type="button" class="note-find-replace-btn" data-action="note-find-replace">Replace</button>
                <button type="button" class="note-find-replace-btn" data-action="note-find-replace-all" title="Replace all">All</button>
            </div>
        `;

        getNoteFind().bar = bar;
        getNoteFind().findInput = bar.querySelector('.note-find-input');
        getNoteFind().replaceInput = bar.querySelector('.note-find-replace-input');
        getNoteFind().countEl = bar.querySelector('.note-find-count');

        bar.addEventListener('keydown', (ev) => {
            ev.stopPropagation();
            const key = ev.key.toLowerCase();
            const commandKey = ev.ctrlKey || ev.metaKey;
            if (key === 'escape') {
                ev.preventDefault();
                closeNoteFindBar(true);
                return;
            }
            if (commandKey && key === 'f') {
                ev.preventDefault();
                getNoteFind().findInput?.focus({ preventScroll: true });
                getNoteFind().findInput?.select();
                return;
            }
            if (ev.key === 'Enter' && ev.target === getNoteFind().findInput) {
                ev.preventDefault();
                selectNoteFindMatch(getNoteFind().index + (ev.shiftKey ? -1 : 1), true);
            } else if (ev.key === 'Enter' && ev.target === getNoteFind().replaceInput) {
                ev.preventDefault();
                replaceCurrentNoteFindMatch();
            }
        });

        getNoteFind().findInput.addEventListener('input', () => refreshNoteFindMatches());
        bar.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const action = ev.target.closest('[data-action]')?.dataset.action;
            if (!action) return;
            if (action === 'note-find-next') selectNoteFindMatch(getNoteFind().index + 1, true);
            else if (action === 'note-find-prev') selectNoteFindMatch(getNoteFind().index - 1, true);
            else if (action === 'note-find-replace') replaceCurrentNoteFindMatch();
            else if (action === 'note-find-replace-all') replaceAllNoteFindMatches();
            else if (action === 'note-find-close') closeNoteFindBar(true);
        });

        document.body.appendChild(bar);
    }

    const selected = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
    if (selected && !selected.includes('\n')) getNoteFind().findInput.value = selected;
    getNoteFind().findInput.focus({ preventScroll: true });
    getNoteFind().findInput.select();
    refreshNoteFindMatches(textarea.selectionStart);
}

/**
 * Keyboard interface for the note textarea and inline editor.
 * Handles Ctrl+Enter (save & close), Ctrl+S (save, stay in editor),
 * Ctrl+E (toggle edit mode / switch between click-to-edit and raw),
 * Ctrl+Shift+E (switch to raw editor), Ctrl+F (open find bar),
 * Escape (close find bar or abort editing), and Ctrl+Backspace (delete line).
 * @param {KeyboardEvent} e - The keydown event.
 * @param {number|string} id - The note ID.
 */
async function handleNoteKeydown(e, id) {
    const key = e.key.toLowerCase();
    const commandKey = e.ctrlKey || e.metaKey;

    if (commandKey && key === 'f') {
        const textarea = e.target.closest('textarea[data-action="note-keydown"]');
        const el = document.getElementById(`note-${id}`);
        if (textarea && el && el.classList.contains('is-editing') && !textarea.readOnly) {
            e.preventDefault();
            e.stopPropagation();
            openNoteFindBar(id, textarea);
            return;
        }
    }

    // Ctrl + Enter: Instant Save & Close
    if (e.ctrlKey && e.key === 'Enter') {
        const el = document.getElementById(`note-${id}`);
        const btn = el?.querySelector('.btn-icon-edit');
        if (btn && el?.classList.contains('is-editing')) {
            e.preventDefault();
            e.stopPropagation();
            await toggleInlineEdit(btn, id, false, el.classList.contains('is-raw-editing'));
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
    // Ctrl + Shift + E: Toggle raw edit mode
    else if (e.ctrlKey && e.shiftKey && key === 'e') {
        const btn = document.querySelector(`#note-${id} .btn-icon-edit`);
        if (btn && document.getElementById(`note-${id}`).classList.contains('is-editing')) {
            e.preventDefault();
            e.stopPropagation();
            await toggleInlineEdit(btn, id, false, true);
        }
    }
    // Ctrl + E: Toggle between edit modes, or exit if already in click-to-edit
    else if (e.ctrlKey && key === 'e') {
        const el = document.getElementById(`note-${id}`);
        const btn = el?.querySelector('.btn-icon-edit');
        if (btn && el?.classList.contains('is-editing')) {
            e.preventDefault();
            e.stopPropagation();
            await toggleInlineEdit(btn, id);
        }
    }
    else if (e.key === 'Escape') {
        if (getNoteFind().noteId && String(getNoteFind().noteId) === String(id)) {
            e.preventDefault();
            e.stopPropagation();
            closeNoteFindBar(true);
            return;
        }

        const btn = document.querySelector(`#note-${id} .btn-icon-edit`);
        if (btn && document.getElementById(`note-${id}`).classList.contains('is-editing')) {
            e.preventDefault();
            e.stopPropagation();
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

    // Cross-canvas: switch the active board first, passing the target note ID so
    // loadState → centerOnNote handles the scroll and highlight after the canvas loads.
    if (note.canvas_id != STATE.canvas_id) {
        if (typeof switchCanvas === 'function') {
            await switchCanvas(note.canvas_id, id);
        }
        return;
    }

    // Same canvas: delegate entirely to centerOnNote, which handles layer switching,
    // DOM-settle timing, scroll precision, and highlight via a single proven path.
    if (typeof centerOnNote === 'function') {
        await centerOnNote(id);
    }
}

function resolveNoteEmbedTargetId(value) {
    const targetId = parseInt(value, 10);
    if (!isNaN(targetId)) return targetId;

    const lower = String(value || '').toLowerCase();
    const match = Object.values(STATE.note_map || {}).find(
        n => n.title && n.title.toLowerCase() === lower
    );
    return match ? match.id : null;
}

function resolveNoteEmbeddedText(content, depth = 0, seen = new Set()) {
    if (!content || !content.includes('[embed:')) return content || '';
    if (depth > 2) return 'Embed depth limit reached';

    return content.replace(/\[embed:([^\]]+)\]/g, (fullMatch, rawTarget) => {
        const targetId = resolveNoteEmbedTargetId(rawTarget.trim());
        if (targetId == null) return `${rawTarget.trim()} (unavailable)`;
        if (seen.has(targetId)) return 'Embed depth limit reached';

        const source = (STATE.notes || []).find(n => n.id == targetId)
            || (STATE.embed_cache || {})[targetId];
        if (!source) {
            const meta = STATE.note_map[targetId];
            const label = meta && meta.title ? meta.title : `Note #${targetId}`;
            return `${label} (unavailable)`;
        }

        const nextSeen = new Set(seen);
        nextSeen.add(targetId);
        return resolveNoteEmbeddedText(source.content || '', depth + 1, nextSeen);
    });
}

/**
 * Copies a referenced note's content to the system clipboard.
 * Uses the live note content from STATE.notes when the target is on the current canvas,
 * falling back to the title from STATE.note_map for cross-canvas references.
 * @param {number|string} id - The target note ID.
 * @returns {Promise<void>}
 */
async function handleNoteCopyClick(id) {
    const liveNote = STATE.notes.find(n => n.id == id);
    const mapNote  = STATE.note_map[id];

    if (!liveNote && !mapNote) {
        showToast('Note not found', 'error');
        return;
    }

    let text;
    if (liveNote && liveNote.content) {
        text = resolveNoteEmbeddedText(liveNote.content);
    } else if (mapNote && mapNote.title) {
        text = mapNote.title;
    } else {
        text = `Note #${id}`;
    }
    const label = (liveNote && liveNote.title) || (mapNote && mapNote.title) || `Note #${id}`;

    try {
        const copied = await copyToClipboard(text);
        if (!copied) throw new Error('Copy failed');
        showToast(`Copied: ${window.escapeHtml(label)}`, 'success');
    } catch (err) {
        showToast('Clipboard access denied', 'error');
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
    // Standard: checkbox at line start (standalone or with list prefix)
    // Fallback: checkbox anywhere in the line (e.g. inside a table cell)
    const match = line.match(/^([ \t]*(?:[-*]\s+|\d+\.\s+)?)\[([ xX]?)\](.*)$/)
               || line.match(/^(.*?)\[([ xX]?)\](.*)$/);
    if (!match) return; // Safety: Line has changed since render

    const prefix = match[1];
    const state  = match[2].toLowerCase();
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
        const textarea = el.querySelector('.note-text-section > textarea[data-action="note-keydown"]');
        if (viewer)   viewer.innerHTML = formatNoteContent(note.content, id);
        if (typeof fitNoteHeight === 'function') fitNoteHeight(id);
        if (textarea) textarea.value   = note.content;
    }

    // Persistent Sync: Commitment to the database
    if (typeof saveNoteInline === 'function') {
        await saveNoteInline(id);
    }
}

/**
 * Click-to-Edit: binds line/block editing to a note's rendered viewer.
 * The listener is attached to the stable text section so viewer re-renders survive.
 */
function initClickToEdit(el, noteId) {
    const section = el.querySelector('.note-text-section');
    if (!section || section.dataset.clickToEditBound === 'true') return;
    section.dataset.clickToEditBound = 'true';

    section.addEventListener('click', function onSectionClick(e) {
        if (!el.classList.contains('is-editing')) return;
        if (e.target.closest('.note-header, .btn-icon, .note-title-slot, .inline-title-input, .file-name-display')) return;

        const viewer = e.target.closest('.note-text-viewer');
        if (!viewer || !section.contains(viewer)) return;
        if (e.target.closest('.note-line-editor, .note-block-editor')) return;

        const blockEl = e.target.closest('[data-line-start]');
        if (blockEl && viewer.contains(blockEl)) {
            e.stopPropagation();
            e.preventDefault();
            editBlock(blockEl, noteId, e);
            return;
        }

        const lineEl = e.target.closest('[data-line]');
        if (!lineEl || !viewer.contains(lineEl)) return;

        e.stopPropagation();
        e.preventDefault();
        editLine(lineEl, noteId, e);
    });
}

/**
 * Resolves a mouse event's client coordinates to a DOM Range at that point.
 * Uses the standard caretRangeFromPoint API with a caretPositionFromPoint fallback.
 * @param {MouseEvent} e - The click event with clientX/clientY.
 * @returns {Range|null} A collapsed Range at the click point, or null if unavailable.
 */
function getCaretRangeAtPoint(e) {
    try {
        if (typeof document.caretRangeFromPoint === 'function') {
            var range = document.caretRangeFromPoint(e.clientX, e.clientY);
            if (range && range.startContainer) return range;
        }
        if (typeof document.caretPositionFromPoint === 'function') {
            var pos = document.caretPositionFromPoint(e.clientX, e.clientY);
            if (pos && pos.offsetNode) {
                var r = document.createRange();
                r.setStart(pos.offsetNode, pos.offset);
                r.collapse(true);
                return r;
            }
        }
    } catch (_) {}
    return null;
}

/**
 * Walks text nodes inside an element and computes the cumulative character offset
 * up to the text node and position referenced by a DOM Range.
 * @param {HTMLElement} el - The container element.
 * @param {Range} range - A DOM Range whose startContainer is a text node inside el.
 * @returns {number|null} The character offset within el.textContent, or null if the range is not inside el.
 */
function getTextOffsetInElement(el, range) {
    if (!range || !el) return null;
    var startNode = range.startContainer;
    if (!startNode || !el.contains(startNode)) return null;
    var startOffset = range.startOffset;
    if (startNode.nodeType !== 3) return null;

    var offset = 0;
    var walker = document.createTreeWalker(el, 4, null, false);
    var node;
    while ((node = walker.nextNode())) {
        if (node === startNode) return offset + startOffset;
        offset += node.textContent.length;
    }
    return null;
}

/**
 * Builds a positional mapping from raw note text to rendered character positions.
 * Skips markdown syntax (**, *, ~~, `), wikilinks ([[title]]), markdown links
 * ([text](url)), inline components ([tag:...], [color:...]...[/color], [size:...],
 * [progress:...], [divider:...], [link:...]), and rendered dynamic components.
 * Wrapping components are processed recursively so nested markup is preserved.
 * @param {string} rawText - The raw note text to map.
 * @param {number} depth - Current recursive wrapper depth.
 * @param {Object|null} componentState - Rendered dynamic components in DOM order.
 * @returns {Array<number>} An array where index = raw position and
 *   value = rendered position (-1 means the character is not rendered).
 */
function findPositionMapWrapperEnd(text, openToken, closeToken, scanStart) {
    let nesting = 1;
    let cursor = scanStart;
    while (cursor < text.length) {
        const nextOpen = text.indexOf(openToken, cursor);
        const nextClose = text.indexOf(closeToken, cursor);
        if (nextClose === -1) return -1;
        if (nextOpen !== -1 && nextOpen < nextClose) {
            nesting++;
            cursor = nextOpen + openToken.length;
        } else {
            nesting--;
            if (nesting === 0) return nextClose;
            cursor = nextClose + closeToken.length;
        }
    }
    return -1;
}

function buildPositionMap(rawText, depth = 0, componentState = null) {
    var len = rawText.length;
    var map = [];
    map.componentRanges = [];

    if (depth > 12) {
        for (var fallbackIndex = 0; fallbackIndex < len; fallbackIndex++) map[fallbackIndex] = fallbackIndex;
        map.renderedLength = len;
        return map;
    }

    var renderedPos = 0;
    var i = 0;

    function consumeRenderedComponent(type, rawStart, rawLength, sourceValue = '') {
        if (!componentState || !componentState.components) return false;
        const component = componentState.components[componentState.index];
        if (!component || component.type !== type) return false;

        if ((type === 'note' || type === 'copy') && component.targetId) {
            const parsedId = parseInt(sourceValue, 10);
            if (!isNaN(parsedId) && String(parsedId) !== String(component.targetId)) return false;
            if (isNaN(parsedId)) {
                const target = Object.values(STATE.note_map || {}).find(note =>
                    note.title && note.title.toLowerCase() === sourceValue.toLowerCase()
                );
                if (!target || String(target.id) !== String(component.targetId)) return false;
            }
        }
        if (type === 'file') {
            const parsedId = parseInt(sourceValue, 10);
            const target = !isNaN(parsedId)
                ? STATE.note_map?.[parsedId]
                : Object.values(STATE.note_map || {}).find(note =>
                    note.title && note.title.toLowerCase() === sourceValue.toLowerCase()
                );
            const expectedLabel = target
                ? String(target.title || target.id)
                : (!isNaN(parsedId) ? `File #${parsedId}` : '');
            if (!expectedLabel || !component.text.toLowerCase().includes(expectedLabel.toLowerCase())) {
                return false;
            }
        }

        componentState.index++;
        map[rawStart] = renderedPos;
        for (var j = rawStart + 1; j < rawStart + rawLength; j++) map[j] = -1;
        map.componentRanges.push({
            renderedStart: renderedPos,
            renderedEnd: renderedPos + component.length,
            rawStart
        });
        renderedPos += component.length;
        return true;
    }

    function mergeInnerMap(innerMap, rawStart, rawLength) {
        for (var j = 0; j < rawLength; j++) {
            map[rawStart + j] = innerMap[j] >= 0 ? renderedPos + innerMap[j] : -1;
        }
        (innerMap.componentRanges || []).forEach(range => {
            map.componentRanges.push({
                renderedStart: renderedPos + range.renderedStart,
                renderedEnd: renderedPos + range.renderedEnd,
                rawStart: rawStart + range.rawStart
            });
        });
        renderedPos += innerMap.renderedLength || 0;
    }

    while (i < len) {
        const current = rawText.charAt(i);
        var rest = (current === '[' || current === '*' || current === '~' || current === '`')
            ? rawText.substring(i)
            : '';
        var match, content, contentStart, closePos, fullLen, c, visible, visStart;

        // 1. Wikilink: [[title]] (parser priority: before components and markdown)
        if (rest.charAt(0) === '[' && rest.charAt(1) === '[') {
            match = rest.match(/^\[\[([^\[\]\n]+)\]\]/);
            if (match) {
                fullLen = match[0].length;
                const renderedWiki = componentState?.components?.[componentState.index];
                const wikiTarget = Object.values(STATE.note_map || {}).find(note =>
                    note.title && note.title.toLowerCase() === match[1].toLowerCase()
                );
                if (wikiTarget && renderedWiki?.type === 'wikilink' && renderedWiki.text !== match[1]) {
                    consumeRenderedComponent('wikilink', i, fullLen);
                    i += fullLen;
                    continue;
                }
                if (wikiTarget && renderedWiki?.type === 'wikilink') componentState.index++;
                map[i] = -1; map[i + 1] = -1;
                content = match[1];
                contentStart = i + 2;
                closePos = contentStart + content.length;
                map[closePos] = -1; map[closePos + 1] = -1;
                for (c = 0; c < content.length; c++) map[contentStart + c] = renderedPos++;
                i = closePos + 2;
                continue;
            }
        }

        // 2. Markdown link: [text](url)
        if (rest.charAt(0) === '[') {
            match = rest.match(/^\[([^\[\]\n]+)\]\((https?:\/\/[^\s\)]+)\)/);
            if (match) {
                fullLen = match[0].length;
                content = match[1];
                map[i] = -1;
                mergeInnerMap(buildPositionMap(content, depth + 1), i + 1, content.length);
                var postContentStart = i + 1 + content.length;
                for (c = postContentStart; c < i + fullLen; c++) map[c] = -1;
                i = i + fullLen;
                continue;
            }
        }

        // 3. Wrapping components: recursively process inner content
        // [copy]inner[/copy] (valueless wrapping)
        if (rest.startsWith('[copy]')) {
            const openLength = '[copy]'.length;
            const closeTag = '[/copy]';
            const closeIndex = findPositionMapWrapperEnd(rest, '[copy]', closeTag, openLength);
            if (closeIndex !== -1) {
                fullLen = closeIndex + closeTag.length;
                content = rest.substring(openLength, closeIndex);
                contentStart = i + openLength;
                for (c = i; c < contentStart; c++) map[c] = -1;
                var innerMap = buildPositionMap(content, depth + 1, componentState);
                mergeInnerMap(innerMap, contentStart, content.length);
                for (c = contentStart + content.length; c < i + fullLen; c++) map[c] = -1;
                i = i + fullLen;
                continue;
            }
        }

        // [color:value]inner[/color], [size:value]inner[/size], [bg:value]inner[/bg]
        match = rest.match(/^\[(color|colour|size|bg):([^\]\n]+)\]/);
        if (match) {
            const wrapperType = match[1];
            const closeTag = `[/${wrapperType}]`;
            const closeIndex = findPositionMapWrapperEnd(
                rest,
                `[${wrapperType}:`,
                closeTag,
                match[0].length
            );
            if (closeIndex !== -1) {
                fullLen = closeIndex + closeTag.length;
                content = rest.substring(match[0].length, closeIndex);
                contentStart = i + match[0].length;
                for (c = i; c < contentStart; c++) map[c] = -1;
                var innerMap2 = buildPositionMap(content, depth + 1, componentState);
                mergeInnerMap(innerMap2, contentStart, content.length);
                for (c = contentStart + content.length; c < i + fullLen; c++) map[c] = -1;
                i = i + fullLen;
                continue;
            }
        }

        // 4. Self-closing components whose visible content is a substring of the raw tag
        // [tag:value|color] -> value
        match = rest.match(/^\[tag:([^|\]\n]+)(?:\|[^|\]\n]+)?\]/);
        if (match) {
            fullLen = match[0].length;
            visible = match[1];
            visStart = match[0].indexOf(visible);
            if (visStart === -1) visStart = 5; // after "[tag:"
            for (c = i; c < i + visStart; c++) map[c] = -1;
            mergeInnerMap(buildPositionMap(visible, depth + 1), i + visStart, visible.length);
            for (c = i + visStart + visible.length; c < i + fullLen; c++) map[c] = -1;
            i = i + fullLen;
            continue;
        }

        // [progress:value|label] -> label
        match = rest.match(/^\[progress:([^|\]\n]+)\|([^\]\n]+)\]/);
        if (match) {
            fullLen = match[0].length;
            visible = match[2];
            visStart = match[0].indexOf(visible);
            if (visStart === -1) visStart = match[0].indexOf('|') + 1;
            for (c = i; c < i + visStart; c++) map[c] = -1;
            mergeInnerMap(buildPositionMap(visible, depth + 1), i + visStart, visible.length);
            for (c = i + visStart + visible.length; c < i + fullLen; c++) map[c] = -1;
            i = i + fullLen;
            continue;
        }

        // [divider:label] -> label
        match = rest.match(/^\[divider:([^\]\n]+)\]/);
        if (match) {
            fullLen = match[0].length;
            visible = match[1];
            visStart = match[0].indexOf(visible);
            if (visStart === -1) visStart = 9; // after "[divider:"
            for (c = i; c < i + visStart; c++) map[c] = -1;
            mergeInnerMap(buildPositionMap(visible, depth + 1), i + visStart, visible.length);
            for (c = i + visStart + visible.length; c < i + fullLen; c++) map[c] = -1;
            i = i + fullLen;
            continue;
        }

        // [link:url|label] -> label, or url if no label
        match = rest.match(/^\[link:([^\|\]\n]+)(?:\|([^\]\n]+))?\]/);
        if (match) {
            fullLen = match[0].length;
            visible = match[2] || match[1];
            visStart = match[0].indexOf(visible);
            if (visStart === -1) visStart = match[2] ? match[0].indexOf('|') + 1 : 6; // after "[link:" or after "|"
            for (c = i; c < i + visStart; c++) map[c] = -1;
            mergeInnerMap(buildPositionMap(visible, depth + 1), i + visStart, visible.length);
            for (c = i + visStart + visible.length; c < i + fullLen; c++) map[c] = -1;
            i = i + fullLen;
            continue;
        }

        // 5. Dynamic components use their actual rendered text length. Clicks within
        // the generated label resolve to the opening bracket of the source tag.
        match = rest.match(/^\[(date|note|copy|file|image|embed|bookmarks|iframe):([^\]\n]*)\]/);
        if (match) {
            fullLen = match[0].length;
            const sourceValue = match[2].split('|')[0].trim();
            if (consumeRenderedComponent(match[1], i, fullLen, sourceValue)) {
                i = i + fullLen;
                continue;
            }
        }

        // 6. Markdown: bold, strikethrough, italic, inline code
        // Bold: **content**
        match = rest.match(/^\*\*(.*?)\*\*/);
        if (match) {
            map[i] = -1; map[i + 1] = -1;
            content = match[1];
            contentStart = i + 2;
            closePos = contentStart + content.length;
            map[closePos] = -1; map[closePos + 1] = -1;
            for (c = 0; c < content.length; c++) map[contentStart + c] = renderedPos++;
            i = closePos + 2;
            continue;
        }

        // Strikethrough: ~~content~~
        match = rest.match(/^~~(.*?)~~/);
        if (match) {
            map[i] = -1; map[i + 1] = -1;
            content = match[1];
            contentStart = i + 2;
            closePos = contentStart + content.length;
            map[closePos] = -1; map[closePos + 1] = -1;
            for (c = 0; c < content.length; c++) map[contentStart + c] = renderedPos++;
            i = closePos + 2;
            continue;
        }

        // Italic: *content* (single asterisk)
        match = rest.match(/^\*(.*?)\*/);
        if (match) {
            map[i] = -1;
            content = match[1];
            contentStart = i + 1;
            closePos = contentStart + content.length;
            map[closePos] = -1;
            for (c = 0; c < content.length; c++) map[contentStart + c] = renderedPos++;
            i = closePos + 1;
            continue;
        }

        // Inline code: `content`
        match = rest.match(/^`(.*?)`/);
        if (match) {
            map[i] = -1;
            content = match[1];
            contentStart = i + 1;
            closePos = contentStart + content.length;
            map[closePos] = -1;
            for (c = 0; c < content.length; c++) map[contentStart + c] = renderedPos++;
            i = closePos + 1;
            continue;
        }

        // Regular character: 1:1
        map[i] = renderedPos++;
        i++;
    }

    map.renderedLength = renderedPos;
    return map;
}

function createRenderedComponentState(renderedEl) {
    const selector = [
        '.note-date-tag',
        '.note-copy-trigger',
        'a.note-ref[download]',
        '.note-link-trigger'
    ].join(',');

    const components = Array.from(renderedEl.querySelectorAll(selector)).map(el => {
        let type = null;
        if (el.classList.contains('note-date-tag')) type = 'date';
        else if (el.classList.contains('note-copy-trigger')) type = 'copy';
        else if (el.matches('a.note-ref[download]')) type = 'file';
        else if ((el.getAttribute('title') || '').startsWith('Jump to Note:')) type = 'note';
        else if (el.classList.contains('note-link-trigger')) type = 'wikilink';
        return {
            type,
            length: (el.textContent || '').length,
            text: el.textContent || '',
            targetId: el.dataset.targetId || null
        };
    }).filter(component => component.type);

    return { components, index: 0 };
}

/**
 * Looks up a rendered character offset in a position map and returns the
 * corresponding raw text offset.
 * @param {Array<number>} map - The position map from buildPositionMap.
 * @param {number} renderedOffset - A character offset within the rendered text.
 * @returns {number} The corresponding character offset in the raw text.
 */
function mapRenderedToRawOffset(map, renderedOffset) {
    const componentRange = (map.componentRanges || []).find(range =>
        renderedOffset >= range.renderedStart && renderedOffset < range.renderedEnd
    );
    if (componentRange) return componentRange.rawStart;

    if (renderedOffset <= 0) {
        for (var i = 0; i < map.length; i++) {
            if (map[i] >= 0) return i;
        }
        return 0;
    }
    for (var i = 0; i < map.length; i++) {
        if (map[i] >= renderedOffset) return i;
    }
    return map.length;
}

/**
 * Determines the structural prefix lengths for a line element (heading, bullet,
 * checkbox) where the raw text includes syntax markers absent from the rendered
 * element's text content.
 * @param {HTMLElement} lineEl - The DOM element with [data-line] attribute.
 * @param {string} rawText - The raw line text including structural syntax.
 * @returns {{rawPrefix: number, renderedPrefix: number}} Prefix lengths in raw
 *   and rendered text respectively.
 */
function getStructuralPrefix(lineEl, rawText) {
    if (lineEl.classList.contains('note-h1') || lineEl.classList.contains('note-h2') || lineEl.classList.contains('note-h3')) {
        var m = rawText.match(/^(\s*#{1,3} +)/);
        return { rawPrefix: m ? m[0].length : 0, renderedPrefix: 0 };
    }
    if (lineEl.classList.contains('note-bullet-row')) {
        var indMatch = rawText.match(/^(\s*)/);
        var rawIndent = indMatch ? indMatch[1].length : 0;
        var m = rawText.match(/^\s*[-*•] +/);
        return { rawPrefix: m ? m[0].length : rawIndent + 2, renderedPrefix: 1 };
    }
    if (lineEl.classList.contains('checkbox-row-inline')) {
        var m = rawText.match(/^(\s*(?:[-*]\s+|\d+\.\s+)?\[[\sxX]?\]\s*)/);
        return { rawPrefix: m ? m[0].length : 0, renderedPrefix: 0 };
    }
    if (lineEl.querySelector('.note-number')) {
        var numberMatch = rawText.match(/^(\s*)(\d+)\.\s+/);
        const renderedPrefix = numberMatch
            ? numberMatch[1].length + numberMatch[2].length + 2
            : 0;
        return { rawPrefix: numberMatch ? numberMatch[0].length : 0, renderedPrefix };
    }
    return { rawPrefix: 0, renderedPrefix: 0 };
}

/**
 * Computes the raw-text cursor position corresponding to a mouse click on a
 * single-line rendered element. Used by editLine for precise inline editing.
 * Handles structural prefixes, inline markdown, wikilinks, markdown links, and
 * inline components ([tag:], [color:]...[/color], [size:], [progress:], [divider:],
 * [link:]). Falls back to proportional mapping when caretRangeFromPoint is unavailable.
 * @param {MouseEvent} e - The click event.
 * @param {HTMLElement} renderedEl - The clicked rendered element with [data-line].
 * @param {string} rawText - The raw text value for the line.
 * @returns {number} The cursor offset to use with setSelectionRange.
 */
function computeCursorOffset(e, renderedEl, rawText) {
    var renderedText = renderedEl.textContent || '';

    var range = getCaretRangeAtPoint(e);
    if (!range) {
        if (renderedText.length > 0) {
            var rect = renderedEl.getBoundingClientRect();
            var ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
            return Math.round(ratio * rawText.length);
        }
        return rawText.length;
    }

    var renderedOffset = getTextOffsetInElement(renderedEl, range);
    if (renderedOffset === null) {
        if (renderedText.length > 0) {
            var rect = renderedEl.getBoundingClientRect();
            var ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
            return Math.round(ratio * rawText.length);
        }
        return rawText.length;
    }

    var prefix = getStructuralPrefix(renderedEl, rawText);

    if (renderedOffset < prefix.renderedPrefix && prefix.renderedPrefix > 0) {
        return Math.round(renderedOffset * prefix.rawPrefix / prefix.renderedPrefix);
    }

    var contentRenderedOffset = renderedOffset - prefix.renderedPrefix;
    var contentRaw = rawText.substring(prefix.rawPrefix);
    var map = buildPositionMap(contentRaw, 0, createRenderedComponentState(renderedEl));
    var contentMapped = mapRenderedToRawOffset(map, contentRenderedOffset);

    return prefix.rawPrefix + Math.min(contentMapped, contentRaw.length);
}

/**
 * Computes the raw-text cursor position for a multi-line block element (table,
 * code fence, callout, etc.). Table clicks resolve through the rendered row/cell
 * coordinates and then use the inline position map within that exact source cell.
 * Other block types fall back to proportional mapping.
 * @param {MouseEvent} e - The click event.
 * @param {HTMLElement} renderedEl - The clicked rendered element with [data-line-start].
 * @param {string} rawText - The raw block text for the textarea.
 * @returns {number|null} The cursor offset, or null if the position cannot be determined.
 */
function computeBlockCursorOffset(e, renderedEl, rawText) {
    var range = getCaretRangeAtPoint(e);
    if (!range) return null;

    var renderedText = renderedEl.textContent || '';
    var proportionalPos = null;
    var renderedOffset = getTextOffsetInElement(renderedEl, range);
    if (renderedOffset !== null && renderedText.length > 0) {
        proportionalPos = Math.round(renderedOffset * rawText.length / renderedText.length);
    }

    var cell = range.startContainer;
    if (cell && cell.nodeType === 3) cell = cell.parentElement;
    var clickedEl = cell;
    cell = cell ? cell.closest('th, td') : null;

    function splitTableCells(line) {
        const segments = [];
        let depth = 0;
        let start = 0;
        for (let index = 0; index <= line.length; index++) {
            const char = line[index];
            if (char === '[') depth++;
            else if (char === ']') depth = Math.max(0, depth - 1);
            if (index === line.length || (char === '|' && depth === 0)) {
                const rawCell = line.substring(start, index);
                const leading = rawCell.search(/\S|$/);
                segments.push({
                    text: rawCell.trim(),
                    start: start + leading
                });
                start = index + 1;
            }
        }
        if (segments[0]?.text === '') segments.shift();
        if (segments[segments.length - 1]?.text === '') segments.pop();
        return segments;
    }

    function resolveTableCellOffset() {
        if (!cell || !/^\s*\[table(?::[^\]]*)?\]\s*(?:\n|$)/i.test(rawText)) return null;

        const lines = rawText.split('\n');
        const lineOffsets = [];
        let sourceOffset = 0;
        lines.forEach(line => {
            lineOffsets.push(sourceOffset);
            sourceOffset += line.length + 1;
        });

        const closeLine = lines.findIndex((line, index) => index > 0 && /^\s*\[\/table\]\s*$/i.test(line));
        const contentEnd = closeLine === -1 ? lines.length : closeLine;
        const records = [];
        for (let lineIndex = 1; lineIndex < contentEnd; lineIndex++) {
            const text = lines[lineIndex].trim();
            if (!text) continue;
            records.push({
                lineIndex,
                text,
                trimStart: lines[lineIndex].indexOf(text)
            });
        }

        const separatorIndex = records.findIndex(record => /^[\-|: ]+$/.test(record.text));
        const header = separatorIndex !== -1 ? records.slice(0, separatorIndex) : [];
        const body = separatorIndex !== -1 ? records.slice(separatorIndex + 1) : records;
        const row = cell.closest('tr');
        const section = row?.parentElement;
        const rowIndex = row && section ? Array.from(section.rows).indexOf(row) : -1;
        const record = cell.closest('thead')
            ? header[0]
            : body[rowIndex];
        if (!record) return null;

        const cellIndex = row ? Array.from(row.cells).indexOf(cell) : -1;
        const sourceCell = splitTableCells(record.text)[cellIndex];
        if (!sourceCell) return null;

        const structuralEl = cell.querySelector?.('[data-line]') || null;
        const mappingEl = structuralEl && structuralEl.contains(range.startContainer)
            ? structuralEl
            : cell;
        const localRenderedOffset = getTextOffsetInElement(mappingEl, range);
        if (localRenderedOffset === null) return null;

        const prefix = structuralEl
            ? getStructuralPrefix(structuralEl, sourceCell.text)
            : { rawPrefix: 0, renderedPrefix: 0 };
        const contentRaw = sourceCell.text.substring(prefix.rawPrefix);
        const cellMap = buildPositionMap(
            contentRaw,
            0,
            createRenderedComponentState(mappingEl)
        );
        const contentRenderedOffset = Math.max(0, localRenderedOffset - prefix.renderedPrefix);
        const localRawOffset = prefix.rawPrefix
            + mapRenderedToRawOffset(cellMap, contentRenderedOffset);
        return lineOffsets[record.lineIndex]
            + record.trimStart
            + sourceCell.start
            + Math.min(localRawOffset, sourceCell.text.length);
    }

    const tableCellOffset = resolveTableCellOffset();
    if (tableCellOffset !== null) return tableCellOffset;

    function findBestMatch(text, minLen) {
        if (!text || text.length < minLen) return -1;
        var bestIdx = -1;
        var bestDist = Infinity;
        var searchFrom = 0;
        while (searchFrom < rawText.length) {
            var idx = rawText.indexOf(text, searchFrom);
            if (idx === -1) break;
            var dist = proportionalPos !== null ? Math.abs(idx - proportionalPos) : idx;
            if (dist < bestDist) { bestIdx = idx; bestDist = dist; }
            searchFrom = idx + 1;
        }
        return bestIdx;
    }

    // Prefer the text of the exact clicked sub-element (e.g. a tag span inside a cell).
    if (clickedEl && clickedEl !== cell) {
        var clickedText = clickedEl.textContent.trim();
        // For very short text (single char), only use it when we have a proportional hint.
        var minLen = (proportionalPos !== null) ? 1 : 2;
        var idx = findBestMatch(clickedText, minLen);
        if (idx !== -1) return idx;
    }

    // Fall back to the full cell text.
    if (cell) {
        var cellText = cell.textContent.trim();
        var idx = findBestMatch(cellText, 2);
        if (idx !== -1) return idx;
    }

    if (proportionalPos !== null) return proportionalPos;
    return null;
}

function focusInlineEditor(editor, selectText = false) {
    try {
        editor.focus({ preventScroll: true });
    } catch (_) {
        editor.focus();
    }
    if (selectText && typeof editor.select === 'function') editor.select();
}

function resizeBlockEditorToContent(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight + 2}px`;
}

function restoreInlineEditElement(editor, originalEl) {
    if (editor && editor.isConnected && originalEl) editor.replaceWith(originalEl);
}

function refreshClickToEditViewer(noteId, note, viewer) {
    const el = document.getElementById('note-' + noteId);
    const targetViewer = viewer || el?.querySelector('.note-text-viewer');
    if (!targetViewer) return false;

    const scrollTop = targetViewer.scrollTop;
    targetViewer.innerHTML = formatNoteContent(note.content || '', noteId);
    if (typeof fitNoteHeight === 'function') fitNoteHeight(noteId);
    targetViewer.scrollTop = scrollTop;

    const textarea = el?.querySelector('.note-text-section > textarea[data-action="note-keydown"]');
    if (textarea) textarea.value = note.content || '';
    if (el) el.dataset.lastContent = note.content || '';
    return true;
}

/**
 * Enters inline edit mode for a single line by replacing the rendered element
 * with an input. Positions the cursor at the click point using the
 * computeCursorOffset helper when a click event is provided.
 * @param {HTMLElement} lineEl - The rendered line element with [data-line].
 * @param {number|string} noteId - The note's id.
 * @param {MouseEvent} [clickEvent] - The click event that triggered editing.
 */
function editLine(lineEl, noteId, clickEvent) {
    const note = STATE.notes.find(n => n.id == noteId);
    if (!note) return;

    const lineIndex = parseInt(lineEl.dataset.line, 10);
    const lines = (note.content || '').split('\n');
    if (isNaN(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) return;

    const rawText = lines[lineIndex];
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'note-line-editor';
    input.value = rawText;
    input.dataset.lineIndex = lineIndex;
    input.dataset.noteId = noteId;

    var cursorPos = null;
    if (clickEvent) {
        cursorPos = computeCursorOffset(clickEvent, lineEl, rawText);
    }

    lineEl.replaceWith(input);

    if (cursorPos !== null && cursorPos >= 0) {
        try { input.focus({ preventScroll: true }); } catch (_) { input.focus(); }
        input.setSelectionRange(cursorPos, cursorPos);
    } else {
        focusInlineEditor(input, true);
    }

    const viewer = document.getElementById('note-' + noteId)?.querySelector('.note-text-viewer');
    let finished = false;

    const cleanup = () => {
        input.removeEventListener('blur', handleCommit);
        input.removeEventListener('keydown', handleKey);
    };
    const finish = (shouldCommit) => {
        if (finished) return;
        finished = true;
        cleanup();
        if (shouldCommit) {
            commitLineEdit(input, noteId, viewer, lineEl);
        } else {
            restoreInlineEditElement(input, lineEl);
        }
    };
    const handleCommit = () => finish(true);
    const handleKey = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            finish(true);
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            var editBtn = document.querySelector('#note-' + noteId + ' .btn-icon-edit');
            if (editBtn && typeof toggleInlineEdit === 'function') {
                cleanup();
                finished = true;
                toggleInlineEdit(editBtn, noteId, true);
            } else {
                finish(false);
            }
        }
    };

    input.addEventListener('blur', handleCommit);
    input.addEventListener('keydown', handleKey);
}

/**
 * Enters edit mode for a multi-line block (table, code fence, callout, etc.)
 * by replacing the rendered element with a textarea. Uses proportional cursor
 * positioning via computeBlockCursorOffset when a click event is provided.
 * @param {HTMLElement} blockEl - The rendered block element with [data-line-start].
 * @param {number|string} noteId - The note's id.
 * @param {MouseEvent} [clickEvent] - The click event that triggered editing.
 */
function editBlock(blockEl, noteId, clickEvent) {
    const note = STATE.notes.find(n => n.id == noteId);
    if (!note) return;

    const rawLines = (note.content || '').split('\n');
    const startLine = parseInt(blockEl.dataset.lineStart, 10);
    if (isNaN(startLine) || startLine < 0 || startLine >= rawLines.length) return;

    let endLine = blockEl.dataset.lineEnd !== undefined
        ? parseInt(blockEl.dataset.lineEnd, 10)
        : findBlockEndLine(note.content || '', startLine);
    if (isNaN(endLine) || endLine < startLine) return;
    endLine = Math.min(endLine, rawLines.length - 1);

    const rawText = rawLines.slice(startLine, endLine + 1).join('\n');
    const textarea = document.createElement('textarea');
    textarea.className = 'note-block-editor';
    textarea.value = rawText;
    textarea.dataset.lineStart = startLine;
    textarea.dataset.lineEnd = endLine;
    textarea.dataset.noteId = noteId;
    textarea.rows = Math.max(endLine - startLine + 1, 3);

    var cursorPos = null;
    if (clickEvent) {
        cursorPos = computeBlockCursorOffset(clickEvent, blockEl, rawText);
    }

    blockEl.replaceWith(textarea);

    if (cursorPos !== null && cursorPos >= 0) {
        try { textarea.focus({ preventScroll: true }); } catch (_) { textarea.focus(); }
        textarea.setSelectionRange(cursorPos, cursorPos);
    } else {
        focusInlineEditor(textarea);
    }
    resizeBlockEditorToContent(textarea);
    requestAnimationFrame(() => {
        resizeBlockEditorToContent(textarea);
        fitNoteHeight(noteId);
    });

    const viewer = document.getElementById('note-' + noteId)?.querySelector('.note-text-viewer');
    let finished = false;

    const handleInput = () => {
        resizeBlockEditorToContent(textarea);
        fitNoteHeight(noteId);
    };
    const cleanup = () => {
        textarea.removeEventListener('blur', handleCommit);
        textarea.removeEventListener('keydown', handleKey);
        textarea.removeEventListener('input', handleInput);
    };
    const finish = (shouldCommit) => {
        if (finished) return;
        finished = true;
        cleanup();
        if (shouldCommit) {
            commitBlockEdit(textarea, noteId, viewer, blockEl);
        } else {
            restoreInlineEditElement(textarea, blockEl);
        }
    };
    const handleCommit = () => finish(true);
    const handleKey = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            finish(true);
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            var editBtn = document.querySelector('#note-' + noteId + ' .btn-icon-edit');
            if (editBtn && typeof toggleInlineEdit === 'function') {
                cleanup();
                finished = true;
                toggleInlineEdit(editBtn, noteId, true);
            } else {
                finish(false);
            }
        }
    };

    textarea.addEventListener('blur', handleCommit);
    textarea.addEventListener('keydown', handleKey);
    textarea.addEventListener('input', handleInput);
}

function commitLineEdit(input, noteId, viewer, originalEl) {
    const note = STATE.notes.find(n => n.id == noteId);
    if (!note) {
        restoreInlineEditElement(input, originalEl);
        return;
    }

    const lineIndex = parseInt(input.dataset.lineIndex, 10);
    const lines = (note.content || '').split('\n');
    if (isNaN(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) {
        restoreInlineEditElement(input, originalEl);
        return;
    }

    const newText = input.value;
    if (lines[lineIndex] === newText) {
        restoreInlineEditElement(input, originalEl);
        return;
    }

    lines[lineIndex] = newText;
    note.content = lines.join('\n');
    if (STATE.note_map && STATE.note_map[noteId]) STATE.note_map[noteId].content = note.content;
    if (!refreshClickToEditViewer(noteId, note, viewer)) restoreInlineEditElement(input, originalEl);
}

function commitBlockEdit(textarea, noteId, viewer, originalEl) {
    const note = STATE.notes.find(n => n.id == noteId);
    if (!note) {
        restoreInlineEditElement(textarea, originalEl);
        return;
    }

    const startLine = parseInt(textarea.dataset.lineStart, 10);
    const endLine = parseInt(textarea.dataset.lineEnd, 10);
    const lines = (note.content || '').split('\n');
    if (isNaN(startLine) || isNaN(endLine) || startLine < 0 || endLine < startLine || startLine >= lines.length) {
        restoreInlineEditElement(textarea, originalEl);
        return;
    }

    const boundedEndLine = Math.min(endLine, lines.length - 1);
    const newText = textarea.value;
    const originalRaw = lines.slice(startLine, boundedEndLine + 1).join('\n');
    if (originalRaw === newText) {
        restoreInlineEditElement(textarea, originalEl);
        return;
    }

    const before = lines.slice(0, startLine);
    const after = lines.slice(boundedEndLine + 1);
    note.content = before.concat(newText.split('\n'), after).join('\n');
    if (STATE.note_map && STATE.note_map[noteId]) STATE.note_map[noteId].content = note.content;
    if (!refreshClickToEditViewer(noteId, note, viewer)) restoreInlineEditElement(textarea, originalEl);
}

function findBlockEndLine(content, startLine) {
    const lines = content.split('\n');
    if (startLine >= lines.length) return startLine;

    const openMatch = lines[startLine].match(/\[(\w+)(?::|\])/);
    if (!openMatch) return startLine;

    const tagName = openMatch[1].toLowerCase();
    const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const openRegex = new RegExp('\\[' + escapeRegExp(tagName) + '(?::|\\])', 'gi');
    const closeRegex = new RegExp('\\[\\/' + escapeRegExp(tagName) + '\\]', 'gi');

    let nesting = 1;
    for (let i = startLine + 1; i < lines.length; i++) {
        const line = lines[i];
        nesting += (line.match(openRegex) || []).length;
        nesting -= (line.match(closeRegex) || []).length;
        if (nesting <= 0) return i;
    }
    return lines.length - 1;
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
    let textArea = null;
    try {
        textArea = document.createElement("textarea");
        textArea.value = text;
        
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "0";
        document.body.appendChild(textArea);
        
        textArea.focus();
        textArea.select();
        textArea.setSelectionRange(0, 99999);
        
        const successful = document.execCommand('copy');
        return successful;
    } catch (err) {
        console.error('Unified Clipboard Failure:', err);
        return false;
    } finally {
        if (textArea?.parentNode) textArea.parentNode.removeChild(textArea);
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

    let text = resolveNoteEmbeddedText(note.content || '');
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
            const objectUrl = URL.createObjectURL(raw);
            img.src = objectUrl;
            
            try {
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = () => reject(new Error('Image load failed'));
                });
                
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) return null;
                ctx.drawImage(img, 0, 0);
                
                const pngBlob = await new Promise(r => canvas.toBlob(r, 'image/png'));
                return pngBlob || null;
            } finally {
                URL.revokeObjectURL(objectUrl);
            }
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
    url.searchParams.set('note_id', id);
    
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
    if ((STATE.pickedNoteId || STATE.resizingContext) && e.touches.length > 1) {
        if (e.cancelable) e.preventDefault();
        return;
    }

    if (e.touches.length === 1) {
        // Single Finger: Panning (Matches handleCanvasMouseDown)
        const touch = e.touches[0];
        
        // Interactive Controls Guard: Ensure touch targets exclude buttons, handles, or inputs
        const isInteractive = e.target.closest(
            '.note-drag-handle-container, .note-resize-handle, .note-header-tab, ' +
            '.btn-icon, .btn-icon-edit, .btn-icon-link, .btn-icon-upload, ' +
            '.btn-icon-view, .btn-icon-delete, .note-id-hash, ' +
            '.note-check-trigger, .note-link-trigger, .reel-action-btn, .hero-action-btn, ' +
            'input, textarea, select, [contenteditable], ' +
            'button:not([data-pan-passthrough]), a[href], a[data-action], ' +
            '[data-action].btn-icon, [data-action].reel-action-btn, [data-action].hero-action-btn' +
            (STATE.isEditingNote != null ? ', [data-line], [data-line-start]' : '')
        );

        // Targeted Dispatch: Handle Resize on Touch
        const resizeHandle = e.target.closest('.note-resize-handle');
        if (resizeHandle) {
            handleResizeStart(e, resizeHandle);
            return;
        }

        // Touch edit-mode drag: allow drag handles through the interactive guard.
        const noteEl = e.target.closest('.sticky-note');
        if (noteEl && noteEl.classList.contains('is-editing')) {
            const dragHandle = e.target.closest('.note-drag-handle-container');
            if (dragHandle) {
                e.preventDefault();
                if (typeof toggleStickyMove === 'function') toggleStickyMove(e, noteEl.dataset.id);
                return;
            }
        }

        if (isInteractive) return;
        if (STATE.resizingContext) return; // Invariant check: resizing and panning are mutually exclusive

        // 3. Movement Initiation: Record start for threshold-based panning
        STATE.isPanning = true;
        STATE.panMoved  = false; // Deferred visual/scroll state
        STATE.panStart = {
            x: touch.clientX,
            y: touch.clientY,
            scrollX: wrapper.scrollLeft,
            scrollY: wrapper.scrollTop
        };
        // Permit event propagation for touch-based click and double-click triggers
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

    if (e.touches.length === 1 && STATE.isPanning && STATE.panStart) {
        // Panning: Movement Threshold Check (4px)
        const touch = e.touches[0];
        
        if (!STATE.panMoved) {
            const dx = Math.abs(touch.clientX - STATE.panStart.x);
            const dy = Math.abs(touch.clientY - STATE.panStart.y);
            
            if (dx > 4 || dy > 4) {
                STATE.panMoved = true;
                STATE.wrapperEl?.classList.add('is-panning-board');
                document.body.style.cursor = 'grabbing';
            }
        }

        if (STATE.panMoved) {
            const dx = touch.clientX - STATE.panStart.x;
            const dy = touch.clientY - STATE.panStart.y;
            
            wrapper.scrollLeft = STATE.panStart.scrollX - dx;
            wrapper.scrollTop  = STATE.panStart.scrollY - dy;
            
            if (typeof updateRadar === 'function') updateRadar();
            if (e.cancelable) e.preventDefault();
        }

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
            
            // Focal Point: Calculate the center between the two fingers
            const rect = wrapper.getBoundingClientRect();
            const centerX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
            const centerY = (touch1.clientY + touch2.clientY) / 2 - rect.top;
            
            // Canvas-space anchoring
            const canvasX = (wrapper.scrollLeft + centerX) / oldScale;
            const canvasY = (wrapper.scrollTop  + centerY) / oldScale;
            
            if (atomicApplyScale(newScale)) {
                // Adjust scroll to keep pinch-center fixed
                wrapper.scrollLeft = canvasX * STATE.scale - centerX;
                wrapper.scrollTop  = canvasY * STATE.scale - centerY;
                
                if (typeof updateRadar === 'function') updateRadar();
                if (typeof scheduleViewportSave === 'function') scheduleViewportSave();
            }
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
    STATE.panMoved  = false;
    STATE.pinchStartDist = null;
    STATE.pinchStartScale = null;
    
    // Reset visual state indicators
    STATE.wrapperEl?.classList.remove('is-panning-board');
    document.body.style.cursor = '';
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
 * Note Context Menu: Right-click menu for copy/move operations on a single note or a lasso group.
 * Group mode activates when the right-clicked note is part of the current multi-selection (2+ notes).
 * @param {MouseEvent} e - The contextmenu event used for cursor positioning.
 * @param {string|number} noteId - ID of the right-clicked note.
 * @returns {void}
 */
function showNoteContextMenu(e, noteId) {
    if (STATE.isInitializing) return;

    document.querySelectorAll('.context-menu').forEach(m => m.remove());

    const idStr   = String(noteId);
    const isGroup = STATE.selectedNoteIds.has(idStr) && STATE.selectedNoteIds.size > 1;
    const ids     = isGroup ? Array.from(STATE.selectedNoteIds).map(Number) : [Number(noteId)];
    const label   = ids.length > 1 ? `${ids.length} notes` : 'note';

    const promptLevel = (operation) => {
        const cleanupModal = () => {
            const modalContent = document.getElementById('globalConfirmModalContent');
            const injection = modalContent?.querySelector('.level-navigator-injection');
            if (injection) injection.remove();
        };

        const levelStats = {};
        (STATE.notes || []).forEach(n => {
            const lid = parseInt(n.layer_id);
            levelStats[lid] = (levelStats[lid] || 0) + 1;
        });

        const discoverySet = new Set(Object.keys(levelStats).map(id => parseInt(id)));
        Object.keys(STATE.layer_map || {}).forEach(id => {
            const lid = parseInt(id);
            if (STATE.layer_map[id]) discoverySet.add(lid);
        });

        const targetLevels = Array.from(discoverySet)
            .filter(id => id >= 1 && id <= 99)
            .sort((a, b) => a - b);

        const submitLevel = async (rawValue) => {
            const level = parseInt(rawValue);
            if (isNaN(level) || level < 1 || level > 99) { showToast('Invalid level', 'error'); return; }
            cleanupModal();
            if (operation === 'move') {
                await moveNotesToLevel(ids, level);
            } else {
                await copyNotesToLevel(ids, level);
            }
            window.closeConfirmModal();
        };

        window.showConfirmModal({
            title:   operation === 'move' ? `Move ${label} to Level` : `Copy ${label} to Level`,
            icon:    operation === 'move' ? '✂️' : '📋',
            message: 'Select a target level (1-99):',
            width: 'small',
            hideCancel: true,
            noEmoji: true,
            autoFocus: true,
            onCancel: cleanupModal
        });

        const promptContainer = document.getElementById('globalConfirmPromptContainer');
        const actionsContainer = document.getElementById('globalConfirmModalActions');

        if (promptContainer && actionsContainer && typeof window.renderRowInput === 'function') {
            actionsContainer.classList.add('hidden');

            const row = window.renderRowInput(promptContainer, {
                id: `${operation}-level-input`,
                type: 'number',
                placeholder: 'Level #...',
                value: STATE.activeLayerId,
                buttonText: operation === 'move' ? 'Move' : 'Copy',
                buttonIcon: operation === 'move' ? '✂️' : '📋',
                noEmoji: true
            });

            if (row?.input) {
                row.input.min = 1;
                row.input.max = 99;
                row.input.onkeydown = (ev) => {
                    if (ev.key === 'Enter') {
                        ev.preventDefault();
                        submitLevel(row.input.value);
                    }
                };
            }

            if (row?.button) row.button.onclick = () => submitLevel(row.input.value);
        }

        if (targetLevels.length > 0) {
            const modalContent = document.getElementById('globalConfirmModalContent');
            if (modalContent) {
                const injection = document.createElement('div');
                injection.className = 'level-navigator-injection';

                let listHtml = '<div class="level-list-container">';
                targetLevels.forEach(levelId => {
                    const alias = STATE.layer_map?.[levelId];
                    const count = levelStats[levelId] || 0;
                    listHtml += `
                        <div class="level-item" data-level="${levelId}">
                            <div class="level-icon-stack">${count > 0 ? '📚' : '📄'}</div>
                            <div class="level-info-main">
                                <span class="level-title-row">Level ${levelId} ${alias ? `— ${window.escapeHtml(alias)}` : ''}</span>
                                <span class="level-meta-row">${count > 0 ? `${count} ${count === 1 ? 'note' : 'notes'} on this layer` : 'No notes yet'}</span>
                            </div>
                            <div class="level-jump-arrow">❯</div>
                        </div>
                    `;
                });
                listHtml += '</div>';

                injection.innerHTML = `<hr class="modal-divider-short">${listHtml}`;
                injection.addEventListener('click', (ev) => {
                    const item = ev.target.closest('.level-item[data-level]');
                    if (item) submitLevel(item.dataset.level);
                });
                modalContent.appendChild(injection);
            }
        }
    };

    const menu = document.createElement('div');
    menu.className = 'context-menu context-menu--cursor';
    menu.innerHTML = `
        <div class="context-menu-item" data-action="copy-level">
            <span class="item-icon">📋</span>
            <span>Copy ${label} to Level...</span>
        </div>
        <div class="context-menu-item" data-action="copy-canvas">
            <span class="item-icon">📋</span>
            <span>Copy ${label} to Canvas...</span>
        </div>
        <div class="context-menu-divider"></div>
        <div class="context-menu-item" data-action="move-level">
            <span class="item-icon">✂️</span>
            <span>Move ${label} to Level...</span>
        </div>
        <div class="context-menu-item" data-action="move-canvas">
            <span class="item-icon">✂️</span>
            <span>Move ${label} to Canvas...</span>
        </div>
        <div class="context-menu-divider"></div>
        <div class="context-menu-item" data-action="move-center">
            <span class="item-icon">🎯</span>
            <span>Move ${label} to Center</span>
        </div>
    `;

    menu.addEventListener('click', (ev) => {
        const action = ev.target.closest('[data-action]')?.dataset.action;
        if (!action) return;
        menu.remove();
        if      (action === 'copy-level')  promptLevel('copy');
        else if (action === 'copy-canvas') openMoveModal(null, ids[0], { ids, operation: 'copy' });
        else if (action === 'move-level')  promptLevel('move');
        else if (action === 'move-canvas') openMoveModal(null, ids[0], { ids, operation: 'move' });
        else if (action === 'move-center') moveNotesToCanvasCenter(ids);
    });

    document.body.appendChild(menu);

    // Position at cursor with viewport overflow correction.
    // getBoundingClientRect() forces a synchronous reflow so dimensions are accurate.
    const vw   = window.innerWidth;
    const vh   = window.innerHeight;
    const rect = menu.getBoundingClientRect();
    const mw   = rect.width  || 220;
    const mh   = rect.height || 160;
    const x    = e.clientX + mw > vw ? vw - mw - 8 : e.clientX;
    const y    = e.clientY + mh > vh ? vh - mh - 8 : e.clientY;
    menu.style.left = `${x}px`;
    menu.style.top  = `${y}px`;

    const closeMenu = () => {
        menu.remove();
        document.removeEventListener('click',   closeMenu);
        document.removeEventListener('keydown', onKeyDown);
    };
    const onKeyDown = (ev) => {
        if (ev.key === 'Escape') closeMenu();
    };
    clearTimeout(_noteContextMenuTimer);
    _noteContextMenuTimer = setTimeout(() => {
        document.addEventListener('click',   closeMenu);
        document.addEventListener('keydown', onKeyDown);
    }, 10);
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

// Interaction Bridges: Required for core.js registration
window.handleCanvasMouseDown   = handleCanvasMouseDown;
window.handleCanvasMouseMove   = handleCanvasMouseMove;
window.handleCanvasMouseUp     = handleCanvasMouseUp;
window.handleCanvasWheel       = handleCanvasWheel;
window.handleCanvasTouchStart  = handleCanvasTouchStart;
window.handleCanvasTouchMove   = handleCanvasTouchMove;
window.handleCanvasTouchEnd    = handleCanvasTouchEnd;
window.handleGlobalKeydown     = handleGlobalKeydown;
window.fitNoteHeight           = fitNoteHeight;
window.handleNoteContentLoad   = handleNoteContentLoad;
window.handleNoteContentToggle = handleNoteContentToggle;
window.hideFloatingActionsRail = hideFloatingActionsRail;

// ── Edit Ribbon ──────────────────────────────────────────────────────────────

/**
 * Wraps selected text in the ribbon's active textarea with before/after strings.
 * Falls back to inserting "text" placeholder when nothing is selected.
 * @param {HTMLTextAreaElement} ta
 * @param {string} before
 * @param {string} after
 * @returns {void}
 */
function applyRibbonWrap(ta, before, after) {
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const sel   = ta.value.slice(start, end) || 'text';
    ta.value    = ta.value.slice(0, start) + before + sel + after + ta.value.slice(end);
    ta.setSelectionRange(start + before.length, start + before.length + sel.length);
    ta.dispatchEvent(new Event('input'));
}

/**
 * Prepends prefix to the line the cursor is currently on.
 * @param {HTMLTextAreaElement} ta
 * @param {string} prefix
 * @returns {void}
 */
function applyRibbonLinePrefix(ta, prefix) {
    const start     = ta.selectionStart;
    const end       = ta.selectionEnd;
    const lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
    ta.value        = ta.value.slice(0, lineStart) + prefix + ta.value.slice(lineStart);
    ta.setSelectionRange(start + prefix.length, end + prefix.length);
    ta.dispatchEvent(new Event('input'));
}

/**
 * Inserts text at the current cursor position.
 * @param {HTMLTextAreaElement} ta
 * @param {string} text
 * @returns {void}
 */
function applyRibbonInsert(ta, text) {
    const start = ta.selectionStart;
    ta.value    = ta.value.slice(0, start) + text + ta.value.slice(start);
    ta.setSelectionRange(start + text.length, start + text.length);
    ta.dispatchEvent(new Event('input'));
}

/**
 * Wires the edit ribbon click delegation. Must be called once after DOM ready.
 * Ribbon buttons dispatch to applyRibbonWrap, applyRibbonLinePrefix, or
 * applyRibbonInsert depending on their data-ribbon-action attribute.
 * The mousedown guard prevents canvas drag handlers from stealing focus before
 * the click fires, which would zero out selectionStart/selectionEnd.
 * @returns {void}
 */
window.initRibbon = function() {
    const ribbon = document.getElementById('notes-edit-ribbon');
    if (!ribbon) return;

    function closeAllDropdowns() {
        ribbon.querySelectorAll('.ribbon-dropdown-menu.open').forEach((m) => m.classList.remove('open'));
        ribbon.querySelectorAll('.ribbon-dropdown-trigger.open').forEach((t) => t.classList.remove('open'));
    }

    function openDropdown(menuEl, trigger) {
        const ribbonRect = ribbon.getBoundingClientRect();
        const trigRect   = trigger.getBoundingClientRect();
        // Position relative to ribbon's own coordinate space
        menuEl.style.top  = (ribbon.offsetHeight + 4) + 'px';
        menuEl.style.left = (trigRect.left + trigRect.width / 2 - ribbonRect.left) + 'px';
        menuEl.classList.add('open');
        trigger.classList.add('open');
    }

    ribbon.addEventListener('mousedown', (e) => e.stopPropagation());

    ribbon.addEventListener('click', (e) => {
        const trigger = e.target.closest('.ribbon-dropdown-trigger');
        if (trigger) {
            e.preventDefault();
            const menuEl = document.getElementById(trigger.dataset.menu);
            if (!menuEl) return;
            const isOpen = menuEl.classList.contains('open');
            closeAllDropdowns();
            if (!isOpen) openDropdown(menuEl, trigger);
            return;
        }

        const btn = e.target.closest('[data-ribbon-action]');
        if (!btn || !_ribbonTextarea) return;
        e.preventDefault();

        closeAllDropdowns();

        const ta     = _ribbonTextarea;
        const action = btn.dataset.ribbonAction;

        if (action === 'color-pick') {
            const picker = document.getElementById('ribbon-color-picker');
            if (!picker) return;
            // Snapshot selection before the picker steals focus
            const selStart = ta.selectionStart;
            const selEnd   = ta.selectionEnd;
            picker.onchange = () => {
                ta.setSelectionRange(selStart, selEnd);
                applyRibbonWrap(ta, '[color:' + picker.value + ']', '[/color]');
                ta.focus();
                picker.onchange = null;
            };
            picker.click();
            return;
        } else if (action === 'wrap') {
            applyRibbonWrap(ta, btn.dataset.before, btn.dataset.after);
        } else if (action === 'line') {
            applyRibbonLinePrefix(ta, btn.dataset.prefix);
        } else if (action === 'hr') {
            applyRibbonInsert(ta, '\n---\n');
        } else if (action === 'tag') {
            applyRibbonInsert(ta, btn.dataset.text);
        } else if (action === 'date') {
            applyRibbonInsert(ta, '[date:' + new Date().toISOString().slice(0, 10) + ']');
        }

        ta.focus();
    });

    document.addEventListener('click', (e) => {
        if (!ribbon.contains(e.target)) closeAllDropdowns();
    }, true);
};
