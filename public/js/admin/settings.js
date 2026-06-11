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
    ai_provider: 'gemini',          // Active AI API provider
    gemini: {                       // AI Integration metadata
        key: '',
        models: [],
        active: '',
        model_error: ''
    },
    opencode: {                     // OpenCode Zen metadata
        key: '',
        models: [],
        active: '',
        model_error: ''
    },
    local_ai: {                      // Local OpenAI-compatible endpoint metadata
        url: ''
    },
    ai_apps: {},                     // Per-feature AI provider/model overrides
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
        const data = await apiGet('/admin/settings/api/state');
        
        if (data && data.success) {
            STATE.settings = data.settings;
            STATE.email_settings = data.email_settings;
            STATE.timer_reset_hour = data.timer_reset_hour;
            STATE.ai_provider = data.ai_provider || 'gemini';
            STATE.gemini = data.gemini;
            STATE.opencode = data.opencode || STATE.opencode;
            STATE.local_ai = data.local_ai || STATE.local_ai;
            STATE.ai_apps = data.ai_apps || {};
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
            buttonText: el.dataset.buttonText || '💾 Save',
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

function providerLabel(provider) {
    if (provider === 'opencode') return 'OpenCode';
    if (provider === 'local') return 'Local';
    return 'Gemini';
}

function activeModelForProvider(provider) {
    if (provider === 'opencode') return STATE.opencode?.active || '';
    if (provider === 'local') return 'local';
    return STATE.gemini?.active || '';
}

function renderProviderOptions(active) {
    return `
        <option value="gemini" ${active === 'gemini' ? 'selected' : ''}>Google Gemini</option>
        <option value="opencode" ${active === 'opencode' ? 'selected' : ''}>OpenCode Zen</option>
        <option value="local" ${active === 'local' ? 'selected' : ''}>Local LLM (llama.cpp)</option>
    `;
}

function renderModelOptions(provider, active) {
    const models = provider === 'opencode'
        ? [...(STATE.opencode?.models || [])]
        : provider === 'local'
            ? ['local']
            : [...(STATE.gemini?.models || [])];
    const selected = active || activeModelForProvider(provider);
    if (selected && !models.includes(selected)) models.unshift(selected);

    return models.map(m => `
        <option value="${escapeHtml(m)}" ${m === selected ? 'selected' : ''}>${escapeHtml(m)}</option>
    `).join('');
}

function getAIAppSelection(feature) {
    const saved = STATE.ai_apps?.[feature.key] || {};
    const provider = saved.provider || feature.defaultProvider || STATE.ai_provider || 'gemini';
    const model = saved.model || activeModelForProvider(provider);
    return { provider, model };
}

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
 * Generates the AI configuration fragment.
 * 
 * @returns {string} - Rendered HTML.
 */
function renderAIPanel() {
    const g = STATE.gemini;
    const o = STATE.opencode;
    const l = STATE.local_ai;

    return `
        <div class="settings-panel" id="panel-ai">
            ${renderCard('ai_provider', 'AI Provider', 'Choose the default provider for text-only AI calls. Feature-specific defaults below can override this.', true, `
                <div class="settings-fields">
                    <div class="form-group full-width">
                        <label>Default Provider</label>
                        <div class="modal-prompt-row">
                            <div class="create-input-wrapper" style="flex: 1;">
                                <select name="ai_provider" class="game-input gemini-select">
                                    ${renderProviderOptions(STATE.ai_provider)}
                                </select>
                            </div>
                            <button type="submit" class="btn-primary btn-go-row">💾 Save</button>
                        </div>
                    </div>
                </div>
            `, true, providerLabel(STATE.ai_provider))}

            ${renderCard('gemini', 'Google Gemini', 'Gemini API key and model configuration.', !!g.key, `
                ${g.model_error ? `<div class="form-warning">${escapeHtml(g.model_error)}</div>` : ''}
                <div class="settings-fields">
                    <div class="form-group full-width">
                        <label>API Key</label>
                        <div class="render-row-input" data-id="gemini_key" data-section="gemini_key" data-name="gemini_key" data-type="password" data-value="" data-placeholder="${g.key ? '(configured — paste new value to replace)' : 'API Key'}"></div>
                    </div>
                    <div class="form-group full-width">
                        <label>Active Model</label>
                        <div class="modal-prompt-row">
                            <div class="create-input-wrapper" style="flex: 1;">
                                <select name="gemini_active_model" class="game-input gemini-select">
                                    ${renderModelOptions('gemini', g.active)}
                                </select>
                            </div>
                            <button type="submit" class="btn-primary btn-go-row" data-section="gemini_model">💾 Save</button>
                        </div>
                    </div>
                </div>
            `, true)}

            ${renderCard('opencode', 'OpenCode Zen', 'OpenCode API key and live model selection for text-only AI routing.', !!o.key, `
                ${o.model_error ? `<div class="form-warning">${escapeHtml(o.model_error)}</div>` : ''}
                <div class="settings-fields">
                    <div class="form-group full-width">
                        <label>API Key</label>
                        <div class="render-row-input" data-id="opencode_key" data-section="opencode_key" data-name="opencode_key" data-type="password" data-value="" data-placeholder="${o.key ? '(configured — paste new value to replace)' : 'API Key'}"></div>
                    </div>
                    <div class="form-group full-width">
                        <label>Active Model</label>
                        <div class="modal-prompt-row">
                            <div class="create-input-wrapper" style="flex: 1;">
                                <select name="opencode_active_model" class="game-input gemini-select">
                                    ${renderModelOptions('opencode', o.active)}
                                </select>
                            </div>
                            <button type="submit" class="btn-primary btn-go-row" data-section="opencode_model">💾 Save</button>
                        </div>
                    </div>
                </div>
            `, true)}

            ${renderCard('local_ai', 'Local LLM', 'OpenAI-compatible chat completions URL for local text-only AI routing.', !!l.url, `
                <div class="settings-fields">
                    <div class="form-group full-width">
                        <label>Application URL</label>
                        <input type="url" name="local_ai_url" class="game-input" value="${escapeHtml(l.url || '')}" placeholder="http://host:port/v1/chat/completions">
                    </div>
                </div>
            `)}

            ${renderCard('ai_app_models', 'Feature Defaults', 'Choose provider and model defaults for each AI-powered feature.', true, `
                <div class="settings-fields">
                    <div class="form-group full-width">
                        ${renderAIAppRows()}
                        <div class="modal-actions modal-actions-center">
                            <button type="submit" class="btn-primary" data-section="ai_app_models">💾 Save</button>
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
    const btnText = customBtnText || `💾 Save`;
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
