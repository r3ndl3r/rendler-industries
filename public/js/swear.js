// /public/js/swear.js

/**
 * Swear Jar Controller
 * 
 * Manages the high-accountability family financial jar. Implements a 
 * synchronized state-driven interface for tracking offenses, payments, 
 * and community fund expenditures.
 * 
 * Features:
 * - Real-time state synchronization via /swear/api/state
 * - Optimistic UI updates with instant local reconciliation
 * - Multi-view orchestration (Dashboard vs. Administration)
 * - Themed modal-driven confirmation workflows
 * - Glassmorphism rule document lightbox
 * 
 * Dependencies:
 * - default.js: For apiPost, getIcon, showConfirmModal, showToast
 */

/**
 * Global Configuration & Persistent State
 */
const CONFIG = {
    VIEW_KEY: 'swear_jar_active_view',
    SYNC_INTERVAL: 300000 // 5 minutes
};

let STATE = {
    leaderboard: [],
    balance: 0,
    history: [],
    members: [],
    isAdmin: false,
    currentUser: 'Guest'
};

const SwearModule = {
    /**
     * Bootstraps the module logic and establishes lifecycles.
     * 
     * @returns {void}
     */
    init: function() {
        this.loadState();
        this.restoreViewState();
        
        // Global modal behavior
        setupGlobalModalClosing(['modal-overlay'], [
            () => this.closeImageModal(),
            closeConfirmModal
        ]);

        // Background sync
        setInterval(() => this.loadState(), CONFIG.SYNC_INTERVAL);
    },

    /**
     * Synchronizes module state with the server.
     * 
     * @async
     * @returns {Promise<void>}
     */
    loadState: async function() {
        try {
            const response = await fetch('/swear/api/state');
            const data = await response.json();
            
            if (data && data.success) {
                STATE = data;
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
        this.renderBalance();
        this.renderDropdowns();
        this.renderLeaderboard();
        this.renderHistory();
        this.renderMemberList();
    },

    /**
     * Updates the primary jar balance display.
     * 
     * @returns {void}
     */
    renderBalance: function() {
        const balanceEl = document.getElementById('jarBalance');
        if (balanceEl) {
            balanceEl.textContent = `$${parseFloat(STATE.balance).toFixed(2)}`;
        }
    },

    /**
     * Hydrates member selection dropdowns.
     * 
     * @returns {void}
     */
    renderDropdowns: function() {
        const selects = ['perp_select', 'extra_perp_select'];
        selects.forEach(id => {
            const select = document.getElementById(id);
            if (!select) return;
            
            const currentValue = select.value;
            select.innerHTML = '<option value="" data-fine="0" class="select-placeholder">Select Member...</option>';
            
            STATE.members.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.name;
                opt.textContent = m.name;
                opt.setAttribute('data-fine', m.default_fine);
                opt.className = 'select-option';
                select.appendChild(opt);
            });
            
            select.value = currentValue;
        });
    },

    /**
     * Generates the debt shame-list from state.
     * 
     * @returns {void}
     */
    renderLeaderboard: function() {
        const container = document.getElementById('leaderboardContainer');
        if (!container) return;

        if (STATE.leaderboard.length === 0) {
            container.innerHTML = '<p class="empty-state">No active debts.</p>';
            return;
        }

        container.innerHTML = STATE.leaderboard.map(row => {
            const isSelf = STATE.currentUser && row.perpetrator.toLowerCase() === STATE.currentUser.toLowerCase();
            
            return `
                <div class="jar-row flex-wrap">
                    <span class="member-name">${escapeHtml(row.perpetrator)}</span>
                    <div class="debt-actions">
                        <span class="debt-amount">$${parseFloat(row.total).toFixed(2)}</span>
                        ${!isSelf ? `
                            <form class="pay-debt-form" onsubmit="SwearModule.handlePaymentSubmit(event)">
                                <input type="hidden" name="perpetrator" value="${escapeHtml(row.perpetrator)}">
                                <input type="number" name="amount" value="${parseFloat(row.total).toFixed(2)}" step="0.50" min="0" class="game-input small-input">
                                <button class="btn-icon-edit" onclick="openEditModal(${row.id})" title="Edit">✏️</button>
                            </form>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    },

    /**
     * Populates the chronological history log.
     * 
     * @returns {void}
     */
    renderHistory: function() {
        const container = document.getElementById('historyContainer');
        if (!container) return;

        if (STATE.history.length === 0) {
            container.innerHTML = '<p class="empty-state">No recent activity.</p>';
            return;
        }

        container.innerHTML = STATE.history.map(item => {
            let title = '';
            if (item.type === 'fine') {
                title = `<strong class="white-text">${escapeHtml(item.perpetrator)}</strong> owed`;
            } else if (item.type === 'payment') {
                title = `<strong class="success-text">${escapeHtml(item.perpetrator)}</strong> deposited`;
            } else {
                title = `<strong class="success-text">JAR SPEND</strong>`;
            }

            const amountClass = item.type === 'payment' ? 'success-text' : 'white-text';
            const amountPrefix = item.type === 'payment' ? '+' : '';
            const reason = item.reason ? `- ${escapeHtml(item.reason)}` : '';
            const payer = (item.type === 'payment' && item.payer_name) ? ` By ${escapeHtml(item.payer_name)}` : '';

            return `
                <div class="history-item type-${item.type}">
                    <div class="history-meta">
                        <span>${title}</span>
                        <span class="history-amount ${amountClass}">
                            ${amountPrefix}$${parseFloat(item.amount).toFixed(2)}
                        </span>
                    </div>
                    <small class="history-date">
                        ${item.created_at} ${reason} ${payer}
                    </small>
                </div>
            `;
        }).join('');
    },

    /**
     * Hydrates the administrative member list.
     * 
     * @returns {void}
     */
    renderMemberList: function() {
        const container = document.getElementById('memberListContainer');
        if (!container) return;

        if (STATE.members.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>📭 No members found.</p></div>';
            return;
        }

        container.innerHTML = STATE.members.map(m => `
            <div class="member-row" data-id="${m.id}">
                <div>
                    <strong class="member-display-name">${escapeHtml(m.name)}</strong>
                    <br>
                    <span class="member-default-fine">Default: $${parseFloat(m.default_fine).toFixed(2)}</span>
                </div>
                <button class="btn-icon-delete" onclick="confirmDeleteMember(${m.id}, '${escapeHtml(m.name)}')" title="Delete">🗑️</button>
            </div>
        `).join('');
    },

    /**
     * Logic: updateFine
     * Syncs input amount with selected member's penalty rate.
     * 
     * @returns {void}
     */
    updateFine: function() {
        const select = document.getElementById('perp_select');
        const amountInput = document.getElementById('fine_amount');
        if (!select || !amountInput) return;
        
        const selectedOption = select.options[select.selectedIndex];
        const defaultFine = selectedOption?.getAttribute('data-fine');
        
        if (defaultFine && parseFloat(defaultFine) > 0) {
            amountInput.value = parseFloat(defaultFine).toFixed(2);
        }
    },

    /**
     * Handlers: Forms
     */

    /**
     * Processes new fine reporting.
     * 
     * @async
     * @param {Event} e - Form event.
     * @returns {Promise<void>}
     */
    handleFineSubmit: async function(e) {
        e.preventDefault();
        const btn = document.getElementById('addFineBtn');
        const originalHtml = btn.innerHTML;

        btn.disabled = true;
        btn.innerHTML = `⌛ Reporting...`;

        try {
            const formData = new FormData(e.target);
            const result = await apiPost('/swear/api/add', Object.fromEntries(formData));

            if (result && result.success) {
                e.target.reset();
                this.updateFine();
                await this.loadState();
            }
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    },

    /**
     * Processes debt clearance deposits.
     * 
     * @async
     * @param {Event} e - Form event.
     * @returns {Promise<void>}
     */
    handlePaymentSubmit: async function(e) {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        const originalHtml = btn.innerHTML;

        btn.disabled = true;
        btn.innerHTML = `⌛...`;

        try {
            const formData = new FormData(e.target);
            const result = await apiPost('/swear/api/pay', Object.fromEntries(formData));

            if (result && result.success) {
                await this.loadState();
            }
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    },

    /**
     * Processes extra-credit deposits.
     * 
     * @async
     * @param {Event} e - Form event.
     * @returns {Promise<void>}
     */
    handleDepositSubmit: async function(e) {
        e.preventDefault();
        const btn = document.getElementById('extraDepositBtn');
        const originalHtml = btn.innerHTML;

        btn.disabled = true;
        btn.innerHTML = `⌛ Depositing...`;

        try {
            const formData = new FormData(e.target);
            const result = await apiPost('/swear/api/pay', Object.fromEntries(formData));

            if (result && result.success) {
                e.target.reset();
                await this.loadState();
            }
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    },

    /**
     * Processes community fund withdrawals.
     * 
     * @async
     * @param {Event} e - Form event.
     * @returns {Promise<void>}
     */
    handleSpendSubmit: async function(e) {
        e.preventDefault();
        const btn = document.getElementById('spendBtn');
        const originalHtml = btn.innerHTML;

        btn.disabled = true;
        btn.innerHTML = `⌛ Spending...`;

        try {
            const formData = new FormData(e.target);
            const result = await apiPost('/swear/api/spend', Object.fromEntries(formData));

            if (result && result.success) {
                e.target.reset();
                await this.loadState();
            }
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    },

    /**
     * Processes new member registration.
     * 
     * @async
     * @param {Event} e - Form event.
     * @returns {Promise<void>}
     */
    handleAddMemberSubmit: async function(e) {
        e.preventDefault();
        const btn = document.getElementById('addMemberBtn');
        const originalHtml = btn.innerHTML;

        btn.disabled = true;
        btn.innerHTML = `⌛ Adding...`;

        try {
            const formData = new FormData(e.target);
            const result = await apiPost('/swear/api/member/add', Object.fromEntries(formData));

            if (result && result.success) {
                e.target.reset();
                await this.loadState();
            }
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    },

    /**
     * Interface: toggleView
     * Swaps between Jar dashboard and Admin management.
     * 
     * @returns {void}
     */
    toggleView: function() {
        const dashboard = document.getElementById('swearDashboardView');
        const manage = document.getElementById('swearManageView');
        const btn = document.getElementById('toggleViewBtn');
        const dashboardText = btn?.querySelector('.view-dashboard-text');
        const manageText = btn?.querySelector('.view-manage-text');

        if (!dashboard || !manage) return;

        const isDashboardVisible = !dashboard.classList.contains('hidden');

        if (isDashboardVisible) {
            dashboard.classList.add('hidden');
            manage.classList.remove('hidden');
            dashboardText?.classList.add('hidden');
            manageText?.classList.remove('hidden');
            localStorage.setItem(CONFIG.VIEW_KEY, 'manage');
        } else {
            dashboard.classList.remove('hidden');
            manage.classList.add('hidden');
            dashboardText?.classList.remove('hidden');
            manageText?.classList.add('hidden');
            localStorage.setItem(CONFIG.VIEW_KEY, 'dashboard');
        }
    },

    /**
     * Interface: restoreViewState
     * Hydrates view pointer from session persistence.
     * 
     * @returns {void}
     */
    restoreViewState: function() {
        const savedView = localStorage.getItem(CONFIG.VIEW_KEY);
        if (savedView === 'manage') {
            this.toggleView();
        }
    },

    /**
     * Lightbox Orchestration
     */

    /**
     * Opens rule document in a glass lightbox.
     * 
     * @param {string} src - Image source URL.
     * @returns {void}
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
     * 
     * @returns {void}
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
 * Bootstrapper
 */
document.addEventListener('DOMContentLoaded', () => SwearModule.init());

/**
 * Global Exposure for inline handlers
 */
window.openImageModal = (src) => SwearModule.openImageModal(src);
window.closeImageModal = () => SwearModule.closeImageModal();

/**
 * Admin: confirmDeleteMember
 * Specialized confirmation logic for roster removal.
 * 
 * @param {number} id - Member ID.
 * @param {string} name - Member name.
 * @returns {void}
 */
window.confirmDeleteMember = (id, name) => {
    showConfirmModal({
        title: 'Remove Member',
        message: `Are you sure you want to remove <strong>${escapeHtml(name)}</strong>? Historical data will be preserved.`,
        danger: true,
        confirmText: 'Remove',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const result = await apiPost('/swear/api/member/delete', { id });
            if (result && result.success) {
                STATE.members = STATE.members.filter(m => m.id != id);
                SwearModule.renderUI();
            }
        }
    });
};
