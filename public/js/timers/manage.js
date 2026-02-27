// /public/js/timers/manage.js

const TimerManagement = {
    init: function() {
        this.attachEventListeners();
        
        // Use global modal closing helper
        setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay'], [
            () => this.closeModals(),
            closeConfirmModal
        ]);
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
            if (e.target.closest('.btn-icon-edit')) {
                this.openEditModal(e.target.closest('.btn-icon-edit'));
            } else if (e.target.closest('.btn-icon-delete')) {
                this.handleDelete(e.target.closest('.btn-icon-delete'));
            } else if (e.target.closest('.btn-icon-bonus')) {
                this.openBonusModal(e.target.closest('.btn-icon-bonus'));
            }
        });

        const createForm = document.getElementById('create-timer-form');
        if (createForm) {
            createForm.addEventListener('submit', (e) => this.handleSubmit(e, '/timers/create'));
        }

        const editForm = document.getElementById('edit-timer-form');
        if (editForm) {
            editForm.addEventListener('submit', (e) => {
                const id = document.getElementById('edit-timer-id').value;
                this.handleSubmit(e, `/timers/update/${id}`);
            });
        }

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
            const form = document.getElementById('create-timer-form');
            if (form) form.reset();
            modal.style.display = 'flex';
            document.body.classList.add('modal-open');
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

        document.getElementById('edit-timer-id').value = timerId;
        document.getElementById('edit-name').value = name;
        document.getElementById('edit-category').value = category;
        document.getElementById('edit-weekday').value = weekday;
        document.getElementById('edit-weekend').value = weekend;

        modal.style.display = 'flex';
        document.body.classList.add('modal-open');
    },

    openBonusModal: function(button) {
        const modal = document.getElementById('modal-bonus-time');
        if (!modal) return;

        const timerId = button.dataset.timerId;
        document.getElementById('bonus-timer-id').value = timerId;
        document.getElementById('bonus-minutes').value = 15;

        modal.style.display = 'flex';
        document.body.classList.add('modal-open');
    },

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
            this.closeModals();
            window.location.reload();
        } else {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    },

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

    closeModals: function() {
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.style.display = 'none';
        });
        document.body.classList.remove('modal-open');
    }
};
