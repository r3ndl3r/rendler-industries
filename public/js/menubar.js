// /public/js/menubar.js

/**
 * Global Navigation Controller Module
 * 
 * This module manages the primary application navigation system, including 
 * the dynamic sidebar menu, permission-aware link rendering, and system-level 
 * maintenance actions like server restarts.
 * 
 * Features:
 * - AJAX-driven menu population with client-side permission filtering
 * - Recursive rendering engine for nested submenus
 * - Multi-level submenu toggling with visual state indicators
 * - Unified server restart workflow with status modal feedback
 * - Mobile-optimized auto-closing logic for viewport transitions
 * 
 * Dependencies:
 * - default.js: For global interaction helpers
 */

/**
 * Interface: toggleMenu
 * Manages the open/closed state of the primary sidebar and its overlay.
 */
function toggleMenu() {
    const menu    = document.getElementById('sideMenu');
    const overlay = document.getElementById('menuOverlay');
    const btns    = document.querySelectorAll('.menu-btn');
    const isOpen  = menu.classList.contains('open');

    menu.classList.toggle('open', !isOpen);
    overlay.classList.toggle('open', !isOpen);
    btns.forEach(b => b.innerHTML = isOpen ? '☰' : '×');
}

/**
 * Interface: toggleSubmenu
 * Handles the expand/collapse logic for nested menu categories.
 * 
 * @param {string} id - Unique identifier for the submenu container
 * @returns {void}
 */
function toggleSubmenu(id) {
    const submenu = document.getElementById('submenu-' + id);
    const arrow = document.getElementById('arrow-' + id);
    
    if (!submenu || !arrow) return;

    if (!submenu.classList.contains('open')) {
        submenu.classList.add('open');
        arrow.innerHTML = '▲';
    } else {
        submenu.classList.remove('open');
        arrow.innerHTML = '▼';
    }
}

/**
 * UI Component: updateModal
 * Modifies the status and animation state of the restart overlay.
 * 
 * @param {string} status - Message to display
 * @param {boolean} [isSpinning=true] - Visibility flag for the loading spinner
 * @returns {void}
 */
function updateModal(status, isSpinning = true) {
    const statusText = document.getElementById('modal-status');
    const spinner = document.querySelector('#restart-modal .spinner');
    
    if (statusText) statusText.textContent = status;
    if (spinner) spinner.classList.toggle('hidden', !isSpinning);
}

/**
 * Hides the server restart feedback interface.
 * 
 * @returns {void}
 */
function closeRestartModal() {
    const modal = document.getElementById('restart-modal');
    if (modal) modal.classList.remove('show');
}

/**
 * Action: startRestartSequence
 * Triggers the administrative server restart via specialized endpoint.
 * Implements automated reconnection/reload logic.
 * 
 * @param {Event} event - Triggering click event
 * @returns {Promise<void>}
 */
async function startRestartSequence(event) {
    event.preventDefault();
    toggleMenu(); // Close navigation before showing overlay

    const modal = document.getElementById('restart-modal');
    if (modal) modal.classList.add('show');
    updateModal('Sending restart command to server...');

    try {
        const response = await fetch('/restart');
        if (!response.ok) {
            updateModal(`Restart failed (Status: ${response.status})`, false);
            // Self-dismiss after failure feedback
            setTimeout(() => { if (modal) modal.classList.remove('show'); }, 2000);
            return;
        }

        // Logic: allow server time to initiate shutdown before triggering reload
        updateModal('Restart initiated. Reloading...', true);
        await new Promise(r => setTimeout(r, 2000));
        location.reload();

    } catch (error) {
        // Fallback: connection loss usually indicates successful worker termination
        updateModal('Connection lost (Server likely restarting). Reloading...', false);
        setTimeout(() => { location.reload(); }, 2500);
    }
}

/**
 * Data Management: loadMenu
 * Bootstraps the navigation structure from the server state.
 * 
 * @returns {Promise<void>}
 */
async function loadMenu() {
    const container = document.getElementById('menuContent');
    if (!container) return;

    try {
        const response = await fetch('/menu/api/menubar');
        const data = await response.json();
        
        if (!data.success) throw new Error(data.error || 'Failed to load menu');

        let html = '';
        const currentPath = data.current_path;

        // Context: dynamically build items based on authentication state
        if (data.is_logged_in) {
            data.menu.forEach(item => {
                if (item.is_separator) {
                    html += '<div class="menu-separator"></div>';
                } else {
                    html += renderMenuItem(item, currentPath);
                }
            });

            html += '<div class="menu-spacer"></div>';
            
            // Add administrative maintenance actions if permitted
            if (data.is_admin) {
                html += `
                    <button class="menu-action text-red" onclick="startRestartSequence(event)">
                        ⚠️ Restart Server
                    </button>
                `;
            }
            html += `<a href="/logout" class="text-red">🚪 Logout</a>`;
        } else {
            // Public guest navigation view
            html += '<div class="menu-spacer"></div>';
            html += `<a href="/login" class="text-green">👤 Login</a>`;
            html += `<a href="/register">✎ Register</a>`;
        }

        container.innerHTML = html;

        // Lifecycle: attach mobile viewport auto-close listeners
        container.querySelectorAll('a').forEach(link => {
            if (!link.classList.contains('submenu-toggle')) {
                link.addEventListener('click', () => {
                    if (window.innerWidth <= 768) {
                        toggleMenu();
                    }
                });
            }
        });
    } catch (err) {
        console.error('Menu load error:', err);
        container.innerHTML = '<div class="menu-error">Failed to load menu</div>';
    }
}

/**
 * UI Component: renderMenuItem
 * Recursively generates HTML fragments for navigation items.
 * 
 * @param {Object} item - Menu item object from state
 * @param {string} currentPath - Active URL path for highlight detection
 * @returns {string} - Rendered HTML
 */
function renderMenuItem(item, currentPath) {
    const hasChildren = item.children && item.children.length > 0;
    
    // Constant: mapping of permission keys to descriptive titles
    const permAltMap = {
        'perm_admin': 'Admin',
        'perm_parent': 'Parent Only',
        'perm_child': 'Child',
        'perm_family': 'Family',
        'perm_user': 'Users',
        'perm_guest': 'Public'
    };
    
    const altText = permAltMap[item.perm_icon] || '';
    const emojiMap = {
        'perm_admin': '🛡️',
        'perm_parent': '🧑‍🧒‍🧒',
        'perm_child': '🧒',
        'perm_family': '👨‍👩‍👧‍👦',
        'perm_user': '👤',
        'perm_guest': '🌍'
    };
    const permIcon = item.perm_icon 
        ? `<small class="perm-indicator" title="${altText}">(${emojiMap[item.perm_icon] || '❓'})</small>` 
        : '';
    
    if (hasChildren) {
        // Category Header rendering
        return `
            <a href="javascript:void(0)" onclick="toggleSubmenu('${item.id}')" class="submenu-toggle">
                <span class="${item.css_class || ''}">${item.label}</span>
                ${permIcon}
                <span id="arrow-${item.id}" class="submenu-arrow">▼</span>
            </a>
            <div id="submenu-${item.id}" class="submenu-container">
                ${item.children.map(child => renderMenuItem(child, currentPath)).join('')}
            </div>
        `;
    } else {
        // Individual Link rendering
        const isActive = currentPath === item.url || (item.url !== '/' && currentPath.startsWith(item.url));
        const activeClass = isActive ? 'active' : '';
        const childClass = item.parent_id ? 'menu-item-child' : '';
        
        return `
            <a href="${item.url}" 
               class="${item.css_class || ''} ${activeClass} ${childClass}" 
               target="${item.target || '_self'}">
               <span>${item.label}</span>
               ${permIcon}
            </a>
        `;
    }
}

/**
 * Global Interaction Handler
 * Manages click-outside behavior for navigation closure.
 */
document.addEventListener('click', function(event) {
    const menu = document.getElementById('sideMenu');

    // Detect if click originated outside both the sidebar and any hamburger trigger
    if (menu && menu.classList.contains('open') &&
        !menu.contains(event.target) &&
        !event.target.closest('.menu-btn')) {

        const overlay = document.getElementById('menuOverlay');
        menu.classList.remove('open');
        overlay.classList.remove('open');
        document.querySelectorAll('.menu-btn').forEach(b => b.innerHTML = '☰');
    }
});

/**
 * Initialization Block
 */
document.addEventListener('DOMContentLoaded', loadMenu);

/**
 * Global Exposure
 * Required for inline event handlers in templates.
 */
window.toggleMenu = toggleMenu;
window.toggleSubmenu = toggleSubmenu;
window.startRestartSequence = startRestartSequence;
window.closeRestartModal = closeRestartModal;
