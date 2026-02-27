// /public/js/reminders.js

/**
 * Reminders Management - Refactored to use global FlipClockManager
 */

document.addEventListener('DOMContentLoaded', () => {
    updateCountdowns();
    setInterval(updateCountdowns, 1000);

    // Attach form handlers
    const addForm = document.querySelector('#addReminderModal form');
    if (addForm) {
        addForm.addEventListener('submit', (e) => {
            e.preventDefault();
            submitAdd();
        });
    }

    const editForm = document.getElementById('editReminderForm');
    if (editForm) {
        editForm.addEventListener('submit', (e) => {
            e.preventDefault();
            submitEdit();
        });
    }

    // Use global modal closing helper
    setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay'], [
        closeAddModal, closeEditModal, closeConfirmModal
    ]);
});

function openAddModal() {
    const modal = document.getElementById('addReminderModal');
    const form = modal.querySelector('form');
    if (form) form.reset();
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeAddModal() {
    document.getElementById('addReminderModal').style.display = 'none';
    document.body.style.overflow = 'auto';
}

async function submitAdd() {
    const form = document.querySelector('#addReminderModal form');
    const btn = form.querySelector('button[type="submit"]');
    const originalHtml = btn.innerHTML;
    
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Creating...`;

    const formData = new FormData(form);
    const result = await apiPost('/reminders/add', formData);

    if (result && result.success) {
        window.location.reload(); // Refresh to show new card
    } else {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

function openEditModal(btn) {
    const reminder = JSON.parse(btn.dataset.reminder);
    const modal = document.getElementById('editReminderModal');
    
    document.querySelectorAll('#editReminderModal input[type="checkbox"]').forEach(cb => cb.checked = false);

    document.getElementById('editReminderId').value = reminder.id;
    document.getElementById('editReminderTitle').value = reminder.title;
    document.getElementById('editReminderDescription').value = reminder.description || '';
    document.getElementById('editReminderTime').value = reminder.reminder_time.substring(0, 5);
    
    if (document.getElementById('editReminderOneOff')) {
        document.getElementById('editReminderOneOff').checked = (reminder.is_one_off == 1);
    }
    
    if (reminder.days_of_week) {
        reminder.days_of_week.split(',').forEach(day => {
            const cb = document.getElementById(`editDay${day}`);
            if (cb) cb.checked = true;
        });
    }
    
    if (reminder.recipient_ids) {
        const ids = String(reminder.recipient_ids).split(',');
        ids.forEach(uid => {
            const cb = document.getElementById(`editRecipient${uid}`);
            if (cb) cb.checked = true;
        });
    }
    
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeEditModal() {
    document.getElementById('editReminderModal').style.display = 'none';
    document.body.style.overflow = 'auto';
}

async function submitEdit() {
    const form = document.getElementById('editReminderForm');
    const id = document.getElementById('editReminderId').value;
    const btn = form.querySelector('button[type="submit"]');
    const originalHtml = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Saving...`;

    const formData = new FormData(form);
    const result = await apiPost(`/reminders/update/${id}`, formData);

    if (result && result.success) {
        window.location.reload();
    } else {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

function confirmDeleteReminder(id, title) {
    showConfirmModal({
        title: 'Delete Reminder',
        message: `Are you sure you want to delete "<strong>${title}</strong>"?`,
        danger: true,
        confirmText: 'Delete',
        loadingText: 'Deleting...',
        onConfirm: async () => {
            const result = await apiPost(`/reminders/delete/${id}`);
            if (result && result.success) {
                const card = document.querySelector(`.reminder-card[data-id="${id}"]`);
                if (card) {
                    card.style.opacity = '0';
                    card.style.transform = 'scale(0.9)';
                    setTimeout(() => {
                        card.remove();
                        if (!document.querySelector('.reminder-card')) {
                            window.location.reload();
                        }
                    }, 300);
                }
            }
        }
    });
}

async function toggleReminder(id, active, btn) {
    const card = document.querySelector(`.reminder-card[data-id="${id}"]`);
    const status = active ? 1 : 0;
    
    const result = await apiPost(`/reminders/toggle/${id}`, { active: status });
    if (result) {
        if (btn) {
            btn.innerHTML = getIcon(active ? 'running' : 'paused'); 
            btn.setAttribute('onclick', `toggleReminder(${id}, ${active ? 0 : 1}, this)`);
        }

        const editBtn = card.querySelector('.btn-icon-edit');
        if (editBtn) {
            const data = JSON.parse(editBtn.dataset.reminder);
            data.is_active = status;
            editBtn.dataset.reminder = JSON.stringify(data);
        }

        if (active) card.classList.remove('paused');
        else card.classList.add('paused');
        updateCountdowns();
    }
}

async function toggleDay(reminderId, day, active) {
    const result = await apiPost('/reminders/toggle_day', { id: reminderId, day: day, active: active });
    if (result) {
        const card = document.querySelector(`.reminder-card[data-id="${reminderId}"]`);
        const dots = card.querySelectorAll('.day-dot');
        const dot = dots[day - 1]; 
        
        if (active) {
            dot.classList.add('active');
            dot.setAttribute('onclick', `toggleDay(${reminderId}, ${day}, 0)`);
        } else {
            dot.classList.remove('active');
            dot.setAttribute('onclick', `toggleDay(${reminderId}, ${day}, 1)`);
        }

        const editBtn = card.querySelector('.btn-icon-edit');
        if (editBtn) {
            const data = JSON.parse(editBtn.dataset.reminder);
            let days = data.days_of_week ? String(data.days_of_week).split(',') : [];
            if (active) days.push(String(day));
            else days = days.filter(d => d != String(day));
            data.days_of_week = days.sort((a, b) => a - b).join(',');
            editBtn.dataset.reminder = JSON.stringify(data);
            card.dataset.days = data.days_of_week;
        }
        updateCountdowns();
    }
}

function getNextOccurrence(timeStr, daysStr) {
    if (!daysStr) return null;
    const [h, m] = timeStr.split(':').map(Number);
    const days = daysStr.split(',').map(Number);

    const now = new Date();
    const isoToday = now.getDay() === 0 ? 7 : now.getDay();
    const nowMins  = now.getHours() * 60 + now.getMinutes();
    const targetMins = h * 60 + m;

    for (let offset = 0; offset <= 7; offset++) {
        const checkDay = ((isoToday - 1 + offset) % 7) + 1;
        if (days.includes(checkDay)) {
            if (offset === 0 && targetMins < nowMins) continue; 
            const next = new Date(now);
            next.setDate(now.getDate() + offset);
            next.setHours(h, m, 0, 0);
            return next;
        }
    }
    return null;
}

function updateCountdowns() {
    document.querySelectorAll('.reminder-card').forEach(card => {
        const reminderId = card.dataset.id;
        const el = document.getElementById(`countdown-${reminderId}`);
        if (!el) return;

        if (card.classList.contains('paused')) { 
            el.innerHTML = ''; 
            delete FlipClockManager.prevStates[reminderId];
            return; 
        }

        const next = getNextOccurrence(card.dataset.time, card.dataset.days);
        if (!next) { el.innerHTML = ''; delete FlipClockManager.prevStates[reminderId]; return; }

        const diff = next - new Date();
        if (diff <= 0) {
            el.innerHTML = '<div class="flip-card" style="width: 100%; min-width: 80px;">DUE NOW</div>';
            delete FlipClockManager.prevStates[reminderId];
            return;
        }

        const totalSeconds = Math.floor(diff / 1000);
        const d = Math.floor(totalSeconds / 86400);
        const h = Math.floor((totalSeconds % 86400) / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;

        FlipClockManager.update(el, { 
            dd: d, 
            hh: String(h).padStart(2, '0'), 
            mm: String(m).padStart(2, '0'), 
            ss: String(s).padStart(2, '0') 
        }, reminderId);
    });
}
