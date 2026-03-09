// /public/js/meals.js

/**
 * Meal Planner Controller
 * 
 * Manages the Family Meal Planner interface, implementing a collaborative 
 * voting and suggestion system with automated decision windows and a 
 * state-driven architecture for real-time synchronization.
 * 
 * Features:
 * - Rolling 4-day timeline with multi-user suggestion entry
 * - Interactive voting system with optimistic UI updates
 * - Automated 2 PM daily lock-in thresholds
 * - High-density Meal Vault for frequent recipe retrieval
 * - Smart autocomplete with "New Entry" detection
 * - Administrative blackout and manual winner selection
 * 
 * Dependencies:
 * - default.js: For apiPost, getLoadingHtml, getIcon, and modal helpers
 * - emoji-picker.js: For icon-enriched meal naming
 */

/**
 * --- Module Configuration & State ---
 */
const CONFIG = {
    LOCK_HOUR: 14,                  // Daily threshold for decision lock-in (2PM)
    SYNC_INTERVAL_MS: 300000        // Background refresh frequency (5 mins)
};

let STATE = {
    plan: [],                       // Metadata for active timeline columns
    vault: [],                      // High-density recipe registry for autocomplete
    isAdmin: false,                 // Authorization gate for destructive actions
    currentUserId: 0                // Owner identification for ACL logic
};

/**
 * Bootstraps the module state and establishes global event handlers.
 * 
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', () => {
    loadState();

    // Modal: Configure unified closure behavior
    setupGlobalModalClosing(['modal-overlay'], [
        closeSuggestModal, closeBlackoutModal, closeEditSuggestionModal, closeConfirmModal,
        closeManageVaultModal, closeAddEditMealModal
    ]);
    
    // UI: Bootstrap autocomplete for all suggestion and management inputs
    setupMealAutocomplete('mealInput', 'mealDropdown');
    setupMealAutocomplete('editMealInput', 'editMealDropdown');
    setupMealAutocomplete('manageMealName', 'manageMealDropdown');

    // Background Synchronization
    setInterval(loadState, CONFIG.SYNC_INTERVAL_MS);
});

/**
 * --- Core Data Management ---
 */

/**
 * Synchronizes the module state with the server (Single Source of Truth).
 * 
 * @async
 * @returns {Promise<void>}
 */
async function loadState() {
    // Lifecycle: inhibit background sync if user is actively interacting with forms
    const anyModalOpen = document.querySelector('.modal-overlay.active');
    if (anyModalOpen && STATE.plan.length > 0) return;

    const container = document.getElementById('meals-timeline');
    // Lifecycle: show loading pulse if initial boot
    if (container && !container.querySelector('.component-loading') && STATE.plan.length === 0) {
        container.innerHTML = `
            <div class="component-loading">
                <div class="loading-scan-line"></div>
                <span class="loading-icon-pulse">${window.getIcon('meals')}</span>
                <p class="loading-label">Synchronizing...</p>
            </div>`;
    }

    try {
        const response = await fetch('/meals/api/state');
        const data = await response.json();
        
        if (data && data.success) {
            STATE.plan = data.plan;
            STATE.vault = data.vault;
            STATE.isAdmin = !!data.is_admin;
            STATE.currentUserId = data.current_user_id;
            
            // UI: Handle visibility of admin-only controls
            const adminBar = document.getElementById('adminActions');
            if (adminBar) {
                if (STATE.isAdmin) {
                    adminBar.classList.add('active');
                } else {
                    adminBar.classList.remove('active');
                }
            }

            renderTimeline();
        }
    } catch (err) {
        console.error('loadState failed:', err);
    }
}

/**
 * --- Vault Management (Admin) ---
 */

/**
 * Displays the global meal registry.
 * 
 * @async
 * @returns {Promise<void>}
 */
async function openManageVaultModal() {
    const modal = document.getElementById('manageVaultModal');
    if (modal) {
        modal.classList.add('active');
        document.body.classList.add('modal-open');
    }
    
    try {
        const response = await fetch('/meals/api/vault');
        const data = await response.json();
        if (data.meals) {
            renderVaultTable(data.meals);
        }
    } catch (err) {
        console.error('Vault fetch failed:', err);
    }
}

/**
 * Hides the vault management interface.
 * 
 * @returns {void}
 */
function closeManageVaultModal() {
    const modal = document.getElementById('manageVaultModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.classList.remove('modal-open');
    }
}

/**
 * Generates the management table rows from vault data.
 * 
 * @param {Array} meals - Collection of vault entries.
 * @returns {void}
 */
function renderVaultTable(meals) {
    const body = document.getElementById('vault-table-body');
    if (!body) return;

    body.innerHTML = meals.map(m => `
        <tr>
            <td><strong>${escapeHtml(m.name)}</strong></td>
            <td class="col-actions">
                <div class="action-buttons">
                    <button type="button" class="btn-icon-edit" onclick="openAddEditMealModal(${m.id}, '${escapeHtml(m.name).replace(/'/g, "\\'")}')" title="Edit Name">
                        ${window.getIcon('edit')}
                    </button>
                    <button type="button" class="btn-icon-delete ${m.is_used ? 'disabled' : ''}" 
                            ${m.is_used ? 'disabled' : ''} 
                            onclick="deleteManageMeal(${m.id}, '${escapeHtml(m.name).replace(/'/g, "\\'")}')"
                            title="${m.is_used ? 'Cannot delete: Meal is part of a plan' : 'Remove from Vault'}">
                        ${window.getIcon('delete')}
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

/**
 * Pre-fills the meal editor for creation or modification.
 * 
 * @param {number|null} id - Target identifier.
 * @param {string|null} name - Existing name metadata.
 * @returns {void}
 */
function openAddEditMealModal(id = null, name = null) {
    const title = document.getElementById('manageMealModalTitle');
    const modal = document.getElementById('addEditMealModal');
    
    document.getElementById('manageMealId').value = id || '';
    document.getElementById('manageMealName').value = name || '';
    
    const dropdown = document.getElementById('manageMealDropdown');
    if (dropdown) dropdown.classList.add('hidden');

    if (title) title.innerHTML = id ? `${window.getIcon('edit')} Edit Meal` : `${window.getIcon('add')} Add Meal`;
    if (modal) {
        modal.classList.add('active');
        document.body.classList.add('modal-open');
    }
}

/**
 * Hides the meal addition/edit interface.
 * 
 * @returns {void}
 */
function closeAddEditMealModal() {
    const modal = document.getElementById('addEditMealModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.classList.remove('modal-open');
    }
}

/**
 * Orchestrates the vault entry submission.
 * 
 * @async
 * @returns {Promise<void>}
 */
async function submitManageMeal() {
    const id = document.getElementById('manageMealId').value;
    const name = document.getElementById('manageMealName').value.trim();
    const btn = document.querySelector('#addEditMealModal .btn-primary');

    if (!name) return;

    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${window.getIcon('waiting')} Saving...`;

    try {
        const endpoint = id ? '/meals/api/vault/update' : '/meals/api/vault/add';
        const result = await window.apiPost(endpoint, { id, name });

        if (result && result.success) {
            closeAddEditMealModal();
            openManageVaultModal(); // Refresh table
            await loadState();      // Sync autocomplete registry
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Orchestrates the vault deletion.
 * 
 * @param {number} id - Target identifier.
 * @param {string} name - Merchant context.
 * @returns {void}
 */
function deleteManageMeal(id, name) {
    window.showConfirmModal({
        title: 'Remove from Vault',
        message: `Permanently remove \"<strong>${escapeHtml(name)}</strong>\" from the registry?`,
        danger: true,
        confirmText: 'Delete',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const result = await window.apiPost('/meals/api/vault/delete', { id });
            if (result && result.success) {
                openManageVaultModal();
                await loadState();
            }
        }
    });
}

/**
 * --- Rendering Engine ---
 */

/**
 * Orchestrates the generation of the scrolling timeline.
 * 
 * @returns {void}
 */
function renderTimeline() {
    const container = document.getElementById('meals-timeline');
    if (!container) return;

    container.innerHTML = STATE.plan.map((day, idx) => renderDayColumn(day, idx)).join('');
}

/**
 * Generates the HTML fragment for a single day column.
 * 
 * @param {Object} day - Day configuration metadata.
 * @param {number} index - Timeline position.
 * @returns {string} - Rendered HTML.
 */
function renderDayColumn(day, index) {
    const now = new Date();
    const isPast2PM = now.getHours() >= CONFIG.LOCK_HOUR;
    const isLocked = day.status === 'locked' || (index === 0 && isPast2PM);
    const blackout = day.blackout_reason;
    
    let lockPill = '';
    if (index === 0 && !blackout && !day.final_suggestion_id) {
        const icon = isPast2PM ? window.getIcon('lock') : window.getIcon('clock');
        const text = isPast2PM ? 'Locked' : 'Will Lock @ 2PM';
        lockPill = `<span class="lock-info inline">${icon} ${text}</span>`;
    }

    let contentHtml = '';

    if (blackout) {
        contentHtml = `
            <div class="blackout-state">
                <span class="blackout-icon">${window.getIcon('cancel')}</span>
                <p>${escapeHtml(blackout)}</p>
                ${STATE.isAdmin ? `
                    <div class="day-actions mt-4">
                        <button type="button" class="btn-secondary btn-small" onclick="adminUnlock(${day.id})">
                            ${window.getIcon('lock')} Unlock Day
                        </button>
                    </div>` : ''}
            </div>`;
    } else if (isLocked && day.final_suggestion_id) {
        const winner = day.suggestions.find(s => s.id == day.final_suggestion_id);
        contentHtml = winner ? `
            <div class="winner-card">
                <div class="winner-badge">CHOSEN</div>
                <span class="meal-name">${escapeHtml(winner.meal_name)}</span>
                <small>Suggested by ${escapeHtml(winner.suggested_by_name)}</small>
                ${STATE.isAdmin ? `
                    <div class="mt-4">
                        <button type="button" class="btn-secondary btn-small" onclick="adminUnlock(${day.id})">
                            ${window.getIcon('lock')} Unlock Day
                        </button>
                    </div>` : ''}
            </div>` : '<p>Decision pending.</p>';
    } else {
        const maxVotes = day.suggestions.length ? Math.max(...day.suggestions.map(s => s.vote_count)) : 0;
        const leaders  = day.suggestions.filter(s => s.vote_count === maxVotes && maxVotes > 0);
        
        let leaderBanner = '';
        if (leaders.length > 1) {
            leaderBanner = `
                <div class="leader-banner is-tie">
                    <span class="leader-label">${window.getIcon('vote')} TIE</span>
                    <span class="leader-meal">${leaders.map(l => escapeHtml(l.meal_name)).join(' / ')}</span>
                </div>`;
        } else if (leaders.length === 1) {
            leaderBanner = `
                <div class="leader-banner">
                    <span class="leader-label">${window.getIcon('trophy')} LEADER</span>
                    <span class="leader-meal">${escapeHtml(leaders[0].meal_name)}</span>
                </div>`;
        }

        const suggestionsHtml = day.suggestions.map(s => `
            <div class="suggestion-row" data-suggestion-id="${s.id}">
                <div class="suggestion-body">
                    <div class="suggestion-info">
                        <span class="meal-name">${escapeHtml(s.meal_name)}</span>
                        <small>by ${escapeHtml(s.suggested_by_name)}</small>
                        ${renderVoterPills(s.voters)}
                    </div>
                </div>
                ${!isLocked ? `
                <div class="suggestion-footer-actions">
                    <button type="button" class="btn-icon-vote ${s.user_voted ? 'is-voted' : ''}" 
                            onclick="castVote(${s.id})" 
                            title="${s.user_voted ? 'Remove vote' : 'Vote for this meal'}">
                        ${window.getIcon('vote')}
                    </button>
                    ${(STATE.isAdmin || s.suggested_by_id == STATE.currentUserId) ? `
                        <button type="button" class="btn-icon-edit" onclick="openEditSuggestionModal(${s.id}, '${s.meal_name.replace(/'/g, "\\'")}')" title="Edit suggestion">
                            ${window.getIcon('edit')}
                        </button>
                        <button type="button" class="btn-icon-delete" onclick="deleteSuggestion(${s.id}, '${s.meal_name.replace(/'/g, "\\'")}')" title="Remove suggestion">
                            ${window.getIcon('delete')}
                        </button>` : ''}
                    ${STATE.isAdmin ? `
                        <button type="button" class="btn-icon-bonus" onclick="adminLock(${day.id}, ${s.id})" title="Manual Lock-in">
                            ${window.getIcon('check')}
                        </button>` : ''}
                </div>` : ''}
            </div>`).join('');

        const dayActions = isLocked ? '' : `
            <div class="day-actions">
                ${(!day.user_has_suggested) ? `
                    <button type="button" class="btn-primary" onclick="openSuggestModal(${day.id}, '${day.formatted_date}')">
                        ${window.getIcon('add')} Suggest
                    </button>` : ''}
                ${STATE.isAdmin ? `
                    <button type="button" class="btn-danger" onclick="openBlackoutModal(${day.id})">
                        ${window.getIcon('cancel')} Blackout
                    </button>` : ''}
            </div>`;

        contentHtml = `
            ${leaderBanner}
            <div class="suggestions-list">${suggestionsHtml}</div>
            ${dayActions}`;
    }

    return `
        <div class="day-column ${isLocked ? 'is-locked' : 'is-open'}" data-plan-id="${day.id}">
            <div class="day-header">
                <span class="day-name">${day.formatted_date}</span>
                ${lockPill}
                ${isLocked && index !== 0 ? `<span class="status-icon" title="Locked">${window.getIcon('check')}</span>` : ''}
            </div>
            <div class="day-content">${contentHtml}</div>
        </div>`;
}

/**
 * Generates voter badges for a suggestion.
 * 
 * @param {Array} voters - List of usernames.
 * @returns {string} - HTML fragment.
 */
function renderVoterPills(voters) {
    if (!voters || !voters.length) return '';
    return `
        <div class="voter-pills">
            ${voters.map(v => `<span class="voter-badge">${window.getIcon('vote')} ${escapeHtml(v)}</span>`).join('')}
        </div>`;
}

/**
 * --- UI Logic & Autocomplete ---
 */

/**
 * Bootstraps autocomplete for a specific input field.
 * 
 * @param {string} inputId - Target element ID.
 * @param {string} dropdownId - Dropdown container ID.
 * @returns {void}
 */
function setupMealAutocomplete(inputId, dropdownId) {
    const input    = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);
    if (!input || !dropdown) return;

    const updateMatches = () => {
        const query   = input.value.toLowerCase().trim();
        const matches = query ? STATE.vault.filter(m => m.toLowerCase().includes(query)) : STATE.vault;
        
        if (!matches.length && !query) {
            dropdown.classList.add('hidden');
            return;
        }

        let html = matches.map(m => `<div class="meal-option" data-value="${escapeHtml(m)}">${escapeHtml(m)}</div>`).join('');
        if (query && !matches.find(m => m.toLowerCase() === query.toLowerCase())) {
            html += `<div class="meal-option meal-option-new" data-value="${escapeHtml(query)}"><span class="new-badge">NEW</span> ${escapeHtml(query)}</div>`;
        }

        dropdown.innerHTML = html;
        dropdown.classList.toggle('hidden', !html);
        
        // UI: Adjust positioning to avoid viewport overflow
        const rect = input.getBoundingClientRect();
        if (window.innerHeight - rect.bottom < 200 && rect.top > 200) {
            dropdown.classList.add('drop-up');
        } else {
            dropdown.classList.remove('drop-up');
        }
    };

    input.addEventListener('input', updateMatches);
    input.addEventListener('focus', updateMatches);
    dropdown.addEventListener('mousedown', (e) => { if (e.target.closest('.meal-option')) e.preventDefault(); });
    dropdown.addEventListener('click', (e) => {
        const opt = e.target.closest('.meal-option');
        if (opt) {
            input.value = opt.dataset.value;
            dropdown.classList.add('hidden');
            input.focus();
        }
    });
    document.addEventListener('click', (e) => { if (!input.contains(e.target) && !dropdown.contains(e.target)) dropdown.classList.add('hidden'); });
}

/**
 * --- API Interactions ---
 */

/**
 * Orchestrates the suggestion entry workflow.
 * 
 * @async
 * @returns {Promise<void>}
 */
async function submitSuggestion() {
    const planId   = document.getElementById('activePlanId').value;
    const mealName = document.getElementById('mealInput').value.trim();
    const btn      = document.querySelector('#suggestModal .btn-primary');

    if (!mealName) return;

    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${window.getIcon('waiting')} Submitting...`;

    try {
        const result = await window.apiPost('/meals/api/suggest', { plan_id: planId, meal_name: mealName });
        if (result && result.success) {
            closeSuggestModal();
            await loadState();
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Handles suggestion voting with leader detection.
 * 
 * @async
 * @param {number} id - Target identifier.
 * @returns {Promise<void>}
 */
async function castVote(id) {
    const row = document.querySelector(`.suggestion-row[data-suggestion-id="${id}"]`);
    if (row) row.classList.add('vote-pop');

    const result = await window.apiPost('/meals/api/vote', { suggestion_id: id });
    if (result && result.success) {
        await loadState();
    } else {
        if (row) row.classList.remove('vote-pop');
    }
}

/**
 * Orchestrates the modification of a proposed meal.
 * 
 * @async
 * @returns {Promise<void>}
 */
async function submitEditSuggestion() {
    const id = document.getElementById('editSuggestionId').value;
    const name = document.getElementById('editMealInput').value.trim();
    const btn = document.querySelector('#editSuggestionModal .btn-primary');

    if (!name) return;

    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${window.getIcon('waiting')} Saving...`;

    try {
        const result = await window.apiPost('/meals/api/edit_suggestion', { suggestion_id: id, meal_name: name });
        if (result && result.success) {
            closeEditSuggestionModal();
            await loadState();
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Orchestrates the suggestion removal.
 * 
 * @param {number} id - Target identifier.
 * @param {string} name - Meal metadata.
 * @returns {void}
 */
function deleteSuggestion(id, name) {
    window.showConfirmModal({
        title: 'Remove Suggestion',
        message: `Are you sure you want to remove \"<strong>${escapeHtml(name)}</strong>\"?`,
        danger: true,
        confirmText: 'Remove',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const result = await window.apiPost('/meals/api/delete_suggestion', { suggestion_id: id });
            if (result && result.success) await loadState();
        }
    });
}

/**
 * Orchestrates administrative blackout events.
 * 
 * @async
 * @returns {Promise<void>}
 */
async function submitBlackout() {
    const id = document.getElementById('blackoutPlanId').value;
    const reason = document.getElementById('blackoutReason').value;

    const result = await window.apiPost('/meals/api/admin/lock', { plan_id: id, blackout: reason });
    if (result && result.success) {
        closeBlackoutModal();
        await loadState();
    }
}

/**
 * Manually forces a meal decision for a specific day.
 * 
 * @async
 * @param {number} planId - Day identifier.
 * @param {number} suggestionId - Winner identifier.
 * @returns {void}
 */
function adminLock(planId, suggestionId) {
    window.showConfirmModal({
        title: 'Lock Decision',
        message: 'Manually lock in this suggestion as the final meal for the day?',
        confirmText: 'Lock In',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const result = await window.apiPost('/meals/api/admin/lock', { plan_id: planId, suggestion_id: suggestionId });
            if (result && result.success) await loadState();
        }
    });
}

/**
 * Re-opens a locked or blacked-out day.
 * 
 * @async
 * @param {number} planId - Day identifier.
 * @returns {Promise<void>}
 */
async function adminUnlock(planId) {
    const result = await window.apiPost('/meals/api/admin/lock', { plan_id: planId, unlock: 1 });
    if (result && result.success) await loadState();
}

/**
 * --- Modal Toggles ---
 */

/** @returns {void} */
function openSuggestModal(id, date) {
    document.getElementById('activePlanId').value = id;
    document.getElementById('suggestDateLabel').textContent = date;
    document.getElementById('mealInput').value = '';
    
    const dropdown = document.getElementById('mealDropdown');
    if (dropdown) dropdown.classList.add('hidden');
    
    const m = document.getElementById('suggestModal');
    if (m) {
        m.classList.add('active');
        document.body.classList.add('modal-open');
    }
}

/** @returns {void} */
function closeSuggestModal() { 
    const m = document.getElementById('suggestModal'); 
    if (m) {
        m.classList.remove('active');
        document.body.classList.remove('modal-open');
    }
}

/** @returns {void} */
function openEditSuggestionModal(id, name) {
    document.getElementById('editSuggestionId').value = id;
    document.getElementById('editMealInput').value = name;
    
    const dropdown = document.getElementById('editMealDropdown');
    if (dropdown) dropdown.classList.add('hidden');
    
    const m = document.getElementById('editSuggestionModal');
    if (m) {
        m.classList.add('active');
        document.body.classList.add('modal-open');
    }
}

/** @returns {void} */
function closeEditSuggestionModal() { 
    const m = document.getElementById('editSuggestionModal'); 
    if (m) {
        m.classList.remove('active');
        document.body.classList.remove('modal-open');
    }
}

/** @returns {void} */
function openBlackoutModal(id) {
    document.getElementById('blackoutPlanId').value = id;
    const m = document.getElementById('blackoutModal');
    if (m) {
        m.classList.add('active');
        document.body.classList.add('modal-open');
    }
}

/** @returns {void} */
function closeBlackoutModal() { 
    const m = document.getElementById('blackoutModal'); 
    if (m) {
        m.classList.remove('active');
        document.body.classList.remove('modal-open');
    }
}

/**
 * Sanitizes input to prevent XSS.
 * 
 * @param {string} text - Raw input.
 * @returns {string} - Sanitized HTML.
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
window.loadState = loadState;
window.submitSuggestion = submitSuggestion;
window.castVote = castVote;
window.submitEditSuggestion = submitEditSuggestion;
window.deleteSuggestion = deleteSuggestion;
window.submitBlackout = submitBlackout;
window.adminLock = adminLock;
window.adminUnlock = adminUnlock;
window.openSuggestModal = openSuggestModal;
window.closeSuggestModal = closeSuggestModal;
window.openEditSuggestionModal = openEditSuggestionModal;
window.closeEditSuggestionModal = closeEditSuggestionModal;
window.openBlackoutModal = openBlackoutModal;
window.closeBlackoutModal = closeBlackoutModal;
window.openManageVaultModal = openManageVaultModal;
window.closeManageVaultModal = closeManageVaultModal;
window.openAddEditMealModal = openAddEditMealModal;
window.closeAddEditMealModal = closeAddEditMealModal;
window.submitManageMeal = submitManageMeal;
window.deleteManageMeal = deleteManageMeal;
