// /public/js/notifications.js

/**
 * Notification History Controller
 * 
 * Manages the administrative audit log for all system-outbound communications.
 * Uses a state-driven architecture with high-fidelity filtering and 
 * maintenance tools.
 * 
 * Features:
 * - Real-time debounced search and immediate dropdown filtering.
 * - Detail Modal for viewing full message bodies and error diagnostics.
 * - Individual record deletion and bulk pruning by retention period.
 * - Relative time formatting for scannability.
 * 
 * Dependencies:
 * - default.js: For apiPost, getIcon, setupGlobalModalClosing, and modal helpers.
 */

/**
 * --- Module Configuration & State ---
 */
const CONFIG = {
    DEBOUNCE_MS: 300,
    SYNC_INTERVAL_MS: 10000
};

let STATE = {
    logs: [],
    users: [],
    isAdmin: false
};

/**
 * Bootstraps the module state and establishes event delegation.
 * 
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', () => {
    loadState();

    // Event Delegation: Real-time Filtering
    const filterIds = ['filterSearch', 'filterType', 'filterStatus', 'filterUser', 'filterTime'];
    filterIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        
        const eventType = el.tagName === 'SELECT' ? 'change' : 'input';
        let debounceTimer;
        
        el.addEventListener(eventType, () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => loadState(), CONFIG.DEBOUNCE_MS);
        });
    });

    // Action: Filter Reset
    const resetBtn = document.getElementById('resetFilters');
    if (resetBtn) {
        resetBtn.onclick = () => {
            filterIds.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            loadState();
        };
    }

    // Modal: Global Closure Logic
    setupGlobalModalClosing(['modal-overlay'], [closeDetailModal, closePruneModal]);
    
    // Background Sync
    setInterval(() => loadState(), CONFIG.SYNC_INTERVAL_MS);
});

/**
 * --- Core Logic & API Operations ---
 */

/**
 * Synchronizes the ledger state with the server.
 * 
 * @async
 * @returns {Promise<void>}
 */
async function loadState() {
    const anyModalOpen = document.querySelector('.modal-overlay.show');
    const inputFocused = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');

    if (anyModalOpen || inputFocused) return;

    const filters = getActiveFilters();
    const params = new URLSearchParams(filters);

    try {
        const response = await fetch(`/notifications/api/state?${params.toString()}`);
        const data = await response.json();

        if (data.success) {
            STATE.logs = data.logs;
            STATE.users = data.users;
            renderLedger();
            updateFilterDropdowns();
        }
    } catch (err) {
        console.error('loadState failed:', err);
    }
}

/**
 * Renders the master notification ledger from current state.
 * 
 * @returns {void}
 */
function renderLedger() {
    const tbody = document.getElementById('notificationTableBody');
    if (!tbody) return;

    if (STATE.logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="ledger-empty">📭 No matching notification records found.</td></tr>';
        return;
    }

    tbody.innerHTML = STATE.logs.map(log => {
        const statusIcon = log.status === 'success' ? getIcon('success') : getIcon('error');
        const statusClass = log.status === 'success' ? 'text-green' : 'text-danger';
        const channelIcon = getIcon(log.type);
        const userEmoji = getIcon(log.username?.toLowerCase()) || getIcon('user');
        
        // Truncate message for snippet
        let snippet = log.message || '';
        if (snippet.length > 60) snippet = snippet.substring(0, 57) + '...';

        return `
            <tr id="log-row-${log.id}" class="log-row" onclick="viewDetails(${log.id})">
                <td class="col-status ${statusClass}" data-label="Status">${statusIcon}</td>
                <td class="col-time" data-label="Time"><small>${format_datetime(log.created_at)}</small></td>
                <td class="col-user" data-label="User">
                    <div class="user-pill-inline">
                        <span class="user-emoji">${userEmoji}</span>
                        <span class="user-name">${escapeHtml(log.username || 'System')}</span>
                    </div>
                </td>
                <td class="col-channel" data-label="Channel">
                    <span class="channel-label">${channelIcon} ${log.type.toUpperCase()}</span>
                </td>
                <td class="col-recipient" data-label="Recipient"><small>${escapeHtml(log.recipient)}</small></td>
                <td class="col-message" data-label="Message"><span class="message-snippet">${escapeHtml(snippet)}</span></td>
                <td class="col-actions" onclick="event.stopPropagation()">
                    <button class="btn-icon-delete" title="Delete Log" onclick="confirmDelete(${log.id})">
                        ${getIcon('delete')}
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * --- UI Component Handlers ---
 */

/**
 * Displays full notification metadata in a modal.
 * 
 * @param {number} id - Record identifier.
 * @returns {void}
 */
function viewDetails(id) {
    const log = STATE.logs.find(l => l.id == id);
    if (!log) return;

    const content = document.getElementById('detailContent');

    content.innerHTML = `
        <div class="detail-item full-width">
            <div class="detail-value message-full-box">${escapeHtml(log.message)}</div>
        </div>
    `;

    document.getElementById('detailModal').classList.add('show');
    document.body.classList.add('modal-open');
}

/**
 * Orchestrates the pruning tool interaction.
 * 
 * @async
 * @returns {Promise<void>}
 */
async function handlePruneSubmit() {
    const days = document.getElementById('pruneDays').value;
    
    showConfirmModal({
        title: 'Prune Logs',
        message: `Permanently delete all notification logs older than <strong>${days} days</strong>?`,
        danger: true,
        confirmText: 'Prune',
        hideCancel: true,
        onConfirm: async () => {
            const result = await apiPost('/notifications/api/prune', { days });
            if (result.success) {
                closePruneModal();
                loadState();
                showToast('Maintenance complete: logs pruned', 'success');
            }
        }
    });
}

/**
 * Orchestrates individual record removal.
 * 
 * @param {number} id - Record identifier.
 * @returns {void}
 */
function confirmDelete(id) {
    showConfirmModal({
        title: 'Delete Entry',
        message: 'Remove this notification record from the audit trail?',
        danger: true,
        confirmText: 'Delete Entry',
        hideCancel: true,
        onConfirm: async () => {
            const result = await apiPost(`/notifications/api/delete/${id}`);
            if (result.success) {
                loadState();
                showToast('Entry removed', 'success');
            }
        }
    });
}

/**
 * --- Utility Helpers ---
 */

function getActiveFilters() {
    return {
        search:  document.getElementById('filterSearch')?.value || '',
        type:    document.getElementById('filterType')?.value || '',
        status:  document.getElementById('filterStatus')?.value || '',
        user_id: document.getElementById('filterUser')?.value || '',
        days:    document.getElementById('filterTime')?.value || ''
    };
}

function updateFilterDropdowns() {
    const userSel = document.getElementById('filterUser');
    if (!userSel) return;

    const currentVal = userSel.value;
    userSel.innerHTML = '<option value="">All Users</option>' + 
        STATE.users.map(u => `<option value="${u.id}" ${u.id == currentVal ? 'selected' : ''}>${escapeHtml(u.username)}</option>`).join('');
}

function closeDetailModal() {
    document.getElementById('detailModal').classList.remove('show');
    document.body.classList.remove('modal-open');
}

function openPruneModal() {
    document.getElementById('pruneModal').classList.add('show');
    document.body.classList.add('modal-open');
}

function closePruneModal() {
    document.getElementById('pruneModal').classList.remove('show');
    document.body.classList.remove('modal-open');
}

// Global Exposure
window.openPruneModal = openPruneModal;
window.closePruneModal = closePruneModal;
window.closeDetailModal = closeDetailModal;
window.handlePruneSubmit = handlePruneSubmit;
window.confirmDelete = confirmDelete;
window.viewDetails = viewDetails;
