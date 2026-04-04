// /public/js/points.js

/**
 * Points Management Controller Logic
 * 
 * Orchestrates administrative oversight of the global child point ledger.
 * Features:
 * - Real-time state synchronization via REST API.
 * - Pattern B (Dashboard) wallet visualization.
 * - Pattern A (Ledger) transaction auditing.
 * - Secure atomic point mutations.
 * 
 * Dependencies:
 * - default.js: for apiPost, getIcon, escapeHtml, and modal closing logic.
 */

let STATE = {
    balances: [],
    history: []
};

/**
 * Bootstrap module initialization.
 * Attaches global listeners and triggers the primary state fetch.
 */
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    
    // Background Lifecycle: Synchronize ledger state every 5 seconds
    // Inhibition: Handled within loadState to prevent UI jumps during interaction
    setInterval(() => loadState(), 5000);
    
    setupGlobalModalClosing(['modal-overlay'], [closeTransactionModal]);
});

/**
 * Synchronizes the local STATE object with the remote database.
 * 
 * @param {boolean} [force=false] - If true, bypasses inhibition checks.
 * @returns {Promise<void>}
 */
async function loadState(force = false) {
    // Background Sync Inhibition: Prevent state jumps during user interaction
    // Only bypass if 'force' is true (typically from manual action handlers)
    if (!force) {
        if (document.querySelector('.modal-overlay.show')) return;
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    }

    try {
        const response = await fetch('/points/api/state', {
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });

        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        
        const data = await response.json();
        
        if (data.error) {
            showToast(data.error, 'error');
            return;
        }

        STATE = data;
        renderUI();
        
        // Visibility Standard: Purge direct .style manipulation
        document.getElementById('points-loading').classList.add('hidden');
        document.getElementById('points-content').classList.remove('hidden');
    } catch (err) {
        console.error('Points: Failed to load state:', err);
        showToast('Ledger synchronization failed', 'error');
    }
}

/**
 * Master UI rendering engine.
 * Dispatches updates to specific layout components.
 * 
 * @returns {void}
 */
function renderUI() {
    renderWallets();
    renderHistory();
}

/**
 * Renders Pattern B (Dashboard) child wallet cards.
 * 
 * @returns {void}
 */
function renderWallets() {
    const container = document.getElementById('wallets-container');
    container.innerHTML = '';

    if (!STATE.balances || STATE.balances.length === 0) {
        container.innerHTML = `<div class="empty-state">${window.getIcon('info')} No child accounts found.</div>`;
        return;
    }

    STATE.balances.forEach(child => {
        const div = document.createElement('div');
        div.className = 'wallet-card';
        
        const userIcon = window.getIcon(child.username);
        // Security: XSS Prevention via escapeHtml
        const escapedName = escapeHtml(child.username);
        const displayName = userIcon ? `${userIcon} ${escapedName}` : escapedName;
        
        const balanceClass = parseInt(child.current_points) >= 0 ? 'amount-positive' : 'amount-negative';
        
        div.innerHTML = `
            <div class="wallet-username">${displayName}</div>
            <div class="wallet-balance ${balanceClass}">${window.getIcon('coin')} ${parseInt(child.current_points).toLocaleString()}</div>
            <div class="wallet-actions">
                <button type="button" class="btn-success" onclick="openTransactionModal(${child.id}, '${escapedName}', 'reward')">
                    ${window.getIcon('add')} ADD
                </button>
                <button type="button" class="btn-danger" onclick="openTransactionModal(${child.id}, '${escapedName}', 'deduct')">
                    ${window.getIcon('minus')} DEDUCT
                </button>
            </div>
        `;
        container.appendChild(div);
    });
}

/**
 * Renders Pattern A (Ledger) transaction auditing table.
 * 
 * @returns {void}
 */
function renderHistory() {
    const tbody = document.getElementById('history-body');
    tbody.innerHTML = '';

    if (!STATE.history || STATE.history.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center">${window.getIcon('history')} No transaction history available.</td></tr>`;
        return;
    }

    STATE.history.forEach(tx => {
        const tr = document.createElement('tr');
        
        // Temporal Logic: Utilize SQL formatter from default.js
        const dateStr = window.format_datetime(tx.created_at);
        const amountClass = parseInt(tx.amount) > 0 ? 'amount-positive' : 'amount-negative';
        const formattedAmount = parseInt(tx.amount) > 0 ? `+${tx.amount}` : tx.amount;
        
        const userIcon = window.getIcon(tx.username);
        const escapedName = escapeHtml(tx.username);
        const displayName = userIcon ? `${userIcon} ${escapedName}` : escapedName;
        
        tr.innerHTML = `
            <td data-label="User"><strong>${displayName}</strong></td>
            <td data-label="Time">${dateStr}</td>
            <td data-label="Reason">${escapeHtml(tx.reason)}</td>
            <td data-label="Amount" class="${amountClass} text-right">${formattedAmount}</td>
        `;
        tbody.appendChild(tr);
    });
}

/**
 * Prepares and displays the transaction entry modal.
 * 
 * @param {number} userId - Target child identifier.
 * @param {string} username - Target child name.
 * @param {string} type - 'reward' | 'deduct'
 * @returns {void}
 */
function openTransactionModal(userId, username, type) {
    document.getElementById('targetUserId').value = userId;
    document.getElementById('transactionType').value = type;
    
    const title = document.getElementById('modalTitle');
    title.innerHTML = `${window.getIcon('coin')} ${type.toUpperCase()} for ${escapeHtml(username)}`;
    
    document.getElementById('transactionAmount').value = (type === 'reward' ? '1' : '');
    document.getElementById('transactionReason').value = '';
    
    const btn = document.getElementById('saveTransactionBtn');
    if (type === 'reward') {
        btn.className = 'btn-success';
        btn.innerHTML = `${window.getIcon('save')} ADD`;
    } else {
        btn.className = 'btn-danger';
        btn.innerHTML = `${window.getIcon('save')} DEDUCT`;
    }
    
    document.getElementById('transactionModal').classList.add('show');
    document.body.classList.add('modal-open');
    setTimeout(() => document.getElementById('transactionAmount').focus(), 100);
}

/**
 * Dismisses the transaction entry modal and cleans up the UI state.
 * 
 * @returns {void}
 */
function closeTransactionModal() {
    document.getElementById('transactionModal').classList.remove('show');
    document.body.classList.remove('modal-open');
}

/**
 * Submits the transaction to the server and refreshes the local state.
 * 
 * @param {Event} event - DOM Submit Event.
 * @returns {Promise<void>}
 */
async function submitTransaction(event) {
    event.preventDefault();
    
    const btn = document.getElementById('saveTransactionBtn');
    const originalHtml = btn.innerHTML;
    
    const userId = document.getElementById('targetUserId').value;
    const type = document.getElementById('transactionType').value;
    let amount = parseInt(document.getElementById('transactionAmount').value, 10);
    const reason = document.getElementById('transactionReason').value.trim();
    
    if (isNaN(amount) || amount <= 0) {
        showToast('Please enter a valid positive amount.', 'error');
        return;
    }
    if (!reason) {
        showToast('Please provide a reason.', 'error');
        return;
    }
    
    // Normalize direction based on action type
    if (type === 'deduct') amount = -Math.abs(amount);

    btn.disabled = true;
    btn.innerHTML = `${window.getIcon('waiting')} Saving...`;

    try {
        const data = await apiPost('/points/api/add', {
            user_id: userId,
            amount: amount,
            reason: reason
        });

        if (!data) return; // Error handled by apiPost

        showToast('Points adjusted successfully!', 'success');
        STATE.balances = data.balances;
        STATE.history = data.history;
        renderUI();
        closeTransactionModal();
    } catch (err) {
        console.error('Points: Submission failed:', err);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}