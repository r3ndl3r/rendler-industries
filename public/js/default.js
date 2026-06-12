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
 * --- Global Security Helpers (CSRF) ---
 * 
 * Automatically synchronizes the CSRF token from the meta tag to all 
 * outgoing state-changing requests (POST, PUT, DELETE, PATCH).
 * 
 * This ensures platform-wide security without manual boilerplate.
 */
(function() {
    const getCsrfToken = () => document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');

    // 1. Fetch API Hook: Injects token into headers for native fetch calls
    const originalFetch = window.fetch;
    window.fetch = function(url, options = {}) {
        const token = getCsrfToken();
        const request = url instanceof Request ? url : null;
        const requestUrl = request ? request.url : url;
        const method = (options.method || request?.method || 'GET').toUpperCase();
        
        // Security: Only inject token for state-changing, same-origin requests
        // This prevents leaking the token to external domains.
        const isSameOrigin = (url) => {
            if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) return true;
            try {
                const target = new URL(url, window.location.origin);
                return target.origin === window.location.origin;
            } catch (e) {
                return false;
            }
        };

        if (token && !['GET', 'HEAD', 'OPTIONS'].includes(method) && isSameOrigin(requestUrl.toString())) {
            const headers = new Headers(request ? request.headers : undefined);
            new Headers(options.headers || {}).forEach((value, key) => headers.set(key, value));
            if (!headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', token);
            options = { ...options, headers };
        }
        return originalFetch(url, options);
    };

    // 2. jQuery AJAX Hook: Injects token into all jQuery-based requests
    if (window.jQuery) {
        window.jQuery.ajaxSetup({
            beforeSend: function(xhr, settings) {
                const token = getCsrfToken();
                if (token && !['GET', 'HEAD', 'OPTIONS'].includes(settings.type.toUpperCase())) {
                    xhr.setRequestHeader('X-CSRF-Token', token);
                }
            }
        });
    }

    // 3. Form Submission Hook: Injects hidden input into standard POST forms
    document.addEventListener('submit', function(e) {
        if (e.target.tagName === 'FORM') {
            const method = (e.target.getAttribute('method') || 'GET').toUpperCase();
            if (method !== 'GET') {
                const token = getCsrfToken();
                if (token && !e.target.querySelector('input[name="csrf_token"]')) {
                    const input = document.createElement('input');
                    input.type = 'hidden';
                    input.name = 'csrf_token';
                    input.value = token;
                    e.target.prepend(input);
                }
            }
        }
    });
})();

/**
 * Standard AJAX POST wrapper with integrated feedback and network timeout.
 * 
 * @param {string} url - Target API endpoint.
 * @param {Object|FormData} data - Payload to transmit.
 * @param {number} timeout - Request timeout in ms (default 30s for POST).
 * @returns {Promise<Object|null>} - Parsed JSON response or null on failure.
 */
async function apiPost(url, data = {}, timeout = 30000) {
    try {
        const options = {
            method: 'POST'
        };

        // Note: CSRF token is automatically injected by the global fetch hook above.

        // Automatic content-type detection for binary vs form data
        if (data instanceof FormData) {
            options.body = data;
        } else {
            options.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
            options.body = new URLSearchParams(data);
        }

        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        options.signal = controller.signal;

        const response = await fetch(url, options);
        clearTimeout(id);

        // Intercept Cloudflare Access 403s before parsing; Access may return HTML.
        if (response.status === 403 && window.Capacitor && window.Capacitor.isNativePlatform()) {
            if (typeof window.handleMobileAdminAuth === 'function') {
                window.handleMobileAdminAuth(url);
                return null;
            }
        }
        
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
        if (err.name === 'AbortError') {
            showToast('Request timed out', 'error');
        } else if (typeof navigator === 'undefined' || typeof navigator.onLine === 'undefined' || navigator.onLine) {
            showToast('Network error', 'error');
        }
        return null;
    }
}

/**
 * Standard AJAX GET wrapper with automatic state caching and network timeout.
 * 
 * @param {string} url - Target API endpoint.
 * @param {number} timeout - Request timeout in ms (default 3s).
 * @returns {Promise<Object|null>} - Parsed JSON response or null on failure.
 */
function shouldCacheApiGet(url) {
    try {
        const pathname = new URL(url, window.location.origin).pathname;
        return pathname !== '/admin/automator/api/status'
            && pathname !== '/admin/automator/api/state';
    } catch (_) {
        return true;
    }
}

async function apiGet(url, timeout = 3000) {
    const cacheKey = `api_cache:${url}`;
    const cacheable = shouldCacheApiGet(url);
    const getCached = () => {
        if (!cacheable) return null;
        try {
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const parsed = JSON.parse(cached);
                console.info(`Using cached data for ${url} (from ${new Date(parsed.timestamp).toLocaleString()})`);
                return parsed.data;
            }
        } catch (e) { }
        return null;
    };

    try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(id);

        // Intercept Cloudflare Access 403s on native mobile
        if (response.status === 403 && window.Capacitor && window.Capacitor.isNativePlatform()) {
            if (typeof window.handleMobileAdminAuth === 'function') {
                window.handleMobileAdminAuth(url);
                return null;
            }
        }

        const text = await response.text();
        let result;
        try {
            result = JSON.parse(text);
        } catch (e) {
            console.error('JSON Parse Error:', text);
            throw new Error('Invalid JSON response');
        }

        // Cache successful state responses
        if (cacheable && result && result.success) {
            try {
                localStorage.setItem(cacheKey, JSON.stringify({
                    data: result,
                    timestamp: Date.now()
                }));
            } catch (e) { /* Storage full */ }
        }

        return result;
    } catch (err) {
        console.warn(`apiGet failed for ${url}:`, err);

        // Fallback to cache if available
        const cached = getCached();
        if (cached) return cached;

        if (err.name !== 'AbortError' && (typeof navigator === 'undefined' || typeof navigator.onLine === 'undefined' || navigator.onLine)) {
            showToast('Network error', 'error');
        }
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
            <span class="loading-icon-pulse">🤖</span>
            <p class="loading-label">${text}</p>
            ${subtext ? `<p class="loading-sub">${subtext}</p>` : ''}
        </div>
    `;
}

/**
 * Translates ISO day number (1-7) to human-readable full name.
 * 
 * @param {number} day - ISO index.
 * @returns {string} - Full name.
 */
function getDayFullName(day) {
    return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][day - 1];
}

/**
 * Generates a grid of button-style checkboxes for dynamic forms.
 * 
 * @param {string} containerId - Target element ID.
 * @param {Object[]} items - Collection of items {id, label}.
 * @param {Object} options - Configuration {name, prefix, type}.
 * @returns {void}
 */
function renderSelectorGrid(containerId, items, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const name = options.name || 'items[]';
    const prefix = options.prefix || 'item';
    const className = options.type === 'day' ? 'day-checkbox' : 'recipient-checkbox';

    container.innerHTML = items.map((item, i) => `
        <label class="${className} selector-item">
            <input type="checkbox" name="${name}" value="${item.id}" id="${prefix}${item.id}">
            <span>${item.label}</span>
        </label>
    `).join('');
}

/**
 * Standardized Date/Time Formatter for SQL Timestamps.
 * Transforms database strings into high-fidelity localized display strings.
 * 
 * @param {string} dt - SQL format datetime (YYYY-MM-DD HH:MM:SS)
 * @param {boolean} [all_day=false] - Whether to omit time segments.
 * @returns {string} - Human-readable format (e.g., "01-Apr-2026 12:45 PM")
 */
function format_datetime(dt, all_day = false) {
    if (!dt) return "-";
    
    // Parse SQL format: YYYY-MM-DD HH:MM:SS or YYYY-MM-DD
    const parts = dt.split(/[- :]/);
    const dateObj = parts.length >= 6 
        ? new Date(parts[0], parts[1]-1, parts[2], parts[3], parts[4], parts[5])
        : new Date(parts[0], parts[1]-1, parts[2]);

    if (isNaN(dateObj.getTime())) return dt;

    const day   = String(dateObj.getDate()).padStart(2, '0');
    const month = dateObj.toLocaleString('en-US', { month: 'short' });
    const year  = dateObj.getFullYear();

    if (all_day) return `${day}-${month}-${year}`;

    let hours = dateObj.getHours();
    const mins = String(dateObj.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;

    return `${day}-${month}-${year} ${hours}:${mins} ${ampm}`;
}

// Global Exposure
window.getDayFullName = getDayFullName;
window.renderSelectorGrid = renderSelectorGrid;
window.format_datetime = format_datetime;

/**
 * Global UI Helper: renderRowInput
 * 
 * Generates a standardized horizontal input + action button row.
 * Handles Emoji Picker isolation and standard Rendler styling.
 * 
 * @param {HTMLElement} container - Target container to hydrate.
 * @param {Object} options - { id, placeholder, value, buttonText, buttonIcon, noEmoji }
 * @returns {Object} - { input, button } References for event binding.
 */
window.renderRowInput = function(container, options) {
    if (!container) return;
    
    container.innerHTML = '';
    // Use the platform-standard prompt row pattern
    container.classList.add('modal-prompt-row');
    container.classList.remove('hidden');
    
    // 1. Input Wrapper (Crucial for Emoji Picker isolation)
    // Anchors absolute position of trigger button within the input's bounding box.
    const wrapper = document.createElement('div');
    wrapper.className = 'create-input-wrapper';
    wrapper.style.flex = '1';
    
    const input = document.createElement('input');
    input.type = options.type || 'text';
    input.id = options.id || '';
    if (options.name) input.name = options.name;
    input.className = 'create-modal-input';
    input.placeholder = options.placeholder || '';
    input.value = (options.value !== undefined) ? options.value : '';
    input.autocomplete = 'off';
    
    if (options.noEmoji) input.classList.add('no-emoji');
    
    wrapper.appendChild(input);
    
    // 2. Assemble Wrapper First
    container.appendChild(wrapper);

    // 3. Action Button (Appended second to appear on the right)
    let button = null;
    if (!options.noButton) {
        button = document.createElement('button');
        button.type = options.buttonType || 'button';
        button.className = 'btn-primary btn-go-row';
        if (options.buttonClass) button.classList.add(options.buttonClass);
        button.innerHTML = (options.buttonIcon ? options.buttonIcon + ' ' : '') + (options.buttonText || 'Save');
        container.appendChild(button);
    }
    
    return { input, button };
};


/**
 * Themed Confirmation Modal Controller.
 * Leverages the global layout fragment defined in default.html.ep.
 *
 * @param {Object} options - Configuration:
 *   - title, icon, message, subMessage: Content
 *   - danger, success, warning: Themes
 *   - confirmText, confirmIcon, cancelText, hideCancel: Buttons
 *   - alignment: 'left', 'center', 'right'
 *   - width: 'small', 'medium', 'large'
 *   - persistent, hideCloseX, autoFocus: Behavior
 *   - input: { type, placeholder, requiredText } - Prompt
 *   - onConfirm: Async callback (receives input value)
 */
let confirmModalCloseTimer = null;

window.showConfirmModal = function(options) {
    const modal = document.getElementById('globalConfirmActionModal');
    const content = document.getElementById('globalConfirmModalContent');
    const title = document.getElementById('globalConfirmModalTitle');
    const icon = document.getElementById('globalConfirmModalIcon');
    const text = document.getElementById('globalConfirmModalText');
    const subText = document.getElementById('globalConfirmModalSubText');
    const btnConfirm = document.getElementById('globalConfirmModalBtn');
    const btnCancel = document.getElementById('globalConfirmCancelBtn');
    const actions = document.getElementById('globalConfirmModalActions');
    const closeX = document.getElementById('globalConfirmCloseX');
    const promptContainer = document.getElementById('globalConfirmPromptContainer');
    let promptInput = document.getElementById('globalConfirmPromptInput');

    if (!modal || !btnConfirm) return;

    if (confirmModalCloseTimer) {
        clearTimeout(confirmModalCloseTimer);
        confirmModalCloseTimer = null;
    }
    modal.classList.remove('modal-closing');

    // Reset UI State & Self-Healing Restoration
    content.className = 'delete-modal-content';
    actions.className = 'delete-modal-actions';
    
    if (promptContainer) {
        promptContainer.classList.remove('modal-prompt-row');
        // Self-Healing: If a previous specialized modal (like Jump To Level)
        // destroyed the standard input structure via renderRowInput, restore it.
        if (!document.getElementById('globalConfirmPromptInput')) {
            promptContainer.innerHTML = '<input type="text" id="globalConfirmPromptInput" class="modal-prompt-input" autocomplete="off">';
            promptInput = document.getElementById('globalConfirmPromptInput');
        }
        promptContainer.classList.add('hidden');
    }
    modal.classList.toggle('persistent', !!options.persistent);
    if (promptInput) promptInput.classList.remove('no-emoji');
    
    /**
     * Internal: handleCancel
     * Orchestrates the dismissal of the modal and triggers the optional onCancel callback.
     */
    const handleCancel = () => {
        if (typeof options.onCancel === 'function') options.onCancel();
        closeConfirmModal();
    };

    // Behavior: Dismissal triggers
    modal.onclick = (e) => {
        if (!options.persistent && e.target === modal) handleCancel();
    };
    if (closeX) closeX.onclick = handleCancel;
    if (btnCancel) btnCancel.onclick = handleCancel;

    // 1. Content Injection
    if (title) title.textContent = options.title || 'Confirm Action';
    if (icon) icon.innerHTML = options.icon || '🗑️';
    if (text) text.innerHTML = options.message || 'Are you sure?';
    
    if (subText) {
        subText.classList.toggle('hidden', !options.subMessage);
        subText.innerHTML = options.subMessage || '';
    }

    // 2. Theme & Layout
    if (options.danger) content.classList.add('modal-theme-danger');
    if (options.success) content.classList.add('modal-theme-success');
    if (options.warning) content.classList.add('modal-theme-warning');

    if (options.width === 'small') content.classList.add('modal-sm');
    else if (options.width === 'large') content.classList.add('modal-lg');
    else content.classList.add('modal-md');

    const align = options.alignment || (options.hideCancel ? 'center' : 'right');
    actions.classList.add(`modal-actions-${align}`);

    // 3. Button Configuration
    btnConfirm.innerHTML = (options.confirmIcon ? options.confirmIcon + ' ' : '') + (options.confirmText || 'Confirm');
    btnConfirm.className = options.danger ? 'btn-danger-confirm' : (options.success ? 'btn-success' : 'btn-primary');
    btnConfirm.disabled = !!(options.input && options.input.requiredText);

    if (btnCancel) {
        btnCancel.classList.toggle('hidden', !!options.hideCancel);
        btnCancel.textContent = options.cancelText || 'Cancel';
    }

    if (closeX) closeX.classList.toggle('hidden', !!options.hideCloseX);

    // 4. Prompt Logic
    if (promptContainer && promptInput) {
        if (options.input) {
            promptContainer.classList.remove('hidden');
            promptInput.type = options.input.type || 'text';
            promptInput.placeholder = options.input.placeholder || '';
            promptInput.value = options.input.value || '';
            if (options.input.min !== undefined) promptInput.min = options.input.min;
            if (options.input.max !== undefined) promptInput.max = options.input.max;

            // Suppression opt-out for specialized modals
            if (options.noEmoji) promptInput.classList.add('no-emoji');
            
            if (options.input.requiredText) {
                promptInput.oninput = () => {
                    btnConfirm.disabled = promptInput.value !== options.input.requiredText;
                };
            } else {
                promptInput.oninput = null;
            }
        } else {
            promptContainer.classList.add('hidden');
        }
    }

    // 5. Execution Logic (Clone to strip old listeners)
    const newBtn = btnConfirm.cloneNode(true);
    btnConfirm.parentNode.replaceChild(newBtn, btnConfirm);

    newBtn.addEventListener('click', async () => {
        // If no specifically defined callback, simply dismiss the modal gracefully
        if (typeof options.onConfirm !== 'function') {
            closeConfirmModal();
            return;
        }

        const originalHtml = newBtn.innerHTML;
        newBtn.disabled = true;
        newBtn.innerHTML = `⌛ ${options.loadingText || 'Processing...'}`;
        
        try {
            await options.onConfirm(options.input ? (promptInput ? promptInput.value : null) : null);
            closeConfirmModal();
        } catch (err) {
            console.error("Modal Action Failed:", err);
            newBtn.disabled = false;
            newBtn.innerHTML = originalHtml;
        }
    });

    // 6. Display & Focus
    modal.classList.add('show');
    document.body.classList.add('modal-open');

    if (options.autoFocus) {
        setTimeout(() => (options.input ? promptInput : newBtn).focus(), 50);
    }
};

/**
 * Hides the global confirmation modal with exit animation and restores button state.
 */
window.closeConfirmModal = function() {
    const modal = document.getElementById('globalConfirmActionModal');
    if (!modal || !modal.classList.contains('show')) return;

    if (confirmModalCloseTimer) {
        clearTimeout(confirmModalCloseTimer);
    }

    modal.classList.add('modal-closing');
    
    // Wait for exit animation to finish before fully hiding
    confirmModalCloseTimer = setTimeout(() => {
        modal.classList.remove('show', 'modal-closing');
        document.body.classList.remove('modal-open');
        confirmModalCloseTimer = null;
    }, 200);
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

        // Assign new and old values to appropriate card faces
        flipCard.querySelector('.flip-card-top').textContent = newVal;
        flipCard.querySelector('.flip-card-bottom').textContent = oldVal;
        flipCard.querySelector('.flip-card-flap-front').textContent = oldVal;
        flipCard.querySelector('.flip-card-flap-back').textContent = newVal;

        // Use a double-requestAnimationFrame pattern to guarantee the browser 
        // processes the class removal and layout reset before the next paint 
        // frame where the animation class is re-added.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                flipCard.classList.add('flipping');
                setTimeout(() => {
                    flipCard.querySelector('.flip-card-bottom').textContent = newVal;
                    flipCard.querySelector('.flip-card-flap-front').textContent = newVal;
                    flipCard.classList.remove('flipping');
                }, 400);
            });
        });
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
 * --- Identity & Icon Management ---
 * 
 * Synchronized with lib/MyApp/Plugin/Icons.pm via /api/user_icons.
 */
window.GLOBAL_USER_ICONS = { users: {} };

/**
 * Hydrates the global icon registry from the secure API.
 * This pattern mirrors the /emojis module to ensure 100% encoding accuracy.
 */
async function loadUserIcons() {
    try {
        const response = await fetch('/api/user_icons');
        if (!response.ok) return;
        window.GLOBAL_USER_ICONS = await response.json();
        
        // Dispatch event so SPA modules can re-render if needed
        window.dispatchEvent(new CustomEvent('userIconsHydrated'));
    } catch (err) {
        console.error('Failed to hydrate user icons:', err);
    }
}

// Global Lifecycle: Trigger hydration immediately on script load
loadUserIcons();

/**
 * window.getUserIcon
 * Standardized mapping of user identities to Unicode/Emoji symbols.
 * Synchronized with lib/MyApp/Plugin/Icons.pm via /api/user_icons.
 */
window.getUserIcon = function(username) {
    const registry = window.GLOBAL_USER_ICONS?.users;
    if (!username || !registry) return '👤';
    return registry[username.toLowerCase()] || registry['unknown'] || '👤';
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
        const response = await fetch('/tts/api/synthesize', {
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
        const response = await fetch('/translation/api/translate', {
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

/**
 * Global XSS Prevention Helper: escapeHtml
 * 
 * Sanitizes user-provided content by converting sensitive HTML characters 
 * into their entity equivalents.
 * 
 * @param {string} text - The raw string to sanitize.
 * @returns {string} - The sanitized HTML string.
 */
window.escapeHtml = function(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/"/g, '&quot;');
};

/**
 * APK Auto-Update Prompt
 *
 * Shows a themed confirmation modal when the native Android bridge reports
 * a newer APK version. The confirmed action delegates the download and install
 * notification flow to the AppUpdater bridge.
 *
 * @param {number} serverCode - versionCode from /app-version.json.
 * @param {string} serverName - Human-readable version string.
 * @returns {void}
 */
window.showUpdatePrompt = function(serverCode, serverName) {
    if (!window.AppUpdater) return;

    showConfirmModal({
        title:       'Update Available',
        icon:        '🔄',
        message:     `Version <strong>${serverName}</strong> is ready to download.`,
        subMessage:  'The update will download in the background, then Android will open the installer when it is ready.',
        confirmText: 'Download Update',
        hideCancel:  true,
        width:       'small',
        onConfirm:   () => {
            try {
                if (window.AppUpdater.canInstall() !== 'true') {
                    setTimeout(() => {
                        showConfirmModal({
                            title:       'Permission Required',
                            icon:        '⚙️',
                            message:     'To install updates, allow this app to install unknown apps in Settings.',
                            confirmText: 'Open Settings',
                            hideCancel:  true,
                            width:       'small',
                            onConfirm:   () => window.AppUpdater.openInstallSettings()
                        });
                    }, 300);
                    return;
                }
                window.AppUpdater.startUpdate();
                showToast('Downloading update… installer will open when ready.', 'success');
            } catch (e) {
                console.error('Update button error:', e);
                showToast('Error starting update.', 'error');
            }
        }
    });
};

/**
 * Checks the deployed APK manifest inside the native Android shell.
 * @returns {void}
 */
function checkApkUpdate() {
    if (!window.AppUpdater) return;

    setTimeout(() => {
        fetch('/app-version.json', { cache: 'no-store' })
            .then(res => {
                if (!res.ok) throw new Error('Network response was not ok');
                return res.json();
            })
            .then(data => {
                const serverCode = parseInt(data.version_code, 10);
                const installedCode = parseInt(window.AppUpdater.getInstalledVersionCode(), 10);

                if (serverCode > installedCode) {
                    window.showUpdatePrompt(serverCode, data.version_name);
                }
            })
            .catch(err => {
                console.error('APK Update check failed:', err);
            });
    }, 1500);
}

document.addEventListener('DOMContentLoaded', checkApkUpdate);

/**
 * Capacitor Native App Lifecycle Bootstrap
 *
 * Runs only inside the Capacitor native shell. Coordinates Android back-button
 * behavior with global overlays and refreshes the APK update check when the app
 * returns from native settings or installer screens.
 *
 * @returns {void}
 */
(function initNativeAppLifecycle() {
    if (!window.Capacitor || !window.Capacitor.isNativePlatform()) return;

    const { App } = window.Capacitor.Plugins;
    if (!App) return;

    /**
     * Closes the currently open global overlay or side navigation.
     *
     * @returns {boolean} True when a visible UI layer was dismissed.
     */
    function closeActiveOverlay() {
        const confirmModal = document.getElementById('globalConfirmActionModal');
        if (confirmModal && confirmModal.classList.contains('show') && !confirmModal.classList.contains('persistent')) {
            if (typeof window.closeConfirmModal === 'function') window.closeConfirmModal();
            else confirmModal.classList.remove('show');
            return true;
        }

        const restartModal = document.getElementById('restart-modal');
        if (restartModal && restartModal.classList.contains('show')) {
            if (typeof window.closeRestartModal === 'function') window.closeRestartModal();
            else restartModal.classList.remove('show');
            return true;
        }

        const visibleModals = Array.from(document.querySelectorAll([
            '.modal-overlay.show:not(.persistent)',
            '.modal-overlay.active:not(.persistent)',
            '.delete-modal-overlay.show:not(.persistent)',
            '.delete-modal-overlay.active:not(.persistent)',
            '.weather-detail-overlay.show:not(.persistent)',
            '.weather-detail-overlay.active:not(.persistent)',
            '.game-overlay.active:not(.persistent)',
            '.custom-modal-overlay:not(.hidden):not(.persistent)'
        ].join(', ')));

        const visibleModal = visibleModals.pop();
        if (visibleModal) {
            const closeControl = visibleModal.querySelector('[data-close="modal"], .close-modal, .close-btn, .delete-modal-close, .custom-modal-close');
            if (closeControl) {
                closeControl.click();
                return true;
            }

            visibleModal.classList.remove('show');
            visibleModal.classList.remove('active');
            if (visibleModal.classList.contains('custom-modal-overlay')) visibleModal.classList.add('hidden');
            if (!document.querySelector('.modal-overlay.show, .modal-overlay.active, .delete-modal-overlay.show, .delete-modal-overlay.active, .weather-detail-overlay.show, .weather-detail-overlay.active, .game-overlay.active, .custom-modal-overlay:not(.hidden)')) {
                document.body.classList.remove('modal-open');
            }
            return true;
        }

        const menu = document.getElementById('sideMenu');
        if (menu && menu.classList.contains('open')) {
            const overlay = document.getElementById('menuOverlay');
            menu.classList.remove('open');
            if (overlay) overlay.classList.remove('open');
            document.querySelectorAll('.menu-btn').forEach(btn => { btn.innerHTML = '☰'; });
            return true;
        }

        return false;
    }

    App.addListener('resume', function() {
        if (window.AppUpdater && typeof checkApkUpdate === 'function') {
            setTimeout(checkApkUpdate, 500);
        }
    });

    window.__nativeBackPressed = function(canGoBack, nativeApp) {
        if (closeActiveOverlay()) return true;
        if (typeof window.handleNativeBack === 'function' && window.handleNativeBack()) return true;

        if (canGoBack) {
            window.history.back();
            return true;
        }

        if (nativeApp) {
            if (typeof nativeApp.minimizeApp === 'function') nativeApp.minimizeApp();
            else nativeApp.exitApp();
            return true;
        }

        return false;
    };

    App.addListener('backButton', function(event) {
        window.__nativeBackPressed(event.canGoBack, App);
    });
}());

/**
 * FCM Push Notification Bootstrap
 *
 * Runs only inside the Capacitor native shell. Requests notification
 * permission, registers with FCM, and ships the device token to the
 * backend so the server can deliver push messages to this device.
 *
 * Foreground notifications surface as toast messages. Tap actions
 * navigate to data.url when present.
 *
 * @param {void} - No parameters. Self-invoking; guards on Capacitor presence.
 * @returns {void}
 */
(function initFcmPush() {
    if (!window.Capacitor || !window.Capacitor.isNativePlatform()) return;

    const { PushNotifications } = window.Capacitor.Plugins;
    if (!PushNotifications) return;

    PushNotifications.requestPermissions().then(function(result) {
        if (result.receive === 'granted') {
            PushNotifications.register();
        }
    });

    PushNotifications.addListener('registration', function(token) {
        fetch('/api/fcm/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || ''
            },
            body: 'token=' + encodeURIComponent(token.value)
        }).catch(function(err) {
            console.error('FCM token registration failed:', err);
        });
    });

    PushNotifications.addListener('registrationError', function(err) {
        console.error('FCM registration error:', err);
    });

    PushNotifications.addListener('pushNotificationReceived', function(notification) {
        showToast(notification.title + ': ' + notification.body, 'info');
    });

    PushNotifications.addListener('pushNotificationActionPerformed', function(action) {
        const url = action.notification.data && action.notification.data.url;
        if (url) window.location.href = url;
    });
}());

/**
 * --- Mobile Zero Trust Bridge ---
 *
 * Provides a handshake between the Capacitor WebView and Cloudflare Access.
 * Since email-based OTP login often fails inside a restricted WebView,
 * we intercept 403s and bridge them to a Chrome Custom Tab.
 */
(function initMobileAuth() {
    if (!window.Capacitor || !window.Capacitor.isNativePlatform()) return;

    const { App, Browser } = window.Capacitor.Plugins;
    if (!App || !Browser) return;

    const pendingKey = 'mobile_admin_auth_target';

    /**
     * Checks whether a hostname belongs to the current app host.
     *
     * @param {string} hostname - Hostname to compare against the current page.
     * @returns {boolean} True when the host matches after stripping www.
     */
    function isSameAppHost(hostname) {
        const current = window.location.hostname.replace(/^www\./, '');
        const incoming = hostname.replace(/^www\./, '');
        return incoming === current;
    }

    /**
     * Extracts a same-host admin path from an absolute or relative URL.
     *
     * @param {string} rawUrl - URL received from fetch handling or deep-link events.
     * @returns {string|null} Admin path with query/hash, or null when invalid.
     */
    function adminPathFromUrl(rawUrl) {
        try {
            const parsed = new URL(rawUrl, window.location.origin);
            if (!isSameAppHost(parsed.hostname)) return null;
            if (!parsed.pathname.startsWith('/admin/')) return null;
            return `${parsed.pathname}${parsed.search}${parsed.hash}`;
        } catch (e) {
            return null;
        }
    }

    /**
     * Extracts the original admin target from a Cloudflare Access login URL.
     *
     * @param {string} rawUrl - URL received from browser/deep-link callbacks.
     * @returns {string|null} Redirect admin path, or null when not an Access login URL.
     */
    function cloudflareAccessLoginTargetFromUrl(rawUrl) {
        try {
            const parsed = new URL(rawUrl, window.location.origin);
            const redirectPath = parsed.searchParams.get('redirect_url');
            if (parsed.hostname !== 'rendler.cloudflareaccess.com') return null;
            if (parsed.pathname !== '/cdn-cgi/access/login/rendler.org') return null;
            if (!redirectPath || !redirectPath.startsWith('/admin/')) return null;
            return redirectPath;
        } catch (e) {
            return null;
        }
    }

    /**
     * Checks whether a URL is Cloudflare's same-host authorization completion path.
     *
     * @param {string} rawUrl - URL received from browser/deep-link callbacks.
     * @returns {boolean} True when the URL is the Access authorized endpoint.
     */
    function isCloudflareAccessAuthorizedUrl(rawUrl) {
        try {
            const parsed = new URL(rawUrl, window.location.origin);
            return isSameAppHost(parsed.hostname) && parsed.pathname === '/cdn-cgi/access/authorized';
        } catch (e) {
            return false;
        }
    }

    /**
     * Checks whether a URL is the native admin auth callback page.
     *
     * @param {string} rawUrl - URL received from browser/deep-link callbacks.
     * @returns {boolean} True when the URL points to /admin/auth/callback.
     */
    function isAdminCallback(rawUrl) {
        try {
            return new URL(rawUrl, window.location.origin).pathname === '/admin/auth/callback';
        } catch (e) {
            return false;
        }
    }

    /**
     * Closes the system browser and routes the WebView back to the pending admin target.
     *
     * @param {string} rawUrl - URL that returned from the external auth flow.
     * @returns {void}
     */
    function returnToAdmin(rawUrl) {
        if (Browser.close) Browser.close().catch(() => {});

        if (isCloudflareAccessAuthorizedUrl(rawUrl)) {
            window.location.replace(rawUrl);
            return;
        }

        const incomingPath = adminPathFromUrl(rawUrl) || cloudflareAccessLoginTargetFromUrl(rawUrl);
        const pendingPath = sessionStorage.getItem(pendingKey);
        const targetPath = incomingPath && !isAdminCallback(rawUrl)
            ? incomingPath
            : (pendingPath || '/admin/automator');

        sessionStorage.removeItem(pendingKey);
        window.location.replace(targetPath);
    }

    // Listen for deep links returning from Cloudflare system browser login.
    // The AndroidManifest.xml intent-filter catches rendler.org links.
    App.addListener('appUrlOpen', function(data) {
        if (adminPathFromUrl(data.url) || cloudflareAccessLoginTargetFromUrl(data.url) || isCloudflareAccessAuthorizedUrl(data.url)) returnToAdmin(data.url);
    });

    if (App.getLaunchUrl) {
        App.getLaunchUrl().then(data => {
            if (data && data.url && (adminPathFromUrl(data.url) || cloudflareAccessLoginTargetFromUrl(data.url) || isCloudflareAccessAuthorizedUrl(data.url))) {
                returnToAdmin(data.url);
            }
        }).catch(() => {});
    }

    // Global helper to bridge to system browser for admin sessions.
    window.handleMobileAdminAuth = async function(targetUrl) {
        // Resolve absolute URL for Cloudflare redirect reliability
        const fullUrl = new URL(targetUrl, window.location.origin).toString();
        const targetPath = adminPathFromUrl(fullUrl) || '/admin/automator';
        sessionStorage.setItem(pendingKey, targetPath);

        // Use the themed modal system to explain the transition
        showConfirmModal({
            title: "Admin Access Required",
            icon: "🔒",
            message: "This section requires an email-verified session. Open secure login in browser?",
            confirmText: "Open Login",
            onConfirm: async () => {
                await Browser.open({
                    url: fullUrl,
                    toolbarColor: '#050c1d',
                    presentationStyle: 'popover'
                });
            }
        });
    };
}());

/**
 * Returns true if value is empty (allowed) or exactly one emoji grapheme cluster.
 * Uses Intl.Segmenter for grapheme-aware counting and a Unicode emoji property
 * check to reject plain text characters. Shared across all modules.
 *
 * @param {string} value
 * @returns {boolean}
 */
window.isValidSingleEmoji = function(value) {
    if (!value) return true;
    const segments = [...new Intl.Segmenter().segment(value)];
    if (segments.length !== 1) return false;
    return /\p{Emoji}/u.test(value) && !/^[0-9#*]$/.test(value);
};
