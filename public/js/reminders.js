// /public/js/reminders.js

/**
 * Reminders Management - 100% AJAX SPA Implementation
 */

let appState = {
    reminders: [],
    recipients: []
};

document.addEventListener('DOMContentLoaded', () => {
    loadState();
    setInterval(updateCountdowns, 1000);
    
    // Background Sync: Refresh state every 60s to stay in sync with server maintenance
    setInterval(loadState, 60000);

    // Attach form handlers
    const addForm = document.getElementById('addReminderForm');
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

/**
 * Core Data Management
 */
async function loadState() {
    // Inhibit background polling if user is currently interacting with a modal
    const anyModalOpen = document.querySelector('.modal-overlay.show');
    if (anyModalOpen && appState.reminders.length > 0) return;

    const container = document.getElementById('remindersListContainer');
    if (container && appState.reminders.length === 0) {
        container.innerHTML = getLoadingHtml('Syncing reminders...');
    }

    try {
        const response = await fetch('/reminders/api/state');
        const data = await response.json();
        appState.reminders = data.reminders;
        appState.recipients = data.recipients;
        renderReminders();
    } catch (err) {
        console.error('Failed to load reminders state:', err);
        showToast('Connection error. Failed to sync reminders.', 'error');
    }
}

/**
 * Rendering Engine
 */
function renderReminders() {
    const container = document.getElementById('remindersListContainer');
    if (!container) return;

    // Reset FlipClock state tracker to force fresh rendering into new DOM elements
    FlipClockManager.prevStates = {};

    if (appState.reminders.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>📭 No recurring reminders configured.</p>
                <p class="empty-hint">Click the button above to create your first weekly reminder.</p>
            </div>`;
        return;
    }

    // Sorting by first to be triggered
    const sorted = [...appState.reminders].sort((a, b) => {
        // Paused reminders go to the bottom
        if (a.is_active !== b.is_active) return b.is_active - a.is_active;

        const nextA = getNextOccurrence(a.reminder_time, a.days_of_week, a.last_run_at);
        const nextB = getNextOccurrence(b.reminder_time, b.days_of_week, b.last_run_at);

        if (!nextA) return 1;
        if (!nextB) return -1;
        return nextA - nextB;
    });

    container.innerHTML = sorted.map(r => renderReminderCard(r)).join('');
    
    // Initial countdown update
    updateCountdowns();
    
    // Refresh modal selectors
    renderSelectors();
}

function renderReminderCard(r) {
    const isActive = !!r.is_active;
    const isOneOff = !!r.is_one_off;
    const reminderTime = r.reminder_time.substring(0, 5);
    
    // Time formatting
    const [hRaw, mRaw] = reminderTime.split(':');
    let h = parseInt(hRaw);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    const displayTime = `${h}:${mRaw}`;

    // Active Days dots
    const activeDays = (r.days_of_week || '').split(',').reduce((acc, d) => { acc[d] = true; return acc; }, {});
    const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const dayDots = dayLabels.map((label, idx) => {
        const dayNum = idx + 1;
        const active = activeDays[dayNum];
        return `<span class="day-dot ${active ? 'active' : ''}" onclick="toggleDay(${r.id}, ${dayNum}, ${active ? 0 : 1})" title="${getDayFullName(dayNum)}">${label}</span>`;
    }).join('');

    // Recipients
    const recipientPills = (r.recipient_names || '').split(',').filter(n => n).map(name => 
        `<span class="recipient-badge">${getIcon('reminders')} ${escapeHtml(name)}</span>`
    ).join('');

    return `
        <div class="glass-panel reminder-card ${isActive ? '' : 'paused'}"
             data-id="${r.id}"
             data-time="${reminderTime}"
             data-days="${r.days_of_week || ''}"
             data-one-off="${isOneOff ? '1' : '0'}"
             data-last-run="${r.last_run_at || ''}">
            <div class="reminder-header">
                <div class="title-stack">
                    ${isOneOff ? `<span class="one-off-badge">${getIcon('clock')} One-off</span>` : ''}
                    <h2 class="reminder-title">${escapeHtml(r.title)}</h2>
                </div>
            </div>

            <div class="reminder-time">
                <div class="reminder-time-main">
                    <span class="clock-icon">${getIcon('clock')}</span>
                    <span class="time-text">${displayTime}</span>
                    <span class="time-ampm">${ampm}</span>
                </div>
                <div class="flip-clock" id="countdown-${r.id}"></div>
            </div>

            <div class="reminder-days">
                ${dayDots}
            </div>

            ${r.description ? `<p class="reminder-desc">${escapeHtml(r.description)}</p>` : `<p class="reminder-desc reminder-desc-empty">No description provided.</p>`}

            <div class="reminder-recipients">
                <span class="label">Recipients</span>
                <div class="recipient-pills">
                    ${recipientPills || '<span class="recipient-badge-empty">No recipients</span>'}
                </div>
            </div>

            <div class="reminder-footer-actions">
                <button class="btn-icon-${isActive ? 'view' : 'copy'} btn-status-toggle"
                        onclick="toggleReminder(${r.id}, ${isActive ? 0 : 1}, this)"
                        title="${isActive ? 'Pause Reminder' : 'Resume Reminder'}">
                    ${getIcon(isActive ? 'running' : 'paused')}
                </button>
                <button class="btn-icon-edit"
                        onclick="prepareEditModal(${r.id})"
                        title="Edit Reminder">${getIcon('edit')}
                </button>
                <button class="btn-icon-delete"
                        onclick="confirmDeleteReminder(${r.id}, \`${r.title.replace(/`/g, '\\`')}\`)"
                        title="Delete Reminder">${getIcon('delete')}
                </button>
            </div>
        </div>
    `;
}

function renderSelectors() {
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    
    const renderDays = (prefix) => {
        const container = document.getElementById(`${prefix}DaysSelector`);
        if (!container) return;
        container.innerHTML = dayNames.map((name, i) => `
            <label class="day-checkbox">
                <input type="checkbox" name="days[]" value="${i + 1}" id="${prefix}Day${i + 1}">
                <span>${name}</span>
            </label>
        `).join('');
    };

    const renderRecipients = (prefix) => {
        const container = document.getElementById(`${prefix}RecipientsSelector`);
        if (!container) return;
        container.innerHTML = appState.recipients.map(u => `
            <label class="recipient-checkbox">
                <input type="checkbox" name="recipients[]" value="${u.id}" id="${prefix}Recipient${u.id}">
                <span>${escapeHtml(u.username)}</span>
            </label>
        `).join('');
    };

    renderDays('add');
    renderDays('edit');
    renderRecipients('add');
    renderRecipients('edit');
}

/**
 * Modal Management
 */
function openAddModal() {
    const modal = document.getElementById('addReminderModal');
    const form = document.getElementById('addReminderForm');
    if (form) form.reset();
    modal.classList.add('show');
}

function closeAddModal() {
    document.getElementById('addReminderModal').classList.remove('show');
}

function prepareEditModal(id) {
    const r = appState.reminders.find(item => item.id == id);
    if (!r) return;

    const modal = document.getElementById('editReminderModal');
    const form = document.getElementById('editReminderForm');
    form.reset();

    document.getElementById('editReminderId').value = r.id;
    document.getElementById('editReminderTitle').value = r.title;
    document.getElementById('editReminderDescription').value = r.description || '';
    document.getElementById('editReminderTime').value = r.reminder_time.substring(0, 5);
    document.getElementById('editReminderOneOff').checked = (r.is_one_off == 1);

    if (r.days_of_week) {
        r.days_of_week.split(',').forEach(d => {
            const cb = document.getElementById(`editDay${d}`);
            if (cb) cb.checked = true;
        });
    }

    if (r.recipient_ids) {
        String(r.recipient_ids).split(',').forEach(uid => {
            const cb = document.getElementById(`editRecipient${uid}`);
            if (cb) cb.checked = true;
        });
    }

    modal.classList.add('show');
}

function closeEditModal() {
    document.getElementById('editReminderModal').classList.remove('show');
}

/**
 * API Interactions
 */
async function submitAdd() {
    const form = document.getElementById('addReminderForm');
    const btn = form.querySelector('button[type="submit"]');
    const originalHtml = btn.innerHTML;
    
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Creating...`;

    const result = await apiPost('/reminders/add', new FormData(form));
    if (result && result.success) {
        closeAddModal();
        await loadState();
    } else {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

async function submitEdit() {
    const form = document.getElementById('editReminderForm');
    const id = document.getElementById('editReminderId').value;
    const btn = form.querySelector('button[type="submit"]');
    const originalHtml = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Saving...`;

    const result = await apiPost(`/reminders/update/${id}`, new FormData(form));
    if (result && result.success) {
        closeEditModal();
        await loadState();
    } else {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

function confirmDeleteReminder(id, title) {
    showConfirmModal({
        title: 'Delete Reminder',
        message: `Are you sure you want to delete "<strong>${escapeHtml(title)}</strong>"?`,
        danger: true,
        confirmText: 'Delete',
        onConfirm: async () => {
            const result = await apiPost(`/reminders/delete/${id}`);
            if (result && result.success) {
                await loadState();
            }
        }
    });
}

async function toggleReminder(id, active) {
    const result = await apiPost(`/reminders/toggle/${id}`, { active: active ? 1 : 0 });
    if (result && result.success) {
        await loadState();
    }
}

async function toggleDay(reminderId, day, active) {
    const result = await apiPost('/reminders/toggle_day', { id: reminderId, day: day, active: active });
    if (result && result.success) {
        await loadState();
    }
}

/**
 * Countdown Engine
 */
function getNextOccurrence(timeStr, daysStr, lastRunAt = '') {
    if (!daysStr) return null;
    const [h, m] = timeStr.split(':').map(Number);
    const days = daysStr.split(',').map(Number);

    const now = new Date();
    const isoToday = now.getDay() === 0 ? 7 : now.getDay();
    const nowMins  = now.getHours() * 60 + now.getMinutes();
    const targetMins = h * 60 + m;

    // Check if it already ran today based on server timestamp
    let hasRunToday = false;
    if (lastRunAt) {
        const lastRun = new Date(lastRunAt.replace(' ', 'T'));
        if (lastRun.toDateString() === now.toDateString()) {
            hasRunToday = true;
        }
    }

    for (let offset = 0; offset <= 7; offset++) {
        const checkDay = ((isoToday - 1 + offset) % 7) + 1;
        if (days.includes(checkDay)) {
            // If it's today, it must be either not run yet, or the time must be in the future
            if (offset === 0) {
                if (hasRunToday || targetMins < nowMins) continue;
            }
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

        const next = getNextOccurrence(card.dataset.time, card.dataset.days, card.dataset.lastRun);
        if (!next) { 
            el.innerHTML = ''; 
            delete FlipClockManager.prevStates[reminderId]; 
            return; 
        }

        const diff = next - new Date();
        if (diff <= 0) {
            el.innerHTML = '<div class="flip-card due-badge">DUE NOW</div>';
            delete FlipClockManager.prevStates[reminderId];
            
            // Auto-removal for one-off reminders
            if (card.dataset.oneOff === '1' && !card.classList.contains('row-fade-out')) {
                setTimeout(() => {
                    card.classList.add('row-fade-out');
                    setTimeout(() => {
                        appState.reminders = appState.reminders.filter(r => r.id != reminderId);
                        card.remove();
                    }, 500); // Wait for fade animation
                }, 2000); // Keep "DUE NOW" visible for 2s before removal
            }
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

/**
 * Utility
 */
function getDayFullName(day) {
    return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][day - 1];
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
