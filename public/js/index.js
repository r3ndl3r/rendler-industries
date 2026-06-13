// /public/js/index.js

/**
 * Landing Page Controller Module
 * 
 * This module manages the high-level dashboard functionality for the 
 * landing interface. It coordinates the primary system clock, uptime 
 * synchronization hook, and quick-access redirect overlay.
 * 
 * Features:
 * - Real-time AEST dashboard clock with 1-minute prefix updates
 * - Integrated 3D Flip Clock engine initialization
 * - Quick Access redirection system with progress feedback
 * - Uptime synchronization hook for system cores and family members
 * 
 * Dependencies:
 * - moment.js & moment-tz.js: For timezone-accurate formatting
 * - age.js: For uptime sync logic (upPage)
 * - default.js: For FlipClockManager and system icons
 */

/**
 * Initialization System
 * Boots landing page components and establishes event delegation
 */
document.addEventListener('DOMContentLoaded', function () {
    const prefixEl = document.getElementById('clock-prefix');
    const clockEl  = document.getElementById('main-clock');
    
    // Clock: set current date prefix and refresh every 60s
    if (prefixEl) {
        const updatePrefix = () => {
            prefixEl.textContent = moment().tz(APP_TZ).format('dddd, D MMMM YYYY');
        };
        updatePrefix();
        setInterval(updatePrefix, 60000);
    }
    
    // Clock: initialize 3D Flip Clock engine
    if (clockEl && typeof FlipClockManager !== 'undefined') {
        FlipClockManager.startRealTimeClock(clockEl, 'main-dashboard-clock');
    }

    // Uptime: start Landing Page sync service
    if (typeof upPage === 'function') {
        upPage();
    }

    /**
     * Logic: Quick Access Redirect
     * Manages the landing page interstitial redirection sequence.
     */
    const splash = document.getElementById('redirectSplash');
    if (splash) {
        const DURATION = 3000;              // Total redirect delay
        const TICK     = 50;                // Interval resolution
        let elapsed    = 0;
        let timer, interval;

        const progress  = document.getElementById('redirectProgress');
        const countdown = document.getElementById('redirectCountdown');
        const cancelBtn = splash.querySelector('.btn-cancel-redirect');

        /**
         * Clears all sequence timers and removes the overlay.
         */
        const stopRedirect = () => {
            clearTimeout(timer);
            clearInterval(interval);
            splash.style.display = 'none';
        };

        if (cancelBtn) {
            cancelBtn.addEventListener('click', stopRedirect);
        }

        // Sequence Loop: update progress bar and countdown text
        interval = setInterval(function () {
            elapsed += TICK;
            const pct = Math.min((elapsed / DURATION) * 100, 100);
            if (progress) progress.style.width = pct + '%';
            
            const remaining = Math.ceil((DURATION - elapsed) / 1000);
            if (countdown) countdown.textContent = remaining > 0 ? remaining : 0;
            
            if (elapsed >= DURATION) clearInterval(interval);
        }, TICK);

        // Final Redirect trigger
        timer = setTimeout(function () {
            window.location.href = '/quick';
        }, DURATION);
    }
});
