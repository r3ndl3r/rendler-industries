// /public/js/menu/menubar.js

/**
 * Toggles the sidebar menu visibility.
 */
function toggleMenu() {
    const menu = document.getElementById('sideMenu');
    const overlay = document.getElementById('menuOverlay');
    const btn = document.querySelector('.menu-btn');
    
    if (menu.classList.contains('open')) {
        menu.classList.remove('open');
        overlay.classList.remove('open');
        btn.innerHTML = getIcon('menu');
    } else {
        menu.classList.add('open');
        overlay.classList.add('open');
        btn.innerHTML = getIcon('close');
    }
}

/**
 * Toggles visibility of submenus in the sidebar.
 * @param {string} id - Submenu container ID.
 */
function toggleSubmenu(id) {
    var submenu = document.getElementById('submenu-' + id);
    var arrow = document.getElementById('arrow-' + id);
    
    if (submenu.style.display !== 'block') {
        submenu.style.display = 'block';
        arrow.innerHTML = getIcon('collapse');
    } else {
        submenu.style.display = 'none';
        arrow.innerHTML = getIcon('expand');
    }
}

/**
 * Updates the restart modal status text and spinner.
 */
function updateModal(status, isSpinning = true) {
    const statusText = document.getElementById('modal-status');
    const spinner = document.querySelector('#restart-modal .spinner');
    
    if (statusText) statusText.textContent = status;
    if (spinner) spinner.style.display = isSpinning ? 'block' : 'none';
}

/**
 * Closes the restart modal manually.
 */
function closeRestartModal() {
    document.getElementById('restart-modal').style.display = 'none';
}

/**
 * Initiates the server restart sequence via AJAX.
 */
async function startRestartSequence(event) {
    event.preventDefault();
    toggleMenu();

    const modal = document.getElementById('restart-modal');
    modal.style.display = 'flex';
    updateModal('Sending restart command to server...');

    try {
        const response = await fetch('/restart');
        if (!response.ok) {
            updateModal(`Restart failed (Status: ${response.status})`, false);
            setTimeout(() => { modal.style.display = 'none'; }, 2000);
            return;
        }

        updateModal('Restart initiated. Reloading...', true);
        await new Promise(r => setTimeout(r, 2000));
        location.reload();

    } catch (error) {
        updateModal('Connection lost (Server likely restarting). Reloading...', false);
        setTimeout(() => { location.reload(); }, 2500);
    }
}

/**
 * Fetches and renders the menu structure from the server.
 */
async function loadMenu() {
    const container = document.getElementById('menuContent');
    if (!container) return;

    try {
        const response = await fetch('/api/menu/state');
        const data = await response.json();
        
        if (!data.success) throw new Error(data.error || 'Failed to load menu');

        let html = '';
        const currentPath = data.current_path;

        if (data.is_logged_in) {
            data.menu.forEach(item => {
                if (item.is_separator) {
                    html += '<div class="menu-separator"></div>';
                } else {
                    html += renderMenuItem(item, currentPath);
                }
            });

            html += '<div class="menu-spacer"></div>';
            
            if (data.is_admin) {
                html += `
                    <button class="menu-action text-red" onclick="startRestartSequence(event)">
                        ${getIcon('warning')} Restart Server
                    </button>
                `;
            }
            html += `<a href="/logout" class="text-red">${getIcon('logout')} Logout</a>`;
        } else {
            html += '<div class="menu-spacer"></div>';
            html += `<a href="/login" class="text-green">${getIcon('user')} Login</a>`;
            html += `<a href="/register">${getIcon('edit')} Register</a>`;
        }

        container.innerHTML = html;

        // Add click listeners to menu links to close menu on mobile
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
 * Recursively renders a menu item and its children.
 */
function renderMenuItem(item, currentPath) {
    const hasChildren = item.children && item.children.length > 0;
    const permIcon = item.perm_icon ? `<small class="perm-indicator">(${getIcon(item.perm_icon)})</small>` : '';
    
    if (hasChildren) {
        return `
            <a href="javascript:void(0)" onclick="toggleSubmenu('${item.id}')" class="submenu-toggle">
                <span class="${item.css_class || ''}">${item.label}</span>
                ${permIcon}
                <span id="arrow-${item.id}" class="submenu-arrow">${getIcon('expand')}</span>
            </a>
            <div id="submenu-${item.id}" class="submenu-container">
                ${item.children.map(child => renderMenuItem(child, currentPath)).join('')}
            </div>
        `;
    } else {
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

// Global click-outside-to-close logic
document.addEventListener('click', function(event) {
    const menu = document.getElementById('sideMenu');
    const btn = document.querySelector('.menu-btn');
    
    if (menu && menu.classList.contains('open') && 
        !menu.contains(event.target) && 
        !btn.contains(event.target)) {
        
        const overlay = document.getElementById('menuOverlay');
        menu.classList.remove('open');
        overlay.classList.remove('open');
        btn.innerHTML = getIcon('menu');
    }
});

// Initial load
document.addEventListener('DOMContentLoaded', loadMenu);

window.toggleMenu = toggleMenu;
window.toggleSubmenu = toggleSubmenu;
window.startRestartSequence = startRestartSequence;
window.closeRestartModal = closeRestartModal;
