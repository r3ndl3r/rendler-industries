// /public/js/timers/dashboard.js

/**
 * Timer Dashboard Controller
 * 
 * Manages the real-time device usage timer interface using a state-driven 
 * architecture. It coordinates high-resolution local countdowns with 
 * synchronized server status reconciliation to ensure accuracy.
 * 
 * Features:
 * - Real-time local countdowns (1000ms resolution)
 * - Server-side synchronization (10s frequency)
 * - Point-to-Time redemption for child accounts (1 pt = 10 mins)
 * - Interactive Start/Pause controls with optimistic state updates
 * - Dynamic progress visualization and daily limit enforcement
 * - Integrated expiry overlays for exhaustive sessions
 * - Lifecycle-aware button states for operation feedback
 * 
 * Dependencies:
 * - default.js: For apiPost, getIcon, setupGlobalModalClosing, and modal helpers
 * - timers/utils.js: For formatting and progress calculation
 */

/**
 * --- Module Configuration & State ---
 */
const CONFIG = {
    SYNC_INTERVAL_MS: 10000,         // Server reconciliation frequency
    TICK_INTERVAL_MS: 1000          // Local UI resolution
};

let STATE = {
    timers: [],                     // Collection of active timer sessions
    user_points: 0,                 // Current point balance (for children)
    is_child: false                 // Role-based functionality toggle
};

/**
 * Bootstraps the module state and establishes background lifecycles.
 * 
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', () => {
    // Initial fetch of the timer roster and points
    loadState();

    // High-resolution local UI loop for smooth countdowns
    setInterval(updateLocalTimers, CONFIG.TICK_INTERVAL_MS);

    // Background server synchronization
    setInterval(loadState, CONFIG.SYNC_INTERVAL_MS);

    // Global modal closure integration
    setupGlobalModalClosing(['modal-overlay'], [closeRedeemModal]);
});

/**
 * --- Logic & UI Operations ---
 */

/**
 * Synchronizes the module state with the server.
 * 
 * @async
 * @param {boolean} force - Whether to bypass interaction-aware inhibition.
 * @returns {Promise<void>}
 */
async function loadState(force = false) {
    // Skip background refresh if a modal is active or the user is typing
    const anyModalOpen = document.querySelector('.modal-overlay.show, .delete-modal-overlay.show');
    const inputFocused = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');

    if (!force && (anyModalOpen || inputFocused)) return;

    try {
        const response = await fetch('/timers/api/state');
        const data = await response.json();
        
        if (data && data.success) {
            STATE.timers = data.timers;
            STATE.user_points = data.user_points || 0;
            STATE.is_child = !!data.is_child;
            renderGrid();
        }
    } catch (err) {
        console.error('loadState failed:', err);
    }
}

/**
 * Orchestrates the generation of the timer dashboard components.
 * 
 * @returns {void}
 */
function renderGrid() {
    const container = document.getElementById('timersGrid');
    if (!container) return;

    if (STATE.timers.length === 0) {
        container.innerHTML = `
            <div class="no-timers">
                <p>📱 You don't have any timers set up yet.</p>
                <p>Contact an admin to create timers for you.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = STATE.timers.map(timer => renderTimerCard(timer)).join('');
}

/**
 * Generates the HTML fragment for a single timer session card.
 * 
 * @param {Object} t - Timer record metadata.
 * @returns {string} - Rendered HTML.
 */
function renderTimerCard(t) {
    const isUnlimited = t.limit_seconds === -1;
    const progress = (isUnlimited || t.limit_seconds <= 0) ? 0 : (t.elapsed_seconds / t.limit_seconds * 100);
    const isExpired = !isUnlimited && t.remaining_seconds <= 0;
    
    const cat = t.category || '';
    const catClass = cat.toLowerCase().replace(' ', '-');
    const iconHtml = {
        'work': '💼',
        'school': '🎓',
        'gaming': '🎮',
        'screen': '📱',
        'ai': '🧠'
    }[catClass] || '🕒';

    return `
        <div class="timer-card" data-timer-id="${t.id}" data-status="${isUnlimited ? 'green' : t.status_color}">
            <div class="timer-card-header">
                <div class="timer-icon ${catClass}">
                    ${iconHtml}
                </div>
                <div class="timer-title-group">
                    <h3 class="timer-name">${escapeHtml(t.name)}</h3>
                    <span class="timer-category">${escapeHtml(t.category)}</span>
                </div>
            </div>

            <div class="timer-status-bar">
                <div class="status-fill ${isUnlimited ? 'green' : t.status_color}" style="width: ${progress}%"></div>
            </div>

            <div class="timer-stats">
                <div class="stat-row">
                    <span class="stat-label">Time Used:</span>
                    <span class="stat-value elapsed-time" data-seconds="${t.elapsed_seconds}">
                        ${TimerUtils.formatTime(t.elapsed_seconds)}
                    </span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Remaining:</span>
                    <span class="stat-value remaining-time ${isExpired ? 'expired' : ''}" data-seconds="${t.remaining_seconds}">
                        ${isUnlimited ? '-' : (t.remaining_seconds > 0 ? TimerUtils.formatTime(t.remaining_seconds) : (t.remaining_seconds < 0 ? `<span class="over-time">-${TimerUtils.formatTime(Math.abs(t.remaining_seconds))} OVER</span>` : 'EXPIRED'))}
                    </span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Daily Limit:</span>
                    <span class="stat-value">${isUnlimited ? 'Unlimited' : `${Math.floor(t.limit_seconds / 60)} minutes`}</span>
                </div>
                ${t.bonus_seconds > 0 && !isUnlimited ? `
                    <div class="stat-row bonus-indicator">
                        <span class="stat-label">⭐ Bonus Time:</span>
                        <span class="stat-value">+${Math.floor(t.bonus_seconds / 60)} minutes</span>
                    </div>
                ` : ''}
            </div>

            <div class="timer-controls">
                ${t.is_running ? `
                    <button class="btn btn-pause" onclick="handlePause(${t.id}, this)">⏸️ Pause</button>
                ` : (t.is_paused ? `
                    <button class="btn btn-pause paused" onclick="handlePause(${t.id}, this)">▶️ Resume</button>
                ` : `
                    <button class="btn btn-start" onclick="handleStart(${t.id}, this)" 
                            style="${isExpired ? 'display: none;' : ''}"
                            ${isExpired ? 'disabled' : ''}>
                        ▶️ Start
                    </button>
                `)}
                
                ${STATE.is_child && !isUnlimited ? `
                    <button class="btn-redeem-small" onclick="openRedeemModal(${t.id}, '${escapeHtml(t.name)}')">
                        ⭐ Redeem
                    </button>
                ` : ''}
            </div>

            ${t.is_running ? `
                <div class="running-indicator">
                    <span class="pulse-dot"></span>
                    RUNNING
                </div>
            ` : ''}

            ${isExpired ? `
                <div class="expired-overlay">
                    <div class="expired-message">
                        <span class="expired-icon">❌</span>
                        <p>Time's Up!</p>
                        <small>Ask an admin for more time</small>
                    </div>
                </div>
            ` : ''}
        </div>
    `;
}

/**
 * --- Point Redemption Logic ---
 */

/**
 * Prepares and displays the point redemption interface.
 * 
 * @param {number} timerId - ID of the timer to boost.
 * @param {string} timerName - Readable name for UI feedback.
 * @returns {void}
 */
function openRedeemModal(timerId, timerName) {
    document.getElementById('redeemTimerId').value = timerId;
    document.getElementById('calcTimerName').innerText = timerName;
    document.getElementById('userBalanceDisplay').innerText = `${STATE.user_points} pts`;
    document.getElementById('redeemPoints').value = 1;
    updateRedeemCalculation();
    
    document.getElementById('redeemModal').classList.add('show');
    document.body.classList.add('modal-open');
}

/**
 * Hides the point redemption interface and restores scroll.
 * 
 * @returns {void}
 */
function closeRedeemModal() {
    const m = document.getElementById('redeemModal');
    if (m) m.classList.remove('show');
    document.body.classList.remove('modal-open');
}

/**
 * Updates the visual calculation preview (1pt = 10m).
 * Validates against current user balance.
 * 
 * @returns {void}
 */
function updateRedeemCalculation() {
    const pts = parseInt(document.getElementById('redeemPoints').value) || 0;
    const mins = pts * 10;
    document.getElementById('calcMinutes').innerText = mins;
    
    const btn = document.getElementById('confirmRedeemBtn');
    if (pts > STATE.user_points || pts <= 0) {
        btn.disabled = true;
        btn.classList.add('disabled');
    } else {
        btn.disabled = false;
        btn.classList.remove('disabled');
    }
}

/**
 * Executes the point-to-time atomic exchange.
 * 
 * @async
 * @param {Event} event - Form submission.
 * @returns {Promise<void>}
 */
async function handleRedeemSubmit(event) {
    event.preventDefault();
    const btn = document.getElementById('confirmRedeemBtn');
    const formData = new FormData(event.target);
    
    btn.disabled = true;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = `⌛ Redeeming...`;

    try {
        const result = await apiPost('/timers/api/redeem', formData);
        if (result && result.success) {
            closeRedeemModal();
            loadState(true); // Force state refresh to update points/time
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * --- Timer Control Logic ---
 */

/**
 * Initiates a timer session and reconciles local state.
 * 
 * @async
 * @param {number} timerId - Target identifier.
 * @param {HTMLElement} btn - Triggering button.
 * @returns {Promise<void>}
 */
async function handleStart(timerId, btn) {
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `⌛ ...`;

    const result = await apiPost('/timers/api/start', { timer_id: timerId });
    if (result && result.success) {
        const t = STATE.timers.find(item => item.id == timerId);
        if (t) {
            t.is_running = 1;
            t.is_paused = 0;
            renderGrid();
        }
    } else {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * Toggles the pause state of a session and reconciles local state.
 * 
 * @async
 * @param {number} timerId - Target identifier.
 * @param {HTMLElement} btn - Triggering button.
 * @returns {Promise<void>}
 */
async function handlePause(timerId, btn) {
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `⌛ ...`;

    const result = await apiPost('/timers/api/pause', { timer_id: timerId });
    if (result && result.success) {
        const t = STATE.timers.find(item => item.id == timerId);
        if (t) {
            t.is_paused = !t.is_paused;
            t.is_running = t.is_paused ? 0 : 1;
            renderGrid();
        }
    } else {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

/**
 * High-resolution background loop for local time increments.
 * Manages countdown labels and progress bars between server syncs.
 * 
 * @returns {void}
 */
function updateLocalTimers() {
    let changed = false;
    STATE.timers.forEach(t => {
        if (t.is_running && !t.is_paused) {
            t.elapsed_seconds++;
            if (t.limit_seconds !== -1) {
                t.remaining_seconds = Math.max(-36000, t.remaining_seconds - 1);
            }
            changed = true;
        }
    });

    if (changed) {
        // Optimization: update labels directly to avoid full grid re-render every second
        STATE.timers.forEach(t => {
            if (t.is_running && !t.is_paused) {
                const card = document.querySelector(`.timer-card[data-timer-id="${t.id}"]`);
                if (card) {
                    const elapsedEl = card.querySelector('.elapsed-time');
                    const remainingEl = card.querySelector('.remaining-time');
                    const progressBar = card.querySelector('.status-fill');

                    if (elapsedEl) elapsedEl.textContent = TimerUtils.formatTime(t.elapsed_seconds);
                    if (remainingEl) {
                        if (t.limit_seconds === -1) {
                            remainingEl.textContent = '-';
                        } else if (t.remaining_seconds > 0) {
                            remainingEl.textContent = TimerUtils.formatTime(t.remaining_seconds);
                        } else {
                            remainingEl.innerHTML = `<span class="over-time">-${TimerUtils.formatTime(Math.abs(t.remaining_seconds))} OVER</span>`;
                            remainingEl.classList.add('expired');
                        }
                    }
                    if (progressBar) {
                        const progress = t.limit_seconds > 0 ? (t.elapsed_seconds / t.limit_seconds * 100) : 0;
                        progressBar.style.width = `${progress}%`;
                    }

                    if (t.limit_seconds !== -1 && t.remaining_seconds <= 0 && !card.querySelector('.expired-overlay')) {
                        renderGrid(); // Trigger full render for overlay
                    }
                }
            }
        });
    }
}

/**
 * --- Global Exposure ---
 */
window.handleStart = handleStart;
window.handlePause = handlePause;
window.loadState = loadState;
window.openRedeemModal = openRedeemModal;
window.closeRedeemModal = closeRedeemModal;
window.updateRedeemCalculation = updateRedeemCalculation;
window.handleRedeemSubmit = handleRedeemSubmit;
