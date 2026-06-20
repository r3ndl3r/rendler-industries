// /public/js/admin/settings.js

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
 * - default.js: For apiPost, setupGlobalModalClosing, and modal helpers
 * - toast.js: For operation feedback
 */

/**
 * --- Module Configuration & State ---
 */
const CONFIG = {
    TAB_KEY: 'settings_active_tab',  // LocalStorage key for active tab
    CARD_KEY: 'settings_open_cards'  // LocalStorage key for expanded cards
};

const AI_FEATURES = [
    { key: 'ai_chat', label: '/ai Chat', desc: 'Family Pulse chat responses and current-info lookups.', defaultProvider: '' },
    { key: 'notes_format', label: 'Notes AI Formatting', desc: 'Reformats note bodies into Rendler dashboard markup.', defaultProvider: '' },
    { key: 'calendar_ai_parse', label: 'Calendar AI Parser', desc: 'Natural-language parsing for Family Calendar add-event drafts.', defaultProvider: '' },
    { key: 'emoji_lookup', label: 'Emoji Lookup System', desc: 'Background emoji generation for todo, shopping, reminders, calendar, and meals text.', defaultProvider: '' },
    { key: 'receipts', label: 'Receipts AI Scan', desc: 'Receipt image digitization. Image input requires Gemini.', defaultProvider: 'gemini' },
    { key: 'fuel', label: 'Fuel AI Scan', desc: 'Fuel receipt, pump, and odometer image extraction. Image input requires Gemini.', defaultProvider: 'gemini' },
    { key: 'rubiks', label: "Rubik's Solver", desc: 'Cube photo analysis. Image input requires Gemini.', defaultProvider: 'gemini' },
    { key: 'automator_report', label: 'Automator AI Report', desc: '24-hour automation log analysis.', defaultProvider: '' }
];

let STATE = {
    settings: {},                   // Global system settings (pushover, gotify, app_secret, etc)
    email_settings: {},             // SMTP and email dispatch configuration
    timer_reset_hour: 0,            // Scheduled daily maintenance hour
    ai_engine_registry: {
        default_engine: 'gemini',
        engines: {}
    },
    ai_apps: {},                     // Per-feature AI provider/model overrides
    google_cloud: {                 // Cloud Services (TTS/Translation) metadata
        key: ''
    },
    trakt: {
        client_id_configured: false,
        client_secret_configured: false
    }
};

let loadStateRequestId = 0;

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
    const requestId = ++loadStateRequestId;
    const retryButton = document.getElementById('settingsRetryButton');
    if (retryButton) retryButton.disabled = true;

    try {
        const data = await apiGet('/admin/settings/api/state');

        if (requestId !== loadStateRequestId) return;
        
        if (data && data.success) {
            STATE.settings = data.settings;
            STATE.email_settings = data.email_settings;
            STATE.timer_reset_hour = data.timer_reset_hour;
            STATE.ai_engine_registry = data.ai_engine_registry || STATE.ai_engine_registry;
            STATE.ai_apps = data.ai_apps || {};
            STATE.google_cloud = data.google_cloud;
            STATE.trakt = data.trakt || STATE.trakt;
            STATE.owm_api_key = data.owm_api_key;
            
            renderSettings();
            restoreUIState();
        } else {
            showLoadError();
        }
    } catch (err) {
        console.error('loadState failed:', err);
        if (requestId === loadStateRequestId) showLoadError();
    }
}

/**
 * Replaces the loading skeleton with a retryable error state.
 *
 * @returns {void}
 */
function showLoadError() {
    const container = document.getElementById('settingsPanelsContainer');
    if (!container) return;

    container.innerHTML = `
        <div class="component-loading">
            <span class="loading-icon-pulse" style="animation:none;filter:none;">⚠️</span>
            <p class="loading-label">Unable to synchronize configuration</p>
            <p class="loading-sub">The settings service is temporarily unavailable. Check your connection and try again.</p>
            <div style="margin-top:20px;">
                <button id="settingsRetryButton" class="btn-primary" onclick="loadState()">Retry</button>
            </div>
        </div>
    `;
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
        ${renderAIPanel()}
        ${renderIntegrationsPanel()}
        ${renderApplicationPanel()}
    `;

    // Hydration: Convert placeholders into standardized renderRowInput instances
    container.querySelectorAll('.render-row-input').forEach(el => {
        const options = {
            id: el.dataset.id,
            name: el.dataset.name,
            type: el.dataset.type || 'text',
            value: el.dataset.value || '',
            placeholder: el.dataset.placeholder || '',
            buttonText: el.dataset.buttonText || 'Save',
            buttonType: el.dataset.buttonType || 'submit',
            buttonClass: el.dataset.buttonClass || '',
            section: el.dataset.section || '',
            noButton: el.dataset.noButton === 'true',
            noEmoji: true
        };
        const row = renderRowInput(el, options);
        if (options.section && row.button) row.button.dataset.section = options.section;
        
    });

    // Interaction: Re-bind form submission handlers to the new dynamic DOM
    container.querySelectorAll('form').forEach(form => {
        if (form.onsubmit) {
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
                        <div class="render-row-input" data-id="pushover_token" data-name="pushover_token" data-type="password" data-value="" data-placeholder="${s.pushover?.token ? '(configured — paste new value to replace)' : 'API Token'}" data-no-button="true"></div>
                    </div>
                    <div class="form-group">
                        <label>User Key</label>
                        <div class="render-row-input" data-id="pushover_user" data-name="pushover_user" data-type="password" data-value="" data-placeholder="${s.pushover?.user ? '(configured — paste new value to replace)' : 'User Key'}"></div>
                    </div>
                </div>
            `, true)}

            ${renderCard('gotify', 'Gotify', 'Self-hosted push notifications via your Gotify server.', !!s.gotify?.token, `
                <div class="settings-fields">
                    <div class="form-group full-width">
                        <label>Application Token</label>
                        <div class="render-row-input" data-id="gotify_token" data-name="gotify_token" data-type="password" data-value="" data-placeholder="${s.gotify?.token ? '(configured — paste new value to replace)' : 'Application Token'}"></div>
                    </div>
                </div>
            `, true)}

            ${renderCard('discord', 'Discord', 'Bot token for direct message notifications via the Discord API.', !!s.discord_token, `
                <div class="settings-fields">
                    <div class="form-group full-width">
                        <label>Bot Token</label>
                        <div class="render-row-input" data-id="discord_token" data-name="discord_token" data-type="password" data-value="" data-placeholder="${s.discord_token ? '(configured — paste new value to replace)' : 'Bot Token'}"></div>
                    </div>
                </div>
            `, true)}
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
                        <div class="render-row-input" data-id="gmail_email" data-name="gmail_email" data-type="email" data-value="${escapeHtml(e.gmail_email)}" data-placeholder="you@gmail.com" data-no-button="true"></div>
                    </div>
                    <div class="form-group">
                        <label>App Password</label>
                        <div class="render-row-input" data-id="gmail_app_password" data-name="gmail_app_password" data-type="password" data-value="" data-placeholder="${e.gmail_app_password ? '(configured — paste new value to replace)' : 'App Password'}" data-no-button="true"></div>
                    </div>
                    <div class="form-group full-width">
                        <label>From Name <span class="label-optional">(optional)</span></label>
                        <div class="render-row-input" data-id="gmail_from_name" data-name="gmail_from_name" data-value="${escapeHtml(e.from_name)}" data-placeholder="e.g. Home Dashboard"></div>
                    </div>
                </div>
            `, true)}
        </div>
    `;
}

/**
 * Returns the current AI engine registry map from page state.
 */
function getAIEngines() {
    return STATE.ai_engine_registry?.engines || {};
}

/**
 * Returns AI engine ids in a stable display order.
 */
function getAIEngineIds() {
    const engines = getAIEngines();
    const preferred = ['gemini', 'opencode', 'local'].filter(id => engines[id]);
    const extra = Object.keys(engines).filter(id => !preferred.includes(id)).sort();
    return [...preferred, ...extra];
}

/**
 * Formats an AI engine id for labels and badges.
 */
function providerLabel(provider) {
    return getAIEngines()[provider]?.label || provider || 'AI Engine';
}

/**
 * Resolves the active model for an AI engine with fallback support.
 */
function activeModelForProvider(provider) {
    const engine = getAIEngines()[provider] || {};
    return engine.active_model || engine.fallback_models?.[0] || '';
}

/**
 * Renders provider select options from the registry.
 */
function renderProviderOptions(active) {
    return getAIEngineIds().map(id => `
        <option value="${escapeHtml(id)}" ${active === id ? 'selected' : ''}>${escapeHtml(providerLabel(id))}</option>
    `).join('');
}

/**
 * Renders model select options for the selected AI engine.
 */
function renderModelOptions(provider, active) {
    const engine = getAIEngines()[provider] || {};
    const models = [...(engine.models || engine.fallback_models || [])];
    const selected = active || activeModelForProvider(provider);
    if (selected && !models.includes(selected)) models.unshift(selected);

    return models.map(m => `
        <option value="${escapeHtml(m)}" ${m === selected ? 'selected' : ''}>${escapeHtml(m)}</option>
    `).join('');
}

/**
 * Resolves one feature's provider/model selection from saved overrides.
 */
function getAIAppSelection(feature) {
    const saved = STATE.ai_apps?.[feature.key] || {};
    const engines = getAIEngines();
    let provider = saved.provider || feature.defaultProvider || STATE.ai_engine_registry?.default_engine || 'gemini';
    if (!engines[provider]) provider = STATE.ai_engine_registry?.default_engine || getAIEngineIds()[0] || 'gemini';
    const model = saved.model || activeModelForProvider(provider);
    return { provider, model };
}

/**
 * Renders per-feature AI routing rows.
 */
function renderAIAppRows() {
    return AI_FEATURES.map(feature => {
        const selected = getAIAppSelection(feature);
        return `
            <div class="modal-prompt-row ai-feature-row" data-ai-feature-key="${escapeHtml(feature.key)}">
                <div class="create-input-wrapper" style="flex: 1.5;">
                    <label>${escapeHtml(feature.label)}</label>
                    <p class="help-text-muted">${escapeHtml(feature.desc)}</p>
                </div>
                <div class="create-input-wrapper" style="flex: 1;">
                    <select name="ai_app_provider" class="game-input gemini-select" data-ai-provider-key="${escapeHtml(feature.key)}" onchange="syncAIAppModelSelect('${escapeHtml(feature.key)}')">
                        ${renderProviderOptions(selected.provider)}
                    </select>
                </div>
                <div class="create-input-wrapper" style="flex: 1.4;">
                    <select name="ai_app_model" class="game-input gemini-select" data-ai-model-key="${escapeHtml(feature.key)}">
                        ${renderModelOptions(selected.provider, selected.model)}
                    </select>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Builds the editable AI registry JSON object from UI-safe state.
 */
function getEditableAIEngineRegistry() {
    const engines = {};
    getAIEngineIds().forEach(id => {
        const engine = getAIEngines()[id] || {};
        engines[id] = {
            label: engine.label || id,
            type: engine.type || 'openai_compatible',
            enabled: !!engine.enabled,
            api_key: engine.api_key_configured ? '(configured - paste new value to replace)' : '',
            active_model: engine.active_model || activeModelForProvider(id),
            fallback_models: engine.fallback_models || [],
            chat_endpoint: engine.chat_endpoint || '',
            models_endpoint: engine.models_endpoint || '',
            capabilities: engine.capabilities || []
        };
    });

    return {
        default_engine: STATE.ai_engine_registry?.default_engine || getAIEngineIds()[0] || '',
        engines
    };
}

/**
 * Renders the raw AI engine registry JSON editor.
 */
function renderAIEngineRegistryEditor() {
    const json = JSON.stringify(getEditableAIEngineRegistry(), null, 2);
    return `
        <div class="form-group full-width">
            <label>AI Engine Registry JSON</label>
            <p class="help-text-muted">
                Edit this JSON to add, remove, or update engines. Configured <code>api_key</code> values are redacted after save; keep the configured placeholder or paste a new key to replace one.
            </p>
            <textarea name="ai_engine_registry_json" class="game-input no-emoji" rows="24" spellcheck="false" style="font-family: monospace; min-height: 460px;">${escapeHtml(json)}</textarea>
        </div>
    `;
}

/**
 * Generates the AI configuration fragment.
 * 
 * @returns {string} - Rendered HTML.
 */
function renderAIPanel() {
    const defaultEngine = STATE.ai_engine_registry?.default_engine || getAIEngineIds()[0] || 'gemini';

    return `
        <div class="settings-panel" id="panel-ai">
            ${renderCard('ai_engine_registry', 'AI Engines', 'Edit the canonical AI engine registry JSON.', true, `
                <div class="settings-fields">
                    ${renderAIEngineRegistryEditor()}
                    <div class="modal-actions modal-actions-center settings-actions">
                        <button type="submit" class="btn-primary" data-section="ai_engine_registry">Save</button>
                    </div>
                </div>
            `, true, providerLabel(defaultEngine))}

            ${renderCard('ai_app_models', 'Feature Defaults', 'Choose provider and model defaults for each AI-powered feature.', true, `
                <div class="settings-fields">
                    <div class="form-group full-width">
                        ${renderAIAppRows()}
                        <div class="modal-actions modal-actions-center settings-actions">
                            <button type="submit" class="btn-primary" data-section="ai_app_models">Save</button>
                        </div>
                    </div>
                </div>
            `, true, 'Configured')}
        </div>
    `;
}

/**
 * Generates the non-AI integrations configuration fragment.
 * 
 * @returns {string} - Rendered HTML.
 */
function renderIntegrationsPanel() {
    const s = STATE.settings;
    const cloud = STATE.google_cloud;
    const trakt = STATE.trakt || {};
    const traktConfigured = !!(trakt.client_id_configured && trakt.client_secret_configured);

    return `
        <div class="settings-panel" id="panel-integrations">
            ${renderCard('unsplash', 'Unsplash', 'High-quality images for platform modules.', !!s.unsplash_key, `
                <div class="settings-fields">
                    <div class="form-group full-width">
                        <label>Access Key</label>
                        <div class="render-row-input" data-id="unsplash_key" data-name="unsplash_key" data-type="password" data-value="" data-placeholder="${s.unsplash_key ? '(configured — paste new value to replace)' : 'Access Key'}"></div>
                    </div>
                </div>
            `, true)}

            ${renderCard('google_cloud', 'Google Cloud', 'API key for TTS and Translation services.', !!cloud.key, `
                <div class="settings-fields">
                    <div class="form-group full-width">
                        <label>API Key</label>
                        <div class="render-row-input" data-id="google_cloud_key" data-name="google_cloud_key" data-type="password" data-value="" data-placeholder="${cloud.key ? '(configured — paste new value to replace)' : 'API Key'}"></div>
                    </div>
                </div>
            `, true)}
            
            ${renderCard('openweathermap', 'OpenWeatherMap', 'API key for weather observations and forecasts.', !!STATE.owm_api_key, `
                <div class="settings-fields">
                    <div class="form-group full-width">
                        <label>One Call 3.0 API Key</label>
                        <div class="render-row-input" data-id="owm_api_key" data-name="owm_api_key" data-type="password" data-value="" data-placeholder="${STATE.owm_api_key ? '(configured — paste new value to replace)' : 'One Call 3.0 API Key'}"></div>
                    </div>
                </div>
            `, true)}

            ${renderCard('trakt', 'Trakt API', 'Application credentials used for family member Trakt OAuth connections.', traktConfigured, `
                <div class="settings-fields">
                    <div class="form-group">
                        <label>Client ID</label>
                        <div class="render-row-input" data-id="trakt_client_id" data-name="trakt_client_id" data-type="password" data-value="" data-placeholder="${trakt.client_id_configured ? '(configured — paste new value to replace)' : 'Client ID'}" data-no-button="true"></div>
                    </div>
                    <div class="form-group">
                        <label>Client Secret</label>
                        <div class="render-row-input" data-id="trakt_client_secret" data-name="trakt_client_secret" data-type="password" data-value="" data-placeholder="${trakt.client_secret_configured ? '(configured — paste new value to replace)' : 'Client Secret'}"></div>
                    </div>
                </div>
            `, true)}
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
                        <div class="render-row-input" data-id="timer_reset_hour" data-name="timer_reset_hour" data-type="number" data-value="${STATE.timer_reset_hour}" data-placeholder="0-23"></div>
                    </div>
                </div>
            `, true, `Daily @ ${STATE.timer_reset_hour}:00`)}

            ${renderCard('app_secret', 'App Secret', 'Mojolicious session signing key.', true, `
                <div class="form-warning">
                    ⚠️ Changing this invalidates all active sessions. An app restart is required for the new key to take effect.
                </div>
                <div class="settings-fields">
                    <div class="form-group full-width">
                        <label>Secret Key <span class="label-optional">(min. 32 characters)</span></label>
                        <div class="render-row-input" data-id="app_secret" data-name="app_secret" data-type="password" data-value="" data-placeholder="${s.app_secret ? '(configured — paste new value to replace)' : 'Secret Key'}" data-button-class="btn-danger"></div>
                    </div>
                </div>
            `, true)}
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
    const btnText = customBtnText || 'Save';
    const btnClass = key === 'app_secret' ? 'btn-danger' : 'btn-primary';
    const safeKey = escapeHtml(key);
    const safeTitle = escapeHtml(title);
    const safeDesc = escapeHtml(desc);
    const safeBadgeText = escapeHtml(badgeText);
    const safeBtnText = escapeHtml(btnText);

    return `
        <div class="settings-card" data-card="${safeKey}">
            <div class="settings-card-header" role="button" tabindex="0" onclick="toggleCard(this.closest('.settings-card'))">
                <div class="card-header-meta">
                    <h3 class="settings-card-title">${safeTitle}</h3>
                    <p class="settings-card-desc">${safeDesc}</p>
                </div>
                <div class="card-header-right">
                    <span class="settings-badge ${badgeClass}">${safeBadgeText}</span>
                    <span class="card-chevron"></span>
                </div>
            </div>
            <div class="settings-card-body">
                <div class="settings-card-body-inner">
                    <form onsubmit="handleSettingsUpdate(event)">
                        <input type="hidden" name="section" value="${safeKey}">
                        ${content}
                        ${!hideStandardFooter ? `
                            <div class="form-actions">
                                <button type="submit" class="${btnClass} btn-small">${safeBtnText}</button>
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
        const isActive = tab.dataset.tab === tabId;
        tab.classList.toggle('active', isActive);
        if (isActive) tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
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
    } else {
        activateTab('notifications');
    }

    // Interaction: Tab navigation listeners
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.onclick = () => activateTab(tab.dataset.tab);
    });

    // Left-fade affordance: reveal once the user has scrolled the nav rightward
    const nav    = document.querySelector('.settings-nav');
    const wrapper = document.querySelector('.settings-nav-wrapper');
    if (nav && wrapper && nav.dataset.scrollBound !== 'true') {
        nav.addEventListener('scroll', () => {
            wrapper.classList.toggle('scrolled', nav.scrollLeft > 8);
        }, { passive: true });
        nav.dataset.scrollBound = 'true';
    }

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
 * Refreshes a feature model dropdown when its provider changes.
 */
function syncAIAppModelSelect(featureKey) {
    const providerSelect = document.querySelector(`[data-ai-provider-key="${featureKey}"]`);
    const modelSelect = document.querySelector(`[data-ai-model-key="${featureKey}"]`);
    if (!providerSelect || !modelSelect) return;

    const provider = providerSelect.value;
    modelSelect.innerHTML = renderModelOptions(provider, activeModelForProvider(provider));
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
    // Use e.submitter to identify the specific button that triggered the submit
    const btn = e.submitter || form.querySelector('button[type="submit"]');
    const formData = buildSettingsPayload(form, btn);
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
    btn.innerHTML = `⌛ Saving...`;

    try {
        const result = await apiPost('/admin/settings/update', Object.fromEntries(formData));
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
 * Builds a scoped settings update payload without submitting unrelated fields.
 */
function buildSettingsPayload(form, btn) {
    const scopedSection = btn?.dataset?.section;
    if (!scopedSection) {
        const formData = new FormData(form);
        form.querySelectorAll('input[type="password"]').forEach(input => {
            if (!input.value.trim()) formData.delete(input.name);
        });
        return formData;
    }

    const formData = new FormData();
    formData.set('section', scopedSection);

    if (scopedSection === 'ai_engine_registry') {
        formData.set('ai_engine_registry', form.querySelector('textarea[name="ai_engine_registry_json"]')?.value || '{}');
        return formData;
    }

    if (scopedSection === 'ai_app_models') {
        const rows = [...form.querySelectorAll('.ai-feature-row')].map(row => ({
            key: row.dataset.aiFeatureKey || '',
            provider: row.querySelector('select[name="ai_app_provider"]')?.value || '',
            model: row.querySelector('select[name="ai_app_model"]')?.value || ''
        }));
        formData.set('ai_app_models', JSON.stringify(rows));
        return formData;
    }

    const row = btn.closest('.modal-prompt-row');
    row?.querySelectorAll('input[name], select[name], textarea[name]').forEach(field => {
        formData.set(field.name, field.value);
    });

    return formData;
}

window.loadState = loadState;
window.toggleCard = toggleCard;
window.activateTab = activateTab;
window.handleSettingsUpdate = handleSettingsUpdate;
window.syncAIAppModelSelect = syncAIAppModelSelect;
