// /public/js/settings.js

/**
 * Application Settings Controller Module
 * 
 * This module manages the Platform Configuration interface. It coordinates 
 * tabbed navigation, collapsible configuration cards, and secure AJAX-based 
 * updates for system-level settings (e.g., API keys, SMTP, Timers).
 * 
 * Features:
 * - Persistent tab and card state using LocalStorage
 * - Real-time password visibility toggling for sensitive inputs
 * - Administrative confirmation workflow for critical App Secret updates
 * - Dynamic Gemini Model management (Add/Remove) with state synchronization
 * - AJAX-driven section updates with visual status indicators
 * 
 * Dependencies:
 * - default.js: For apiPost, getIcon, and modal helpers
 * - toast.js: For operation feedback
 */

/**
 * Initialization System
 * Restores interface state from LocalStorage and bootstraps event listeners.
 */
document.addEventListener('DOMContentLoaded', function () {
    /**
     * Configuration Constants
     * Keys for persisting UI state across session reloads.
     */
    const TAB_KEY  = 'settings_active_tab';
    const CARD_KEY = 'settings_open_cards';

    /**
     * Logic: Interface Persistence
     * Retrieves the collection of open settings cards from local storage.
     * 
     * @returns {string[]} - Array of card identifier keys
     */
    function getOpenCards() {
        try { return JSON.parse(localStorage.getItem(CARD_KEY)) || []; }
        catch (e) { return []; }
    }

    /**
     * Logic: Interface Persistence
     * Persists the current open card list to local storage.
     * 
     * @param {string[]} list - Keys to save
     */
    function saveOpenCards(list) {
        localStorage.setItem(CARD_KEY, JSON.stringify(list));
    }

    /**
     * Interface: toggleCard
     * Manages the accordion state of settings sections.
     * 
     * @param {HTMLElement} card - Target settings card
     * @param {boolean|undefined} forceOpen - Explicit override for restoration
     */
    function toggleCard(card, forceOpen) {
        var header   = card.querySelector('.settings-card-header');
        var cardKey  = card.dataset.card;
        var isOpen   = typeof forceOpen !== 'undefined' ? forceOpen : !card.classList.contains('settings-card--open');
        var openList = getOpenCards();

        card.classList.toggle('settings-card--open', isOpen);
        header.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

        // Logic: Sync local storage state
        if (isOpen && openList.indexOf(cardKey) === -1) {
            openList.push(cardKey);
        } else if (!isOpen) {
            openList = openList.filter(function (k) { return k !== cardKey; });
        }
        saveOpenCards(openList);
    }

    // Interaction: Card header click/keyboard handlers
    document.querySelectorAll('.settings-card-header').forEach(function (header) {
        header.addEventListener('click', function () {
            toggleCard(header.closest('.settings-card'));
        });
        header.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleCard(header.closest('.settings-card'));
            }
        });
    });

    // Lifecycle: Restore open cards from previous session
    getOpenCards().forEach(function (cardKey) {
        var card = document.querySelector('.settings-card[data-card="' + cardKey + '"]');
        if (card) toggleCard(card, true);
    });

    /**
     * Interface: activateTab
     * Manages high-level panel switching and persistence.
     * 
     * @param {string} tabId - Unique tab key
     */
    function activateTab(tabId) {
        document.querySelectorAll('.settings-tab').forEach(function (tab) {
            tab.classList.toggle('active', tab.dataset.tab === tabId);
        });
        document.querySelectorAll('.settings-panel').forEach(function (panel) {
            panel.classList.toggle('active', panel.id === 'panel-' + tabId);
        });
        localStorage.setItem(TAB_KEY, tabId);
    }

    // Interaction: Tab navigation listeners
    document.querySelectorAll('.settings-tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
            activateTab(tab.dataset.tab);
        });
    });

    // Lifecycle: Restore active tab from previous session
    var savedTab = localStorage.getItem(TAB_KEY);
    if (savedTab && document.getElementById('panel-' + savedTab)) {
        activateTab(savedTab);
    }

    /**
     * Logic: Visibility Toggle
     * Handles masking/revealing of password and API key fields.
     */
    document.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-toggle-visibility]');
        if (!btn) return;
        var input = btn.closest('.input-wrapper').querySelector('input');
        if (!input) return;
        var revealing   = input.type === 'password';
        input.type      = revealing ? 'text' : 'password';
        btn.textContent = revealing ? 'Hide' : 'Show';
    });

    /**
     * --- AJAX Form Submissions ---
     */
    document.querySelectorAll('.settings-card form').forEach(form => {
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            const btn = this.querySelector('button[type="submit"]');
            const originalHtml = btn.innerHTML;
            const formData = new FormData(this);
            const section = formData.get('section');

            // Workflow: Automated confirmation for sensitive system parameters
            if (section === 'app_secret') {
                const confirmed = await new Promise(resolve => {
                    showConfirmModal({
                        title: 'Update App Secret',
                        message: 'Changing the App Secret will invalidate all active sessions and require an application restart. Continue?',
                        danger: true,
                        confirmText: 'Update Secret',
                        onConfirm: () => resolve(true)
                    });
                    // Scope: specialized cancel hook for this inline promise
                    const cancelBtn = document.querySelector('.btn-secondary');
                    if (cancelBtn) {
                        cancelBtn.onclick = () => {
                            closeConfirmModal();
                            resolve(false);
                        };
                    }
                });
                if (!confirmed) return;
            }

            // UI Feedback: indicate processing
            btn.disabled = true;
            btn.innerHTML = `${getIcon('waiting')} Saving...`;

            const result = await apiPost('/settings/update', Object.fromEntries(formData));
            
            if (result && result.success) {
                // UI: Update configuration badge within the card
                const card = this.closest('.settings-card');
                const badge = card ? card.querySelector('.settings-badge') : null;
                if (badge) {
                    badge.textContent = 'Configured';
                    badge.className = 'settings-badge badge-active';
                }
                
                // Lifecycle: Force reload for modules with complex backend dependencies (AI)
                if (section === 'gemini' || section === 'gemini_models') {
                    location.reload(); 
                }
            }
            
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        });
    });

    /**
     * Interface: confirmDeleteModel (Admin)
     * Specialized confirmation workflow for AI model registry management.
     * 
     * @param {string} modelName - The identifier of the AI model to remove
     */
    window.confirmDeleteModel = function(modelName) {
        showConfirmModal({
            title: 'Remove Model',
            message: `Are you sure you want to remove <strong>${modelName}</strong> from available models?`,
            danger: true,
            confirmText: 'Remove',
            loadingText: 'Removing...',
            onConfirm: async () => {
                const result = await apiPost('/settings/update', {
                    section: 'gemini_models',
                    action: 'delete',
                    model_name: modelName
                });
                if (result && result.success) {
                    location.reload(); // Full sync required for model select lists
                }
            }
        });
    };
});
