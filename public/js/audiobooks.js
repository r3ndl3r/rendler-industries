// /public/js/audiobooks.js

/**
 * Name: Audiobooks Player
 * Purpose: Audible-style audiobook player for the family dashboard.
 * Features:
 *   - Three-view SPA: Library grid → Book detail → Full-screen player.
 *   - Per-user progress persistence (chapter + position) via /api/progress.
 *   - Range-aware audio streaming; automatic chapter advancement.
 *   - 30-second rewind, speed control (0.75–2×), sleep timer.
 *   - Persistent mini-player bar; all transitions via classList only.
 * Dependencies: default.js (apiPost, apiGet, escapeHtml, showToast)
 */

'use strict';

// ─── Module-level state ───────────────────────────────────────────────────────

const STATE = {
    books:    [],
    is_admin: false,
    filter:   'all', // 'all' | 'not_started' | 'in_progress'
    downloaded: {},   // { slug: ['file1.mp3', ...] } — populated from OfflineAudiobooks bridge
    downloading: {},  // { slug: { total: N, done: M } } — active download progress
    offline_mode: false,
};

const PLAYER = {
    slug:            null,
    chapter_idx:     0,
    book:            null,    // reference into STATE.books
    audio:           null,    // single HTMLAudioElement reused for every chapter
    save_timer:      null,    // setInterval id — autosave every 5 s
    sleep_timer:     null,    // setTimeout id — null when inactive
    sleep_end_of_ch: false,   // true when sleep mode is "end of chapter"
    sleep_remaining: 0,       // seconds remaining on sleep countdown
    sleep_tick:      null,    // setInterval id for countdown badge updates
    speed:           1.0,
    seeking:         false,   // true while user drags seek bar
    loaded_url:      null,    // audio.src that is currently loaded
    paused_at:       null,    // timestamp used for smart rewind on long pauses
    detail_slug:     null,    // slug currently shown in detail panel
    player_open:     false,
    detail_open:     false,
    wake_lock:       null,    // Screen Wake Lock object
    preload_audio:   null,    // background Audio element buffering the next chapter
};

const CONFIG = {
    SEARCH_DEBOUNCE_MS: 250,
    SEARCH_RESULT_LIMIT: 10,
};

let searchDebounceTimer = null;

/**
 * Acquires a screen wake lock to keep the device awake during playback.
 * @returns {Promise<void>}
 */
async function _requestWakeLock() {
    try {
        if ('wakeLock' in navigator && !PLAYER.wake_lock) {
            PLAYER.wake_lock = await navigator.wakeLock.request('screen');
            PLAYER.wake_lock.addEventListener('release', () => {
                PLAYER.wake_lock = null;
            });
        }
    } catch (err) {
        console.warn('Wake Lock request failed:', err.message);
    }
}

/**
 * Releases the screen wake lock.
 * @returns {void}
 */
function _releaseWakeLock() {
    if (PLAYER.wake_lock) {
        PLAYER.wake_lock.release();
        PLAYER.wake_lock = null;
    }
}

/**
 * Returns true when a book's chapters are time-offsets within a single audio file
 * (CUE sheet mode) rather than individual files per chapter.
 * @param {Object} book - Book record from STATE.books.
 * @returns {boolean}
 */
function _isCueMode(book) {
    const chapters = Array.isArray(book && book.chapters) ? book.chapters : [];
    return chapters.length > 0 && typeof chapters[0].start === 'number';
}

/**
 * Returns the cover URL for a book, substituting a local on-device URL if the book is downloaded.
 * @param {Object} book - Book record from STATE.books.
 * @returns {string}
 */
function _getCoverUrl(book) {
    if (!book || !book.cover_url) return '';
    if (window.OfflineAudiobooks && STATE.downloaded[book.slug]) {
        return `/audiobooks/api/localcover/${encodeURIComponent(book.slug)}`;
    }
    return book.cover_url;
}

/**
 * Returns the best playable URL for a chapter.
 * Downloaded Android books use the native loopback server so MP4/M4B range
 * probing behaves like normal HTTP instead of WebView request interception.
 * @param {string} slug     - Book slug.
 * @param {string} filename - Audio filename.
 * @returns {string} Playable audio URL.
 */
function _getAudioUrl(slug, filename) {
    const streamUrl = `/audiobooks/api/stream/${encodeURIComponent(slug)}/${encodeURIComponent(filename)}`;
    const lowerName = String(filename || '').toLowerCase();
    const needsLoopbackServer = lowerName.endsWith('.m4a') || lowerName.endsWith('.m4b');
    if (
        needsLoopbackServer &&
        window.OfflineAudiobooks &&
        STATE.downloaded[slug] &&
        typeof window.OfflineAudiobooks.getLocalServerPort === 'function'
    ) {
        try {
            const port = Number(window.OfflineAudiobooks.getLocalServerPort());
            if (port > 0) {
                return `http://127.0.0.1:${port}/${encodeURIComponent(slug)}/${encodeURIComponent(filename)}`;
            }
        } catch (err) {
            console.warn('Unable to resolve local audiobook server:', err.message);
        }
    }
    return streamUrl;
}

// Series names currently expanded, persisted to localStorage.
const EXPANDED_SERIES = new Set(
    JSON.parse(localStorage.getItem('ab_expanded_series') || '[]')
);

// Background sync interval reference
let _syncInterval = null;
let _stallTimeout = null;

// ─── Initialisation ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    const savedSpeed = parseFloat(localStorage.getItem('ab_speed') || '1');
    PLAYER.speed = isFinite(savedSpeed) ? savedSpeed : 1;
    _applySpeedPillUI(PLAYER.speed);

    _initAudio();
    loadState(true);

    const searchInput = document.getElementById('librarySearch');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(searchDebounceTimer);
            const query = searchInput.value.toLowerCase().trim();
            if (query) {
                searchDebounceTimer = setTimeout(updateAudiobookSearchResults, CONFIG.SEARCH_DEBOUNCE_MS);
            } else {
                updateAudiobookSearchResults();
            }
            renderLibrary();
        });
        searchInput.addEventListener('focus', () => {
            updateAudiobookSearchResults();
        });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeSearchResults();
                searchInput.blur();
            }
        });
    }

    // Notification permission must be requested inside a user gesture to satisfy browser policy.
    // A one-shot pointerdown fires on the first tap/click anywhere on the page.
    document.addEventListener('pointerdown', _requestNotificationPermission, { once: true });

    // Re-acquire wake lock when returning from background (browser releases it on visibility loss).
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && PLAYER.audio && !PLAYER.audio.paused) {
            _requestWakeLock();
        }
    });

    // Global click-away handler for popups
    window.addEventListener('click', (e) => {
        // Close search dropdown if clicking outside
        const searchWrapper = document.querySelector('.audiobook-search-wrapper');
        const searchResults = document.getElementById('audiobookSearchResults');
        if (searchResults && searchWrapper && !searchWrapper.contains(e.target)) {
            clearTimeout(searchDebounceTimer);
            searchResults.classList.add('hidden');
        }

        // Close chapter drawer if clicking outside
        const drawer = document.getElementById('chapterDrawer');
        const toggle = document.querySelector('.chapter-drawer-toggle');
        if (drawer && drawer.classList.contains('show')) {
            if (!drawer.contains(e.target) && !toggle.contains(e.target)) {
                drawer.classList.remove('show');
            }
        }

        // Close sleep menu if clicking outside
        const sleepMenu = document.getElementById('sleepMenu');
        const sleepBtn  = document.getElementById('sleepBtn');
        if (sleepMenu && !sleepMenu.classList.contains('hidden')) {
            if (!sleepMenu.contains(e.target) && !sleepBtn.contains(e.target)) {
                sleepMenu.classList.add('hidden');
            }
        }
    });

    _syncInterval = setInterval(() => loadState(false), 60_000);
});

/**
 * Handles native Android back navigation for audiobook-specific panels.
 * @returns {boolean} True when the back action was consumed locally.
 */
window.handleNativeBack = function() {
    const drawer = document.getElementById('chapterDrawer');
    if (drawer && drawer.classList.contains('show')) {
        drawer.classList.remove('show');
        return true;
    }

    const sleepMenu = document.getElementById('sleepMenu');
    if (sleepMenu && !sleepMenu.classList.contains('hidden')) {
        sleepMenu.classList.add('hidden');
        return true;
    }

    const playerPanel = document.getElementById('playerPanel');
    if (playerPanel && playerPanel.classList.contains('show')) {
        closePlayer();
        return true;
    }

    const detailPanel = document.getElementById('detailPanel');
    if (detailPanel && detailPanel.classList.contains('show')) {
        closeDetail();
        return true;
    }

    return false;
};

// ─── State loading ────────────────────────────────────────────────────────────

/**
 * Fetches the consolidated state from the server and re-renders the library.
 * Background calls are inhibited while the player or detail panel is open,
 * or while a text input is focused, to prevent focus disruption.
 * @param {boolean} force - When true, fetches even if a panel is open.
 * @returns {Promise<void>}
 */
async function loadState(force = false) {
    if (!force) {
        const active = document.activeElement;
        const inputFocused = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
        if (PLAYER.player_open || PLAYER.detail_open || inputFocused) return;
    }

    // Suppress network calls when offline to avoid "Network error" toast spam.
    const isOffline = typeof navigator.onLine !== 'undefined' && !navigator.onLine;
    if (isOffline) {
        if (force) _loadCachedState();
        return;
    }

    const res = await apiGet('/audiobooks/api/state');
    if (!res || !res.success) {
        // API unreachable or timed out — try loading from cache (offline cold-start).
        if (force) _loadCachedState();
        return;
    }

    _flushPendingProgress();

    STATE.books    = Array.isArray(res.books) ? res.books : [];
    _applyPendingProgressToState();
    STATE.is_admin = res.is_admin ? true : false;
    STATE.offline_mode = false;

    // Cache state for offline cold-start fallback.
    try {
        localStorage.setItem('ab_state_cache', JSON.stringify({
            books: STATE.books,
            is_admin: STATE.is_admin,
            cached_at: Date.now()
        }));
    } catch(e) {}

    document.getElementById('adminLink')?.classList.toggle('hidden', !STATE.is_admin);

    // Refresh book reference in PLAYER if a book is loaded.
    if (PLAYER.slug) {
        PLAYER.book = STATE.books.find(b => b.slug === PLAYER.slug) || null;
    }

    loadOfflineState();
    renderLibrary();
}

/**
 * Synchronises the client-side downloaded-books map from the Android bridge.
 * No-op when running in a regular browser (bridge unavailable).
 * @returns {void}
 */
function loadOfflineState() {
    if (!window.OfflineAudiobooks) return;
    try {
        STATE.downloaded = JSON.parse(window.OfflineAudiobooks.getDownloadedBooks()) || {};
    } catch(e) { STATE.downloaded = {}; }
}

let _dlPollInterval = null;

/**
 * Polls the Android bridge for download progress every 2 seconds.
 * Automatically stops when no active downloads remain.
 * @returns {void}
 */
function _startDownloadPoll() {
    if (_dlPollInterval || !window.OfflineAudiobooks) return;
    _dlPollInterval = setInterval(() => {
        let anyActive = false;
        for (const slug of Object.keys(STATE.downloading)) {
            try {
                const p = JSON.parse(window.OfflineAudiobooks.getDownloadProgress(slug));
                if (p.total > 0) {
                    const current = STATE.downloading[slug] || { total: 100, done: 0 };
                    const nextTotal = Number(p.total) || 100;
                    const nextDone = Math.min(nextTotal, Math.max(Number(current.done) || 0, Number(p.done) || 0));
                    STATE.downloading[slug] = { total: nextTotal, done: nextDone };

                    if (nextDone < nextTotal) {
                        anyActive = true;
                    } else {
                        delete STATE.downloading[slug];
                        loadOfflineState();
                        if (!STATE.downloaded[slug]) {
                            const err = window.OfflineAudiobooks.getLastError(slug);
                            if (err) showToast(`Download failed: ${err}`, 'error');
                        }
                    }
                } else if (p.total === 0) {
                    delete STATE.downloading[slug];
                    loadOfflineState();
                    if (!STATE.downloaded[slug]) {
                        const err = window.OfflineAudiobooks.getLastError(slug);
                        if (err) showToast(`Download failed: ${err}`, 'error');
                    }
                } else {
                    delete STATE.downloading[slug];
                    loadOfflineState();
                }
            } catch(e) { delete STATE.downloading[slug]; }
        }
        if (!anyActive) {
            clearInterval(_dlPollInterval);
            _dlPollInterval = null;
        }
        renderLibrary();
    }, 2000);
}

/**
 * Initiates an offline download for all chapter files in a book.
 * Checks available storage space before starting. CUE-mode books
 * deduplicate to the single underlying audio file automatically (bridge-side).
 * @param {string} slug - Book directory slug.
 * @returns {void}
 */
function downloadBook(slug) {
    if (!window.OfflineAudiobooks) return;
    const book = STATE.books.find(b => b.slug === slug);
    if (!book) return;
    if (STATE.downloaded[slug]) return;
    if (STATE.downloading[slug] && STATE.downloading[slug].done < STATE.downloading[slug].total) return;

    // Rough space check — 200 MB minimum safety threshold.
    try {
        const avail = parseInt(window.OfflineAudiobooks.getAvailableSpace(), 10);
        if (avail < 200 * 1024 * 1024) {
            showToast('Not enough storage space to download this book.', 'error');
            return;
        }
    } catch(e) {}

    const chapters = Array.isArray(book.chapters) ? book.chapters : [];
    // Deduplicate filenames (CUE-mode books share one file across chapters).
    const uniqueFiles = [...new Set(chapters.map(c => c.file).filter(Boolean))];
    if (uniqueFiles.length === 0) {
        showToast('No downloadable audio files found for this book.', 'error');
        return;
    }

    STATE.downloading[slug] = { total: 100, done: 0 };
    const absCoverUrl = book.cover_url ? new URL(book.cover_url, 'https://rendler.org').href : '';
    const title = book.title || slug;
    window.OfflineAudiobooks.downloadBook(slug, JSON.stringify(chapters), absCoverUrl, title);

    _startDownloadPoll();
    renderLibrary();
}

/**
 * Cancels an in-progress download for a book.
 * @param {string} slug - Book directory slug.
 * @returns {void}
 */
function cancelDownload(slug) {
    if (!window.OfflineAudiobooks) return;
    window.OfflineAudiobooks.cancelDownload(slug);
    delete STATE.downloading[slug];
    renderLibrary();
}

/**
 * Deletes all offline files for a book after user confirmation.
 * @param {string} slug - Book directory slug.
 * @returns {void}
 */
function deleteBookOffline(slug) {
    if (!window.OfflineAudiobooks) return;
    showConfirmModal({
        title:       'Delete offline copy?',
        icon:        '🗑',
        message:     'This will remove all downloaded files for this book from your device.',
        danger:      true,
        confirmText: 'Delete',
        onConfirm:   () => {
            window.OfflineAudiobooks.deleteBook(slug);
            delete STATE.downloaded[slug];
            delete STATE.downloading[slug];
            renderLibrary();
        }
    });
}

/**
 * Deletes saved playback progress for a book and removes it from the active
 * In Progress listing.
 * @param {string} slug - Book directory slug.
 * @returns {void}
 */
function deleteBookProgress(slug) {
    const book = STATE.books.find(b => b.slug === slug);
    if (!book || !book.progress) return;

    showConfirmModal({
        title:       'Remove progress?',
        icon:        '🧹',
        message:     'This will remove your saved position for this book.',
        danger:      true,
        confirmText: 'Remove',
        hideCancel:  true,
        onConfirm:   async () => {
            const res = await apiPost('/audiobooks/api/progress/delete', { book_slug: slug });
            if (!res) return;
            try {
                const pending = JSON.parse(localStorage.getItem('ab_pending_progress') || 'null');
                if (pending && pending.book_slug === slug) localStorage.removeItem('ab_pending_progress');
            } catch(e) {}
            book.progress = {};
            if (PLAYER.slug === slug) {
                PLAYER.chapter_idx = 0;
                PLAYER.book = book;
                if (PLAYER.audio && isFinite(PLAYER.audio.duration)) {
                    PLAYER.audio.currentTime = 0;
                }
            }
            renderLibrary();
        }
    });
}

/**
 * Loads the last successful state from localStorage when the API is unreachable.
 * Filters the library to only show books that are downloaded locally, since
 * streamed books are useless without network.
 * @returns {void}
 */
function _loadCachedState() {
    try {
        const raw = localStorage.getItem('ab_state_cache');
        if (raw) {
            const cached = JSON.parse(raw);
            STATE.books    = Array.isArray(cached.books) ? cached.books : [];
            STATE.is_admin = false; // Disable admin features offline.
        }
        _applyPendingProgressToState();
        STATE.offline_mode = true;

        // When running in the app without network-backed streaming, show only playable local books.
        loadOfflineState();
        if (window.OfflineAudiobooks) {
            STATE.books = STATE.books.filter(b => !!STATE.downloaded[b.slug]);
        }

        document.getElementById('adminLink')?.classList.add('hidden');
        renderLibrary();
    } catch(e) {
        console.error('Offline state load error:', e);
        renderLibrary();
    }
}

/**
 * Applies any pending progress in localStorage to the memory STATE.books so the
 * local UI and player reflect the latest offline position rather than being
 * overwritten by stale database states on startup or sync.
 * @returns {void}
 */
function _applyPendingProgressToState() {
    try {
        const pendingRaw = localStorage.getItem('ab_pending_progress');
        if (pendingRaw) {
            const pending = JSON.parse(pendingRaw);
            if (pending && pending.book_slug) {
                const book = STATE.books.find(b => b.slug === pending.book_slug);
                if (book) {
                    book.progress = book.progress || {};
                    book.progress.chapter_idx  = pending.chapter_idx;
                    book.progress.position_sec = pending.position_sec;
                    if (pending.completed !== undefined) {
                        book.progress.completed = pending.completed;
                    }

                    // Synchronize PLAYER object if the same book is already open
                    if (PLAYER.slug === pending.book_slug) {
                        PLAYER.book = book;
                    }
                }
            }
        }
    } catch(e) {
        console.error('Error applying pending progress to state:', e);
    }
}

function _pendingProgressMatches(current, payload) {
    if (!current) return false;
    try {
        const curPayload = JSON.parse(current);
        return curPayload.book_slug === payload.book_slug &&
            curPayload.chapter_idx === payload.chapter_idx &&
            Math.abs(curPayload.position_sec - payload.position_sec) < 1.0 &&
            (curPayload.client_updated_ms || 0) === (payload.client_updated_ms || 0);
    } catch(e) {
        return false;
    }
}

function _pendingProgressIsNotNewerThan(current, payload) {
    if (!current) return false;
    try {
        const curPayload = JSON.parse(current);
        return curPayload.book_slug === payload.book_slug &&
            (curPayload.client_updated_ms || 0) <= (payload.client_updated_ms || 0);
    } catch(e) {
        return false;
    }
}

/**
 * Saves audiobook progress without global toast noise.
 *
 * API STANDARDIZATION EXCEPTION:
 * Do not replace this with apiPost(). apiPost() is the shared user-facing POST
 * helper and intentionally emits toast notifications on failures/timeouts. This
 * endpoint is called by background audiobook playback/offline sync; surfacing
 * transient offline save failures as global toasts is noisy and misleading.
 *
 * Direct fetch() is used here only for /audiobooks/api/progress. The global fetch
 * hook in default.js still injects CSRF headers, so this keeps request security
 * while keeping the no-toast behavior local to audiobooks instead of adding an
 * app-specific silent mode to the shared apiPost() helper used by other modules.
 *
 * @param {Object} payload - Progress payload for /audiobooks/api/progress.
 * @returns {Promise<Object|null>} - Parsed JSON response or null on failure.
 */
async function _postProgressQuietly(payload) {
    try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 30000);
        const response = await fetch('/audiobooks/api/progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(payload),
            signal: controller.signal,
        });
        clearTimeout(id);

        if (response.status === 403 && window.Capacitor && window.Capacitor.isNativePlatform()) {
            if (typeof window.handleMobileAdminAuth === 'function') {
                window.handleMobileAdminAuth('/audiobooks/api/progress');
            }
            return null;
        }

        return await response.json();
    } catch (err) {
        console.warn('Quiet audiobook progress save failed:', err);
        return null;
    }
}

/**
 * Flushes any progress data buffered in localStorage during an offline period.
 * Called after a successful loadState() confirms the server is reachable.
 * @returns {void}
 */
function _flushPendingProgress() {
    const pending = localStorage.getItem('ab_pending_progress');
    if (!pending) return;
    try {
        const payload = JSON.parse(pending);
        if (!payload.client_updated_ms) {
            payload.client_updated_ms = Date.now();
            localStorage.setItem('ab_pending_progress', JSON.stringify(payload));
        }
        _postProgressQuietly(payload)
            .then(res => {
                if (res && res.success && res.applied) {
                    const current = localStorage.getItem('ab_pending_progress');
                    if (_pendingProgressMatches(current, payload)) {
                        localStorage.removeItem('ab_pending_progress');
                    }
                }
            })
            .catch(() => {});
    } catch(e) {
        localStorage.removeItem('ab_pending_progress');
    }
}

// ─── Library rendering ────────────────────────────────────────────────────────

/**
 * Returns a formatted series label for a book.
 * Numbered entries (series_index > 0) include the book number; companion books
 * that belong to the series but are not part of the main numbered sequence have
 * a series_index of 0 and return only the series name.
 * @param {Object} book - Book record from STATE.books.
 * @returns {string}
 */
function _seriesLabel(book) {
    if (!book.series) return '';
    return book.series_index > 0
        ? `${book.series} · Book ${book.series_index}`
        : book.series;
}

/**
 * Renders a single book row as an HTML string.
 * @param {Object} book - Book record from STATE.books.
 * @returns {string}
 */
function _renderBookRow(book) {
    const prog   = book.progress || {};
    const pct    = _progressPercent(book);
    const status = _statusLabel(book);

    const coverSrc = _getCoverUrl(book);
    const thumbHtml = coverSrc
        ? `<img src="${escapeHtml(coverSrc)}" alt="" class="book-row-thumb-img" loading="lazy"
               onerror="this.classList.add('hidden'); this.nextElementSibling.classList.remove('hidden');">
           <div class="book-row-thumb-fallback hidden">🎧</div>`
        : `<div class="book-row-thumb-fallback">🎧</div>`;

    const progressBar = pct > 0
        ? `<div class="book-row-progress"><div class="book-row-progress-fill" style="width:${pct}%"></div></div>`
        : '';

    const statusHtml = status
        ? `<p class="book-row-status${prog.completed ? ' complete' : ''}">${escapeHtml(status)}</p>`
        : '';

    let extraProgress = '';
    if (window.OfflineAudiobooks) {
        const dlProgress    = STATE.downloading[book.slug];
        const isDownloading = !!dlProgress && dlProgress.done < dlProgress.total;
        if (isDownloading) {
            const pctDl = dlProgress.total > 0 ? Math.round(dlProgress.done / dlProgress.total * 100) : 0;
            const textDl = dlProgress.total === 100 ? `${dlProgress.done}%` : `${dlProgress.done} / ${dlProgress.total}`;
            extraProgress = `<div class="book-row-progress dl-progress"><div class="book-row-progress-fill dl-fill" style="width:${pctDl}%"></div></div>
                <p class="book-row-status">Saving… ${textDl}</p>`;
        }
    }

    const chapIdx   = prog.chapter_idx || 0;
    const slugJs    = escapeHtml(JSON.stringify(book.slug));
    const seriesNum = book.series_index > 0
        ? `<span class="book-row-series">Book ${book.series_index}</span>`
        : '';
    const isNew    = STATE.filter !== 'in_progress' && book.date_added > 0 && (Date.now() / 1000 - book.date_added) < 48 * 3600;
    const newBadge = isNew ? '<span class="book-new-badge">NEW</span>' : '';
    const offlineBadge = (window.OfflineAudiobooks && STATE.downloaded[book.slug])
        ? '<span class="book-offline-badge">📥</span>' : '';
    const clearProgressBtn = STATE.filter === 'in_progress'
        ? `<button type="button" class="book-row-clear-progress" aria-label="Remove progress" title="Remove progress"
                   onclick="event.stopPropagation(); deleteBookProgress(${slugJs})">🧹</button>`
        : '';

    const progressWrap = (pct > 0 || statusHtml || extraProgress)
        ? `<div class="book-row-progress-wrap">${progressBar}${statusHtml}${extraProgress}</div>`
        : '';

    let offlineBtn = '';
    if (window.OfflineAudiobooks) {
        const isDownloaded  = !!STATE.downloaded[book.slug];
        const dlProgress    = STATE.downloading[book.slug];
        const isDownloading = !!dlProgress && dlProgress.done < dlProgress.total;

        if (isDownloading) {
            offlineBtn = `<button type="button" class="book-row-dl-btn dl-active" aria-label="Cancel download"
                                 onclick="event.stopPropagation(); cancelDownload(${slugJs})">⬇</button>`;
        } else if (isDownloaded) {
            offlineBtn = `<button type="button" class="book-row-dl-btn dl-delete" aria-label="Delete offline copy"
                                 onclick="event.stopPropagation(); deleteBookOffline(${slugJs})">🗑</button>`;
        } else {
            offlineBtn = `<button type="button" class="book-row-dl-btn" aria-label="Save for offline"
                                 onclick="event.stopPropagation(); downloadBook(${slugJs})">⬇</button>`;
        }
    }

    return `<div class="book-row" onclick="openPlayer(${slugJs}, ${chapIdx})" role="button" tabindex="0"
                 onkeydown="if(event.key==='Enter')openPlayer(${slugJs}, ${chapIdx})">
                <div class="book-row-cover">${thumbHtml}</div>
                <div class="book-row-info">
                    <p class="book-row-title">${escapeHtml(book.title || book.slug)}${clearProgressBtn}${newBadge}${offlineBadge}</p>
                    ${seriesNum}
                    <p class="book-row-author">${escapeHtml(book.author || '')}</p>
                    ${progressWrap}
                </div>
                <div class="book-row-actions">
                    ${offlineBtn}
                    <button type="button" class="book-row-play-btn" aria-label="Play" tabindex="-1"
                            onclick="event.stopPropagation(); openPlayer(${slugJs}, ${chapIdx}, true)">▶</button>
                </div>
            </div>`;
}

/**
 * Renders the book list into #libraryGrid, grouped by series.
 * Books with a series field are collected under a series header row, sorted by
 * series_index. Standalone books follow. Series groups are ordered by the most
 * recently played book within each group.
 * @returns {void}
 */
function renderLibrary() {
    const grid  = document.getElementById('libraryGrid');
    const query = (document.getElementById('librarySearch').value || '').toLowerCase().trim();

    // Sort by most recently played first; alphabetical fallback.
    const sorted = [...STATE.books].sort((a, b) => {
        const ta = (a.progress && a.progress.updated_at) || '';
        const tb = (b.progress && b.progress.updated_at) || '';
        if (ta && tb) return tb.localeCompare(ta);
        if (ta) return -1;
        if (tb) return 1;
        return (a.title || a.slug).localeCompare(b.title || b.slug);
    });

    const books = sorted.filter(b => {
        if (query) {
            const hit = (b.title  || '').toLowerCase().includes(query) ||
                        (b.author || '').toLowerCase().includes(query) ||
                        (b.series || '').toLowerCase().includes(query) ||
                        (b.narrator || '').toLowerCase().includes(query) ||
                        (b.description || '').toLowerCase().includes(query);
            if (!hit) return false;
        }
        const prog = b.progress || {};
        if (STATE.filter === 'not_started') {
            return !prog.completed && !prog.position_sec && !(prog.chapter_idx);
        }
        if (STATE.filter === 'in_progress') {
            return !prog.completed && (prog.position_sec > 0 || (prog.chapter_idx || 0) > 0);
        }
        return true;
    });

    // Update count badge and chip active states.
    const countEl = document.getElementById('libraryCount');
    if (countEl) countEl.textContent = `${books.length} title${books.length !== 1 ? 's' : ''}`;
    document.querySelectorAll('.filter-chip').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === STATE.filter);
    });

    if (!books.length) {
        if (query) {
            grid.innerHTML = '<p class="library-empty">No books match your search.</p>';
        } else if (STATE.offline_mode && window.OfflineAudiobooks) {
            grid.innerHTML = '<p class="library-empty">No downloaded audiobooks available offline.</p>';
        } else {
            grid.innerHTML = '<p class="library-empty">No audiobooks found.</p>';
        }
        return;
    }

    // Separate into series groups (Map preserves insertion order = most-recently-played first).
    const seriesMap  = new Map();
    const standalone = [];

    for (const book of books) {
        if (book.series) {
            if (!seriesMap.has(book.series)) seriesMap.set(book.series, []);
            seriesMap.get(book.series).push(book);
        } else {
            standalone.push(book);
        }
    }

    // Within each series, sort by series_index ascending.
    for (const group of seriesMap.values()) {
        group.sort((a, b) => (a.series_index || 0) - (b.series_index || 0));
    }

    let html = '';

    for (const [seriesName, group] of seriesMap) {
        const n         = group.length;
        const collapsed = !EXPANDED_SERIES.has(seriesName);
        const chevron   = collapsed ? '▸' : '▾';
        const seriesJs  = escapeHtml(JSON.stringify(seriesName));
        html += `<div class="series-group" data-series="${escapeHtml(seriesName)}">
            <div class="series-header" onclick="toggleSeriesCollapse(${seriesJs})" role="button" tabindex="0"
                 onkeydown="if(event.key==='Enter'||event.key===' ')toggleSeriesCollapse(${seriesJs})">
                <span class="series-chevron">${chevron}</span>
                <span class="series-name">${escapeHtml(seriesName)}</span>
                <span class="series-count">${n} book${n !== 1 ? 's' : ''}</span>
            </div>
            <div class="series-books${collapsed ? ' hidden' : ''}">
                ${group.map(_renderBookRow).join('')}
            </div>
        </div>`;
    }

    html += standalone.map(_renderBookRow).join('');
    grid.innerHTML = html;
}

/**
 * Sets the active library filter and re-renders.
 * @param {string} f - Filter key: 'all' | 'not_started' | 'in_progress'.
 * @returns {void}
 */
function setFilter(f) {
    STATE.filter = f;
    renderLibrary();
}

/**
 * Hides the search results dropdown and clears the debounce timer.
 * @returns {void}
 */
function closeSearchResults() {
    clearTimeout(searchDebounceTimer);
    const resultsEl = document.getElementById('audiobookSearchResults');
    if (resultsEl) resultsEl.classList.add('hidden');
}

/**
 * Renders the search results dropdown for the library search input.
 * Shows up to CONFIG.SEARCH_RESULT_LIMIT matching books with cover thumbnails.
 * @returns {void}
 */
function updateAudiobookSearchResults() {
    const input     = document.getElementById('librarySearch');
    const resultsEl = document.getElementById('audiobookSearchResults');
    if (!input || !resultsEl) return;

    const query = input.value.toLowerCase().trim();

    if (!query) {
        resultsEl.innerHTML = '';
        resultsEl.classList.add('hidden');
        return;
    }

    const sorted = [...STATE.books].sort((a, b) => {
        const ta = (a.progress && a.progress.updated_at) || '';
        const tb = (b.progress && b.progress.updated_at) || '';
        if (ta && tb) return tb.localeCompare(ta);
        if (ta) return -1;
        if (tb) return 1;
        return (a.title || a.slug).localeCompare(b.title || b.slug);
    });

    const matches = sorted.filter(b => {
        const hit = (b.title  || '').toLowerCase().includes(query) ||
                    (b.author || '').toLowerCase().includes(query) ||
                    (b.series || '').toLowerCase().includes(query) ||
                    (b.narrator || '').toLowerCase().includes(query) ||
                    (b.description || '').toLowerCase().includes(query);
        return hit;
    });

    const display = matches.slice(0, CONFIG.SEARCH_RESULT_LIMIT);

    if (display.length === 0) {
        resultsEl.innerHTML = '<div class="audiobook-search-no-results" role="status">No books found</div>';
    } else {
        resultsEl.innerHTML = display.map(book => {
            const coverSrc  = _getCoverUrl(book);
            const prog      = book.progress || {};
            const status    = _statusLabel(book);
            const statusCls = prog.completed ? ' complete' : '';
            const slugJs    = escapeHtml(JSON.stringify(book.slug));
            const chapIdx   = prog.chapter_idx || 0;
            const metaParts = [];
            if (book.author) metaParts.push(escapeHtml(book.author));
            if (book.series) metaParts.push(escapeHtml(book.series));
            const metaHtml = metaParts.length ? `<div class="audiobook-search-meta">${metaParts.join(' · ')}</div>` : '';
            const statusHtml = status ? `<div class="audiobook-search-status${statusCls}">${escapeHtml(status)}</div>` : '';

            const coverHtml = coverSrc
                ? `<div class="audiobook-search-cover"><img src="${escapeHtml(coverSrc)}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'audiobook-search-cover-fallback\\'>🎧</div>'"></div>`
                : `<div class="audiobook-search-cover"><div class="audiobook-search-cover-fallback">🎧</div></div>`;

            return `<div class="audiobook-search-item" role="option" tabindex="0"
                onclick="closeSearchResults(); openPlayer(${slugJs}, ${chapIdx})"
                onkeydown="if(event.key==='Enter'){closeSearchResults(); openPlayer(${slugJs}, ${chapIdx})}">
                ${coverHtml}
                <div class="audiobook-search-text">
                    <div class="audiobook-search-title">${escapeHtml(book.title || book.slug)}</div>
                    ${metaHtml}
                    ${statusHtml}
                </div>
            </div>`;
        }).join('');
    }

    if (document.activeElement === input) {
        resultsEl.classList.remove('hidden');
    }
}

/**
 * Toggles the collapsed state for a series group without a full re-render.
 * State is persisted to localStorage so collapsed groups survive page reloads.
 * @param {string} seriesName - The series name matching the data-series attribute.
 * @returns {void}
 */
function toggleSeriesCollapse(seriesName) {
    if (EXPANDED_SERIES.has(seriesName)) {
        EXPANDED_SERIES.delete(seriesName);
    } else {
        EXPANDED_SERIES.add(seriesName);
    }
    localStorage.setItem('ab_expanded_series', JSON.stringify([...EXPANDED_SERIES]));

    const group = document.querySelector(`.series-group[data-series="${CSS.escape(seriesName)}"]`);
    if (!group) return;
    const collapsed = !EXPANDED_SERIES.has(seriesName);
    group.querySelector('.series-books').classList.toggle('hidden', collapsed);
    const chevron = group.querySelector('.series-chevron');
    if (chevron) chevron.textContent = collapsed ? '▸' : '▾';
}

/**
 * Calculates the overall completion percentage for a book using duration data when
 * available; falls back to chapter index fraction when durations are not yet known.
 * @param {Object} book - Book record from STATE.books.
 * @returns {number} Integer 0–100.
 */
function _progressPercent(book) {
    const prog = book.progress || {};
    if (prog.completed) return 100;
    if (!prog.position_sec && !(prog.chapter_idx)) return 0;

    const total    = _totalBookDuration(book);
    const chapters = Array.isArray(book.chapters) ? book.chapters : [];

    if (total > 0) {
        let consumed;
        if (_isCueMode(book)) {
            consumed = prog.position_sec || 0;
        } else {
            const idx        = prog.chapter_idx || 0;
            const beforeCh   = chapters.slice(0, idx).reduce((a, c) => a + (c.duration || 0), 0);
            consumed = beforeCh + (prog.position_sec || 0);
        }
        return Math.min(100, Math.round((consumed / total) * 100));
    }

    // Duration data not yet available — estimate from chapter index.
    const totalCh = book.total_chapters || chapters.length || 0;
    if (!totalCh) return 0;
    return Math.min(100, Math.round(((prog.chapter_idx || 0) / totalCh) * 100));
}

/**
 * Returns a human-readable status string for the library row (e.g. "2 hr 14 min left").
 * Returns 'Finished' for completed books, empty string for not-started books.
 * @param {Object} book - Book record from STATE.books.
 * @returns {string}
 */
function _statusLabel(book) {
    const prog = book.progress || {};
    if (prog.completed) return 'Finished';

    const total    = _totalBookDuration(book);
    const chapters = Array.isArray(book.chapters) ? book.chapters : [];

    if (!prog.position_sec && !(prog.chapter_idx)) {
        if (total > 0 && chapters.length > 0) return _formatDuration(total);
        return '';
    }

    if (!total || !chapters.length) return '';

    let remaining;
    if (_isCueMode(book)) {
        remaining = Math.max(0, total - (prog.position_sec || 0));
    } else {
        const idx        = prog.chapter_idx || 0;
        const pos        = prog.position_sec || 0;
        const curDur     = (chapters[idx] || {}).duration || 0;
        const remainInCh = Math.max(0, curDur - pos);
        const remainAfter = chapters.slice(idx + 1).reduce((a, c) => a + (c.duration || 0), 0);
        remaining = remainInCh + remainAfter;
    }

    if (remaining <= 0) return '';
    return `${_formatDuration(remaining)} left`;
}

// ─── Book Detail Panel ────────────────────────────────────────────────────────

/**
 * Opens the book detail slide-up panel for the given slug.
 * @param {string} slug - Book directory slug.
 * @returns {void}
 */
function openDetail(slug) {
    const book = STATE.books.find(b => b.slug === slug);
    if (!book) return;

    PLAYER.detail_slug = slug;
    PLAYER.detail_open = true;

    document.getElementById('detailHeaderTitle').textContent = book.title || slug;
    document.getElementById('detailTitle').textContent       = book.title || slug;
    document.getElementById('detailSeries').textContent     = _seriesLabel(book);
    document.getElementById('detailAuthor').textContent     = book.author   ? `by ${book.author}` : '';
    document.getElementById('detailNarrator').textContent   = book.narrator ? `Narrated by ${book.narrator}` : '';
    document.getElementById('detailDescription').textContent = book.description || '';

    const totalSec = _totalBookDuration(book);
    document.getElementById('detailDuration').textContent = totalSec > 0 ? _formatDuration(totalSec) : '';

    const coverEl       = document.getElementById('detailCover');
    const fallbackEl    = document.getElementById('detailCoverFallback');
    const coverSrc      = _getCoverUrl(book);
    if (coverSrc) {
        coverEl.src = coverSrc;
        coverEl.classList.remove('hidden');
        fallbackEl.classList.add('hidden');
    } else {
        coverEl.classList.add('hidden');
        fallbackEl.classList.remove('hidden');
    }

    document.getElementById('detailPanel').classList.add('show');
}

/**
 * Closes the book detail panel.
 * @returns {void}
 */
function closeDetail() {
    document.getElementById('detailPanel').classList.remove('show');
    PLAYER.detail_open = false;
    PLAYER.detail_slug = null;
}



// ─── Player ───────────────────────────────────────────────────────────────────

/**
 * Initialises the single shared HTMLAudioElement and wires all its event listeners.
 * Called once on DOMContentLoaded.
 * @returns {void}
 */
function _initAudio() {
    const audio = new Audio();
    PLAYER.audio = audio;

    audio.addEventListener('timeupdate', _onTimeUpdate);
    audio.addEventListener('ended',      _onChapterEnded);
    audio.addEventListener('playing',    _onPlaying);
    audio.addEventListener('pause',      _onPaused);
    audio.addEventListener('error',      _onAudioError);
    audio.addEventListener('canplay',    _onCanPlay, { once: false });
    audio.addEventListener('waiting', () => {
        document.getElementById('playPauseBtn').textContent = '⏳';
        document.getElementById('playerPanel').classList.add('player-buffering');
        // If still buffering after 10 seconds, show a helpful message, but not when offline
        // (audio may continue playing from buffer) or when already in offline_mode.
        clearTimeout(_stallTimeout);
        _stallTimeout = setTimeout(() => {
            if (audio.paused || !document.getElementById('playerPanel').classList.contains('player-buffering')) return;
            if (STATE.offline_mode || audio.readyState >= 3) return; // Buffered enough to keep playing.
            showToast('Waiting for connection…', 'error');
        }, 10000);
    });
    audio.addEventListener('stalled',    () => { console.warn('Playback stalled (buffering)'); });

    const Cap = window.Capacitor;
    const msPlugin = Cap && Cap.Plugins && Cap.Plugins.MediaSession ? Cap.Plugins.MediaSession : null;

    if (msPlugin) {
        msPlugin.setActionHandler({ action: 'play' }, () => { togglePlay(); });
        msPlugin.setActionHandler({ action: 'pause' }, () => { togglePlay(); });
        msPlugin.setActionHandler({ action: 'stop' }, () => { closePlayer(); });
        msPlugin.setActionHandler({ action: 'previoustrack' }, () => { prevChapter(); });
        msPlugin.setActionHandler({ action: 'nexttrack' }, () => { nextChapter(); });
        msPlugin.setActionHandler({ action: 'seekbackward' }, () => { rewind30(); });
        msPlugin.setActionHandler({ action: 'seekforward' }, () => { forward30(); });
        msPlugin.setActionHandler({ action: 'seekto' }, ({ seekTime }) => {
            if (PLAYER.audio && isFinite(seekTime)) PLAYER.audio.currentTime = seekTime;
        });
    } else if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', () => { togglePlay(); });
        navigator.mediaSession.setActionHandler('pause', () => { togglePlay(); });
        navigator.mediaSession.setActionHandler('stop', () => { closePlayer(); });
        navigator.mediaSession.setActionHandler('previoustrack', () => { prevChapter(); });
        navigator.mediaSession.setActionHandler('nexttrack', () => { nextChapter(); });
        navigator.mediaSession.setActionHandler('seekbackward', () => { rewind30(); });
        navigator.mediaSession.setActionHandler('seekforward', () => { forward30(); });
        navigator.mediaSession.setActionHandler('seekto', details => {
            if (PLAYER.audio && isFinite(details.seekTime)) PLAYER.audio.currentTime = details.seekTime;
        });
    }

    const seekBar = document.getElementById('seekBar');
    seekBar.addEventListener('mousedown',  () => { PLAYER.seeking = true; });
    seekBar.addEventListener('touchstart', () => { PLAYER.seeking = true; }, { passive: true });
    seekBar.addEventListener('input',      _onSeekInput);
    seekBar.addEventListener('change',     _onSeekCommit);
}

/**
 * Opens the full-screen player for a book at a specific chapter.
 * Starts playback from the user's saved position if opening the same
 * chapter they last left off on; otherwise starts from the beginning.
 * @param {string}  slug        - Book directory slug.
 * @param {number}  chapter_idx - Zero-based chapter index.
 * @param {boolean} autoplay    - Whether to start playback immediately (default false).
 * @returns {void}
 */
function openPlayer(slug, chapter_idx, autoplay = false) {
    const book = STATE.books.find(b => b.slug === slug);
    if (!book) return;

    PLAYER.slug    = slug;
    PLAYER.book    = book;
    PLAYER.player_open = true;

    const chapters = Array.isArray(book.chapters) ? book.chapters : [];
    const idx = Math.max(0, Math.min(chapter_idx, chapters.length - 1));
    PLAYER.chapter_idx = idx;

    _updatePlayerHeader(book);
    _updateCoverUI(book, 'playerCover', 'playerCoverFallback');
    document.getElementById('playerSeries').textContent = _seriesLabel(book);
    document.getElementById('playerAuthor').textContent = book.author ? `by ${book.author}` : '';
    document.getElementById('playPauseBtn').textContent = '▶';

    document.getElementById('playerPanel').classList.add('show');
    _startSaveTimer();
    _loadChapter(idx, autoplay);
}

/**
 * Stops playback, saves progress, and fully closes the player.
 * @returns {void}
 */
function closePlayer() {
    if (PLAYER.audio) {
        PLAYER.audio.pause();
    }
    _saveProgress(false);
    _stopSaveTimer();
    cancelSleepTimer();
    _releaseWakeLock();
    _clearPreload();

    const Cap = window.Capacitor;
    const msPlugin = Cap && Cap.Plugins && Cap.Plugins.MediaSession ? Cap.Plugins.MediaSession : null;

    if (msPlugin) {
        msPlugin.setPlaybackState({ playbackState: 'none' }).catch(() => {});
    } else if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
    }

    document.getElementById('playerPanel').classList.remove('show', 'player-buffering');
    document.getElementById('chapterDrawer').classList.remove('show');

    PLAYER.player_open  = false;
    PLAYER.slug         = null;
    PLAYER.book         = null;
    PLAYER.chapter_idx  = 0;
    PLAYER.loaded_url   = null;
}

/**
 * Loads a chapter into the audio element and begins playback.
 * Seeks to the saved position when loading the chapter the user last left on.
 * @param {number}  idx      - Zero-based chapter index.
 * @param {boolean} autoplay - Whether to start playback after load.
 * @returns {void}
 */
function _loadChapter(idx, autoplay = true) {
    const book     = PLAYER.book;
    const chapters = Array.isArray(book && book.chapters) ? book.chapters : [];
    if (!chapters.length) return;

    idx = Math.max(0, Math.min(idx, chapters.length - 1));
    PLAYER.chapter_idx = idx;
    _updateChapterUI(idx); // Updates chapter name, drawer, and media session metadata

    const ch    = chapters[idx];
    const slug  = PLAYER.slug;
    const audio = PLAYER.audio;
    const cue   = _isCueMode(book);
    const url   = _getAudioUrl(slug, ch.file);

    // Determine seek target: CUE mode uses absolute file position; multi-file uses offset from 0.
    const prog   = book.progress || {};
    const savedChapterIdx = Number(prog.chapter_idx) || 0;
    let seekTo;
    if (cue) {
        const chStart = ch.start || 0;
        seekTo = (savedChapterIdx === idx && prog.position_sec > chStart)
            ? prog.position_sec : chStart;
    } else {
        seekTo = (savedChapterIdx === idx && prog.position_sec > 0)
            ? prog.position_sec : 0;
    }

    const doSeekAndPlay = () => {
        if (Math.abs(audio.currentTime - seekTo) > 0.5) {
            audio.currentTime = seekTo;
        }
        if (autoplay) {
            audio.play().catch(err => {
                console.warn('Autoplay blocked:', err.message);
            });
        }
    };

    if (cue && PLAYER.loaded_url === url) {
        // CUE mode: file already loaded — just seek to the chapter start offset.
        doSeekAndPlay();
    } else {
        if (autoplay) {
            document.getElementById('playerPanel').classList.add('player-buffering');
            document.getElementById('playPauseBtn').textContent = '⏳';
        }
        audio.src = url;
        audio.load();
        audio.playbackRate = PLAYER.speed;
        PLAYER.loaded_url = url;

        audio.removeEventListener('canplay', audio._pendingCanPlay);
        audio._pendingCanPlay = doSeekAndPlay;
        audio.addEventListener('canplay', audio._pendingCanPlay, { once: true });

        // Once duration is known, compute per-chapter durations and persist them.
        const onDuration = () => {
            if (!isFinite(audio.duration) || audio.duration <= 0) return;
            if (cue) {
                _computeCueDurations(book, audio.duration);
            } else {
                if (!ch.duration || Math.abs(ch.duration - audio.duration) > 1) {
                    ch.duration = audio.duration;
                }
            }
            if (STATE.is_admin) _persistChapterDuration(slug, book);
        };
        audio.addEventListener('durationchange', onDuration, { once: true });
    }
}

/**
 * Computes per-chapter durations for CUE-mode books from the total audio duration.
 * Duration of chapter N = start(N+1) - start(N); last chapter fills to end of file.
 * @param {Object} book          - Book record (chapters array mutated in place).
 * @param {number} totalDuration - Total audio file duration in seconds.
 * @returns {void}
 */
function _computeCueDurations(book, totalDuration) {
    const chapters = Array.isArray(book.chapters) ? book.chapters : [];
    chapters.forEach((ch, i) => {
        const nextStart = (i + 1 < chapters.length) ? (chapters[i + 1].start || 0) : totalDuration;
        ch.duration = Math.max(0, nextStart - (ch.start || 0));
    });
}

/**
 * Discards the background preload audio element.
 * @returns {void}
 */
function _clearPreload() {
    if (PLAYER.preload_audio) {
        PLAYER.preload_audio.src = '';
        PLAYER.preload_audio = null;
    }
}

/**
 * Starts buffering the next chapter in a background Audio element so the HTTP
 * response is cached before the main audio element requests it.
 * Only runs for multi-file books (CUE mode uses a single file, no gap to bridge).
 * Called when the current chapter has less than 60 seconds remaining.
 * @returns {void}
 */
function _preloadNextChapter() {
    if (_isCueMode(PLAYER.book)) return;
    const chapters = Array.isArray(PLAYER.book && PLAYER.book.chapters) ? PLAYER.book.chapters : [];
    const nextIdx  = PLAYER.chapter_idx + 1;
    if (nextIdx >= chapters.length) return;

    const ch  = chapters[nextIdx];
    const url = _getAudioUrl(PLAYER.slug, ch.file);
    if (PLAYER.preload_audio && PLAYER.preload_audio._preloadUrl === url) return;

    _clearPreload();
    const pre = new Audio();
    pre.preload = 'auto';
    pre._preloadUrl = url;
    pre.src = url;
    PLAYER.preload_audio = pre;
}

/**
 * Sends updated chapter duration data back to meta.json via api_save_meta.
 * Sends as JSON because chapters is a nested array that URLSearchParams cannot encode.
 * Fire-and-forget — errors are non-fatal.
 * @param {string} slug - Book slug.
 * @param {Object} book - Book record with updated chapters array.
 * @returns {void}
 */
function _persistChapterDuration(slug, book) {
    const chapters = Array.isArray(book.chapters) ? book.chapters : [];
    const token = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
    fetch(`/audiobooks/api/meta/${encodeURIComponent(slug)}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        body:    JSON.stringify({ chapters }),
    }).catch(() => {});
}

// ─── Player UI helpers ────────────────────────────────────────────────────────

/**
 * Updates chapter-specific UI elements in the player (chapter name, drawer).
 * @param {number} idx - Zero-based chapter index.
 * @returns {void}
 */
function _updateChapterUI(idx) {
    const book     = PLAYER.book;
    const chapters = Array.isArray(book && book.chapters) ? book.chapters : [];
    const ch       = chapters[idx] || {};

    document.getElementById('playerChapterName').textContent = ch.title || `Chapter ${idx + 1}`;
    document.getElementById('seekBar').value = 0;
    document.getElementById('playerElapsed').textContent   = '0:00';
    document.getElementById('playerRemaining').textContent = ch.duration > 0 ? `-${_formatDuration(ch.duration)}` : '-0:00';

    document.getElementById('prevChapterBtn').disabled = (idx === 0);
    document.getElementById('nextChapterBtn').disabled = (idx >= chapters.length - 1);

    _renderPlayerChapterList();
    _updateMediaSessionMetadata();
}

/**
 * Updates the native mobile media session metadata (lock screen controls).
 * @returns {void}
 */
function _updateMediaSessionMetadata() {
    if (!PLAYER.book) return;

    const book = PLAYER.book;
    const chapters = Array.isArray(book.chapters) ? book.chapters : [];
    const ch = chapters[PLAYER.chapter_idx] || {};
    
    // APK Support: Force production URL so Android can fetch artwork from outside the app
    const baseUrl = 'https://rendler.org';
    const coverSrc = _getCoverUrl(book);
    const artworkUrl = coverSrc ? new URL(coverSrc, baseUrl).href : 'https://rendler.org/favicon.ico';

    const title = ch.title || book.title || 'Audiobook';
    const artist = book.author || 'Rendler Industries';
    const album = book.title || 'Audiobooks';

    const Cap = window.Capacitor;
    const msPlugin = Cap && Cap.Plugins && Cap.Plugins.MediaSession ? Cap.Plugins.MediaSession : null;

    if (msPlugin) {
        msPlugin.setMetadata({
            title: title,
            artist: artist,
            album: album,
            artwork: [
                { src: artworkUrl, sizes: '512x512', type: 'image/jpeg' }
            ]
        }).catch(() => {});
        msPlugin.setPlaybackState({
            playbackState: PLAYER.audio && !PLAYER.audio.paused ? 'playing' : 'paused'
        }).catch(() => {});
    } else if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: title,
            artist: artist,
            album: album,
            artwork: [
                { src: artworkUrl, sizes: '512x512', type: 'image/jpeg' }
            ]
        });
    }
}

/**
 * Requests notification permissions from the user.
 * Supports both standard browsers and Capacitor-based native apps.
 * @returns {Promise<void>}
 */
async function _requestNotificationPermission() {
    // 1. Standard Web API
    if ('Notification' in window && Notification.permission === 'default') {
        try {
            await Notification.requestPermission();
        } catch (err) {
            console.warn('Standard notification request failed:', err);
        }
    }

    // 2. Capacitor Native Bridge (for APK support)
    // Small delay to ensure the Capacitor bridge is fully initialized
    setTimeout(async () => {
        const Cap = window.Capacitor;
        if (Cap && Cap.Plugins && Cap.Plugins.PushNotifications) {
            try {
                const result = await Cap.Plugins.PushNotifications.requestPermissions();
                console.log('Capacitor notification permission result:', result.receive);
                if (result.receive === 'denied') {
                    showToast('⚠️ Notifications are disabled. Media controls will not show on lock screen.', 'warn');
                }
            } catch (err) {
                console.warn('Capacitor notification request failed:', err);
            }
        }
    }, 1000);
}

/**
 * Updates the player header with the book title.
 * @param {Object} book - Book record.
 * @returns {void}
 */
function _updatePlayerHeader(book) {
    document.getElementById('playerHeaderTitle').textContent = book.title || book.slug || '';
}

/**
 * Sets cover image elements; shows fallback if no cover_url.
 * @param {Object} book        - Book record.
 * @param {string} imgId       - ID of the <img> element.
 * @param {string} fallbackId  - ID of the fallback <div>.
 * @returns {void}
 */
function _updateCoverUI(book, imgId, fallbackId) {
    const img      = document.getElementById(imgId);
    const fallback = document.getElementById(fallbackId);
    if (!img || !fallback) return;

    const coverSrc = _getCoverUrl(book);
    if (coverSrc) {
        img.src = coverSrc;
        img.classList.remove('hidden');
        fallback.classList.add('hidden');
    } else {
        img.classList.add('hidden');
        fallback.classList.remove('hidden');
    }
}

/**
 * Renders the chapter list inside the player's drawer panel.
 * @returns {void}
 */
function _renderPlayerChapterList() {
    const list     = document.getElementById('playerChapterList');
    const book     = PLAYER.book;
    const chapters = Array.isArray(book && book.chapters) ? book.chapters : [];

    if (!chapters.length) {
        list.innerHTML = '<li class="chapter-empty">No chapters.</li>';
        return;
    }

    list.innerHTML = chapters.map((ch, i) => {
        const isCurrent = i === PLAYER.chapter_idx;
        const dur = ch.duration > 0 ? _formatDuration(ch.duration) : '';
        const cls = isCurrent ? 'chapter-item current' : 'chapter-item';
        return `<li class="${cls}">
            <button type="button" class="chapter-item-btn"
                onclick="jumpToChapter(${i})">
                <span class="ch-num">${i + 1}</span>
                <span class="ch-title">${escapeHtml(ch.title || `Chapter ${i + 1}`)}</span>
                <span class="ch-dur">${escapeHtml(dur)}</span>
            </button>
        </li>`;
    }).join('');
}

// ─── Audio event handlers ─────────────────────────────────────────────────────

/**
 * Updates seek bar and time displays on every timeupdate event.
 * In CUE mode, also advances the chapter display when the playhead crosses
 * a chapter boundary and updates elapsed/remaining relative to the chapter.
 * Skips all updates while the user is actively dragging the seek bar.
 * @returns {void}
 */
function _onTimeUpdate() {
    if (PLAYER.seeking) return;
    const audio = PLAYER.audio;
    if (!audio || !isFinite(audio.duration) || audio.duration <= 0) return;

    const book     = PLAYER.book;
    const cue      = _isCueMode(book);
    const chapters = Array.isArray(book && book.chapters) ? book.chapters : [];
    const pos      = audio.currentTime;

    if (cue && chapters.length && chapters[PLAYER.chapter_idx]) {
        // Detect chapter boundary crossing: find which chapter we're currently in.
        let newIdx = 0;
        for (let i = chapters.length - 1; i >= 0; i--) {
            if (pos >= (chapters[i].start || 0)) { newIdx = i; break; }
        }
        if (newIdx !== PLAYER.chapter_idx) {
            // End-of-chapter sleep fires on CUE chapter boundaries, not file end.
            if (PLAYER.sleep_end_of_ch) {
                PLAYER.sleep_end_of_ch = false;
                _hideSleepBadge();
                audio.pause();
                _saveProgress(false);
                return;
            }
            PLAYER.chapter_idx = newIdx;
            _updateChapterUI(newIdx);
        }

        // Show elapsed/remaining relative to current chapter, not whole file.
        const chStart = chapters[PLAYER.chapter_idx].start || 0;
        const chDur   = chapters[PLAYER.chapter_idx].duration || 0;
        const elapsed = pos - chStart;
        const remain  = chDur > 0 ? chDur - elapsed : 0;

        document.getElementById('playerElapsed').textContent   = _formatTime(elapsed);
        document.getElementById('playerRemaining').textContent = `-${_formatTime(remain)}`;

        const pct = chDur > 0 ? Math.min(100, (elapsed / chDur) * 100) : 0;
        document.getElementById('seekBar').value = pct;
    } else {
        const pct = (pos / audio.duration) * 100;
        document.getElementById('seekBar').value = pct;
        document.getElementById('playerElapsed').textContent   = _formatTime(pos);
        document.getElementById('playerRemaining').textContent = `-${_formatTime(audio.duration - pos)}`;
    }

    // Start buffering the next chapter when within 60 s of end (multi-file only).
    if (!cue && isFinite(audio.duration) && (audio.duration - pos) < 60) {
        _preloadNextChapter();
    }

    // Sync position state to lock screen
    if (isFinite(audio.duration) && audio.duration > 0) {
        const Cap = window.Capacitor;
        const msPlugin = Cap && Cap.Plugins && Cap.Plugins.MediaSession ? Cap.Plugins.MediaSession : null;

        if (msPlugin) {
            msPlugin.setPositionState({
                duration: audio.duration,
                playbackRate: audio.playbackRate,
                position: audio.currentTime
            }).catch(() => {});
        } else if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
            navigator.mediaSession.setPositionState({
                duration: audio.duration,
                playbackRate: audio.playbackRate,
                position: audio.currentTime
            });
        }
    }
}

/**
 * Advances to the next chapter when the current chapter's audio ends,
 * or marks the book complete if it was the last chapter.
 * Respects sleep-timer end-of-chapter mode.
 * @returns {void}
 */
function _onChapterEnded() {
    // End-of-chapter sleep: pause now and cancel timer mode.
    if (PLAYER.sleep_end_of_ch) {
        PLAYER.sleep_end_of_ch = false;
        _hideSleepBadge();
        _saveProgress(false);
        return;
    }

    const book     = PLAYER.book;
    const chapters = Array.isArray(book && book.chapters) ? book.chapters : [];
    const nextIdx  = PLAYER.chapter_idx + 1;

    if (nextIdx < chapters.length) {
        PLAYER.chapter_idx = nextIdx;
        // Reset saved position so next chapter starts from 0.
        if (PLAYER.book && PLAYER.book.progress) {
            PLAYER.book.progress.chapter_idx  = nextIdx;
            PLAYER.book.progress.position_sec = 0;
        }
        _loadChapter(nextIdx, true);
        _saveProgress(false);
    } else {
        // Last chapter completed.
        _saveProgress(true);
        if (PLAYER.book && PLAYER.book.progress) {
            PLAYER.book.progress.completed = 1;
        }
        document.getElementById('playPauseBtn').textContent = '▶';
        showToast('Book complete! 🎉', 'success');
    }
}

/**
 * Updates play/pause button icon when audio starts playing.
 * @returns {void}
 */
function _onPlaying() {
    clearTimeout(_stallTimeout);
    document.getElementById('playPauseBtn').textContent = '⏸';
    document.getElementById('playerPanel').classList.remove('player-buffering');
    
    const Cap = window.Capacitor;
    const msPlugin = Cap && Cap.Plugins && Cap.Plugins.MediaSession ? Cap.Plugins.MediaSession : null;
    if (msPlugin) {
        msPlugin.setPlaybackState({ playbackState: 'playing' }).catch(() => {});
        _updateMediaSessionMetadata();
    } else if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
        _updateMediaSessionMetadata(); // Force refresh when audio actually starts
    }
    _requestWakeLock();
}

/**
 * Updates play/pause button icon when audio pauses.
 * @returns {void}
 */
function _onPaused() {
    document.getElementById('playPauseBtn').textContent = '▶';
    if (PLAYER.player_open && PLAYER.loaded_url) {
        PLAYER.paused_at = Date.now();
        _persistPauseState();
    }
    
    const Cap = window.Capacitor;
    const msPlugin = Cap && Cap.Plugins && Cap.Plugins.MediaSession ? Cap.Plugins.MediaSession : null;
    if (msPlugin) {
        msPlugin.setPlaybackState({ playbackState: 'paused' }).catch(() => {});
    } else if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
    }
    _releaseWakeLock();
}

/**
 * Stores pause metadata so smart rewind can survive app backgrounding/reload.
 * @returns {void}
 */
function _persistPauseState() {
    if (!PLAYER.slug || !PLAYER.loaded_url) return;
    localStorage.setItem('ab_paused_at', String(PLAYER.paused_at || Date.now()));
    localStorage.setItem('ab_pause_slug', PLAYER.slug);
    localStorage.setItem('ab_pause_chapter', String(PLAYER.chapter_idx));
}

/**
 * Clears locally persisted smart rewind metadata.
 * @returns {void}
 */
function _clearPauseState() {
    localStorage.removeItem('ab_paused_at');
    localStorage.removeItem('ab_pause_slug');
    localStorage.removeItem('ab_pause_chapter');
}

/**
 * Rewinds slightly when resuming after a long pause.
 * @returns {void}
 */
function _applySmartRewindIfNeeded() {
    const audio = PLAYER.audio;
    if (!audio || !PLAYER.loaded_url) return;

    const pausedAt = parseInt(localStorage.getItem('ab_paused_at') || PLAYER.paused_at || '0', 10);
    const pauseSlug = localStorage.getItem('ab_pause_slug');
    const pauseChapter = parseInt(localStorage.getItem('ab_pause_chapter') || '-1', 10);

    _clearPauseState();
    PLAYER.paused_at = null;

    if (!pausedAt) return;
    if (pauseSlug && pauseSlug !== PLAYER.slug) return;
    if (pauseChapter >= 0 && pauseChapter !== PLAYER.chapter_idx) return;

    const pausedMs = Date.now() - pausedAt;
    if (pausedMs < 5 * 60 * 1000) return;
    audio.currentTime = Math.max(0, audio.currentTime - 10);
}

/**
 * Handles audio loading errors with context-appropriate messages.
 * MediaError codes: 1=ABORTED, 2=NETWORK, 3=DECODE, 4=SRC_NOT_SUPPORTED
 * @returns {void}
 */
function _onAudioError() {
    const audio = PLAYER.audio;
    const code = audio && audio.error ? audio.error.code : 0;
    document.getElementById('playerPanel').classList.remove('player-buffering');
    if (code === 1) return; // User-initiated abort (e.g. src change).
    if (code === 2) {
        // Network error: suppress toast when offline or when audio is still buffered
        // (the browser may fire this while buffered content continues playing).
        if (STATE.offline_mode || !audio.paused) return;
        showToast('Network error — check your connection.', 'error');
        return;
    }
    showToast('Audio failed to load. Check file format.', 'error');
}

/**
 * No-op canplay handler — actual seek+play logic is registered per-chapter as a one-shot listener.
 * @returns {void}
 */
function _onCanPlay() {}

// ─── Seek bar ─────────────────────────────────────────────────────────────────

/**
 * Updates time displays while the user scrubs the seek bar (without seeking audio).
 * @returns {void}
 */
function _onSeekInput() {
    const audio = PLAYER.audio;
    if (!audio || !isFinite(audio.duration) || audio.duration <= 0) return;
    const pct  = parseFloat(document.getElementById('seekBar').value);
    const book = PLAYER.book;
    const cue  = _isCueMode(book);

    if (cue) {
        const chapters = Array.isArray(book && book.chapters) ? book.chapters : [];
        const ch = chapters[PLAYER.chapter_idx] || {};
        const chDur = ch.duration || 0;
        const elapsed = (pct / 100) * chDur;
        document.getElementById('playerElapsed').textContent   = _formatTime(elapsed);
        document.getElementById('playerRemaining').textContent = `-${_formatTime(chDur - elapsed)}`;
    } else {
        const time = (pct / 100) * audio.duration;
        document.getElementById('playerElapsed').textContent   = _formatTime(time);
        document.getElementById('playerRemaining').textContent = `-${_formatTime(audio.duration - time)}`;
    }
}

/**
 * Commits a seek operation when the user releases the seek bar.
 * In CUE mode, the bar represents progress within the current chapter,
 * so the absolute file position is chapter.start + (pct/100 * chapter.duration).
 * @returns {void}
 */
function _onSeekCommit() {
    PLAYER.seeking = false;
    const audio    = PLAYER.audio;
    if (!audio || !isFinite(audio.duration) || audio.duration <= 0) return;
    const pct      = parseFloat(document.getElementById('seekBar').value);
    const book     = PLAYER.book;
    const cue      = _isCueMode(book);

    if (cue) {
        const chapters = Array.isArray(book && book.chapters) ? book.chapters : [];
        const ch = chapters[PLAYER.chapter_idx];
        if (!ch) return;
        const chDur = ch.duration || 0;
        audio.currentTime = (ch.start || 0) + (pct / 100) * chDur;
    } else {
        audio.currentTime = (pct / 100) * audio.duration;
    }
}

// ─── Controls ─────────────────────────────────────────────────────────────────

/**
 * Toggles audio playback between playing and paused states.
 * @returns {void}
 */
function togglePlay() {
    const audio = PLAYER.audio;
    if (!audio) return;
    if (audio.paused) {
        _updateMediaSessionMetadata(); // Set metadata before playing for OS promotion
        _applySmartRewindIfNeeded();
        audio.play().catch(err => showToast('Playback failed: ' + err.message, 'error'));
    } else {
        audio.pause();
        _saveProgress(false);
    }
}

/**
 * Rewinds playback by 30 seconds, clamped to 0.
 * @returns {void}
 */
function rewind30() {
    const audio = PLAYER.audio;
    if (!audio) return;
    audio.currentTime = Math.max(0, audio.currentTime - 30);
}

/**
 * Advances playback by 30 seconds, clamped to track duration.
 * @returns {void}
 */
function forward30() {
    const audio = PLAYER.audio;
    if (!audio) return;
    audio.currentTime = Math.min(audio.duration || audio.currentTime, audio.currentTime + 30);
}

/**
 * Advances to the previous chapter if one exists.
 * @returns {void}
 */
function prevChapter() {
    if (PLAYER.chapter_idx <= 0) return;
    PLAYER.chapter_idx -= 1;
    _loadChapter(PLAYER.chapter_idx, !PLAYER.audio.paused);
    _saveProgress(false);
}

/**
 * Advances to the next chapter if one exists.
 * @returns {void}
 */
function nextChapter() {
    const chapters = Array.isArray(PLAYER.book && PLAYER.book.chapters) ? PLAYER.book.chapters : [];
    if (PLAYER.chapter_idx >= chapters.length - 1) return;
    PLAYER.chapter_idx += 1;
    _loadChapter(PLAYER.chapter_idx, !PLAYER.audio.paused);
    _saveProgress(false);
}

/**
 * Jumps directly to a specific chapter index from the chapter drawer.
 * @param {number} idx - Zero-based chapter index.
 * @returns {void}
 */
function jumpToChapter(idx) {
    if (idx === PLAYER.chapter_idx) return;
    PLAYER.chapter_idx = idx;
    _loadChapter(idx, !PLAYER.audio.paused);
    _saveProgress(false);
    document.getElementById('chapterDrawer').classList.remove('show');
}

/**
 * Sets the playback speed and persists the choice to localStorage.
 * @param {number} rate - Playback rate (0.75 | 1 | 1.25 | 1.5 | 2).
 * @returns {void}
 */
function setSpeed(rate) {
    const r = parseFloat(rate);
    if (!isFinite(r) || r <= 0) return;
    PLAYER.speed = r;
    if (PLAYER.audio) PLAYER.audio.playbackRate = r;
    localStorage.setItem('ab_speed', String(r));
    _applySpeedPillUI(r);
}

/**
 * Applies the active style to the matching speed pill button.
 * @param {number} rate - Active playback rate.
 * @returns {void}
 */
function _applySpeedPillUI(rate) {
    document.querySelectorAll('.speed-pill').forEach(btn => {
        const r = parseFloat(btn.dataset.rate);
        btn.classList.toggle('active', Math.abs(r - rate) < 0.01);
    });
}

/**
 * Toggles the chapter list drawer in the player.
 * @returns {void}
 */
function toggleChapterDrawer() {
    document.getElementById('chapterDrawer').classList.toggle('show');
}

// ─── Sleep timer ──────────────────────────────────────────────────────────────

/**
 * Opens the sleep timer menu.
 * @returns {void}
 */
function openSleepMenu() {
    document.getElementById('sleepMenu').classList.toggle('hidden');
}

/**
 * Starts a sleep timer.
 * Passing 0 minutes activates "end of chapter" mode.
 * @param {number} minutes - Minutes until pause; 0 = end of chapter.
 * @returns {void}
 */
function startSleepTimer(minutes) {
    cancelSleepTimer();
    document.getElementById('sleepMenu').classList.add('hidden');

    if (minutes === 0) {
        PLAYER.sleep_end_of_ch = true;
        _showSleepBadge('ch');
        document.getElementById('cancelSleepBtn').classList.remove('hidden');
        return;
    }

    const ms = minutes * 60 * 1000;
    PLAYER.sleep_remaining = minutes * 60;

    PLAYER.sleep_timer = setTimeout(() => {
        if (PLAYER.audio) PLAYER.audio.pause();
        _saveProgress(false);
        PLAYER.sleep_timer = null;
        cancelSleepTimer();
        showToast('Sleep timer ended. Paused.', 'info');
    }, ms);

    // Countdown tick every second.
    PLAYER.sleep_tick = setInterval(() => {
        PLAYER.sleep_remaining = Math.max(0, PLAYER.sleep_remaining - 1);
        _showSleepBadge(_formatTime(PLAYER.sleep_remaining));
    }, 1000);

    _showSleepBadge(_formatTime(PLAYER.sleep_remaining));
    document.getElementById('cancelSleepBtn').classList.remove('hidden');
}

/**
 * Cancels the active sleep timer and hides all timer UI.
 * @returns {void}
 */
function cancelSleepTimer() {
    if (PLAYER.sleep_timer) {
        clearTimeout(PLAYER.sleep_timer);
        PLAYER.sleep_timer = null;
    }
    if (PLAYER.sleep_tick) {
        clearInterval(PLAYER.sleep_tick);
        PLAYER.sleep_tick = null;
    }
    PLAYER.sleep_end_of_ch = false;
    PLAYER.sleep_remaining = 0;
    _hideSleepBadge();
    document.getElementById('cancelSleepBtn').classList.add('hidden');
    document.getElementById('sleepMenu').classList.add('hidden');
}

/**
 * Shows the sleep timer badge with a label.
 * @param {string} label - Text to display in the badge.
 * @returns {void}
 */
function _showSleepBadge(label) {
    const badge = document.getElementById('sleepBadge');
    badge.textContent = label;
    badge.classList.remove('hidden');
}

/**
 * Hides the sleep timer badge.
 * @returns {void}
 */
function _hideSleepBadge() {
    document.getElementById('sleepBadge').classList.add('hidden');
}

// ─── Progress persistence ─────────────────────────────────────────────────────

/**
 * Starts the 5-second autosave interval.
 * Safe to call if already running — clears the old timer first.
 * @returns {void}
 */
function _startSaveTimer() {
    _stopSaveTimer();
    PLAYER.save_timer = setInterval(() => {
        if (PLAYER.audio && !PLAYER.audio.paused) _saveProgress(false);
    }, 5000);
}

/**
 * Stops the autosave interval.
 * @returns {void}
 */
function _stopSaveTimer() {
    if (PLAYER.save_timer) {
        clearInterval(PLAYER.save_timer);
        PLAYER.save_timer = null;
    }
}

/**
 * Sends the current playback position to /api/progress.
 * On network failure, buffers the position to localStorage so it can be
 * flushed on the next successful save or loadState() call.
 * @param {boolean} completed - Whether to mark the book as finished.
 * @returns {void}
 */
function _saveProgress(completed) {
    if (!PLAYER.slug || !PLAYER.audio) return;
    const pos = isFinite(PLAYER.audio.currentTime) ? PLAYER.audio.currentTime : 0;
    const payload = {
        book_slug:   PLAYER.slug,
        chapter_idx: PLAYER.chapter_idx,
        position_sec: pos,
        completed:   completed ? 1 : 0,
        client_updated_ms: Date.now(),
    };
    _postProgressQuietly(payload)
        .then(res => {
            if (res && res.success && res.applied) {
                const current = localStorage.getItem('ab_pending_progress');
                if (_pendingProgressIsNotNewerThan(current, payload)) {
                    localStorage.removeItem('ab_pending_progress');
                }
            } else {
                localStorage.setItem('ab_pending_progress', JSON.stringify(payload));
            }
        })
        .catch(() => {
            // Buffer to localStorage so progress survives app kill while offline.
            localStorage.setItem('ab_pending_progress', JSON.stringify(payload));
        });
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * Formats seconds into M:SS or H:MM:SS.
 * @param {number} sec - Total seconds (may be fractional).
 * @returns {string} Formatted time string.
 */
function _formatTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
    return `${m}:${String(r).padStart(2, '0')}`;
}

/**
 * Formats total seconds into a human-readable duration string (e.g. "6 hr 22 min").
 * @param {number} sec - Total seconds.
 * @returns {string} Human-readable duration.
 */
function _formatDuration(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0 && m > 0) return `${h} hr ${m} min`;
    if (h > 0)           return `${h} hr`;
    if (m > 0)           return `${m} min`;
    return `${s} sec`;
}

/**
 * Sums the duration of all chapters in a book.
 * @param {Object} book - Book record.
 * @returns {number} Total seconds.
 */
function _totalBookDuration(book) {
    const chapters = Array.isArray(book && book.chapters) ? book.chapters : [];
    return chapters.reduce((acc, ch) => acc + (ch.duration || 0), 0);
}
