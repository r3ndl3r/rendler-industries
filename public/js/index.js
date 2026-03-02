/* /public/js/index.js */

document.addEventListener('DOMContentLoaded', function () {
    const prefixEl = document.getElementById('clock-prefix');
    const clockEl  = document.getElementById('main-clock');
    
    if (prefixEl) {
        const updatePrefix = () => {
            prefixEl.textContent = moment().tz("Australia/Melbourne").format('dddd, D MMMM YYYY');
        };
        updatePrefix();
        setInterval(updatePrefix, 60000);
    }
    
    if (clockEl && typeof FlipClockManager !== 'undefined') {
        FlipClockManager.startRealTimeClock(clockEl, 'main-dashboard-clock');
    }

    if (typeof upPage === 'function') {
        upPage();
    }

    const listFilesLink = document.getElementById('listFilesLink');
    if (listFilesLink) {
        listFilesLink.addEventListener('click', function(e) {
            e.preventDefault();
            const box = document.getElementById('fileListBox');
            if (box) {
                this.style.display = 'none';
                box.style.display  = 'block';
            }
        });
    }

    const splash = document.getElementById('redirectSplash');
    if (splash) {
        const DURATION = 3000;
        const TICK     = 50;
        let elapsed    = 0;
        let timer, interval;

        const progress  = document.getElementById('redirectProgress');
        const countdown = document.getElementById('redirectCountdown');
        const cancelBtn = splash.querySelector('.btn-cancel-redirect');

        const stopRedirect = () => {
            clearTimeout(timer);
            clearInterval(interval);
            splash.style.display = 'none';
        };

        if (cancelBtn) {
            cancelBtn.addEventListener('click', stopRedirect);
        }

        interval = setInterval(function () {
            elapsed += TICK;
            const pct = Math.min((elapsed / DURATION) * 100, 100);
            if (progress) progress.style.width = pct + '%';
            
            const remaining = Math.ceil((DURATION - elapsed) / 1000);
            if (countdown) countdown.textContent = remaining > 0 ? remaining : 0;
            
            if (elapsed >= DURATION) clearInterval(interval);
        }, TICK);

        timer = setTimeout(function () {
            window.location.href = '/quick';
        }, DURATION);
    }
});
