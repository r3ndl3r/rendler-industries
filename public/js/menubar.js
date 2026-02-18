/* /public/js/menubar.js */

function toggleMenu() {
    const menu = document.getElementById('sideMenu');
    const overlay = document.getElementById('menuOverlay');
    const btn = document.querySelector('.menu-btn');
    
    if (menu.classList.contains('open')) {
        menu.classList.remove('open');
        overlay.classList.remove('open');
        btn.innerHTML = '☰';
    } else {
        menu.classList.add('open');
        overlay.classList.add('open');
        btn.innerHTML = '✕';
    }
}

function updateModal(status, isSpinning = true) {
    const statusText = document.getElementById('modal-status');
    const spinner = document.querySelector('#restart-modal .spinner');
    
    if (statusText) statusText.textContent = status;
    if (spinner) spinner.style.display = isSpinning ? 'block' : 'none';
}

function toggleGamesMenu() {
    var submenu = document.getElementById('gamesSubmenu');
    var arrow = document.getElementById('gamesArrow');
    if (submenu.style.display === 'none') {
        submenu.style.display = 'block';
        arrow.innerHTML = '▲';
    } else {
        submenu.style.display = 'none';
        arrow.innerHTML = '▼';
    }
}

async function startRestartSequence(event) {
    event.preventDefault();
    toggleMenu(); // Close menu

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

document.addEventListener('click', function(event) {
    const menu = document.getElementById('sideMenu');
    const btn = document.querySelector('.menu-btn');
    
    // Check if menu is open and click is outside menu and button
    if (menu.classList.contains('open') && 
        !menu.contains(event.target) && 
        !btn.contains(event.target)) {
        
        const overlay = document.getElementById('menuOverlay');
        menu.classList.remove('open');
        overlay.classList.remove('open');
        btn.innerHTML = '☰';
    }
});