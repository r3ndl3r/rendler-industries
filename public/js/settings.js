// /public/js/settings.js

/**
 * Application Settings Controller
 * 
 * Manages the Platform Configuration interface, coordinating tabbed navigation, 
 * collapsible configuration cards, and secure state-driven updates for 
 * system-level settings (e.g., API keys, SMTP, Timers).
 * 
 * Features:
 * - Single Source of Truth synchronization via unified STATE object
 * - Persistent tab and card state using LocalStorage
 * - Real-time password visibility toggling for sensitive inputs
 * - Administrative confirmation workflow for critical App Secret updates
 * - Dynamic Gemini AI model registry management (Add/Remove)
 * - Optimized section updates with localized UI reconciliation
 * 
 * Dependencies:
 * - default.js: For apiPost, getIcon, setupGlobalModalClosing, and modal helpers
 * - toast.js: For operation feedback
 */

/**
 * --- Module Configuration & State ---
 */
const CONFIG = {
    TAB_KEY: 'settings_active_tab',  // LocalStorage key for active tab
    CARD_KEY: 'settings_open_cards'  // LocalStorage key for expanded cards
};

let STATE = {
    settings: {},                   // Global system settings (pushover, gotify, app_secret, etc)
    email_settings: {},             // SMTP and email dispatch configuration
    timer_reset_hour: 0,            // Scheduled daily maintenance hour
    gemini: {                       // AI Integration metadata
        key: '',
        models: [],
        active: ''
    },
    google_cloud: {                 // Cloud Services (TTS/Translation) metadata
        key: ''
    }
};

/**
 * Bootstraps the module state and establishes event delegation.
 * 
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', () => {
    loadState();

    // Modal: Configure unified closure behavior
    setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay'], [
        closeConfirmModal
    ]);

    // UI: Global listener for sensitive field visibility toggling
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-toggle-visibility]');
        if (!btn) return;
        const input = btn.closest('.input-wrapper')?.querySelector('input');
        if (!input) return;
        const revealing = input.type === 'password';
        input.type = revealing ? 'text' : 'password';
        btn.textContent = revealing ? 'Hide' : 'Show';
    });
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
    try {
        const response = await fetch('/settings/api/state');
        const data = await response.json();
        
        if (data && data.success) {
            STATE.settings = data.settings;
            STATE.email_settings = data.email_settings;
            STATE.timer_reset_hour = data.timer_reset_hour;
            STATE.gemini = data.gemini;
            STATE.google_cloud = data.google_cloud;
            STATE.owm_api_key = data.owm_api_key;
            
            renderSettings();
            restoreUIState();
        }
    } catch (err) {
        console.error('loadState failed:', err);
    }
}

/**
 * --- UI Rendering Engine ---
 */

/**
 * Orchestrates the generation of all settings panels from state.
 * 
 * @returns {void}
 */
function renderSettings() {
    const container = document.getElementById('settingsPanelsContainer');
    if (!container) return;

    container.innerHTML = `
        ${renderNotificationsPanel()}
        ${renderEmailPanel()}
        ${renderIntegrationsPanel()}
        ${renderApplicationPanel()}
    `;

    // Interaction: Re-bind form submission handlers to the new dynamic DOM
    container.querySelectorAll('form').forEach(form => {
        if (form.id === 'addModelForm') {
            form.onsubmit = handleAddGeminiModel;
        } else if (form.onsubmit) {
            // Already handled via inline assignment or legacy
        } else {
            form.onsubmit = handleSettingsUpdate;
        }
    });
}

/**
 * Generates the Notifications configuration fragment.
 * 
 * @returns {string} - Rendered HTML.
 */
function renderNotificationsPanel() {
    const s = STATE.settings;
    return `
        <div class="settings-panel" id="panel-notifications">
            ${renderCard('pushover', 'Pushover', 'Push notifications via the Pushover service.', !!s.pushover?.token, `
                <div class="settings-fields">
                    <div class="form-group">
                        <label>API Token</label>
                        <div class="input-wrapper">
                            <input type="password" name="pushover_token" class="game-input" value="${escapeHtml(s.pushover?.token)}" autocomplete="off">
                            <button type="button" class="btn-toggle" data-toggle-visibility>Show</button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>User Key</label>
                        <div class="input-wrapper">
                            <input type="password" name="pushover_user" class="game-input" value="${escapeHtml(s.pushover?.user)}" autocomplete="off">
                            <button type="button" class="btn-toggle" data-toggle-visibility>Show</button>
                        </div>
                    </div>
                </div>
            `)}

            ${renderCard('gotify', 'Gotify', 'Self-hosted push notifications via your Gotify server.', !!s.gotify?.token, `
                <div class="settings-fields">
                    <div class="form-group full-width">
                        <label>Application Token</label>
                        <div class="input-wrapper">
                            <input type="password" name="gotify_token" class="game-input" value="${escapeHtml(s.gotify?.token)}" autocomplete="off">
                            <button type="button" class="btn-toggle" data-toggle-visibility>Show</button>
                        </div>
                    </div>
                </div>
            `)}
        </div>
    `;
}

/**
 * Generates the Email (SMTP) configuration fragment.
 * 
 * @returns {string} - Rendered HTML.
 */
function renderEmailPanel() {
    const e = STATE.email_settings;
    return `
        <div class="settings-panel" id="panel-email">
            ${renderCard('email', 'Gmail SMTP', 'Outbound email for notifications and reminders.', !!e.gmail_email, `
                <div class="form-info">
                    Use a Gmail App Password — not your account password.
                    <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">Generate one here ↗</a>
                </div>
                <div class="settings-fields">
                    <div class="form-group">
                        <label>Gmail Address</label>
                        <div class="input-wrapper">
                            <input type="email" name="gmail_email" class="game-input" value="${escapeHtml(e.gmail_email)}" placeholder="you@gmail.com">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>App Password</label>
                        <div class="input-wrapper">
                            <input type="password" name="gmail_app_password" class="game-input" value="${escapeHtml(e.gmail_app_password)}" autocomplete="off">
                            <button type="button" class="btn-toggle" data-toggle-visibility>Show</button>
                        </div>
                    </div>
                    <div class="form-group full-width">
                        <label>From Name <span class="label-optional">(optional)</span></label>
                        <div class="input-wrapper">
                            <input type="text" name="gmail_from_name" class="game-input" value="${escapeHtml(e.from_name)}" placeholder="e.g. Home Dashboard">
                        </div>
                    </div>
                </div>
            `)}
        </div>
    `;
}

/**
 * Generates the Integrations (AI/Cloud) configuration fragment.
 * 
 * @returns {string} - Rendered HTML.
 */
function renderIntegrationsPanel() {
    const s = STATE.settings;
    const g = STATE.gemini;
    const cloud = STATE.google_cloud;

    const modelOptions = g.models.map(m => `
        <option value="${escapeHtml(m)}" ${m === g.active ? 'selected' : ''}>${escapeHtml(m)}</option>
    `).join('');

    const modelPills = g.models.map(m => `
        <div class="pill-badge">
            <span class="model-name-text">${escapeHtml(m)}</span>
            <button type="button" class="btn-remove-model" onclick="confirmDeleteModel('${escapeHtml(m)}')" title="Remove Model">&times;</button>
        </div>
    `).join('');

    return `
        <div class="settings-panel" id="panel-integrations">
            ${renderCard('unsplash', 'Unsplash', 'High-quality images for platform modules.', !!s.unsplash_key, `
                <div class="settings-fields">
                    <div class="form-group full-width">
                        <label>Access Key</label>
                        <div class="input-wrapper">
                            <input type="password" name="unsplash_key" class="game-input" value="${escapeHtml(s.unsplash_key)}" autocomplete="off">
                            <button type="button" class="btn-toggle" data-toggle-visibility>Show</button>
                        </div>
                    </div>
                </div>
            `)}

            ${renderCard('gemini', 'Google Gemini', 'Gemini API key and model configuration.', !!g.key, `
                <div class="settings-fields">
                    <div class="form-group full-width">
                        <label>API Key</label>
                        <div class="input-wrapper">
                            <input type="password" name="gemini_key" class="game-input" value="${escapeHtml(g.key)}" autocomplete="off">
                            <button type="button" class="btn-toggle" data-toggle-visibility>Show</button>
                        </div>
                    </div>
                    <div class="form-group full-width">
                        <label>Active Model</label>
                        <div class="input-wrapper">
                            <select name="gemini_active_model" class="game-input gemini-select">
                                ${modelOptions}
                            </select>
                        </div>
                    </div>
                </div>
                <div class="form-actions mt-15">
                    <button type="submit" class="btn-primary btn-small">Save Gemini Settings</button>
                </div>
                <hr class="settings-separator">
                <div class="settings-fields">
                    <div class="form-group full-width">
                        <label>Available Models</label>
                        <div class="model-list-container">
                            ${modelPills}
                        </div>
                    </div>
                    <div class="form-group mt-15">
                        <label>Add New Model Name</label>
                        <div class="d-flex gap-10">
                            <input type="text" id="newModelInput" class="game-input" placeholder="e.g. gemini-3.1-pro-preview">
                            <button type="button" class="btn-primary btn-small nowrap" onclick="handleAddGeminiModel()">Add Model</button>
                        </div>
                    </div>
                </div>
            `, true)}

            ${renderCard('google_cloud', 'Google Cloud', 'API key for TTS and Translation services.', !!cloud.key, `
                <div class="settings-fields">
                    <div class="form-group full-width">
                        <label>API Key</label>
                        <div class="input-wrapper">
                            <input type="password" name="google_cloud_key" class="game-input" value="${escapeHtml(cloud.key)}" autocomplete="off">
                            <button type="button" class="btn-toggle" data-toggle-visibility>Show</button>
                        </div>
                    </div>
                </div>
            `)}
            
            ${renderCard('openweathermap', 'OpenWeatherMap', 'API key for weather observations and forecasts.', !!STATE.owm_api_key, `
                <div class="settings-fields">
                    <div class="form-group full-width">
                        <label>One Call 3.0 API Key</label>
                        <div class="input-wrapper">
                            <input type="password" name="owm_api_key" class="game-input" value="${escapeHtml(STATE.owm_api_key)}" autocomplete="off">
                            <button type="button" class="btn-toggle" data-toggle-visibility>Show</button>
                        </div>
                    </div>
                </div>
            `)}
        </div>
    `;
}

/**
 * Generates the Application core configuration fragment.
 * 
 * @returns {string} - Rendered HTML.
 */
function renderApplicationPanel() {
    const s = STATE.settings;
    return `
        <div class="settings-panel" id="panel-application">
            ${renderCard('timers', 'Timer Reset', 'Daily maintenance trigger hour.', true, `
                <div class="settings-fields">
                    <div class="form-group full-width">
                        <label>Reset Hour <span class="label-optional">(0 = midnight, 15 = 3 PM)</span></label>
                        <div class="input-wrapper">
                            <input type="number" name="timer_reset_hour" class="game-input no-pad-right" value="${STATE.timer_reset_hour}" min="0" max="23">
                        </div>
                    </div>
                </div>
            `, false, `Daily @ ${STATE.timer_reset_hour}:00`)}

            ${renderCard('app_secret', 'App Secret', 'Mojolicious session signing key.', true, `
                <div class="form-warning">
                    ${getIcon('warning')} Changing this invalidates all active sessions. An app restart is required for the new key to take effect.
                </div>
                <div class="settings-fields">
                    <div class="form-group full-width">
                        <label>Secret Key <span class="label-optional">(min. 32 characters)</span></label>
                        <div class="input-wrapper">
                            <input type="password" name="app_secret" class="game-input" value="${escapeHtml(s.app_secret)}" autocomplete="off">
                            <button type="button" class="btn-toggle" data-toggle-visibility>Show</button>
                        </div>
                    </div>
                </div>
            `, false, '', 'Update Secret')}
        </div>
    `;
}

/**
 * Helper: Generates a standardized configuration card.
 * 
 * @param {string} key - Unique section identifier.
 * @param {string} title - Human-readable label.
 * @param {string} desc - Behavioral summary.
 * @param {boolean} isConfigured - Success status for badge.
 * @param {string} content - Interior field HTML.
 * @param {boolean} hideStandardFooter - Flag to omit default save button.
 * @param {string} customBadgeText - Optional override for badge label.
 * @param {string} customBtnText - Optional override for save button label.
 * @returns {string} - Rendered HTML.
 */
function renderCard(key, title, desc, isConfigured, content, hideStandardFooter = false, customBadgeText = '', customBtnText = '') {
    const badgeText = customBadgeText || (isConfigured ? 'Configured' : 'Not Set');
    const badgeClass = isConfigured ? 'badge-active' : 'badge-inactive';
    const btnText = customBtnText || `Save ${title}`;
    const btnClass = key === 'app_secret' ? 'btn-danger' : 'btn-primary';

    return `
        <div class="settings-card" data-card="${key}">
            <div class="settings-card-header" role="button" tabindex="0" onclick="toggleCard(this.closest('.settings-card'))">
                <div class="card-header-meta">
                    <h3 class="settings-card-title">${title}</h3>
                    <p class="settings-card-desc">${desc}</p>
                </div>
                <div class="card-header-right">
                    <span class="settings-badge ${badgeClass}">${badgeText}</span>
                    <span class="card-chevron"></span>
                </div>
            </div>
            <div class="settings-card-body">
                <div class="settings-card-body-inner">
                    <form onsubmit="handleSettingsUpdate(event)">
                        <input type="hidden" name="section" value="${key}">
                        ${content}
                        ${!hideStandardFooter ? `
                            <div class="form-actions">
                                <button type="submit" class="${btnClass} btn-small">${btnText}</button>
                            </div>
                        ` : ''}
                    </form>
                </div>
            </div>
        </div>
    `;
}

/**
 * --- Interactive Logic & Persistence ---
 */

/**
 * Manages the accordion state of settings sections.
 * 
 * @param {HTMLElement} card - Target settings card.
 * @param {boolean|undefined} forceOpen - Explicit override for restoration.
 * @returns {void}
 */
function toggleCard(card, forceOpen) {
    const header = card.querySelector('.settings-card-header');
    const cardKey = card.dataset.card;
    const isOpen = typeof forceOpen !== 'undefined' ? forceOpen : !card.classList.contains('settings-card--open');
    let openList = getOpenCards();

    card.classList.toggle('settings-card--open', isOpen);
    header.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

    if (isOpen && !openList.includes(cardKey)) {
        openList.push(cardKey);
    } else if (!isOpen) {
        openList = openList.filter(k => k !== cardKey);
    }
    saveOpenCards(openList);
}

/**
 * Manages high-level panel switching and persistence.
 * 
 * @param {string} tabId - Unique tab key.
 * @returns {void}
 */
function activateTab(tabId) {
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabId);
    });
    document.querySelectorAll('.settings-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `panel-${tabId}`);
    });
    localStorage.setItem(CONFIG.TAB_KEY, tabId);
}

/**
 * Restores interface state (tabs/cards) from LocalStorage.
 * 
 * @returns {void}
 */
function restoreUIState() {
    // Tab Restoration
    const savedTab = localStorage.getItem(CONFIG.TAB_KEY);
    if (savedTab && document.getElementById(`panel-${savedTab}`)) {
        activateTab(savedTab);
    }

    // Interaction: Tab navigation listeners
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.onclick = () => activateTab(tab.dataset.tab);
    });

    // Card Restoration
    getOpenCards().forEach(cardKey => {
        const card = document.querySelector(`.settings-card[data-card="${cardKey}"]`);
        if (card) toggleCard(card, true);
    });
}

/**
 * Retrieves the collection of open settings cards.
 * 
 * @returns {string[]} - Array of identifier keys.
 */
function getOpenCards() {
    try { return JSON.parse(localStorage.getItem(CONFIG.CARD_KEY)) || []; }
    catch (e) { return []; }
}

/**
 * Persists the current open card list.
 * 
 * @param {string[]} list - Keys to save.
 * @returns {void}
 */
function saveOpenCards(list) {
    localStorage.setItem(CONFIG.CARD_KEY, JSON.stringify(list));
}

/**
 * --- API Interactions ---
 */

/**
 * Orchestrates the sectioned configuration update workflow.
 * 
 * @async
 * @param {Event} e - Form submission event.
 * @returns {Promise<void>}
 */
async function handleSettingsUpdate(e) {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);
    const section = formData.get('section');

    // Workflow: Mandatory Action confirmation for sensitive system parameters
    if (section === 'app_secret') {
        const confirmed = await new Promise(resolve => {
            showConfirmModal({
                title: 'Update App Secret',
                message: 'Changing the App Secret will invalidate all active sessions and require an application restart. Continue?',
                danger: true,
                confirmText: 'Update Secret',
                hideCancel: true,
                alignment: 'center',
                onConfirm: () => resolve(true),
                onCancel: () => resolve(false)
            });
        });
        if (!confirmed) return;
    }

    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Saving...`;

    try {
        const result = await apiPost('/settings/update', Object.fromEntries(formData));
        if (result && result.success) {
            // UI: Synchronize configuration badge
            const card = form.closest('.settings-card');
            const badge = card?.querySelector('.settings-badge');
            if (badge && !badge.textContent.includes('@')) {
                badge.textContent = 'Configured';
                badge.className = 'settings-badge badge-active';
            }
            
            // Re-sync local state for non-destructive updates
            if (section !== 'app_secret') {
                await loadState();
            }
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Specialized handler for Gemini model registry additions.
 * 
 * @async
 * @returns {Promise<void>}
 */
async function handleAddGeminiModel() {
    const input = document.getElementById('newModelInput');
    const name = input?.value.trim();
    if (!name) return;

    const result = await apiPost('/settings/update', {
        section: 'gemini_models',
        action: 'add',
        new_model: name
    });

    if (result && result.success) {
        if (input) input.value = '';
        await loadState();
    }
}

/**
 * Orchestrates the Mandatory Action removal of AI model metadata.
 * 
 * @param {string} modelName - Target identifier.
 * @returns {void}
 */
function confirmDeleteModel(modelName) {
    showConfirmModal({
        title: 'Remove Model',
        message: `Permanently remove \"<strong>${escapeHtml(modelName)}</strong>\" from the available registry?`,
        danger: true,
        confirmText: 'Remove',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const result = await apiPost('/settings/update', {
                section: 'gemini_models',
                action: 'delete',
                model_name: modelName
            });
            if (result && result.success) await loadState();
        }
    });
}

window.loadState = loadState;
window.toggleCard = toggleCard;
window.activateTab = activateTab;
window.handleSettingsUpdate = handleSettingsUpdate;
window.handleAddGeminiModel = handleAddGeminiModel;
window.confirmDeleteModel = confirmDeleteModel;
