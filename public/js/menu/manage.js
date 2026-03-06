// /public/js/menu/manage.js

/**
 * Menu Management Controller
 * 
 * Orchestrates the administrative interface for hierarchical navigation. 
 * Implements a state-driven ledger with real-time drag-and-drop reordering.
 * 
 * Features:
 * - Synchronized state management via /menu/api/state
 * - Drag-and-drop link reordering using SortableJS
 * - Hierarchical parent/child relationship management
 * - Themed confirmation workflows for destructive removal
 * - Permission-aware link configuration
 * 
 * Dependencies:
 * - default.js: For apiPost, getIcon, showConfirmModal, showToast
 * - sortable.min.js: For high-performance reordering logic
 */

/**
 * Global Configuration & Persistent State
 */
const CONFIG = {
    REORDER_STAGGER: 10             // Incremental step for sort_order persistence
};

let STATE = {
    links: [],                      // Collection of all menu records
    parents: [],                    // Eligible top-level parent items
    isAdmin: false                  // Administrative authorization flag
};

const MenuMgmt = {
    /**
     * Bootstraps the module logic and establishes lifecycles.
     * 
     * @returns {void}
     */
    init: function() {
        this.loadState();
        this.initSortable();
        
        // Global modal behavior
        setupGlobalModalClosing(['delete-modal-overlay'], [() => this.closeModal(), closeConfirmModal]);
    },

    /**
     * Synchronizes module state with the server.
     * 
     * @async
     * @returns {Promise<void>}
     */
    loadState: async function() {
        try {
            const response = await fetch('/menu/api/state');
            const data = await response.json();
            
            if (data && data.success) {
                STATE.links = data.links;
                STATE.parents = data.parents;
                STATE.isAdmin = !!data.is_admin;
                this.renderUI();
            }
        } catch (err) {
            console.error('loadState failed:', err);
        }
    },

    /**
     * Orchestrates the full UI rendering lifecycle.
     * 
     * @returns {void}
     */
    renderUI: function() {
        this.renderTable();
        this.renderParentDropdown();
    },

    /**
     * Generates the administrative link ledger from state.
     * 
     * @returns {void}
     */
    renderTable: function() {
        const tbody = document.getElementById('menuTableBody');
        if (!tbody) return;

        if (STATE.links.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No menu links found.</td></tr>';
            return;
        }

        tbody.innerHTML = STATE.links.map(link => `
            <tr data-id="${link.id}" class="${link.parent_id ? 'child-row' : 'parent-row'}">
                <td class="drag-handle">${getIcon('menu')}</td>
                <td data-label="Label">
                    ${link.is_separator ? 
                        '<span class="separator-label">───── SEPARATOR ─────</span>' : 
                        `<span class="${link.css_class || ''}"><strong>${escapeHtml(link.label)}</strong></span>`
                    }
                </td>
                <td data-label="URL" class="${link.url === '#' ? 'empty-url' : ''}">
                    <code>${escapeHtml(link.url)}</code>
                </td>
                <td data-label="Parent" class="${link.parent_label ? '' : 'empty-parent'}">
                    ${escapeHtml(link.parent_label) || '-'}
                </td>
                <td data-label="Permission">
                    <span class="permission-tag tag-${link.permission_level}">
                        ${link.permission_level.charAt(0).toUpperCase() + link.permission_level.slice(1)}
                    </span>
                </td>
                <td data-label="Status">
                    <span class="status-pill ${link.is_active ? 'active' : 'inactive'}">
                        ${link.is_active ? 'Active' : 'Hidden'}
                    </span>
                </td>
                <td class="actions-cell">
                    <div class="action-buttons">
                        <button type="button" class="btn-icon-edit" onclick="MenuMgmt.openEditModal(${link.id})" title="Edit">${getIcon('edit')}</button>
                        <button type="button" class="btn-icon-delete" onclick="MenuMgmt.confirmDelete(${link.id}, '${escapeHtml(link.label)}')" title="Delete">${getIcon('delete')}</button>
                    </div>
                </td>
            </tr>
        `).join('');
    },

    /**
     * Hydrates the parent item selection dropdown.
     * 
     * @returns {void}
     */
    renderParentDropdown: function() {
        const select = document.getElementById('linkParent');
        if (!select) return;

        const currentValue = select.value;
        select.innerHTML = '<option value="">None (Top Level)</option>';
        
        STATE.parents.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.label;
            select.appendChild(opt);
        });

        select.value = currentValue;
    },

    /**
     * Initialization: SortableJS
     * Establishes drag-and-drop reordering for the ledger.
     * 
     * @returns {void}
     */
    initSortable: function() {
        const tableBody = document.getElementById('menuTableBody');
        if (!tableBody || typeof Sortable === 'undefined') return;

        new Sortable(tableBody, {
            handle: '.drag-handle',
            animation: 150,
            ghostClass: 'sortable-ghost',
            onUpdate: () => {
                document.getElementById('saveOrderBtn').classList.remove('hidden');
            }
        });
    },

    /**
     * Interface: openAddModal
     * Prepares and displays the link creation interface.
     * 
     * @returns {void}
     */
    openAddModal: function() {
        const titleEl = document.getElementById('modalTitle');
        if (titleEl) titleEl.innerHTML = `${getIcon('add')} Add Menu Link`;
        
        const form = document.getElementById('linkForm');
        if (form) form.reset();
        
        document.getElementById('linkId').value = '';
        document.getElementById('linkSort').value = '0';
        document.getElementById('linkActive').checked = true;
        document.getElementById('linkSeparator').checked = false;
        
        const modal = document.getElementById('linkModal');
        if (modal) modal.style.display = 'flex';
        document.body.classList.add('modal-open');
    },

    /**
     * Pre-fills and displays the link editor.
     * 
     * @param {number} id - Record identifier.
     * @returns {void}
     */
    openEditModal: function(id) {
        const link = STATE.links.find(l => l.id == id);
        if (!link) return;

        const titleEl = document.getElementById('modalTitle');
        if (titleEl) titleEl.innerHTML = `${getIcon('edit')} Edit Menu Link`;

        document.getElementById('linkId').value = link.id;
        document.getElementById('linkSort').value = link.sort_order || '0';
        document.getElementById('linkLabel').value = link.label;
        document.getElementById('linkUrl').value = link.url;
        document.getElementById('linkParent').value = link.parent_id || '';
        document.getElementById('linkPermission').value = link.permission_level;
        document.getElementById('linkClass').value = link.css_class || '';
        document.getElementById('linkTarget').value = link.target;
        document.getElementById('linkActive').checked = link.is_active == 1;
        document.getElementById('linkSeparator').checked = link.is_separator == 1;

        const modal = document.getElementById('linkModal');
        if (modal) modal.style.display = 'flex';
        document.body.classList.add('modal-open');
    },

    /**
     * Hides the link editor modal.
     * 
     * @returns {void}
     */
    closeModal: function() {
        const modal = document.getElementById('linkModal');
        if (modal) modal.style.display = 'none';
        document.body.classList.remove('modal-open');
    },

    /**
     * Executes persistent link creation or modification.
     * 
     * @async
     * @param {Event} e - Form event.
     * @returns {Promise<void>}
     */
    handleSubmit: async function(e) {
        if (e) e.preventDefault();
        
        const btn = document.getElementById('saveLinkBtn');
        const originalHtml = btn.innerHTML;
        const id = document.getElementById('linkId').value;
        const url = id ? '/menu/api/update' : '/menu/api/add';

        btn.disabled = true;
        btn.innerHTML = `${getIcon('waiting')} Saving...`;

        try {
            const formData = new FormData(e.target);
            
            // Logic: Explicitly set checkbox fallbacks
            formData.set('is_active', document.getElementById('linkActive').checked ? 1 : 0);
            formData.set('is_separator', document.getElementById('linkSeparator').checked ? 1 : 0);

            const result = await apiPost(url, Object.fromEntries(formData));
            if (result && result.success) {
                this.closeModal();
                await this.loadState();
                
                // Sidebar Reconciliation: Force menu refresh if global menubar exists
                if (window.loadMenu) window.loadMenu();
            }
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    },

    /**
     * Orchestrates the terminal link removal workflow.
     * 
     * @param {number} id - Record identifier.
     * @param {string} label - Display label for context.
     * @returns {void}
     */
    confirmDelete: function(id, label) {
        showConfirmModal({
            title: 'Delete Menu Link',
            message: `Are you sure you want to delete "<strong>${escapeHtml(label)}</strong>"?`,
            subMessage: 'Warning: All nested sub-menu items will also be removed.',
            danger: true,
            confirmText: 'Delete Everywhere',
            onConfirm: async () => {
                const result = await apiPost('/menu/api/delete', { id });
                if (result && result.success) {
                    // Local Reconciliation: Optimistically remove from state and re-render
                    STATE.links = STATE.links.filter(l => l.id != id && l.parent_id != id);
                    STATE.parents = STATE.parents.filter(p => p.id != id);
                    this.renderUI();
                    
                    if (window.loadMenu) window.loadMenu();
                }
            }
        });
    },

    /**
     * Executes bulk reordering persistence.
     * 
     * @async
     * @returns {Promise<void>}
     */
    handleReorder: async function() {
        const btn = document.getElementById('saveOrderBtn');
        const originalHtml = btn.innerHTML;
        const orders = {};

        btn.disabled = true;
        btn.innerHTML = `${getIcon('waiting')} Updating...`;

        try {
            // Logic: Resolve sequence and apply staggered ordering
            document.querySelectorAll('#menuTableBody tr').forEach((row, index) => {
                if (row.dataset.id) {
                    orders[row.dataset.id] = (index + 1) * CONFIG.REORDER_STAGGER;
                }
            });

            const response = await fetch('/menu/api/reorder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orders })
            });
            const result = await response.json();

            if (result && result.success) {
                if (result.message) showToast(result.message, 'success');
                btn.classList.add('hidden');
                await this.loadState();
                if (window.loadMenu) window.loadMenu();
            } else {
                showToast(result.error || 'Reorder failed', 'error');
            }
        } catch (err) {
            console.error('handleReorder failed:', err);
            showToast('Network error', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }
};

/**
 * Bootstrapper
 */
document.addEventListener('DOMContentLoaded', () => MenuMgmt.init());

/**
 * Utility: Sanitizes input for DOM safety.
 * 
 * @param {string} text - Raw string.
 * @returns {string} - Escaped string.
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
