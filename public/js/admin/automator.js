// /public/js/admin/automator.js

/**
 * Automator module client.
 *
 * Features:
 * - Vault setup/unlock/lock flow.
 * - State refresh.
 * - Playbook, inventory, and secret forms.
 * - Dynamic variable collection and live console attachment.
 * - Multi-channel notifications for scheduled runs.
 *
 * Dependencies: apiGet, apiPost, escapeHtml, showToast, setupGlobalModalClosing, ace, moment, getUserIcon
 */

const AUTOMATOR_CONFIG = {
    SYNC_INTERVAL_MS: 15000,
    DEBOUNCE_MS: 300,
    EXPANDED_CATEGORIES_KEY: 'automator.expandedCategories.v1',
    WS_MAX_RETRIES: 10
};

let STATE = {
    playbooks: [],
    history: [],
    secrets: [],
    inventories: [],
    admins: [],
    categories: [],
    active_runs: 0,
    max_concurrent_runs: 10,
    setup_required: 0
};

let ws = null;
let wsRetries = 0;
let currentConsoleHistoryId = null;
let currentConsoleTerminal = false;
let historyPage = 1;
let historyPlaybookId = null;
let historyPlaybookName = '';
let ACE_EDITORS = {};
let CONSOLE_EVENTS = null;

document.addEventListener('DOMContentLoaded', () => {
    bindAutomatorEvents();
    initAceEditors();
    checkVaultStatus();
    setInterval(() => refreshState(false), AUTOMATOR_CONFIG.SYNC_INTERVAL_MS);
});

/**
 * Binds form controls and keyboard shortcuts.
 *
 * @returns {void}
 */
function bindAutomatorEvents() {
    const filterIds = ['filterSearch', 'filterCategory', 'filterInventory', 'filterStatus'];
    filterIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const eventName = el.tagName === 'SELECT' ? 'change' : 'input';
        let timer;
        el.addEventListener(eventName, () => {
            clearTimeout(timer);
            timer = setTimeout(() => refreshState(true), AUTOMATOR_CONFIG.DEBOUNCE_MS);
        });
    });

    document.getElementById('resetFilters')?.addEventListener('click', () => {
        filterIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        refreshState(true);
    });

    document.getElementById('vaultForm')?.addEventListener('submit', submitVault);
    document.getElementById('playbookForm')?.addEventListener('submit', savePlaybook);
    document.getElementById('inventoryForm')?.addEventListener('submit', saveInventory);
    document.getElementById('secretForm')?.addEventListener('submit', saveSecret);
    document.getElementById('runForm')?.addEventListener('submit', startRun);
    document.getElementById('playbookScheduleType')?.addEventListener('change', renderScheduleFields);
    document.addEventListener('click', handleAutomatorAction);

    document.addEventListener('keydown', (event) => {
        if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
        const playbookOpen = document.getElementById('playbookModal')?.classList.contains('show');
        const inventoryOpen = document.getElementById('inventoryModal')?.classList.contains('show');
        if (!playbookOpen && !inventoryOpen) return;
        event.preventDefault();
        if (playbookOpen) document.getElementById('playbookForm')?.requestSubmit();
        if (inventoryOpen) document.getElementById('inventoryForm')?.requestSubmit();
    });

    // Automator modals keep form, console, and management state until an explicit save or close control is used.
    setupGlobalModalClosing(['modal-overlay'], []);
}

/**
 * Dispatches button actions from static and rendered Automator markup.
 *
 * @param {MouseEvent} event - Browser click event.
 * @returns {void}
 */
function handleAutomatorAction(event) {
    const trigger = event.target.closest('[data-automator-action]');
    if (!trigger) return;
    const action = trigger.dataset.automatorAction;
    const id = Number(trigger.dataset.id || 0);
    const mode = trigger.dataset.mode || 'run';
    if (action === 'open-playbook') openPlaybookModal(id || null);
    else if (action === 'open-inventory') openInventoryModal(id || null);
    else if (action === 'open-inventory-manage') openInventoryManageModal();
    else if (action === 'open-secret') openSecretModal();
    else if (action === 'new-secret') resetSecretForm();
    else if (action === 'edit-secret') editSecret(id);
    else if (action === 'delete-secret') deleteSecret(id || Number(document.getElementById('secretId')?.value || 0));
    else if (action === 'lock-vault') lockVault();
    else if (action === 'global-abort') globalAbort();
    else if (action === 'load-history') loadHistoryPage();
    else if (action === 'view-task-history') viewTaskHistory(id);
    else if (action === 'clear-task-history') clearTaskHistory();
    else if (action === 'toggle-category') toggleCategory(trigger.dataset.category || '');
    else if (action === 'close-playbook') closePlaybookModal();
    else if (action === 'open-ai-report') openAiReportModal();
    else if (action === 'generate-ai-report') generateAiReport();
    else if (action === 'close-ai-report') hideModal('aiReportModal');
    else if (action === 'view-ai-history') viewAiHistory(id);
    else if (action === 'open-secret-help') showModal('secretHelpModal');
    else if (action === 'close-secret-help') hideModal('secretHelpModal');
    else if (action === 'close-inventory') closeInventoryModal();
    else if (action === 'close-inventory-manage') closeInventoryManageModal();
    else if (action === 'close-secret') closeSecretModal();
    else if (action === 'close-run') closeRunModal();
    else if (action === 'close-console') closeConsoleModal();
    else if (action === 'abort-console') abortCurrentConsole();
    else if (action === 'run-playbook') openRunModal(id, mode);
    else if (action === 'edit-playbook') openPlaybookModal(id);
    else if (action === 'edit-inventory') openInventoryModal(id);
    else if (action === 'delete-playbook') deletePlaybook(id);
    else if (action === 'delete-inventory') deleteInventory(id);
    else if (action === 'delete-history') deleteHistory(id);
    else if (action === 'open-console') openConsole(id);
    else if (action === 'show-console-log') setConsoleView('log');
    else if (action === 'show-console-report') setConsoleView('report');
    else if (action === 'abort-run') abortRun(id);
    else if (action === 'add-secret-row') addSecretRow();
    else if (action === 'remove-secret-row') trigger.closest('.secret-row')?.remove();
    else if (action === 'add-notif-row') addNotifRow();
    else if (action === 'remove-notif-row') trigger.closest('.notif-row')?.remove();
    else if (action === 'toggle-notif-channel') trigger.classList.toggle('active');
}

/**
 * Initializes local Ace YAML editors and keeps hidden textarea values synced.
 *
 * @returns {void}
 */
function initAceEditors() {
    if (!window.ace) return;
    destroyAceEditors();
    ace.config.set('basePath', '/js/vendor/ace');
    [
        { sourceId: 'playbookContent', editorId: 'playbookContentAce' },
        { sourceId: 'inventoryHosts', editorId: 'inventoryHostsAce' }
    ].forEach(({ sourceId, editorId }) => {
        const source = document.getElementById(sourceId);
        const target = document.getElementById(editorId);
        if (!source || !target) return;
        const editor = ace.edit(editorId);
        editor.setTheme('ace/theme/tomorrow_night_blue');
        editor.session.setMode('ace/mode/yaml');
        editor.setOptions({
            fontSize: '13px',
            showPrintMargin: false,
            useWorker: false,
            tabSize: 2,
            useSoftTabs: true
        });
        editor.session.setValue(source.value || '');
        editor.session.on('change', () => {
            source.value = editor.session.getValue();
        });
        ACE_EDITORS[sourceId] = editor;
    });
}

/**
 * Destroys existing Ace editor instances to prevent memory leaks.
 *
 * @returns {void}
 */
function destroyAceEditors() {
    Object.keys(ACE_EDITORS).forEach(key => {
        if (ACE_EDITORS[key]) {
            ACE_EDITORS[key].destroy();
            ACE_EDITORS[key].container.remove();
        }
    });
    ACE_EDITORS = {};
}

/**
 * Resizes visible Ace editors after modal display changes.
 *
 * @returns {void}
 */
function resizeAceEditors() {
    Object.values(ACE_EDITORS).forEach(editor => {
        editor.resize();
        editor.renderer.updateFull();
    });
}

/**
 * Reads current vault state and enters setup, unlock, or app mode.
 *
 * @async
 * @returns {Promise<void>}
 */
async function checkVaultStatus() {
    const data = await apiGet('/admin/automator/api/status', 5000);
    if (!data || !data.success) return;
    STATE.setup_required = data.setup_required ? 1 : 0;
    if (data.unlocked) {
        showAutomatorApp();
        await refreshState(true);
    } else {
        showVaultGate(STATE.setup_required);
    }
}

/**
 * Submits the vault setup or unlock form.
 *
 * @async
 * @param {SubmitEvent} event - Form submit event.
 * @returns {Promise<void>}
 */
async function submitVault(event) {
    event.preventDefault();
    const password = document.getElementById('vaultPassword')?.value || '';
    const endpoint = STATE.setup_required ? '/admin/automator/api/vault/setup' : '/admin/automator/api/vault/unlock';
    const result = await apiPost(endpoint, { password }, 10000);
    if (!result) return;
    document.getElementById('vaultPassword').value = '';
    showAutomatorApp();
    await refreshState(true);
}

/**
 * Locks the module vault.
 *
 * @async
 * @returns {Promise<void>}
 */
async function lockVault() {
    const result = await apiPost('/admin/automator/api/vault/lock', {});
    if (!result) return;
    if (ws) ws.close();
    showVaultGate(false);
}

/**
 * Synchronizes the full module state.
 *
 * @async
 * @param {boolean} force - Bypass focus/modal sync guards.
 * @returns {Promise<void>}
 */
async function refreshState(force = false) {
    if (!force && shouldInhibitSync()) return;
    const data = await apiGet(`/admin/automator/api/state?${new URLSearchParams(getActiveFilters()).toString()}`, 6000);
    if (!data) return;
    if (data.locked) {
        showVaultGate(false);
        return;
    }
    if (!data.success) return;
    STATE = {
        ...STATE,
        playbooks: data.playbooks || [],
        history: historyPlaybookId ? STATE.history : (data.history || []),
        secrets: data.secrets || [],
        inventories: data.inventories || [],
        admins: data.admins || [],
        categories: data.categories || [],
        active_runs: data.active_runs || 0,
        max_concurrent_runs: data.max_concurrent_runs || 10,
        setup_required: data.setup_required || 0
    };
    renderAll();
    const running = STATE.history.find(h => h.status === 'running');
    if (running && !currentConsoleHistoryId) connectWS(running.id);
}

/**
 * Determines whether background sync should pause.
 *
 * @returns {boolean} True when user interaction should not be interrupted.
 */
function shouldInhibitSync() {
    const modalOpen = document.querySelector('.modal-overlay.show, .delete-modal-overlay.show, #inventoryManageModal.show');
    const focused = document.activeElement;
    const editing = focused && ['INPUT', 'TEXTAREA', 'SELECT'].includes(focused.tagName);
    const aceFocused = Object.values(ACE_EDITORS).some(editor => editor.isFocused());
    return Boolean(modalOpen || editing || aceFocused);
}

/**
 * Gets active filter values.
 *
 * @returns {Object} Filter query values.
 */
function getActiveFilters() {
    return {
        search: document.getElementById('filterSearch')?.value || '',
        category: document.getElementById('filterCategory')?.value || '',
        inventory: document.getElementById('filterInventory')?.value || '',
        status: document.getElementById('filterStatus')?.value || ''
    };
}

/**
 * Renders all state-driven surfaces.
 *
 * @returns {void}
 */
function renderAll() {
    renderCounters();
    renderFilters();
    renderPlaybooks();
    renderInventories();
    renderSecrets();
    renderHistory();
    populateFormSelects();
}

/**
 * Renders status counters.
 *
 * @returns {void}
 */
function renderCounters() {
    setText('activeRunsCount', `${STATE.active_runs} / ${STATE.max_concurrent_runs}`);
    setText('playbookCount', STATE.playbooks.length);
}

/**
 * Renders filter select options while preserving active values.
 *
 * @returns {void}
 */
function renderFilters() {
    fillSelect('filterCategory', [{ value: '', label: 'All Categories' }, ...STATE.categories.map(c => ({ value: c, label: c }))]);
    fillSelect('filterInventory', [
        { value: '', label: 'All Inventories' },
        ...STATE.inventories.map(i => ({ value: String(i.id), label: i.name }))
    ]);
}

/**
 * Renders categorized playbook ledger using Pattern A (Table-based).
 *
 * @returns {void}
 */
function renderPlaybooks() {
    const ledger = document.getElementById('playbookLedger');
    if (!ledger) return;
    if (!STATE.playbooks.length) {
        ledger.innerHTML = `<div class="automator-empty">No playbooks match the current filters.</div>`;
        return;
    }

    const groups = STATE.playbooks.reduce((acc, item) => {
        const category = item.category || 'General';
        if (!acc[category]) acc[category] = [];
        acc[category].push(item);
        return acc;
    }, {});

    ledger.innerHTML = Object.keys(groups).sort().map(category => {
        const collapsed = isCategoryCollapsed(category);
        return `
        <section class="playbook-category${collapsed ? ' is-collapsed' : ''}">
            <header class="category-header" data-automator-action="toggle-category" data-category="${automatorEscapeAttr(category)}">
                <span>${collapsed ? '▸' : '▾'} ${escapeHtml(category)}</span>
                <span>${groups[category].length}</span>
            </header>
            <div class="table-responsive">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Playbook</th>
                            <th>Configuration</th>
                            <th class="actions-cell">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${groups[category].map(renderPlaybookRow).join('')}
                    </tbody>
                </table>
            </div>
        </section>
    `;
    }).join('');
}

/**
 * Renders one playbook table row.
 *
 * @param {Object} p - Playbook row.
 * @returns {string} HTML.
 */
function renderPlaybookRow(p) {
    return `
        <tr>
            <td class="title-cell" data-label="Playbook">
                <div class="playbook-main">
                    <h3>${escapeHtml(p.name)}</h3>
                    <p>${escapeHtml(p.description || 'No description')}</p>
                </div>
            </td>
            <td class="config-cell" data-label="Configuration">
                <div class="playbook-meta">
                    <span>Inv: ${escapeHtml(p.inventory_name || 'None')}</span>
                    ${scheduleLabel(p) ? `<span>Sch: ${escapeHtml(scheduleLabel(p))}</span>` : ''}
                    ${p.secrets?.length ? `<span>Secrets: ${escapeHtml(p.secrets.map(s => s.alias).join(', '))}</span>` : ''}
                    ${p.next_run ? `<span>Next: ${formatDateTime(p.next_run)}</span>` : ''}
                    ${lastRunSummary(p)}
                    ${p.tags ? `<span>Tags: ${escapeHtml(p.tags)}</span>` : ''}
                    ${p.notifications?.length ? '<span title="Notifications active">📢</span>' : ''}
                </div>
            </td>
            <td class="actions-cell" data-label="Actions">
                <div class="playbook-actions">
                    <button type="button" class="btn-icon-view" data-automator-action="run-playbook" data-id="${p.id}" data-mode="run" title="Run Playbook">▶️</button>
                    <button type="button" class="btn-icon-ai" data-automator-action="run-playbook" data-id="${p.id}" data-mode="check" title="Dry Run (Check)">🔍</button>
                    <button type="button" class="btn-icon-copy" data-automator-action="view-task-history" data-id="${p.id}" title="View History">📜</button>
                    <button type="button" class="btn-icon-edit" data-automator-action="edit-playbook" data-id="${p.id}" title="Edit Playbook">✏️</button>
                    <button type="button" class="btn-icon-delete" data-automator-action="delete-playbook" data-id="${p.id}" title="Delete Playbook">🗑️</button>
                </div>
            </td>
        </tr>
    `;
}

/**
 * Builds a clickable last-run summary for a playbook.
 *
 * @param {Object} playbook - Playbook row.
 * @returns {string} HTML.
 */
function lastRunSummary(playbook) {
    if (!playbook.last_history_id) return '<span>Never</span>';
    const status = playbook.last_status || 'unknown';
    const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
    return `
        <button type="button" class="playbook-meta-action" data-automator-action="open-console" data-id="${playbook.last_history_id}" title="Open last run log">
            ${statusIcon(status)} ${escapeHtml(statusLabel)} ${formatDateTime(playbook.last_started_at)}
        </button>
    `;
}

/**
 * Checks whether mobile category collapse behavior should apply.
 *
 * @returns {boolean} True on mobile viewports.
 */
function isMobileAutomatorView() {
    return window.matchMedia('(max-width: 768px)').matches;
}

/**
 * Reads persisted mobile expanded categories.
 *
 * @returns {Set<string>} Expanded category names.
 */
function getExpandedCategories() {
    try {
        const parsed = JSON.parse(localStorage.getItem(AUTOMATOR_CONFIG.EXPANDED_CATEGORIES_KEY) || '[]');
        return new Set(Array.isArray(parsed) ? parsed.filter(category => typeof category === 'string') : []);
    } catch (err) {
        return new Set();
    }
}

/**
 * Determines whether a category should be collapsed.
 *
 * @param {string} category - Category name.
 * @returns {boolean} True when collapsed.
 */
function isCategoryCollapsed(category) {
    if (!isMobileAutomatorView()) return false;
    return !getExpandedCategories().has(category);
}

/**
 * Toggles a mobile category and persists expanded categories.
 *
 * @param {string} category - Category name.
 * @returns {void}
 */
function toggleCategory(category) {
    if (!category || !isMobileAutomatorView()) return;
    const expanded = getExpandedCategories();
    if (expanded.has(category)) expanded.delete(category);
    else expanded.add(category);
    try {
        localStorage.setItem(AUTOMATOR_CONFIG.EXPANDED_CATEGORIES_KEY, JSON.stringify([...expanded]));
    } catch (err) { }
    renderPlaybooks();
}

/**
 * Builds a short schedule label for a playbook.
 *
 * @param {Object} playbook - Playbook row.
 * @returns {string} Schedule label or empty string.
 */
function scheduleLabel(playbook) {
    if (!playbook.schedule_id || !playbook.schedule_active) return '';
    if (playbook.schedule_type === 'daily') return `Daily ${String(playbook.daily_time || '00:00').slice(0, 5)}`;
    if (playbook.schedule_type === 'hourly') return `Every ${playbook.interval_hours || 1}h`;
    return '';
}

/**
 * Renders saved inventory records.
 *
 * @returns {void}
 */
function renderInventories() {
    const list = document.getElementById('inventoryList');
    if (!list) return;
    if (!STATE.inventories.length) {
        list.innerHTML = `<div class="automator-empty compact-empty">No inventories saved.</div>`;
        return;
    }
    list.innerHTML = STATE.inventories.map(inv => renderInventoryRow(inv)).join('');
}

/**
 * Renders one inventory management row.
 *
 * @param {Object} inv - Inventory row.
 * @returns {string} HTML.
 */
function renderInventoryRow(inv) {
    const hostCount = (inv.hosts || '')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && !line.startsWith('['))
        .length;
    return `
        <article class="inventory-tile">
            <div class="inventory-body">
                <div class="inventory-top">
                    <span class="inventory-category-tag">${escapeHtml(inv.category || 'General')}</span>
                    <strong>${escapeHtml(inv.name)}</strong>
                </div>
                <div class="inventory-sub">${hostCount} ${hostCount === 1 ? 'host' : 'hosts'}</div>
            </div>
            <div class="inventory-actions">
                <button type="button" class="btn-icon-edit" data-automator-action="edit-inventory" data-id="${inv.id}" title="Edit">✏️</button>
                <button type="button" class="btn-icon-delete" data-automator-action="delete-inventory" data-id="${inv.id}" title="Delete">🗑️</button>
            </div>
        </article>
    `;
}

/**
 * Renders recent run history.
 *
 * @returns {void}
 */
function renderHistory() {
    const list = document.getElementById('historyList');
    if (!list) return;
    setText('historyPanelTitle', historyPlaybookId ? `History: ${historyPlaybookName}` : 'History');
    document.getElementById('historyClearBtn')?.classList.toggle('hidden', !historyPlaybookId);
    if (!STATE.history.length) {
        list.innerHTML = `<div class="automator-empty compact-empty">${historyPlaybookId ? 'No runs for this playbook yet.' : 'No run history yet.'}</div>`;
        return;
    }
    list.innerHTML = STATE.history.map(h => {
        const userIcon = escapeHtml(window.getUserIcon(h.triggered_by_name?.toLowerCase()) || '👤');
        return `
        <article class="history-tile status-${escapeHtml(h.status)}">
            <div class="history-top">
                <strong>#${h.id} ${escapeHtml(h.playbook_name || 'Deleted Playbook')}</strong>
                <span>${statusIcon(h.status)} ${escapeHtml(h.status)}</span>
            </div>
            <div class="history-sub">${formatDateTime(h.started_at)} • ${escapeHtml(h.mode || 'run')} • ${userIcon} ${escapeHtml(h.triggered_by_name || 'system')}</div>
            <div class="history-actions">
                <button type="button" class="btn-icon-view" data-automator-action="open-console" data-id="${h.id}" title="View Log">👁️</button>
                ${h.playbook_id ? `<button type="button" class="btn-icon-copy" data-automator-action="run-playbook" data-id="${h.playbook_id}" data-mode="${escapeHtml(h.mode || 'run')}" title="Re-run">🔁</button>` : ''}
                ${h.status === 'running' ? `<button type="button" class="btn-icon-delete" data-automator-action="abort-run" data-id="${h.id}" title="Abort Run">🛑</button>` : `<button type="button" class="btn-icon-delete" data-automator-action="delete-history" data-id="${h.id}" title="Delete Log">🗑️</button>`}
            </div>
        </article>
    `;
    }).join('');
}

/**
 * Loads history for one playbook into the shared history panel.
 *
 * @param {number} id - Playbook ID.
 * @returns {void}
 */
async function viewTaskHistory(id) {
    const playbook = STATE.playbooks.find(row => Number(row.id) === Number(id));
    if (!playbook) return;
    historyPlaybookId = id;
    historyPlaybookName = playbook.name;
    historyPage = 1;
    await loadHistoryPage(true);
    document.querySelector('.history-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Restores the shared history panel to all playbooks.
 *
 * @returns {void}
 */
function clearTaskHistory() {
    historyPlaybookId = null;
    historyPlaybookName = '';
    historyPage = 1;
    refreshState(true);
}

/**
 * Populates modal select controls.
 *
 * @returns {void}
 */
function populateFormSelects() {
    fillSelect('playbookInventory', [
        { value: '', label: 'No inventory' },
        ...STATE.inventories.map(i => ({ value: String(i.id), label: i.name }))
    ]);
    fillSelect('playbookChain', [
        { value: '', label: 'No chain' },
        ...STATE.playbooks.map(p => ({ value: String(p.id), label: p.name }))
    ]);
}

/**
 * Opens playbook editor.
 *
 * @param {number|null} id - Existing playbook ID.
 * @returns {void}
 */
function openPlaybookModal(id = null) {
    const form = document.getElementById('playbookForm');
    form?.reset();
    const p = id ? STATE.playbooks.find(row => Number(row.id) === Number(id)) : null;
    setValue('playbookId', p?.id || '');
    setValue('playbookName', p?.name || '');
    setValue('playbookCategory', p?.category || 'General');
    setValue('playbookDescription', p?.description || '');
    setValue('playbookInventory', p?.inventory_id || '');
    setValue('playbookTags', p?.tags || '');
    setValue('playbookSkipTags', p?.skip_tags || '');
    setValue('playbookLimitHosts', p?.limit_hosts || '');
    setValue('playbookChain', p?.success_chain_id || '');
    setValue('playbookScheduleType', p?.schedule_type || 'none');
    setValue('playbookScheduleDailyTime', String(p?.daily_time || '00:00').slice(0, 5));
    setValue('playbookScheduleIntervalHours', p?.interval_hours || 1);
    setValue('playbookDynamicVars', JSON.stringify(p?.dynamic_vars || {}, null, 2));
    setValue('playbookContent', p?.content || document.getElementById('playbookContent')?.defaultValue || '');
    setText('playbookModalTitle', p ? 'Edit Playbook' : 'New Playbook');

    const notifContainer = document.getElementById('notifRowContainer');
    if (notifContainer) {
        notifContainer.innerHTML = '';
        const grouped = (p?.notifications || []).reduce((acc, n) => {
            const key = `${n.user_id}_${n.notify_on}`;
            if (!acc[key]) acc[key] = { user_id: n.user_id, notify_on: n.notify_on, channels: [] };
            acc[key].channels.push(n.channel);
            return acc;
        }, {});
        Object.values(grouped).forEach(g => addNotifRow(g));
    }
    const secretContainer = document.getElementById('secretRowContainer');
    if (secretContainer) {
        secretContainer.innerHTML = '';
        const secretRows = p?.secrets?.length ? p.secrets :
            (p?.playbook_secret_id ? [{ secret_id: p.playbook_secret_id, alias: 'default', usage_type: 'file' }] : []);
        secretRows.forEach(s => addSecretRow(s));
    }

    renderScheduleFields();
    showModal('playbookModal');
    resizeAceEditors();
}

/**
 * Shows schedule fields that match the selected schedule type.
 *
 * @returns {void}
 */
function renderScheduleFields() {
    const type = document.getElementById('playbookScheduleType')?.value || 'none';
    document.querySelectorAll('.schedule-daily-field').forEach(el => el.classList.toggle('hidden', type !== 'daily'));
    document.querySelectorAll('.schedule-hourly-field').forEach(el => el.classList.toggle('hidden', type !== 'hourly'));
}

/**
 * Closes playbook editor.
 *
 * @returns {void}
 */
function closePlaybookModal() {
    hideModal('playbookModal');
}

/**
 * Adds a playbook secret attachment row.
 *
 * @param {Object|null} data - Existing secret attachment.
 * @returns {void}
 */
function addSecretRow(data = null) {
    const container = document.getElementById('secretRowContainer');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'secret-row';
    const options = (STATE.secrets || []).map(s => {
        const selected = data && String(data.secret_id) === String(s.id) ? 'selected' : '';
        return `<option value="${s.id}" ${selected}>${escapeHtml(s.name)}</option>`;
    }).join('');
    row.innerHTML = `
        <select class="game-input secret-id">${options}</select>
        <input class="game-input secret-alias no-emoji" value="${automatorEscapeAttr(data?.alias || '')}" placeholder="alias e.g. api_key">
        <select class="game-input secret-usage no-emoji">
            <option value="file" ${data?.usage_type === 'file' ? 'selected' : ''}>File</option>
            <option value="env" ${data?.usage_type === 'env' ? 'selected' : ''}>Env Var</option>
            <option value="ssh_key" ${data?.usage_type === 'ssh_key' ? 'selected' : ''}>SSH Key</option>
            <option value="vault_password" ${data?.usage_type === 'vault_password' ? 'selected' : ''}>Vault Password</option>
        </select>
        <button type="button" class="btn-icon-delete" data-automator-action="remove-secret-row" title="Remove Secret">🗑️</button>
    `;
    container.appendChild(row);
}

/**
 * Adds a notification configuration row to the playbook modal.
 *
 * @param {Object|null} data - Existing notification data.
 * @returns {void}
 */
function addNotifRow(data = null) {
    const container = document.getElementById('notifRowContainer');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'notif-row';

    const admins = (STATE.admins || []).map(a => {
        const userIcon = escapeHtml(window.getUserIcon(a.username?.toLowerCase()) || '👤');
        return `<option value="${a.id}" ${data && String(data.user_id) === String(a.id) ? 'selected' : ''}>${userIcon} ${escapeHtml(a.username)}</option>`;
    }).join('');
    const channels = [
        { id: 'discord', label: 'Discord', icon: '💬' },
        { id: 'email', label: 'Email', icon: '📧' },
        { id: 'fcm', label: 'Push', icon: '📱' },
        { id: 'pushover', label: 'Push', icon: '🔔' },
        { id: 'gotify', label: 'Gotify', icon: '🚀' }
    ];

    const channelToggles = channels.map(c => `
        <div class="notif-channel-toggle ${data && data.channels && data.channels.includes(c.id) ? 'active' : ''}" 
             data-automator-action="toggle-notif-channel" 
             data-channel="${c.id}" 
             title="${c.label}">${c.icon}</div>
    `).join('');
    
    row.innerHTML = `
        <select class="game-input notif-user">${admins}</select>
        <div class="notif-channels">${channelToggles}</div>
        <select class="game-input notif-on">
            <option value="always" ${data && data.notify_on === 'always' ? 'selected' : ''}>Success & Fail</option>
            <option value="failure" ${data && data.notify_on === 'failure' ? 'selected' : ''}>Only Fail</option>
            <option value="success" ${data && data.notify_on === 'success' ? 'selected' : ''}>Only Success</option>
        </select>
        <button type="button" class="btn-icon-delete" data-automator-action="remove-notif-row" title="Remove Rule">🗑️</button>
    `;
    container.appendChild(row);
}

/**
 * Saves playbook form.
 *
 * @async
 * @param {SubmitEvent} event - Submit event.
 * @returns {Promise<void>}
 */
async function savePlaybook(event) {
    event.preventDefault();
    const form = event.target;
    try {
        const parsedVars = JSON.parse(document.getElementById('playbookDynamicVars')?.value || '{}');
        if (!parsedVars || Array.isArray(parsedVars) || typeof parsedVars !== 'object') {
            showToast('Dynamic vars must be a JSON object', 'error');
            return;
        }
    } catch (err) {
        showToast('Dynamic vars must be valid JSON', 'error');
        return;
    }

    const formData = new FormData(form);
    const secrets = [];
    const aliases = new Set();
    for (const row of document.querySelectorAll('.secret-row')) {
        const secret_id = row.querySelector('.secret-id')?.value;
        const alias = (row.querySelector('.secret-alias')?.value || '').trim();
        const usage_type = row.querySelector('.secret-usage')?.value || 'file';
        if (!secret_id && !alias) continue;
        if (!secret_id || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
            showToast('Secret aliases must start with a letter/underscore and contain only letters, numbers, and underscores.', 'error');
            return;
        }
        if (aliases.has(alias.toLowerCase())) {
            showToast('Secret aliases must be unique.', 'error');
            return;
        }
        aliases.add(alias.toLowerCase());
        secrets.push({ secret_id, alias, usage_type });
    }
    formData.append('secrets', JSON.stringify(secrets));

    const notifs = [];
    document.querySelectorAll('#notifRowContainer .notif-row').forEach(row => {
        const user_id = row.querySelector('.notif-user').value;
        const notify_on = row.querySelector('.notif-on').value;
        row.querySelectorAll('.notif-channel-toggle.active').forEach(toggle => {
            notifs.push({
                user_id: user_id,
                channel: toggle.dataset.channel,
                notify_on: notify_on,
                endpoint: ''
            });
        });
    });
    formData.append('notifications', JSON.stringify(notifs));

    const result = await apiPost('/admin/automator/api/playbook/save', formData, 15000);
    if (!result) return;
    closePlaybookModal();
    await refreshState(true);
}

/**
 * Opens inventory editor.
 *
 * @param {number|null} id - Inventory ID.
 * @returns {void}
 */
function openInventoryModal(id = null) {
    document.getElementById('inventoryForm')?.reset();
    const inv = id ? STATE.inventories.find(row => Number(row.id) === Number(id)) : null;
    setValue('inventoryId', inv?.id || '');
    setValue('inventoryName', inv?.name || '');
    setValue('inventoryCategory', inv?.category || 'General');
    setValue('inventorySshKeyPath', inv?.ssh_key_path || '');
    setValue('inventoryHosts', inv?.hosts || document.getElementById('inventoryHosts')?.defaultValue || '');
    showModal('inventoryModal');
    resizeAceEditors();
}

/**
 * Closes inventory editor.
 *
 * @returns {void}
 */
function closeInventoryModal() {
    hideModal('inventoryModal');
}

/**
 * Opens inventory management modal.
 *
 * @returns {void}
 */
function openInventoryManageModal() {
    renderInventories();
    showModal('inventoryManageModal');
}

/**
 * Closes inventory management modal.
 *
 * @returns {void}
 */
function closeInventoryManageModal() {
    hideModal('inventoryManageModal');
}

/**
 * Deletes an inventory record.
 *
 * @param {number} id - Inventory ID.
 * @returns {void}
 */
function deleteInventory(id) {
    const inv = STATE.inventories.find(row => Number(row.id) === Number(id));
    const label = inv ? escapeHtml(inv.name) : `#${id}`;
    showConfirmModal({
        title: 'Delete Inventory',
        message: `Permanently delete ${label}? Playbooks using it will be detached.`,
        confirmText: 'DELETE',
        danger: true,
        hideCancel: true,
        onConfirm: async () => {
            await apiPost(`/admin/automator/api/inventory/delete/${id}`, {});
            await refreshState(true);
        }
    });
}

/**
 * Saves inventory form.
 *
 * @async
 * @param {SubmitEvent} event - Submit event.
 * @returns {Promise<void>}
 */
async function saveInventory(event) {
    event.preventDefault();
    const result = await apiPost('/admin/automator/api/inventory/save', new FormData(event.target), 15000);
    if (!result) return;
    closeInventoryModal();
    await refreshState(true);
}

/**
 * Opens the secret manager.
 *
 * @returns {void}
 */
function openSecretModal() {
    renderSecrets();
    resetSecretForm();
    showModal('secretModal');
}

/**
 * Resets the secret edit form for a new secret.
 *
 * @returns {void}
 */
function resetSecretForm() {
    document.getElementById('secretForm')?.reset();
    setValue('secretId', '');
    setValue('secretCategory', 'General');
    document.getElementById('secretValue')?.setAttribute('placeholder', '');
    document.getElementById('secretDeleteBtn')?.classList.add('hidden');
}

/**
 * Closes the secret editor modal.
 *
 * @returns {void}
 */
function closeSecretModal() {
    hideModal('secretModal');
}

/**
 * Renders stored secrets in the secret manager.
 *
 * @returns {void}
 */
function renderSecrets() {
    const list = document.getElementById('secretManageList');
    if (!list) return;
    if (!STATE.secrets.length) {
        list.innerHTML = `<div class="automator-empty compact-empty">No secrets saved.</div>`;
        return;
    }
    list.innerHTML = STATE.secrets.map(secret => `
        <article class="inventory-tile">
            <div class="inventory-body">
                <div class="inventory-top">
                    <span class="inventory-category-tag">${escapeHtml(secret.category || 'General')}</span>
                    <strong>${escapeHtml(secret.name)}</strong>
                </div>
                <div class="inventory-sub">Write-only value • created ${formatDateTime(secret.created_at)}</div>
            </div>
            <div class="inventory-actions">
                <button type="button" class="btn-icon-edit" data-automator-action="edit-secret" data-id="${secret.id}" title="Edit">✏️</button>
                <button type="button" class="btn-icon-delete" data-automator-action="delete-secret" data-id="${secret.id}" title="Delete">🗑️</button>
            </div>
        </article>
    `).join('');
}

/**
 * Loads an existing secret's editable metadata into the form.
 *
 * @param {number} id - Secret ID.
 * @returns {void}
 */
function editSecret(id) {
    const secret = STATE.secrets.find(row => Number(row.id) === Number(id));
    if (!secret) return;
    setValue('secretId', secret.id);
    setValue('secretName', secret.name || '');
    setValue('secretCategory', secret.category || 'General');
    setValue('secretValue', '');
    document.getElementById('secretValue')?.setAttribute('placeholder', 'Enter a new value to replace the existing secret');
    document.getElementById('secretDeleteBtn')?.classList.remove('hidden');
}

/**
 * Deletes a stored secret.
 *
 * @param {number} id - Secret ID.
 * @returns {void}
 */
function deleteSecret(id) {
    if (!id) return;
    const secret = STATE.secrets.find(row => Number(row.id) === Number(id));
    const label = secret ? escapeHtml(secret.name) : `#${id}`;
    showConfirmModal({
        title: 'Delete Secret',
        message: `Delete ${label}? Playbook attachments using it will be removed.`,
        confirmText: 'DELETE',
        danger: true,
        hideCancel: true,
        onConfirm: async () => {
            await apiPost(`/admin/automator/api/secret/delete/${id}`, {});
            resetSecretForm();
            await refreshState(true);
            renderSecrets();
        }
    });
}

/**
 * Saves a write-only secret.
 *
 * @async
 * @param {SubmitEvent} event - Submit event.
 * @returns {Promise<void>}
 */
async function saveSecret(event) {
    event.preventDefault();
    const result = await apiPost('/admin/automator/api/secret/save', new FormData(event.target), 15000);
    if (!result) return;
    await refreshState(true);
    renderSecrets();
    resetSecretForm();
}

/**
 * Deletes a playbook through the global confirm modal.
 *
 * @param {number} id - Playbook ID.
 * @returns {void}
 */
function deletePlaybook(id) {
    const p = STATE.playbooks.find(row => Number(row.id) === Number(id));
    const label = p ? escapeHtml(p.name) : `#${id}`;
    showConfirmModal({
        title: 'Delete Playbook',
        message: `Soft-delete ${label}?`,
        confirmText: 'DELETE',
        danger: true,
        hideCancel: true,
        onConfirm: async () => {
            await apiPost(`/admin/automator/api/playbook/delete/${id}`, {});
            await refreshState(true);
        }
    });
}

/**
 * Deletes one finished history log through the global confirm modal.
 *
 * @param {number} id - History record ID.
 * @returns {void}
 */
function deleteHistory(id) {
    const h = STATE.history.find(row => Number(row.id) === Number(id));
    const playbookLabel = h?.playbook_name ? ` for ${escapeHtml(h.playbook_name)}` : '';
    showConfirmModal({
        title: 'Delete Log',
        message: `Permanently delete log #${id}${playbookLabel}?`,
        confirmText: 'DELETE',
        danger: true,
        hideCancel: true,
        onConfirm: async () => {
            const result = await apiPost(`/admin/automator/api/history/delete/${id}`, {});
            if (!result) return;
            if (Number(currentConsoleHistoryId) === Number(id)) closeConsoleModal();
            if (historyPlaybookId) await loadHistoryPage(true);
            else await refreshState(true);
        }
    });
}

/**
 * Opens run variable form.
 *
 * @param {number} id - Playbook ID.
 * @param {string} mode - run or check.
 * @returns {void}
 */
function openRunModal(id, mode = 'run') {
    const p = STATE.playbooks.find(row => Number(row.id) === Number(id));
    if (!p) return;
    setValue('runPlaybookId', id);
    setValue('runMode', mode);
    setText('runModalTitle', `${mode === 'check' ? 'Dry Run' : 'Run'}: ${p.name}`);
    document.getElementById('runVarsContainer').innerHTML = renderVariableForm(p.dynamic_vars || {});
    showModal('runModal');
}

/**
 * Closes run variable form.
 *
 * @returns {void}
 */
function closeRunModal() {
    hideModal('runModal');
}

/**
 * Starts a playbook run.
 *
 * @async
 * @param {SubmitEvent} event - Submit event.
 * @returns {Promise<void>}
 */
async function startRun(event) {
    event.preventDefault();
    const form = event.target;
    const vars = {};
    form.querySelectorAll('[data-var-name]').forEach(el => {
        vars[el.dataset.varName] = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value;
    });
    const playbook = STATE.playbooks.find(p => Number(p.id) === Number(form.playbook_id.value));
    const validation = validateVars(vars, playbook?.dynamic_vars || {});
    if (validation) {
        showToast(validation, 'error');
        return;
    }
    const result = await apiPost('/admin/automator/api/run', {
        playbook_id: form.playbook_id.value,
        mode: form.mode.value,
        vars: JSON.stringify(vars)
    }, 10000);
    if (!result) return;
    closeRunModal();
    openConsole(result.history_id);
    await refreshState(true);
}

/**
 * Renders dynamic variable fields.
 *
 * @param {Object} schema - Variable schema.
 * @returns {string} HTML.
 */
function renderVariableForm(schema) {
    const entries = Object.entries(schema || {});
    if (!entries.length) return `<div class="automator-empty compact-empty">No variables required.</div>`;
    return entries.map(([key, cfg]) => {
        const safeKey = escapeHtml(key);
        if (cfg.type === 'boolean') {
            return `<label class="var-row"><span>${safeKey}</span><input type="checkbox" data-var-name="${safeKey}" ${cfg.default ? 'checked' : ''}></label>`;
        }
        if (cfg.type === 'enum') {
            const opts = (cfg.values || []).map(v => `<option value="${automatorEscapeAttr(v)}" ${v === cfg.default ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('');
            return `<label class="var-row"><span>${safeKey}</span><select class="game-input" data-var-name="${safeKey}">${opts}</select></label>`;
        }
        const type = cfg.type === 'number' ? 'number' : 'text';
        const placeholder = cfg.type === 'secret' ? '(secret)' : (cfg.default ?? '');
        return `<label class="var-row"><span>${safeKey}</span><input class="game-input" type="${type}" data-var-name="${safeKey}" value="${automatorEscapeAttr(cfg.default ?? '')}" placeholder="${automatorEscapeAttr(placeholder)}" ${cfg.required ? 'required' : ''}></label>`;
    }).join('');
}

/**
 * Validates run variables against schema constraints.
 *
 * @param {Object} vars - Submitted variables.
 * @param {Object} schema - Variable schema.
 * @returns {string|null} Error or null.
 */
function validateVars(vars, schema) {
    for (const [key, cfg] of Object.entries(schema || {})) {
        const val = vars[key];
        if (cfg.required && (val === undefined || val === '')) return `${key} is required`;
        if (cfg.type === 'number') {
            const num = Number(val);
            if (Number.isNaN(num)) return `${key} must be a number`;
            if (cfg.min !== undefined && num < cfg.min) return `${key} must be at least ${cfg.min}`;
            if (cfg.max !== undefined && num > cfg.max) return `${key} must be at most ${cfg.max}`;
        }
    }
    return null;
}

/**
 * Loads a history page.
 *
 * @param {boolean} reset - Replace current history rows instead of appending.
 * @async
 * @returns {Promise<void>}
 */
async function loadHistoryPage(reset = false) {
    const nextPage = reset ? 1 : historyPage + 1;
    const params = new URLSearchParams({ page: String(nextPage), per_page: '50' });
    if (historyPlaybookId) params.set('playbook', String(historyPlaybookId));
    const data = await apiGet(`/admin/automator/api/history?${params.toString()}`, 6000);
    if (!data || !data.success) return;
    historyPage = nextPage;
    STATE.history = reset ? (data.history || []) : [...STATE.history, ...(data.history || [])];
    renderHistory();
}

/**
 * Opens the live output console for a run.
 *
 * @param {number} historyId - Run history ID.
 * @returns {void}
 */
function openConsole(historyId) {
    currentConsoleHistoryId = historyId;
    resetConsoleEvents();
    let h = STATE.history.find(row => Number(row.id) === Number(historyId));
    if (!h) {
        const playbook = STATE.playbooks.find(row => Number(row.last_history_id) === Number(historyId));
        if (playbook) h = { id: historyId, playbook_name: playbook.name, status: playbook.last_status, output: '' };
    }
    currentConsoleTerminal = isTerminalRunStatus(h?.status || 'unknown');
    setText('consoleTitle', h ? `#${h.id} ${h.playbook_name || 'Run'}` : `#${historyId}`);
    updateConsoleStatusUI(h?.status || 'unknown');
    setText('consoleOutput', filterConsoleRawOutput(h?.output || ''));
    replayConsoleEvents(h?.output || '');
    const reportView = document.getElementById('consoleReportView');
    if (reportView) { reportView.innerHTML = ''; delete reportView.dataset.loaded; }
    setConsoleView(currentConsoleTerminal ? 'report' : 'status');
    document.getElementById('consoleAbortBtn')?.classList.toggle('hidden', h?.status !== 'running');
    showModal('consoleModal');
    connectWS(historyId);
}

/**
 * Resets structured console event state.
 *
 * @returns {void}
 */
function resetConsoleEvents() {
    CONSOLE_EVENTS = {
        currentPlay: 'Waiting for events...',
        hosts: {},
        counts: { ok: 0, changed: 0, failed: 0, unreachable: 0, skipped: 0 }
    };
    renderConsoleStatusView();
}

/**
 * Switches between structured status and raw log console views.
 *
 * @param {string} view - "status" or "log".
 * @returns {void}
 */
function setConsoleView(view) {
    if (currentConsoleTerminal && view === 'status') view = 'report';
    const showStatus = view === 'status' && !currentConsoleTerminal;
    const showLog = view === 'log';
    const showReport = view === 'report';
    document.getElementById('consoleStatusView')?.classList.toggle('hidden', !showStatus);
    document.getElementById('consoleOutput')?.classList.toggle('hidden', !showLog);
    document.getElementById('consoleReportView')?.classList.toggle('hidden', !showReport);
    const viewToggleBtn = document.getElementById('consoleViewToggleBtn');
    if (viewToggleBtn) {
        viewToggleBtn.classList.toggle('active', showLog);
        viewToggleBtn.dataset.automatorAction = showLog ? 'show-console-report' : 'show-console-log';
        viewToggleBtn.textContent = showLog ? 'Report' : 'Raw Log';
    }
    if (showReport) showConsoleReport();
}

/**
 * Replays structured Automator events from existing raw output.
 *
 * @param {string} output - Historical console text.
 * @returns {void}
 */
function replayConsoleEvents(output) {
    if (!output) return;
    output.split('\n').forEach(line => processConsoleEventLine(line));
}

/**
 * Removes structured event lines from human-facing raw console output.
 *
 * @param {string} output - Mixed console output.
 * @returns {string} Human-readable console output.
 */
function filterConsoleRawOutput(output) {
    return String(output || '').replace(/^.*@@AUTOMATOR_EVENT@@.*(?:\n|$)/gm, '');
}

/**
 * Determines whether a backend run status is terminal.
 *
 * @param {string} status - Backend run status.
 * @returns {boolean} True once no live status panel is needed.
 */
function isTerminalRunStatus(status) {
    return ['success', 'failed', 'aborted', 'timed_out'].includes(status);
}

/**
 * Processes one raw line for structured Automator event payloads.
 *
 * @param {string} line - Console output line.
 * @returns {boolean} True when the line was a structured event.
 */
function processConsoleEventLine(line) {
    const prefix = '@@AUTOMATOR_EVENT@@';
    const idx = line.indexOf(prefix);
    if (idx < 0) return false;
    try {
        updateConsoleEventState(JSON.parse(line.slice(idx + prefix.length)));
        return true;
    } catch (err) {
        return false;
    }
}

/**
 * Applies one structured Ansible event to the console status view.
 *
 * @param {Object} event - Callback event payload.
 * @returns {void}
 */
function updateConsoleEventState(event) {
    if (!event || typeof event !== 'object') return;
    if (!CONSOLE_EVENTS) resetConsoleEvents();
    const eventHosts = Array.isArray(event.hosts) ? event.hosts : [];
    if (event.type === 'play_start') {
        CONSOLE_EVENTS.currentPlay = event.play || 'Play';
        eventHosts.forEach(host => {
            if (!CONSOLE_EVENTS.hosts[host]) CONSOLE_EVENTS.hosts[host] = { status: 'pending', task: 'Queued' };
        });
    } else if (event.type === 'task_start') {
        CONSOLE_EVENTS.currentPlay = event.play || CONSOLE_EVENTS.currentPlay;
    } else if (event.type === 'host_task_start') {
        const host = event.host || 'localhost';
        CONSOLE_EVENTS.hosts[host] = {
            status: 'running',
            task: event.task || 'Task',
            changed: false,
            ignored: false
        };
    } else if (event.type === 'task_result') {
        const host = event.host || 'localhost';
        const status = normalizeConsoleStatus(event.status, 'ok');
        CONSOLE_EVENTS.hosts[host] = {
            status,
            task: event.task || 'Task',
            changed: Boolean(event.changed),
            ignored: Boolean(event.ignore_errors)
        };
        if (status === 'ok' && event.changed) CONSOLE_EVENTS.counts.changed += 1;
        else if (CONSOLE_EVENTS.counts[status] !== undefined) CONSOLE_EVENTS.counts[status] += 1;
    } else if (event.type === 'run_complete') {
        (eventHosts.length ? eventHosts : Object.keys(CONSOLE_EVENTS.hosts)).forEach(host => {
            const summary = event.summary?.[host] || {};
            const failed = Number(summary.failures || 0) > 0 || Number(summary.unreachable || 0) > 0;
            CONSOLE_EVENTS.hosts[host] = {
                ...(CONSOLE_EVENTS.hosts[host] || {}),
                status: failed ? 'failed' : 'complete',
                task: failed ? 'Finished with issues' : 'Complete'
            };
        });
    }
    renderConsoleStatusView();
}

/**
 * Renders structured console status state.
 *
 * @returns {void}
 */
function renderConsoleStatusView() {
    if (!CONSOLE_EVENTS) return;
    setText('consoleCurrentPlay', CONSOLE_EVENTS.currentPlay);
    const hostRows = Object.values(CONSOLE_EVENTS.hosts);
    const activeCount = hostRows.filter(row => ['pending', 'running'].includes(normalizeConsoleStatus(row.status, 'pending'))).length;
    setText('consoleHostsActive', `${activeCount} / ${hostRows.length}`);
    const counts = document.getElementById('consoleCounts');
    if (counts) {
        counts.innerHTML = Object.entries(CONSOLE_EVENTS.counts)
            .filter(([, count]) => count > 0)
            .map(([key, count]) => `<span class="console-count console-count-${escapeHtml(key)}">${escapeHtml(key)}: ${count}</span>`)
            .join('') || '<span class="console-count">Waiting...</span>';
    }
    const list = document.getElementById('consoleHostList');
    if (!list) return;
    const hosts = Object.keys(CONSOLE_EVENTS.hosts).sort();
    list.innerHTML = hosts.length ? hosts.map(host => {
        const row = CONSOLE_EVENTS.hosts[host];
        const status = normalizeConsoleStatus(row.status, 'pending');
        return `
            <article class="console-host-row status-${escapeHtml(status)}">
                <strong><span class="console-host-icon" aria-hidden="true">${escapeHtml(statusIconForHost(status, row.changed))}</span>${escapeHtml(host)}</strong>
                <span>${escapeHtml(statusLabel(status, row.changed))}</span>
                <small>${escapeHtml(row.task || 'Queued')}</small>
            </article>
        `;
    }).join('') : '<div class="automator-empty compact-empty">Waiting for Ansible events...</div>';
}

/**
 * Maps host run state to a quick visual marker.
 *
 * @param {string} status - Host status.
 * @param {boolean} changed - Whether the last task changed.
 * @returns {string} Status icon.
 */
function statusIconForHost(status, changed) {
    if (status === 'pending') return '⚪';
    if (status === 'running') return '🔵';
    if (status === 'failed' || status === 'unreachable') return '🔴';
    if (status === 'skipped') return '⚪';
    if (status === 'complete' || status === 'ok' || changed) return '🟢';
    return '⚪';
}

/**
 * Builds compact host status label.
 *
 * @param {string} status - Result status.
 * @param {boolean} changed - Whether result changed.
 * @returns {string} Label.
 */
function statusLabel(status, changed) {
    status = normalizeConsoleStatus(status, 'pending');
    if (status === 'complete') return 'Complete';
    if (status === 'ok' && changed) return 'Changed';
    if (status === 'skipped') return 'Not required';
    return status.charAt(0).toUpperCase() + status.slice(1);
}

function normalizeConsoleStatus(status, fallback = 'pending') {
    const normalized = String(status || fallback).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    return normalized || fallback;
}

/**
 * Updates the console modal status text and visual indicator.
 *
 * @param {string} status - Run status.
 * @returns {void}
 */
function updateConsoleStatusUI(status) {
    const statusEl = document.getElementById('consoleStatus');
    if (statusEl) {
        if (status === 'running') {
            statusEl.innerHTML = 'Running <span class="console-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span><span>.</span><span>.</span><span>.</span><span>.</span></span>';
        } else {
            statusEl.textContent = {
                success: 'Success 🎉',
                failed: 'Failed ⛔',
                aborted: 'Aborted 🛑',
                timed_out: 'Timed Out ⏱️'
            }[status] || status;
        }
    }
    const indicator = document.getElementById('consoleIndicator');
    if (!indicator) return;
    indicator.className = 'console-indicator';
    if (status === 'running') indicator.classList.add('is-running');
    else if (status === 'success') indicator.classList.add('is-success');
    else if (status === 'failed' || status === 'timed_out') indicator.classList.add('is-failed');
}

/**
 * Closes the live output console.
 *
 * @returns {void}
 */
function closeConsoleModal() {
    hideModal('consoleModal');
    closeAutomatorWebSocket();
    currentConsoleHistoryId = null;
    currentConsoleTerminal = false;
}

/**
 * Connects to a run WebSocket stream.
 *
 * @param {number} historyId - Run history ID.
 * @returns {void}
 */
function connectWS(historyId) {
    closeAutomatorWebSocket();
    ws = new WebSocket(`/admin/automator/ws/${historyId}`);
    const socket = ws;
    const consoleEl = document.getElementById('consoleOutput');
    ws.onmessage = (event) => {
        if (!consoleEl) return;
        const msg = event.data;
        let handledStatus = false;
        msg.split('\n').forEach(line => {
            const statusMatch = line.trim().match(/^###STATUS:(.+?)###$/);
            if (!statusMatch) return;
            handledStatus = true;
            const status = statusMatch[1];
            updateConsoleStatusUI(status);
            if (status !== 'running') {
                document.getElementById('consoleAbortBtn')?.classList.add('hidden');
                finalizeConsoleEvents(status);
            }
        });
        if (handledStatus) {
            const nonStatusOutput = msg
                .split('\n')
                .filter(line => !/^###STATUS:.+?###$/.test(line.trim()))
                .join('\n');
            if (!nonStatusOutput.trim()) return;
            nonStatusOutput.split('\n').forEach(line => processConsoleEventLine(line));
            consoleEl.textContent += filterConsoleRawOutput(nonStatusOutput);
            consoleEl.scrollTop = consoleEl.scrollHeight;
            return;
        }
        msg.split('\n').forEach(line => processConsoleEventLine(line));
        consoleEl.textContent += filterConsoleRawOutput(msg);
        consoleEl.scrollTop = consoleEl.scrollHeight;
    };
    ws.onclose = (event) => {
        if (socket !== ws) return;
        ws = null;
        if (event.code === 1008) {
            showVaultGate(false);
            return;
        }
        if (wsRetries >= AUTOMATOR_CONFIG.WS_MAX_RETRIES || currentConsoleHistoryId !== historyId) return;
        const delay = Math.min(1000 * 2 ** wsRetries, 30000);
        wsRetries += 1;
        setTimeout(() => {
            if (currentConsoleHistoryId === historyId) connectWS(historyId);
        }, delay);
    };
    ws.onopen = () => { wsRetries = 0; };
}

/**
 * Marks the structured status panel complete when the backend run is finished.
 *
 * @param {string} finalStatus - Backend run status.
 * @returns {void}
 */
function finalizeConsoleEvents(finalStatus) {
    if (!CONSOLE_EVENTS) return;
    currentConsoleTerminal = isTerminalRunStatus(finalStatus);
    Object.values(CONSOLE_EVENTS.hosts).forEach(row => {
        if (!['failed', 'unreachable', 'complete'].includes(row.status || 'pending')) {
            row.status = finalStatus === 'success' ? 'complete' : 'failed';
            row.task = finalStatus === 'success' ? 'Complete' : `Finished: ${finalStatus}`;
        }
    });
    renderConsoleStatusView();
    setConsoleView('report');
}

/**
 * Aborts the run currently attached to the console.
 *
 * @returns {void}
 */
function abortCurrentConsole() {
    if (currentConsoleHistoryId) abortRun(currentConsoleHistoryId);
}

/**
 * Confirms and aborts a run.
 *
 * @param {number} id - Run history ID.
 * @returns {void}
 */
function abortRun(id) {
    showConfirmModal({
        title: 'Abort Run',
        message: `Abort run #${id}? The process group will be terminated.`,
        confirmText: 'Abort',
        hideCancel: false,
        onConfirm: async () => {
            await apiPost(`/admin/automator/api/abort/${id}`, {});
            await refreshState(true);
        }
    });
}

/**
 * Confirms and aborts all active runs.
 *
 * @returns {void}
 */
function globalAbort() {
    showConfirmModal({
        title: 'Global Kill Switch',
        message: 'Abort every active Automator run?',
        confirmText: 'Abort All',
        hideCancel: false,
        onConfirm: async () => {
            await apiPost('/admin/automator/api/abort/all', {});
            await refreshState(true);
        }
    });
}

/**
 * Displays the vault setup or unlock screen.
 *
 * @param {boolean} setupRequired - Whether the vault has no master password.
 * @returns {void}
 */
function showVaultGate(setupRequired) {
    closeAutomatorWebSocket();
    currentConsoleHistoryId = null;
    currentConsoleTerminal = false;
    hideModal('consoleModal');
    STATE.setup_required = setupRequired ? 1 : 0;
    document.getElementById('vaultGate')?.classList.add('show');
    document.getElementById('automatorApp')?.classList.add('hidden');
    setLockedHeaderActionsVisible(false);
    setText('vaultTitle', setupRequired ? 'Vault Setup' : 'Vault Locked');
    setText('vaultMessage', setupRequired ? 'Create the Automator master password. Recovery requires a direct database reset.' : 'Enter the Automator master password to unlock.');
    setText('vaultSubmitBtn', setupRequired ? 'Initialize Vault' : 'Unlock');
}

/**
 * Displays the unlocked module interface.
 *
 * @returns {void}
 */
function showAutomatorApp() {
    document.getElementById('vaultGate')?.classList.remove('show');
    document.getElementById('automatorApp')?.classList.remove('hidden');
    setLockedHeaderActionsVisible(true);
}

/**
 * Toggles header actions that require an unlocked vault.
 *
 * @param {boolean} visible - Whether unlocked-only header actions should be visible.
 * @returns {void}
 */
function closeAutomatorWebSocket() {
    if (ws) {
        ws.onclose = null;
        ws.close();
        ws = null;
    }
    wsRetries = 0;
}

function setLockedHeaderActionsVisible(visible) {
    document.querySelectorAll('[data-automator-action="open-playbook"], [data-automator-action="open-inventory-manage"], [data-automator-action="open-secret"], [data-automator-action="lock-vault"]').forEach(action => {
        action.classList.toggle('hidden', !visible);
    });
}

/**
 * Shows a modal by ID.
 *
 * @param {string} id - Modal element ID.
 * @returns {void}
 */
function showModal(id) {
    document.getElementById(id)?.classList.add('show');
}

/**
 * Hides a modal by ID.
 *
 * @param {string} id - Modal element ID.
 * @returns {void}
 */
function hideModal(id) {
    document.getElementById(id)?.classList.remove('show');
}

/**
 * Replaces select options while preserving the current value.
 *
 * @param {string} id - Select element ID.
 * @param {Array<Object>} options - Options with value and label.
 * @returns {void}
 */
function fillSelect(id, options) {
    const el = document.getElementById(id);
    if (!el) return;
    const current = el.value;
    el.innerHTML = options.map(opt => `<option value="${automatorEscapeAttr(opt.value)}">${escapeHtml(opt.label)}</option>`).join('');
    if (options.some(opt => String(opt.value) === String(current))) el.value = current;
}

/**
 * Sets an element's text content.
 *
 * @param {string} id - Element ID.
 * @param {*} value - Text value.
 * @returns {void}
 */
function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value ?? '';
}

/**
 * Sets a form field value and synchronized Ace editor content.
 *
 * @param {string} id - Field ID.
 * @param {*} value - Field value.
 * @returns {void}
 */
function setValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value ?? '';
    if (ACE_EDITORS[id]) ACE_EDITORS[id].session.setValue(value ?? '');
}

/**
 * Maps run status to a compact visual marker.
 *
 * @param {string} status - Run status.
 * @returns {string} Status marker.
 */
function statusIcon(status) {
    return { success: '🟢', failed: '🔴', running: '🔵', aborted: '🟠', timed_out: '⚫' }[status] || '⚪';
}

/**
 * Formats a server timestamp through the global timezone formatter.
 *
 * @param {string} value - SQL timestamp.
 * @returns {string} Formatted timestamp.
 */
function formatDateTime(value) {
    if (!value) return '';
    if (typeof window.format_datetime === 'function') return window.format_datetime(value, 0);
    return value;
}

/**
 * Escapes text for HTML attribute insertion.
 *
 * @param {*} value - Raw value.
 * @returns {string} Escaped attribute value.
 */
function automatorEscapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
}

/**
 * Parses raw Ansible output into structured task output sections.
 *
 * @param {string} output - Raw Ansible stdout.
 * @returns {Array<Object>} Array of { task, hosts: [{ host, status, msg }] }.
 */
function parseRawTaskOutputs(output) {
    if (!output) return [];
    const tasks = [];
    const lines = output.split('\n');
    let currentTask = null;
    let currentHost = null;
    let currentItem = null;
    let msgLines = [];
    let inJsonBlock = false;
    let braceDepth = 0;

    function flushMsg() {
        if (currentTask && currentHost && msgLines.length) {
            const entry = { host: currentHost, status: 'ok', msg: msgLines.join('\n') };
            if (currentItem) entry.item = currentItem;
            currentTask.hosts.push(entry);
        }
        msgLines = [];
        currentHost = null;
        currentItem = null;
    }

    function flushTask() {
        if (currentTask && currentTask.hosts.length) {
            tasks.push(currentTask);
        }
        currentTask = null;
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // TASK header
        const taskMatch = line.match(/^TASK \[(.+?)\] \*+$/);
        if (taskMatch) {
            flushMsg();
            flushTask();
            currentTask = { task: taskMatch[1], hosts: [] };
            inJsonBlock = false;
            braceDepth = 0;
            continue;
        }

        // Host result line: ok: [host] or ok: [host] => (item=...) => {
        const hostMatch = line.match(/^(ok|changed|failed|skipping|fatal): \[([^\]]+)\]/);
        if (hostMatch && currentTask) {
            flushMsg();
            currentHost = hostMatch[2];
            const status = hostMatch[1] === 'fatal' ? 'failed' : hostMatch[1];
            const itemMatch = line.match(/\(item=(.+?)\)/);
            if (itemMatch) currentItem = itemMatch[1];
            currentTask.hosts.push({ host: currentHost, status, msg: '' });
            if (line.includes('{')) {
                inJsonBlock = true;
                braceDepth = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
            }
            continue;
        }

        // JSON block content
        if (inJsonBlock && currentHost) {
            braceDepth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;

            // Extract msg array content
            const msgArrayMatch = line.match(/"msg":\s*\[/);
            if (msgArrayMatch) {
                msgLines = [];
                // Check if array closes on same line
                if (line.includes(']')) {
                    const inline = line.match(/"msg":\s*\[(.*?)\]/);
                    if (inline) {
                        const items = inline[1].split(/",\s*"/).map(s => s.replace(/^"|"$|"/g, '').trim());
                        msgLines = items.filter(Boolean);
                    }
                    inJsonBlock = braceDepth <= 0;
                    if (inJsonBlock === false) {
                        const lastHost = currentTask.hosts[currentTask.hosts.length - 1];
                        if (lastHost && lastHost.host === currentHost) {
                            lastHost.msg = msgLines.join('\n');
                            if (currentItem) lastHost.item = currentItem;
                        }
                        msgLines = [];
                        currentHost = null;
                        currentItem = null;
                    }
                } else {
                    // Multi-line array — collect lines
                    let inArray = true;
                    i++;
                    while (i < lines.length && inArray) {
                        const innerLine = lines[i];
                        if (innerLine.trim() === ']' || innerLine.trim().endsWith('],') || innerLine.trim().endsWith(']')) {
                            inArray = false;
                            braceDepth -= 1;
                            inJsonBlock = braceDepth <= 0;
                            const lastHost = currentTask.hosts[currentTask.hosts.length - 1];
                            if (lastHost && lastHost.host === currentHost) {
                                lastHost.msg = msgLines.join('\n');
                                if (currentItem) lastHost.item = currentItem;
                            }
                            msgLines = [];
                            currentHost = null;
                            currentItem = null;
                        } else {
                            const clean = innerLine.replace(/^[\s"]+|[\s",]+$/g, '').replace(/^\\n|\\n$/g, '');
                            if (clean) msgLines.push(clean);
                        }
                        i++;
                    }
                    continue;
                }
            } else if (braceDepth <= 0) {
                inJsonBlock = false;
            }
            continue;
        }

        // PLAY RECAP — end of useful output
        if (/^PLAY RECAP \*+$/.test(line)) {
            flushMsg();
            flushTask();
            break;
        }
    }

    flushMsg();
    flushTask();
    return tasks;
}

/**
 * Renders a msg string as structured key-value lines or plain text.
 *
 * @param {string} msg - Message content.
 * @returns {string} HTML.
 */
function renderMsgContent(msg) {
    if (!msg) return '<span class="report-msg-empty">No output</span>';
    const lines = String(msg).replace(/\\n/g, '\n').split('\n').filter(l => l.trim() && l.trim() !== '--------------------------------------------------');
    if (!lines.length) return '<span class="report-msg-empty">No output</span>';

    // Fix parsing artifact: "LABELvalue" → "LABEL: value" (first loop item often loses colons)
    const fixedLines = lines.map(l => {
        if (l.includes(':')) return l;
        return l.trimStart().replace(/^([A-Z][A-Z\s]*[A-Z])([A-Za-z0-9@])/g, '$1: $2');
    });

    // Check if lines contain structured KEY: VALUE headers.
    const kvLines = fixedLines.filter(l => /^[A-Z][A-Z0-9\s()/_-]*:\s*\S/.test(l.trim()));
    if (kvLines.length >= 2 || kvLines.length > fixedLines.length * 0.4) {
        return fixedLines.map(line => {
            const kvMatch = line.trim().match(/^([A-Z][A-Z0-9\s()/_-]*?):\s*(.*)/);
            if (kvMatch) {
                return `<div class="report-kv-line"><span class="report-kv-key">${escapeHtml(kvMatch[1])}</span><span class="report-kv-val">${escapeHtml(kvMatch[2])}</span></div>`;
            }
            return `<div class="report-text-line">${escapeHtml(line.trim())}</div>`;
        }).join('');
    }

    // Fallback: pre-formatted text
    return `<pre class="report-pre">${escapeHtml(fixedLines.join('\n'))}</pre>`;
}

/**
 * Renders task output sections for the report view.
 *
 * @param {Array<Object>} tasks - Parsed task outputs.
 * @param {Object} jsonResult - Structured json_result from DB.
 * @param {string} hostStatusHtml - Host status section to insert after detailed audit output.
 * @returns {string} HTML.
 */
function renderTaskOutputs(tasks, jsonResult, hostStatusHtml = '') {
    if (!tasks || !tasks.length) {
        return `<div class="report-empty">No task output available. Check the Raw Log tab for full output.</div>${hostStatusHtml}`;
    }

    let insertedHostStatus = false;
    const html = tasks.map(section => {
        const hostCount = section.hosts.length;
        const hostCards = section.hosts.map(h => {
            const statusClass = h.status === 'failed' ? 'report-host-failed' :
                               h.status === 'changed' ? 'report-host-changed' : 'report-host-ok';
            const hostLabel = h.item ? `${escapeHtml(h.host)} <span class="report-host-item">(${escapeHtml(h.item)})</span>` : escapeHtml(h.host);
            return `
                <div class="report-host-card ${statusClass}">
                    <div class="report-host-header">
                        <span class="report-host-name">${hostLabel}</span>
                        <span class="report-host-status">${escapeHtml(h.status)}</span>
                    </div>
                    <div class="report-host-msg">${renderMsgContent(h.msg)}</div>
                </div>
            `;
        }).join('');

        const sectionHtml = `
            <details class="report-task-section" open>
                <summary class="report-task-header">
                    <span class="report-task-name">${escapeHtml(section.task)}</span>
                    <span class="report-task-count">${hostCount} ${hostCount === 1 ? 'host' : 'hosts'}</span>
                </summary>
                <div class="report-task-body">${hostCards}</div>
            </details>
        `;
        if (!insertedHostStatus && /detailed audit log/i.test(section.task || '')) {
            insertedHostStatus = true;
            return sectionHtml + hostStatusHtml;
        }
        return sectionHtml;
    }).join('');

    return insertedHostStatus ? html : html + hostStatusHtml;
}

/**
 * Renders the full report view (modal or page).
 *
 * @param {Object} data - { history, json_result }.
 * @returns {string} HTML.
 */
function renderReportView(data) {
    const h = data.history;
    const jsonResult = h.json_result || {};
    const stats = jsonResult.stats || {};
    const failures = jsonResult.failures || [];
    const taskOutputs = jsonResult.task_outputs || [];

    // Calculate duration
    let duration = '';
    if (h.started_at && h.finished_at) {
        const start = new Date(h.started_at.replace(' ', 'T'));
        const end = new Date(h.finished_at.replace(' ', 'T'));
        const diff = Math.round((end - start) / 1000);
        const mins = Math.floor(diff / 60);
        const secs = diff % 60;
        duration = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    }

    // Calculate totals
    let totalHosts = Object.keys(stats).length;
    let totalOk = 0, totalChanged = 0, totalFailed = 0;
    for (const hostStats of Object.values(stats)) {
        totalOk += (hostStats.ok || 0) - (hostStats.changed || 0);
        totalChanged += hostStats.changed || 0;
        totalFailed += (hostStats.failures || 0) + (hostStats.unreachable || 0);
    }

    // Parse task outputs: raw parser handles looped items correctly,
    // structured task_outputs only captures final aggregated result for loops
    let tasks = parseRawTaskOutputs(h.output || '');
    if (!tasks.length && taskOutputs.length) {
        const taskMap = {};
        for (const to of taskOutputs) {
            if (!taskMap[to.task]) taskMap[to.task] = { task: to.task, hosts: [] };
            taskMap[to.task].hosts.push({
                host: to.host,
                status: to.status,
                msg: Array.isArray(to.msg) ? to.msg.join('\n') : to.msg,
                item: to.item,
            });
        }
        tasks = Object.values(taskMap);
    }

    // Move tasks with actual output content to the top
    tasks.sort((a, b) => {
        const contentLen = (t) => t.hosts.reduce((sum, h) => sum + (h.msg ? h.msg.length : 0), 0);
        return contentLen(b) - contentLen(a);
    });

    const statusBadge = h.status === 'success' ? 'report-badge-success' :
                       h.status === 'failed' ? 'report-badge-failed' :
                       h.status === 'aborted' ? 'report-badge-aborted' : 'report-badge-other';

    // Host status table rows
    const hostRows = Object.entries(stats).sort().map(([host, s]) => {
        const hostFailed = (s.failures || 0) + (s.unreachable || 0) > 0;
        const statusIcon = hostFailed ? '🔴' : (s.changed > 0 ? '🟡' : '🟢');
        const statusLabel = hostFailed ? 'Failed' : (s.changed > 0 ? 'Changed' : 'OK');
        return `
            <tr>
                <td>${escapeHtml(host)}</td>
                <td>${s.ok || 0}</td>
                <td>${s.changed || 0}</td>
                <td>${s.failures || 0}</td>
                <td>${s.unreachable || 0}</td>
                <td>${s.skipped || 0}</td>
                <td>${statusIcon} ${escapeHtml(statusLabel)}</td>
            </tr>
        `;
    }).join('');
    const hostStatusSection = `
        <div class="report-host-table-section">
            <h3 class="report-section-title">Host Status</h3>
            <div class="table-responsive">
                <table class="data-table report-host-table">
                    <thead>
                        <tr>
                            <th>Host</th>
                            <th>OK</th>
                            <th>Changed</th>
                            <th>Failed</th>
                            <th>Unreachable</th>
                            <th>Skipped</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>${hostRows}</tbody>
                </table>
            </div>
        </div>
    `;

    // Failure detail cards
    const failureCards = failures.length ? failures.map(f => `
        <div class="report-failure-card">
            <div class="report-failure-header">
                <span class="report-failure-host">${escapeHtml(f.host)}</span>
                <span class="report-failure-task">${escapeHtml(f.task)}</span>
            </div>
            <div class="report-failure-msg">${escapeHtml(f.message || 'Unknown error')}</div>
        </div>
    `).join('') : '';

    return `
        <div class="report-container">
            <div class="report-header">
                <div class="report-header-main">
                    <h2 class="report-playbook-name">${escapeHtml(h.playbook_name || 'Deleted Playbook')}</h2>
                    <div class="report-meta">
                        <span class="report-badge ${statusBadge}">${escapeHtml(h.status)}</span>
                        <span>Run #${h.id}</span>
                        ${h.triggered_by_name ? `<span>by ${escapeHtml(h.triggered_by_name)}</span>` : ''}
                        <span>${escapeHtml(h.mode || 'run')}</span>
                    </div>
                </div>
                <div class="report-header-side">
                    <span class="report-time">${escapeHtml(h.started_at || '')}</span>
                    <span class="report-duration">${escapeHtml(duration)}</span>
                </div>
            </div>

            <div class="report-summary-cards">
                <div class="report-card">
                    <span class="report-card-label">Hosts</span>
                    <span class="report-card-value">${totalHosts}</span>
                </div>
                <div class="report-card report-card-ok">
                    <span class="report-card-label">OK</span>
                    <span class="report-card-value">${totalOk}</span>
                </div>
                <div class="report-card report-card-changed">
                    <span class="report-card-label">Changed</span>
                    <span class="report-card-value">${totalChanged}</span>
                </div>
                <div class="report-card report-card-failed">
                    <span class="report-card-label">Failed</span>
                    <span class="report-card-value">${totalFailed}</span>
                </div>
            </div>

            ${failureCards ? `
            <div class="report-failures">
                <h3 class="report-section-title">⚠ Failures (${failures.length})</h3>
                ${failureCards}
            </div>
            ` : ''}

            <div class="report-task-outputs">
                <h3 class="report-section-title">Task Output</h3>
                ${renderTaskOutputs(tasks, jsonResult, hostStatusSection)}
            </div>
        </div>
    `;
}

/**
 * Renders the report view inside the console modal.
 * Uses history data from STATE or fetches via API if not available locally.
 *
 * @returns {void}
 */
async function showConsoleReport() {
    const statusView = document.getElementById('consoleStatusView');
    const rawOutput = document.getElementById('consoleOutput');
    const reportView = document.getElementById('consoleReportView');
    if (!reportView) return;

    statusView?.classList.add('hidden');
    rawOutput?.classList.add('hidden');
    reportView.classList.remove('hidden');

    if (!reportView.dataset.loaded && currentConsoleHistoryId) {
        let h = STATE.history.find(row => Number(row.id) === Number(currentConsoleHistoryId));
        if (!h || (!h.json_result && !h.output)) {
            try {
                const data = await apiGet(`/admin/automator/api/report/${currentConsoleHistoryId}`, 6000);
                if (data && data.success && data.history) {
                    h = data.history;
                    const idx = STATE.history.findIndex(row => Number(row.id) === Number(h.id));
                    if (idx >= 0) STATE.history[idx] = h;
                    else STATE.history.unshift(h);
                }
            } catch (err) {
                h = null;
            }
        }

        if (h && (h.json_result || h.output)) {
            reportView.innerHTML = renderReportView({ history: h });
            reportView.dataset.loaded = '1';
        } else {
            reportView.innerHTML = '<div class="report-empty">Report data not yet available. Wait for the run to finish.</div>';
        }
    }
}

/**
 * Opens the AI report modal without starting generation.
 *
 * @returns {void}
 */
function openAiReportModal() {
    const content = document.getElementById('aiReportContent');
    if (!content) return;

    showModal('aiReportModal');
    document.getElementById('aiReportFooter')?.classList.add('hidden');
    content.innerHTML = `
        <div class="report-empty">
            Select a past report or click Generate to analyze the last 24 hours of activity.
        </div>
    `;
    refreshAiReportHistory();
}

/**
 * Refreshes the AI report history dropdown.
 *
 * @returns {void}
 */
function refreshAiReportHistory() {
    const history = document.getElementById('aiReportHistory');
    apiGet('/admin/automator/api/ai-report/history', 5000).then(res => {
        const reports = Array.isArray(res?.history) ? res.history : [];
        if (res && res.success && reports.length) {
            window.AI_REPORT_HISTORY = reports;
            if (history) {
                history.innerHTML = `
                    <select class="history-select" onchange="handleAutomatorAction({target: this.options[this.selectedIndex]})">
                        <option value="">(Past Reports)</option>
                        ${reports.map(h => `<option value="${automatorEscapeAttr(h.id)}" data-automator-action="view-ai-history" data-id="${automatorEscapeAttr(h.id)}">${escapeHtml(formatAiRelativeDate(h.created_at))}</option>`).join('')}
                    </select>
                `;
            }
        } else if (history) {
            history.innerHTML = '';
        }
    });
}

/**
 * Triggers the AI analysis for the last 24 hours of logs.
 *
 * @returns {void}
 */
async function generateAiReport() {
    const content = document.getElementById('aiReportContent');
    if (!content) return;

    showModal('aiReportModal');
    document.getElementById('aiReportFooter')?.classList.add('hidden');
    content.innerHTML = `
        <div class="component-loading">
            <div class="loading-scan-line"></div>
            <p class="loading-label">AI is analyzing 24h activity...</p>
        </div>
    `;

    try {
        const data = await apiPost('/admin/automator/api/ai-report', {}, 65000);
        if (data && data.success) {
            renderAiReport(data.content);
            refreshAiReportHistory();
        } else {
            content.innerHTML = `<div class="report-empty">Error: ${escapeHtml(data?.error || 'Unknown failure')}</div>`;
        }
    } catch (err) {
        content.innerHTML = `<div class="report-empty">Service currently unavailable.</div>`;
    }
}

/**
 * Renders a specific AI report from history.
 *
 * @param {number} id - Audit record ID.
 * @returns {void}
 */
function viewAiHistory(id) {
    const report = (window.AI_REPORT_HISTORY || []).find(r => Number(r.id) === Number(id));
    if (report && report.details) {
        renderAiReport(report.details);
    }
}

/**
 * Renders the structured AI response into the report modal.
 *
 * @param {Object} report - The AI JSON payload.
 * @returns {void}
 */
function renderAiReport(report) {
    const content = document.getElementById('aiReportContent');
    const footer = document.getElementById('aiReportFooter');
    const ts = document.getElementById('aiReportTimestamp');
    if (!content) return;

    report = report && typeof report === 'object' ? report : {};
    const issues = Array.isArray(report.issues) ? report.issues : null;
    const recommendations = Array.isArray(report.recommendations) ? report.recommendations : null;

    let issuesHtml = '';
    if (issues && issues.length) {
        issuesHtml = `
            <h4>Detected Issues</h4>
            <div class="ai-report-grid">
                ${issues.map(issue => {
                    const severity = normalizeAiSeverity(issue.severity);
                    const runId = Number(issue.run_id);
                    return `
                    <div class="ai-issue-card severity-${severity}">
                        <div class="issue-header">
                            <span class="severity-badge">${escapeHtml(severity)}</span>
                            <strong>${escapeHtml(issue.host || 'General')}</strong>
                            ${Number.isFinite(runId) && runId > 0 ? `<button type="button" class="btn-secondary compact" data-automator-action="open-console" data-id="${runId}">View Log</button>` : ''}
                        </div>
                        <p>${escapeHtml(issue.description)}</p>
                    </div>
                `;
                }).join('')}
            </div>
        `;
    } else if (issues === null && report.issues !== undefined) {
        issuesHtml = `<p class="report-empty">Issues data was malformed and could not be displayed.</p>`;
    }

    content.innerHTML = `
        <div class="ai-report-summary">${escapeHtml(report.summary || 'No summary provided.')}</div>
        ${issuesHtml}
        <div class="ai-report-recommendations">
            <h4>Recommendations</h4>
            ${recommendations
                ? `<ul>${recommendations.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
                : report.recommendations !== undefined
                    ? `<p class="report-empty">Recommendations data was malformed and could not be displayed.</p>`
                    : `<ul></ul>`}
        </div>
        <div class="ai-report-final">${escapeHtml(report.final_summary)}</div>
    `;

    if (footer && ts && report.created_at) {
        footer.classList.remove('hidden');
        ts.textContent = `Generated: ${formatAiFullDate(report.created_at)} (${formatAiRelativeDate(report.created_at)})`;
    }
}

/**
 * Converts AI severity to the supported visual classes.
 *
 * @param {string} severity - AI-provided severity.
 * @returns {string}
 */
function normalizeAiSeverity(severity) {
    const normalized = String(severity || '').toLowerCase();
    if (normalized === 'high' || normalized === 'medium') return normalized;
    return 'low';
}

/**
 * Returns the application timezone for AI report date formatting.
 *
 * @returns {string}
 */
function getAiReportTimeZone() {
    return typeof APP_TZ !== 'undefined' && APP_TZ ? APP_TZ : 'UTC';
}

/**
 * Parses an AI report timestamp from the app's SQL timestamp convention.
 *
 * @param {string} value - Timestamp from API or audit history.
 * @returns {Date}
 */
function parseAiReportDate(value) {
    if (!value) return new Date(NaN);
    const sqlMatch = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
    if (sqlMatch) {
        return new Date(
            Number(sqlMatch[1]),
            Number(sqlMatch[2]) - 1,
            Number(sqlMatch[3]),
            Number(sqlMatch[4]),
            Number(sqlMatch[5]),
            Number(sqlMatch[6])
        );
    }
    return new Date(value);
}

/**
 * Formats an AI report timestamp for the modal footer.
 *
 * @param {string} value - Timestamp from API or audit history.
 * @returns {string}
 */
function formatAiFullDate(value) {
    const date = parseAiReportDate(value);
    if (Number.isNaN(date.getTime())) return value || '';
    return formatDateTime(value);
}

/**
 * Formats an AI report timestamp as a relative label.
 *
 * @param {string} value - Timestamp from API or audit history.
 * @returns {string}
 */
function formatAiRelativeDate(value) {
    const date = parseAiReportDate(value);
    if (Number.isNaN(date.getTime())) return value || '';
    const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
    const units = [
        ['year', 31536000],
        ['month', 2592000],
        ['week', 604800],
        ['day', 86400],
        ['hour', 3600],
        ['minute', 60],
        ['second', 1],
    ];
    for (const [unit, seconds] of units) {
        if (Math.abs(diffSeconds) >= seconds || unit === 'second') {
            return formatter.format(Math.round(diffSeconds / seconds), unit);
        }
    }
    return 'now';
}
