// /public/js/emojis.js

/**
 * Emoji Management Controller
 * 
 * This module manages the semantic emoji dictionary and background processing state.
 * It provides tools for dictionary curation and AI "hallucination" testing.
 * 
 * Features:
 * - Real-time monitoring of module processing queues.
 * - Searchable and paginated ledger of learned mappings.
 * - Interactive AI Sandbox for training and seeding.
 * 
 * Dependencies:
 * - default.js: For apiPost, getIcon, showToast, and modal management.
 */

const CONFIG = {
    LIMIT: 20,
    DEBOUNCE_MS: 300
};

let STATE = {
    stats: {},
    dictionary: [],
    offset: 0,
    search: '',
    isLoading: false
};

/**
 * Bootstraps the module state and establishes event delegation.
 * 
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', () => {
    loadState(true);

    // Search Logic (Debounced)
    let searchTimer;
    const searchInput = document.getElementById('dictSearch');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                STATE.search = e.target.value;
                STATE.offset = 0;
                loadState(true);
            }, CONFIG.DEBOUNCE_MS);
        });
    }

    // Pagination
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', loadMore);
    }

    // Use event delegation for dynamic dictionary rows
    // This prevents long strings from breaking onclick attributes in the DOM
    const tableBody = document.getElementById('dictionaryTableBody');
    if (tableBody) {
        tableBody.addEventListener('click', (e) => {
            const editBtn = e.target.closest('.btn-icon-edit');
            const deleteBtn = e.target.closest('.btn-icon-delete');

            if (editBtn) {
                const keyword = editBtn.dataset.keyword;
                const emoji = editBtn.dataset.emoji;
                openEditEntryModal(keyword, emoji);
            } else if (deleteBtn) {
                const keyword = deleteBtn.dataset.keyword;
                confirmDeleteEntry(keyword);
            }
        });
    }
});

/**
 * --- API Handlers ---
 */

/**
 * Synchronizes the module state with the server (Single Source of Truth).
 * 
 * @async
 * @param {boolean} force - Whether to bypass sync inhibition guards.
 * @returns {Promise<void>}
 */
async function loadState(force = false) {
    const anyModalOpen = document.querySelector('.modal-overlay.show, .modal-overlay.active, .delete-modal-overlay.show, .delete-modal-overlay.active');
    const inputFocused = document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA';
    if (!force && (anyModalOpen || inputFocused)) return;

    if (STATE.isLoading) return;
    STATE.isLoading = true;

    try {
        const response = await fetch(`/emojis/api/state?search=${encodeURIComponent(STATE.search)}`);
        const data = await response.json();

        if (data.success) {
            STATE.stats = data.stats;
            STATE.dictionary = data.dictionary;
            STATE.offset = STATE.dictionary.length;

            renderStats();
            renderDictionary(false);
            
            const loading = document.getElementById('mainLoadingState');
            const content = document.getElementById('mainContent');
            if (loading && content) {
                loading.classList.add('hidden');
                content.classList.remove('hidden');
            }

            const container = document.getElementById('paginationContainer');
            if (container) {
                const hasMore = data.dictionary.length >= CONFIG.LIMIT;
                container.classList.toggle('hidden', !hasMore);
            }
        }
    } catch (err) {
        console.error("loadState failed:", err);
    } finally {
        STATE.isLoading = false;
    }
}

/**
 * Appends subsequent pages of dictionary data to the active ledger.
 * 
 * @async
 * @returns {Promise<void>}
 */
async function loadMore() {
    const btn = document.getElementById('loadMoreBtn');
    if (!btn || STATE.isLoading) return;

    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Loading...`;
    STATE.isLoading = true;

    try {
        const params = new URLSearchParams({
            offset: STATE.offset,
            limit: CONFIG.LIMIT,
            search: STATE.search
        });
        const response = await fetch(`/emojis/api/list?${params.toString()}`);
        const data = await response.json();

        if (data.success) {
            STATE.dictionary = [...STATE.dictionary, ...data.dictionary];
            renderDictionary(true, data.dictionary);
            STATE.offset = STATE.dictionary.length;
            
            const container = document.getElementById('paginationContainer');
            if (container) container.classList.toggle('hidden', !data.has_more);
        }
    } catch (err) {
        console.error("loadMore failed:", err);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
        STATE.isLoading = false;
    }
}

/**
 * Processes the creation or update of a dictionary mapping.
 * 
 * @async
 * @param {Event} e - Form submission event.
 * @returns {Promise<void>}
 */
async function handleEntrySubmit(e) {
    if (e) e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    
    const btn = form.querySelector('button[type="submit"]');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Saving...`;

    try {
        const result = await apiPost('/emojis/api/update', formData);
        if (result && result.success) {
            closeEntryModal();
            loadState(true);
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Orchestrates the removal of a dictionary entry with confirmation.
 * 
 * @param {string} keyword - The dictionary key to remove.
 * @returns {void}
 */
function confirmDeleteEntry(keyword) {
    showConfirmModal({
        title: 'Remove Mapping',
        message: `Permanently remove the semantic mapping for "<strong>${escapeHtml(keyword)}</strong>"?`,
        danger: true,
        confirmText: 'Remove',
        onConfirm: async () => {
            const result = await apiPost('/emojis/api/delete', new URLSearchParams({ keyword }));
            if (result && result.success) {
                loadState(true);
            }
        }
    });
}

/**
 * --- AI Sandbox Logic ---
 */

/**
 * Queries the AI engine to predict an emoji for the sandbox input.
 * 
 * @async
 * @returns {Promise<void>}
 */
async function testAI() {
    const text = document.getElementById('sandboxText').value.trim();
    if (!text) return showToast('Enter text to test', 'warning');

    const btn = document.getElementById('btnTestAI');
    const resultArea = document.getElementById('sandboxResult');
    const saveBtn = document.getElementById('btnSaveSandbox');
    
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Predicting...`;
    
    resultArea.classList.remove('empty');
    resultArea.innerHTML = `<span class="predicting-text">${getIcon('ai')} AI is thinking...</span>`;
    saveBtn.classList.add('hidden');

    try {
        const result = await apiPost('/emojis/api/test', new URLSearchParams({ text }));
        if (result && result.success) {
            resultArea.innerHTML = `<span class="emoji-result">${escapeHtml(result.emoji)}</span>`;
            saveBtn.classList.remove('hidden');
            saveBtn.dataset.emoji = result.emoji;
            saveBtn.dataset.text = text;
        } else {
            resultArea.innerHTML = `<span class="error-text">${getIcon('error')} ${escapeHtml(result.error || 'Prediction failed')}</span>`;
        }
    } catch (err) {
        resultArea.innerHTML = `<span class="error-text">Network error during prediction</span>`;
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Persists a successful AI sandbox prediction to the permanent dictionary.
 * 
 * @async
 * @returns {Promise<void>}
 */
async function saveSandboxResult() {
    const btn = document.getElementById('btnSaveSandbox');
    const text = btn.dataset.text;
    const emoji = btn.dataset.emoji;

    const result = await apiPost('/emojis/api/update', new URLSearchParams({ keyword: text, emoji: emoji }));
    if (result && result.success) {
        loadState(true);
        // Clear sandbox
        document.getElementById('sandboxText').value = '';
        document.getElementById('sandboxResult').innerHTML = '<span class="placeholder-text">Prediction will appear here...</span>';
        document.getElementById('sandboxResult').classList.add('empty');
        btn.classList.add('hidden');
    }
}

/**
 * --- Renderers ---
 */

/**
 * Generates the system status tiles.
 * 
 * @returns {void}
 */
function renderStats() {
    const container = document.getElementById('statsContainer');
    if (!container) return;

    container.innerHTML = `
        <div class="stat-card main">
            <span class="stat-icon">${getIcon('ai')}</span>
            <div class="stat-info">
                <span class="stat-label">Learned Mappings</span>
                <span class="stat-value">${STATE.stats.learned_count || 0}</span>
            </div>
        </div>
        <div class="stat-card ${STATE.stats.total_pending > 0 ? 'warning' : 'success'}">
            <span class="stat-icon">${getIcon('waiting')}</span>
            <div class="stat-info">
                <span class="stat-label">Pending Queue</span>
                <span class="stat-value">${STATE.stats.total_pending || 0}</span>
            </div>
        </div>
        <div class="stat-card info">
            <span class="stat-icon">${getIcon('reminders')}</span>
            <div class="stat-info">
                <span class="stat-label">Module Coverage</span>
                <span class="stat-value">5 Modules</span>
            </div>
        </div>
    `;
}

/**
 * Generates the dictionary ledger table from current state.
 * 
 * @param {boolean} append - Whether to preserve existing rows.
 * @param {Array|null} items - Subset of items for incremental updates.
 * @returns {void}
 */
function renderDictionary(append = false, items = null) {
    const tbody = document.getElementById('dictionaryTableBody');
    if (!tbody) return;

    const list = append ? items : STATE.dictionary;
    
    if (!append && list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center p-4">No dictionary entries found.</td></tr>';
        return;
    }

    const html = list.map(entry => `
        <tr class="row-fade-in">
            <td class="col-icon text-center" data-label="Emoji"><span class="emoji-display">${escapeHtml(entry.emoji)}</span></td>
            <td class="col-keyword" data-label="Keyword"><strong>${escapeHtml(entry.keyword)}</strong></td>
            <td data-label="Learned At"><small>${formatDate(entry.created_at)}</small></td>
            <td class="col-actions" data-label="Actions">
                <div class="action-buttons">
                    <button class="btn-icon-edit" 
                            data-keyword="${escapeHtml(entry.keyword)}" 
                            data-emoji="${escapeHtml(entry.emoji)}"
                            title="Edit">
                        ${getIcon('edit')}
                    </button>
                    <button class="btn-icon-delete" 
                            data-keyword="${escapeHtml(entry.keyword)}"
                            title="Delete">
                        ${getIcon('delete')}
                    </button>
                </div>
            </td>
        </tr>
    `).join('');

    if (append) tbody.insertAdjacentHTML('beforeend', html);
    else tbody.innerHTML = html;
}

/**
 * --- Modals ---
 */

/**
 * Displays the entry creation interface.
 * 
 * @returns {void}
 */
function openAddEntryModal() {
    document.getElementById('modalTitle').textContent = 'Add Dictionary Entry';
    document.getElementById('entryForm').reset();
    document.getElementById('entryKeyword').readOnly = false;
    document.getElementById('entryModal').classList.add('show');
}

/**
 * Pre-fills and displays the entry editor.
 * 
 * @param {string} keyword - Existing keyword.
 * @param {string} emoji - Existing emoji.
 * @returns {void}
 */
function openEditEntryModal(keyword, emoji) {
    document.getElementById('modalTitle').textContent = 'Edit Mapping';
    document.getElementById('entryKeyword').value = keyword;
    document.getElementById('entryKeyword').readOnly = true; // Keyword is the PK
    document.getElementById('entryEmoji').value = emoji;
    document.getElementById('entryModal').classList.add('show');
}

/**
 * Hides the entry editor modal.
 * 
 * @returns {void}
 */
function closeEntryModal() {
    document.getElementById('entryModal').classList.remove('show');
}

/**
 * --- Utils ---
 */

/**
 * Sanitizes input for DOM safety.
 * 
 * @param {string} text - Unsafe input.
 * @returns {string} - Escaped output.
 */
function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Normalizes SQL timestamps to user-friendly strings.
 * 
 * @param {string} dateStr - SQL timestamp.
 * @returns {string} - Formatted date.
 */
function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr.replace(/-/g, '/'));
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

window.openAddEntryModal = openAddEntryModal;
window.closeEntryModal = closeEntryModal;
window.handleEntrySubmit = handleEntrySubmit;
window.testAI = testAI;
window.saveSandboxResult = saveSandboxResult;
