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

    // 3. Footer File List Toggle & AJAX Load
    const listFilesLink = document.getElementById('listFilesLink');
    if (listFilesLink) {
        listFilesLink.addEventListener('click', async function(e) {
            e.preventDefault();
            const box = document.getElementById('fileListBox');
            const tree = document.getElementById('fileListTree');
            if (!box || !tree) return;

            this.style.display = 'none';
            box.style.display  = 'block';
            tree.innerHTML = '<li><span class="loading-text">Scanning project structure...</span></li>';

            try {
                const response = await fetch('/api/system/file_map');
                const files = await response.json();
                
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
                sorted.forEach(file => {
                    const parts = file.split('/');
                    const filename = parts.pop();
                    let depth = 0;
                    while (openDirs.length > 0 && depth < openDirs.length && parts[depth] === openDirs[depth]) {
                        depth++;
                    }
                    while (openDirs.length > depth) {
                        openDirs.pop();
                        html += '</ul></li>';
                    }
                    while (depth < parts.length) {
                        const newDir = parts[depth];
                        openDirs.push(newDir);
                        html += `<li><span class="folder-name">${newDir}/</span><ul>`;
                        depth++;
                    }
                    html += `<li><a href="/source?f=${encodeURIComponent(file)}" class="file-link">${filename}</a></li>`;
                });

                while (openDirs.length > 0) {
                    openDirs.pop();
                    html += '</ul></li>';
                }
                html += `<li class="git-item">[ <a href="https://git.rendler.org/" class="footer-link">git</a> ]</li>`;
                tree.innerHTML = html;
            } catch (err) {
                console.error('File map error:', err);
                tree.innerHTML = '<li><span class="error-text">Failed to load file map.</span></li>';
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
