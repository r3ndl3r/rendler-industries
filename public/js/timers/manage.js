// /public/js/timers/manage.js

/**
 * Timer Management Controller Module
 * 
 * This module manages the administrative interface for device usage timers. 
 * It facilitates the creation, modification, and deletion of user-specific 
 * time limits, as well as the granting of bonus time.
 * 
 * Features:
 * - administrative creation/edit workflows for weekday and weekend limits
 * - Real-time filtering of timer rosters by user
 * - Specialized "Bonus Time" grant system with immediate sync
 * - Themed confirmation workflow for permanent timer removal
 * - Visual ledger reconciliation using fade-out animations
 * - Integrated LocalStorage view-state persistence
 * 
 * Dependencies:
 * - default.js: For apiPost, getIcon, and modal helpers
 * - timers/utils.js: For formatting logic
 */

const TimerManagement = {
    /**
     * Initialization System
     * Boots the administrative logic and establishes event delegation.
     */
    init: function() {
        this.attachEventListeners();
        
        // Modal: Configure global click-outside-to-close behavior
        setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay'], [
            () => this.closeModals(),
            closeConfirmModal
        ]);
    },

    /**
     * Orchestrates event delegation for administrative controls and forms.
     */
    attachEventListeners: function() {
        // Interaction: Main Create trigger
        const btnCreate = document.getElementById('btn-create-timer');
        if (btnCreate) {
            btnCreate.addEventListener('click', () => this.openCreateModal());
        }

        // Interaction: User filtering
        const userFilter = document.getElementById('user-filter');
        if (userFilter) {
            userFilter.addEventListener('change', (e) => this.handleFilterChange(e));
        }

        // Interaction: Ledger row delegation
        document.addEventListener('click', (e) => {
            const editBtn = e.target.closest('.btn-icon-edit');
            const delBtn = e.target.closest('.btn-icon-delete');
            const bonusBtn = e.target.closest('.btn-icon-bonus');

            if (editBtn) this.openEditModal(editBtn);
            else if (delBtn) this.handleDelete(delBtn);
            else if (bonusBtn) this.openBonusModal(bonusBtn);
        });

        // Form: Creation submission
        const createForm = document.getElementById('create-timer-form');
        if (createForm) {
            createForm.addEventListener('submit', (e) => this.handleSubmit(e, '/timers/create'));
        }

        // Form: Modification submission
        const editForm = document.getElementById('edit-timer-form');
        if (editForm) {
            editForm.addEventListener('submit', (e) => {
                const id = document.getElementById('edit-timer-id').value;
                this.handleSubmit(e, `/timers/update/${id}`);
            });
        }

        // Form: Bonus grant submission
        const bonusForm = document.getElementById('bonus-form');
        if (bonusForm) {
            bonusForm.addEventListener('submit', (e) => this.handleBonusSubmit(e));
        }
    },

    /**
     * Interface: handleFilterChange
     * Reloads the management view with a user-specific filter query.
     */
    handleFilterChange: function(e) {
        const userId = e.target.value;
        const url = userId ? `/timers/manage?user_id=${userId}` : '/timers/manage';
        window.location.href = url;
    },

    /**
     * Interface: openCreateModal
     * Prepares and displays the timer creation interface.
     */
    openCreateModal: function() {
        const modal = document.getElementById('modal-create-timer');
        if (modal) {
            const form = document.getElementById('create-timer-form');
            if (form) form.reset();
            modal.style.display = 'flex';
            document.body.classList.add('modal-open');
        }
    },

    /**
     * Interface: openEditModal
     * Pre-fills the timer editor with existing configuration.
     * 
     * @param {HTMLElement} button - Button containing source data attributes
     */
    openEditModal: function(button) {
        const modal = document.getElementById('modal-edit-timer');
        if (!modal) return;

        // Context: Sync form inputs with button metadata
        document.getElementById('edit-timer-id').value = button.dataset.timerId;
        document.getElementById('edit-name').value = button.dataset.name;
        document.getElementById('edit-category').value = button.dataset.category;
        document.getElementById('edit-weekday').value = button.dataset.weekday;
        document.getElementById('edit-weekend').value = button.dataset.weekend;

        modal.style.display = 'flex';
        document.body.classList.add('modal-open');
    },

    /**
     * Interface: openBonusModal
     * Displays the grant interface for additional minutes.
     * 
     * @param {HTMLElement} button - Triggering element
     */
    openBonusModal: function(button) {
        const modal = document.getElementById('modal-bonus-time');
        if (!modal) return;

        document.getElementById('bonus-timer-id').value = button.dataset.timerId;
        document.getElementById('bonus-minutes').value = 15; // Default increment

        modal.style.display = 'flex';
        document.body.classList.add('modal-open');
    },

    /**
     * Action: handleDelete
     * Triggers confirmation and removes timer record upon user approval.
     */
    handleDelete: function(button) {
        const timerId = button.dataset.timerId;
        const name = button.dataset.name;

        showConfirmModal({
            title: 'Delete Timer',
            message: `Are you sure you want to delete timer "<strong>${name}</strong>"?<br><small style="color: #64748b; font-style: italic;">This action cannot be undone.</small>`,
            danger: true,
            confirmText: 'Delete Timer',
            loadingText: 'Deleting...',
            onConfirm: async () => {
                const result = await apiPost(`/timers/delete/${timerId}`);
                if (result && result.success) {
                    // UI: Animate removal of the specific row
                    const row = document.querySelector(`tr[data-timer-id="${timerId}"]`);
                    if (row) {
                        row.classList.add('row-fade-out');
                        setTimeout(() => row.remove(), 500);
                    } else {
                        window.location.reload();
                    }
                }
            }
        });
    },

    /**
     * Action: handleSubmit
     * Universal handler for creation and update forms.
     * 
     * @param {Event} e - Submission event
     * @param {string} url - Target endpoint
     */
    handleSubmit: async function(e, url) {
        e.preventDefault();
        const form = e.target;
        const btn = form.querySelector('button[type="submit"]');
        const originalHtml = btn.innerHTML;

        // UI Feedback: indicate processing
        btn.disabled = true;
        btn.innerHTML = `${getIcon('waiting')} Processing...`;

        const formData = new FormData(form);
        const result = await apiPost(url, formData);

        if (result && result.success) {
            this.closeModals();
            window.location.reload(); // Lifecycle: full sync required for ledger
        } else {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    },

    /**
     * Action: handleBonusSubmit
     * Transmits a bonus time grant to the server.
     */
    handleBonusSubmit: async function(e) {
        e.preventDefault();
        const form = e.target;
        const btn = form.querySelector('button[type="submit"]');
        const originalHtml = btn.innerHTML;

        btn.disabled = true;
        btn.innerHTML = `${getIcon('waiting')} Processing...`;

        const formData = new FormData(form);
        const result = await apiPost('/timers/bonus', Object.fromEntries(formData));

        if (result && result.success) {
            this.closeModals();
            window.location.reload();
        } else {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    },

    /**
     * Resets all modal overlays and restores scroll focus.
     */
    closeModals: function() {
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.style.display = 'none';
        });
        document.body.classList.remove('modal-open');
    }
};
