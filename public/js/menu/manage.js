// /public/js/menu/manage.js

/**
 * Menu Management Controller Module
 * 
 * This module manages the administrative Navigation interface. It coordinates 
 * the interactive ledger for platform links, including real-time reordering 
 * using Sortable.js and complex nested property configuration.
 * 
 * Features:
 * - Dynamic link creation and editing with permission level awareness
 * - Real-time drag-and-drop reordering with ghost-preview support
 * - Specialized "Separator" mode handling for UI organization
 * - Themed confirmation workflow for cascaded link deletion
 * - AJAX-driven state updates with automated page reconciliation
 * 
 * Dependencies:
 * - default.js: For apiPost, getIcon, and modal helpers
 * - toast.js: For status feedback
 * - sortable.js: For high-performance reordering logic
 */

document.addEventListener('DOMContentLoaded', function() {
    /**
     * UI Element Cache
     */
    const modal = document.getElementById('linkModal');
    const deleteConfirmModal = document.getElementById('deleteConfirmModal');
    const form = document.getElementById('linkForm');
    const addBtn = document.getElementById('addLinkBtn');
    const closeBtn = document.getElementById('closeModalBtn');
    const saveOrderBtn = document.getElementById('saveOrderBtn');
    const tableBody = document.getElementById('menuTableBody');
    
    /**
     * Application State
     */
    let linkIdToDelete = null;      // active pointer for deletion requests

    /**
     * --- Modal Interface Logic ---
     */
    
    /**
     * Interface: openModal
     * Prepares and displays the link creation or modification interface.
     * 
     * @param {string} title - Modal heading
     * @param {string} iconName - semantic icon key
     * @param {Object|null} data - Pre-filled record data
     */
    function openModal(title, iconName, data = null) {
        const titleEl = document.getElementById('modalTitle');
        if (titleEl) titleEl.innerHTML = `${getIcon(iconName)} ${title}`;
        
        if (form) form.reset();
        
        // Context: Apply pre-existing values if in Edit mode
        if (data) {
            document.getElementById('linkId').value = data.id;
            document.getElementById('linkSort').value = data.sort || "0";
            document.getElementById('linkLabel').value = data.label;
            document.getElementById('linkUrl').value = data.url;
            document.getElementById('linkParent').value = data.parent || "";
            document.getElementById('linkPermission').value = data.permission;
            document.getElementById('linkClass').value = data.class || "";
            document.getElementById('linkTarget').value = data.target;
            document.getElementById('linkActive').checked = data.active == "1";
            document.getElementById('linkSeparator').checked = data.separator == "1";
        } else {
            // Default initialization for Add mode
            document.getElementById('linkId').value = "";
            document.getElementById('linkSort').value = "0";
            document.getElementById('linkActive').checked = true;
            document.getElementById('linkSeparator').checked = false;
        }
        
        if (modal) modal.style.display = 'flex';
    }

    /**
     * Hides the link editor interface.
     */
    function closeModal() {
        if (modal) modal.style.display = 'none';
    }

    /**
     * Interface: openDeleteConfirmModal
     * Displays the cascaded deletion confirmation for a specific link.
     */
    function openDeleteConfirmModal(id, label) {
        linkIdToDelete = id;
        const labelEl = document.getElementById('deleteLinkLabel');
        if (labelEl) labelEl.textContent = label;
        if (deleteConfirmModal) deleteConfirmModal.style.display = 'flex';
    }

    /**
     * Resets deletion state and hides the confirmation interface.
     */
    window.closeDeleteConfirmModal = function() {
        linkIdToDelete = null;
        if (deleteConfirmModal) deleteConfirmModal.style.display = 'none';
    };

    // Interaction: Global add trigger
    if (addBtn) addBtn.addEventListener('click', () => openModal('Add Menu Link', 'add'));
    
    // Interaction: Modal close triggers
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    
    window.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
        if (e.target === deleteConfirmModal) closeDeleteConfirmModal();
    });

    /**
     * --- CRUD Actions ---
     */

    // Interaction: Edit button delegation
    document.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', function() {
            // Operation: resolve data from attributes for modal pre-filling
            const data = {
                id: this.dataset.id,
                label: this.dataset.label,
                url: this.dataset.url,
                parent: this.dataset.parent,
                permission: this.dataset.permission,
                class: this.dataset.class,
                target: this.dataset.target,
                active: this.dataset.active,
                sort: this.dataset.sort,
                separator: this.dataset.separator
            };
            openModal('Edit Menu Link', 'edit', data);
        });
    });

    // Interaction: Delete button delegation
    document.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', function() {
            const id = this.dataset.id;
            const label = this.dataset.label;
            openDeleteConfirmModal(id, label);
        });
    });

    /**
     * Action: Form Submission Handler
     * Manages link persistence and "Separator" normalization logic.
     */
    if (form) {
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const id = document.getElementById('linkId').value;
            const isSeparator = document.getElementById('linkSeparator').checked;
            const labelInput = document.getElementById('linkLabel');
            const urlInput = document.getElementById('linkUrl');

            // Logic: Auto-populate separator values if missing
            if (isSeparator) {
                if (!labelInput.value.trim()) labelInput.value = 'SEPARATOR';
                if (!urlInput.value.trim()) urlInput.value = '#';
            }

            const endpoint = id ? '/menu/update' : '/menu/add';
            const formData = new FormData(form);
            
            // Logic: Explicitly set checkbox fallback values for FormData compatibility
            if (!formData.has('is_active')) formData.append('is_active', '0');
            if (!formData.has('is_separator')) formData.append('is_separator', '0');

            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    body: formData
                });
                
                const result = await response.json();
                
                if (result.success) {
                    showToast(result.message, 'success');
                    // Lifecycle: force reload to refresh dynamic navigation tree
                    setTimeout(() => location.reload(), 500);
                } else {
                    showToast('Error: ' + result.error, 'error');
                }
            } catch (error) {
                console.error('Submission error:', error);
                showToast('Request failed', 'error');
            }
        });
    }

    /**
     * Action: Final Deletion Executor
     * Triggers the persistent removal of a link resource.
     */
    const finalDelBtn = document.getElementById('finalDeleteBtn');
    if (finalDelBtn) {
        finalDelBtn.addEventListener('click', async function() {
            if (!linkIdToDelete) return;
            
            const formData = new FormData();
            formData.append('id', linkIdToDelete);

            try {
                const response = await fetch('/menu/delete', {
                    method: 'POST',
                    body: formData
                });
                
                const result = await response.json();
                
                if (result.success) {
                    showToast(result.message, 'success');
                    setTimeout(() => location.reload(), 500);
                } else {
                    showToast('Error: ' + result.error, 'error');
                    closeDeleteConfirmModal();
                }
            } catch (error) {
                console.error('Delete error:', error);
                closeDeleteConfirmModal();
                showToast('Request failed', 'error');
            }
        });
    }

    /**
     * --- Reordering Engine (SortableJS) ---
     */

    if (tableBody && typeof Sortable !== 'undefined') {
        /**
         * Initialization: Draggable Roster
         * Configures Sortable logic for administrative link ordering.
         */
        const sortable = new Sortable(tableBody, {
            handle: '.drag-handle',
            animation: 150,
            ghostClass: 'sortable-ghost',
            onUpdate: function() {
                // UI Lifecycle: reveal "Save" action only after modifications
                if (saveOrderBtn) saveOrderBtn.style.display = 'block';
            }
        });
    }

    /**
     * Action: Reorder Submission
     * Transmits the current DOM sequence to the server for sort_order persistence.
     */
    if (saveOrderBtn) {
        saveOrderBtn.addEventListener('click', async function() {
            const orders = {};
            // Logic: Resolve sequence and apply standard 10-step staggering
            document.querySelectorAll('#menuTableBody tr').forEach((row, index) => {
                orders[row.dataset.id] = (index + 1) * 10;
            });

            try {
                const response = await fetch('/menu/reorder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ orders: orders })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    showToast(result.message, 'success');
                    saveOrderBtn.style.display = 'none';
                    setTimeout(() => location.reload(), 500);
                } else {
                    showToast('Reorder failed', 'error');
                }
            } catch (error) {
                console.error('Reorder error:', error);
                showToast('Request failed', 'error');
            }
        });
    }
});
