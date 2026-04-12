// /public/js/notes/rendering.js

// Persistence Layer for Error Reporting: Prevents console spam during heartbeat cycles
window._renderErrors = new Set();


/**
 * Renders all sticky notes and updates the UI state.
 * @returns {void}
 */
function renderUI() {
    const canvas = STATE.canvasEl;
    if (!canvas) return;
    
    // Non-Destructive Reconciliation: Instead of clearing the canvas (flashing), 
    // we track active IDs and perform surgical DOM updates.
    const activeIds = new Set();
    const existingNotes = canvas.querySelectorAll('.sticky-note');
    const existingMap = {};
    existingNotes.forEach(el => { existingMap[el.dataset.id] = el; });

    // Hide skeleton if populated
    const skeleton = document.getElementById('canvas-skeleton');
    if (skeleton && STATE.notes.length > 0) skeleton.classList.add('hidden');

    // Verify Permissions: Check if current user has EDIT access to this board
    const currentCanvas = STATE.canvases.find(c => c.id == STATE.canvas_id);
    const canEdit       = currentCanvas ? currentCanvas.can_edit : 1;

    STATE.notes.forEach(note => {
        try {
            // Isolation Filter: Only render notes belonging to the current active level
            // Use loose equality (==) to handle string vs number mismatches from JSON
            if (note.layer_id != STATE.activeLayerId) return;
            activeIds.add(note.id.toString());

            const existing = existingMap[note.id.toString()];
            
            if (existing) {
                // Skip update if the user is currently interacting with this specific note OR it is in-flight to the API
                if (
                    existing.classList.contains('is-editing') ||
                    (STATE.pickedNoteId == note.id)           ||
                    (STATE.isResizing   == note.id)           ||
                    STATE.activeSyncs.has(String(note.id))
                ) return;

                // Atomic Synchronicity: Check if we need to update position/z-index
                const curX = parseInt(existing.style.left);
                const curY = parseInt(existing.style.top);
                const curW = parseInt(existing.style.width);
                const curH = parseInt(existing.style.height);
                const curZ = parseInt(existing.style.zIndex);
                const curD = existing.classList.contains('is-externally-locked');
                const isLocked = !!(note.locked_by_session_id && note.locked_by_session_id !== STATE.sessionId);

                if (curX != note.x) existing.style.left = `${note.x}px`;
                if (curY != note.y) existing.style.top = `${note.y}px`;
                if (note.width  && curW != note.width)  existing.style.width  = `${note.width}px`;
                if (note.height && curH != note.height) existing.style.height = `${note.height}px`;
                if (curZ != note.z_index) existing.style.zIndex = note.z_index || 1;

                if (curD !== isLocked) {
                    existing.classList.toggle('is-externally-locked', isLocked);
                    let overlay = existing.querySelector('.note-lock-overlay');
                    if (isLocked) {
                        const isSameUser = (note.locked_by_user_id == STATE.user_id);
                        const lockerText = isSameUser ? 'Edited in another session' : `${note.locking_user_name || 'Someone'} is editing`;

                        if (!overlay) {
                            overlay = document.createElement('div');
                            overlay.className = 'note-lock-overlay';
                            existing.appendChild(overlay);
                        }
                        overlay.innerHTML = `<div class="lock-icon">🔒</div><div class="lock-user">${window.escapeHtml(lockerText)}</div>`;
                    } else if (overlay) {
                        overlay.remove();
                    }
                }

                // --- Content & Identity Reconciliation ---
                // Differential hydration for content consistency.
                const titleSlot = existing.querySelector('.note-title-slot');
                if (titleSlot) {
                    const titleInput = existing.querySelector('.inline-title-input');
                    if (titleInput && titleInput.value !== (note.title || '')) {
                        titleInput.value = note.title || '';
                    }
                }

                // --- Collapse State Sync (Persisted DB State) ---
                if (note.is_collapsed && !existing.classList.contains('collapsed')) {
                    existing.classList.add('collapsed');
                    const btn = existing.querySelector('.btn-icon-collapse');
                    if (btn) btn.innerHTML = '🔻';
                } else if (!note.is_collapsed && existing.classList.contains('collapsed')) {
                    existing.classList.remove('collapsed');
                    const btn = existing.querySelector('.btn-icon-collapse');
                    if (btn) btn.innerHTML = '🔺';
                }

                // State Indicators: viewer reference and dashboard metrics for priority reconciliation
                const viewer = existing.querySelector('.note-text-viewer');
                const isDashboard = typeof NoteParser !== 'undefined' && NoteParser.isDashboard(note.content || '');

                // --- Attachment Identity Reconciliation (Priority 1) ---
                // We compare sorted signatures (blob_id:filename) to detect renames and swaps.
                // An attachment change triggers a full content re-render, which includes text.
                const newSig = (note.attachments || [])
                    .map(a => `${a.blob_id}:${encodeURIComponent(a.filename || '')}`)
                    .sort()
                    .join('|');

                const domSig = Array.from(existing.querySelectorAll('.file-name-display[data-blob-id]'))
                    .map(el => `${el.dataset.blobId}:${encodeURIComponent(el.textContent.trim() || '')}`)
                    .sort()
                    .join('|');
                
                if (domSig !== newSig) {
                    const contentDiv = existing.querySelector('.note-content');
                    if (contentDiv) {
                        contentDiv.innerHTML = generateNoteContentHtml(note, canEdit, isDashboard);
                        existing.dataset.lastContent = note.content;
                        // State Synchronization: root element dashboard classes based on current content
                        existing.classList.toggle('is-dashboard-note', isDashboard);
                    }
                } 
                // --- Content & Identity Reconciliation (Priority 2) ---
                // Targeted hydration: Only update viewer if attachments didn't change but text did.
                else if (viewer && existing.dataset.lastContent !== note.content) {
                    viewer.innerHTML = formatNoteContent(note.content, note.id);
                    const textarea = existing.querySelector('textarea');
                    if (textarea) textarea.value = note.content || '';
                    existing.dataset.lastContent = note.content;
                    
                    // Synchronize state-driven classes across the root and child segments
                    existing.classList.toggle('is-dashboard-note', isDashboard);
                    
                // --- Global Identity Reconciliation (Title, Scaling, Icons) ---
                const textSection = existing.querySelector('.note-text-section');
                if (textSection) {
                    textSection.classList.toggle('is-dashboard', isDashboard);
                    if (titleSlot) {
                        // High-Fidelity Header State: icons and favicons for dashboard mode notes
                        const expectedTitleHtml = (isDashboard && typeof NoteParser !== 'undefined')
                            ? (NoteParser.renderHeader(note.title) || window.escapeHtml(note.title || 'Untitled Note'))
                            : window.escapeHtml(note.title || 'Untitled Note');
                        
                        if (titleSlot.innerHTML !== expectedTitleHtml) {
                            titleSlot.innerHTML = expectedTitleHtml;
                        }
                    }

                    const isEmpty = (!note.content || note.content.trim() === '');
                    textSection.classList.toggle('hidden', isEmpty);
                }
                }
            } else {
                // Creation: New note entered the active isolation layer
                const noteEl = createNoteElement(note, canEdit);
                canvas.appendChild(noteEl);

                if (STATE.editMode && canEdit) {
                    // Resizing is now handled via centralized delegation in interactions.js
                }
            }
        } catch (e) {
            // Deduplication Guard: Only log the first occurrence of a specific note failure per session/load
            if (!window._renderErrors.has(note.id)) {
                window._renderErrors.add(note.id);
                console.error(`[renderUI] Failed to render note ${note.id}:`, e);
            }
        }
    });

    // Removal: Prune any notes that were moved to another level or deleted
    existingNotes.forEach(el => {
        const elId = el.dataset.id;
        if (!activeIds.has(elId)) {
            el.classList.add('row-fade-out');
            setTimeout(() => {
                if (el.parentNode && !activeIds.has(elId)) {
                    el.remove();
                } else {
                    el.classList.remove('row-fade-out');
                }
            }, 500);
        }
    });

    // Radar Integration: Update the Birds-Eye perspective in atomic sync
    if (typeof updateRadar === 'function') updateRadar();
}

/**
 * Updates the visual level indicator, displaying descriptive aliases if configured.
 * @returns {void}
 */
function updateLevelDisplay() {
    const display = document.getElementById('level-display');
    if (!display) return;

    const level = STATE.activeLayerId;
    const alias = STATE.layer_map[level];
    
    // Logic Gate: Avoid layout thrash by skipping redundancy
    // If the data is identical to the current DOM state, we exit immediately.
    const currentNum = display.querySelector('.level-num')?.textContent;
    const currentAlias = display.querySelector('.level-alias')?.textContent;
    if (currentNum == level && currentAlias == (alias || '')) {
        return;
    }

    // Clear any pending auto-collapse from a previous level switch
    if (window._levelAliasCollapseTimer) {
        clearTimeout(window._levelAliasCollapseTimer);
        window._levelAliasCollapseTimer = null;
    }

    if (alias) {
        display.classList.add('is-active');
        display.innerHTML = `
            <span class="level-num">${level}</span>
            <span class="level-alias-meta">
                &nbsp;-&nbsp;<span class="level-alias">${window.escapeHtml(alias)}</span>
            </span>
        `;
        display.title = `Level ${level}: ${alias} (Click to Jump/Rename)`;

        // Auto-Collapse: After 2s the alias fades out; hover re-reveals it.
        // We use a self-correcting check to skip collapse if the user is currently hovering.
        window._levelAliasCollapseTimer = setTimeout(() => {
            if (display.matches(':hover')) return; // Abort if user is interacting
            const aliasMeta = display.querySelector('.level-alias-meta');
            if (aliasMeta) aliasMeta.classList.add('is-hidden');
        }, 2000);
    } else {
        display.classList.remove('is-active');
        display.innerHTML = `<span class="level-num">${level}</span>`;
        display.title = `Level ${level} (Click to Jump/Rename)`;
    }
}



/**
 * Creates the DOM element for a sticky note.
 * @param {Object} note - The note data object.
 * @param {boolean} canEdit - Permission flag.
 */
function createNoteElement(note, canEdit = true) {
    const isExternallyLocked = note.locked_by_session_id && note.locked_by_session_id !== STATE.sessionId;
    const isDashboard = typeof NoteParser !== 'undefined' && NoteParser.isDashboard(note.content || '');
    const div = document.createElement('div');
    div.className = `sticky-note ${note.is_collapsed ? 'collapsed' : ''} ${canEdit ? 'can-edit' : ''} ${isExternallyLocked ? 'is-externally-locked' : ''} ${isDashboard ? 'is-dashboard-note' : ''}`;
    div.id = `note-${note.id}`;
    div.dataset.id = note.id;
    // Atomic Context: Capture content baseline for reconciliation
    div.dataset.lastContent = note.content || '';
    
    // Apply custom accent color via CSS variable
    const accentColor = normalizeColorHex(note.color);
    div.style.setProperty('--note-accent', accentColor);
    
    // Apply position and z-index (Absolute coordinates 0-5000)
    div.style.left = `${note.x}px`;
    div.style.top = `${note.y}px`;
    if (note.width)  div.style.width = `${note.width}px`;
    if (note.height) div.style.height = `${note.height}px`;
    div.style.zIndex = note.z_index || 1;

    const contentHtml = generateNoteContentHtml(note, canEdit, isDashboard);
    const titleHtml   = isDashboard && typeof NoteParser !== 'undefined' 
        ? (NoteParser.renderHeader(note.title) || window.escapeHtml(note.title || 'Untitled Note'))
        : window.escapeHtml(note.title || 'Untitled Note');

    
    div.innerHTML = `
        <div class="note-header">
            <span class="note-id-hash" data-id="${note.id}" title="Copy Content to Clipboard">📋</span>
            <input type="color" class="inline-color-input" value="${accentColor}" 
                   oninput="updateNoteAccent(this, ${note.id})" title="Change Note Color" ${canEdit ? '' : 'disabled'}>
            
            <div class="note-drag-handle-container" title="Click anywhere in the title bar to Pick and Place (Sticky Move)">
                <div class="note-title-slot">
                    ${titleHtml}
                </div>
                <input type="text" class="inline-title-input" value="${window.escapeHtml(note.title || '')}" 
                       onclick="event.stopPropagation()"
                       placeholder="Note Title..." autocomplete="off">
            </div>
            <div class="note-actions">
                <button class="btn-icon-link" title="Copy Direct Link">
                    🔗
                </button>
                <button class="btn-icon-upload note-inline-upload-btn ${(note.attachments || []).length > 0 ? '' : 'text-only-upload'}" 
                        title="Add Attachment" 
                        ${canEdit ? '' : 'style="display:none;" disabled'}>
                    📎
                </button>
                <button class="btn-icon-move" title="Copy to Canvas" ${canEdit ? '' : 'disabled'}>
                    📦
                </button>
                <button class="btn-icon-level-copy" title="Copy to Level" ${canEdit ? '' : 'disabled'}>
                    📚
                </button>
                <button class="btn-icon-view" title="Quick View">
                    👁️
                </button>
                <button class="btn-icon-delete" title="Delete Note" ${canEdit ? '' : 'disabled'}>
                    🗑️
                </button>
                <button class="btn-icon-edit" title="Edit Content" ${canEdit ? '' : 'disabled'}>
                    ✏️
                </button>
                <button class="btn-icon-collapse" title="${note.is_collapsed ? 'Expand' : 'Collapse'} Note">
                    ${note.is_collapsed ? '🔻' : '🔺'}
                </button>
                <input type="file" id="inline-file-${note.id}" class="hidden-input" onchange="handleInlineFileSelection(event, ${note.id})">
            </div>
        </div>
        <div class="note-content">
            ${contentHtml}
        </div>
        <div class="note-resize-handle nw" ${canEdit ? '' : 'style="display:none;"'}></div>
        <div class="note-resize-handle ne" ${canEdit ? '' : 'style="display:none;"'}></div>
        <div class="note-resize-handle sw" ${canEdit ? '' : 'style="display:none;"'}></div>
        <div class="note-resize-handle se" ${canEdit ? '' : 'style="display:none;"'}></div>
    `;

    if (isExternallyLocked) {
        const isSameUser = (note.locked_by_user_id == STATE.user_id);
        const lockerText = isSameUser ? 'Edited in another session' : `${note.locking_user_name || 'Someone'} is editing`;
        
        const overlay = document.createElement('div');
        overlay.className = 'note-lock-overlay';
        overlay.innerHTML = `<div class="lock-icon">🔒</div><div class="lock-user">${window.escapeHtml(lockerText)}</div>`;
        div.appendChild(overlay);
    }

    return div;
}


/**
 * Generates the inner HTML for the note-content section.
 * Extracted for use in both createNoteElement and surgical renderUI updates.
 */
function generateNoteContentHtml(note, canEdit, isDashboard = null) {
    let textHtml = '';
    const viewerHtml = formatNoteContent(note.content || '', note.id);
    const isTextEmpty = (!note.content || note.content.trim() === '');
    
    // Resolve: If dashboard status isn't provided by parent, fallback to detection
    if (isDashboard === null) {
        isDashboard = typeof NoteParser !== 'undefined' && NoteParser.isDashboard(note.content || '');
    }
    textHtml = `
        <div class="note-text-section ${isTextEmpty ? 'hidden' : ''} ${isDashboard ? 'is-dashboard' : ''}">
            <div class="note-text-viewer" data-id="${note.id}">${viewerHtml}</div>
            <textarea readonly onkeydown="handleNoteKeydown(event, ${note.id})">${window.escapeHtml(note.content || '')}</textarea>
        </div>
    `;

    let attachmentHtml = '';
    const attachments = note.attachments || [];
    const isHeroCandidate = (attachments.length === 1);
    
    // Multi-Item Detection: Determines if we should show granular asset controls
    const hasText = note.content && note.content.trim().length > 0;
    const isMultiItem = (attachments.length > 1) || (attachments.length === 1 && hasText);

    if (attachments.length > 0) {
        const firstAtt = attachments[0];
        const firstIsImg = firstAtt.mime_type && firstAtt.mime_type.startsWith('image/');
        
        if (isHeroCandidate) {
            if (firstIsImg) {
                attachmentHtml = `
                    <div class="note-hero-container" onclick="if(!document.getElementById('note-${note.id}').classList.contains('is-editing')) viewNoteImage(${note.id}, ${firstAtt.blob_id})">
                        <img src="/notes/attachment/serve/${firstAtt.blob_id}" class="note-hero-img" alt="${window.escapeHtml(firstAtt.filename)}">
                        <div class="file-name-display" data-blob-id="${firstAtt.blob_id}" onclick="event.stopPropagation()">${window.escapeHtml(firstAtt.filename)}</div>
                        <div class="attachment-float-controls">
                            ${isMultiItem ? `<button class="btn-icon-copy hero-action-btn" onclick="event.stopPropagation(); copyNoteToClipboard(${note.id}, ${firstAtt.blob_id})" title="Copy Image">📋</button>` : ''}
                            <button class="btn-icon-delete hero-action-btn edit-mode-only" onclick="event.stopPropagation(); confirmAttachmentRemoval(${note.id}, ${firstAtt.blob_id})" title="Remove Attachment" ${canEdit ? '' : 'style="display:none;"'}>🗑️</button>
                        </div>
                    </div>
                `;
            } else {
                const isPdf = firstAtt.mime_type === 'application/pdf' || (firstAtt.filename && firstAtt.filename.toLowerCase().endsWith('.pdf'));
                const clickAction = isPdf 
                    ? `openPDFViewer(${firstAtt.blob_id}, '${window.escapeHtml(firstAtt.filename).replace(/'/g, "\\'")}')`
                    : `const a=document.createElement('a');a.href='/notes/attachment/serve/${firstAtt.blob_id}';a.download='${window.escapeHtml(firstAtt.filename).replace(/'/g, "\\'")}';a.click();`;

                attachmentHtml = `
                    <div class="note-attachment-stack">
                        <div class="attachment-item-stack" 
                             onclick="if(!document.getElementById('note-${note.id}').classList.contains('is-editing')){ ${clickAction} } event.stopPropagation();">
                            <div class="attachment-icon-stack">${isPdf ? '📄' : '📁'}</div>
                            <div class="file-name-display" data-blob-id="${firstAtt.blob_id}" onclick="event.stopPropagation()">${window.escapeHtml(firstAtt.filename)}</div>
                        </div>
                        <div class="attachment-float-controls">
                            <button class="btn-icon-delete hero-action-btn edit-mode-only" onclick="event.stopPropagation(); confirmAttachmentRemoval(${note.id}, ${firstAtt.blob_id})" title="Remove Attachment" ${canEdit ? '' : 'style="display:none;"'}>🗑️</button>
                        </div>
                    </div>
                `;
            }
        } else {
            attachmentHtml = `<div class="note-attachment-stack">`;
            attachments.forEach(att => {
                const isImg = att.mime_type && att.mime_type.startsWith('image/');
                const isPdf = att.mime_type === 'application/pdf' || (att.filename && att.filename.toLowerCase().endsWith('.pdf'));
                const openAction = isPdf
                    ? `openPDFViewer(${att.blob_id}, '${window.escapeHtml(att.filename).replace(/'/g, "\\'")}')`
                    : isImg
                        ? `viewNoteImage(${note.id}, ${att.blob_id})`
                        : `const a=document.createElement('a');a.href='/notes/attachment/serve/${att.blob_id}';a.download='${window.escapeHtml(att.filename).replace(/'/g, "\\'")}';a.click()`;

                if (isImg) {
                    attachmentHtml += `
                        <div class="attachment-item-stack attachment-item-stack--image"
                             onclick="if(document.getElementById('note-${note.id}').classList.contains('is-editing')) { event.stopPropagation(); } else { ${openAction}; event.stopPropagation(); }">
                            <img src="/notes/attachment/serve/${att.blob_id}" class="attachment-full-img" alt="${window.escapeHtml(att.filename)}">
                            <div class="file-name-display" data-blob-id="${att.blob_id}" onclick="event.stopPropagation()">${window.escapeHtml(att.filename)}</div>
                            <div class="attachment-float-controls">
                                <button class="btn-icon-copy reel-action-btn" onclick="event.stopPropagation(); copyNoteToClipboard(${note.id}, ${att.blob_id})" title="Copy Image">📋</button>
                                <button class="btn-icon-delete reel-action-btn edit-mode-only" onclick="event.stopPropagation(); confirmAttachmentRemoval(${note.id}, ${att.blob_id})" title="Remove" ${canEdit ? '' : 'style="display:none;"'}>🗑️</button>
                            </div>
                        </div>`;
                } else {
                    attachmentHtml += `
                        <div class="attachment-item-stack" title="${window.escapeHtml(att.filename)}"
                             onclick="if(document.getElementById('note-${note.id}').classList.contains('is-editing')) { event.stopPropagation(); } else { ${openAction}; event.stopPropagation(); }">
                            <div class="attachment-icon-stack">${isPdf ? '📄' : '📁'}</div>
                            <div class="file-name-display" data-blob-id="${att.blob_id}" onclick="event.stopPropagation()">${window.escapeHtml(att.filename)}</div>
                            <div class="attachment-float-controls">
                                <button class="btn-icon-delete reel-action-btn edit-mode-only" onclick="event.stopPropagation(); confirmAttachmentRemoval(${note.id}, ${att.blob_id})" title="Remove" ${canEdit ? '' : 'style="display:none;"'}>🗑️</button>
                            </div>
                        </div>`;
                }
            });
            attachmentHtml += `</div>`;
        }
    }

    const showSeparator = !isTextEmpty && (attachments.length > 0);
    return `
        ${textHtml}
        ${showSeparator ? '<hr class="note-separator">' : ''}
        ${attachmentHtml}
    `;
}

/**
 * Formats the raw note content, converting Markdown and Todo-list syntax.
 * @param {string} content - Raw note text.
 * @param {number} noteId - The parent note ID.
 * @returns {string} - Formatted HTML.
 */
function formatNoteContent(content, noteId) {
    if (!content) return '';

    // Safety Gate: Ensure Parser is loaded. If not, emit safe literal text.
    if (typeof NoteParser === 'undefined') {
        console.warn('NoteParser not ready; falling back to literal rendering.');
        return window.escapeHtml(content).replace(/\n/g, '<br>');
    }

    return NoteParser.parse(content, noteId);
}

/**
 * Normalizes color strings for reliable CSS property application.
 * @param {string} color - Input color (Name or Hex).
 * @returns {string} - Canonical Hex code.
 */
function normalizeColorHex(color) {
    if (!color) return '#fef3c7';
    
    // Core Project Palette: Semantic tokens mapped to canonical hex
    const map = {
        'yellow':  '#f59e0b',
        'blue':    '#3b82f6',
        'pink':    '#ec4899',
        'orange':  '#f97316',
        'violet':  '#8b5cf6',
        'indigo':  '#6366f1',
        'slate':   '#64748b',
        'green':   '#22c55e',
        'red':     '#ef4444',
        // Semantic Extensions
        'accent':  '#3b82f6',
        'info':    '#3b82f6',
        'success': '#10b981',
        'danger':  '#ef4444',
        'warning': '#f59e0b'
    };
    
    return map[color.toLowerCase()] || (color.startsWith('#') ? color : '#f59e0b');
}

/**
 * Utility: Standardizes file size presentation.
 * Mounted to window to allow use in template strings.
 */
window.formatBytes = function(bytes, decimals = 1) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

// Global Orchestration Handlers
window.normalizeColorHex = typeof normalizeColorHex !== 'undefined' ? normalizeColorHex : null;
window.generateNoteContentHtml = typeof generateNoteContentHtml !== 'undefined' ? generateNoteContentHtml : null;
window.renderUI = typeof renderUI !== 'undefined' ? renderUI : null;
