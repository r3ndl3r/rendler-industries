// /public/js/notes/attachments.js

/**
 * Handle local file selection for note attachments.
 * @param {Event} e - The change event from the file input.
 */
function handleFileSelection(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Type Normalization: Images get special rendering/previews, others become generic 'file'
    const isImage = file.type.startsWith('image/');
    const type = isImage ? 'image' : 'file';

    // Unified completion path for both Async (Image) and Sync (Generic File) flows
    const finalize = (data = null) => {
        // 1. Maintain the Multi-File Reel Queue
        if (!DRAFT_NOTE.pendingFiles) DRAFT_NOTE.pendingFiles = [];
        DRAFT_NOTE.pendingFiles.push({ 
            file, 
            data, 
            type, 
            filename: file.name 
        });

        // 2. Refresh the draft context metadata
        DRAFT_NOTE.type = type;
        if (data) DRAFT_NOTE.data = data;
        DRAFT_NOTE.filename = file.name;

        // 3. UI Optimization: Auto-fill title if currently primitive/untitled
        const titleInput = document.getElementById('create-note-title');
        if (titleInput && (!titleInput.value || titleInput.value === 'Untitled Note' || titleInput.value === 'Add Note')) {
            titleInput.value = file.name;
        }

        // 4. Update Reel & Notify
        renderDraftReel();
        showToast(`File attached: ${file.name}`, 'success');
    };

    if (isImage) {
        // Images require a DataURL for the reel preview
        const reader = new FileReader();
        reader.onload = (event) => finalize(event.target.result);
        reader.readAsDataURL(file);
    } else {
        // Generic files don't need a preview; bypass the reader to avoid dead-code callbacks
        finalize(null);
    }
}

/**
 * Immediate Atomic Deletion: Removes a file from the note and MariaDB instantly.
 * No more 'pending removal' feedback; the file is simply gone upon confirmation.
 */
function queueAttachmentDelete(noteId, blobId) {
    // Context Resolution: Use provided ID or active draft ID
    const activeNoteId = noteId || DRAFT_NOTE?.id;

    window.showConfirmModal({
        title: 'Delete Attachment',
        message: 'Are you sure you want to permanently remove this file? This action CANNOT be undone.',
        confirmText: 'Delete Now',
        confirmIcon: '🗑️',
        icon: '⚠️',
        hideCancel: true,
        danger: true,
        onConfirm: async () => {
            // Case A: Existing Database Record (Requires API call)
            if (activeNoteId) {
                const res = await apiPost('/notes/api/attachment/delete', {
                    note_id: activeNoteId,
                    blob_id: blobId,
                    canvas_id: STATE.canvas_id
                });
                
                if (res && res.success) {
                    STATE.notes = res.notes;
                    STATE.last_mutation = res.last_mutation;
                    
                    const note = STATE.notes.find(n => n.id == activeNoteId);
                    
                    // Surgical DOM Refinement: Update the note's inline attachment view immediately
                    const contentEl = document.querySelector(`#note-${activeNoteId} .note-content`);
                    if (contentEl && typeof generateNoteContentHtml === 'function') {
                        contentEl.innerHTML = generateNoteContentHtml(note, note.user_id == STATE.user_id);
                    }

                    // Global Persistence: Trigger a standard UI reconcile (background)
                    if (typeof renderUI === 'function') renderUI();
                    
                    renderCreateFooterReel(note ? note.attachments : []);
                    showToast('Attachment permanently deleted', 'success');
                }
            } else {
                // Case B: In-Memory Draft (Local removal only)
                // This shouldn't normally happen with blobIds, but we handle for safety
                if (typeof renderDraftReel === 'function') renderDraftReel();
                showToast('Attachment removed from draft', 'info');
            }
        }
    });
}

/**
 * Removes a file from the pending upload queue before it is saved.
 */
function removePendingUpload(index) {
    if (DRAFT_NOTE && DRAFT_NOTE.pendingFiles) {
        DRAFT_NOTE.pendingFiles.splice(index, 1);
        const note = DRAFT_NOTE.id ? STATE.notes.find(n => n.id == DRAFT_NOTE.id) : null;
        renderCreateFooterReel(note ? note.attachments : []);
    }
}

/**
 * Atomic Purge: Permanently removes ALL attachments from the note and clears the pending reel.
 * Triggers instant backend deletion for existing records.
 */
function confirmPurgeAll() {
    if (!DRAFT_NOTE) return;

    window.showConfirmModal({
        title: 'Purge All Attachments',
        message: 'Are you sure you want to PERMANENTLY delete ALL attachments from this note? This cannot be undone.',
        confirmText: 'Purge Now',
        confirmIcon: '🗑️',
        icon: '⚠️',
        danger: true,
        onConfirm: async () => {
            let successTriggered = false;
            let failCount = 0;

            // 1. Backend Purge for existing DB attachments
            if (DRAFT_NOTE.id) {
                const note = STATE.notes.find(n => n.id == DRAFT_NOTE.id);
                if (note && note.attachments && note.attachments.length > 0) {
                    // Capture a snapshot to prevent iteration over a potentially changing collection
                    const toDelete = [...note.attachments];
                    
                    for (const att of toDelete) {
                        const res = await apiPost('/notes/api/attachment/delete', {
                            note_id: DRAFT_NOTE.id,
                            blob_id: att.blob_id,
                            canvas_id: STATE.canvas_id
                        });
                        if (res && res.success) {
                            STATE.notes = res.notes;
                            STATE.last_mutation = res.last_mutation;
                            successTriggered = true;
                        } else {
                            failCount++;
                        }
                    }
                }
            }

            // 2. Clear local memory queue
            DRAFT_NOTE.pendingFiles = [];

            // 3. UI Synchronization
            if (successTriggered && typeof renderUI === 'function') renderUI();
            
            const note = DRAFT_NOTE.id ? STATE.notes.find(n => n.id == DRAFT_NOTE.id) : null;
            renderCreateFooterReel(note ? note.attachments : []);
            
            if (failCount > 0) {
                showToast(`Purge partial: ${failCount} files failed to delete`, 'warning');
            } else {
                showToast('All attachments permanently purged', 'success');
            }
        }
    });
}

/**
 * Multi-File Reel Renderers
 */
function renderCreateFooterReel(attachments) {
    const wrap = document.getElementById('footer-attachment-preview');
    if (!wrap) return;
    wrap.innerHTML = '';
    
    // 1. Existing Attachments
    attachments.forEach(att => {
        const id = att.blob_id || att.id;
        const isDeleted = (STATE.pendingDeletes || []).includes(id);
        const isImg = (att.mime_type && att.mime_type.startsWith('image/')) || (att.data && att.data.startsWith('data:image'));
        const isPdf = (att.mime_type === 'application/pdf') || (att.filename && att.filename.toLowerCase().endsWith('.pdf'));

        const item = document.createElement('div');
        item.className = `attachment-item-reel ${isDeleted ? 'pending-delete' : ''}`;
        item.title = att.filename || 'Attachment';
        
        if (isImg) {
            const img = document.createElement('img');
            img.className = 'attachment-thumb-reel';
            img.src = att.data || `/notes/attachment/serve/${id}`;
            item.appendChild(img);
        } else {
            const icon = document.createElement('div');
            icon.className = 'attachment-icon-reel';
            icon.textContent = isPdf ? '📄' : '📁';
            item.appendChild(icon);
        }
        
        // Add themed delete button for consistent UI
        const del = document.createElement('button');
        del.className = 'btn-icon-delete reel-action-btn'; // Use global thematic classes
        del.innerHTML = '🗑️';
        del.title = 'Remove';
        del.onclick = (e) => {
            e.stopPropagation();
            queueAttachmentDelete(null, id);
        };
        
        // Wrap controls in the standard float container
        const ctrls = document.createElement('div');
        ctrls.className = 'attachment-float-controls';
        ctrls.appendChild(del);
        item.appendChild(ctrls);
        
        wrap.appendChild(item);
    });

    // 2. New Pending Uploads (Handled by renderDraftReel typically, but unified here for safety)
    if (DRAFT_NOTE && DRAFT_NOTE.pendingFiles) {
        DRAFT_NOTE.pendingFiles.forEach((p, idx) => {
            const isImg = p.type === 'image';
            const item = document.createElement('div');
            item.className = 'attachment-item-reel';
            item.title = p.filename || 'New Attachment';
            
            if (isImg && p.data) {
                const img = document.createElement('img');
                img.className = 'attachment-thumb-reel';
                img.src = p.data;
                item.appendChild(img);
            } else {
                const icon = document.createElement('div');
                icon.className = 'attachment-icon-reel';
                icon.textContent = (p.filename && p.filename.toLowerCase().endsWith('.pdf')) ? '📄' : '📁';
                item.appendChild(icon);
            }
            
            // Add themed delete button for consistent UI
            const del = document.createElement('button');
            del.className = 'btn-icon-delete reel-action-btn';
            del.innerHTML = '🗑️';
            del.onclick = (e) => {
                e.stopPropagation();
                removePendingUpload(idx);
            };
            
            const ctrls = document.createElement('div');
            ctrls.className = 'attachment-float-controls';
            ctrls.appendChild(del);
            item.appendChild(ctrls);
            
            wrap.appendChild(item);
        });
    }

    // Toggle the main purge button visibility
    const purgeBtn = document.getElementById('purge-attachment-btn');
    if (purgeBtn) {
        const hasAttachments = (attachments.length > 0) || (DRAFT_NOTE && DRAFT_NOTE.pendingFiles && DRAFT_NOTE.pendingFiles.length > 0);
        purgeBtn.classList.toggle('hidden', !hasAttachments);
    }
}

function renderDraftReel() {
    const wrap = document.getElementById('footer-attachment-preview');
    if (!wrap) return;
    
    const note = DRAFT_NOTE.id ? STATE.notes.find(n => n.id == DRAFT_NOTE.id) : null;
    renderCreateFooterReel(note ? note.attachments : []);
}

function triggerInlineUpload(id) {
    const fileInput = document.getElementById(`inline-file-${id}`);
    if (fileInput) fileInput.click();
}

async function handleInlineFileSelection(e, id) {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('note_id', id);
    formData.append('canvas_id', STATE.canvas_id);
    formData.append('file', file);

    const el = document.getElementById(`note-${id}`);
    if (el) el.classList.add('pending');

    try {
        const uploadRes = await apiPost('/notes/api/upload', formData);
        if (uploadRes && uploadRes.success) {
            STATE.last_mutation = uploadRes.last_mutation;
            await loadState(false, STATE.canvas_id);
            showToast('Attachment added', 'success');
        } else {
            showToast('Failed to upload attachment', 'error');
        }
    } finally {
        if (el) el.classList.remove('pending');
    }
}

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
        if (files.length > 0) {
            await handleFileDrop(files[0], e.offsetX, e.offsetY);
        }
    });
}

async function handleFileDrop(file, x, y, customTitle = null) {
    if (!file) return;

    const formData = new FormData();
    formData.append('file',      file);
    formData.append('x',         Math.round(x));
    formData.append('y',         Math.round(y));
    formData.append('z_index',   STATE.notes.reduce((max, n) => Math.max(max, n.z_index || 0), 0) + 1);
    formData.append('canvas_id', STATE.canvas_id);
    formData.append('layer_id',  STATE.activeLayerId);
    
    if (customTitle) {
        formData.append('title', customTitle);
    }

    const uploadRes = await apiPost('/notes/api/upload', formData);
    if (uploadRes && uploadRes.success) {
        STATE.last_mutation = uploadRes.last_mutation;
        await loadState(false, STATE.canvas_id);
        showToast('Note Created with Attachment', 'success');
    }
}

/**
 * Legacy compatibility alias for handleFileDrop.
 * @param {Blob|File} file - The dropped file.
 * @param {number} x - Canvas X coordinate.
 * @param {number} y - Canvas Y coordinate.
 * @param {string|null} customTitle - Optional title.
 */
async function handleImageDrop(file, x, y, customTitle = null) {
    return handleFileDrop(file, x, y, customTitle);
}

/**
 * Global Clipboard Interface: Facilitates 'Ctrl+V' image pasting directly onto the canvas.
 */
async function handleGlobalClipPaste(e) {
    // Safety Guard: Do NOT capture paste if user is already focused on an input or textarea
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable) {
        return;
    }

    const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
    if (!items) return;

    for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
            const blob = item.getAsFile();
            const reader = new FileReader();
            reader.onload = (event) => {
                if (typeof showCreateNoteModal === 'function') {
                    showCreateNoteModal('image', event.target.result);
                }
            };
            reader.readAsDataURL(blob);
            break;
        } else if (item.type === 'text/plain') {
            item.getAsString((text) => {
                if (typeof showCreateNoteModal === 'function') {
                    showCreateNoteModal('text', text);
                }
            });
            break;
        }
    }
}

function purgeAllDraftAttachments() {
    if (typeof confirmPurgeAll === 'function') confirmPurgeAll();
}
