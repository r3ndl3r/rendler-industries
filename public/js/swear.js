// /public/js/swear.js

/**
 * Swear Jar Controller Module
 * 
 * This module manages the Family Swear Jar interface. It implements
 * a high-accountability tracking system for offenses, payments, 
 * and community fund withdrawals.
 * 
 * Features:
 * - Real-time offense reporting with automated fine-lookup
 * - Multi-view toggle (Dashboard vs. Management) with LocalStorage persistence
 * - Integrated debt management and extra-credit deposit workflows
 * - Comprehensive history log for community transparency
 * - Administrative member roster management (Add/Remove)
 * - Lightbox-enabled rule reference viewing
 * 
 * Dependencies:
 * - default.js: For apiPost, getIcon, and modal helpers
 * - toast.js: For transaction feedback
 */

const SwearModule = {
    /**
     * Local configuration for UI state persistence.
     */
    config: {
        viewKey: 'swear_jar_active_view'     // Key for persisting active panel state
    },

    /**
     * Bootstraps the module logic and restores interface state.
     */
    init: function() {
        this.attachEventListeners();
        this.restoreViewState();
        
        // Modal: Configure global closure behavior
        setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay'], [
            () => this.closeImageModal(),
            closeConfirmModal
        ]);
    },

    /**
     * Orchestrates event delegation for all transaction forms.
     */
    attachEventListeners: function() {
        // Handle Reporting
        const addFineForm = document.getElementById('addFineForm');
        if (addFineForm) {
            addFineForm.addEventListener('submit', (e) => this.handleSubmit(e, '/swear/add'));
        }

        // Handle Debt Clearance
        document.querySelectorAll('.pay-debt-form').forEach(form => {
            form.addEventListener('submit', (e) => this.handleSubmit(e, '/swear/pay'));
        });

        // Handle Bonus Deposits
        const extraDepositForm = document.getElementById('extraDepositForm');
        if (extraDepositForm) {
            extraDepositForm.addEventListener('submit', (e) => this.handleSubmit(e, '/swear/pay'));
        }

        // Handle Community Fund Spend
        const spendForm = document.getElementById('spendForm');
        if (spendForm) {
            spendForm.addEventListener('submit', (e) => this.handleSubmit(e, '/swear/spend'));
        }

        // Handle Roster Management
        const addMemberForm = document.getElementById('addMemberForm');
        if (addMemberForm) {
            addMemberForm.addEventListener('submit', (e) => this.handleSubmit(e, '/swear/member/add'));
        }
    },

    /**
     * Logic: updateFine
     * Synchronizes the amount input with the selected member's default penalty.
     */
    updateFine: function() {
        const select = document.getElementById('perp_select');
        const amountInput = document.getElementById('fine_amount');
        const selectedOption = select.options[select.selectedIndex];
        if (!selectedOption || !amountInput) return;
        
        const defaultFine = selectedOption.getAttribute('data-fine');
        
        if (defaultFine && defaultFine > 0) {
            amountInput.value = defaultFine;
        }
    },

    /**
     * Action: handleSubmit
     * Universal AJAX form submission handler with integrated success feedback.
     * 
     * @param {Event} e - Submission event
     * @param {string} url - Target transaction endpoint
     * @returns {Promise<void>}
     */
    handleSubmit: async function(e, url) {
        e.preventDefault();
        const form = e.target;
        const btn = form.querySelector('button[type="submit"]');
        const originalHtml = btn ? btn.innerHTML : '';

        // UI Feedback: disable button and pulse icon
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `${getIcon('waiting')} Processing...`;
        }

        const formData = new FormData(form);
        const result = await apiPost(url, formData);

        if (result && result.success) {
            // Lifecycle: delay reload to allow visual confirmation of the Toast
            setTimeout(() => window.location.reload(), 800);
        } else if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    },

    /**
     * Interface: toggleView
     * Switches between the public Jar view and the administrative Member view.
     */
    toggleView: function() {
        const dashboard = document.getElementById('swearDashboardView');
        const manage = document.getElementById('swearManageView');
        const btn = document.getElementById('toggleViewBtn');
        const dashboardText = btn ? btn.querySelector('.view-dashboard-text') : null;
        const manageText = btn ? btn.querySelector('.view-manage-text') : null;

        if (!dashboard || !manage) return;

        const isDashboardVisible = !dashboard.classList.contains('hidden');

        // Toggle visibility and persist selection
        if (isDashboardVisible) {
            dashboard.classList.add('hidden');
            manage.classList.remove('hidden');
            if (dashboardText) dashboardText.classList.add('hidden');
            if (manageText) manageText.classList.remove('hidden');
            localStorage.setItem(this.config.viewKey, 'manage');
        } else {
            dashboard.classList.remove('hidden');
            manage.classList.add('hidden');
            if (dashboardText) dashboardText.classList.remove('hidden');
            if (manageText) manageText.classList.add('hidden');
            localStorage.setItem(this.config.viewKey, 'dashboard');
        }
    },

    /**
     * Interface: restoreViewState
     * Retrieves and applies the active view from previous session storage.
     */
    restoreViewState: function() {
        const savedView = localStorage.getItem(this.config.viewKey);
        if (savedView === 'manage') {
            this.toggleView();
        }
    },

    /**
     * Interface: openImageModal
     * Opens the high-accountability rule document in a glassmorphism lightbox.
     * 
     * @param {string} src - Image resource URL
     */
    openImageModal: function(src) {
        const modal = document.getElementById('imageModal');
        const img = document.getElementById('modalImage');
        if (img) img.src = src;
        if (modal) {
            modal.style.display = 'flex';
            document.body.classList.add('modal-open');
        }
    },

    /**
     * Hides the rule document lightbox.
     */
    closeImageModal: function() {
        const modal = document.getElementById('imageModal');
        if (modal) {
            modal.style.display = 'none';
            document.body.classList.remove('modal-open');
        }
    }
};

/**
 * Main module initialization.
 */
document.addEventListener('DOMContentLoaded', () => SwearModule.init());

/**
 * Legacy wrappers for inline template handlers.
 */
function openImageModal(src) { SwearModule.openImageModal(src); }
function closeImageModal() { SwearModule.closeImageModal(); }

/**
 * Action: confirmDeleteMember (Admin)
 * Specialized confirmation workflow for permanent roster removal.
 */
function confirmDeleteMember(id, name) {
    showConfirmModal({
        title: 'Remove Member',
        message: `Are you sure you want to remove <strong>${name}</strong>? Historical fine data will be preserved, but they will no longer appear in the roster.`,
        danger: true,
        confirmText: 'Remove',
        hideCancel: true,
        alignment: 'center',
        loadingText: 'Removing...',
        onConfirm: async () => {
            const result = await apiPost('/swear/member/delete', { id: id });
            if (result && result.success) {
                // Sync: Reload to clear from local state and dropdowns
                setTimeout(() => window.location.reload(), 800);
            }
        }
    });
}
