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
            }

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
