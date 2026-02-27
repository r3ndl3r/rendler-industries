// /public/js/settings.js

document.addEventListener('DOMContentLoaded', function () {
    const TAB_KEY  = 'settings_active_tab';
    const CARD_KEY = 'settings_open_cards';

    function getOpenCards() {
        try { return JSON.parse(localStorage.getItem(CARD_KEY)) || []; }
        catch (e) { return []; }
    }

    function saveOpenCards(list) {
        localStorage.setItem(CARD_KEY, JSON.stringify(list));
    }

    function toggleCard(card, forceOpen) {
        var header   = card.querySelector('.settings-card-header');
        var cardKey  = card.dataset.card;
        var isOpen   = typeof forceOpen !== 'undefined' ? forceOpen : !card.classList.contains('settings-card--open');
        var openList = getOpenCards();

        card.classList.toggle('settings-card--open', isOpen);
        header.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

        if (isOpen && openList.indexOf(cardKey) === -1) {
            openList.push(cardKey);
        } else if (!isOpen) {
            openList = openList.filter(function (k) { return k !== cardKey; });
        }
        saveOpenCards(openList);
    }

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

    getOpenCards().forEach(function (cardKey) {
        var card = document.querySelector('.settings-card[data-card="' + cardKey + '"]');
        if (card) toggleCard(card, true);
    });

    function activateTab(tabId) {
        document.querySelectorAll('.settings-tab').forEach(function (tab) {
            tab.classList.toggle('active', tab.dataset.tab === tabId);
        });
        document.querySelectorAll('.settings-panel').forEach(function (panel) {
            panel.classList.toggle('active', panel.id === 'panel-' + tabId);
        });
        localStorage.setItem(TAB_KEY, tabId);
    }

    document.querySelectorAll('.settings-tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
            activateTab(tab.dataset.tab);
        });
    });

    var savedTab = localStorage.getItem(TAB_KEY);
    if (savedTab && document.getElementById('panel-' + savedTab)) {
        activateTab(savedTab);
    }

    document.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-toggle-visibility]');
        if (!btn) return;
        var input = btn.closest('.input-wrapper').querySelector('input');
        if (!input) return;
        var revealing   = input.type === 'password';
        input.type      = revealing ? 'text' : 'password';
        btn.textContent = revealing ? 'Hide' : 'Show';
    });

    // Handle AJAX Form Submissions
    document.querySelectorAll('.settings-card form').forEach(form => {
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            const btn = this.querySelector('button[type="submit"]');
            const originalHtml = btn.innerHTML;
            const formData = new FormData(this);
            const section = formData.get('section');

            // Confirmation for sensitive actions
            if (section === 'app_secret') {
                const confirmed = await new Promise(resolve => {
                    showConfirmModal({
                        title: 'Update App Secret',
                        message: 'Changing the App Secret will invalidate all active sessions and require an application restart. Continue?',
                        danger: true,
                        confirmText: 'Update Secret',
                        onConfirm: () => resolve(true)
                    });
                    // Need to handle cancel too
                    document.querySelector('.btn-secondary').onclick = () => {
                        closeConfirmModal();
                        resolve(false);
                    };
                });
                if (!confirmed) return;
            }

            btn.disabled = true;
            btn.innerHTML = `${getIcon('waiting')} Saving...`;

            const result = await apiPost('/settings/update', Object.fromEntries(formData));
            
            if (result && result.success) {
                // Update badge if applicable
                const card = this.closest('.settings-card');
                const badge = card.querySelector('.settings-badge');
                if (badge) {
                    badge.textContent = 'Configured';
                    badge.className = 'settings-badge badge-active';
                }
                
                // If it was gemini settings, we might need a partial reload or just confirm
                if (section === 'gemini' || section === 'gemini_models') {
                    location.reload(); // Hard reload for complex state updates
                }
            }
            
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        });
    });

    // Handle Gemini Model Deletion (Standardized Confirmation)
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
                    location.reload();
                }
            }
        });
    };
});
