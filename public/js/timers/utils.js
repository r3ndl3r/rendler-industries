// /public/js/timers/utils.js

/**
 * Timer Utility Module
 * 
 * This module provides core time formatting and visual reconciliation 
 * logic for the device usage timer system. It centralizes math-heavy 
 * duration calculations used by both the dashboard and management ledgers.
 * 
 * Features:
 * - High-density time formatting (HH:MM:SS) with negative/expiry awareness
 * - Usage-percentage status color resolution (Success/Warning/Danger)
 * - Real-time progress bar width and class management
 */

const TimerUtils = {
    /**
     * Transforms raw seconds into localized duration strings.
     * Implements specific formatting for expired or over-limit timers.
     * 
     * @param {number} seconds - Source duration
     * @returns {string} - Formatted description (e.g., "1:30:00", "-0:15 OVER")
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
        
        // Formatting: pad components for high-density consistency
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    },

    /**
     * Logic: getStatusColor
     * Resolves the semantic color key based on consumption thresholds.
     * 
     * Thresholds:
     * - < 80%: Green (Success)
     * - 80% - 99%: Yellow (Warning)
     * - >= 100%: Red (Danger)
     * 
     * @param {number} elapsed - Seconds consumed
     * @param {number} limit - Target limit
     * @returns {string} - CSS color class key
     */
    getStatusColor: function(elapsed, limit) {
        if (limit === 0) return 'gray';
        
        const percentage = (elapsed / limit) * 100;
        
        if (percentage >= 100) return 'red';
        if (percentage >= 80) return 'yellow';
        return 'green';
    },

    /**
     * UI Component: updateProgressBar
     * Reconciles a progress element's width and color with source data.
     * 
     * @param {HTMLElement} element - Target .status-fill node
     * @param {number} elapsed - Seconds consumed
     * @param {number} limit - Target limit
     */
    updateProgressBar: function(element, elapsed, limit) {
        const percentage = limit > 0 ? Math.min((elapsed / limit) * 100, 100) : 0;
        const color = this.getStatusColor(elapsed, limit);
        
        // Operation: CSS property and class mutation
        element.style.width = percentage + '%';
        element.className = `status-fill ${color}`;
    }
};
