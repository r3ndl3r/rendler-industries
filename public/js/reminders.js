/* /public/js/reminders.js */

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
    
    // Set basic fields
    document.getElementById('editReminderId').value = reminder.id;
    document.getElementById('editReminderTitle').value = reminder.title;
    document.getElementById('editReminderDescription').value = reminder.description || '';
    document.getElementById('editReminderTime').value = reminder.reminder_time.substring(0, 5);
    document.getElementById('editReminderOneOff').checked = reminder.is_one_off == 1;
    
    // Set form action
    form.action = `/reminders/update/${reminder.id}`;
    
    // Reset all checkboxes first
    document.querySelectorAll('#editReminderModal input[type="checkbox"]').forEach(cb => cb.checked = false);
    
    // Set days
    if (reminder.days_of_week) {
        reminder.days_of_week.split(',').forEach(day => {
            const cb = document.getElementById(`editDay${day}`);
            if (cb) cb.checked = true;
        });
    }
    
    // Set recipients
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
    
    try {
        const response = await fetch(`/reminders/toggle/${id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ active: status })
        });
        const result = await response.json();
        
        if (result.success) {
            // 1. Update the button visuals
            if (btn) {
                if (active) {
                    btn.className = 'btn-icon-view btn-status-toggle';
                    btn.innerHTML = '▶️'; 
                    btn.title = 'Pause Reminder';
                    // Need to use setAttribute for the next call to work correctly with existing logic
                    btn.setAttribute('onclick', `toggleReminder(${id}, 0, this)`);
                } else {
                    btn.className = 'btn-icon-copy btn-status-toggle';
                    btn.innerHTML = '⏸️'; 
                    btn.title = 'Resume Reminder';
                    btn.setAttribute('onclick', `toggleReminder(${id}, 1, this)`);
                }
            }

            // 2. Update the data-reminder state if edit button exists
            const editBtn = card.querySelector('.btn-icon-edit');
            if (editBtn) {
                const data = JSON.parse(editBtn.dataset.reminder);
                data.is_active = status;
                editBtn.dataset.reminder = JSON.stringify(data);
            }

            if (active) {
                card.classList.remove('paused');
                showToast('Reminder resumed', 'success');
            } else {
                card.classList.add('paused');
                showToast('Reminder paused', 'info');
            }
            updateCountdowns();
        } else {
            showToast('Failed to update status', 'error');
        }
    } catch (err) {
        showToast('Request failed', 'error');
    }
}

async function toggleDay(reminderId, day, active) {
    try {
        const response = await fetch('/reminders/toggle_day', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ id: reminderId, day: day, active: active })
        });
        const result = await response.json();
        
        if (result.success) {
            // 1. Update visual dot state
            const card = document.querySelector(`.reminder-card[data-id="${reminderId}"]`);
            const dots = card.querySelectorAll('.day-dot');
            const dot = dots[day - 1]; // 1-indexed days
            
            if (active) {
                dot.classList.add('active');
                dot.setAttribute('onclick', `toggleDay(${reminderId}, ${day}, 0)`);
            } else {
                dot.classList.remove('active');
                dot.setAttribute('onclick', `toggleDay(${reminderId}, ${day}, 1)`);
            }

            // 2. Sync data-reminder attribute on the Edit button
            const editBtn = card.querySelector('.btn-icon-edit');
            if (editBtn) {
                const data = JSON.parse(editBtn.dataset.reminder);
                let days = data.days_of_week ? String(data.days_of_week).split(',') : [];
                
                if (active) {
                    days.push(String(day));
                } else {
                    days = days.filter(d => d != String(day));
                }
                
                data.days_of_week = days.sort((a, b) => a - b).join(',');
                editBtn.dataset.reminder = JSON.stringify(data);
                card.dataset.days = data.days_of_week;
            }

            updateCountdowns();
            showToast('Schedule updated', 'success');
        } else {
            showToast('Failed to update schedule', 'error');
        }
    } catch (err) {
        showToast('Request failed', 'error');
    }
}

// Close modals on outside click
window.onclick = function(event) {
    const addModal = document.getElementById('addReminderModal');
    const editModal = document.getElementById('editReminderModal');
    const deleteModal = document.getElementById('deleteConfirmModal');
    
    if (event.target == addModal) closeAddModal();
    if (event.target == editModal) closeEditModal();
    if (event.target == deleteModal) closeDeleteModal();
}

function getNextOccurrence(timeStr, daysStr) {
    if (!daysStr) return null;
    const [h, m] = timeStr.split(':').map(Number);
    const days = daysStr.split(',').map(Number); // 1=Mon, 7=Sun

    const now = new Date();
    const jsDay = now.getDay();                        // 0=Sun...6=Sat
    const isoToday = jsDay === 0 ? 7 : jsDay;         // remap to 1=Mon, 7=Sun
    const nowMins  = now.getHours() * 60 + now.getMinutes();
    const targetMins = h * 60 + m;

    for (let offset = 0; offset <= 7; offset++) {
        const checkDay = ((isoToday - 1 + offset) % 7) + 1;
        if (days.includes(checkDay)) {
            // FIX A: Keep "Due now" active for the duration of the current minute
            if (offset === 0 && targetMins < nowMins) continue; 
            const next = new Date(now);
            next.setDate(now.getDate() + offset);
            next.setHours(h, m, 0, 0);
            return next;
        }
    }
    return null;
}

function formatCountdown(ms) {
    if (ms <= 0) return 'Due now';
    const totalMins = Math.floor(ms / 60000);
    const days  = Math.floor(totalMins / 1440);
    const hours = Math.floor((totalMins % 1440) / 60);
    const mins  = totalMins % 60;
    
    if (days  > 0) return `in ${days}d ${hours}h`;
    if (hours > 0) return `in ${hours}h ${mins}m`;
    if (mins  > 0) return `in ${mins}m`;
    return 'Due now';
}

function updateCountdowns() {
    document.querySelectorAll('.reminder-card').forEach(card => {
        const el = document.getElementById(`countdown-${card.dataset.id}`);
        if (!el) return;

        // FIX C: Hide countdown if card is paused OR if one-off has already run
        if (card.classList.contains('paused') || (card.dataset.oneOff == 1 && card.dataset.lastRun)) { 
            el.textContent = ''; 
            return; 
        }

        const next = getNextOccurrence(card.dataset.time, card.dataset.days);
        el.textContent = next ? formatCountdown(next - new Date()) : '';
    });
}

document.addEventListener('DOMContentLoaded', () => {
    updateCountdowns();
    setInterval(updateCountdowns, 60000);
});
