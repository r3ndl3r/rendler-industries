// /public/js/birthdays.js

/**
 * Birthday Management Module
 * 
 * This module manages the Family Birthday Tracker. It handles real-time
 * countdowns, age calculations, and administrative record management
 * through a 100% AJAX-driven SPA interface.
 * 
 * Features:
 * - Real-time countdowns (updated every 60 seconds)
 * - Automated Western and Chinese Zodiac determination
 * - Administrative management mode for CRUD operations
 * - Mandatory Action pattern for secure record deletion
 * 
 * Dependencies:
 * - default.js: For apiPost, getIcon, escapeHtml, and modal helpers
 * - toast.js: For notification feedback
 */

/**
 * Application State
 * Coordinates internal data store and interface mode
 */
let birthdaysData = [];             // Collection of {id, name, birth_date, zodiac, chinese_zodiac, formatted_date}
let manageMode = false;             // Toggle state for administrative vs countdown view

/**
 * Initialization System
 * Triggers initial sync, sets up recurring countdown updates, and configures modal closure.
 */
document.addEventListener('DOMContentLoaded', () => {
    // Bootstrap initial data collection from server
    refreshBirthdays();
    
    // Schedule background countdown updates (1-minute resolution)
    setInterval(updateCountdowns, 60000);

    // Modal: Configure global click-outside-to-close behavior for all overlays
    setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay'], [
        closeModal, closeConfirmModal
    ]);
});

/**
 * --- Data Management ---
 */

/**
 * Syncs the birthday collection with the server-side source of truth.
 * 
 * @returns {Promise<void>}
 */
async function refreshBirthdays() {
    try {
        const response = await fetch('/birthdays/api/data');
        const data = await response.json();
        if (data.success) {
            // Update local store and trigger comprehensive UI refresh
            birthdaysData = data.birthdays;
            renderUI();
        }
    } catch (err) {
        console.error('refreshBirthdays error:', err);
        showToast("Failed to load birthday data", "error");
    }
}

/**
 * Action: submitBirthdayForm
 * Handles both Addition and Editing of birthday records.
 * 
 * @param {Event} event - Form submission event
 */
async function submitBirthdayForm(event) {
    event.preventDefault();
    
    // Determine context (ID presence indicates Edit mode)
    const id = document.getElementById('field_id').value;
    const url = id ? `/birthdays/edit/${id}` : '/birthdays/add';
    
    // UI Feedback: disable button and show loading state to prevent race conditions
    const btn = document.getElementById('submitBtn');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Saving...`;

    const result = await apiPost(url, {
        name: document.getElementById('field_name').value,
        birth_date: document.getElementById('field_date').value
    });

    // Lifecycle Cleanup: Restore button regardless of result to prevent "stuck" state on next open
    btn.disabled = false;
    btn.innerHTML = originalHtml;

    if (result) {
        // Success: hide interface and re-sync state
        closeModal();
        refreshBirthdays();
    }
}

/**
 * Action: confirmDelete
 * Orchestrates the Mandatory Action deletion flow for a specific record.
 * 
 * @param {number} id - Record identifier
 * @param {string} name - Name for confirmation message
 */
function confirmDelete(id, name) {
    showConfirmModal({
        title: 'Delete Birthday',
        message: `Are you sure you want to remove \"<strong>${name}</strong>\" from the records?`,
        danger: true,
        confirmText: 'Delete',
        hideCancel: true,
        alignment: 'center',
        loadingText: 'Deleting...',
        onConfirm: async () => {
            const result = await apiPost(`/birthdays/delete/${id}`);
            if (result) {
                refreshBirthdays();
            }
        }
    });
}

/**
 * --- UI Rendering ---
 */

/**
 * Orchestrates the full UI refresh across all views.
 */
function renderUI() {
    renderGrid();
    renderManageList();
    updateCountdowns();
}

/**
 * Generates the main countdown tile grid from the active state.
 */
function renderGrid() {
    const grid = document.getElementById('birthday-grid');
    if (!grid) return;
    grid.innerHTML = '';

    // Handle empty state
    if (birthdaysData.length === 0) {
        grid.innerHTML = '<div class="empty-state"><p>📭 No birthdays found.</p></div>';
        return;
    }

    // Build and append card for every record in the collection
    birthdaysData.forEach(b => {
        const card = document.createElement('div');
        card.className = 'birthday-card glass-panel';
        card.dataset.birthdate = b.birth_date;
        
        card.innerHTML = `
            <div class="birthday-emoji">
                <div class="zodiac-icons">
                    ${b.zodiac} ${b.chinese_zodiac}
                </div>
            </div>
            <div class="birthday-info">
                <h2 class="birthday-name">${b.name}</h2>
                <div class="birthday-date">${b.formatted_date}</div>
                <div class="birthday-countdown">
                    <span class="countdown-days"></span>
                    <span class="countdown-text"></span>
                </div>
                <div class="birthday-age">Will be <span class="age-number"></span> years old</div>
            </div>
        `;
        grid.appendChild(card);
    });
}

/**
 * Generates the administrative management list rows.
 */
function renderManageList() {
    const list = document.getElementById('manage-list');
    if (!list) return;
    list.innerHTML = '';

    birthdaysData.forEach(b => {
        const row = document.createElement('div');
        row.className = 'manage-row';
        
        // Setup specialized edit button using data attributes for safe JSON storage
        const btn = document.createElement('button');
        btn.className = 'btn-icon-edit';
        btn.innerHTML = getIcon('edit');
        btn.dataset.birthday = JSON.stringify(b);
        btn.onclick = function() { openEditModal(this); };

        row.innerHTML = `
            <div class="manage-info">
                <span class="manage-emoji">${b.zodiac} ${b.chinese_zodiac}</span>
                <div>
                    <strong class="manage-name-text">${escapeHtml(b.name)}</strong>
                    <br>
                    <span class="manage-date-text">${b.formatted_date}</span>
                </div>
            </div>
            <div class="manage-actions">
                <button onclick="confirmDelete(${b.id}, '${escapeHtml(b.name).replace(/'/g, "\\'")}')" class="btn-icon-delete">${getIcon('delete')}</button>
            </div>
        `;
        // Inject the complex edit button into the row structure
        row.querySelector('.manage-actions').prepend(btn);
        list.appendChild(row);
    });
}

/**
 * Logic: updateCountdowns
 * Calculates days remaining and target age for all birthday cards.
 * Implements specific rollover logic for past dates in the current year.
 */
function updateCountdowns() {
    const cards = document.querySelectorAll('.birthday-card');
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to date-only comparison
    
    cards.forEach(card => {
        const [y, m, d] = card.dataset.birthdate.split('-').map(Number);
        const birthDate = new Date(y, m - 1, d);
        
        // Calculate the next occurrence of this birthday
        let nextBirthday = new Date(today.getFullYear(), m - 1, d);
        
        // If birthday already occurred this year, target next year
        if (nextBirthday < today) {
            nextBirthday.setFullYear(today.getFullYear() + 1);
        }
        
        const diffTime = nextBirthday.getTime() - today.getTime();
        const daysUntil = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        // Calculate age they will turn on their next birthday
        const age = nextBirthday.getFullYear() - birthDate.getFullYear();
        
        // UI Update: localize targets within the card
        const daysSpan = card.querySelector('.countdown-days');
        const textSpan = card.querySelector('.countdown-text');
        const ageSpan = card.querySelector('.age-number');
        
        card.classList.remove('today');
        
        if (daysUntil === 0) {
            // Event Day: display victory feedback
            daysSpan.textContent = `${getIcon('victory')} TODAY!`;
            textSpan.textContent = '';
            card.classList.add('today');
        } else {
            daysSpan.textContent = daysUntil;
            textSpan.textContent = daysUntil === 1 ? 'day until birthday!' : 'days until birthday';
        }
        
        ageSpan.textContent = age;
    });
}

/**
 * --- Helpers & Utilities ---
 */

/**
 * Prevents XSS by sanitizing dynamic text strings.
 * 
 * @param {string} text - Raw input string.
 * @returns {string} - Sanitized HTML string.
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * --- Interface Handlers ---
 */

/**
 * Toggles between countdown grid and administrative management list.
 */
function toggleManageMode() {
    manageMode = !manageMode;
    const manageView = document.getElementById('manage-view');
    const grid = document.getElementById('birthday-grid');
    const btn = document.getElementById('manageBtn');

    if (manageMode) {
        if (manageView) manageView.style.display = 'block';
        if (grid) grid.style.display = 'none';
        if (btn) btn.classList.add('active');
    } else {
        if (manageView) manageView.style.display = 'none';
        if (grid) grid.style.display = 'grid';
        if (btn) btn.classList.remove('active');
    }
}

/**
 * Interface: openAddModal
 * Initializes the birthday modal for a new record.
 */
function openAddModal() {
    const modal = document.getElementById('birthdayModal');
    if (!modal) return;
    document.getElementById('modalTitle').innerHTML = `${getIcon('add')} Add Birthday`;
    document.getElementById('field_id').value = '';
    document.getElementById('field_name').value = '';
    document.getElementById('field_date').value = '';
    modal.style.display = 'flex';
}

/**
 * Interface: openEditModal
 * Pre-fills the birthday modal with existing record metadata.
 * 
 * @param {HTMLElement} btn - The edit button element containing the JSON record.
 */
function openEditModal(btn) {
    const b = JSON.parse(btn.dataset.birthday);
    const modal = document.getElementById('birthdayModal');
    if (!modal) return;
    document.getElementById('modalTitle').innerHTML = `${getIcon('edit')} Edit Birthday`;
    document.getElementById('field_id').value = b.id;
    document.getElementById('field_name').value = b.name;
    document.getElementById('field_date').value = b.birth_date;
    modal.style.display = 'flex';
}

/**
 * Hides the birthday record modal.
 */
function closeModal() {
    const modal = document.getElementById('birthdayModal');
    if (modal) modal.style.display = 'none';
}

/**
 * Global Exposure
 * Necessary for event handlers defined in server-rendered templates.
 */
window.submitBirthdayForm = submitBirthdayForm;
window.confirmDelete = confirmDelete;
window.toggleManageMode = toggleManageMode;
window.openAddModal = openAddModal;
window.openEditModal = openEditModal;
window.closeModal = closeModal;
window.refreshBirthdays = refreshBirthdays;
