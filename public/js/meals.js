// /public/js/meals.js

/**
 * Meal Planner Controller Module
 * 
 * This module manages the Family Meal Planner interface. It implements 
 * a collaborative voting and suggestion system with automated locking
 * logic based on time-of-day thresholds.
 * 
 * Features:
 * - Rolling 7-day timeline with daily meal suggestions
 * - Collaborative voting system with real-time leader/tie detection
 * - Automated 2 PM daily lock-in for meal decisions
 * - Global Meal Vault management for frequent selections
 * - Smart autocomplete with "New Meal" detection logic
 * - Administrative blackout and manual winner selection
 * 
 * Dependencies:
 * - default.js: For apiPost, getLoadingHtml, getIcon, and modal helpers
 * - toast.js: For status feedback
 * - emoji-picker.js: For icon-enriched meal naming
 */

/**
 * Initialization System
 * Triggers initial render and bootstraps autocomplete registries
 */
document.addEventListener('DOMContentLoaded', () => {
    // Initial render from data injected into the template
    if (window.initialPlan) {
        renderTimeline(window.initialPlan);
    } else {
        loadPlan();
    }

    // Configure unified modal closure behavior
    setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay'], [
        closeSuggestModal, closeBlackoutModal, closeEditSuggestionModal, closeConfirmModal,
        closeManageVaultModal, closeAddEditMealModal
    ]);
    
    // Bootstrap autocomplete for all suggestion and management inputs
    setupMealAutocomplete('mealInput', 'mealDropdown');
    setupMealAutocomplete('editMealInput', 'editMealDropdown');
    setupMealAutocomplete('manageMealName', 'manageMealDropdown');
});

/**
 * Application State
 * Local cache for the global meal registry
 */
let vaultData = [];                 // Collection of {id, name, is_used}

/**
 * --- Core Data Management ---
 */

/**
 * Logic: loadPlan
 * Fetches the current 7-day plan and triggers timeline re-render.
 * 
 * @returns {Promise<void>}
 */
async function loadPlan() {
    const container = document.getElementById('meals-timeline');
    // Show loading skeleton if transition is not already in flight
    if (container && !container.querySelector('.component-loading')) {
        container.innerHTML = getLoadingHtml('Syncing meal plan...');
    }

    try {
        const response = await fetch('/meals', {
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        const data = await response.json();
        
        // Sync global vault and trigger re-render
        if (data.vault) window.mealVault = data.vault;
        if (data.plan) renderTimeline(data.plan);
    } catch (err) {
        console.error('Failed to load meal plan:', err);
        showToast('Connection error. Failed to sync plan.', 'error');
    }
}

/**
 * --- Vault Management Logic (Admin) ---
 */

/**
 * Interface: openManageVaultModal
 * Displays the global meal registry for administrative editing.
 * 
 * @returns {Promise<void>}
 */
async function openManageVaultModal() {
    const modal = document.getElementById('manageVaultModal');
    if (modal) modal.style.display = 'flex';
    loadVaultData();
}

/**
 * Interface: closeManageVaultModal
 * Hides the vault management modal.
 */
function closeManageVaultModal() {
    const modal = document.getElementById('manageVaultModal');
    if (modal) modal.style.display = 'none';
}

/**
 * Logic: loadVaultData
 * Syncs the administrative meal table with the server state.
 * 
 * @returns {Promise<void>}
 */
async function loadVaultData() {
    const response = await fetch('/meals/api/vault');
    const data = await response.json();
    if (data.meals) {
        vaultData = data.meals;
        renderVaultTable();
    }
}

/**
 * UI: renderVaultTable
 * Generates the management table rows with contextual action disabling.
 */
function renderVaultTable() {
    const body = document.getElementById('vault-table-body');
    if (!body) return;

    body.innerHTML = vaultData.map(m => `
        <tr>
            <td><strong>${escapeHtml(m.name)}</strong></td>
            <td class="col-actions">
                <div class="action-buttons">
                    <button class="btn-icon-edit" onclick="openAddEditMealModal(${m.id})" title="Edit Name">
                        ${getIcon('edit')}
                    </button>
                    <button class="btn-icon-delete ${m.is_used ? 'disabled' : ''}" 
                            ${m.is_used ? 'disabled' : ''} 
                            onclick="deleteManageMeal(${m.id}, '${escapeHtml(m.name).replace(/'/g, "\\'")}')"
                            title="${m.is_used ? 'Cannot delete: Meal is part of a plan' : 'Remove from Vault'}">
                        ${getIcon('delete')}
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

/**
 * Interface: openAddEditMealModal
 * Pre-fills the meal editor for either addition or modification.
 * 
 * @param {number|null} mealId - ID of existing meal or null for new
 */
function openAddEditMealModal(mealId = null) {
    const title = document.getElementById('manageMealModalTitle');
    const meal = mealId ? vaultData.find(m => m.id == mealId) : null;

    if (meal) {
        title.innerHTML = `${getIcon('edit')} Edit Meal`;
        document.getElementById('manageMealId').value = meal.id;
        document.getElementById('manageMealName').value = meal.name;
    } else {
        title.innerHTML = `${getIcon('add')} Add Meal`;
        document.getElementById('manageMealId').value = '';
        document.getElementById('manageMealName').value = '';
    }
    document.getElementById('manageMealDropdown').style.display = 'none';
    const modal = document.getElementById('addEditMealModal');
    if (modal) modal.style.display = 'flex';
}

/**
 * Hides the meal addition/edit modal.
 */
function closeAddEditMealModal() {
    const modal = document.getElementById('addEditMealModal');
    if (modal) modal.style.display = 'none';
    document.getElementById('manageMealDropdown').style.display = 'none';
}

/**
 * Action: submitManageMeal
 * Submits a new or modified meal to the global registry.
 * 
 * @returns {Promise<void>}
 */
async function submitManageMeal() {
    const id = document.getElementById('manageMealId').value;
    const name = document.getElementById('manageMealName').value.trim();
    const btn = document.querySelector('#addEditMealModal .btn-primary');

    if (!name) {
        showToast('Meal name is required', 'error');
        return;
    }

    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Saving...`;

    const endpoint = id ? '/meals/api/vault/update' : '/meals/api/vault/add';
    const result = await apiPost(endpoint, { id, name });

    if (result && result.success) {
        showToast(result.message, 'success');
        closeAddEditMealModal();
        loadVaultData();
        loadPlan(); // Ensure autocomplete vault is synchronized
    } else {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
        showToast(result?.error || 'Operation failed', 'error');
    }
}

/**
 * Action: deleteManageMeal
 * Triggers deletion confirmation for a vault item.
 * 
 * @param {number} id - Meal ID
 * @param {string} name - Meal name
 */
async function deleteManageMeal(id, name) {
    showConfirmModal({
        title: 'Remove from Vault',
        message: `Are you sure you want to permanently remove "<strong>${escapeHtml(name)}</strong>" from the vault?`,
        danger: true,
        confirmText: 'Delete',
        onConfirm: async () => {
            const result = await apiPost('/meals/api/vault/delete', { id });
            if (result.success) {
                showToast(result.message, 'success');
                loadVaultData();
                loadPlan();
            } else {
                showToast(result.error || 'Delete failed', 'error');
            }
        }
    });
}

/**
 * --- Dynamic Rendering Engine ---
 */

/**
 * Logic: renderTimeline
 * Generates the horizontal 7-day scrolling plan interface.
 * 
 * @param {Array} plan - Collection of day objects
 */
function renderTimeline(plan) {
    const container = document.getElementById('meals-timeline');
    if (!container) return;

    container.innerHTML = plan.map((day, idx) => renderDayColumn(day, idx)).join('');
}

/**
 * UI Component: renderDayColumn
 * Generates the HTML fragment for a single day in the plan.
 * Implements complex logic for locking, blackout, and winner detection.
 * 
 * @param {Object} day - Day configuration from state
 * @param {number} index - Index in the timeline (0 = today)
 * @returns {string} - Rendered HTML
 */
function renderDayColumn(day, index) {
    const now = new Date();
    const isPast2PM = now.getHours() >= 14;
    // Lock day if status is forced or if it's today after 2PM
    const isLocked = day.status === 'locked' || (index === 0 && isPast2PM);
    const blackout = day.blackout_reason;
    
    // Visibility: Lock pill for today's deadline awareness
    let lockPill = '';
    if (index === 0 && !blackout && !day.final_suggestion_id) {
        const icon = isPast2PM ? getIcon('lock') : getIcon('clock');
        const text = isPast2PM ? 'Locked' : 'Will Lock @ 2PM';
        lockPill = `<span class="lock-info inline">${icon} ${text}</span>`;
    }

    let contentHtml = '';

    // Scenario A: Admin Blackout
    if (blackout) {
        contentHtml = `
            <div class="blackout-state">
                <span class="blackout-icon">${getIcon('cancel')}</span>
                <p>${escapeHtml(blackout)}</p>
                ${isAdmin ? `
                    <div class="day-actions mt-4">
                        <button class="btn-secondary btn-small" onclick="adminUnlock(${day.id})">
                            ${getIcon('lock')} Unlock Day
                        </button>
                    </div>` : ''}
            </div>`;
    } 
    // Scenario B: Locked with Winner
    else if (isLocked && day.final_suggestion_id) {
        const winner = day.suggestions.find(s => s.id == day.final_suggestion_id);
        contentHtml = winner ? `
            <div class="winner-card">
                <div class="winner-badge">CHOSEN</div>
                <span class="meal-name">${escapeHtml(winner.meal_name)}</span>
                <small>Suggested by ${escapeHtml(winner.suggested_by_name)}</small>
                ${isAdmin ? `
                    <div class="mt-4">
                        <button class="btn-secondary btn-small" onclick="adminUnlock(${day.id})">
                            ${getIcon('lock')} Unlock Day
                        </button>
                    </div>` : ''}
            </div>` : '<p>Locked but no winner found.</p>';
    } 
    // Scenario C: Active Voting
    else {
        // Calculate leaders for tie-detection banner
        const maxVotes = day.suggestions.length ? Math.max(...day.suggestions.map(s => s.vote_count)) : 0;
        const leaders  = day.suggestions.filter(s => s.vote_count === maxVotes && maxVotes > 0);
        
        let leaderBanner = '';
        if (leaders.length > 1) {
            const label = (index === 0 && isPast2PM) ? "Today's Tie" : "Current Tie";
            leaderBanner = `
                <div class="leader-banner is-tie">
                    <span class="leader-label">${getIcon('vote')} ${label}</span>
                    <span class="leader-meal">${leaders.map(l => escapeHtml(l.meal_name)).join(' / ')}</span>
                </div>`;
        } else if (leaders.length === 1) {
            const label = (index === 0 && isPast2PM) ? "Today's Winner" : "Current Leader";
            leaderBanner = `
                <div class="leader-banner">
                    <span class="leader-label">${getIcon('trophy')} ${label}</span>
                    <span class="leader-meal">${escapeHtml(leaders[0].meal_name)}</span>
                </div>`;
        }

        // Build suggestions list
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
                    <button class="btn-icon-vote ${s.user_voted ? 'is-voted' : ''}" 
                            onclick="castVote(${s.id})" 
                            title="${s.user_voted ? 'Remove vote' : 'Vote for this meal'}">
                        ${getIcon('vote')}
                    </button>
                    ${(isAdmin || s.suggested_by_id == currentUserId) ? `
                        <button class="btn-icon-edit" onclick="openEditSuggestionModal(${s.id}, '${s.meal_name.replace(/'/g, "\\'")}')" title="Edit suggestion">
                            ${getIcon('edit')}
                        </button>` : ''}
                    ${(isAdmin || s.suggested_by_id == currentUserId) ? `
                        <button class="btn-icon-delete" onclick="deleteSuggestion(${s.id}, '${s.meal_name.replace(/'/g, "\\'")}')" title="Remove suggestion">
                            ${getIcon('delete')}
                        </button>` : ''}
                    ${isAdmin ? `
                        <button class="btn-icon-bonus" onclick="adminLock(${day.id}, ${s.id})" title="Manual Lock-in">
                            ${getIcon('check')}
                        </button>` : ''}
                </div>` : ''}
            </div>`).join('');

        const dayActions = isLocked ? '' : `
            <div class="day-actions">
                ${(!day.user_has_suggested) ? `
                    <button class="btn-primary" onclick="openSuggestModal(${day.id}, '${day.formatted_date}')">
                        ${getIcon('add')} Suggest Meal
                    </button>` : ''}
                ${isAdmin ? `
                    <button class="btn-danger" onclick="openBlackoutModal(${day.id})">
                        ${getIcon('cancel')} Blackout Day
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
                ${isLocked && index !== 0 ? `<span class="status-icon" title="Locked">${getIcon('check')}</span>` : ''}
            </div>
            <div class="day-content">${contentHtml}</div>
        </div>`;
}

/**
 * UI Component: renderVoterPills
 * Generates badge fragments for users who voted for a suggestion.
 * 
 * @param {Array} voters - List of usernames
 * @returns {string} - HTML fragment
 */
function renderVoterPills(voters) {
    if (!voters || !voters.length) return '';
    return `
        <div class="voter-pills">
            ${voters.map(v => `<span class="voter-badge">${getIcon('vote')} ${escapeHtml(v)}</span>`).join('')}
        </div>`;
}

/**
 * --- Smart UI Positioning ---
 */

/**
 * Logic: positionDropdown
 * Adjusts autocomplete dropdown position to avoid viewport overflow.
 * Implements "drop-up" logic when space below is restricted.
 * 
 * @param {HTMLElement} input - Reference input
 * @param {HTMLElement} dropdown - Dropdown container
 */
function positionDropdown(input, dropdown) {
    const rect = input.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropdownHeight = 200; // Expected max-height

    if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
        dropdown.classList.add('drop-up');
    } else {
        dropdown.classList.remove('drop-up');
    }
}

/**
 * Bootstraps autocomplete logic for a specific input field.
 * Handles bidirectional state updates and keyboard focus management.
 * 
 * @param {string} inputId - ID of target input
 * @param {string} dropdownId - ID of dropdown container
 */
function setupMealAutocomplete(inputId, dropdownId) {
    const input    = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);
    if (!input || !dropdown) return;

    const updateMatches = () => {
        const query   = input.value.toLowerCase().trim();
        const matches = query
            ? mealVault.filter(m => m.toLowerCase().includes(query))
            : mealVault;
        renderDropdown(input, dropdown, matches);
        if (dropdown.style.display === 'block') {
            positionDropdown(input, dropdown);
        }
    };

    input.addEventListener('input', updateMatches);
    input.addEventListener('focus', updateMatches);

    // Context: prevent focus loss when selecting items
    dropdown.addEventListener('mousedown', (e) => {
        if (e.target.closest('.meal-option')) {
            e.preventDefault();
        }
    });

    dropdown.addEventListener('click', (e) => {
        const option = e.target.closest('.meal-option');
        if (option) {
            e.stopPropagation();
            input.value = option.dataset.value;
            dropdown.style.display = 'none';
            input.focus();
        }
    });

    // Global: close dropdown when clicking away
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });
}

/**
 * Generates the autocomplete options list.
 * Includes "NEW" badge for items not present in the vault.
 * 
 * @private
 */
function renderDropdown(input, dropdown, items) {
    const query = input.value.trim();
    if (!items.length && !query) {
        dropdown.style.display = 'none';
        return;
    }

    let html = items.map(m =>
        `<div class="meal-option" data-value="${escapeHtml(m)}">
            ${escapeHtml(m)}
        </div>`
    ).join('');

    // Highlight new additions not found in registry
    if (query && !items.find(m => m.toLowerCase() === query.toLowerCase())) {
        html += `
            <div class="meal-option meal-option-new" data-value="${escapeHtml(query)}">
                <span class="new-badge">NEW</span> ${escapeHtml(query)}
            </div>`;
    }

    if (!html) {
        dropdown.style.display = 'none';
        return;
    }

    dropdown.innerHTML = html;
    dropdown.style.display = 'block';
    
    // Z-index management for emoji picker integration
    if (window.EmojiPicker && EmojiPicker.triggerBtn) {
        EmojiPicker.triggerBtn.style.zIndex = '1001';
    }
}

/**
 * --- API Interactions ---
 */

/**
 * Action: submitSuggestion
 * Registers a new meal suggestion for a specific day.
 * 
 * @returns {Promise<void>}
 */
async function submitSuggestion() {
    const planId   = document.getElementById('activePlanId').value;
    const mealName = document.getElementById('mealInput').value.trim();
    const btn      = document.querySelector('#suggestModal .btn-primary');

    if (!mealName) {
        showToast('Please enter a meal name', 'error');
        return;
    }

    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Submitting...`;

    const result = await apiPost('/meals/suggest', { plan_id: planId, meal_name: mealName });

    if (result && result.success) {
        showToast('Suggestion added!', 'success');
        closeSuggestModal();
        loadPlan();
    } else {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
        showToast(result?.error || 'Failed to add suggestion', 'error');
    }
}

/**
 * Action: castVote
 * Handles voting for a suggestion with automated switch logic.
 * 
 * @param {number} suggestionId - Target suggestion ID
 * @returns {Promise<void>}
 */
async function castVote(suggestionId) {
    const row = document.querySelector(`.suggestion-row[data-suggestion-id="${suggestionId}"]`);
    if (row) row.classList.add('vote-pop'); // Visual pop animation

    const result = await apiPost('/meals/vote', { suggestion_id: suggestionId });

    if (result.success) {
        if (result.voted) {
            const msg = result.removed_meal_name 
                ? `Vote moved from ${result.removed_meal_name} to new meal!`
                : 'Vote cast!';
            showToast(msg, 'success');
        } else {
            showToast('Vote removed', 'success');
        }
        // Debounced sync to allow animation completion
        setTimeout(loadPlan, 300);
    } else {
        if (row) row.classList.remove('vote-pop');
        showToast(result.error || 'Voting failed', 'error');
    }
}

/**
 * Action: submitEditSuggestion
 * Modifies an existing meal suggestion description.
 * 
 * @returns {Promise<void>}
 */
async function submitEditSuggestion() {
    const suggestionId = document.getElementById('editSuggestionId').value;
    const mealName     = document.getElementById('editMealInput').value.trim();
    const btn          = document.querySelector('#editSuggestionModal .btn-primary');

    if (!mealName) {
        showToast('Please enter a meal name', 'error');
        return;
    }

    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Saving...`;

    const result = await apiPost('/meals/edit_suggestion', { suggestion_id: suggestionId, meal_name: mealName });

    if (result && result.success) {
        showToast('Suggestion updated', 'success');
        closeEditSuggestionModal();
        loadPlan();
    } else {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
        showToast(result?.error || 'Failed to update suggestion', 'error');
    }
}

/**
 * Action: deleteSuggestion
 * Confirms and removes a meal suggestion from the plan.
 */
async function deleteSuggestion(suggestionId, mealName) {
    showConfirmModal({
        title: 'Remove Suggestion',
        message: `Are you sure you want to remove "<strong>${escapeHtml(mealName)}</strong>"?`,
        danger: true,
        confirmText: 'Remove',
        onConfirm: async () => {
            const result = await apiPost('/meals/delete_suggestion', { suggestion_id: suggestionId });
            if (result.success) {
                showToast('Suggestion removed', 'success');
                loadPlan();
            } else {
                showToast(result.error || 'Failed to remove suggestion', 'error');
            }
        }
    });
}

/**
 * Action: submitBlackout (Admin)
 * Disables a day in the plan for a specified reason (e.g., Takeout).
 */
async function submitBlackout() {
    const planId = document.getElementById('blackoutPlanId').value;
    const reason = document.getElementById('blackoutReason').value;

    showConfirmModal({
        title: 'Blackout Day',
        icon: 'cancel',
        message: `Are you sure you want to blackout this day for "<strong>${escapeHtml(reason)}</strong>"? This will disable all suggestions.`,
        danger: true,
        confirmText: 'Blackout',
        onConfirm: async () => {
            const result = await apiPost('/meals/admin/lock', { plan_id: planId, blackout: reason });
            if (result.success) {
                showToast('Blackout set', 'success');
                closeBlackoutModal();
                loadPlan();
            } else {
                showToast(result.error || 'Failed to set blackout', 'error');
            }
        }
    });
}

/**
 * Action: adminLock (Admin)
 * Manually forces a meal selection and closes voting for the day.
 */
async function adminLock(planId, suggestionId) {
    showConfirmModal({
        title: 'Lock Winner',
        icon: 'check',
        message: 'Manually lock in this meal as the winner? This will close voting for this day.',
        onConfirm: async () => {
            const result = await apiPost('/meals/admin/lock', { plan_id: planId, suggestion_id: suggestionId });
            if (result.success) {
                showToast('Meal locked in!', 'success');
                loadPlan();
            } else {
                showToast(result.error || 'Failed to lock meal', 'error');
            }
        }
    });
}

/**
 * Action: adminUnlock (Admin)
 * Re-opens a locked or blacked-out day for suggestions and voting.
 */
async function adminUnlock(planId) {
    showConfirmModal({
        title: 'Unlock Day',
        icon: 'lock',
        message: 'Unlock this day? This will clear any blackout or winner selection and allow new suggestions/votes.',
        onConfirm: async () => {
            const result = await apiPost('/meals/admin/lock', { plan_id: planId, unlock: 1 });
            if (result.success) {
                showToast('Day unlocked', 'success');
                loadPlan();
            } else {
                showToast(result.error || 'Failed to unlock day', 'error');
            }
        }
    });
}

/**
 * --- Modal Helpers ---
 */

/**
 * Interface: openSuggestModal
 * Prepares the suggestion interface for a specific day.
 */
function openSuggestModal(planId, dateLabel) {
    const activePlanInput = document.getElementById('activePlanId');
    const suggestLabel = document.getElementById('suggestDateLabel');
    const mealInput = document.getElementById('mealInput');
    const dropdown = document.getElementById('mealDropdown');
    const modal = document.getElementById('suggestModal');

    if (activePlanInput) activePlanInput.value = planId;
    if (suggestLabel) suggestLabel.textContent = dateLabel;
    if (mealInput) mealInput.value = '';
    
    if (dropdown) {
        dropdown.style.display = 'none';
        dropdown.classList.remove('drop-up');
    }
    
    if (modal) modal.style.display = 'flex';
}

/**
 * Interface: closeSuggestModal
 * Hides the suggestion interface.
 */
function closeSuggestModal() {
    const modal = document.getElementById('suggestModal');
    const dropdown = document.getElementById('mealDropdown');
    if (modal) modal.style.display = 'none';
    if (dropdown) dropdown.style.display = 'none';
}

/**
 * Interface: openEditSuggestionModal
 * Displays the edit interface for an existing suggestion.
 */
function openEditSuggestionModal(suggestionId, mealName) {
    const idInput = document.getElementById('editSuggestionId');
    const nameInput = document.getElementById('editMealInput');
    const dropdown = document.getElementById('editMealDropdown');
    const modal = document.getElementById('editSuggestionModal');

    if (idInput) idInput.value = suggestionId;
    if (nameInput) nameInput.value = mealName;
    
    if (dropdown) {
        dropdown.style.display = 'none';
        dropdown.classList.remove('drop-up');
    }
    
    if (modal) modal.style.display = 'flex';
    if (nameInput) nameInput.focus();
}

/**
 * Interface: closeEditSuggestionModal
 * Hides the edit suggestion interface.
 */
function closeEditSuggestionModal() {
    const modal = document.getElementById('editSuggestionModal');
    const dropdown = document.getElementById('editMealDropdown');
    if (modal) modal.style.display = 'none';
    if (dropdown) dropdown.style.display = 'none';
}

/**
 * Interface: openBlackoutModal
 * Displays the blackout management interface.
 */
function openBlackoutModal(planId) {
    const idInput = document.getElementById('blackoutPlanId');
    const modal = document.getElementById('blackoutModal');
    if (idInput) idInput.value = planId;
    if (modal) modal.style.display = 'flex';
}

/**
 * Interface: closeBlackoutModal
 * Hides the blackout management interface.
 */
function closeBlackoutModal() {
    const modal = document.getElementById('blackoutModal');
    if (modal) modal.style.display = 'none';
}

/**
 * Utility: escapeHtml
 * Sanitizes dynamic strings to prevent XSS.
 * 
 * @param {string} text - Raw input
 * @returns {string} - Sanitized HTML
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Global Exposure
 * Necessary for event delegation and inline handlers in templates.
 */
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
window.loadPlan = loadPlan;
