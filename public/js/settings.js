// /public/js/settings.js

document.addEventListener('DOMContentLoaded', function () {
    const TAB_KEY  = 'settings_active_tab';
    const CARD_KEY = 'settings_open_cards';

    // --- Persistence Helpers ---

    // Open card state is stored as a JSON array of data-card values so it
    // survives form POSTs that redirect back to this page.
    function getOpenCards() {
        try { return JSON.parse(localStorage.getItem(CARD_KEY)) || []; }
        catch (e) { return []; }
    }

    function saveOpenCards(list) {
        localStorage.setItem(CARD_KEY, JSON.stringify(list));
    }

    // --- Card Accordion ---

    // Opens or closes a single card. Updates aria-expanded, the chevron
    // rotation, and the persistent open-card list in localStorage.
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

    // Bind click and keyboard (Enter/Space) to each card header
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

    // Restore previously open cards from localStorage on page load
    getOpenCards().forEach(function (cardKey) {
        var card = document.querySelector('.settings-card[data-card="' + cardKey + '"]');
        if (card) toggleCard(card, true);
    });

    // --- Tab Switching ---

    // Activates a tab panel by id suffix and persists the selection so the
    // user lands on the same section after a form POST redirects back here.
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

    // Restore saved tab; guard against stale values from renamed tabs
    var savedTab = localStorage.getItem(TAB_KEY);
    if (savedTab && document.getElementById('panel-' + savedTab)) {
        activateTab(savedTab);
    }

    // --- Password Visibility Toggle ---

    // Delegated to document so any dynamically added fields are covered.
    // The button must carry [data-toggle-visibility] and sit inside .input-wrapper.
    document.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-toggle-visibility]');
        if (!btn) return;
        var input = btn.closest('.input-wrapper').querySelector('input');
        if (!input) return;
        var revealing   = input.type === 'password';
        input.type      = revealing ? 'text' : 'password';
        btn.textContent = revealing ? 'Hide' : 'Show';
    });
});
