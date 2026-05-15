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
let historyPage = 1;
let historyPlaybookId = null;
let historyPlaybookName = '';
let ACE_EDITORS = {};

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
    else if (action === 'lock-vault') lockVault();
    else if (action === 'global-abort') globalAbort();
    else if (action === 'load-history') loadHistoryPage();
    else if (action === 'view-task-history') viewTaskHistory(id);
    else if (action === 'clear-task-history') clearTaskHistory();
    else if (action === 'close-playbook') closePlaybookModal();
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
    else if (action === 'open-console') openConsole(id);
    else if (action === 'abort-run') abortRun(id);
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

    ledger.innerHTML = Object.keys(groups).sort().map(category => `
        <section class="playbook-category">
            <header class="category-header">
                <span>▣ ${escapeHtml(category)}</span>
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
    `).join('');
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
            <td data-label="Playbook">
                <div class="playbook-main">
                    <h3>${escapeHtml(p.name)}</h3>
                    <p>${escapeHtml(p.description || 'No description')}</p>
                </div>
            </td>
            <td data-label="Configuration">
                <div class="playbook-meta">
                    <span>Inv: ${escapeHtml(p.inventory_name || 'None')}</span>
                    ${scheduleLabel(p) ? `<span>Sch: ${escapeHtml(scheduleLabel(p))}</span>` : ''}
                    ${p.next_run ? `<span>Next: ${formatDateTime(p.next_run)}</span>` : ''}
                    ${p.tags ? `<span>Tags: ${escapeHtml(p.tags)}</span>` : ''}
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
    list.innerHTML = STATE.history.map(h => `
        <article class="history-tile status-${escapeHtml(h.status)}">
            <div class="history-top">
                <strong>#${h.id} ${escapeHtml(h.playbook_name || 'Deleted Playbook')}</strong>
                <span>${statusIcon(h.status)} ${escapeHtml(h.status)}</span>
            </div>
            <div class="history-sub">${formatDateTime(h.started_at)} • ${escapeHtml(h.mode || 'run')} • ${window.getUserIcon(h.triggered_by_name?.toLowerCase()) || '👤'} ${escapeHtml(h.triggered_by_name || 'system')}</div>
            <div class="history-actions">
                <button type="button" class="btn-secondary compact" data-automator-action="open-console" data-id="${h.id}">View Log</button>
                ${h.playbook_id ? `<button type="button" class="btn-secondary compact" data-automator-action="run-playbook" data-id="${h.playbook_id}" data-mode="${escapeHtml(h.mode || 'run')}">Re-run</button>` : ''}
                ${h.status === 'running' ? `<button type="button" class="btn-danger-outline compact" data-automator-action="abort-run" data-id="${h.id}">Abort</button>` : ''}
            </div>
        </article>
    `).join('');
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
    fillSelect('playbookVaultSecret', [
        { value: '', label: 'No vault secret' },
        ...STATE.secrets.map(s => ({ value: String(s.id), label: s.name }))
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
    setValue('playbookVaultSecret', p?.vault_password_secret_id || '');
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

    const admins = (STATE.admins || []).map(a => `<option value="${a.id}" ${data && String(data.user_id) === String(a.id) ? 'selected' : ''}>${window.getUserIcon(a.username?.toLowerCase()) || '👤'} ${escapeHtml(a.username)}</option>`).join('');
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
    const notifs = [];
    document.querySelectorAll('.notif-row').forEach(row => {
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
    showConfirmModal({
        title: 'Delete Inventory',
        message: `Permanently delete ${inv ? inv.name : `#${id}`}? Playbooks using it will be detached.`,
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
 * Opens the write-only secret editor.
 *
 * @returns {void}
 */
function openSecretModal() {
    document.getElementById('secretForm')?.reset();
    setValue('secretCategory', 'General');
    showModal('secretModal');
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
    closeSecretModal();
    await refreshState(true);
}

/**
 * Deletes a playbook through the global confirm modal.
 *
 * @param {number} id - Playbook ID.
 * @returns {void}
 */
function deletePlaybook(id) {
    const p = STATE.playbooks.find(row => Number(row.id) === Number(id));
    showConfirmModal({
        title: 'Delete Playbook',
        message: `Soft-delete ${p ? p.name : `#${id}`}?`,
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
    if (reset) historyPage = 0;
    historyPage += 1;
    const params = new URLSearchParams({ page: String(historyPage), per_page: '50' });
    if (historyPlaybookId) params.set('playbook', String(historyPlaybookId));
    const data = await apiGet(`/admin/automator/api/history?${params.toString()}`, 6000);
    if (!data || !data.success) return;
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
    const h = STATE.history.find(row => Number(row.id) === Number(historyId));
    setText('consoleTitle', h ? `#${h.id} ${h.playbook_name || 'Run'}` : `#${historyId}`);
    updateConsoleStatusUI(h?.status || 'running');
    setText('consoleOutput', h?.output || '');
    document.getElementById('consoleAbortBtn')?.classList.toggle('hidden', h && h.status !== 'running');
    showModal('consoleModal');
    connectWS(historyId);
}

/**
 * Updates the console modal status text and visual indicator.
 *
 * @param {string} status - Run status.
 * @returns {void}
 */
function updateConsoleStatusUI(status) {
    setText('consoleStatus', status);
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
}

/**
 * Connects to a run WebSocket stream.
 *
 * @param {number} historyId - Run history ID.
 * @returns {void}
 */
function connectWS(historyId) {
    if (ws) ws.close();
    ws = new WebSocket(`/admin/automator/ws/${historyId}`);
    const consoleEl = document.getElementById('consoleOutput');
    ws.onmessage = (event) => {
        if (!consoleEl) return;
        const msg = event.data;
        if (msg.startsWith('###STATUS:') && msg.endsWith('###')) {
            const status = msg.replace('###STATUS:', '').replace('###', '');
            updateConsoleStatusUI(status);
            if (status !== 'running') {
                document.getElementById('consoleAbortBtn')?.classList.add('hidden');
            }
            return;
        }
        consoleEl.textContent += msg;
        if (!document.getElementById('consoleScrollLock')?.checked) {
            consoleEl.scrollTop = consoleEl.scrollHeight;
        }
    };
    ws.onclose = (event) => {
        if (event.code === 1008) {
            showVaultGate(false);
            return;
        }
        if (wsRetries >= AUTOMATOR_CONFIG.WS_MAX_RETRIES || currentConsoleHistoryId !== historyId) return;
        const delay = Math.min(1000 * 2 ** wsRetries, 30000);
        wsRetries += 1;
        setTimeout(() => connectWS(historyId), delay);
    };
    ws.onopen = () => { wsRetries = 0; };
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
    STATE.setup_required = setupRequired ? 1 : 0;
    document.getElementById('vaultGate')?.classList.add('show');
    document.getElementById('automatorApp')?.classList.add('hidden');
    setText('vaultTitle', setupRequired ? 'Vault Setup' : 'Vault Locked');
    setText('vaultMessage', setupRequired ? 'Create the Automator master password. Recovery requires a direct database reset.' : 'Enter the Automator master password to unlock orchestration controls.');
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
