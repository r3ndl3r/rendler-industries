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
                // Update Existing: Surgical property updates to preserve focus/scroll
                // Skip update if the user is currently interacting with this specific note
                if (existing.classList.contains('is-editing') || (STATE.pickedNoteId == note.id)) return;

                // Atomic Synchronicity: Check if we need to update position/z-index
                const curX = parseInt(existing.style.left);
                const curY = parseInt(existing.style.top);
                const curZ = parseInt(existing.style.zIndex);
                
                if (curX != note.x) existing.style.left = `${note.x}px`;
                if (curY != note.y) existing.style.top = `${note.y}px`;
                if (curZ != note.z_index) existing.style.zIndex = note.z_index || 1;

                // Content Reconciliation: Only update HTML if content/title changed
                // This prevents the "flash" inside the note and maintains text selection
                const curTitle = existing.querySelector('.note-title-slot')?.textContent;
                if (curTitle !== (note.title || 'Untitled Note')) {
                    const titleInput = existing.querySelector('.inline-title-input');
                    const titleSlot  = existing.querySelector('.note-title-slot');
                    if (titleInput) titleInput.value = note.title || '';
                    if (titleSlot)  titleSlot.textContent = note.title || 'Untitled Note';
                }

                // Collapse state sync
                if (note.is_collapsed && !existing.classList.contains('collapsed')) {
                    existing.classList.add('collapsed');
                    const btn = existing.querySelector('.btn-icon-collapse');
                    if (btn) btn.innerHTML = '🔻';
                } else if (!note.is_collapsed && existing.classList.contains('collapsed')) {
                    existing.classList.remove('collapsed');
                    const btn = existing.querySelector('.btn-icon-collapse');
                    if (btn) btn.innerHTML = '🔺';
                }

                // Attachment Identity Reconciliation (High-Fidelity Signature)
                // We compare sorted signatures (blob_id:filename) to detect renames and swaps
                const newSig = (note.attachments || [])
                    .map(a => `${a.blob_id}:${encodeURIComponent(a.filename || '')}`)
                    .sort()
                    .join('|');

                const domSig = Array.from(existing.querySelectorAll('.file-name-display[data-blob-id]'))
                    .map(el => `${el.dataset.blobId}:${encodeURIComponent(el.textContent.trim() || '')}`)
                    .sort()
                    .join('|');
                
                if (domSig !== newSig) {
                    // DOM Identity Diff detected: Perform a surgical content hydration
                    const contentDiv = existing.querySelector('.note-content');
                    if (contentDiv) {
                        contentDiv.innerHTML = generateNoteContentHtml(note, canEdit);
                    }
                }
            } else {
                // Creation: New note entered the active isolation layer
                const noteEl = createNoteElement(note, canEdit);
                canvas.appendChild(noteEl);
                
                if (STATE.editMode && canEdit) {
                    initResizable(noteEl, note);
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

    const contentHtml = generateNoteContentHtml(note, canEdit);

    div.innerHTML = `
        <div class="note-header">
            <span class="note-id-hash" data-id="${note.id}" title="Copy Content to Clipboard">📋</span>
            <input type="color" class="inline-color-input" value="${accentColor}" 
                   oninput="updateNoteAccent(this, ${note.id})" title="Change Note Color" ${canEdit ? '' : 'disabled'}>
            
            <div class="note-drag-handle-container" title="Click anywhere in the title bar to Pick and Place (Sticky Move)">
                <div class="note-title-slot">
                    ${window.escapeHtml(note.title || 'Untitled Note')}
                </div>
                <input type="text" class="inline-title-input" value="${window.escapeHtml(note.title || '')}" 
                       onclick="event.stopPropagation()"
                       placeholder="Note Title..." autocomplete="off">
            </div>
            <div class="note-actions">
                <div class="note-actions-drawer ${note.is_options_expanded ? 'expanded' : ''}" id="drawer-${note.id}">
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
                </div>
                <button class="btn-icon-collapse" title="${note.is_collapsed ? 'Expand' : 'Collapse'} Note">
                    ${note.is_collapsed ? '🔻' : '🔺'}
                </button>
                <button class="btn-icon-edit" title="Edit Content" ${canEdit ? '' : 'disabled'}>
                    ✏️
                </button>
                <button class="btn-icon-drawer ${note.is_options_expanded ? 'active' : ''}" data-id="${note.id}" title="Toggle Actions">
                    ❮
                </button>
                <input type="file" id="inline-file-${note.id}" class="hidden-input" onchange="handleInlineFileSelection(event, ${note.id})">
            </div>
        </div>
        <div class="note-content">
            ${contentHtml}
        </div>
        <div class="note-resize-handle" ${canEdit ? '' : 'style="display:none;"'}></div>
    `;

    return div;
}

/**
 * Generates the inner HTML for the note-content section.
 * Extracted for use in both createNoteElement and surgical renderUI updates.
 */
function generateNoteContentHtml(note, canEdit) {
    let textHtml = '';
    const viewerHtml = formatNoteContent(note.content || '', note.id);
    textHtml = `
        <div class="note-text-section" ${(!note.content || note.content.trim() === '') ? 'style="display:none;"' : ''}>
            <div class="note-text-viewer" data-id="${note.id}">${viewerHtml}</div>
            <textarea readonly onkeydown="handleNoteKeydown(event, ${note.id})">${window.escapeHtml(note.content || '')}</textarea>
        </div>
    `;

    let attachmentHtml = '';
    const attachments = note.attachments || [];
    const isHeroCandidate = (attachments.length === 1);
    
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
                            <button class="btn-icon-delete hero-action-btn edit-mode-only" onclick="event.stopPropagation(); queueAttachmentDelete(${note.id}, ${firstAtt.blob_id})" title="Remove Attachment" ${canEdit ? '' : 'style="display:none;"'}>🗑️</button>
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
                            <button class="btn-icon-delete hero-action-btn edit-mode-only" onclick="event.stopPropagation(); queueAttachmentDelete(${note.id}, ${firstAtt.blob_id})" title="Remove Attachment" ${canEdit ? '' : 'style="display:none;"'}>🗑️</button>
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
                                <button class="btn-icon-delete reel-action-btn edit-mode-only" onclick="event.stopPropagation(); queueAttachmentDelete(${note.id}, ${att.blob_id})" title="Remove" ${canEdit ? '' : 'style="display:none;"'}>🗑️</button>
                            </div>
                        </div>`;
                } else {
                    attachmentHtml += `
                        <div class="attachment-item-stack" title="${window.escapeHtml(att.filename)}"
                             onclick="if(document.getElementById('note-${note.id}').classList.contains('is-editing')) { event.stopPropagation(); } else { ${openAction}; event.stopPropagation(); }">
                            <div class="attachment-icon-stack">${isPdf ? '📄' : '📁'}</div>
                            <div class="file-name-display" data-blob-id="${att.blob_id}" onclick="event.stopPropagation()">${window.escapeHtml(att.filename)}</div>
                            <div class="attachment-float-controls">
                                <button class="btn-icon-delete reel-action-btn edit-mode-only" onclick="event.stopPropagation(); queueAttachmentDelete(${note.id}, ${att.blob_id})" title="Remove" ${canEdit ? '' : 'style="display:none;"'}>🗑️</button>
                            </div>
                        </div>`;
                }
            });
            attachmentHtml += `</div>`;
        }
    }

    const hasBoth = textHtml && (attachments.length > 0);
    return `
        ${textHtml}
        ${hasBoth ? '<hr class="note-separator">' : ''}
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

    // 1. SECURITY: Split content into lines and escape each line individually.
    // This preserves \n for later <br> conversion while preventing XSS.
    let escapedLines = content.split('\n').map(line => window.escapeHtml(line));

    // 2. TRANSFORMATION: Checkboxes / Todo Lists
    let processedContent = escapedLines.map((line, index) => {
        // High-Fidelity Regex: Matches [], [ ], [x], and [X] at the start of the line (ignoring indentation)
        const match = line.match(/^(\s*)\[( |x|)\](.*)$/);
        if (match) {
            const prefix   = match[1];
            const state    = match[2];
            const text     = match[3].trim();
            const checked  = state === 'x';
            const checkedClass = checked ? 'checked' : '';
            
            return `${prefix}<span class="checkbox-row-inline note-check-trigger ${checkedClass}" data-note-id="${noteId}" data-index="${index}"><span class="cb ${checkedClass}"></span>${text}</span>`;
        }
        return line;
    }).join('\n');

    // 3. TRANSFORMATION: [color:#hex]...[/color]
    processedContent = processedContent.replace(/\[color:(#?[a-zA-Z0-9]+)\](.*?)\[\/color\]/g, (match, color, text) => {
        // Security Hardening: Validate hex or system-named color allowlist
        const isHex = /^#[0-9a-fA-F]{3,8}$/.test(color);
        const systemColors = ['yellow', 'blue', 'pink', 'orange', 'violet', 'indigo', 'slate', 'green', 'red'];
        const isNamed = systemColors.includes(color.toLowerCase());

        if (isHex || isNamed) {
            return `<span style="color: ${color}">${text}</span>`;
        }
        return text; // Fail-safe: Render plain text if identifier is invalid
    });

    // 4. TRANSFORMATION: [note:123] Reference Resolution
    processedContent = processedContent.replace(/\[note:(\d+)\]/g, (match, id) => {
        const target = STATE.note_map[id];
        const safeTitle = target ? window.escapeHtml(target.title || target) : `Note #${id}`;
        return `<span class="note-ref note-link-trigger" data-target-id="${id}" title="Jump to Note: ${safeTitle}">${safeTitle}</span>`;
    });

    // 5. TRANSFORMATION: [img:id|width] or [image:id:scale]
    processedContent = processedContent.replace(/\[(?:img|image):(\d+)(?:[:|](\d+(?:\.\d+)?))?\]/g, (match, id, val) => {
        const meta = STATE.note_map[id];
        let width = 100;
        if (val) {
            width = parseFloat(val) <= 1.0 ? parseFloat(val) * 100 : parseFloat(val);
        }

        // Resolving the Image Source: Checking both direct properties and attachment arrays
        const attachments = meta ? (meta.attachments || []) : [];
        const blobId      = (meta && meta.blob_id) ? meta.blob_id : (attachments[0] ? attachments[0].blob_id : null);
        const src         = blobId ? `/notes/attachment/serve/${blobId}` : `/notes/serve/${id}`;
        const safeTitle   = meta   ? window.escapeHtml(meta.title || id) : `Image #${id}`;
        
        // Interaction Logic: Direct viewing for blobs, navigation as fallback
        const viewAction = blobId ? `if(typeof viewNoteImage === 'function') viewNoteImage(${id}, ${blobId});` : `if(typeof handleNoteLinkClick === 'function') handleNoteLinkClick(${id});`;

        // Metadata Breakdown
        const att         = attachments[0] || {};
        const ext         = att.mime_type ? att.mime_type.split('/')[1].toUpperCase() : 'IMG';
        const sizeStr     = att.file_size ? `${window.formatBytes(att.file_size)}` : '';
        const metaInfo    = [ext, sizeStr, `#${id}`].filter(Boolean).join(' • ');

        return `<div class="note-embedded-wrap" onclick="${viewAction} event.stopPropagation();" title="View: ${safeTitle}" style="width: ${width}%;"><img src="${src}" class="note-embedded-img" alt="${safeTitle}" loading="lazy"><div class="note-embedded-caption">🖼️ ${safeTitle} (${metaInfo})</div></div>`;
    });

    // 6. Transformation: [file:123]
    processedContent = processedContent.replace(/\[file:(\d+)\]/g, (match, id) => {
        const meta        = STATE.note_map[id];
        const attachments = meta ? (meta.attachments || []) : [];
        const blobId      = (meta && meta.blob_id) ? meta.blob_id : (attachments[0] ? attachments[0].blob_id : null);
        const src         = blobId ? `/notes/attachment/serve/${blobId}` : `/notes/serve/${id}`;
        const safeTitle   = meta   ? window.escapeHtml(meta.title || id) : `File #${id}`;
        return `<a href="${src}" class="note-ref" download onclick="event.stopPropagation()"><span class="global-icon">📁</span> ${safeTitle}</a>`;
    });

    // 7. Transformation: [iframe:url] or [iframe:url|height]
    processedContent = processedContent.replace(/\[iframe:(.*?)(?:\|(\d+))?\]/g, (match, url, height) => {
        const trimmedUrl = url.trim();
        // Validation: Only allow absolute http/https URLs to prevent relative path 404s and security risks
        if (!/^https?:\/\//i.test(trimmedUrl)) {
            return match; // Return as literal text if it's not a valid web URL
        }
        const style = height ? `style="height: ${height}px;"` : 'class="iframe-fill"';
        return `<div class="note-iframe-wrap" ${style}><iframe src="${trimmedUrl}" width="100%" height="100%" frameborder="0" allowfullscreen></iframe></div>`;
    });

    // 8. Transformation: Raw URL Linkification (http/https)
    processedContent = processedContent.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, (match, prefix, url) => {
        return `${prefix}<a href="${url}" target="_blank" rel="noopener noreferrer" class="note-external-link" onclick="event.stopPropagation()">${url}</a>`;
    });

    // 9. Transformation: Basic Markdown & Line Breaks
    processedContent = processedContent
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');

    return processedContent;
}

/**
 * Normalizes color strings for reliable CSS property application.
 * @param {string} color - Input color (Name or Hex).
 * @returns {string} - Canonical Hex code.
 */
function normalizeColorHex(color) {
    if (!color) return '#fef3c7';
    
    const map = {
        'yellow':  '#f59e0b',
        'blue':    '#3b82f6',
        'pink':    '#ec4899',
        'orange':  '#f97316',
        'violet':  '#8b5cf6',
        'indigo':  '#6366f1',
        'slate':   '#64748b',
        'green':   '#22c55e',
        'red':     '#ef4444'
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
window.generateNoteContentHtml = typeof generateNoteContentHtml !== 'undefined' ? generateNoteContentHtml : null;
window.renderUI = typeof renderUI !== 'undefined' ? renderUI : null;
