/* /public/js/swear.js */

const SwearModule = {
    config: {
        viewKey: 'swear_jar_active_view'
    },

    init: function() {
        this.attachEventListeners();
        this.restoreViewState();
        
        // Use global modal closing helper
        setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay'], [
            () => this.closeImageModal(),
            closeConfirmModal
        ]);
    },

    attachEventListeners: function() {
        // Handle Add Fine
        const addFineForm = document.getElementById('addFineForm');
        if (addFineForm) {
            addFineForm.addEventListener('submit', (e) => this.handleSubmit(e, '/swear/add'));
        }

        // Handle Payments
        document.querySelectorAll('.pay-debt-form').forEach(form => {
            form.addEventListener('submit', (e) => this.handleSubmit(e, '/swear/pay'));
        });

        // Handle Extra Deposits
        const extraDepositForm = document.getElementById('extraDepositForm');
        if (extraDepositForm) {
            extraDepositForm.addEventListener('submit', (e) => this.handleSubmit(e, '/swear/pay'));
        }

        // Handle Spending
        const spendForm = document.getElementById('spendForm');
        if (spendForm) {
            spendForm.addEventListener('submit', (e) => this.handleSubmit(e, '/swear/spend'));
        }

        // Handle Add Member
        const addMemberForm = document.getElementById('addMemberForm');
        if (addMemberForm) {
            addMemberForm.addEventListener('submit', (e) => this.handleSubmit(e, '/swear/member/add'));
        }
    },

    updateFine: function() {
        const select = document.getElementById('perp_select');
        const amountInput = document.getElementById('fine_amount');
        const selectedOption = select.options[select.selectedIndex];
        if (!selectedOption) return;
        
        const defaultFine = selectedOption.getAttribute('data-fine');
        
        if (defaultFine && defaultFine > 0) {
            amountInput.value = defaultFine;
        }
    },

    handleSubmit: async function(e, url) {
        e.preventDefault();
        const form = e.target;
        const btn = form.querySelector('button[type="submit"]');
        const originalHtml = btn.innerHTML;

        btn.disabled = true;
        btn.innerHTML = `${getIcon('waiting')} Processing...`;

        const formData = new FormData(form);
        const result = await apiPost(url, formData);

        if (result && result.success) {
            // Delay reload slightly so user can see the success toast
            setTimeout(() => window.location.reload(), 800);
        } else {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    },

    toggleView: function() {
        const dashboard = document.getElementById('swearDashboardView');
        const manage = document.getElementById('swearManageView');
        const btn = document.getElementById('toggleViewBtn');
        const dashboardText = btn.querySelector('.view-dashboard-text');
        const manageText = btn.querySelector('.view-manage-text');

        const isDashboardVisible = !dashboard.classList.contains('hidden');

        if (isDashboardVisible) {
            dashboard.classList.add('hidden');
            manage.classList.remove('hidden');
            dashboardText.classList.add('hidden');
            manageText.classList.remove('hidden');
            localStorage.setItem(this.config.viewKey, 'manage');
        } else {
            dashboard.classList.remove('hidden');
            manage.classList.add('hidden');
            dashboardText.classList.remove('hidden');
            manageText.classList.add('hidden');
            localStorage.setItem(this.config.viewKey, 'dashboard');
        }
    },

    restoreViewState: function() {
        const savedView = localStorage.getItem(this.config.viewKey);
        if (savedView === 'manage') {
            this.toggleView();
        }
    },

    openImageModal: function(src) {
        const modal = document.getElementById('imageModal');
        const img = document.getElementById('modalImage');
        if (img) img.src = src;
        if (modal) {
            modal.style.display = 'flex';
            document.body.classList.add('modal-open');
        }
    },

    closeImageModal: function() {
        const modal = document.getElementById('imageModal');
        if (modal) {
            modal.style.display = 'none';
            document.body.classList.remove('modal-open');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => SwearModule.init());

// Legacy wrappers for template calls
function openImageModal(src) { SwearModule.openImageModal(src); }
function closeImageModal() { SwearModule.closeImageModal(); }

function confirmDeleteMember(id, name) {
    showConfirmModal({
        title: 'Remove Member',
        message: `Are you sure you want to remove <strong>${name}</strong>? Historical fine data will be preserved, but they will no longer appear in the roster.`,
        danger: true,
        confirmText: 'Remove Member',
        loadingText: 'Removing...',
        onConfirm: async () => {
            const result = await apiPost('/swear/member/delete', { id: id });
            if (result && result.success) {
                setTimeout(() => window.location.reload(), 800);
            }
        }
    });
}
