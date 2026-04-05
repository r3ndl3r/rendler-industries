// /public/js/toast.js

/**
 * Global Notification Module (Toast)
 * 
 * This module provides a transient notification system for the platform.
 * It manages a non-blocking UI layer for success, error, and info messages
 * with automated lifecycle management and icon integration.
 * 
 * Features:
 * - Dynamic container generation (bootstrapped on first call)
 * - High-density semantic styling (success/error/info)
 * - Automated 3-second dismissal with fade-out animations
 * - Integration with the master Platform Icon registry
 * 
 * Dependencies:
 * - default.js: For the getIcon utility
 */

/**
 * Interface: showToast
 * Displays a global transient notification bubble.
 * 
 * @param {string} message - The text content to display.
 * @param {string} type - semantic key: success, error, or info (default).
 * @param {number} duration - Time in ms before auto-dismiss (default 3000).
 */
function showToast(message, type = 'info', duration = 3000) {
    let container = document.getElementById('toast-container');
    
    // Lifecycle: ensure the host container exists in the current DOM
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    
    // UI Component creation
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Icon Logic: resolve symbol based on semantic type
    const iconMap = {
        'success': '✅',
        'error':   '❌',
        'warning': '⚠️',
        'info':    'ℹ️',
        'waiting': '⌛'
    };
    const icon = iconMap[type] || '🔔';
    
    // Security: Use textContent instead of innerHTML to prevent XSS.
    // This ensures that any HTML passed in the message is rendered as literal text.
    const content = document.createElement('span');
    content.textContent = `${icon} ${message}`;
    toast.appendChild(content);
    
    container.appendChild(toast);
    
    /**
     * Automated Dismissal Workflow
     * Triggers the CSS exit animation and purges the DOM node.
     */
    setTimeout(() => {
        toast.classList.add('fade-out');
        // Cleanup: wait for transition to end before removal
        toast.addEventListener('animationend', () => {
            toast.remove();
        });
    }, duration);
}

/**
 * Global Exposure
 * Essential for platform-wide availability in both JS and templates.
 */
window.showToast = showToast;
