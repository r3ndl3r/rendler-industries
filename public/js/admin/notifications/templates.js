// /public/js/admin/notifications/templates.js

/**
 * Notification Templates Management (SPA)
 *
 * Purpose: Provides an administrative interface for editing templated notifications.
 * Features:
 *  - Real-time live preview (Discord style).
 *  - Automated manifest synchronization.
 *  - Tag-based substitution engine.
 *
 * Logic Flow:
 * 1. loadState() fetches all templates (active + deprecated).
 * 2. renderTemplates() populates the two ledger tables.
 * 3. openEditor() prepares the modal with live preview data.
 * 4. updatePreview() renders [tags] into samples on every keystroke.
 * 5. saveTemplate() POSTs changes and triggers a re-fetch.
 */

let state = {
    templates: [],
    base_url: null
};

/**
 * Escapes a string for safe insertion into an HTML context.
 * @param {string} str - The raw string to escape.
 * @returns {string} The HTML-safe string.
 */
function escHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', () => {
    loadState();
    setupEventListeners();
    setupGlobalModalClosing(['modal-overlay'], [closeEditorModal]);
});

/**
 * Binds input and click listeners for the editor UI.
 * @returns {void}
 */
function setupEventListeners() {
    const bodyInput = document.getElementById('edit-body');
    const subjInput = document.getElementById('edit-subject');

    if (bodyInput) bodyInput.addEventListener('input', updatePreview);
    if (subjInput) subjInput.addEventListener('input', updatePreview);

    const saveBtn = document.getElementById('saveTemplateBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveTemplate);

    const previewTime = document.getElementById('preview-time');
    if (previewTime) {
        previewTime.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
}

/**
 * Displays the editor modal and locks background scrolling.
 * @returns {void}
 */
function openEditorModal() {
    document.getElementById('editorModal').classList.add('show');
    document.body.classList.add('modal-open');
}

/**
 * Hides the editor modal and restores background scrolling.
 * @returns {void}
 */
function closeEditorModal() {
    document.getElementById('editorModal').classList.remove('show');
    document.body.classList.remove('modal-open');
}

/**
 * Toggles the visibility of the deprecated templates ledger section.
 * @returns {void}
 */
window.toggleDeprecated = function() {
    const section = document.getElementById('deprecated-section');
    const icon    = document.getElementById('deprecated-toggle-icon');
    const isOpen  = section.classList.toggle('open');
    icon.textContent = isOpen ? '▼' : '▶';
};

/**
 * Fetches the current notification template state from the API.
 * @returns {Promise<void>}
 */
async function loadState() {
    try {
        const response = await fetch('/admin/notifications/templates/api/state');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        if (data && data.success && Array.isArray(data.templates)) {
            state.templates = data.templates;
            state.base_url  = data.base_url;

            // Pre-compile regexes for each template's tags to optimize the live preview loop
            state.templates.forEach(t => {
                t._tagRegexes = {};
                if (t.available_tags) {
                    t.available_tags.split(/,\s*/).forEach(tag => {
                        const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        t._tagRegexes[tag] = new RegExp(`\\[${escaped}\\]`, 'g');
                    });
                }
            });

            renderTemplates();
        } else {
            console.error('Failed to load templates:', data ? data.error : 'Unknown error');
        }
    } catch (err) {
        console.error('State Fetch Error:', err);
    }
}

/**
 * Extracts the namespace (prefix) from a template key.
 * @param {string} key - The template key (e.g., 'chore_complete').
 * @returns {string} The resolved namespace.
 */
function getNamespace(key) {
    const parts = key.split('_');
    // If the key is 'reminder_alert', we want 'reminder' as namespace.
    // If it's just 'general', it stays 'general'.
    return parts.length > 1 ? parts[0] : 'general';
}

/**
 * Orchestrates the rendering of active and deprecated template tables.
 * @returns {void}
 */
function renderTemplates() {
    const activeBody     = document.getElementById('active-templates-body');
    const deprecatedBody = document.getElementById('deprecated-templates-body');
    if (!activeBody) return;

    const active     = state.templates.filter(t => !t.is_deprecated);
    const deprecated = state.templates.filter(t =>  t.is_deprecated);

    activeBody.innerHTML     = generateTableRowsHtml(active, true);
    deprecatedBody.innerHTML = generateTableRowsHtml(deprecated, false);
}

/**
 * Generates HTML rows for a set of templates, sorted by key and grouped by namespace.
 * @param {Array} templates - The list of template objects.
 * @param {Boolean} isActive - Whether the templates are in the active section.
 * @returns {string} HTML content.
 */
function generateTableRowsHtml(templates, isActive) {
    const colCount = isActive ? 4 : 3;
    if (templates.length === 0) {
        return `<tr><td colspan="${colCount}" class="empty-row">No templates found.</td></tr>`;
    }

    // 1. Sort alphabetically by key
    templates.sort((a, b) => a.template_key.localeCompare(b.template_key));

    let html = '';
    let lastNamespace = null;

    templates.forEach(t => {
        const ns = getNamespace(t.template_key);

        // 2. Insert separator on namespace change
        if (ns !== lastNamespace) {
            lastNamespace = ns;
            html += `
                <tr class="namespace-separator">
                    <td colspan="${colCount}">${escHtml(ns)}</td>
                </tr>`;
        }

        // 3. Render template row
        if (isActive) {
            html += `
                <tr>
                    <td data-label="Key"><code class="template-key-code">${escHtml(t.template_key)}</code></td>
                    <td data-label="Description" class="text-muted-sm">${escHtml(t.description)}</td>
                    <td data-label="Tags">${renderTagBadges(t.available_tags)}</td>
                    <td class="col-actions">
                        <button class="btn-icon-edit" title="Edit Template" onclick="openEditor(${t.id})">
                            📝
                        </button>
                    </td>
                </tr>`;
        } else {
            html += `
                <tr class="row-deprecated">
                    <td data-label="Key"><code>${escHtml(t.template_key)}</code></td>
                    <td data-label="Description" class="text-muted-sm">${escHtml(t.description)}</td>
                    <td class="col-actions">
                        <button class="btn-icon-edit" title="Edit Template" onclick="openEditor(${t.id})">
                            📝
                        </button>
                    </td>
                </tr>`;
        }
    });

    return html;
}

/**
 * Renders a list of tags as badges.
 * @param {string} tags - Comma-separated list of tags.
 * @returns {string} HTML content.
 */
function renderTagBadges(tags) {
    if (!tags) return '';
    return tags.split(/,\s*/).map(tag =>
        `<span class="tag-badge">${escHtml(tag)}</span>`
    ).join('');
}

/**
 * Prepares and opens the editor modal for a specific template.
 * @param {number|string} id - The ID of the template to edit.
 * @returns {void}
 */
window.openEditor = function(id) {
    const tmpl = state.templates.find(t => t.id == id);
    if (!tmpl) return;

    document.getElementById('edit-id').value              = tmpl.id;
    document.getElementById('edit-key-display').textContent  = tmpl.template_key;
    document.getElementById('edit-desc-display').textContent = tmpl.description || '';
    document.getElementById('edit-subject').value         = tmpl.subject_template || '';
    document.getElementById('edit-body').value            = tmpl.body_template || '';

    // Tag chips — [sys_url] is always available
    const tags = ['sys_url'];
    if (tmpl.available_tags) tags.push(...tmpl.available_tags.split(/,\s*/));

    const chipsContainer = document.getElementById('tag-chips-container');
    chipsContainer.innerHTML = '';
    tags.forEach(tag => {
        const chip = document.createElement('button');
        chip.type      = 'button';
        chip.className = 'tag-chip';
        chip.textContent = `[${tag}]`;
        chip.onclick = () => insertTag(`[${tag}]`);
        chipsContainer.appendChild(chip);
    });

    updatePreview();
    openEditorModal();
};

/**
 * Inserts a tag at the cursor position of the currently focused or default field.
 * @param {string} tag - The tag string to insert (e.g., '[user]').
 * @returns {void}
 */
function insertTag(tag) {
    const subjInput = document.getElementById('edit-subject');
    const bodyInput = document.getElementById('edit-body');
    const target    = (document.activeElement === subjInput) ? subjInput : bodyInput;

    const start  = target.selectionStart;
    const end    = target.selectionEnd;
    target.value = target.value.substring(0, start) + tag + target.value.substring(end);
    target.focus();
    target.selectionStart = target.selectionEnd = start + tag.length;

    updatePreview();
}

/**
 * Performs real-time substitution for the Discord preview pane.
 * @returns {void}
 */
function updatePreview() {
    const id   = document.getElementById('edit-id').value;
    const tmpl = state.templates.find(t => t.id == id);
    if (!tmpl) return;

    let body = document.getElementById('edit-body').value;

    let sample = {};
    try {
        sample = typeof tmpl.sample_data === 'string'
            ? JSON.parse(tmpl.sample_data)
            : (tmpl.sample_data || {});
    } catch (e) {
        console.warn('Failed to parse sample data for preview', e);
    }
    // Substitution loop
    const baseUrl = state.base_url || '';
    body = body.replace(/\[sys_url\s+([^\]]+)\]/g, (m, p1) => `<span class="preview-tag-value">${baseUrl}${escHtml(p1)}</span>`);
    body = body.replace(/\[sys_url\]/g, `<span class="preview-tag-value">${baseUrl}</span>`);

    // Use pre-compiled regexes for sample data values
    if (tmpl._tagRegexes) {
        Object.keys(tmpl._tagRegexes).forEach(tag => {
            const val = sample[tag] ?? '';
            body = body.replace(tmpl._tagRegexes[tag], `<span class="preview-tag-value">${escHtml(val)}</span>`);
        });
    }

    body = body.replace(/\*\*(.*?)\*\*/gs, (m, inner) => `<strong>${inner}</strong>`);
    body = body.replace(/\n/g, '<br>');

    document.getElementById('preview-body').innerHTML =
        body || '<em class="text-muted-sm">No content...</em>';
}

/**
 * Submits the updated template to the API and reloads the state.
 * @returns {Promise<void>}
 */
async function saveTemplate() {
    const btn         = document.getElementById('saveTemplateBtn');
    const originalHtml = btn.innerHTML;

    const payload = {
        id:               document.getElementById('edit-id').value,
        subject_template: document.getElementById('edit-subject').value,
        body_template:    document.getElementById('edit-body').value
    };

    btn.disabled  = true;
    btn.innerHTML = '⏳ Saving...';

    try {
        const result = await window.apiPost('/admin/notifications/templates/api/update', payload);

        if (result && result.success) {
            closeEditorModal();
            loadState();
        } else {
            showToast(result ? (result.error || 'Save failed') : 'Save failed', 'error');
        }
    } catch (err) {
        console.error('Save Error:', err);
        showToast('A network error occurred while saving.', 'error');
    } finally {
        btn.disabled  = false;
        btn.innerHTML = originalHtml;
    }
}
