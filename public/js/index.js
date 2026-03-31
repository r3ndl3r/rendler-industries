// /public/js/index.js

/**
 * Landing Page Controller Module
 * 
 * This module manages the high-level dashboard functionality for the 
 * landing interface. It coordinates the primary system clock, uptime 
 * synchronization, and the project directory explorer.
 * 
 * Features:
 * - Real-time AEST dashboard clock with 1-minute prefix updates
 * - Integrated 3D Flip Clock engine initialization
 * - Collaborative "Quick Access" redirection system with progress feedback
 * - AJAX-driven project file mapper with recursive tree rendering
 * - Uptime synchronization for system cores and family members
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
     * UI Logic: Project File Explorer
     * Fetches the server-side file map and generates a recursive directory tree
     */
    const listFilesLink = document.getElementById('listFilesLink');
    if (listFilesLink) {
        listFilesLink.addEventListener('click', async function(e) {
            e.preventDefault();
            const box = document.getElementById('fileListBox');
            const tree = document.getElementById('fileListTree');
            if (!box || !tree) return;

            // Transition: hide trigger and show loading state
            this.style.display = 'none';
            box.style.display  = 'block';
            tree.innerHTML = '<li><span class="loading-text">Scanning project structure...</span></li>';

            try {
                const response = await fetch('/system/api/file_map');
                const files = await response.json();
                
                // Sort: directories first, then filenames case-insensitively
                const sorted = files.filter(f => f !== 'MyApp.pm').sort((a, b) => {
                    const aParts = a.split('/');
                    const bParts = b.split('/');
                    const limit = Math.min(aParts.length, bParts.length);
                    for (let i = 0; i < limit; i++) {
                        if (aParts[i] !== bParts[i]) {
                            const aIsFile = (i === aParts.length - 1);
                            const bIsFile = (i === bParts.length - 1);
                            if (aIsFile && !bIsFile) return -1;
                            if (!aIsFile && bIsFile) return 1;
                            return aParts[i].localeCompare(bParts[i], undefined, { sensitivity: 'base' });
                        }
                    }
                    return 0;
                });

                let html = '';
                let openDirs = [];
                // Tree Engine: generate nested HTML from path strings
                sorted.forEach(file => {
                    const parts = file.split('/');
                    const filename = parts.pop();
                    let depth = 0;
                    
                    // Identify existing common path depth
                    while (openDirs.length > 0 && depth < openDirs.length && parts[depth] === openDirs[depth]) {
                        depth++;
                    }
                    // Close finished directories
                    while (openDirs.length > depth) {
                        openDirs.pop();
                        html += '</ul></li>';
                    }
                    // Open new directory levels
                    while (depth < parts.length) {
                        const newDir = parts[depth];
                        openDirs.push(newDir);
                        html += `<li><span class="folder-name">${newDir}/</span><ul>`;
                        depth++;
                    }
                    // Render leaf node (file)
                    html += `<li><a href="/source?f=${encodeURIComponent(file)}" class="file-link">${filename}</a></li>`;
                });

                // Final cleanup: close remaining open lists
                while (openDirs.length > 0) {
                    openDirs.pop();
                    html += '</ul></li>';
                }
                tree.innerHTML = html;

                // Clean Room Implementation: Standalone footer for perfect centering
                const existingGit = box.querySelector('.git-link-container');
                if (existingGit) existingGit.remove();

                const gitContainer = document.createElement('div');
                gitContainer.className = 'git-link-container';
                gitContainer.innerHTML = '[ <a href="https://git.rendler.org/">git</a> ]';
                box.appendChild(gitContainer);
            } catch (err) {
                console.error('File map error:', err);
                tree.innerHTML = '<li><span class="error-text">Failed to load file map.</span></li>';
            }
        });
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
