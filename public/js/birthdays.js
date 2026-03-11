// /public/js/birthdays.js

/**
 * Birthday Management Controller
 * 
 * Manages the Family Birthday Tracker using a state-driven architecture. 
 * Handles real-time countdowns, age calculations, and administrative 
 * record management via a synchronized interface.
 * 
 * Features:
 * - State-driven countdown tiles and management ledger
 * - Real-time countdown updates (60s resolution)
 * - Automated zodiac and chinese zodiac metadata display
 * - Interactive CRUD operations with optimistic state reconciliation
 * - High-density JSDoc documentation
 * 
 * Dependencies:
 * - default.js: For apiPost, getIcon, setupGlobalModalClosing, and modal helpers
 * - toast.js: For operation feedback
 */

/**
 * --- Module Configuration & State ---
 */
const CONFIG = {
    SYNC_INTERVAL_MS: 300000,        // Background synchronization frequency
    TICK_INTERVAL_MS: 60000          // Countdown update resolution
};

let STATE = {
    birthdays: [],                  // Collection of {id, name, birth_date, zodiac, ...}
    isAdmin: false,                 // Authorization gate for administrative actions
    manageMode: false               // Interface toggle (Countdown vs Management)
};

/**
 * Bootstraps the module state and establishes background lifecycles.
 * 
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', () => {
    // Initial fetch of the birthday roster
    loadState();
    
    // Background countdown updates
    setInterval(updateCountdowns, CONFIG.TICK_INTERVAL_MS);

    // Background synchronization
    setInterval(loadState, CONFIG.SYNC_INTERVAL_MS);

    // Modal: Configure global click-outside-to-close behavior
    setupGlobalModalClosing(['modal-overlay'], [closeModal, closeConfirmModal]);
});

/**
 * --- Data Management ---
 */

/**
 * Synchronizes the module state with the server.
 * 
 * @async
 * @param {boolean} [force=false] - If true, bypasses interaction guards (modals/focus).
 * @returns {Promise<void>}
 */
async function loadState(force = false) {
    // Lifecycle: inhibit background sync if user is actively interacting with forms
    const anyModalOpen = document.querySelector('.modal-overlay.show, .modal-overlay.active, .delete-modal-overlay.show, .delete-modal-overlay.active');
    const inputFocused = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
    
    if (!force && (anyModalOpen || inputFocused) && STATE.birthdays.length > 0) return;

    try {
        const response = await fetch('/birthdays/api/state');
        const data = await response.json();
        
        if (data && data.success) {
            STATE.birthdays = data.birthdays;
            STATE.isAdmin = !!data.is_admin;
            renderUI();
        }
    } catch (err) {
        console.error('loadState failed:', err);
    }
}

/**
 * Action: handleBirthdaySubmit
 * Executes persistent record creation or modification.
 * 
 * @async
 * @param {Event} event - Triggering form event.
 * @returns {Promise<void>}
 */
async function handleBirthdaySubmit(event) {
    if (event) event.preventDefault();
    
    const id = document.getElementById('field_id').value;
    const url = id ? `/birthdays/api/edit/${id}` : '/birthdays/api/add';
    
    const btn = document.getElementById('submitBtn');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Saving...`;

    try {
        const result = await apiPost(url, {
            name: document.getElementById('field_name').value,
            birth_date: document.getElementById('field_date').value
        });

        if (result && result.success) {
            closeModal();
            await loadState(true);
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Action: confirmDelete
 * Orchestrates the terminal record removal workflow.
 * 
 * @param {number} id - Target identifier.
 * @param {string} name - Display label for context.
 * @returns {void}
 */
function confirmDelete(id, name) {
    showConfirmModal({
        title: 'Delete Birthday',
        message: `Are you sure you want to remove \"<strong>${escapeHtml(name)}</strong>\"?`,
        danger: true,
        confirmText: 'Delete',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const result = await apiPost(`/birthdays/api/delete/${id}`);
            if (result && result.success) {
                await loadState(true);
            }
        }
    });
}

/**
 * --- UI Rendering Engine ---
 */

/**
 * Orchestrates the full UI synchronization lifecycle.
 * 
 * @returns {void}
 */
function renderUI() {
    renderGrid();
    renderManageList();
    renderActionButtons();
    updateCountdowns();
}

/**
 * Generates the countdown tile grid from state.
 * 
 * @returns {void}
 */
function renderGrid() {
    const grid = document.getElementById('birthday-grid');
    if (!grid) return;

    if (STATE.birthdays.length === 0) {
        grid.innerHTML = '<div class="empty-state"><p>📭 No birthdays found.</p></div>';
        return;
    }

    grid.innerHTML = STATE.birthdays.map(b => `
        <div class="birthday-card glass-panel" data-birthdate="${b.birth_date}">
            <div class="birthday-emoji">
                <div class="zodiac-icons">
                    ${b.zodiac} ${b.chinese_zodiac}
                </div>
            </div>
            <div class="birthday-info">
                <h2 class="birthday-name">${escapeHtml(b.name)}</h2>
                <div class="birthday-date">${b.formatted_date}</div>
                <div class="birthday-countdown">
                    <span class="countdown-days"></span>
                    <span class="countdown-text"></span>
                </div>
                <div class="birthday-age">Will be <span class="age-number"></span> years old</div>
            </div>
        </div>
    `).join('');
}

/**
 * Generates the administrative management ledger.
 * 
 * @returns {void}
 */
function renderManageList() {
    const list = document.getElementById('manage-list');
    if (!list) return;

    list.innerHTML = STATE.birthdays.map(b => `
        <div class="manage-row">
            <div class="manage-info">
                <span class="manage-emoji">${b.zodiac} ${b.chinese_zodiac}</span>
                <div>
                    <strong class="manage-name-text">${escapeHtml(b.name)}</strong>
                    <br>
                    <span class="manage-date-text">${b.formatted_date}</span>
                </div>
            </div>
            <div class="manage-actions">
                <button type="button" class="btn-icon-edit" 
                        onclick="openEditModal(${b.id})" 
                        title="Edit Record">${getIcon('edit')}</button>
                <button type="button" class="btn-icon-delete" 
                        onclick="confirmDelete(${b.id}, '${escapeHtml(b.name)}')" 
                        title="Remove Record">${getIcon('delete')}</button>
            </div>
        </div>
    `).join('');
}

/**
 * Manages the visibility of administrative controls.
 * 
 * @returns {void}
 */
function renderActionButtons() {
    const adminActions = document.getElementById('admin-actions');
    if (adminActions) {
        if (STATE.isAdmin) {
            adminActions.classList.add('active');
        } else {
            adminActions.classList.remove('active');
        }
    }
}

/**
 * Background loop for temporal calculations.
 * 
 * @returns {void}
 */
function updateCountdowns() {
    const cards = document.querySelectorAll('.birthday-card');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    cards.forEach(card => {
        const [y, m, d] = card.dataset.birthdate.split('-').map(Number);
        const birthDate = new Date(y, m - 1, d);
        
        let nextBirthday = new Date(today.getFullYear(), m - 1, d);
        if (nextBirthday < today) {
            nextBirthday.setFullYear(today.getFullYear() + 1);
        }
        
        const diffTime = nextBirthday.getTime() - today.getTime();
        const daysUntil = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const age = nextBirthday.getFullYear() - birthDate.getFullYear();
        
        const daysSpan = card.querySelector('.countdown-days');
        const textSpan = card.querySelector('.countdown-text');
        const ageSpan = card.querySelector('.age-number');
        
        card.classList.remove('today');
        
        if (daysUntil === 0) {
            daysSpan.textContent = `TODAY!`;
            textSpan.textContent = '';
            card.classList.add('today');
        } else {
            daysSpan.textContent = daysUntil;
            textSpan.textContent = daysUntil === 1 ? 'day until birthday!' : 'days until birthday';
        }
        
        if (ageSpan) ageSpan.textContent = age;
    });
}

/**
 * --- Interface Handlers ---
 */

/**
 * Toggles between dashboard and management views.
 * 
 * @returns {void}
 */
function toggleManageMode() {
    STATE.manageMode = !STATE.manageMode;
    const manageView = document.getElementById('manage-view');
    const grid = document.getElementById('birthday-grid');
    const btn = document.getElementById('manageBtn');

    if (STATE.manageMode) {
        if (manageView) manageView.classList.add('active');
        if (grid) grid.classList.add('hidden');
        if (btn) btn.classList.add('active');
    } else {
        if (manageView) manageView.classList.remove('active');
        if (grid) grid.classList.remove('hidden');
        if (btn) btn.classList.remove('active');
    }
}

/**
 * Displays the record creation interface.
 * 
 * @returns {void}
 */
function openAddModal() {
    document.getElementById('modalTitle').innerHTML = `${getIcon('add')} Add Birthday`;
    document.getElementById('field_id').value = '';
    document.getElementById('field_name').value = '';
    document.getElementById('field_date').value = '';
    
    const modal = document.getElementById('birthdayModal');
    if (modal) {
        modal.classList.add('active');
        document.body.classList.add('modal-open');
    }
}

/**
 * Pre-fills and displays the record editor.
 * 
 * @param {number} id - Target identifier.
 * @returns {void}
 */
function openEditModal(id) {
    const b = STATE.birthdays.find(item => item.id == id);
    if (!b) return;

    document.getElementById('modalTitle').innerHTML = `${getIcon('edit')} Edit Birthday`;
    document.getElementById('field_id').value = b.id;
    document.getElementById('field_name').value = b.name;
    document.getElementById('field_date').value = b.birth_date;
    
    const modal = document.getElementById('birthdayModal');
    if (modal) {
        modal.classList.add('active');
        document.body.classList.add('modal-open');
    }
}

/**
 * Hides the record editor.
 * 
 * @returns {void}
 */
function closeModal() {
    const modal = document.getElementById('birthdayModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.classList.remove('modal-open');
    }
}

/**
 * Sanitizes input for safe DOM injection.
 * 
 * @param {string} text - Raw input.
 * @returns {string} - Escaped output.
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * --- Global Exposure ---
 */
window.handleBirthdaySubmit = handleBirthdaySubmit;
window.confirmDelete = confirmDelete;
window.toggleManageMode = toggleManageMode;
window.openAddModal = openAddModal;
window.openEditModal = openEditModal;
window.closeModal = closeModal;
window.loadState = loadState;
