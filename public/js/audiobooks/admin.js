// /public/js/audiobooks/admin.js

/**
 * Name: Audiobooks Admin
 * Purpose: Administrative panel for the audiobooks library.
 * Features:
 *   - Tabular overview of all books with cover, metadata, and status flags.
 *   - Inline metadata editing via modal (title, author, narrator, description, series).
 *   - Per-book and full-library metadata cache invalidation (re-scan).
 *   - Cover art replacement via file upload.
 *   - Summary stats bar showing total books, cover coverage, and metadata cache status.
 * Dependencies: default.js (apiPost, escapeHtml, showToast, showConfirmModal, setupGlobalModalClosing)
 */

'use strict';

const STATE = {
    books: [],
};

/**
 * Fetches admin library state from the server and triggers a full re-render.
 * @param {boolean} [force=false] - When true, loads even if a modal is open.
 * @returns {Promise<void>}
 */
async function loadState(force = false) {
    if (!force && document.querySelector('.modal-overlay.show')) return;

    try {
        const res = await fetch('/audiobooks/admin/api/state', { credentials: 'same-origin' });
        const data = await res.json();
        if (!data.success) {
            showToast(data.error || 'Failed to load library', 'error');
            return;
        }
        STATE.books = data.books || [];
        renderUI();
    } catch (_err) {
        showToast('Network error loading library', 'error');
    }
}

/**
 * Renders the stats bar and the books table.
 * @returns {void}
 */
function renderUI() {
    renderStats();
    renderTable();
}

/**
 * Populates the summary stats bar with counts derived from STATE.books.
 * @returns {void}
 */
function renderStats() {
    const total     = STATE.books.length;
    const withCover = STATE.books.filter(b => b.has_cover_file).length;
    const withMeta  = STATE.books.filter(b => b.meta_cached).length;

    document.getElementById('statTotal').textContent     = `📚 ${total} book${total !== 1 ? 's' : ''}`;
    document.getElementById('statWithCover').textContent = `🖼 ${withCover} / ${total} covers`;
    document.getElementById('statWithMeta').textContent  = `📋 ${withMeta} / ${total} metadata cached`;

    document.getElementById('statsBar').classList.remove('hidden');
    document.getElementById('statsBar').classList.add('show');
}

/**
 * Builds and injects the books data table, replacing any loading skeleton.
 * @returns {void}
 */
function renderTable() {
    const wrap = document.getElementById('adminTableWrap');

    if (!STATE.books.length) {
        wrap.innerHTML = '<p class="library-empty">No books found in the library.</p>';
        return;
    }

    const rows = STATE.books.map(book => {
        const title  = escapeHtml(book.title  || book.slug);
        const author = escapeHtml(book.author || '—');
        const series = book.series
            ? escapeHtml(book.series) + (book.series_index ? ' #' + book.series_index : '')
            : '—';

        const metaBadge  = book.meta_cached    ? '<span class="ab-badge ab-badge-ok">✓ Meta</span>'   : '<span class="ab-badge ab-badge-warn">✗ Meta</span>';
        const coverBadge = book.has_cover_file ? '<span class="ab-badge ab-badge-ok">✓ Cover</span>' : '<span class="ab-badge ab-badge-warn">✗ Cover</span>';

        const thumb = book.cover_url
            ? `<img src="${escapeHtml(book.cover_url)}" alt="" class="ab-thumb" loading="lazy"
                   onerror="this.classList.add('hidden');this.nextElementSibling.classList.remove('hidden');">
               <div class="ab-thumb-fallback hidden">🎧</div>`
            : `<div class="ab-thumb-fallback">🎧</div>`;

        // JSON.stringify produces a double-quoted JS string literal; escapeHtml then
        // encodes the surrounding double quotes so they survive the HTML attribute boundary.
        const slugJs = escapeHtml(JSON.stringify(book.slug));

        return `<tr>
            <td class="col-ab-cover">${thumb}</td>
            <td class="col-ab-book" data-label="Book">
                <span class="ab-book-title">${title}</span>
                <span class="ab-book-author">${author}</span>
            </td>
            <td class="col-ab-series" data-label="Series">${series}</td>
            <td class="col-ab-status" data-label="Status">${metaBadge}${coverBadge}</td>
            <td class="col-ab-family" data-label="Family">${_renderUserProgress(book.user_progress, book.total_chapters)}</td>
            <td class="col-ab-actions">
                <button type="button" class="btn-icon-edit"   title="Edit metadata"    onclick="openEditModal(${slugJs})">✏️</button>
                <button type="button" class="btn-icon-rescan" title="Re-scan metadata" onclick="rescanBook(${slugJs})">🔄</button>
                <button type="button" class="btn-icon-cover"  title="Upload cover"     onclick="triggerCoverUpload(${slugJs})">🖼</button>
            </td>
        </tr>`;
    }).join('');

    wrap.innerHTML = `<table class="data-table">
        <thead>
            <tr>
                <th class="col-ab-cover"></th>
                <th class="col-ab-book">Book</th>
                <th class="col-ab-series">Series</th>
                <th class="col-ab-status">Status</th>
                <th class="col-ab-family">Family</th>
                <th class="col-ab-actions">Actions</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>`;
}

/**
 * Opens the edit modal and populates its fields from the matching STATE.books entry.
 * @param {string} slug - The book's directory slug.
 * @returns {void}
 */
function openEditModal(slug) {
    const book = STATE.books.find(b => b.slug === slug);
    if (!book) return;

    document.getElementById('editSlug').value         = book.slug;
    document.getElementById('editTitle').value        = book.title        || '';
    document.getElementById('editAuthor').value       = book.author       || '';
    document.getElementById('editNarrator').value     = book.narrator     || '';
    document.getElementById('editDescription').value  = book.description  || '';
    document.getElementById('editSeries').value       = book.series       || '';
    document.getElementById('editSeriesIndex').value  = book.series_index || '';

    document.getElementById('editModal').classList.add('show');
    document.body.classList.add('modal-open');
    document.getElementById('editTitle').focus();
}

/**
 * Hides the edit modal and restores body scroll.
 * @returns {void}
 */
function closeEditModal() {
    document.getElementById('editModal').classList.remove('show');
    document.body.classList.remove('modal-open');
}

/**
 * Reads the edit form and POSTs metadata to /audiobooks/api/meta/:slug.
 * On success, closes the modal and reloads the table.
 * @returns {Promise<void>}
 */
async function saveEdit() {
    const slug = document.getElementById('editSlug').value;
    if (!slug) return;

    const btn = document.getElementById('saveEditBtn');
    btn.disabled    = true;
    btn.textContent = '⌛ Saving…';

    try {
        const fd = new FormData();
        fd.set('title',        document.getElementById('editTitle').value.trim());
        fd.set('author',       document.getElementById('editAuthor').value.trim());
        fd.set('narrator',     document.getElementById('editNarrator').value.trim());
        fd.set('description',  document.getElementById('editDescription').value.trim());
        fd.set('series',       document.getElementById('editSeries').value.trim());
        fd.set('series_index', parseInt(document.getElementById('editSeriesIndex').value || '0', 10) || 0);

        const res = await apiPost(`/audiobooks/api/meta/${encodeURIComponent(slug)}`, fd);
        if (res) {
            closeEditModal();
            showToast('Metadata saved', 'success');
            loadState(true);
        }
    } finally {
        btn.disabled    = false;
        btn.textContent = '💾 Save';
    }
}

/**
 * Confirms then invalidates the metadata cache for a single book.
 * The next loadState call will re-run ffprobe and rebuild meta.json.
 * @param {string} slug - The book's directory slug.
 * @returns {void}
 */
function rescanBook(slug) {
    const book = STATE.books.find(b => b.slug === slug);
    const name = book ? (book.title || slug) : slug;

    showConfirmModal({
        title:       'Re-scan Book',
        icon:        '🔄',
        hideCancel:  true,
        message:     `Delete cached metadata for <strong>${escapeHtml(name)}</strong>? It will be re-discovered on next load.`,
        confirmText: 'Re-scan',
        onConfirm:   async () => {
            const fd = new FormData();
            fd.set('slug', slug);
            const res = await apiPost('/audiobooks/admin/api/rescan', fd);
            if (res) {
                showToast('Metadata cleared — reloading…', 'info');
                loadState(true);
            }
        },
    });
}

/**
 * Confirms then invalidates the metadata cache for every book in the library.
 * @returns {void}
 */
function rescanAll() {
    const count = STATE.books.length;

    showConfirmModal({
        title:       'Re-scan All Books',
        icon:        '🔄',
        hideCancel:  true,
        message:     `Delete cached metadata for all ${count} book${count !== 1 ? 's' : ''}? Each book will be re-scanned on next load via ffprobe.`,
        confirmText: 'Re-scan All',
        onConfirm:   async () => {
            const btn = document.getElementById('rescanAllBtn');
            btn.disabled    = true;
            btn.textContent = '⌛ Scanning…';

            try {
                const res = await apiPost('/audiobooks/admin/api/rescan', new FormData());
                if (res) {
                    showToast(`Cleared metadata for ${res.rescanned} book${res.rescanned !== 1 ? 's' : ''} — reloading…`, 'info');
                    loadState(true);
                }
            } finally {
                btn.disabled    = false;
                btn.textContent = '🔄 Re-scan All';
            }
        },
    });
}

/**
 * Stores the target slug on the shared file input and opens the OS file picker.
 * @param {string} slug - The book's directory slug.
 * @returns {void}
 */
function triggerCoverUpload(slug) {
    const input      = document.getElementById('coverFileInput');
    input.dataset.slug = slug;
    input.value        = '';
    input.click();
}

/**
 * Uploads the selected image file as the cover for the book whose slug is
 * stored on the file input's data-slug attribute.
 * @param {Event} event - The file input change event.
 * @returns {Promise<void>}
 */
async function handleCoverFile(event) {
    const input = event.target;
    const slug  = input.dataset.slug;
    const file  = input.files[0];
    if (!slug || !file) return;

    const fd = new FormData();
    fd.append('cover', file);

    // apiPost sends FormData as multipart; global fetch hook injects CSRF token.
    const res = await apiPost(`/audiobooks/admin/api/cover/${encodeURIComponent(slug)}`, fd);
    if (res) {
        showToast('Cover updated', 'success');
        loadState(true);
    }
}

/**
 * Renders per-user progress chips for a single book row.
 * @param {Array}  userProgress  - Array of { username, chapter_idx, position_sec, completed } from STATE.
 * @param {number} totalChapters - Total chapter count for this book.
 * @returns {string} - HTML string of chips, or '—' when no family member has started the book.
 */
function _renderUserProgress(userProgress, totalChapters) {
    if (!userProgress || !userProgress.length) return '—';
    const total = totalChapters > 0 ? totalChapters : '?';
    return userProgress.map(u => {
        const name = escapeHtml(u.username || '?');
        const icon = getUserIcon(u.username || '');
        if (u.completed) {
            return `<span class="ab-user-prog ab-user-prog-done" title="${name}: Finished">${icon} ${name}</span>`;
        }
        const ch = (u.chapter_idx || 0) + 1;
        return `<span class="ab-user-prog" title="${name}: Chapter ${ch} of ${total}">${icon} ${name} · Ch.${ch}/${total}</span>`;
    }).join('');
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    setupGlobalModalClosing();
    document.getElementById('coverFileInput').addEventListener('change', handleCoverFile);
    loadState();
});
