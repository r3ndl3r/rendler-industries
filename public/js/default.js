// /public/js/default.js

/**
 * Global Utility Module
 * 
 * This module centralizes universal functionality for the Rendler Industries 
 * platform. It provides shared logic for UI state management, formatting,
 * and high-level AJAX interactions across all SPA modules.
 * 
 * Features:
 * - Real-time relative time formatting (e.g., "5m ago")
 * - 3D Flip Clock engine for dashboard and reminder countdowns
 * - Themed global confirmation modal system
 * - Centralized AJAX wrapper with automatic Toast notification integration
 * - Master Semantic Icon Registry for platform-wide consistency
 * 
 * Dependencies:
 * - jquery.js: Necessary for certain legacy UI interactions
 * - toast.js: For rendering success/error notifications
 */

/**
 * --- Date & Time Utilities ---
 */

/**
 * Formats a Unix timestamp into a human-readable relative string.
 * 
 * @param {number} unix - Seconds since epoch.
 * @returns {string} - Relative time description (e.g., "Just now", "2h 10m ago")
 */
function getTimeSince(unix) {
    if (!unix) return "...";
    
    // Calculate delta against current system time
    const diff = Math.floor(Date.now() / 1000) - unix;
    
    // Handle future or extremely recent events
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
 * Formats a millisecond duration into a concise countdown string.
 * Used for task deadlines and medication windows.
 * 
 * @param {number} ms - Duration in milliseconds.
 * @returns {string} - Formatted countdown (e.g., "in 3d 5h", "Due now")
 */
function formatCountdown(ms) {
    if (ms <= 0) return 'Due now';
    
    const totalMins = Math.floor(ms / 60000);
    const days  = Math.floor(totalMins / 1440);
    const hours = Math.floor((totalMins % 1440) / 60);
    const mins  = totalMins % 60;
    
    // Return most significant units
    if (days  > 0) return `in ${days}d ${hours}h`;
    if (hours > 0) return `in ${hours}h ${mins}m`;
    if (mins  > 0) return `in ${mins}m`;
    
    return 'Due now';
}

/**
 * Generates current local ISO datetime string.
 * Specifically formatted for HTML datetime-local inputs.
 * 
 * @returns {string} - ISO format string truncated to minutes (YYYY-MM-DDTHH:MM)
 */
function getLocalISOString() {
    const now = new Date();
    // Correct for timezone offset to ensure local time is captured
    const tzoffset = now.getTimezoneOffset() * 60000;
    return (new Date(now - tzoffset)).toISOString().slice(0, 16);
}

/**
 * --- UI Management Utilities ---
 */

/**
 * Universal Modal Closing Logic.
 * Attaches global listener to detect clicks on modal overlays.
 * 
 * @param {string[]} modalClasses - CSS classes identifying modal background overlays.
 * @param {function[]} closeCallbacks - Cleanup functions to execute on closure.
 */
function setupGlobalModalClosing(modalClasses = ['modal-overlay', 'delete-modal-overlay'], closeCallbacks = []) {
    window.addEventListener('click', (event) => {
        // Detect if the click target itself is the overlay container
        const isOverlay = modalClasses.some(cls => event.target.classList.contains(cls));
        if (isOverlay) {
            closeCallbacks.forEach(cb => {
                if (typeof cb === 'function') cb();
            });
        }
    });
}

/**
 * Standard AJAX POST wrapper with integrated feedback.
 * 
 * @param {string} url - Target API endpoint.
 * @param {Object|FormData} data - Payload to transmit.
 * @returns {Promise<Object|null>} - Parsed JSON response or null on failure.
 */
async function apiPost(url, data = {}) {
    try {
        const options = {
            method: 'POST'
        };

        // Automatic content-type detection for binary vs form data
        if (data instanceof FormData) {
            options.body = data;
            // Note: browser manages boundary for FormData; do NOT set Content-Type
        } else {
            options.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
            options.body = new URLSearchParams(data);
        }

        const response = await fetch(url, options);
        
        const text = await response.text();
        let result;
        try {
            result = JSON.parse(text);
        } catch (e) {
            console.error('JSON Parse Error. Raw response:', text);
            throw new Error('Invalid JSON response');
        }

        // Handle logical success/failure based on platform response standard
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
 * Triggers global fullscreen loading overlay.
 * Uses frosted glass aesthetic per system design standards.
 * 
 * @param {string} text - Primary loading message.
 * @param {string} subtext - Supporting detail message.
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
 * Removes global loading overlay from DOM.
 */
function hideLoadingOverlay() {
    const overlay = document.getElementById('global-loading-overlay');
    if (overlay) overlay.remove();
}

/**
 * Returns HTML fragment for localized component loading states.
 * 
 * @param {string} text - Label.
 * @param {string} subtext - Supporting text.
 * @param {boolean} showScanner - Whether to include the horizontal scan animation.
 * @returns {string} - HTML fragment.
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
 * Themed Confirmation Modal Controller.
 * Leverages the global layout fragment defined in default.html.ep.
 * 
 * @param {Object} options - Configuration: { title, icon, message, danger, confirmText, loadingText, onConfirm }
 */
window.showConfirmModal = function(options) {
    const modal = document.getElementById('globalConfirmActionModal');
    const title = document.getElementById('globalConfirmModalTitle');
    const icon = document.getElementById('globalConfirmModalIcon');
    const text = document.getElementById('globalConfirmModalText');
    const btn = document.getElementById('globalConfirmModalBtn');

    if (!modal || !btn) return;

    // Apply configuration to DOM
    if (title) title.textContent = options.title || 'Confirm Action';
    if (icon) icon.innerHTML = getIcon(options.icon || 'delete');
    if (text) text.innerHTML = options.message || 'Are you sure?';
    
    btn.textContent = options.confirmText || 'Confirm';
    btn.className = options.danger ? 'btn-danger-confirm' : 'btn-primary';
    btn.disabled = false;

    // Clone button to strip existing event listeners and avoid logic duplication
    const newBtn = btn.cloneNode(true);
    newBtn.disabled = false;
    btn.parentNode.replaceChild(newBtn, btn);

    // Attach confirmation execution logic
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

/**
 * Hides the global confirmation modal and restores button state.
 */
window.closeConfirmModal = function() {
    const modal = document.getElementById('globalConfirmActionModal');
    const btn = document.getElementById('globalConfirmModalBtn');
    if (modal) modal.style.display = 'none';
    if (btn) btn.disabled = false;
};

/**
 * --- Global Flip Clock Engine ---
 */

/**
 * Manages 3D Flip Clock state and animation triggers.
 */
const FlipClockManager = {
    prevStates: {},                 // Local cache for diffing time values

    /**
     * Updates clock UI using logic-based diffing.
     * 
     * @param {HTMLElement} el - Clock container.
     * @param {Object} vals - Object containing time units { dd, hh, mm, ss }.
     * @param {string} id - Unique identifier for state isolation.
     */
    update: function(el, vals, id) {
        // Handle initial render
        if (!this.prevStates[id]) {
            this.prevStates[id] = vals;
            el.innerHTML = this._renderHTML(vals);
            return;
        }

        // Compare each unit and trigger flip animations only on changes
        Object.keys(vals).forEach(unit => {
            if (vals[unit] !== this.prevStates[id][unit]) {
                // Special handling for dynamic unit visibility (e.g., hiding Day unit when 0)
                if (unit === 'dd' && ((vals.dd === 0 && this.prevStates[id].dd !== 0) || (vals.dd !== 0 && this.prevStates[id].dd === 0))) {
                    el.innerHTML = this._renderHTML(vals);
                } else {
                    this._triggerFlip(el, unit, vals[unit], this.prevStates[id][unit]);
                }
            }
        });

        this.prevStates[id] = vals;
    },

    /**
     * Generates base HTML for clock segments.
     * 
     * @private
     */
    _renderHTML: function(vals) {
        let html = '';
        if (vals.dd !== undefined && vals.dd > 0) html += this._renderUnit('dd', vals.dd, 'DD');
        if (vals.hh !== undefined) html += this._renderUnit('hh', vals.hh, 'HH');
        if (vals.mm !== undefined) html += this._renderUnit('mm', vals.mm, 'MM');
        if (vals.ss !== undefined) html += this._renderUnit('ss', vals.ss, 'SS');
        if (vals.ampm !== undefined) html += `<div class="flip-unit"><div class="flip-card ampm">${vals.ampm}</div><div class="flip-label">AM/PM</div></div>`;
        return html;
    },

    /**
     * Renders a single 3D card unit.
     * 
     * @private
     */
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

    /**
     * Triggers the CSS-based flip animation for a specific unit.
     * 
     * @private
     */
    _triggerFlip: function(container, unit, newVal, oldVal) {
        const flipCard = container.querySelector(`.flip-unit[data-unit="${unit}"] .flip-card`);
        if (!flipCard) return;

        flipCard.classList.remove('flipping');
        void flipCard.offsetWidth; // Trigger reflow

        // Assign new and old values to appropriate card faces
        flipCard.querySelector('.flip-card-top').textContent = newVal;
        flipCard.querySelector('.flip-card-bottom').textContent = oldVal;
        flipCard.querySelector('.flip-card-flap-front').textContent = oldVal;
        flipCard.querySelector('.flip-card-flap-back').textContent = newVal;

        flipCard.classList.add('flipping');

        // Restore static state after animation completion
        setTimeout(() => {
            flipCard.querySelector('.flip-card-bottom').textContent = newVal;
            flipCard.querySelector('.flip-card-flap-front').textContent = newVal;
            flipCard.classList.remove('flipping');
        }, 400);
    },

    /**
     * Initiates a standard 12-hour real-time clock.
     * 
     * @param {HTMLElement} el - Target container.
     * @param {string} id - Unique instance identifier.
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
 * Standardized mapping of semantic names to Unicode/Emoji symbols.
 * Mirrors lib/MyApp/Plugin/Icons.pm for consistency.
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
 * Public accessor for the semantic icon registry.
 * 
 * @param {string} name - The semantic name of the icon (case-insensitive).
 * @returns {string} - The symbol if found, otherwise returns the input name.
 */
window.getIcon = function(name) {
    return GLOBAL_ICONS[name.toLowerCase()] || name;
};

/**
 * Global TTS Helper: speakText
 * 
 * Fetches an MP3 blob from the Google Cloud TTS API and plays it. 
 * Automatically handles memory cleanup after playback.
 * 
 * @param {string} text - The text to synthesize into speech.
 * @returns {Promise<void>}
 */
async function speakText(text) {
    if (!text) return;

    try {
        const response = await fetch('/api/tts/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'TTS API Error');
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        
        audio.play();
        
        // Lifecycle: Cleanup memory once audio finishes
        audio.onended = () => URL.revokeObjectURL(url);
    } catch (err) {
        console.error('speakText failed:', err);
    }
}

/**
 * Global Translation Helper: translateText
 * 
 * Translates text via the secured Google Cloud Translation API.
 * 
 * @param {string} text - The text to translate.
 * @param {string} [target='th'] - Target language code.
 * @returns {Promise<Object|null>} - { translated_text, detected_source_lang, cached }
 */
async function translateText(text, target = 'th') {
    if (!text) return null;

    try {
        const response = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text, target: target })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Translation API Error');
        }

        return await response.json();
    } catch (err) {
        console.error('translateText failed:', err);
        return null;
    }
}

// Ensure it's exposed to the global scope
window.speakText = speakText;
window.translateText = translateText;
