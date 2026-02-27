// /public/js/default.js

/**
 * Rendler Industries - Global Utility Library
 * Centralizes common UI logic, AJAX helpers, and formatting.
 */

/**
 * Formats a Unix timestamp into a human-readable relative string.
 * @param {number} unix - Seconds since epoch.
 * @returns {string} - e.g., "5m ago", "2h 10m ago", "Just now"
 */
function getTimeSince(unix) {
    if (!unix) return "...";
    const diff = Math.floor(Date.now() / 1000) - unix;
    if (diff < -10) return "Scheduled";
    if (diff < 60) return "Just now";
    
    const minutes = Math.floor(diff / 60);
    if (minutes < 60) return `${minutes}m ago`;
    
    const hours = Math.floor(minutes / 60);
    const remainingMins = minutes % 60;
    if (hours < 24) return `${hours}h ${remainingMins}m ago`;
    
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h ago`;
}

/**
 * Formats a duration in milliseconds into a countdown string.
 * @param {number} ms - Milliseconds duration.
 */
function formatCountdown(ms) {
    if (ms <= 0) return 'Due now';
    const totalMins = Math.floor(ms / 60000);
    const days  = Math.floor(totalMins / 1440);
    const hours = Math.floor((totalMins % 1440) / 60);
    const mins  = totalMins % 60;
    
    if (days  > 0) return `in ${days}d ${hours}h`;
    if (hours > 0) return `in ${hours}h ${mins}m`;
    if (mins  > 0) return `in ${mins}m`;
    return 'Due now';
}

/**
 * Returns current local date/time in YYYY-MM-DDTHH:MM format.
 */
function getLocalISOString() {
    const now = new Date();
    const tzoffset = now.getTimezoneOffset() * 60000;
    return (new Date(now - tzoffset)).toISOString().slice(0, 16);
}

/**
 * Universal Modal Closing Logic.
 * Handles clicks on overlays to close visible modals.
 * @param {string[]} modalClasses - List of classes identifying modal overlays.
 * @param {function[]} closeCallbacks - Functions to call to close modals.
 */
function setupGlobalModalClosing(modalClasses = ['modal-overlay', 'delete-modal-overlay'], closeCallbacks = []) {
    window.addEventListener('click', (event) => {
        const isOverlay = modalClasses.some(cls => event.target.classList.contains(cls));
        if (isOverlay) {
            closeCallbacks.forEach(cb => {
                if (typeof cb === 'function') cb();
            });
        }
    });
}

/**
 * Simplifies standard AJAX POST requests with Toast feedback.
 * @param {string} url - Target endpoint.
 * @param {Object} data - Payload to send.
 * @returns {Promise<Object|null>} - Response JSON or null on failure.
 */
async function apiPost(url, data = {}) {
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(data)
        });
        
        const text = await response.text();
        let result;
        try {
            result = JSON.parse(text);
        } catch (e) {
            console.error('JSON Parse Error. Raw response:', text);
            throw new Error('Invalid JSON response');
        }

        if (result.success) {
            if (result.message) showToast(result.message, 'success');
            return result;
        } else {
            showToast(result.error || 'Action failed', 'error');
            return null;
        }
    } catch (err) {
        console.error('apiPost Error:', err);
        showToast('Network error', 'error');
        return null;
    }
}

/**
 * Displays a global fullscreen loading overlay with customizable text.
 * @param {string} text - Primary loading message.
 * @param {string} subtext - Secondary detail message.
 */
function showLoadingOverlay(text = 'Loading...', subtext = 'Please wait while we process your request.') {
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.id = 'global-loading-overlay';
    overlay.innerHTML = `
        <div class="loading-inner">
            <div class="loading-spinner-large"></div>
            <p class="loading-label">${text}</p>
            <p class="loading-sub">${subtext}</p>
        </div>
    `;
    document.body.appendChild(overlay);
}

/**
 * Removes the global loading overlay.
 */
function hideLoadingOverlay() {
    const overlay = document.getElementById('global-loading-overlay');
    if (overlay) overlay.remove();
}

/**
 * Returns HTML for a localized component loading state.
 * @param {string} text - Primary text.
 * @param {string} subtext - Secondary text.
 * @param {boolean} showScanner - Whether to include the scanning animation line.
 * @returns {string} - HTML string.
 */
function getLoadingHtml(text = 'Loading...', subtext = '', showScanner = false) {
    return `
        <div class="component-loading">
            ${showScanner ? '<div class="loading-scan-line"></div>' : ''}
            <span class="loading-icon-pulse">${getIcon('ai')}</span>
            <p class="loading-label">${text}</p>
            ${subtext ? `<p class="loading-sub">${subtext}</p>` : ''}
        </div>
    `;
}

/**
 * Themed Confirmation Modal Helper (Global)
 * @param {Object} options - { title, icon, message, danger, confirmText, loadingText, onConfirm }
 */
window.showConfirmModal = function(options) {
    const modal = document.getElementById('globalConfirmActionModal');
    const title = document.getElementById('globalConfirmModalTitle');
    const icon = document.getElementById('globalConfirmModalIcon');
    const text = document.getElementById('globalConfirmModalText');
    const btn = document.getElementById('globalConfirmModalBtn');

    if (!modal || !btn) return;

    if (title) title.textContent = options.title || 'Confirm Action';
    if (icon) icon.innerHTML = getIcon(options.icon || 'delete');
    if (text) text.innerHTML = options.message || 'Are you sure?';
    
    btn.textContent = options.confirmText || 'Confirm';
    btn.className = options.danger ? 'btn-danger-confirm' : 'btn-primary';
    btn.disabled = false;

    // Clone button to remove previous listeners
    const newBtn = btn.cloneNode(true);
    newBtn.disabled = false;
    btn.parentNode.replaceChild(newBtn, btn);

    newBtn.addEventListener('click', async () => {
        const originalHtml = newBtn.innerHTML;
        newBtn.disabled = true;
        newBtn.innerHTML = `${getIcon('waiting')} ${options.loadingText || 'Processing...'}`;
        try {
            await options.onConfirm();
            closeConfirmModal();
        } catch (err) {
            newBtn.disabled = false;
            newBtn.innerHTML = originalHtml;
            showToast('Action failed', 'error');
        }
    });
    modal.style.display = 'flex';
};

window.closeConfirmModal = function() {
    const modal = document.getElementById('globalConfirmActionModal');
    const btn = document.getElementById('globalConfirmModalBtn');
    if (modal) modal.style.display = 'none';
    if (btn) btn.disabled = false;
};

/**
 * --- Global Flip Clock Engine ---
 */

const FlipClockManager = {
    prevStates: {},

    /**
     * Renders or updates a 3D flip clock inside a container.
     * @param {HTMLElement} el - The container.
     * @param {Object} vals - { dd, hh, mm, ss } strings.
     * @param {string} id - Unique identifier for state tracking.
     */
    update: function(el, vals, id) {
        // Initialize state tracking
        if (!this.prevStates[id]) {
            this.prevStates[id] = vals;
            el.innerHTML = this._renderHTML(vals);
            return;
        }

        // Check each unit and trigger flip if changed
        Object.keys(vals).forEach(unit => {
            if (vals[unit] !== this.prevStates[id][unit]) {
                // For day hiding logic (Reminders specific)
                if (unit === 'dd' && ((vals.dd === 0 && this.prevStates[id].dd !== 0) || (vals.dd !== 0 && this.prevStates[id].dd === 0))) {
                    el.innerHTML = this._renderHTML(vals);
                } else {
                    this._triggerFlip(el, unit, vals[unit], this.prevStates[id][unit]);
                }
            }
        });

        this.prevStates[id] = vals;
    },

    _renderHTML: function(vals) {
        let html = '';
        if (vals.dd !== undefined && vals.dd > 0) html += this._renderUnit('dd', vals.dd, 'DD');
        if (vals.hh !== undefined) html += this._renderUnit('hh', vals.hh, 'HH');
        if (vals.mm !== undefined) html += this._renderUnit('mm', vals.mm, 'MM');
        if (vals.ss !== undefined) html += this._renderUnit('ss', vals.ss, 'SS');
        if (vals.ampm !== undefined) html += `<div class="flip-unit"><div class="flip-card ampm">${vals.ampm}</div><div class="flip-label">AM/PM</div></div>`;
        return html;
    },

    _renderUnit: function(unit, val, label) {
        return `
            <div class="flip-unit" data-unit="${unit}">
                <div class="flip-card">
                    <div class="flip-card-top">${val}</div>
                    <div class="flip-card-bottom">${val}</div>
                    <div class="flip-card-flap-front">${val}</div>
                    <div class="flip-card-flap-back">${val}</div>
                </div>
                <div class="flip-label">${label}</div>
            </div>
        `;
    },

    _triggerFlip: function(container, unit, newVal, oldVal) {
        const flipCard = container.querySelector(`.flip-unit[data-unit="${unit}"] .flip-card`);
        if (!flipCard) return;

        flipCard.classList.remove('flipping');
        void flipCard.offsetWidth;

        flipCard.querySelector('.flip-card-top').textContent = newVal;
        flipCard.querySelector('.flip-card-bottom').textContent = oldVal;
        flipCard.querySelector('.flip-card-flap-front').textContent = oldVal;
        flipCard.querySelector('.flip-card-flap-back').textContent = newVal;

        flipCard.classList.add('flipping');

        setTimeout(() => {
            flipCard.querySelector('.flip-card-bottom').textContent = newVal;
            flipCard.querySelector('.flip-card-flap-front').textContent = newVal;
            flipCard.classList.remove('flipping');
        }, 400);
    },

    /**
     * Starts a real-time normal clock (HH:MM:SS AM/PM) inside a container.
     */
    startRealTimeClock: function(el, id) {
        const tick = () => {
            const now = new Date();
            let h = now.getHours();
            const m = String(now.getMinutes()).padStart(2, '0');
            const s = String(now.getSeconds()).padStart(2, '0');
            const ampm = h >= 12 ? 'PM' : 'AM';
            h = h % 12 || 12;
            
            this.update(el, { 
                hh: String(h).padStart(2, '0'), 
                mm: m, 
                ss: s, 
                ampm: ampm 
            }, id);
        };
        tick();
        setInterval(tick, 1000);
    }
};

/**
 * --- Global Icon Registry ---
 * Mirrors the semantic names and symbols defined in lib/MyApp/Plugin/Icons.pm.
 */
const GLOBAL_ICONS = {
    // Actions
    'edit': '✎',
    'delete': '🗑️',
    'add': '➕',
    'save': '💾',
    'cancel': '❌',
    'view': '👁️',
    'copy': '📋',
    'check': '✅',
    'close': '×',
    'upload': '📤',
    'download': '📥',
    'settings': '⚙️',
    'bonus': '🎁',
    'crop': '✂️',
    'reset': '🔄',
    'vote': '👍',
    
    // Navigation / UI
    'home': '🏠',
    'menu': '☰',
    'user': '👤',
    'logout': '🚪',
    'search': '🔍',
    'back': '←',
    'clock': '🕒',
    'lock': '🔒',
    'calendar': '📅',
    'link': '🔗',
    'kangaroo': '🦘',
    'quick': '🚀',
    'uno': '🃏',
    'chess': '♟️',
    'chelsea': '🏖️',
    'phonebook': '📞',
    'clipboard': '📋',
    'login': '🔑',
    'register': '📝',
    'quiz': '❓',
    'admin': '🛡️',
    
    // Permissions
    'perm_admin': '🛡️',
    'perm_family': '👨‍👩‍👧‍👦',
    'perm_user': '👤',
    'perm_guest': '🌍',
    
    // Modules
    'family': '👨‍👩‍👧‍👦',
    'shopping': '🛒',
    'todo': '✅',
    'timers': '⏱️',
    'birthdays': '🎂',
    'swear': '🤬',
    'imposter': '🎭',
    'connect4': '🔴',
    'connect4_blue': '🔵',
    'meals': '🍽️',
    'files': '📁',
    'receipts': '🧾',
    'reminders': '🔔',
    'medication': '💊',
    'ai': '🧠',
    'expand': '▼',
    'collapse': '▲',
    'audio': '🔊',
    'shout': '📢',
    'idea': '💡',
    'draw': '🤝',
    'waiting': '⌛',
    'victory': '🎉',
    'loss': '💀',
    'trophy': '🏆',

    // Zodiac / Family
    'andrea': '🐀',
    'nick': '🐉',
    'nicky': '🐉',
    'thararat': '🐎',
    'rendler': '🐓',
    
    // Status
    'warning': '⚠️',
    'info': 'ℹ️',
    'success': '✅',
    'error': '❌',
    'running': '▶️',
    'paused': '⏸️',
    'idle': '⏺️',
};

/**
 * Global helper to retrieve an icon by its semantic name.
 * @param {string} name - Semantic icon name.
 * @returns {string} - The symbol or name if not found.
 */
window.getIcon = function(name) {
    return GLOBAL_ICONS[name.toLowerCase()] || name;
};
