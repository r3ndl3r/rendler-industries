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
    timers: []                      // Collection of active timer sessions
};

/**
 * Bootstraps the module state and establishes background lifecycles.
 * 
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', () => {
    // Initial fetch of the timer roster
    loadState();

    // High-resolution local UI loop
    setInterval(updateLocalTimers, CONFIG.TICK_INTERVAL_MS);

    // Background server synchronization
    setInterval(loadState, CONFIG.SYNC_INTERVAL_MS);
});

/**
 * --- Logic & UI Operations ---
 */

/**
 * Synchronizes the module state with the server.
 * 
 * @async
 * @returns {Promise<void>}
 */
async function loadState() {
    // Skip background refresh if a modal is active OR the user is typing in an input field.
    // This prevents overwriting user input or causing focus-loss jumps.
    const anyModalOpen = document.querySelector('.modal-overlay.active') || document.querySelector('.delete-modal-overlay.active');
    const inputFocused = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
    if ((anyModalOpen || inputFocused) && STATE.timers.length > 0) return;

    try {
        const response = await fetch('/timers/api/state');
        const data = await response.json();
        
        if (data && data.success) {
            STATE.timers = data.timers;
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
                <p>${getIcon('phone')} You don't have any timers set up yet.</p>
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
    const progress = t.limit_seconds > 0 ? (t.elapsed_seconds / t.limit_seconds * 100) : 0;
    const isExpired = t.remaining_seconds <= 0;
    
    const cat = t.category || '';
    const catClass = cat.toLowerCase().replace(' ', '-');
    const iconHtml = getIcon(catClass);

    return `
        <div class="timer-card" data-timer-id="${t.id}" data-status="${t.status_color}">
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
                <div class="status-fill ${t.status_color}" style="width: ${progress}%"></div>
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
                        ${t.remaining_seconds > 0 ? TimerUtils.formatTime(t.remaining_seconds) : (t.remaining_seconds < 0 ? `<span class="over-time">-${TimerUtils.formatTime(Math.abs(t.remaining_seconds))} OVER</span>` : 'EXPIRED')}
                    </span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Daily Limit:</span>
                    <span class="stat-value">${Math.floor(t.limit_seconds / 60)} minutes</span>
                </div>
                ${t.bonus_seconds > 0 ? `
                    <div class="stat-row bonus-indicator">
                        <span class="stat-label">${getIcon('bonus')} Bonus Time:</span>
                        <span class="stat-value">+${Math.floor(t.bonus_seconds / 60)} minutes</span>
                    </div>
                ` : ''}
            </div>

            <div class="timer-controls">
                ${t.is_running ? `
                    <button class="btn btn-pause" onclick="handlePause(${t.id}, this)">${getIcon('paused')} Pause</button>
                ` : (t.is_paused ? `
                    <button class="btn btn-pause paused" onclick="handlePause(${t.id}, this)">${getIcon('running')} Resume</button>
                ` : `
                    <button class="btn btn-start" onclick="handleStart(${t.id}, this)" ${isExpired ? 'disabled' : ''}>${getIcon('running')} Start</button>
                `)}
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
                        <span class="expired-icon">${getIcon('cancel')}</span>
                        <p>Time's Up!</p>
                        <small>Ask an admin for more time</small>
                    </div>
                </div>
            ` : ''}
        </div>
    `;
}

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
    btn.innerHTML = `${getIcon('waiting')} ...`;

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
    btn.innerHTML = `${getIcon('waiting')} ...`;

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
 * 
 * @returns {void}
 */
function updateLocalTimers() {
    let changed = false;
    STATE.timers.forEach(t => {
        if (t.is_running && !t.is_paused) {
            t.elapsed_seconds++;
            t.remaining_seconds = Math.max(-36000, t.remaining_seconds - 1);
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
                        if (t.remaining_seconds > 0) {
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

                    if (t.remaining_seconds <= 0 && !card.querySelector('.expired-overlay')) {
                        renderGrid(); // Trigger full render for overlay
                    }
                }
            }
        });
    }
}

/**
 * Sanitizes input for safe DOM injection.
 * 
 * @param {string} text - Raw input.
 * @returns {string} - Escaped output.
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * --- Global Exposure ---
 */
window.handleStart = handleStart;
window.handlePause = handlePause;
window.loadState = loadState;
