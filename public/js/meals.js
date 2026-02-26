// /public/js/meals.js

/**
 * Family Meal Planner - Client Side Logic (100% AJAX SPA)
 */

document.addEventListener('DOMContentLoaded', () => {
    // Initial render from the data provided by the template
    if (window.initialPlan) {
        renderTimeline(window.initialPlan);
    } else {
        loadPlan();
    }

    setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay'], [
        closeSuggestModal, closeBlackoutModal, closeEditSuggestionModal, closeDeleteSuggestionModal,
        closeManageVaultModal, closeAddEditMealModal, closeManageDeleteModal
    ]);
    
    setupMealAutocomplete('mealInput', 'mealDropdown');
    setupMealAutocomplete('editMealInput', 'editMealDropdown');
    setupMealAutocomplete('manageMealName', 'manageMealDropdown');
});

let vaultData = [];

/**
 * Core Data Fetching
 */
async function loadPlan() {
    try {
        const response = await fetch('/meals', {
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        const data = await response.json();
        
        if (data.vault) window.mealVault = data.vault;
        if (data.plan) renderTimeline(data.plan);
    } catch (err) {
        console.error('Failed to load meal plan:', err);
        showToast('Connection error. Failed to sync plan.', 'error');
    }
}

/**
 * Vault Management Logic (Admin)
 */
async function openManageVaultModal() {
    document.getElementById('manageVaultModal').style.display = 'flex';
    loadVaultData();
}

function closeManageVaultModal() {
    document.getElementById('manageVaultModal').style.display = 'none';
}

async function loadVaultData() {
    const response = await fetch('/meals/api/vault');
    const data = await response.json();
    if (data.meals) {
        vaultData = data.meals;
        renderVaultTable();
    }
}

function renderVaultTable() {
    const body = document.getElementById('vault-table-body');
    body.innerHTML = vaultData.map(m => `
        <tr>
            <td><strong>${escapeHtml(m.name)}</strong></td>
            <td class="col-actions">
                <div class="action-buttons">
                    <button class="btn-icon-edit" onclick="openAddEditMealModal(${m.id})">
                        ${getIcon('edit')}
                    </button>
                    <button class="btn-icon-delete" onclick="openManageDeleteModal(${m.id}, '${escapeHtml(m.name).replace(/'/g, "\\'")}')">
                        ${getIcon('delete')}
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

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
    document.getElementById('addEditMealModal').style.display = 'flex';
}

function closeAddEditMealModal() {
    document.getElementById('addEditMealModal').style.display = 'none';
    document.getElementById('manageMealDropdown').style.display = 'none';
}

async function submitManageMeal() {
    const id = document.getElementById('manageMealId').value;
    const name = document.getElementById('manageMealName').value.trim();

    if (!name) {
        showToast('Meal name is required', 'error');
        return;
    }

    const endpoint = id ? '/meals/api/vault/update' : '/meals/api/vault/add';
    const result = await apiPost(endpoint, { id, name });

    if (result.success) {
        showToast(result.message, 'success');
        closeAddEditMealModal();
        loadVaultData();
        loadPlan(); // Sync autocomplete vault
    } else {
        showToast(result.error || 'Operation failed', 'error');
    }
}

function openManageDeleteModal(id, name) {
    document.getElementById('manageDeleteMealId').value = id;
    document.getElementById('manageDeleteMealName').textContent = name;
    document.getElementById('manageDeleteConfirmModal').style.display = 'flex';
}

function closeManageDeleteModal() {
    document.getElementById('manageDeleteConfirmModal').style.display = 'none';
}

async function confirmManageDelete() {
    const id = document.getElementById('manageDeleteMealId').value;
    const result = await apiPost('/meals/api/vault/delete', { id });

    if (result.success) {
        showToast(result.message, 'success');
        closeManageDeleteModal();
        loadVaultData();
        loadPlan();
    } else {
        showToast(result.error || 'Delete failed', 'error');
    }
}

/**
 * Dynamic Rendering Engine
 */
function renderTimeline(plan) {
    const container = document.getElementById('meals-timeline');
    if (!container) return;

    container.innerHTML = plan.map((day, idx) => renderDayColumn(day, idx)).join('');
}

function renderDayColumn(day, index) {
    const now = new Date();
    const isPast2PM = now.getHours() >= 14;
    const isLocked = day.status === 'locked' || (index === 0 && isPast2PM);
    const blackout = day.blackout_reason;
    
    // Check if it's past 2PM for the first day (Today)
    let lockPill = '';
    if (index === 0) {
        const icon = isPast2PM ? getIcon('lock') : getIcon('clock');
        const text = isPast2PM ? 'Locked' : 'Locked @ 2PM';
        lockPill = `<span class="lock-info inline">${icon} ${text}</span>`;
    }

    let contentHtml = '';

    if (blackout) {
        contentHtml = `
            <div class="blackout-state">
                <span class="blackout-icon">${getIcon('cancel')}</span>
                <p>${escapeHtml(blackout)}</p>
            </div>`;
    } else if (isLocked && day.final_suggestion_id) {
        const winner = day.suggestions.find(s => s.id == day.final_suggestion_id);
        contentHtml = winner ? `
            <div class="winner-card">
                <div class="winner-badge">CHOSEN</div>
                <span class="meal-name">${escapeHtml(winner.meal_name)}</span>
                <small>Suggested by ${escapeHtml(winner.suggested_by_name)}</small>
            </div>` : '<p>Locked but no winner found.</p>';
    } else {
        // Current Leader banner (if votes exist)
        const leader = day.suggestions[0];
        const now = new Date();
        const isPast2PM = now.getHours() >= 14;
        const leaderLabel = (index === 0 && isPast2PM) ? "Today's Winner" : "Current Leader";

        const leaderBanner = (leader && leader.vote_count > 0) ? `
            <div class="leader-banner">
                <span class="leader-label">${getIcon('trophy')} ${leaderLabel}</span>
                <span class="leader-meal">${escapeHtml(leader.meal_name)}</span>
            </div>` : '';

        // Suggestions List
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

        // Action Buttons (Only show if NOT locked)
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

function renderVoterPills(voters) {
    if (!voters || !voters.length) return '';
    return `
        <div class="voter-pills">
            ${voters.map(v => `<span class="voter-badge">${escapeHtml(v)}</span>`).join('')}
        </div>`;
}

/**
 * Autocomplete Component
 */
function setupMealAutocomplete(inputId, dropdownId) {
    const input    = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);

    input.addEventListener('input', () => {
        const query   = input.value.toLowerCase().trim();
        const matches = query
            ? mealVault.filter(m => m.toLowerCase().includes(query))
            : mealVault;
        renderDropdown(input, dropdown, matches);
    });

    input.addEventListener('focus', () => {
        const matches = input.value.trim()
            ? mealVault.filter(m => m.toLowerCase().includes(input.value.toLowerCase()))
            : mealVault;
        renderDropdown(input, dropdown, matches);
    });

    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });
}

function renderDropdown(input, dropdown, items) {
    if (!items.length) {
        dropdown.style.display = 'none';
        return;
    }
    dropdown.innerHTML = items.map(m =>
        `<div class="meal-option" onmousedown="selectMeal('${input.id}', '${m.replace(/'/g, "\\'")}')">
            ${m}
        </div>`
    ).join('');
    dropdown.style.display = 'block';
    // Ensure the emoji picker trigger stays on top if it exists
    if (window.EmojiPicker && EmojiPicker.triggerBtn) {
        EmojiPicker.triggerBtn.style.zIndex = '1001';
    }
}

function selectMeal(inputId, value) {
    document.getElementById(inputId).value = value;
    let dropdownId = 'mealDropdown';
    if (inputId === 'editMealInput') dropdownId = 'editMealDropdown';
    if (inputId === 'manageMealName') dropdownId = 'manageMealDropdown';
    document.getElementById(dropdownId).style.display = 'none';
}

/**
 * API Interactions
 */
async function submitSuggestion() {
    const planId   = document.getElementById('activePlanId').value;
    const mealName = document.getElementById('mealInput').value.trim();

    if (!mealName) {
        showToast('Please enter a meal name', 'error');
        return;
    }

    const result = await apiPost('/meals/suggest', { plan_id: planId, meal_name: mealName });

    if (result.success) {
        showToast('Suggestion added!', 'success');
        closeSuggestModal();
        loadPlan(); // Sync UI
    } else {
        showToast(result.error || 'Failed to add suggestion', 'error');
    }
}

async function castVote(suggestionId) {
    const row = document.querySelector(`.suggestion-row[data-suggestion-id="${suggestionId}"]`);
    if (row) row.classList.add('vote-pop');

    const result = await apiPost('/meals/vote', { suggestion_id: suggestionId });

    if (result.success) {
        showToast(result.voted ? 'Vote cast!' : 'Vote removed', 'success');
        // Small delay to let animation finish before sync
        setTimeout(loadPlan, 300);
    } else {
        if (row) row.classList.remove('vote-pop');
        showToast(result.error || 'Voting failed', 'error');
    }
}

async function submitEditSuggestion() {
    const suggestionId = document.getElementById('editSuggestionId').value;
    const mealName     = document.getElementById('editMealInput').value.trim();

    if (!mealName) {
        showToast('Please enter a meal name', 'error');
        return;
    }

    const result = await apiPost('/meals/edit_suggestion', { suggestion_id: suggestionId, meal_name: mealName });

    if (result.success) {
        showToast('Suggestion updated', 'success');
        closeEditSuggestionModal();
        loadPlan();
    } else {
        showToast(result.error || 'Failed to update suggestion', 'error');
    }
}

async function confirmDeleteSuggestion() {
    const suggestionId = document.getElementById('deleteSuggestionId').value;
    const result = await apiPost('/meals/delete_suggestion', { suggestion_id: suggestionId });

    if (result.success) {
        showToast('Suggestion removed', 'success');
        closeDeleteSuggestionModal();
        loadPlan();
    } else {
        showToast(result.error || 'Failed to remove suggestion', 'error');
    }
}

async function submitBlackout() {
    const planId = document.getElementById('blackoutPlanId').value;
    const reason = document.getElementById('blackoutReason').value;

    const result = await apiPost('/meals/admin/lock', { plan_id: planId, blackout: reason });

    if (result.success) {
        showToast('Blackout set', 'success');
        closeBlackoutModal();
        loadPlan();
    } else {
        showToast(result.error || 'Failed to set blackout', 'error');
    }
}

async function adminLock(planId, suggestionId) {
    if (!confirm('Manually lock in this meal as the winner?')) return;

    const result = await apiPost('/meals/admin/lock', { plan_id: planId, suggestion_id: suggestionId });

    if (result.success) {
        showToast('Meal locked in!', 'success');
        loadPlan();
    } else {
        showToast(result.error || 'Failed to lock meal', 'error');
    }
}

/**
 * Modal Helpers
 */
function openSuggestModal(planId, dateLabel) {
    document.getElementById('activePlanId').value = planId;
    document.getElementById('suggestDateLabel').textContent = dateLabel;
    document.getElementById('mealInput').value = '';
    document.getElementById('mealDropdown').style.display = 'none';
    document.getElementById('suggestModal').style.display = 'flex';
}

function closeSuggestModal() {
    document.getElementById('suggestModal').style.display = 'none';
    document.getElementById('mealDropdown').style.display = 'none';
}

function openEditSuggestionModal(suggestionId, mealName) {
    document.getElementById('editSuggestionId').value = suggestionId;
    document.getElementById('editMealInput').value = mealName;
    document.getElementById('editMealDropdown').style.display = 'none';
    document.getElementById('editSuggestionModal').style.display = 'flex';
    document.getElementById('editMealInput').focus();
}

function closeEditSuggestionModal() {
    document.getElementById('editSuggestionModal').style.display = 'none';
    document.getElementById('editMealDropdown').style.display = 'none';
}

function deleteSuggestion(suggestionId, mealName) {
    document.getElementById('deleteSuggestionId').value = suggestionId;
    document.getElementById('deleteSuggestionName').textContent = mealName;
    document.getElementById('deleteConfirmModal').style.display = 'flex';
}

function closeDeleteSuggestionModal() {
    document.getElementById('deleteConfirmModal').style.display = 'none';
}

function openBlackoutModal(planId) {
    document.getElementById('blackoutPlanId').value = planId;
    document.getElementById('blackoutModal').style.display = 'flex';
}

function closeBlackoutModal() {
    document.getElementById('blackoutModal').style.display = 'none';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
