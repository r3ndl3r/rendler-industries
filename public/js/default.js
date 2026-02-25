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
        const result = await response.json();
        if (result.success) {
            if (result.message) showToast(result.message, 'success');
            return result;
        } else {
            showToast(result.error || 'Action failed', 'error');
            return null;
        }
    } catch (err) {
        showToast('Network error', 'error');
        return null;
    }
}
