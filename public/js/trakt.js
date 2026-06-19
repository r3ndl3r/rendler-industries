// /public/js/trakt.js

/**
 * Trakt Dashboard Controller
 *
 * Per-user Trakt OAuth, upcoming episodes, custom lists,
 * media search, and watched/unwatched actions.
 */

let STATE = {
    configured: false,
    connection: { connected: false },
    lists: [],
    upcoming: [],
    unwatched: [],
    search_results: []
};

let activeTab = 'upcoming';
let attemptedInitialSync = false;
let autoRefreshed = false;
let SHOW_DETAILS = null;
let SHOW_DETAILS_OPEN_SEASONS = {};
let SHOW_DETAILS_REQUEST_ID = 0;
let traktHistoryActionInFlight = false;
let traktListCollapseNonce = {};
let SEARCH_QUERY = '';
let SEARCH_TYPE = 'movie,show';
let SEARCH_DEBOUNCE_TIMER = null;
let SEARCH_REQUEST_ID = 0;
let UNWATCHED_LOADING = false;
let UNWATCHED_LOADED = false;
let UNWATCHED_VERSION = 0;
let UNWATCHED_REQUEST_ID = 0;
let REFRESH_IN_PROGRESS = false;
let SEARCH_LIST_MODAL_ITEM = null;
let SEARCH_LIST_MODAL_TRIGGER = null;
let ITEM_MOVE_SOURCE_ITEM = null;
let ITEM_MOVE_SOURCE_LIST_ID = null;
let IS_COMPACT_LAYOUT = false;
let SWIPE_START_X = null;
let SWIPE_START_Y = null;
let SWIPE_START_TIME = null;
const SWIPE_THRESHOLD_PX = 50;
const SWIPE_MAX_Y_PX = 30;
const TAB_ORDER = ['upcoming', 'unwatched', 'lists', 'search'];

/**
 * Bootstraps the module on DOM ready — sets up modal closing and loads initial state.
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', () => {
    IS_COMPACT_LAYOUT = compactLayout();
    window.addEventListener('resize', handleViewportResize, { passive: true });
    setupGlobalModalClosing(['modal-overlay'], [closeShowDetailsModal, closeListEditModal, closeSearchListModal]);
    const app = document.getElementById('traktApp');
    if (app) {
        app.addEventListener('touchstart', onSwipeStart, { passive: true });
        app.addEventListener('touchend', onSwipeEnd, { passive: true });
    }
    loadState();
});

/**
 * Loads the Trakt dashboard state from the server and initializes the UI.
 * Triggers an initial sync if the user has never synced before.
 * @async
 * @returns {Promise<void>}
 */
async function loadState() {
    try {
        const data = await apiGet('/trakt/api/state?skip_unwatched=1', 30000);
        if (data && data.success) {
            STATE = { ...STATE, ...data };
            if (!STATE.connection?.connected) {
                UNWATCHED_LOADING = false;
                UNWATCHED_LOADED = false;
                UNWATCHED_VERSION += 1;
                UNWATCHED_REQUEST_ID += 1;
                STATE.unwatched = [];
            }
            renderTrakt();
            if (STATE.connection?.connected && !STATE.connection.last_synced_at && !attemptedInitialSync) {
                attemptedInitialSync = true;
                syncTrakt().catch(err => console.error('Trakt initial sync failed:', err));
            } else if (STATE.connection?.connected) {
                await loadUnwatchedState(true);
                if (STATE.connection?.last_synced_at && !autoRefreshed && Date.now() - Date.parse(STATE.connection.last_synced_at) > 3600000) {
                    autoRefreshed = true;
                    syncTrakt().catch(err => console.error('Trakt auto refresh failed:', err));
                }
            }
        } else {
            renderError(data?.error || 'Unable to load Trakt');
        }
    } catch (err) {
        console.error('Trakt loadState failed:', err);
        renderError('Unable to load Trakt');
    }
}

/**
 * Main render function — dispatches based on configured/connected/active tab state.
 * @returns {void}
 */
function renderTrakt() {
    renderHeaderActions();
    const app = document.getElementById('traktApp');
    if (!app) return;

    if (!STATE.configured) {
        app.innerHTML = `
            <div class="glass-panel trakt-empty">
                <h2>Trakt API credentials needed</h2>
                <p>An admin needs to configure the Trakt client ID and secret in Settings before family users can connect.</p>
                <a class="btn-primary" href="/admin/settings">Open Settings</a>
            </div>`;
        return;
    }

    if (!STATE.connection?.connected) {
        app.innerHTML = `
            <div class="glass-panel trakt-empty">
                <h2>Connect your Trakt account</h2>
                <p>Each family member connects their own Trakt account. Your lists, history, and watchlist stay scoped to you.</p>
                <a class="btn-primary" href="/trakt/oauth/start">Connect Trakt</a>
            </div>`;
        return;
    }

    app.innerHTML = `
        <div class="trakt-tabs">
            ${renderTabButton('upcoming', 'Upcoming')}
            ${renderTabButton('unwatched', 'Unwatched')}
            ${renderTabButton('lists', 'Lists')}
            ${renderTabButton('search', 'Search')}
        </div>
        <div class="trakt-panel-stage">
            <div class="trakt-panel">
                ${renderActiveTab()}
            </div>
        </div>`;
}

/**
 * Renders the header action buttons (Refresh/Disconnect) based on connection state.
 * @returns {void}
 */
function renderHeaderActions() {
    const actions = document.getElementById('traktHeaderActions');
    if (!actions) return;

    if (!STATE.connection?.connected) {
        actions.innerHTML = '';
        return;
    }

    const refreshHtml = REFRESH_IN_PROGRESS
        ? `<button type="button" class="btn-primary" disabled>Refreshing...</button>`
        : `<button type="button" class="btn-primary" onclick="syncTrakt()">🔄 Refresh</button>`;
    actions.innerHTML = `
        ${refreshHtml}
        <button type="button" class="btn-danger" onclick="disconnectTrakt()">⛓️‍💥 Disconnect</button>`;
}

/**
 * Renders a single tab button.
 * @param {string} key - Tab key.
 * @param {string} label - Display label.
 * @returns {string} HTML button string.
 */
function renderTabButton(key, label) {
    return `<button type="button" class="trakt-tab ${activeTab === key ? 'active' : ''}" onclick="switchTab('${key}')">${escapeHtml(label)}</button>`;
}

/**
 * Dispatches rendering to the currently active tab function.
 * @returns {string} HTML string for the active tab.
 */
function renderActiveTab() {
    if (activeTab === 'unwatched') return renderUnwatched();
    if (activeTab === 'lists') return renderLists();
    if (activeTab === 'search') return renderSearch();
    return renderUpcoming();
}

/**
 * Switches the active tab and re-renders the dashboard.
 * @param {string} tab - Tab key (upcoming|unwatched|lists|search).
 * @returns {void}
 */
function switchTab(tab) {
    if (tab === activeTab) return;
    const prev = activeTab;
    activeTab = tab;
    if (!IS_COMPACT_LAYOUT) {
        renderTrakt();
        return;
    }
    const dir = TAB_ORDER.indexOf(tab) > TAB_ORDER.indexOf(prev) ? -1 : 1;
    const panel = document.querySelector('.trakt-panel');
    if (!panel) { renderTrakt(); return; }
    panel.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
    panel.style.transform = `translateX(${dir * 30}%)`;
    panel.style.opacity = '0';
    setTimeout(() => {
        renderTrakt();
        const newPanel = document.querySelector('.trakt-panel');
        if (!newPanel) return;
        newPanel.style.transition = 'none';
        newPanel.style.transform = `translateX(${-dir * 30}%)`;
        newPanel.style.opacity = '0';
        void newPanel.offsetHeight;
        newPanel.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
        newPanel.style.transform = 'translateX(0)';
        newPanel.style.opacity = '1';
    }, 200);
}

/**
 * Renders the Upcoming tab with a table of future episodes from the watchlist.
 * @returns {string} HTML string.
 */
function renderUpcoming() {
    if (!STATE.upcoming.length) {
        return `<div class="empty-state"><p>No upcoming watchlist episodes found.</p><p class="empty-hint">Refresh after adding shows to your Trakt watchlist.</p></div>`;
    }

    if (IS_COMPACT_LAYOUT) {
        return `<div class="trakt-mobile-list">${STATE.upcoming.map(renderUpcomingCompactCard).join('')}</div>`;
    }

    return `
        <div class="trakt-list-table">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Show</th>
                        <th>Episode</th>
                        <th>Network</th>
                    </tr>
                </thead>
                <tbody>
            ${STATE.upcoming.map(row => `
                    <tr>
                        <td>${escapeHtml(formatAirCountdown(row.first_aired, true))}</td>
                        <td>${renderShowCell(row.show_title || 'Unknown show', row.show_trakt_id, row.show_images)}</td>
                        <td><span class="trakt-episode-badge">${escapeHtml(episodeLabel(row))}</span> ${escapeHtml(row.title || '')}</td>
                        <td>${escapeHtml(row.network || '')}</td>
                    </tr>
            `).join('')}
                </tbody>
            </table>
        </div>`;
}

/**
 * Renders the Unwatched tab with a table of aired but unwatched episodes.
 * @returns {string} HTML string.
 */
function renderUnwatched() {
    if (UNWATCHED_LOADING && !UNWATCHED_LOADED) {
        return `<div class="empty-state trakt-loading"><div class="trakt-spinner"></div><p>Computing unwatched episodes...</p><p class="empty-hint">Gathering data from Trakt for each show in your watchlist</p></div>`;
    }

    if (!STATE.unwatched.length) {
        return `<div class="empty-state"><p>No unwatched watchlist episodes found right now.</p><p class="empty-hint">This section shows aired but unwatched episodes from series in your watchlist.</p></div>`;
    }

    if (IS_COMPACT_LAYOUT) {
        return `<div class="trakt-mobile-list">${STATE.unwatched.map(renderUnwatchedCompactCard).join('')}</div>`;
    }

    return `
        <div class="trakt-list-table">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Show</th>
                        <th>Episode</th>
                        <th>Aired</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${STATE.unwatched.map(item => `
                        <tr>
                            <td>${renderShowCell(item.show_title || 'Unknown show', item.show_trakt_id, item.show_images)}</td>
                            <td><span class="trakt-episode-badge">${escapeHtml(episodeLabel(item))}</span> ${escapeHtml(item.title || '')}</td>
                            <td>${escapeHtml(formatAirCountdown(item.first_aired, false))}</td>
                            <td><button type="button" class="trakt-pill-button unwatched" onclick="toggleUnwatchedItemState(${Number(item.trakt_id)}, false, this)">Unwatched</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>`;
}

/**
 * Renders the Lists tab with toolbar and all list cards.
 * @returns {string} HTML string.
 */
function renderLists() {
    return `
        <div class="trakt-toolbar">
            <button type="button" class="btn-primary" onclick="createList()">Create List</button>
        </div>
        ${STATE.lists.length ? STATE.lists.map(renderListCard).join('') : '<div class="empty-state"><p>No Trakt lists synced yet.</p></div>'}`;
}

/**
 * Renders a single list card with header, actions, and items.
 * @param {Object} list - List object with id, name, description, items, collapsed, etc.
 * @returns {string} HTML string.
 */
function renderListCard(list) {
    const collapsed = Number(list.collapsed) !== 0;
    const isWatchlist = Number(list.is_watchlist) === 1;
    return `
        <section class="glass-panel trakt-list ${collapsed ? 'collapsed' : ''}" data-list-id="${list.id}">
            <div class="trakt-list-header">
                <button type="button" class="trakt-list-title" onclick="toggleListCollapsed(${list.id}, ${collapsed ? 0 : 1})">
                    <span class="trakt-list-chevron">${collapsed ? '▸' : '▾'}</span>
                    <div class="trakt-list-heading">
                        <h3>${escapeHtml(list.name || 'Untitled list')}${isWatchlist ? ' <span class="trakt-list-badge">Built-in</span>' : ''} <span class="trakt-muted">(${list.item_count || 0})</span></h3>
                    </div>
                </button>
                <div class="trakt-list-actions">
                    ${isWatchlist ? '' : `<button type="button" class="btn-icon-edit" onclick="openListEditModal(${list.id})" title="Edit List">✏️</button>`}
                    ${isWatchlist ? '' : `<button type="button" class="btn-icon-delete" onclick="deleteList(${list.id})" title="Delete List">🗑️</button>`}
                </div>
            </div>
            <div class="trakt-items ${collapsed ? 'hidden' : ''}">
                ${(list.items || []).length ? list.items.map(item => renderListItem(item, list)).join('') : '<p class="trakt-muted">No items in this list.</p>'}
            </div>
        </section>`;
}

/**
 * Renders the search tab with search form and results area.
 * @returns {string} HTML string.
 */
function renderSearch() {
    return `
        <div class="glass-panel trakt-search">
            <form class="trakt-search-form" onsubmit="searchTrakt(event)">
                <select id="searchType" class="game-input">
                    <option value="movie,show" ${SEARCH_TYPE === 'movie,show' ? 'selected' : ''}>Movies & Shows</option>
                    <option value="movie" ${SEARCH_TYPE === 'movie' ? 'selected' : ''}>Movies</option>
                    <option value="show" ${SEARCH_TYPE === 'show' ? 'selected' : ''}>Shows</option>
                </select>
                <input id="searchQuery" class="game-input" placeholder="Search Trakt..." autocomplete="off" value="${escapeHtml(SEARCH_QUERY)}" oninput="debouncedSearch()">
                <button type="submit" class="btn-primary">Search</button>
            </form>
            <div id="searchResults" class="trakt-items">
                ${STATE.search_results.length ? `<div class="trakt-search-count">${STATE.search_results.length} result${STATE.search_results.length === 1 ? '' : 's'}</div>${STATE.search_results.map(item => renderSearchItem(item)).join('')}` : renderSearchEmptyState()}
            </div>
        </div>`;
}

/**
 * Renders the idle search results placeholder.
 * @returns {string} HTML string.
 */
function renderSearchEmptyState() {
    return `
        <div class="empty-state trakt-search-empty">
            <div class="trakt-search-empty-icon">⌕</div>
            <p>Search results will appear here</p>
            <p class="empty-hint">Search Trakt, then use the row actions to add titles to lists or update watched state.</p>
        </div>`;
}

/**
 * Builds card attributes for show rows that can open the details modal.
 * @param {number|string} traktId - Trakt show ID to open.
 * @returns {{className: string, attrs: string}} CSS class and HTML attributes.
 */
function openableCardAttributes(traktId) {
    const id = Number(traktId || 0);
    if (!id) return { className: '', attrs: '' };
    return {
        className: ' trakt-openable-card',
        attrs: ` role="button" tabindex="0" onclick="handleTraktCardPress(event, ${id})" onkeydown="handleTraktCardKeydown(event, ${id})"`
    };
}

/**
 * Opens show details when a card surface is pressed.
 * @param {MouseEvent|PointerEvent} event - Card click event.
 * @param {number|string} traktId - Trakt show ID.
 * @returns {void}
 */
function handleTraktCardPress(event, traktId) {
    if (shouldIgnoreCardPress(event)) return;
    openShowDetails(Number(traktId));
}

/**
 * Opens show details when an enterable card is activated by keyboard.
 * @param {KeyboardEvent} event - Card keydown event.
 * @param {number|string} traktId - Trakt show ID.
 * @returns {void}
 */
function handleTraktCardKeydown(event, traktId) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (shouldIgnoreCardPress(event)) return;
    event.preventDefault();
    openShowDetails(Number(traktId));
}

/**
 * Returns whether a card press originated from a nested control.
 * @param {Event} event - Card activation event.
 * @returns {boolean} True when a nested control should own the event.
 */
function shouldIgnoreCardPress(event) {
    const target = event.target;
    return target instanceof Element
        && !!target.closest('button, a, input, select, textarea, label, .trakt-item-actions, .trakt-mobile-card-actions');
}

/**
 * Renders a media item row inside a Trakt list.
 * @param {Object} item - Media item with media_type, trakt_id, title, year.
 * @param {Object} list - The containing Trakt list.
 * @returns {string} HTML string.
 */
function renderListItem(item, list) {
    const payload = itemPayload(item);
    const watched = !!item.watched;
    const removeTitle = Number(list.is_watchlist) === 1 ? 'Remove from Watchlist' : 'Remove from List';
    const openable = openableCardAttributes(item.media_type === 'show' ? item.trakt_id : 0);
    return `
        <div class="trakt-item${openable.className}" data-trakt-item="${payload}"${openable.attrs}>
            ${renderItemContent(item)}
            <div class="trakt-item-actions">
                <button type="button" class="btn-icon-delete trakt-item-action" onclick="removeListItem(${Number(list.id)}, '${payload}', this)" title="${removeTitle}">🗑️</button>
                <button type="button" class="${watched ? 'btn-icon-reset' : 'btn-icon-view'} trakt-item-action" onclick="toggleListItemWatched(${Number(list.id)}, '${payload}', ${watched ? 'true' : 'false'}, this)" title="${watched ? 'Mark Unwatched' : 'Mark Watched'}">${watched ? '↺' : '✓'}</button>
                <button type="button" class="btn-icon-edit trakt-item-action" onclick="openItemMoveModal(${Number(list.id)}, '${payload}', this)" title="Move to another list">🔀</button>
            </div>
        </div>`;
}

/**
 * Renders a media item row inside search results.
 * @param {Object} item - Media item with media_type, trakt_id, title, year.
 * @returns {string} HTML string.
 */
function renderSearchItem(item) {
    const payload = itemPayload(item);
    const watched = !!item.watched;
    const listCount = itemListMemberships(item).length;
    const listActionTitle = listCount
        ? `Manage Lists (${listCount})`
        : 'Add to List';
    const openable = openableCardAttributes(item.media_type === 'show' ? item.trakt_id : 0);
    return `
        <div class="trakt-item${openable.className}" data-trakt-item="${payload}"${openable.attrs}>
            ${renderItemContent(item)}
            <div class="trakt-item-actions">
                <button type="button" class="btn-icon-edit trakt-item-action" onclick="openSearchListModal('${payload}', this)" title="${escapeHtml(listActionTitle)}">➕</button>
                <button type="button" class="${watched ? 'btn-icon-reset' : 'btn-icon-view'} trakt-item-action" onclick="toggleSearchItemWatched('${payload}', ${watched ? 'true' : 'false'}, this)" title="${watched ? 'Mark Unwatched' : 'Mark Watched'}">${watched ? '↺' : '✓'}</button>
            </div>
        </div>`;
}

/**
 * Renders the shared content block for list and search rows.
 * @param {Object} item - Media item with title/meta.
 * @returns {string} HTML string.
 */
function renderItemContent(item) {
    const summary = `${escapeHtml(item.media_type || '')}${item.year ? ` · ${item.year}` : ''}`;
    return `
        <div class="trakt-item-content">
            ${renderPosterArt(mediaTitle(item), item.images || item.show_images, 'trakt-item-art', 'trakt-item-art-placeholder')}
            <div class="trakt-item-main">
                ${item.media_type === 'show'
                    ? renderShowLink(mediaTitle(item), item.trakt_id)
                    : `<strong>${escapeHtml(mediaTitle(item))}</strong>`}
                <small>${summary}</small>
                ${item.unwatched_count ? `<span class="trakt-unwatched-pill">${item.unwatched_count} unwatched</span>` : ''}
            </div>
        </div>`;
}

/**
 * Triggers a full Trakt sync and refreshes the dashboard.
 * @async
 * @returns {Promise<void>}
 */
async function syncTrakt() {
    if (REFRESH_IN_PROGRESS) return;
    REFRESH_IN_PROGRESS = true;
    renderHeaderActions();
    try {
        const result = await apiPost('/trakt/api/sync', {});
        if (result && result.success) {
            STATE = { ...STATE, ...result.state };
            renderTrakt();
            if (!result.message && typeof showToast === 'function') showToast('Trakt synced', 'success');
        }
        await loadUnwatchedState(!UNWATCHED_LOADED);
    } finally {
        REFRESH_IN_PROGRESS = false;
        renderHeaderActions();
    }
}

/**
 * Refreshes the full unwatched episode payload after the lightweight dashboard state.
 * @async
 * @param {boolean} showInitialLoading - Whether the first load should show the loading panel.
 * @returns {Promise<void>}
 */
async function loadUnwatchedState(showInitialLoading = false) {
    const requestVersion = UNWATCHED_VERSION;
    const requestId = ++UNWATCHED_REQUEST_ID;
    const showLoading = !!showInitialLoading && !UNWATCHED_LOADED;
    let changed = false;
    if (showLoading) {
        UNWATCHED_LOADING = true;
        if (activeTab === 'unwatched') renderTrakt();
    }

    try {
        const stateData = await apiGet('/trakt/api/state', 90000);
        if (requestVersion !== UNWATCHED_VERSION || requestId !== UNWATCHED_REQUEST_ID) return;
        if (stateData && stateData.success) {
            hydrateUnwatchedState(stateData);
            UNWATCHED_LOADED = true;
            changed = true;
        }
    } catch (err) {
        console.error('Trakt unwatched state load failed:', err);
    } finally {
        if (requestId === UNWATCHED_REQUEST_ID) {
            UNWATCHED_LOADING = false;
            if (activeTab === 'unwatched' && (showLoading || changed)) renderTrakt();
        }
    }
}

/**
 * Invalidates any in-flight unwatched payload and starts a quiet refresh.
 * @returns {void}
 */
function refreshUnwatchedAfterMutation() {
    invalidateUnwatchedStateLoads();
    loadUnwatchedState(false).catch(err => {
        console.error('Trakt unwatched refresh failed:', err);
    });
}

/**
 * Prevents older full-state hydration responses from overwriting newer mutations.
 * @returns {void}
 */
function invalidateUnwatchedStateLoads() {
    UNWATCHED_VERSION += 1;
}

/**
 * Merges the full unwatched response fields that are derived from the same recompute.
 * @param {Object} stateData - Full Trakt state response.
 * @returns {void}
 */
function hydrateUnwatchedState(stateData) {
    STATE.unwatched = stateData.unwatched || [];
    if (stateData.lists) STATE.lists = stateData.lists;
    if (stateData.upcoming) STATE.upcoming = stateData.upcoming;
    if (stateData.connection) STATE.connection = stateData.connection;
}

/**
 * Disconnects the current user's Trakt account after confirmation.
 * @async
 * @returns {Promise<void>}
 */
async function disconnectTrakt() {
    showConfirmModal({
        title: 'Disconnect Trakt',
        message: 'Disconnect your Trakt account from Rendler?',
        danger: true,
        confirmText: 'Disconnect',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const result = await apiPost('/trakt/api/oauth/disconnect', {});
            if (result && result.success) await loadState();
        }
    });
}

/**
 * Opens the list edit modal in create mode (no ID pre-filled).
 * @async
 * @returns {Promise<void>}
 */
async function createList() {
    const modal = document.getElementById('listEditModal');
    const title = modal?.querySelector('.modal-header h3');
    const idInput = document.getElementById('listEditId');
    const nameInput = document.getElementById('listEditName');
    const descriptionInput = document.getElementById('listEditDescription');
    const saveButton = document.getElementById('listEditSaveBtn');
    if (!modal || !idInput || !nameInput || !descriptionInput || !saveButton) return;

    idInput.value = '';
    nameInput.value = '';
    descriptionInput.value = '';
    if (title) title.textContent = '✎ Create List';
    saveButton.textContent = '💾 Create List';
    modal.classList.add('show');
    document.body.classList.add('modal-open');
    nameInput.focus();
}

/**
 * Opens the list edit modal with pre-filled name and description fields.
 * @param {number} id - List database ID.
 * @returns {void}
 */
function openListEditModal(id) {
    const list = STATE.lists.find(l => Number(l.id) === Number(id));
    if (!list) return;
    const modal = document.getElementById('listEditModal');
    const title = modal?.querySelector('.modal-header h3');
    const idInput = document.getElementById('listEditId');
    const nameInput = document.getElementById('listEditName');
    const descriptionInput = document.getElementById('listEditDescription');
    const saveButton = document.getElementById('listEditSaveBtn');
    if (!modal || !idInput || !nameInput || !descriptionInput || !saveButton) return;

    idInput.value = String(list.id);
    nameInput.value = list.name || '';
    descriptionInput.value = list.description || '';
    if (title) title.textContent = '✎ Edit List';
    saveButton.textContent = '💾 Save Changes';
    modal.classList.add('show');
    document.body.classList.add('modal-open');
    nameInput.focus();
    nameInput.select();
}

/**
 * Closes the native Trakt list edit modal.
 * @returns {void}
 */
function closeListEditModal() {
    const modal = document.getElementById('listEditModal');
    if (!modal) return;
    modal.classList.remove('show');
    syncModalBodyState();
}

/**
 * Opens the search-result list manager modal for a single item.
 * @param {string} payload - Encoded item payload.
 * @param {HTMLElement} button - Triggering row action.
 * @returns {void}
 */
function openSearchListModal(payload, button) {
    const item = decodeItemPayload(payload);
    const modal = document.getElementById('searchListModal');
    const title = document.getElementById('searchListModalTitle');
    SEARCH_LIST_MODAL_ITEM = item;
    SEARCH_LIST_MODAL_TRIGGER = button || null;
    if (!item || !modal || !title) return;
    title.textContent = `Lists for ${mediaTitle(item)}`;
    modal.classList.add('show');
    document.body.classList.add('modal-open');
    renderSearchListModalBody();
}

/**
 * Closes the search-result list manager modal.
 * @returns {void}
 */
function closeSearchListModal() {
    const modal = document.getElementById('searchListModal');
    if (!modal) return;
    modal.classList.remove('show');
    SEARCH_LIST_MODAL_ITEM = null;
    SEARCH_LIST_MODAL_TRIGGER = null;
    ITEM_MOVE_SOURCE_ITEM = null;
    ITEM_MOVE_SOURCE_LIST_ID = null;
    syncModalBodyState();
}

/**
 * Opens the move-to-list modal for a list item.
 * @param {number} sourceListId - Current list database ID.
 * @param {string} payload - Encoded item payload.
 * @returns {void}
 */
function openItemMoveModal(sourceListId, payload) {
    const item = decodeItemPayload(payload);
    const sourceList = STATE.lists.find(row => Number(row.id) === Number(sourceListId));
    if (!item || !sourceList) return;

    const modal = document.getElementById('searchListModal');
    const title = document.getElementById('searchListModalTitle');
    const body = document.getElementById('searchListModalBody');
    if (!modal || !title || !body) return;

    ITEM_MOVE_SOURCE_ITEM = item;
    ITEM_MOVE_SOURCE_LIST_ID = Number(sourceListId);
    const otherLists = STATE.lists.filter(l => Number(l.id) !== Number(sourceListId));

    title.textContent = `Move ${mediaTitle(item)}`;
    modal.classList.add('show');
    document.body.classList.add('modal-open');

    if (!otherLists.length) {
        body.innerHTML = '<p class="trakt-muted">No other lists available.</p>';
        return;
    }

    body.innerHTML = `<div class="trakt-search-list-modal">${otherLists.map(list => `
        <div class="trakt-search-list-row">
            <div>
                <strong>${escapeHtml(list.name || 'Untitled list')}</strong>
                <small>${escapeHtml(Number(list.is_watchlist) === 1 ? 'Built-in watchlist' : (list.description || 'Custom Trakt list'))}</small>
            </div>
            <button type="button" class="btn-icon-edit trakt-search-list-toggle" onclick="executeItemMove(${Number(list.id)})" title="Move to this list">➡</button>
        </div>`).join('')}</div>`;
}

/**
 * Moves an item from its source list to a target list.
 * @async
 * @param {number} targetListId - Target list database ID.
 * @returns {Promise<void>}
 */
async function executeItemMove(targetListId) {
    const item = ITEM_MOVE_SOURCE_ITEM;
    const sourceId = ITEM_MOVE_SOURCE_LIST_ID;
    if (!item || !sourceId) return;

    const targetList = STATE.lists.find(row => Number(row.id) === Number(targetListId));
    if (!targetList) return;
    const touchesWatchlist = isWatchlistListId(sourceId) || isWatchlistListId(targetListId);

    const runAction = async () => {
        let removeResult = null;
        try {
            removeResult = await apiPost(`/trakt/api/lists/${sourceId}/items/remove`, { items: JSON.stringify([item]) });
            if (!(removeResult && removeResult.success)) {
                if (typeof showToast === 'function') showToast('Unable to remove from current list', 'error');
                return;
            }
            removeCachedListItemLocally(sourceId, item);

            const addResult = await apiPost(`/trakt/api/lists/${targetListId}/items/add`, { items: JSON.stringify([item]) });
            if (addResult && addResult.success && addResult.state) {
                applyResultState(addResult);
                if (touchesWatchlist) refreshUnwatchedAfterMutation();
                closeSearchListModal();
                if (typeof showToast === 'function') showToast(`Moved to ${targetList.name || 'list'}`, 'success');
                return;
            }

            if (removeResult.state) applyResultState(removeResult);
            if (touchesWatchlist) refreshUnwatchedAfterMutation();
            closeSearchListModal();
            if (typeof showToast === 'function') showToast('Removed from current list, but unable to add to target list', 'error');
        } catch (err) {
            console.error('Trakt item move failed:', err);
            if (removeResult && removeResult.success && removeResult.state) {
                applyResultState(removeResult);
                if (touchesWatchlist) refreshUnwatchedAfterMutation();
                closeSearchListModal();
                if (typeof showToast === 'function') showToast('Removed from current list, but unable to add to target list', 'error');
                return;
            }
            if (typeof showToast === 'function') showToast('Unable to move item', 'error');
        }
    };

    showConfirmModal({
        title: 'Move Item',
        message: `Move <strong>${escapeHtml(mediaTitle(item))}</strong> to <strong>${escapeHtml(targetList.name || 'this list')}</strong>?`,
        confirmText: 'Move',
        hideCancel: true,
        alignment: 'center',
        onConfirm: runAction
    });
}

/**
 * Saves list changes from the native Trakt edit modal.
 * @async
 * @param {Event} event - The form submit event.
 * @returns {Promise<void>}
 */
async function submitListEdit(event) {
    event.preventDefault();
    const form = event.target;
    const listId = document.getElementById('listEditId')?.value;
    const saveButton = document.getElementById('listEditSaveBtn');
    const isCreate = !listId;
    if (!form || !saveButton) return;

    const formData = new FormData(form);
    const name = String(formData.get('name') || '').trim();
    if (!name) {
        if (typeof showToast === 'function') showToast('List name is required', 'error');
        return;
    }

    await withBusyButton(saveButton, 'Saving...', async () => {
        const url = isCreate ? '/trakt/api/lists/create' : `/trakt/api/lists/${listId}/update`;
        const payload = { name, description: String(formData.get('description') || '').trim() };
        const result = await apiPost(url, payload);
        if (result && result.success && result.state) {
            applyResultState(result);
            closeListEditModal();
            if (!result.message && typeof showToast === 'function') {
                showToast(isCreate ? 'List created' : 'List updated', 'success');
            }
        }
    });
}

/**
 * Deletes a custom Trakt list after user confirmation.
 * @async
 * @param {number} id - List database ID.
 * @returns {Promise<void>}
 */
async function deleteList(id) {
    const list = STATE.lists.find(row => Number(row.id) === Number(id));
    if (!list) return;
    showConfirmModal({
        title: 'Delete List',
        message: `Are you sure you want to delete <strong>${escapeHtml(list.name || 'this list')}</strong>?`,
        danger: true,
        confirmText: 'Delete List',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const result = await apiPost(`/trakt/api/lists/${id}/delete`, {});
            if (result && result.success && result.state) {
                applyResultState(result);
                if (!result.message && typeof showToast === 'function') showToast('List deleted', 'success');
            }
        }
    });
}

/**
 * Toggles the collapsed state of a list section.
 * @async
 * @param {number} id - List database ID.
 * @param {number} collapsed - 1 to collapse, 0 to expand.
 * @returns {Promise<void>}
 */
async function toggleListCollapsed(id, collapsed) {
    const listId = Number(id);
    const nextCollapsed = Number(collapsed) ? 1 : 0;
    const previous = STATE.lists.find(list => Number(list.id) === listId);
    if (!previous) return;
    const reloadInitialUnwatched = UNWATCHED_LOADING && !UNWATCHED_LOADED;

    invalidateUnwatchedStateLoads();
    const nonce = (traktListCollapseNonce[listId] || 0) + 1;
    traktListCollapseNonce[listId] = nonce;
    STATE.lists = STATE.lists.map(list =>
        Number(list.id) === listId ? { ...list, collapsed: nextCollapsed } : list
    );
    renderTrakt();
    if (reloadInitialUnwatched) {
        loadUnwatchedState(false).catch(err => {
            console.error('Trakt unwatched reload failed:', err);
        });
    }

    try {
        const result = await apiPost(`/trakt/api/lists/${listId}/collapse`, { collapsed: nextCollapsed });
        if (nonce !== traktListCollapseNonce[listId]) return;

        if (!(result && result.success)) {
            STATE.lists = STATE.lists.map(list =>
                Number(list.id) === listId ? { ...list, collapsed: previous.collapsed } : list
            );
            renderTrakt();
        }
    } catch (err) {
        console.error('Trakt list collapse save failed:', err);
        if (nonce !== traktListCollapseNonce[listId]) return;
        STATE.lists = STATE.lists.map(list =>
            Number(list.id) === listId ? { ...list, collapsed: previous.collapsed } : list
        );
        renderTrakt();
        if (typeof showToast === 'function') showToast('Unable to save list collapse state', 'error');
    } finally {
        if (nonce === traktListCollapseNonce[listId]) delete traktListCollapseNonce[listId];
    }
}

/**
 * Searches Trakt for movies and shows based on the query input.
 * @async
 * @param {Event} event - The form submit event.
 * @returns {Promise<void>}
 */
async function searchTrakt(event) {
    event.preventDefault();
    const q = document.getElementById('searchQuery')?.value.trim() || '';
    const type = document.getElementById('searchType')?.value || 'movie,show';
    SEARCH_QUERY = q;
    SEARCH_TYPE = type;
    if (q.length < 2) {
        SEARCH_REQUEST_ID += 1;
        STATE.search_results = [];
        renderTrakt();
        return;
    }
    const requestId = ++SEARCH_REQUEST_ID;
    const button = actionButton(event.submitter);
    await withBusyButton(button, 'Searching...', async () => {
        try {
            const data = await apiGet(`/trakt/api/search?type=${encodeURIComponent(type)}&q=${encodeURIComponent(q)}`, 15000);
            if (requestId !== SEARCH_REQUEST_ID || q !== SEARCH_QUERY || type !== SEARCH_TYPE) return;
            if (data && data.success) {
                STATE.search_results = data.results || [];
                renderTrakt();
                if (typeof showToast === 'function') showToast(`${STATE.search_results.length} result${STATE.search_results.length === 1 ? '' : 's'} loaded`, 'success');
            } else if (data && data.error) {
                if (typeof showToast === 'function') showToast(data.error, 'error');
                else alert(data.error);
            }
        } catch (err) {
            if (requestId !== SEARCH_REQUEST_ID) return;
            console.error('Trakt search failed:', err);
            if (typeof showToast === 'function') showToast('Search failed', 'error');
        }
    });
}

/**
 * Removes a single item from a Trakt list or watchlist.
 * @async
 * @param {number} listId - List database ID.
 * @param {string} payload - Encoded item payload.
 * @param {HTMLElement} button - Action button.
 * @returns {Promise<void>}
 */
async function removeListItem(listId, payload, button) {
    const item = decodeItemPayload(payload);
    if (!item) return;
    showConfirmModal({
        title: 'Remove Item',
        message: `Are you sure you want to remove <strong>${escapeHtml(mediaTitle(item))}</strong> from this list?`,
        danger: true,
        confirmText: 'Remove Item',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            await withRowAction(button, '...', async () => {
                const result = await apiPost(`/trakt/api/lists/${listId}/items/remove`, { items: JSON.stringify([item]) });
                if (result && result.success && result.state) {
                    removeCachedListItemLocally(listId, item);
                    applyResultState(result);
                    if (isWatchlistListId(listId)) refreshUnwatchedAfterMutation();
                    if (!result.message && typeof showToast === 'function') showToast('Removed from list', 'success');
                }
            });
        }
    });
}

/**
 * Toggles a single list item's watched state.
 * @async
 * @param {number} listId - List database ID.
 * @param {string} payload - Encoded item payload.
 * @param {boolean} watched - Current watched state.
 * @param {HTMLElement} button - Action button.
 * @returns {Promise<void>}
 */
async function toggleListItemWatched(listId, payload, watched, button) {
    const item = decodeItemPayload(payload);
    if (!item) return;
    const list = STATE.lists.find(row => Number(row.id) === Number(listId));
    const preserveShowIds = Number(list?.is_watchlist) === 1 && item.media_type === 'show'
        ? [Number(item.trakt_id)].filter(Boolean)
        : [];
    const runAction = async () => {
        await withRowAction(button, '...', async () => {
            await submitHistoryAction([item], !watched, button, preserveShowIds);
        });
    };

    showConfirmModal({
        title: watched ? 'Mark Unwatched' : 'Mark Watched',
        message: `Mark <strong>${escapeHtml(mediaTitle(item))}</strong> as ${watched ? 'unwatched' : 'watched'}?`,
        confirmText: watched ? 'Mark Unwatched' : 'Mark Watched',
        hideCancel: true,
        alignment: 'center',
        onConfirm: runAction
    });
}

/**
 * Renders the search-result list manager modal body.
 * @returns {void}
 */
function renderSearchListModalBody() {
    const body = document.getElementById('searchListModalBody');
    const item = SEARCH_LIST_MODAL_ITEM;
    if (!body) return;
    if (!item) {
        body.innerHTML = '<p class="trakt-muted">No item selected.</p>';
        return;
    }
    if (!STATE.lists.length) {
        body.innerHTML = '<p class="trakt-muted">Create or sync a list first.</p>';
        return;
    }

    body.innerHTML = `
        <div class="trakt-search-list-modal">
            ${STATE.lists.map(list => {
                const inList = isItemInList(item, list.id);
                return `
                    <div class="trakt-search-list-row">
                        <div>
                            <strong>${escapeHtml(list.name || 'Untitled list')}</strong>
                            <small>${escapeHtml(Number(list.is_watchlist) === 1 ? 'Built-in watchlist' : (list.description || 'Custom Trakt list'))}</small>
                        </div>
                        <button
                            type="button"
                            class="${inList ? 'btn-icon-delete' : 'btn-icon-edit'} trakt-search-list-toggle"
                            onclick="toggleSearchItemListMembership(${Number(list.id)}, this)"
                            title="${inList ? 'Remove from list' : 'Add to list'}"
                        >${inList ? '🗑️' : '➕'}</button>
                    </div>`;
            }).join('')}
        </div>`;
}

/**
 * Adds or removes the active search modal item from a specific list.
 * @async
 * @param {number} listId - Target list database ID.
 * @param {HTMLElement} button - Triggering action button.
 * @returns {Promise<void>}
 */
async function toggleSearchItemListMembership(listId, button) {
    const item = SEARCH_LIST_MODAL_ITEM;
    const list = STATE.lists.find(row => Number(row.id) === Number(listId));
    if (!item || !list) return;
    const inList = isItemInList(item, list.id);
    const endpoint = inList ? 'remove' : 'add';
    const runAction = async () => {
        await withBusyButton(button, '...', async () => {
            const result = await apiPost(`/trakt/api/lists/${list.id}/items/${endpoint}`, { items: JSON.stringify([item]) });
            if (result && result.success && result.state) {
                if (inList) removeCachedListItemLocally(list.id, item);
                applyResultState(result);
                if (Number(list.is_watchlist) === 1) refreshUnwatchedAfterMutation();
                renderSearchListModalBody();
                if (!result.message && typeof showToast === 'function') {
                    showToast(inList ? 'Removed from list' : 'Added to list', 'success');
                }
            }
        });
    };

    if (!inList) {
        await runAction();
        return;
    }

    showConfirmModal({
        title: 'Remove Item',
        message: `Are you sure you want to remove <strong>${escapeHtml(mediaTitle(item))}</strong> from <strong>${escapeHtml(list.name || 'this list')}</strong>?`,
        danger: true,
        confirmText: 'Remove Item',
        hideCancel: true,
        alignment: 'center',
        onConfirm: runAction
    });
}

/**
 * Toggles the watched state of a search result.
 * @async
 * @param {string} payload - Encoded item payload.
 * @param {boolean} watched - Current watched state.
 * @param {HTMLElement} button - Action button.
 * @returns {Promise<void>}
 */
async function toggleSearchItemWatched(payload, watched, button) {
    const item = decodeItemPayload(payload);
    if (!item) return;
    const runAction = async () => {
        await withRowAction(button, '...', async () => {
            await submitHistoryAction([item], !watched, button);
        });
    };

    showConfirmModal({
        title: watched ? 'Mark Unwatched' : 'Mark Watched',
        message: `Mark <strong>${escapeHtml(mediaTitle(item))}</strong> as ${watched ? 'unwatched' : 'watched'}?`,
        confirmText: watched ? 'Mark Unwatched' : 'Mark Watched',
        hideCancel: true,
        alignment: 'center',
        onConfirm: runAction
    });
}

/**
 * Toggles the watched state of an item in the unwatched tab.
 * @async
 * @param {number} traktId - Trakt episode ID.
 * @param {boolean} watched - Current watched state.
 * @param {HTMLElement} button - The triggering button element.
 * @returns {Promise<void>}
 */
async function toggleUnwatchedItemState(traktId, watched, button) {
    const item = STATE.unwatched.find(row => Number(row.trakt_id) === Number(traktId));
    if (!item) return;

    const runAction = async () => {
        await submitHistoryAction([{
            media_type: 'episode',
            trakt_id: item.trakt_id,
            title: item.title || ''
        }], !watched, button, [Number(item.show_trakt_id)]);
    };

    showConfirmModal({
        title: 'Mark Watched',
        message: `Mark <strong>${escapeHtml(item.show_title || 'this episode')}</strong> S${item.season}E${item.episode} as watched?`,
        confirmText: 'Mark Watched',
        hideCancel: true,
        alignment: 'center',
        onConfirm: runAction
    });
}

/**
 * Opens the show details modal and fetches full show data from the server.
 * @async
 * @param {number} traktId - Trakt show ID.
 * @returns {Promise<void>}
 */
async function openShowDetails(traktId) {
    if (!traktId) return;
    const requestId = ++SHOW_DETAILS_REQUEST_ID;
    const modal = document.getElementById('showDetailsModal');
    const title = document.getElementById('showDetailsTitle');
    const body = document.getElementById('showDetailsBody');
    if (!modal || !title || !body) return;

    title.textContent = 'Show Details';
    body.innerHTML = `
        <div class="component-loading">
            <div class="loading-scan-line"></div>
            <span class="loading-icon-pulse">🎬</span>
            <p class="loading-label">Loading show details...</p>
        </div>`;
    modal.classList.add('show');
    document.body.classList.add('modal-open');

    try {
        const data = await apiGet(`/trakt/api/shows/${traktId}`, 30000);
        if (requestId !== SHOW_DETAILS_REQUEST_ID || !modal.classList.contains('show')) return;
        if (data && data.success) {
            SHOW_DETAILS = data.show || null;
            SHOW_DETAILS_OPEN_SEASONS = {};
            renderShowDetailsModal();
        } else {
            body.innerHTML = `<p>${escapeHtml(data?.error || 'Unable to load show details')}</p>`;
        }
    } catch (err) {
        if (requestId !== SHOW_DETAILS_REQUEST_ID || !modal.classList.contains('show')) return;
        console.error('Trakt show details load failed:', err);
        body.innerHTML = '<p>Unable to load show details</p>';
    }
}

/**
 * Closes the show details modal and clears cached show data.
 * @returns {void}
 */
function closeShowDetailsModal() {
    const modal = document.getElementById('showDetailsModal');
    if (!modal) return;
    SHOW_DETAILS_REQUEST_ID += 1;
    modal.classList.remove('show');
    SHOW_DETAILS = null;
    SHOW_DETAILS_OPEN_SEASONS = {};
    syncModalBodyState();
}

/**
 * Renders the show details modal body from the cached SHOW_DETAILS data.
 * @returns {void}
 */
function renderShowDetailsModal() {
    const title = document.getElementById('showDetailsTitle');
    const body = document.getElementById('showDetailsBody');
    if (!title || !body || !SHOW_DETAILS) return;
    const artUrl = showDetailArtUrl();

    title.textContent = SHOW_DETAILS.title || 'Show Details';
    body.innerHTML = `
        <div class="trakt-show-summary">
            <div class="trakt-show-summary-grid">
                ${artUrl ? `<img class="trakt-show-poster" src="${escapeHtml(artUrl)}" alt="${escapeHtml(SHOW_DETAILS.title || 'Show')} poster" loading="lazy">` : '<div class="trakt-show-poster trakt-show-poster-placeholder" aria-hidden="true"></div>'}
                <div>
                    <div class="trakt-show-meta">
                        ${SHOW_DETAILS.year ? `<span>${escapeHtml(String(SHOW_DETAILS.year))}</span>` : ''}
                        ${SHOW_DETAILS.status ? `<span>${escapeHtml(SHOW_DETAILS.status)}</span>` : ''}
                        ${SHOW_DETAILS.network ? `<span>${escapeHtml(SHOW_DETAILS.network)}</span>` : ''}
                        ${SHOW_DETAILS.runtime ? `<span>${escapeHtml(String(SHOW_DETAILS.runtime))} min</span>` : ''}
                    </div>
                    ${SHOW_DETAILS.genres?.length ? `<p class="trakt-muted">${escapeHtml(SHOW_DETAILS.genres.join(', '))}</p>` : ''}
                    <p>${escapeHtml(SHOW_DETAILS.overview || 'No overview available.')}</p>
                </div>
            </div>
        </div>
        <div class="trakt-season-list">
            ${(SHOW_DETAILS.seasons || []).map(renderSeasonSection).join('')}
        </div>`;
}

/**
 * Renders a collapsible season section with episode list and watched toggle.
 * @param {Object} season - Season data with number, title, overview, episodes.
 * @returns {string} HTML string.
 */
function renderSeasonSection(season) {
    const isOpen = !!SHOW_DETAILS_OPEN_SEASONS[season.number];
    const seasonEpisodes = (season.episodes || []).filter(ep => ep.trakt_id);
    const isWatched = seasonEpisodes.length > 0 && seasonEpisodes.every(ep => ep.watched);

    return `
        <section class="glass-panel trakt-season-card">
            <div class="trakt-season-header">
                <div class="trakt-season-heading">
                    <div class="trakt-season-toggle-row">
                        <button type="button" class="trakt-season-toggle" onclick="toggleShowDetailSeason(${Number(season.number || 0)})">
                            <span class="trakt-list-chevron">${isOpen ? '▾' : '▸'}</span>
                            <h4>Season ${escapeHtml(String(season.number || 0))}${season.title ? ` · ${escapeHtml(season.title)}` : ''}</h4>
                        </button>
                        ${seasonEpisodes.length ? `<button type="button" class="trakt-pill-button ${isWatched ? 'watched' : 'unwatched'}" onclick="toggleSeasonFromShowDetails(${Number(season.number || 0)}, ${isWatched ? 'true' : 'false'}, this)">${isWatched ? 'Watched' : 'Unwatched'}</button>` : ''}
                    </div>
                    ${season.overview ? `<p class="trakt-muted">${escapeHtml(season.overview)}</p>` : ''}
                </div>
            </div>
            <div class="trakt-episode-list ${isOpen ? '' : 'hidden'}">
                ${(season.episodes || []).map(renderEpisodeRow).join('')}
            </div>
        </section>`;
}

/**
 * Renders a single episode row for display in the season episodes list.
 * @param {Object} episode - Episode data with season, episode, title, watched, etc.
 * @returns {string} HTML string.
 */
function renderEpisodeRow(episode) {
    return `
        <div class="trakt-episode-row ${episode.watched ? 'watched' : ''}">
            <div class="trakt-episode-main">
                <div class="trakt-episode-title-row">
                    <strong><span class="trakt-episode-badge">S${escapeHtml(String(episode.season || 0))}E${escapeHtml(String(episode.episode || 0))}</span> ${escapeHtml(episode.title || '')}</strong>
                    ${episode.trakt_id ? `<button type="button" class="trakt-pill-button ${episode.watched ? 'watched' : 'unwatched'}" onclick="toggleEpisodeFromShowDetails(${Number(episode.trakt_id)}, ${episode.watched ? 'true' : 'false'}, this)">${episode.watched ? 'Watched' : 'Unwatched'}</button>` : ''}
                </div>
                <small>${escapeHtml(formatDate(episode.first_aired) || '')}${episode.runtime ? ` · ${escapeHtml(String(episode.runtime))} min` : ''}</small>
                ${episode.overview ? `<p>${escapeHtml(episode.overview)}</p>` : ''}
            </div>
        </div>`;
}

/**
 * Toggles the open/collapsed state of a season section in the show details modal.
 * @param {number} seasonNumber - Season number to toggle.
 * @returns {void}
 */
function toggleShowDetailSeason(seasonNumber) {
    SHOW_DETAILS_OPEN_SEASONS[seasonNumber] = !SHOW_DETAILS_OPEN_SEASONS[seasonNumber];
    renderShowDetailsModal();
}

/**
 * Updates the local watched state of episodes in the cached SHOW_DETAILS object.
 * @param {Array<Object>} items - Array of {trakt_id} items that were toggled.
 * @param {boolean} watched - New watched state to apply.
 * @returns {void}
 */
function setShowDetailEpisodeState(items, watched) {
    const selectedIds = new Set(items.map(item => Number(item.trakt_id)));
    for (const season of SHOW_DETAILS?.seasons || []) {
        for (const episode of season.episodes || []) {
            if (selectedIds.has(Number(episode.trakt_id))) {
                episode.watched = watched ? 1 : 0;
            }
        }
    }
}

/**
 * Submits a history add/remove action to the Trakt API with watchlist preservation.
 * @async
 * @param {Array<Object>} items - Array of {media_type, trakt_id, title}.
 * @param {boolean} watched - True to mark watched, false to mark unwatched.
 * @param {HTMLElement} button - The triggering button element.
 * @param {Array<number>} [watchlistShowIds=[]] - Show trakt_ids to preserve in watchlist.
 * @returns {Promise<boolean>} True if the action succeeded.
 */
async function submitHistoryAction(items, watched, button, watchlistShowIds = []) {
    if (!items || !items.length) return false;
    if (traktHistoryActionInFlight) {
        if (typeof showToast === 'function') showToast('Wait for the current Trakt update to finish', 'info');
        return false;
    }

    let ok = false;
    traktHistoryActionInFlight = true;
    setPillButtonsDisabled(true, button);
    try {
        await withBusyButton(button, 'Saving...', async () => {
            const payload = { items: JSON.stringify(items) };
            if (watchlistShowIds && watchlistShowIds.length) {
                payload.watchlist_show_ids = JSON.stringify([...new Set(watchlistShowIds.filter(Boolean))]);
            }
            const result = await apiPost(watched ? '/trakt/api/history/add' : '/trakt/api/history/remove', payload);
            if (result && result.success && result.state) {
                setMediaItemsWatchedState(items, watched);
                applyResultState(result);
                refreshUnwatchedAfterMutation();
                ok = true;
                if (!result.message && typeof showToast === 'function') {
                    showToast(watched ? 'Marked watched' : 'Marked unwatched', 'success');
                }
            }
        });
    } finally {
        traktHistoryActionInFlight = false;
        setPillButtonsDisabled(false);
    }
    return ok;
}

/**
 * Toggles the watched state of a single episode from the show details modal.
 * @async
 * @param {number} traktId - Trakt episode ID.
 * @param {boolean} watched - Current watched state of the episode.
 * @param {HTMLElement} button - The triggering button element.
 * @returns {Promise<void>}
 */
async function toggleEpisodeFromShowDetails(traktId, watched, button) {
    const items = [];
    let episodeInfo = null;
    for (const season of SHOW_DETAILS?.seasons || []) {
        for (const episode of season.episodes || []) {
            if (Number(episode.trakt_id) === Number(traktId)) {
                items.push({
                    media_type: 'episode',
                    trakt_id: episode.trakt_id,
                    title: episode.title || ''
                });
                episodeInfo = episode;
            }
        }
    }
    if (!items.length) return;

    const runAction = async () => {
        const ok = await submitHistoryAction(items, !watched, button, [Number(SHOW_DETAILS?.trakt_id || 0)].filter(Boolean));
        if (!ok) return;
        setShowDetailEpisodeState(items, !watched);
        renderShowDetailsModal();
    };

    showConfirmModal({
        title: watched ? 'Mark Unwatched' : 'Mark Watched',
        message: `Mark <strong>S${episodeInfo?.season || 0}E${episodeInfo?.episode || 0} ${escapeHtml(episodeInfo?.title || '')}</strong> as ${watched ? 'unwatched' : 'watched'}?`,
        confirmText: watched ? 'Mark Unwatched' : 'Mark Watched',
        hideCancel: true,
        alignment: 'center',
        onConfirm: runAction
    });
}

/**
 * Toggles the watched state of all episodes in a season from the show details modal.
 * @async
 * @param {number} seasonNumber - Season number to toggle.
 * @param {boolean} watched - Current watched state of the season.
 * @param {HTMLElement} button - The triggering button element.
 * @returns {Promise<void>}
 */
async function toggleSeasonFromShowDetails(seasonNumber, watched, button) {
    const season = (SHOW_DETAILS?.seasons || []).find(row => Number(row.number) === Number(seasonNumber));
    if (!season) return;
    const items = (season.episodes || [])
        .filter(episode => episode.trakt_id && (!!watched ? episode.watched : !episode.watched))
        .map(episode => ({
            media_type: 'episode',
            trakt_id: episode.trakt_id,
            title: episode.title || ''
        }));
    if (!items.length) return;

    const runAction = async () => {
        const ok = await submitHistoryAction(items, !watched, button, [Number(SHOW_DETAILS?.trakt_id || 0)].filter(Boolean));
        if (!ok) return;
        setShowDetailEpisodeState(items, !watched);
        renderShowDetailsModal();
    };

    showConfirmModal({
        title: watched ? 'Mark Season Unwatched' : 'Mark Season Watched',
        message: `Mark Season ${seasonNumber} (${items.length} episode${items.length === 1 ? '' : 's'}) as ${watched ? 'unwatched' : 'watched'}?`,
        confirmText: watched ? 'Mark Unwatched' : 'Mark Watched',
        hideCancel: true,
        alignment: 'center',
        onConfirm: runAction
    });
}

/**
 * Performs a mutation API call and refreshes the dashboard state on success.
 * @async
 * @param {string} url - API endpoint URL.
 * @param {Object} payload - POST data payload.
 * @param {string} [successMessage=''] - Optional toast message on success.
 * @returns {Promise<void>}
 */
async function mutateAndRefresh(url, payload, successMessage = '') {
    const button = actionButton();
    await withBusyButton(button, 'Saving...', async () => {
        const result = await apiPost(url, payload);
        if (result && result.success && result.state) {
            applyResultState(result);
            if (successMessage && !result.message && typeof showToast === 'function') {
                showToast(successMessage, 'success');
            }
        }
    });
}

/**
 * Merges server state into STATE and re-renders the dashboard.
 * @param {Object} result - Successful mutation result containing state.
 * @returns {void}
 */
function applyResultState(result) {
    const reloadInitialUnwatched = UNWATCHED_LOADING && !UNWATCHED_LOADED;
    invalidateUnwatchedStateLoads();
    STATE = { ...STATE, ...(result?.state || {}) };
    renderTrakt();
    if (reloadInitialUnwatched) {
        loadUnwatchedState(false).catch(err => {
            console.error('Trakt unwatched reload failed:', err);
        });
    }
}

/**
 * Returns whether the list ID belongs to the built-in Trakt watchlist.
 * @param {number|string} listId - List database ID.
 * @returns {boolean} True when the list is the built-in watchlist.
 */
function isWatchlistListId(listId) {
    const list = STATE.lists.find(row => Number(row.id) === Number(listId));
    return Number(list?.is_watchlist) === 1;
}

/**
 * Returns whether the given item is already present in a specific list.
 * @param {Object} item - Item payload.
 * @param {number|string} listId - List database ID.
 * @returns {boolean} True if the item is present.
 */
function isItemInList(item, listId) {
    const list = STATE.lists.find(row => String(row.id) === String(listId));
    if (!list) return false;
    return (list.items || []).some(existing => sameMediaItem(existing, item));
}

/**
 * Returns all lists containing the given item.
 * @param {Object} item - Search/list item payload.
 * @returns {Array<Object>} Matching lists.
 */
function itemListMemberships(item) {
    return (STATE.lists || []).filter(list => isItemInList(item, list.id));
}

/**
 * Compares two Trakt items by media identity.
 * @param {Object} left - First item.
 * @param {Object} right - Second item.
 * @returns {boolean} True if the items refer to the same media.
 */
function sameMediaItem(left, right) {
    return String(left?.media_type || '') === String(right?.media_type || '')
        && Number(left?.trakt_id || 0) === Number(right?.trakt_id || 0)
        && Number(left?.season || 0) === Number(right?.season || 0)
        && Number(left?.episode || 0) === Number(right?.episode || 0);
}

/**
 * Updates local watched flags for cached list and search items.
 * @param {Array<Object>} items - Items that were toggled.
 * @param {boolean} watched - New watched state.
 * @returns {void}
 */
function setMediaItemsWatchedState(items, watched) {
    if (!items || !items.length) return;
    STATE.search_results = (STATE.search_results || []).map(row =>
        items.some(item => sameMediaItem(row, item)) ? { ...row, watched: watched ? 1 : 0 } : row
    );
    STATE.lists = (STATE.lists || []).map(list => ({
        ...list,
        items: (list.items || []).map(row =>
            items.some(item => sameMediaItem(row, item)) ? { ...row, watched: watched ? 1 : 0 } : row
        )
    }));
    if (watched) {
        STATE.unwatched = (STATE.unwatched || []).filter(row =>
            !items.some(item => {
                if ((item.media_type || '') === 'episode') return Number(row.trakt_id || 0) === Number(item.trakt_id || 0);
                if ((item.media_type || '') === 'show') return Number(row.show_trakt_id || 0) === Number(item.trakt_id || 0);
                return false;
            })
        );
    }
}

/**
 * Removes derived local state affected by a cached list removal.
 * @param {number} listId - List database ID.
 * @param {Object} item - Removed item.
 * @returns {void}
 */
function removeCachedListItemLocally(listId, item) {
    const list = STATE.lists.find(row => Number(row.id) === Number(listId));
    if (!list || Number(list.is_watchlist) !== 1) return;
    if ((item.media_type || '') !== 'show') return;
    STATE.unwatched = (STATE.unwatched || []).filter(row => Number(row.show_trakt_id || 0) !== Number(item.trakt_id || 0));
    STATE.upcoming = (STATE.upcoming || []).filter(row => Number(row.show_trakt_id || 0) !== Number(item.trakt_id || 0));
}

/**
 * Temporarily marks a row as busy and disables its sibling action buttons.
 * @async
 * @param {HTMLElement|null} button - Clicked row action button.
 * @param {string} label - Busy label to show on the active button.
 * @param {Function} work - Async action.
 * @returns {Promise<void>}
 */
async function withRowAction(button, label, work) {
    const row = button?.closest('.trakt-item');
    const buttons = row ? [...row.querySelectorAll('.trakt-item-action')] : [];
    buttons.forEach(candidate => {
        if (candidate !== button) candidate.disabled = true;
    });
    if (row) row.classList.add('is-pending');
    try {
        await withBusyButton(button, label, work);
    } finally {
        buttons.forEach(candidate => {
            if (candidate !== button) candidate.disabled = false;
        });
        if (row) row.classList.remove('is-pending');
    }
}

/**
 * Syncs body scroll lock with currently open Trakt modals.
 * @returns {void}
 */
function syncModalBodyState() {
    const anyOpen = document.querySelector('#showDetailsModal.show, #listEditModal.show, #searchListModal.show');
    document.body.classList.toggle('modal-open', !!anyOpen);
}

/**
 * Encodes an item as a URI-encoded JSON payload for a Trakt row action.
 * @param {Object} item - Media item with media_type, trakt_id, id, title.
 * @returns {string} URI-encoded JSON string.
 */
function itemPayload(item) {
    return encodeURIComponent(JSON.stringify({
        media_type: item.media_type,
        trakt_id: item.trakt_id,
        id: item.id || null,
        title: item.title || '',
        year: item.year || null,
        season: item.season || null,
        episode: item.episode || null,
        watched: item.watched ? 1 : 0,
        images: item.images || null,
        show_images: item.show_images || null,
        overview: item.overview || ''
    })).replace(/'/g, '%27');
}

/**
 * Decodes a Trakt row payload back into a plain object.
 * @param {string} payload - Encoded JSON payload.
 * @returns {Object|null} Decoded item or null.
 */
function decodeItemPayload(payload) {
    try {
        return JSON.parse(decodeURIComponent(payload || ''));
    } catch (e) {
        return null;
    }
}

/**
 * Renders a show link button that opens the show details modal.
 * @param {string} label - Display text for the link.
 * @param {number} traktId - Trakt show ID.
 * @returns {string} HTML string.
 */
function renderShowLink(label, traktId) {
    if (!traktId) return `<strong>${escapeHtml(label)}</strong>`;
    return `<button type="button" class="trakt-show-link" onclick="openShowDetails(${Number(traktId)})"><strong>${escapeHtml(label)}</strong></button>`;
}

/**
 * Renders a table cell with poster art and a show title link.
 * @param {string} label - Show title text.
 * @param {number} traktId - Trakt show ID.
 * @param {Object|null} images - Images object for the poster.
 * @returns {string} HTML string.
 */
function renderShowCell(label, traktId, images) {
    return `
        <div class="trakt-table-show-cell">
            ${renderPosterArt(label, images, 'trakt-table-show-art', 'trakt-table-show-art-placeholder')}
            <div class="trakt-table-show-copy">
                ${renderShowLink(label, traktId)}
            </div>
        </div>`;
}

/**
 * Renders a compact upcoming episode card for mobile viewport.
 * @param {Object} row - Upcoming episode data.
 * @returns {string} HTML string.
 */
function renderUpcomingCompactCard(row) {
    const showTitle = row.show_title || 'Unknown show';
    const openable = openableCardAttributes(row.show_trakt_id);
    return `
        <article class="trakt-mobile-card${openable.className}"${openable.attrs}>
            <div class="trakt-mobile-card-header">
                ${renderPosterArt(showTitle, row.show_images, 'trakt-mobile-art', 'trakt-mobile-art-placeholder')}
                <div class="trakt-mobile-card-copy">
                    ${renderShowLink(showTitle, row.show_trakt_id)}
                    <small>${escapeHtml(formatAirCountdown(row.first_aired, true))}</small>
                    <strong><span class="trakt-episode-badge">${escapeHtml(episodeLabel(row))}</span> ${escapeHtml(row.title || '')}</strong>
                </div>
            </div>
        </article>`;
}

/**
 * Renders a compact unwatched episode card for mobile viewport.
 * @param {Object} item - Unwatched episode data.
 * @returns {string} HTML string.
 */
function renderUnwatchedCompactCard(item) {
    const showTitle = item.show_title || 'Unknown show';
    const openable = openableCardAttributes(item.show_trakt_id);
    return `
        <article class="trakt-mobile-card${openable.className}"${openable.attrs}>
            <div class="trakt-mobile-card-header">
                ${renderPosterArt(showTitle, item.show_images, 'trakt-mobile-art', 'trakt-mobile-art-placeholder')}
                <div class="trakt-mobile-card-copy">
                    ${renderShowLink(showTitle, item.show_trakt_id)}
                    <div class="trakt-mobile-card-date-row">
                        <small>${escapeHtml(formatAirCountdown(item.first_aired, false))}</small>
                        <button type="button" class="trakt-pill-button unwatched" onclick="toggleUnwatchedItemState(${Number(item.trakt_id)}, false, this)">Unwatched</button>
                    </div>
                    <strong><span class="trakt-episode-badge">${escapeHtml(episodeLabel(item))}</span> ${escapeHtml(item.title || '')}</strong>
                </div>
            </div>
        </article>`;
}

/**
 * Renders a poster image or a placeholder when no image is available.
 * @param {string} label - Alt text for the image.
 * @param {Object|null} images - Images object from state.
 * @param {string} artClass - CSS class for the image element.
 * @param {string} placeholderClass - Additional CSS class for the placeholder.
 * @returns {string} HTML string.
 */
function renderPosterArt(label, images, artClass, placeholderClass) {
    const artUrl = preferredImageUrl(images);
    return artUrl
        ? `<img class="${artClass}" src="${escapeHtml(artUrl)}" alt="${escapeHtml(label)} poster" loading="lazy">`
        : `<div class="${artClass} ${placeholderClass}" aria-hidden="true"></div>`;
}

/**
 * Returns the poster URL for the currently open show details.
 * @returns {string} Image URL or empty string.
 */
function showDetailArtUrl() {
    return preferredImageUrl(SHOW_DETAILS?.images) || '';
}

/**
 * Returns the best available image URL from an images object.
 * Preference order: poster, thumb, fanart, banner.
 * @param {Object|null} images - Images object with optional keys.
 * @returns {string} Image URL or empty string.
 */
function preferredImageUrl(images) {
    if (!images || typeof images !== 'object') return '';
    return images.poster || images.thumb || images.fanart || images.banner || '';
}

/**
 * Returns true if the viewport is at mobile width.
 * @returns {boolean}
 */
function compactLayout() {
    return window.innerWidth <= 760;
}

/**
 * Re-renders on viewport width changes between compact and full layouts.
 * @returns {void}
 */
function handleViewportResize() {
    const nextCompact = compactLayout();
    if (nextCompact === IS_COMPACT_LAYOUT) return;
    IS_COMPACT_LAYOUT = nextCompact;
    renderTrakt();
    if (SHOW_DETAILS) renderShowDetailsModal();
}

/**
 * Records the starting position and time of a touch gesture.
 * @param {TouchEvent} event - The touchstart event.
 * @returns {void}
 */
function onSwipeStart(event) {
    if (!IS_COMPACT_LAYOUT) return;
    const touch = event.touches[0];
    if (!touch) return;
    SWIPE_START_X = touch.clientX;
    SWIPE_START_Y = touch.clientY;
    SWIPE_START_TIME = Date.now();
}

/**
 * Detects a swipe gesture and navigates between tabs.
 * @param {TouchEvent} event - The touchend event.
 * @returns {void}
 */
function onSwipeEnd(event) {
    if (!IS_COMPACT_LAYOUT) return;
    if (SWIPE_START_X === null) return;
    const modalOpen = document.querySelector('.modal-overlay.show, .modal-overlay.active');
    if (modalOpen) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - SWIPE_START_X;
    const dy = Math.abs(touch.clientY - SWIPE_START_Y);
    const dt = Date.now() - SWIPE_START_TIME;
    SWIPE_START_X = null;
    SWIPE_START_Y = null;
    if (dy > SWIPE_MAX_Y_PX || dt > 700) return;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
    const currentIdx = TAB_ORDER.indexOf(activeTab);
    if (currentIdx === -1) return;
    const nextIdx = dx < 0 ? currentIdx + 1 : currentIdx - 1;
    if (nextIdx >= 0 && nextIdx < TAB_ORDER.length) {
        switchTab(TAB_ORDER[nextIdx]);
    }
}

/**
 * Resolves the preferred button or falls back to the currently focused button.
 * @param {HTMLElement|null} [preferred=null] - Preferred button element.
 * @returns {HTMLElement|null} The resolved button or null.
 */
function actionButton(preferred = null) {
    if (preferred instanceof HTMLButtonElement) return preferred;
    return document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
}

/**
 * Wraps a button with a busy/loading state for the duration of an async operation.
 * @async
 * @param {HTMLElement|null} button - The button element to mark busy.
 * @param {string} label - Text to show while busy.
 * @param {Function} work - Async function to execute.
 * @returns {Promise<void>}
 */
async function withBusyButton(button, label, work) {
    if (!button) {
        await work();
        return;
    }
    const originalText = button.textContent;
    button.disabled = true;
    button.classList.add('is-busy');
    button.textContent = label;
    try {
        await work();
    } finally {
        button.disabled = false;
        button.classList.remove('is-busy');
        button.textContent = originalText;
    }
}

/**
 * Globally enables or disables pill buttons, optionally excluding the active one.
 * @param {boolean} disabled - Whether to disable all pill buttons.
 * @param {HTMLElement|null} [activeButton=null] - Button to skip when disabling.
 * @returns {void}
 */
function setPillButtonsDisabled(disabled, activeButton = null) {
    document.querySelectorAll('.trakt-pill-button').forEach(button => {
        if (button === activeButton) return;
        button.disabled = disabled;
    });
}

/**
 * Debounced search trigger — fires 250ms after the user stops typing.
 * @returns {void}
 */
function debouncedSearch() {
    if (SEARCH_DEBOUNCE_TIMER) clearTimeout(SEARCH_DEBOUNCE_TIMER);
    if (activeTab !== 'search') return;
    SEARCH_DEBOUNCE_TIMER = setTimeout(() => {
        if (activeTab !== 'search') return;
        const form = document.querySelector('.trakt-search-form');
        if (form) form.dispatchEvent(new Event('submit', { cancelable: true }));
    }, 250);
}

/**
 * Returns the display title, appending season/episode when present.
 * @param {Object} item - Media item with title and optional season/episode.
 * @returns {string} Display title string.
 */
function mediaTitle(item) {
    const base = item.title || 'Untitled';
    if (item.season && item.episode) return `${base} S${item.season}E${item.episode}`;
    return base;
}

/**
 * Returns a formatted season/episode label (e.g. "S1E3").
 * @param {Object} row - Episode data with season and episode numbers.
 * @returns {string} Formatted label or empty string.
 */
function episodeLabel(row) {
    if (!row.season || !row.episode) return '';
    return `S${row.season}E${row.episode}`;
}

/**
 * Formats a date value for display.
 * @param {string} value - ISO date string.
 * @returns {string} Formatted date or 'Unknown date'.
 */
function formatDate(value) {
    if (!value) return 'Unknown date';
    try {
        return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    } catch (e) {
        return value;
    }
}

/**
 * Formats an ISO date string as a human-readable countdown (e.g. "in 3 days").
 * @param {string} value - ISO date string.
 * @param {boolean} [includeCountdown=true] - Whether to include the countdown suffix.
 * @returns {string} Formatted date string.
 */
function formatAirCountdown(value, includeCountdown = true) {
    if (!value) return 'Unknown date';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    const weekday = date.toLocaleDateString([], { weekday: 'short' });
    const datePart = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    if (!includeCountdown) return `${weekday} ${datePart}`;

    const now = new Date();
    const sameDay = now.toDateString() === date.toDateString();
    const diffMs = date.getTime() - now.getTime();
    const future = diffMs >= 0;
    const absHours = Math.max(1, Math.ceil(Math.abs(diffMs) / 36e5));
    const absDays = Math.max(1, Math.ceil(Math.abs(diffMs) / 864e5));
    const countdown = sameDay
        ? `${future ? 'in' : 'about'} ${absHours} hour${absHours === 1 ? '' : 's'}`
        : `${future ? 'in' : 'about'} ${absDays} day${absDays === 1 ? '' : 's'}`;
    return `${weekday} ${datePart} · ${countdown}`;
}

/**
 * Renders an error message in the Trakt container.
 * @param {string} message - Error description to display.
 * @returns {void}
 */
function renderError(message) {
    const app = document.getElementById('traktApp');
    if (!app) return;
    app.innerHTML = `<div class="glass-panel trakt-empty"><h2>Trakt error</h2><p>${escapeHtml(message)}</p></div>`;
}

window.openShowDetails = openShowDetails;
window.closeShowDetailsModal = closeShowDetailsModal;
window.openListEditModal = openListEditModal;
window.closeListEditModal = closeListEditModal;
window.submitListEdit = submitListEdit;
window.openSearchListModal = openSearchListModal;
window.closeSearchListModal = closeSearchListModal;
window.toggleShowDetailSeason = toggleShowDetailSeason;
window.toggleEpisodeFromShowDetails = toggleEpisodeFromShowDetails;
window.toggleSeasonFromShowDetails = toggleSeasonFromShowDetails;
window.toggleUnwatchedItemState = toggleUnwatchedItemState;
window.createList = createList;
window.deleteList = deleteList;
window.removeListItem = removeListItem;
window.toggleListItemWatched = toggleListItemWatched;
window.toggleSearchItemListMembership = toggleSearchItemListMembership;
window.toggleSearchItemWatched = toggleSearchItemWatched;
window.switchTab = switchTab;
window.syncTrakt = syncTrakt;
window.disconnectTrakt = disconnectTrakt;
window.toggleListCollapsed = toggleListCollapsed;
window.searchTrakt = searchTrakt;
window.openItemMoveModal = openItemMoveModal;
window.executeItemMove = executeItemMove;
window.debouncedSearch = debouncedSearch;
