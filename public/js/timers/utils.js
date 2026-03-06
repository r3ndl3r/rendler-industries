// /public/js/timers/utils.js

/**
 * Timer Utility Module
 * 
 * Centralizes duration calculations and visual reconciliation logic 
 * for the timer system. It provides standardized formatting and status 
 * resolution used across both user and administrative interfaces.
 * 
 * Features:
 * - High-density time formatting (HH:MM:SS)
 * - Over-limit and expiry aware duration strings
 * - Semantic status color resolution (Green/Yellow/Red)
 * - Atomic progress bar synchronization
 * 
 * Dependencies:
 * - None
 */

const TimerUtils = {
    /**
     * Transforms raw seconds into localized duration strings.
     * 
     * @param {number} seconds - Source duration in seconds.
     * @returns {string} - Formatted duration label.
     */
    formatTime: function(seconds) {
        if (seconds === 0) return 'EXPIRED';
        
        // Scenario: Negative Duration (Over daily limit)
        if (seconds < 0) {
            const absSeconds = Math.abs(seconds);
            const hours = Math.floor(absSeconds / 3600);
            const minutes = Math.floor((absSeconds % 3600) / 60);
            return `-${hours}:${minutes.toString().padStart(2, '0')} OVER`;
        }
        
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    },

    /**
     * Resolves the semantic color key based on consumption thresholds.
     * 
     * Thresholds:
     * - < 80%: Green (Success)
     * - 80% - 99%: Yellow (Warning)
     * - >= 100%: Red (Danger)
     * 
     * @param {number} elapsed - Seconds consumed.
     * @param {number} limit - Daily limit in seconds.
     * @returns {string} - Semantic color class.
     */
    getStatusColor: function(elapsed, limit) {
        if (limit === 0) return 'gray';
        
        const percentage = (elapsed / limit) * 100;
        
        if (percentage >= 100) return 'red';
        if (percentage >= 80) return 'yellow';
        return 'green';
    },

    /**
     * Reconciles a progress element's width and color with source data.
     * 
     * @param {HTMLElement} element - Target progress fill node.
     * @param {number} elapsed - Seconds consumed.
     * @param {number} limit - Daily limit in seconds.
     * @returns {void}
     */
    updateProgressBar: function(element, elapsed, limit) {
        if (!element) return;
        
        const percentage = limit > 0 ? Math.min((elapsed / limit) * 100, 100) : 0;
        const color = this.getStatusColor(elapsed, limit);
        
        element.style.width = percentage + '%';
        element.className = `status-fill ${color}`;
    }
};

/**
 * --- Global Exposure ---
 */
window.TimerUtils = TimerUtils;
