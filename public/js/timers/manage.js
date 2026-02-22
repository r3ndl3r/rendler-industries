// /public/js/timers/manage.js

const TimerManagement = {
    init: function() {
        this.attachEventListeners();
    },

    attachEventListeners: function() {
        const btnCreate = document.getElementById('btn-create-timer');
        if (btnCreate) {
            btnCreate.addEventListener('click', () => this.openCreateModal());
        }

        const userFilter = document.getElementById('user-filter');
        if (userFilter) {
            userFilter.addEventListener('change', (e) => this.handleFilterChange(e));
        }

        document.addEventListener('click', (e) => {
            if (e.target.closest('.btn-edit')) {
                this.openEditModal(e.target.closest('.btn-edit'));
            } else if (e.target.closest('.btn-delete')) {
                this.handleDelete(e.target.closest('.btn-delete'));
            } else if (e.target.closest('.btn-icon-bonus')) {
                this.openBonusModal(e.target.closest('.btn-icon-bonus'));
            } else if (e.target.classList.contains('modal-close') || e.target.classList.contains('modal')) {
                this.closeModals();
            }
        });

        const bonusForm = document.getElementById('bonus-form');
        if (bonusForm) {
            bonusForm.addEventListener('submit', (e) => this.handleBonusSubmit(e));
        }
    },

    handleFilterChange: function(e) {
        const userId = e.target.value;
        const url = userId ? `/timers/manage?user_id=${userId}` : '/timers/manage';
        window.location.href = url;
    },

    openCreateModal: function() {
        const modal = document.getElementById('modal-create-timer');
        if (modal) {
            modal.classList.add('active');
        }
    },

    openEditModal: function(button) {
        const modal = document.getElementById('modal-edit-timer');
        if (!modal) return;

        const timerId = button.dataset.timerId;
        const name = button.dataset.name;
        const category = button.dataset.category;
        const weekday = button.dataset.weekday;
        const weekend = button.dataset.weekend;

        document.getElementById('edit-name').value = name;
        document.getElementById('edit-category').value = category;
        document.getElementById('edit-weekday').value = weekday;
        document.getElementById('edit-weekend').value = weekend;

        const form = document.getElementById('edit-timer-form');
        form.action = `/timers/update/${timerId}`;

        modal.classList.add('active');
    },

    openBonusModal: function(button) {
        const modal = document.getElementById('modal-bonus-time');
        if (!modal) return;

        const timerId = button.dataset.timerId;
        document.getElementById('bonus-timer-id').value = timerId;
        document.getElementById('bonus-minutes').value = 15;

        modal.classList.add('active');
    },

    handleDelete: function(button) {
        const timerId = button.dataset.timerId;
        const name = button.dataset.name;

        if (!confirm(`Delete timer "${name}"?\n\nThis action cannot be undone.`)) {
            return;
        }

        const form = document.getElementById('delete-timer-form');
        form.action = `/timers/delete/${timerId}`;
        form.submit();
    },

    handleBonusSubmit: async function(e) {
        e.preventDefault();

        const timerId = document.getElementById('bonus-timer-id').value;
        const minutes = document.getElementById('bonus-minutes').value;

        const result = await TimerUtils.apiCall('/timers/bonus', 'POST', {
            timer_id: timerId,
            bonus_minutes: minutes
        });

        if (result.success) {
            TimerUtils.showToast(result.message, 'success');
            this.closeModals();
            setTimeout(() => window.location.reload(), 1000);
        } else {
            TimerUtils.showToast(result.message || 'Failed to grant bonus time', 'error');
        }
    },

    closeModals: function() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.remove('active');
        });
    }
};
