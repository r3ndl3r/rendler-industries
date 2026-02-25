// /public/js/reminders.js

/**
 * Reminders Management - Refactored to use default.js
 */

document.addEventListener('DOMContentLoaded', () => {
    updateCountdowns();
    setInterval(updateCountdowns, 60000);

    // Use global modal closing helper
    setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay'], [
        closeAddModal, closeEditModal, closeDeleteModal
    ]);
});

function openAddModal() {
    document.getElementById('addReminderModal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeAddModal() {
    document.getElementById('addReminderModal').style.display = 'none';
    document.body.style.overflow = 'auto';
}

function openEditModal(btn) {
    const reminder = JSON.parse(btn.dataset.reminder);
    const modal = document.getElementById('editReminderModal');
    const form = document.getElementById('editReminderForm');
    
    document.getElementById('editReminderId').value = reminder.id;
    document.getElementById('editReminderTitle').value = reminder.title;
    document.getElementById('editReminderDescription').value = reminder.description || '';
    document.getElementById('editReminderTime').value = reminder.reminder_time.substring(0, 5);
    document.getElementById('editReminderOneOff').checked = reminder.is_one_off == 1;
    
    form.action = `/reminders/update/${reminder.id}`;
    document.querySelectorAll('#editReminderModal input[type="checkbox"]').forEach(cb => cb.checked = false);
    
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

function confirmDeleteReminder(id, title) {
    const modal = document.getElementById('deleteConfirmModal');
    const titleEl = document.getElementById('deleteReminderTitle');
    const form = document.getElementById('deleteForm');
    
    titleEl.textContent = title;
    form.action = `/reminders/delete/${id}`;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeDeleteModal() {
    document.getElementById('deleteConfirmModal').style.display = 'none';
    document.body.style.overflow = 'auto';
}

async function toggleReminder(id, active, btn) {
    const card = document.querySelector(`.reminder-card[data-id="${id}"]`);
    const status = active ? 1 : 0;
    
    const result = await apiPost(`/reminders/toggle/${id}`, { active: status });
    if (result) {
        if (btn) {
            if (active) {
                btn.className = 'btn-icon-view btn-status-toggle';
                btn.innerHTML = '▶️'; 
                btn.title = 'Pause Reminder';
                btn.setAttribute('onclick', `toggleReminder(${id}, 0, this)`);
            } else {
                btn.className = 'btn-icon-copy btn-status-toggle';
                btn.innerHTML = '⏸️'; 
                btn.title = 'Resume Reminder';
                btn.setAttribute('onclick', `toggleReminder(${id}, 1, this)`);
            }
        }

        const editBtn = card.querySelector('.btn-icon-edit');
        if (editBtn) {
            const data = JSON.parse(editBtn.dataset.reminder);
            data.is_active = status;
            editBtn.dataset.reminder = JSON.stringify(data);
        }

        if (active) {
            card.classList.remove('paused');
        } else {
            card.classList.add('paused');
        }
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
        const el = document.getElementById(`countdown-${card.dataset.id}`);
        if (!el) return;

        if (card.classList.contains('paused') || (card.dataset.oneOff == 1 && card.dataset.lastRun)) { 
            el.textContent = ''; 
            return; 
        }

        const next = getNextOccurrence(card.dataset.time, card.dataset.days);
        // Uses global formatCountdown from default.js
        el.textContent = next ? formatCountdown(next - new Date()) : '';
    });
}
