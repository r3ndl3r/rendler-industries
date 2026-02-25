/* /public/js/index.js */

function toggleFileList() {
    const link = document.getElementById('listFilesLink');
    const box  = document.getElementById('fileListBox');
    if (link && box) {
        link.style.display = 'none';
        box.style.display  = 'block';
    }
}

document.addEventListener('DOMContentLoaded', function () {
    if (typeof upPage === 'function') {
        upPage();
    }

    // Auto-redirect splash
    const splash = document.getElementById('redirectSplash');
    if (!splash) return;

    const DURATION = 3000;
    const TICK     = 50;
    let elapsed    = 0;
    let timer, interval;

    const progress  = document.getElementById('redirectProgress');
    const countdown = document.getElementById('redirectCountdown');

    window.cancelRedirect = function () {
        clearTimeout(timer);
        clearInterval(interval);
        splash.style.display = 'none';
    };

    interval = setInterval(function () {
        elapsed += TICK;
        const pct = Math.min((elapsed / DURATION) * 100, 100);
        progress.style.width  = pct + '%';
        const remaining       = Math.ceil((DURATION - elapsed) / 1000);
        countdown.textContent = remaining > 0 ? remaining : 0;
        if (elapsed >= DURATION) clearInterval(interval);
    }, TICK);

    timer = setTimeout(function () {
        window.location.href = '/quick';
    }, DURATION);
});
