// /public/js/admin/menu.js

/**
 * Menu Management Controller
 *
 * Orchestrates the administrative interface for hierarchical navigation.
 * Facilitates the management of navigation links with sortable sequencing.
 *
 * Features:
 * - State retrieval from authoritative source
 * - Drag-and-drop link reordering using SortableJS
 * - Recursive rendering for arbitrary nesting depth
 * - Hierarchical parent/child relationship management with child-to-parent affinity
 * - Themed confirmation workflows for destructive removal
 * - Permission-aware link configuration
 *
 * Dependencies:
 * - default.js: For apiPost, showConfirmModal, showToast
 * - sortable.min.js: For high-performance reordering logic
 */

/**
 * Global Configuration & Persistent State
 */
const CONFIG = {
    REORDER_STAGGER: 10,            // Incremental step for sort_order persistence
    SYNC_INTERVAL_MS: 300000        // Background refresh frequency (5 mins)
};

let STATE = {
    links: [],                      // Collection of all menu records
    parents: [],                    // All non-separator items eligible to be parents
    isAdmin: false                  // Administrative authorization flag
};

const MenuMgmt = {
    _groupSortable:  null,          // SortableJS instance for parent-group ordering
    _childSortables: [],            // SortableJS instances for within-group child ordering

    /**
     * Bootstraps the module logic and establishes lifecycles.
     *
     * @returns {void}
     */
    init: function() {
        this.loadState();

        // Global modal behavior
        window.setupGlobalModalClosing(['delete-modal-overlay', 'modal-overlay'], [() => this.closeModal()]);

        // Background Synchronization
        setInterval(() => this.loadState(), CONFIG.SYNC_INTERVAL_MS);
    },

    /**
     * Synchronizes module state with the server.
     *
     * @async
     * @param {boolean} [force=false] - If true, bypasses interaction guards.
     * @returns {Promise<void>}
     */
    loadState: async function(force = false) {
        // Lifecycle: inhibit background sync if user is actively interacting with forms
        const anyModalOpen = document.querySelector('.modal-overlay.active, .delete-modal-overlay.active, .modal-overlay.show, .delete-modal-overlay.show');
        const inputFocused = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'SELECT');

        if (!force && (anyModalOpen || inputFocused) && STATE.links.length > 0) return;

        try {
            const response = await fetch('/admin/menu/api/state');
            const data = await response.json();

            if (data && data.success) {
                STATE.links  = data.links;
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
     * Collects the id and all descendant ids of a given link.
     * Used to prevent circular parent references in the dropdown.
     *
     * @param {number|string} id - Root link id.
     * @returns {Set<string>} Set of string ids.
     */
    collectDescendants: function(id) {
        const excluded = new Set([String(id)]);
        const add = (parentId) => {
            STATE.links.filter(l => l.parent_id == parentId).forEach(child => {
                excluded.add(String(child.id));
                add(child.id);
            });
        };
        add(id);
        return excluded;
    },

    /**
     * Builds a child map (parent_id -> [children]) from STATE.links.
     * Shared by renderTable, renderParentDropdown, and appendDescendants.
     *
     * @returns {Object} Map of parent id -> array of child link objects.
     */
    buildChildMap: function() {
        const childMap = {};
        STATE.links.filter(l => l.parent_id).forEach(l => {
            (childMap[l.parent_id] = childMap[l.parent_id] || []).push(l);
        });
        return childMap;
    },

    /**
     * Builds an HTML string for a single table row.
     * The drag handle class differs between depth-0 and deeper rows so that
     * SortableJS can route drags to the correct sortable instance.
     *
     * @param {Object} link  - Menu link record from STATE.
     * @param {number} depth - Nesting depth (0 = top-level parent).
     * @returns {string} HTML string for the <tr> element.
     */
    buildRow: function(link, depth) {
        const isChild     = depth > 0;
        const handleClass = isChild ? 'child-drag-handle' : 'parent-drag-handle';
        const rowClass    = isChild ? 'child-row' : 'parent-row';
        const indentPx    = (depth - 1) * 20;
        const indent      = isChild
            ? `<span class="child-indent" style="padding-left:${indentPx}px">&#8627;</span>`
            : '';

        return `
            <tr data-id="${link.id}" data-depth="${depth}" class="${rowClass}">
                <td class="drag-handle ${handleClass}">&#9776;</td>
                <td data-label="Label">
                    ${indent}
                    ${link.is_separator ?
                        '<span class="separator-label">&#9135;&#9135;&#9135;&#9135;&#9135; SEPARATOR &#9135;&#9135;&#9135;&#9135;&#9135;</span>' :
                        `<span class="${link.css_class || ''}"><strong>${escapeHtml(link.label)}</strong></span>`
                    }
                </td>
                <td data-label="URL">
                    ${link.url === '#'
                        ? '<span class="parent-container-badge">Parent Container</span>'
                        : `<code>${escapeHtml(link.url)}</code>`
                    }
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
                        <button type="button" class="btn-icon-edit" onclick="MenuMgmt.openEditModal(${link.id})" title="Edit">&#9999;&#65039;</button>
                        <button type="button" class="btn-icon-delete" onclick="MenuMgmt.confirmDelete(${link.id}, '${escapeHtml(link.label)}')" title="Delete">&#128465;&#65039;</button>
                    </div>
                </td>
            </tr>
        `;
    },

    /**
     * Recursively appends child rows into a tbody, depth-first.
     *
     * @param {HTMLElement}   tbody    - Target <tbody> to append into.
     * @param {number|string} parentId - Id whose children are appended.
     * @param {Object}        childMap - Map of parent_id -> [child links].
     * @param {number}        depth    - Current nesting depth.
     * @returns {void}
     */
    appendDescendants: function(tbody, parentId, childMap, depth) {
        (childMap[parentId] || []).forEach(child => {
            tbody.insertAdjacentHTML('beforeend', this.buildRow(child, depth));
            this.appendDescendants(tbody, child.id, childMap, depth + 1);
        });
    },

    /**
     * Generates the administrative link ledger from state.
     * Each top-level item and ALL its descendants are wrapped in a single <tbody>
     * so the two sortable layers can operate independently:
     *   - The table-level sortable moves entire <tbody> groups.
     *   - Per-group sortables reorder <tr.child-row> within their <tbody>.
     *
     * @returns {void}
     */
    renderTable: function() {
        const table = document.getElementById('menuTable');
        if (!table) return;

        table.querySelectorAll('tbody').forEach(b => b.remove());

        const childMap = this.buildChildMap();
        const topLevel = STATE.links.filter(l => !l.parent_id);

        if (STATE.links.length === 0) {
            const empty = document.createElement('tbody');
            empty.innerHTML = '<tr><td colspan="7" class="empty-state">No menu links found.</td></tr>';
            table.appendChild(empty);
            return;
        }

        topLevel.forEach(link => {
            const tbody = document.createElement('tbody');
            tbody.className = 'menu-group';
            tbody.dataset.parentId = link.id;
            tbody.insertAdjacentHTML('beforeend', this.buildRow(link, 0));
            this.appendDescendants(tbody, link.id, childMap, 1);
            table.appendChild(tbody);
        });

        this.refreshSortables();
    },

    /**
     * Destroys existing SortableJS instances and initialises two layers:
     *   1. A group-level sortable on the <table> element — moves entire <tbody>
     *      groups and is triggered only by the .parent-drag-handle.
     *   2. Per-group child sortables on each <tbody> — reorder .child-row
     *      elements and are triggered only by the .child-drag-handle.
     *
     * @returns {void}
     */
    refreshSortables: function() {
        const table = document.getElementById('menuTable');
        if (!table || typeof Sortable === 'undefined') return;

        this._childSortables.forEach(s => s.destroy());
        this._childSortables = [];
        if (this._groupSortable) {
            this._groupSortable.destroy();
            this._groupSortable = null;
        }

        // Group-level: dragging a parent row moves its entire <tbody>
        this._groupSortable = new Sortable(table, {
            draggable:  'tbody.menu-group',
            handle:     '.parent-drag-handle',
            animation:  150,
            ghostClass: 'sortable-ghost',
            onUpdate:   () => this.handleReorder()
        });

        // Child-level: dragging a child row reorders it within its parent group only
        table.querySelectorAll('tbody.menu-group').forEach(tbody => {
            const s = new Sortable(tbody, {
                draggable:  'tr.child-row',
                handle:     '.child-drag-handle',
                animation:  150,
                ghostClass: 'sortable-ghost',
                onUpdate:   () => this.handleReorder()
            });
            this._childSortables.push(s);
        });
    },

    /**
     * Hydrates the parent item selection dropdown via depth-first tree traversal.
     * This guarantees each child appears immediately under its actual parent in the
     * list regardless of the flat sort order returned by the server.
     * Excludes separator items and, when provided, the item being edited plus all
     * its descendants (to prevent circular references).
     *
     * @param {number|string|null} [excludeId=null] - Id of the item being edited.
     * @returns {void}
     */
    renderParentDropdown: function(excludeId = null) {
        const select = document.getElementById('linkParent');
        if (!select) return;

        const excluded = excludeId ? this.collectDescendants(excludeId) : new Set();
        const childMap = this.buildChildMap();

        select.innerHTML = '<option value="">None (Top Level)</option>';

        const addOption = (link, depth) => {
            if (link.is_separator) return;
            if (excluded.has(String(link.id))) return;

            const indent = '  '.repeat(depth);
            const opt = document.createElement('option');
            opt.value = link.id;
            opt.textContent = indent + link.label;
            select.appendChild(opt);

            // Depth-first: children appear immediately after their parent
            (childMap[link.id] || []).forEach(child => addOption(child, depth + 1));
        };

        STATE.links.filter(l => !l.parent_id && l.url === '#').forEach(link => addOption(link, 0));
    },

    /**
     * Toggles parent-container mode on the URL field.
     * When active, the URL is locked to '#' since container items do not navigate.
     * When deactivated, the URL field is cleared and restored for editing.
     *
     * @param {HTMLInputElement} checkbox - The triggering checkbox element.
     * @returns {void}
     */
    toggleParentMode: function(checkbox) {
        const urlField = document.getElementById('linkUrl');
        if (checkbox.checked) {
            urlField.value = '#';
            urlField.disabled = true;
        } else {
            urlField.value = '';
            urlField.disabled = false;
            urlField.focus();
        }
    },

    /**
     * Interface: openAddModal
     * Prepares and displays the link creation interface.
     *
     * @returns {void}
     */
    openAddModal: function() {
        const titleEl = document.getElementById('modalTitle');
        if (titleEl) titleEl.innerHTML = `&#10133; Add Menu Link`;

        const form = document.getElementById('linkForm');
        if (form) form.reset();

        document.getElementById('linkId').value = '';
        document.getElementById('linkSort').value = '0';
        document.getElementById('linkActive').checked = true;
        document.getElementById('linkSeparator').checked = false;
        document.getElementById('linkIsParent').checked = false;
        document.getElementById('linkUrl').disabled = false;

        // Reset dropdown to full list (no exclusions for add mode)
        this.renderParentDropdown();

        const modal = document.getElementById('linkModal');
        if (modal) modal.classList.add('active');
        document.body.classList.add('modal-open');
    },

    /**
     * Pre-fills and displays the link editor.
     * Rebuilds the parent dropdown excluding the item itself and its descendants.
     *
     * @param {number} id - Record identifier.
     * @returns {void}
     */
    openEditModal: function(id) {
        const link = STATE.links.find(l => l.id == id);
        if (!link) return;

        const titleEl = document.getElementById('modalTitle');
        if (titleEl) titleEl.innerHTML = `&#9999;&#65039; Edit Menu Link`;

        document.getElementById('linkId').value = link.id;
        document.getElementById('linkSort').value = link.sort_order || '0';
        document.getElementById('linkLabel').value = link.label;
        document.getElementById('linkUrl').value = link.url;
        document.getElementById('linkPermission').value = link.permission_level;
        document.getElementById('linkClass').value = link.css_class || '';
        document.getElementById('linkTarget').value = link.target;
        document.getElementById('linkActive').checked = link.is_active == 1;
        document.getElementById('linkSeparator').checked = link.is_separator == 1;

        const isParent = link.url === '#';
        document.getElementById('linkIsParent').checked = isParent;
        document.getElementById('linkUrl').disabled = isParent;

        // Rebuild the dropdown excluding the current item and its descendants
        this.renderParentDropdown(link.id);
        document.getElementById('linkParent').value = link.parent_id || '';

        const modal = document.getElementById('linkModal');
        if (modal) modal.classList.add('active');
        document.body.classList.add('modal-open');
    },

    /**
     * Hides the link editor modal.
     *
     * @returns {void}
     */
    closeModal: function() {
        const modal = document.getElementById('linkModal');
        if (modal) modal.classList.remove('active');
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
        const url = id ? '/admin/menu/api/update' : '/admin/menu/api/add';

        btn.disabled = true;
        btn.innerHTML = `&#8987; Saving...`;

        try {
            const formData = new FormData(e.target);

            // Ensure checkbox values are correctly represented
            formData.set('is_active', document.getElementById('linkActive').checked ? 1 : 0);
            formData.set('is_separator', document.getElementById('linkSeparator').checked ? 1 : 0);

            // Disabled fields are excluded from FormData — re-inject url when locked to '#'
            if (document.getElementById('linkIsParent').checked) {
                formData.set('url', '#');
            }

            const result = await window.apiPost(url, formData);
            if (result && result.success) {
                this.closeModal();
                await this.loadState(true);

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
        window.showConfirmModal({
            title: 'Delete Menu Link',
            message: `Are you sure you want to delete "<strong>${escapeHtml(label)}</strong>"?`,
            subMessage: 'Warning: All nested sub-menu items will also be removed.',
            danger: true,
            confirmText: 'Delete',
            hideCancel: true,
            alignment: 'center',
            onConfirm: async () => {
                const result = await window.apiPost('/admin/menu/api/delete', { id });
                if (result && result.success) {
                    STATE.links = STATE.links.filter(l => l.id != id && l.parent_id != id);
                    this.renderUI();

                    if (window.loadMenu) window.loadMenu();

                    await this.loadState(true);
                }
            }
        });
    },

    /**
     * Persists the current drag-and-drop sequence immediately on drop.
     * Traverses the two-level DOM structure to derive sort_order values:
     *   - Each <tbody.menu-group> position determines the parent's sort_order.
     *   - Each <tr.child-row> position within its <tbody> determines the child's sort_order.
     *
     * @async
     * @returns {Promise<void>}
     */
    handleReorder: async function() {
        const table  = document.getElementById('menuTable');
        const orders = {};

        let groupIndex = 0;
        let globalChildIndex = 0;
        table.querySelectorAll('tbody.menu-group').forEach(tbody => {
            const parentId = tbody.dataset.parentId;
            if (parentId) orders[parentId] = (++groupIndex) * CONFIG.REORDER_STAGGER;

            tbody.querySelectorAll('tr.child-row[data-id]').forEach(row => {
                orders[row.dataset.id] = (++globalChildIndex) * CONFIG.REORDER_STAGGER;
            });
        });

        try {
            const response = await fetch('/admin/menu/api/reorder', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content
                },
                body: JSON.stringify({ orders })
            });
            const result = await response.json();

            if (result && result.success) {
                if (window.loadMenu) window.loadMenu();
                await this.loadState(true);
            } else {
                window.showToast(result.error || 'Reorder failed', 'error');
                await this.loadState(true);
            }
        } catch (err) {
            console.error('handleReorder failed:', err);
            window.showToast('Network error', 'error');
            await this.loadState(true);
        }
    }
};

/**
 * Bootstrapper
 */
document.addEventListener('DOMContentLoaded', () => MenuMgmt.init());
