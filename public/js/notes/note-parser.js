// /public/js/notes/note-parser.js

/**
 * High-Fidelity Note Parser (Secure Tokenizer)
 * 
 * This module replaces regex-based substitutions with a single-pass tokenized 
 * parser. It enforces strict protocol whitelists, depth-balanced tag detection,
 * and positional parameter validation to prevent XSS and tag-breakout bypasses.
 */
const NoteParser = (() => {
    const EMOJI_PREFIX_RE = /^([\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u26FF]|[\u2700-\u27BF]|\u231A|\u231B|\u23E9-\u23EC|\u23F0|\u23F3|\u25FD|\u25FE|\u2614|\u2615|\u2648-\u2653|\u267F|\u2693|\u26A1|\u26AA|\u26AB|\u26BD|\u26BE|\u26C4|\u26C5|\u26D4|\u26E9|\u26EA|\u2702|\u2705|\u2708-\u270C|\u270F|\u2712|\u2714|\u2716|\u2728|\u2733|\u2734|\u2744|\u2747|\u274C|\u274E|\u2753-\u2755|\u2757|\u2763|\u2764|\u2795-\u2797|\u27A1|\u27B0|\u27BF|\u2934|\u2935|\u2B05-\u2B07|\u2B1B|\u2B1C|\u2B50|\u2B55|\u3030|\u303D|\u3297|\u3299])\s*(.*)/;

    const CONFIG = {
        protocols: ['http:', 'https:', 'mailto:', 'tel:'],
        colors:    ['yellow', 'blue', 'pink', 'orange', 'violet', 'indigo', 'slate', 'green', 'red', 'accent', 'info', 'success', 'danger', 'warning'],
        hexRegex:  /^#[0-9a-fA-F]{3,8}$/
    };

    /**
     * Splits ordered parameters using a split-on-first strategy.
     * Prevents URLs with legitimate pipe or colon characters from being truncated.
     */
    const parsePositional = (content) => {
        const firstColon = content.indexOf(':');
        if (firstColon === -1) return { type: content, value: '', params: [] };

        const type  = content.substring(0, firstColon).toLowerCase();
        let residue = content.substring(firstColon + 1);

        const firstPipe = residue.indexOf('|');
        if (firstPipe === -1) return { type, value: residue, params: [] };

        const value  = residue.substring(0, firstPipe);
        const params = residue.substring(firstPipe + 1).split('|');

        return { type, value, params };
    };

    /**
     * Pre-calculates the matching bracket positions for the entire text.
     * Uses a stack-based O(n) approach to enable O(1) lookups during parsing.
     * @param {string} text - The content to index.
     * @returns {Map} - Map of opening bracket index to closing bracket index.
     */
    const buildBracketIndex = (text) => {
        const index = new Map();
        const stack = [];
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '[') {
                stack.push(i);
            } else if (text[i] === ']') {
                if (stack.length > 0) {
                    index.set(stack.pop(), i);
                }
            }
        }
        return index;
    };

    /**
     * Validates a URL against the strict protocol whitelist.
     * Rejects invalid or malicious protocols (e.g., javascript:).
     */
    const getSafeUrl = (url) => {
        try {
            const trimmed = url.trim();
            if (!trimmed) return null;
            
            // Handle protocol-relative or anchor links if needed, but per plan 
            // we strictly enforce absolute http/https for specific components.
            const parsed = new URL(trimmed, window.location.origin);
            if (CONFIG.protocols.includes(parsed.protocol)) {
                return window.escapeHtml(encodeURI(trimmed));
            }
        } catch (e) {
            // URL constructor failed: Not a valid absolute URL.
        }
        return null;
    };

    /**
     * Nested Inline Formatter (1-Level):
     * Processes basic Markdown (Bold/Italic/Strikethrough/Code) within component labels.
     * Does not recurse to prevent depth-based vulnerabilities.
     */
    const renderInline = (text) => {
        const escaped = window.escapeHtml(text);
        return escaped
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/~~(.*?)~~/g, '<del>$1</del>')
            .replace(/`(.*?)`/g, '<code class="note-code-inline" title="Click to copy">$1</code>');
    };

    /**
     * Resolves a [[Title]] wikilink against STATE.note_map.
     * Returns a note-link span if resolved, a dead-link span if not.
     * @param {string} title - Raw title string from [[...]].
     * @returns {string} - HTML span.
     */
    const renderWikilink = (title) => {
        const lower = title.toLowerCase();
        const match = Object.values(STATE.note_map || {}).find(
            n => n.title && n.title.toLowerCase() === lower
        );

        const safeTitle = window.escapeHtml(title);

        if (!match) {
            return `<span class="note-ref note-ref-dead" title="Unresolved link: ${safeTitle}">${safeTitle}</span>`;
        }

        const color = (typeof window.normalizeColorHex === 'function')
            ? window.normalizeColorHex(match.color) : '';
        const style = color ? ` style="color: ${color}"` : '';
        return `<span class="note-ref note-link-trigger" data-target-id="${match.id}" title="Jump to: ${safeTitle}"${style}>${safeTitle}</span>`;
    };

    const CALLOUT_META = {
        note:     { icon: '📝', label: 'Note'     },
        tip:      { icon: '💡', label: 'Tip'      },
        warning:  { icon: '⚠️', label: 'Warning'  },
        danger:   { icon: '🔥', label: 'Danger'   },
        success:  { icon: '✅', label: 'Success'  },
        info:     { icon: 'ℹ️', label: 'Info'     },
        question: { icon: '❓', label: 'Question' },
    };

    /**
     * Stack-balanced closing-tag scanner for wrapping renderers.
     * Finds the matching [/tag] position in rawContent, respecting nested
     * open/close pairs so inner tags do not prematurely end an outer block.
     * @param {string} openPrefix - Opening tag prefix, e.g. '[size:'
     * @param {string} closeTag   - Closing tag string, e.g. '[/size]'
     * @param {string} content    - Text AFTER the opening bracket (rawContent slice)
     * @returns {number} Index of the start of closeTag, or -1 if unmatched.
     */
    const findClosingTag = (openPrefix, closeTag, content) => {
        let nesting = 1;
        let scan    = 0;
        while (scan < content.length) {
            const nextOpen  = content.indexOf(openPrefix, scan);
            const nextClose = content.indexOf(closeTag,   scan);
            if (nextClose === -1) return -1;
            if (nextOpen !== -1 && nextOpen < nextClose) {
                nesting++;
                scan = nextOpen + openPrefix.length;
            } else {
                nesting--;
                if (nesting === 0) return nextClose;
                scan = nextClose + closeTag.length;
            }
        }
        return -1;
    };

    // Forward declaration: wrapping renderers (color, size, bg, spoiler) call parseNote
    // recursively. Declared here so RENDERERS can reference it; assigned below.
    let parseNote;

    const RENDERERS = {
        'iframe': (data) => {
            // Absolute URLs only for iframes to prevent internal path embedding/bypass
            if (!/^https?:\/\//i.test(data.value.trim())) return null;
            
            const url = getSafeUrl(data.value);
            if (!url) return null;
            
            const height = parseInt(data.params[0], 10);
            const style = height ? `style="height: ${height}px;"` : 'class="iframe-fill"';
            return `<div class="note-iframe-wrap" ${style}><iframe src="${url}" width="100%" height="100%" frameborder="0" allowfullscreen></iframe></div>`;
        },
        'link': (data) => {
            const url = getSafeUrl(data.value);
            if (!url) return null;
            
            // Logic: If a label is provided, process it for inline formatting (bold/italic).
            // If missing, use the escaped raw URL to prevent renderInline from mangling it.
            const labelContent = data.params[0] 
                ? renderInline(data.params[0]) 
                : window.escapeHtml(data.value);
                
            return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="note-external-link" data-action="stop-propagation">${labelContent}</a>`;
        },
        'img': (data) => RENDERERS.image(data),
        'image': (data) => {
            let id = parseInt(data.value, 10);
            if (isNaN(id)) {
                const lower = data.value.toLowerCase();
                const match = Object.values(STATE.note_map || {}).find(
                    n => n.title && n.title.toLowerCase() === lower
                );
                if (!match) return null;
                id = match.id;
            }
            const meta = STATE.note_map[id];
            
            let scale = parseFloat(data.params[0] || '1.0');
            let width = (scale <= 1.0 ? scale * 100 : scale);
            
            const attachments = meta ? (meta.attachments || []) : [];
            const blobId      = (meta && meta.blob_id) ? meta.blob_id : (attachments[0] ? attachments[0].blob_id : null);
            const src         = blobId ? `/notes/attachment/serve/${blobId}` : `/notes/serve/${id}`;
            const safeTitle   = meta   ? window.escapeHtml(meta.title || id) : `Image #${id}`;

            const att      = attachments[0] || {};
            const ext      = att.mime_type ? att.mime_type.split('/')[1].toUpperCase() : 'IMG';
            const sizeStr  = att.file_size ? ` • ${window.formatBytes(att.file_size)}` : '';
            const metaInfo = `${ext}${sizeStr} • #${id}`;

            const dataAction = blobId ? 'view-attachment' : 'view-note';
            const dataAttrs = blobId ? `data-action="${dataAction}" data-blob-id="${blobId}" data-note-id="${id}"` : `data-action="${dataAction}" data-note-id="${id}"`;

            return `<div class="note-embedded-wrap" ${dataAttrs} title="View: ${safeTitle}" style="width: ${width}%;"><img src="${src}" class="note-embedded-img" alt="${safeTitle}" loading="lazy"><div class="note-embedded-caption">🖼️ ${safeTitle} (${metaInfo})</div></div>`;
        },
        'note': (data) => {
            let id = parseInt(data.value, 10);
            if (isNaN(id)) {
                const lower = data.value.toLowerCase();
                const match = Object.values(STATE.note_map || {}).find(
                    n => n.title && n.title.toLowerCase() === lower
                );
                if (!match) return null;
                id = match.id;
            }
            const target    = STATE.note_map[id];
            const safeTitle = target ? window.escapeHtml(target.title || target) : `Note #${id}`;
            const color     = (target && typeof window.normalizeColorHex === 'function')
                ? window.normalizeColorHex(target.color) : '';
            const style     = color ? ` style="color: ${color}"` : '';
            return `<span class="note-ref note-link-trigger" data-target-id="${id}" title="Jump to Note: ${safeTitle}"${style}>${safeTitle}</span>`;
        },
        'copy': (pos, noteId, rawContent, depth = 0, startLine = 0) => {
            if (pos.value !== '') {
                let id = parseInt(pos.value, 10);
                if (isNaN(id)) {
                    const lower = pos.value.toLowerCase();
                    const match = Object.values(STATE.note_map || {}).find(
                        n => n.title && n.title.toLowerCase() === lower
                    );
                    if (!match) return null;
                    id = match.id;
                }
                const target    = STATE.note_map[id];
                const safeTitle = target ? window.escapeHtml(target.title || target) : `Note #${id}`;
                const color     = (target && typeof window.normalizeColorHex === 'function')
                    ? window.normalizeColorHex(target.color) : '';
                const style     = color ? ` style="color: ${color}"` : '';
                return `<span class="note-ref note-copy-trigger" data-target-id="${id}" title="Copy to clipboard: ${safeTitle}"${style}>📋 ${safeTitle}</span>`;
            }

            // [copy]...[/copy] — wrapping inline copy block; click copies visible text to clipboard
            const closeTag = '[/copy]';
            const endIdx   = findClosingTag('[copy]', closeTag, rawContent);
            if (endIdx === -1) return null;

            const innerText = rawContent.substring(0, endIdx);
            const innerHtml = parseNote(innerText, noteId, depth + 1, startLine);

            return {
                html: `<span class="note-inline-copy" title="Click to copy">${innerHtml}</span>`,
                consumed: endIdx + closeTag.length
            };
        },
        'file': (data) => {
            let id = parseInt(data.value, 10);
            if (isNaN(id)) {
                const lower = data.value.toLowerCase();
                const match = Object.values(STATE.note_map || {}).find(
                    n => n.title && n.title.toLowerCase() === lower
                );
                if (!match) return null;
                id = match.id;
            }
            const meta        = STATE.note_map[id];
            const attachments = meta ? (meta.attachments || []) : [];
            const blobId      = (meta && meta.blob_id) ? meta.blob_id : (attachments[0] ? attachments[0].blob_id : null);
            const src         = blobId ? `/notes/attachment/serve/${blobId}` : `/notes/serve/${id}`;
            const safeTitle   = meta   ? window.escapeHtml(meta.title || id) : `File #${id}`;
            return `<a href="${src}" class="note-ref" download data-action="stop-propagation"><span class="global-icon">📁</span> ${safeTitle}</a>`;
        },
        'color': (pos, noteId, rawContent, depth = 0, startLine = 0) => {
            const color = pos.value.toLowerCase();
            const isHex = CONFIG.hexRegex.test(color);
            const isNamed = CONFIG.colors.includes(color);

            if (!isHex && !isNamed) return null;

            const hexColor = (typeof window.normalizeColorHex === 'function') 
                ? window.normalizeColorHex(color) 
                : color;

            const openPrefix = '[color:';
            const closeTag = '[/color]';
            const endIdx = findClosingTag(openPrefix, closeTag, rawContent);

            if (endIdx === -1) return null;

            const innerText = rawContent.substring(0, endIdx);
            const innerHtml = parseNote(innerText, noteId, depth + 1, startLine);

            return {
                html: `<span style="color: ${hexColor}">${innerHtml}</span>`,
                consumed: endIdx + closeTag.length
            };
        },
        'colour': (pos, noteId, rawContent, depth = 0, startLine = 0) => {
            const color = pos.value.toLowerCase();
            const isHex   = CONFIG.hexRegex.test(color);
            const isNamed = CONFIG.colors.includes(color);
            if (!isHex && !isNamed) return null;
            const hexColor = (typeof window.normalizeColorHex === 'function')
                ? window.normalizeColorHex(color)
                : color;
            const endIdx = findClosingTag('[colour:', '[/colour]', rawContent);
            if (endIdx === -1) return null;
            const innerHtml = parseNote(rawContent.substring(0, endIdx), noteId, depth + 1, startLine);
            return { html: `<span style="color: ${hexColor}">${innerHtml}</span>`, consumed: endIdx + '[/colour]'.length };
        },
        'size': (pos, noteId, rawContent, depth = 0, startLine = 0) => {
            const size = pos.value.toLowerCase();
            const valid = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'];
            if (!valid.includes(size)) return null;

            const openPrefix = '[size:';
            const closeTag = '[/size]';
            const endIdx = findClosingTag(openPrefix, closeTag, rawContent);
            if (endIdx === -1) return null;

            const innerText = rawContent.substring(0, endIdx);
            const innerHtml = parseNote(innerText, noteId, depth + 1, startLine);

            return {
                html: `<span class="note-text-${size}">${innerHtml}</span>`,
                consumed: endIdx + closeTag.length
            };
        },
        'bg': (pos, noteId, rawContent, depth = 0, startLine = 0) => {
            const color = pos.value.toLowerCase();
            const isHex = CONFIG.hexRegex.test(color);
            const isNamed = CONFIG.colors.includes(color);
            if (!isHex && !isNamed) return null;

            const hexColor = (typeof window.normalizeColorHex === 'function') 
                ? window.normalizeColorHex(color) 
                : color;

            const openPrefix = '[bg:';
            const closeTag = '[/bg]';
            const endIdx = findClosingTag(openPrefix, closeTag, rawContent);
            if (endIdx === -1) return null;

            const innerText = rawContent.substring(0, endIdx);
            const innerHtml = parseNote(innerText, noteId, depth + 1, startLine);

            return {
                html: `<span class="note-bg-highlight" style="background-color: ${hexColor}">${innerHtml}</span>`,
                consumed: endIdx + closeTag.length
            };
        },
        'progress': (data) => {
            const val   = Math.min(100, Math.max(0, parseInt(data.value, 10) || 0));
            const label = data.params[0] ? renderInline(data.params[0]) : '';
            return `<div class="note-progress-container"><div class="note-progress-track"><div class="note-progress-bar" style="width: ${val}%;"></div></div>${label ? `<span class="note-progress-text">${label}</span>` : ''}</div>`;
        },
        'date': (data) => {
            const dateStr = data.value;
            // Parse as local midnight by splitting manually; avoids UTC-shift from ISO date-only strings.
            const parts = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (!parts) return null;
            const target = new Date(parseInt(parts[1], 10), parseInt(parts[2], 10) - 1, parseInt(parts[3], 10));
            if (isNaN(target.getTime())) return null;

            let display = target.toLocaleDateString();
            const now = new Date();
            now.setHours(0, 0, 0, 0);

            const diffDays = Math.round((target - now) / (1000 * 60 * 60 * 24));
            
            if (diffDays === 0) display = "Today";
            else if (diffDays === 1) display = "Tomorrow";
            else if (diffDays === -1) display = "Yesterday";
            else if (diffDays > 0 && diffDays < 7) display = `In ${diffDays} days`;
            else if (diffDays < 0 && diffDays > -7) display = `${Math.abs(diffDays)} days ago`;

            return `<span class="note-date-tag" title="${dateStr}">📅 ${display}</span>`;
        },
        'tag': (data) => {
            const label = renderInline(data.value);
            const VALID_TAG_COLORS = ['info', 'success', 'warning', 'danger',
                'yellow', 'blue', 'pink', 'orange', 'violet', 'indigo',
                'slate', 'green', 'red', 'accent'];
            const colorClass = VALID_TAG_COLORS.includes(data.params[0]) ? data.params[0] : 'info';
            return `<span class="note-badge badge-${colorClass}">${label}</span>`;
        },
        'divider': (data) => {
            const label = data.value ? renderInline(data.value) : '';
            return `<div class="note-divider-wrap"><hr class="note-hr">${label ? `<span class="note-divider-label">${label}</span>` : ''}</div>`;
        },
        'spoiler': (pos, noteId, rawContent, depth = 0, startLine = 0) => {
            const label = pos.value ? renderInline(pos.value) : 'Click to reveal';
            const closeTag = '[/spoiler]';

            // Custom balanced scan: only treat '[spoiler:' and '[spoiler]' (exact forms)
            // as nesting incrementors. '[spoiler' alone over-matches tags like [spoilertest:].
            const endIdx = (() => {
                let nesting = 1;
                let scan    = 0;
                while (scan < rawContent.length) {
                    const nextColon = rawContent.indexOf('[spoiler:', scan);
                    const nextBare  = rawContent.indexOf('[spoiler]', scan);
                    const nextClose = rawContent.indexOf(closeTag, scan);
                    if (nextClose === -1) return -1;
                    const nextOpen = (nextColon === -1) ? nextBare
                                   : (nextBare  === -1) ? nextColon
                                   : Math.min(nextColon, nextBare);
                    if (nextOpen !== -1 && nextOpen < nextClose) {
                        nesting++;
                        scan = nextOpen + 9; // advance past '[spoiler'
                    } else {
                        nesting--;
                        if (nesting === 0) return nextClose;
                        scan = nextClose + closeTag.length;
                    }
                }
                return -1;
            })();

            if (endIdx === -1) return null;

            const innerText = rawContent.substring(0, endIdx);
            const innerHtml = parseNote(innerText, noteId, depth + 1, startLine);

            return {
                html: `<details class="note-spoiler"><summary>${label}</summary><div class="note-spoiler-content">${innerHtml}</div></details>`,
                consumed: endIdx + closeTag.length
            };
        },
        'date': (data) => {
            const val = data.value.trim();
            const d   = new Date(val + 'T00:00:00');
            if (isNaN(d.getTime())) return `<span class="note-date-tag">📅 ${window.escapeHtml(val)}</span>`;

            const formatted = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

            const nowDate    = new Date(); nowDate.setHours(0, 0, 0, 0);
            const targetDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            const diffDays   = Math.round((targetDate - nowDate) / 86400000);

            const relative = diffDays === 0  ? 'today'
                           : diffDays === 1  ? 'tomorrow'
                           : diffDays === -1 ? 'yesterday'
                           : diffDays > 1    ? `in ${diffDays}d`
                           :                   `${Math.abs(diffDays)}d ago`;

            return `<span class="note-date-tag" title="${window.escapeHtml(val)}">📅 ${formatted} <span class="note-date-relative">(${relative})</span></span>`;
        },
        'table': (data, noteId, rawContent, depth = 0, startLine = 0) => {
            const closeTag = '[/table]';
            const endIdx   = findClosingTag('[table:]', closeTag, rawContent);
            if (endIdx === -1) return null;

            // Keep raw indices so each row's absolute line number in the note is traceable.
            // rawContent starts with the character immediately after the closing ] of [table:...],
            // which is always \n, so rawIndex 0 is empty and real rows start at rawIndex 1+.
            const rawTableLines = rawContent.substring(0, endIdx).split('\n');
            const lineObjects   = rawTableLines
                .map((l, rawIndex) => ({ text: l.trim(), rawIndex }))
                .filter(o => o.text.length > 0);

            const sepIdx       = lineObjects.findIndex(o => /^[\-|: ]+$/.test(o.text));
            const headerObjs   = sepIdx !== -1 ? lineObjects.slice(0, sepIdx)  : [];
            const bodyObjs     = sepIdx !== -1 ? lineObjects.slice(sepIdx + 1) : lineObjects;

            // Extract per-column alignment from the separator row
            const alignments = [];
            if (sepIdx !== -1) {
                parseCols(lineObjects[sepIdx].text).forEach(col => {
                    const l = col.startsWith(':'), r = col.endsWith(':');
                    alignments.push(l && r ? 'center' : r ? 'right' : l ? 'left' : null);
                });
            }

            const getAlign = (i) => alignments[i] ? ` style="text-align:${alignments[i]}"` : '';

            // Bracket-aware column splitter: | inside [...] is a tag param, not a cell boundary
            function parseCols(line) {
                const cells = [];
                let d = 0, current = '';
                for (const ch of line) {
                    if      (ch === '[') { d++;  current += ch; }
                    else if (ch === ']') { d--;  current += ch; }
                    else if (ch === '|' && d === 0) { cells.push(current.trim()); current = ''; }
                    else { current += ch; }
                }
                cells.push(current.trim());
                if (cells[0] === '') cells.shift();
                if (cells[cells.length - 1] === '') cells.pop();
                return cells;
            }

            // rowLine: absolute line index in the full note for this table row
            const parseCell = (cell, rowLine) => parseNote(cell, noteId, depth + 1, rowLine);

            let html = '<div class="note-table-wrap"><table class="note-table">';

            if (headerObjs.length) {
                html += '<thead><tr>';
                const rowLine = startLine + headerObjs[0].rawIndex;
                parseCols(headerObjs[0].text).forEach((cell, i) => { html += `<th${getAlign(i)}>${parseCell(cell, rowLine)}</th>`; });
                html += '</tr></thead>';
            }

            html += '<tbody>';
            bodyObjs.forEach(rowObj => {
                const rowLine = startLine + rowObj.rawIndex;
                html += '<tr>';
                parseCols(rowObj.text).forEach((cell, i) => { html += `<td${getAlign(i)}>${parseCell(cell, rowLine)}</td>`; });
                html += '</tr>';
            });
            html += '</tbody></table></div>';

            return { html, consumed: endIdx + closeTag.length };
        },
        'embed': (data, noteId, rawContent, depth = 0) => {
            if (depth > 2) return '<div class="note-embed-block note-embed-too-deep">⚠ Embed depth limit reached</div>';

            let id = parseInt(data.value, 10);
            if (isNaN(id)) {
                const lower = data.value.toLowerCase();
                const match = Object.values(STATE.note_map || {}).find(
                    n => n.title && n.title.toLowerCase() === lower
                );
                if (!match) return `<div class="note-embed-block note-embed-dead">📎 ${window.escapeHtml(data.value)}</div>`;
                id = match.id;
            }

            const meta    = STATE.note_map[id];
            const source  = (STATE.notes || []).find(n => n.id == id)
                || (STATE.embed_cache || {})[id];
            const title   = meta ? window.escapeHtml(meta.title || `Note #${id}`) : `Note #${id}`;

            if (!source) return `<div class="note-embed-block note-embed-dead">📎 ${title} <span class="note-embed-unavailable">(unavailable)</span></div>`;

            const canvasName = meta && meta.canvas_name ? window.escapeHtml(meta.canvas_name) : '';
            const subtitle   = canvasName ? ` · ${canvasName}` : '';
            return `<div class="note-embed-block"><div class="note-embed-title">📎 ${title}${subtitle}</div><div class="note-embed-content">${parseNote(source.content || '', id, depth + 1)}</div></div>`;
        }
    };

    /**
     * High-Performance Dashboard Decorator:
     * Renders a line of text as a high-fidelity Bookmark Tile.
     * Logic: Sequential Resolver (Native -> Proxy -> Emoji) with a [emoji]:1 or :1 Override.
     */
    const renderBookmarkTile = (line, forceEmoji = false) => {
        const segments = line.split('|');
        if (segments.length < 2) return window.escapeHtml(line);

        let labelPart   = segments[0].trim();
        const urlPart   = segments[1].trim();
        const iconPart  = segments.length >= 3 ? segments.slice(2).join('|').trim() : null;

        const url = getSafeUrl(urlPart);
        if (!url) return window.escapeHtml(line);

        // 1. Emoji Extraction Architecture: Isolate the leading symbol from the label
        const emojiMatch = labelPart.match(EMOJI_PREFIX_RE);

        const fallbackEmoji = emojiMatch ? emojiMatch[1] : '🔗';
        let labelText       = emojiMatch ? emojiMatch[2] : labelPart;

        // 2. Control Sequence Sanitization: Remove ':1 ' (colon-one-space) flags from the visual label.
        // Match only ':1' followed by a space or end-of-string to avoid truncating ':100', ':1st', etc.
        if (labelText.startsWith(':1 ') || labelText === ':1') {
            labelText = labelText.substring(2).trim();
        }

        // 3. Custom Icon Resolution: Smart Pathing and Sanitization
        // relative paths (starting with /) are resolved against the target URL's origin.
        let customIconUrl = null;
        if (iconPart) {
            let resolvedIconPath = iconPart;
            if (iconPart.startsWith('/')) {
                try {
                    resolvedIconPath = new URL(urlPart).origin + iconPart;
                } catch(e) {
                    resolvedIconPath = null;
                }
            }
            if (resolvedIconPath) {
                customIconUrl = getSafeUrl(resolvedIconPath);
            }
        }

        // 4. Hostname extraction for mesh/private detection and favicon cascade
        let safeHostname = 'link';
        try { safeHostname = new URL(urlPart).hostname; } catch(e) {}

        const isMesh = safeHostname.endsWith('.ts.net') || safeHostname.endsWith('.local') || safeHostname.endsWith('.home')
            || /^192\.168\./.test(safeHostname)
            || /^10\./.test(safeHostname)
            || /^172\.(1[6-9]|2\d|3[01])\./.test(safeHostname)
            || safeHostname === 'localhost'
            || /^127\./.test(safeHostname);

        // Force Emoji Override: mesh hosts (without icon override) or [emoji]:1 flag
        if (forceEmoji || (isMesh && !customIconUrl)) {
            return `
                <a href="${url}" target="_blank" rel="noopener noreferrer" class="note-bookmark-tile" data-action="stop-propagation">
                    <div class="note-bookmark-icon">
                        <div class="note-bookmark-emoji-fallback">${fallbackEmoji}</div>
                    </div>
                    <div class="note-bookmark-label">${window.escapeHtml(labelText || 'Link')}</div>
                    <div class="note-bookmark-arrow">❯</div>
                </a>
            `;
        }

        // 5. Favicon Cascade: Custom -> Origin favicon.ico -> Google Proxy -> Emoji
        // The cascade is driven entirely by data attributes read inside the onerror handler,
        // keeping all URLs out of the inline JS string to prevent injection.
        const originUrl    = new URL(urlPart).origin;
        const faviconUrl   = window.escapeHtml(`${originUrl}/favicon.ico`);
        const proxyUrl     = window.escapeHtml(`https://www.google.com/s2/favicons?domain=${safeHostname}&sz=64&default_icon=404`);

        // Determine the initial src: custom icon if provided, otherwise origin favicon.ico.
        const initialSrc = customIconUrl ?? faviconUrl;

        // data-favicon-url: the origin favicon.ico (skipped as first attempt when custom icon is used)
        // data-proxy-url:   the Google proxy fallback
        // data-custom-url:  signals that the first attempt is a custom icon, not the origin favicon.ico,
        //                   so the onerror handler knows to try origin favicon.ico next before the proxy.
        const customAttr = customIconUrl ? `data-custom-url="1" data-favicon-url="${faviconUrl}"` : '';

        return `
            <a href="${url}" target="_blank" rel="noopener noreferrer" class="note-bookmark-tile" data-action="stop-propagation">
                <div class="note-bookmark-icon">
                    <img src="${initialSrc}" 
                         class="note-bookmark-favicon" 
                         alt="" 
                         ${customAttr}
                         data-proxy-url="${proxyUrl}"
                         data-action="favicon-cascade">
                    <div class="note-bookmark-emoji-fallback">${fallbackEmoji}</div>
                </div>
                <div class="note-bookmark-label">${window.escapeHtml(labelText || 'Link')}</div>
                <div class="note-bookmark-arrow">❯</div>
            </a>
        `;
    };

    /**
     * Extracts the visible display label from a raw note title.
     * Removes internal category prefixes, pipe delimiters, and leading emojis.
     */
    const getDisplayTitle = (title) => {
        if (!title) return '';
        const pipeIdx = title.indexOf('|');
        const labelPart = pipeIdx !== -1 ? title.substring(0, pipeIdx).trim() : title.trim();
        const emojiMatch = labelPart.match(EMOJI_PREFIX_RE);
        return emojiMatch ? emojiMatch[2] : labelPart;
    };

    /**
     * High-Fidelity Category Header:
     * Transforms a note title (e.g., "Label | IconURL") into a glassmorphism header segment.
     */
    const renderCategoryHeader = (title) => {
        if (!title) return '';
        const pipeIdx = title.indexOf('|');
        
        // Extract components with or without pipe
        const labelPart = pipeIdx !== -1 ? title.substring(0, pipeIdx).trim() : title.trim();
        const iconPart  = pipeIdx !== -1 ? title.substring(pipeIdx + 1).trim() : null;

        // Standard Emoji Extraction (Emoji is the first symbol or defaults to folder)
        const emojiMatch = labelPart.match(EMOJI_PREFIX_RE);
        const fallbackEmoji = emojiMatch ? emojiMatch[1] : '📁';
        const labelText     = emojiMatch ? emojiMatch[2] : labelPart;

        let iconHtml = '';
        // Only accept absolute http/https URLs for category header icons.
        // Relative paths are rejected because there is no target URL to resolve them against
        // (unlike renderBookmarkTile which has urlPart for origin resolution).
        const iconUrl = (iconPart && /^https?:\/\//i.test(iconPart.trim())) ? getSafeUrl(iconPart) : null;

        if (iconUrl) {
            iconHtml = `
                <div class="note-bookmark-icon">
                    <img src="${iconUrl}" 
                         class="note-bookmark-favicon" 
                         alt="" 
                         data-action="favicon-cascade">
                    <div class="note-bookmark-emoji-fallback" style="display:none;">${fallbackEmoji}</div>
                </div>
            `;
        } else {
            // No URL provided, use the extracted or default emoji
            iconHtml = `
                <div class="note-bookmark-icon">
                    <div class="note-bookmark-emoji-fallback">${fallbackEmoji}</div>
                </div>
            `;
        }

        return `
            <div class="note-title-category">
                ${iconHtml}
                <div class="note-category-label">${window.escapeHtml(labelText || labelPart)}</div>
            </div>
        `;
    };

    /**
     * Strict Dashboard Detection:
     * Operates as a fast pre-scan to avoid unnecessary complex tokenization.
     */
    const isDashboardFormat = (text) => {
        if (!text?.trim()) return false;
        
        // Split and filter for content lines, ignoring control sequences
        const lines = text.split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0 && !l.includes('[emoji]:1'));

        if (lines.length === 0) return false;

        return lines.every(line => {
            const segments = line.split('|');
            if (segments.length < 2) return false;
            // Validate the URL segment (second pipe-delimited field) as a strict absolute URL.
            // Trim and test only the URL portion — ignore optional third icon segment.
            const urlSegment = segments[1].trim();
            return /^https?:\/\/[^\s|]+/i.test(urlSegment);
        });
    };

    /**
     * Recursive Tokenizer Engine:
     * Converts raw text into sanitized HTML components with support for nested tags.
     * @param {string} text - The content to parse.
     * @param {number} noteId - Parent note ID for context-sensitive renderers.
     * @param {number} depth - Current recursion depth (Guard against infinite loops).
     * @returns {string} - Rendered HTML.
     */
    parseNote = (text, noteId, depth = 0, lineOffset = 0) => {
        if (!text) return '';

        // 0. Safety Guards: Length and Depth Limits
        // Prevents main-thread blocking on oversized notes or malicious recursion
        if (text.length > 50000) {
            if (typeof showToast === 'function') {
                showToast('Note too large to format', 'warning');
            }
            return window.escapeHtml(text).replace(/\n/g, '<br>');
        }

        // Depth guard: prevents stack overflow from pathological recursive nesting
        if (depth > 12) return window.escapeHtml(text);
        
        // 1. Dashboard Mode (Fast-Path Optimization)
        // If the note content is identified as a pure bookmark list, bypass the 
        // character-by-character scanner and use the specialized tile renderer.
        if (depth === 0 && isDashboardFormat(text)) {
            const forceEmoji = text.includes('[emoji]:1'); 
            
            return text.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0 && !line.includes('[emoji]:1'))
                .map(line => renderBookmarkTile(line, forceEmoji))
                .join('');
        }
        
        const bracketIndex = buildBracketIndex(text);
        let output = '';
        let cursor = 0;
        let isLineStart = true;
        let inCheckboxRow = false;
        let inBulletRow = false;
        let textBuffer = '';

        const flushBuffer = () => {
            if (textBuffer) {
                output += renderInline(textBuffer);
                textBuffer = '';
            }
        };

        while (cursor < text.length) {
            const char = text[cursor];

            // 1. Structural Elements (Line Start Only)
            if (isLineStart) {
                const lineRemainder = text.substring(cursor);
                
                // a) Headings: # Title, ## Section
                const hMatch = lineRemainder.match(/^([ \t]*)(#{1,3})\s+(.*?)(\n|$)/);
                if (hMatch) {
                    flushBuffer();
                    const level = hMatch[2].length;
                    const content = hMatch[3];
                    output += `${window.escapeHtml(hMatch[1])}<h${level + 2} class="note-h${level}">${renderInline(content)}</h${level + 2}>`;
                    cursor += hMatch[0].length;
                    isLineStart = true;
                    continue;
                }

                // b) Horizontal Rule: ---
                const hrMatch = lineRemainder.match(/^([ \t]*)---(\s*)(\n|$)/);
                if (hrMatch) {
                    flushBuffer();
                    output += '<hr class="note-hr">';
                    cursor += hrMatch[0].length;
                    isLineStart = true;
                    continue;
                }

                // c+d+e) Checkbox first — catches `[ ] task`, `- [ ] task`, `* [ ] task`, `1. [ ] task`
                // before numbered/bullet patterns can consume the prefix.
                const cbMatch = lineRemainder.match(/^([ \t]*)(?:[-*]\s+|\d+\.\s+)?\[([ xX]?)\]/);
                if (cbMatch) {
                    flushBuffer();
                    const prefix  = cbMatch[1];
                    const state   = cbMatch[2].toLowerCase();
                    const checked = state === 'x';
                    const checkedClass = checked ? 'checked' : '';

                    let lineIndex = lineOffset;
                    for (let i = 0; i < cursor; i++) if (text[i] === '\n') lineIndex++;
                    output += `${window.escapeHtml(prefix)}<span class="checkbox-row-inline note-check-trigger ${checkedClass}" data-note-id="${noteId}" data-index="${lineIndex}"><span class="cb ${checkedClass}"></span>`;

                    inCheckboxRow = true;
                    isLineStart = false;
                    cursor += cbMatch[0].length;
                    continue;
                }

                // c) Numbered Lists: 1. item
                const numMatch = lineRemainder.match(/^([ \t]*)(\d+)\.\s+/);
                if (numMatch) {
                    flushBuffer();
                    output += `${window.escapeHtml(numMatch[1])}<span class="note-number">${numMatch[2]}.</span> `;
                    cursor += numMatch[0].length;
                    isLineStart = false;
                    continue;
                }

                // d) Bullet Points: * item or - item
                const bulletMatch = lineRemainder.match(/^([ \t]*)([*•-])\s+/);
                if (bulletMatch) {
                    flushBuffer();
                    output += `<span class="note-bullet-row">${window.escapeHtml(bulletMatch[1])}<span class="note-bullet">•</span><span class="note-bullet-text">`;
                    inBulletRow = true;
                    cursor += bulletMatch[0].length;
                    isLineStart = false;
                    continue;
                }

                // f) Callout: > [!type] Optional Title
                const calloutMatch = lineRemainder.match(/^> \[!([\w-]+)\]([^\n]*)(\n|$)/);
                if (calloutMatch) {
                    flushBuffer();
                    const calloutStartCursor = cursor;
                    const type  = calloutMatch[1].toLowerCase().replace(/[^a-z0-9-]/g, '');
                    const title = calloutMatch[2].trim();
                    cursor     += calloutMatch[0].length;

                    const bodyLines = [];
                    while (cursor < text.length) {
                        const lineEnd = text.indexOf('\n', cursor);
                        const line    = lineEnd === -1 ? text.substring(cursor) : text.substring(cursor, lineEnd);
                        if (line.startsWith('> ') || line === '>') {
                            bodyLines.push(line.startsWith('> ') ? line.substring(2) : '');
                            cursor = lineEnd === -1 ? text.length : lineEnd + 1;
                        } else {
                            break;
                        }
                    }

                    // Compute absolute line of the first body line in the full note
                    let calloutBodyOffset = lineOffset;
                    for (let i = 0; i < calloutStartCursor; i++) if (text[i] === '\n') calloutBodyOffset++;
                    calloutBodyOffset++; // skip the callout header line itself

                    const meta      = CALLOUT_META[type] || { icon: '📌', label: type };
                    const safeTitle = title ? window.escapeHtml(title) : meta.label;
                    const bodyHtml  = parseNote(bodyLines.join('\n'), noteId, depth + 1, calloutBodyOffset);
                    output += `<div class="note-callout note-callout--${type}"><div class="note-callout-header"><span class="note-callout-icon">${meta.icon}</span><span class="note-callout-title">${safeTitle}</span></div><div class="note-callout-body">${bodyHtml}</div></div>`;
                    isLineStart = true;
                    continue;
                }
            }

            // 1.5. Wikilink: [[Title]] — resolved client-side against STATE.note_map
            if (char === '[' && text[cursor + 1] === '[') {
                const closeIdx = text.indexOf(']]', cursor + 2);
                if (closeIdx !== -1) {
                    const title = text.substring(cursor + 2, closeIdx);
                    if (title.length > 0 && !title.includes('[') && !title.includes(']') && !title.includes('\n')) {
                        flushBuffer();
                        output += renderWikilink(title);
                        cursor = closeIdx + 2;
                        isLineStart = false;
                        continue;
                    }
                }
            }

            // 2. Component Scanning: O(1) Balanced Bracket Lookup
            if (char === '[') {
                const endIdx = bracketIndex.get(cursor) ?? -1;

                if (endIdx === -1) {
                    flushBuffer();
                    output += window.escapeHtml('[');
                    cursor++;
                    isLineStart = false;
                    continue;
                }

                const rawTag = text.substring(cursor + 1, endIdx);
                const pos = parsePositional(rawTag);
                const renderer = RENDERERS[pos.type];
                
                if (renderer) {
                    let startLine = lineOffset;
                    for (let i = 0; i <= endIdx; i++) if (text[i] === '\n') startLine++;
                    const result = renderer(pos, noteId, text.substring(endIdx + 1), depth, startLine);
                    if (result !== null) {
                        flushBuffer();
                        const html = typeof result === 'string' ? result : result.html;
                        if (typeof result === 'string') {
                            output += result;
                            cursor = endIdx + 1;
                        } else {
                            // Complex renderer (e.g. color) that handles own internal content
                            output += result.html;
                            cursor = endIdx + 1 + result.consumed;
                        }
                        // Block-level components consume their trailing \n to prevent a
                        // spurious <br> from appearing after every div/details/hr element.
                        const isBlock = /^<(div|details)/.test(html);
                        if (isBlock && text[cursor] === '\n') cursor++;
                        isLineStart = isBlock;
                        continue;
                    }
                }

                const remainder = text.substring(endIdx + 1);
                const linkMatch = remainder.match(/^\((https?:\/\/[^\s\)]+)\)/);
                if (linkMatch) {
                    const url = getSafeUrl(linkMatch[1]);
                    if (url) {
                        flushBuffer();
                        output += `<a href="${url}" target="_blank" rel="noopener noreferrer" class="note-external-link" data-action="stop-propagation">${renderInline(rawTag)}</a>`;
                        cursor = endIdx + 1 + linkMatch[0].length;
                        isLineStart = false;
                        continue;
                    }
                }

                flushBuffer();
                output += window.escapeHtml(text.substring(cursor, endIdx + 1));
                cursor = endIdx + 1;
                isLineStart = false;
                continue;
            }

            // 3. Raw URL Linkification
            const remainder = text.substring(cursor);
            const urlMatch = remainder.match(/^(https?:\/\/[^\s<]+)/);
            if (urlMatch) {
                const url = getSafeUrl(urlMatch[1]);
                if (url) {
                    flushBuffer();
                    output += `<a href="${url}" target="_blank" rel="noopener noreferrer" class="note-external-link" data-action="stop-propagation">${window.escapeHtml(urlMatch[1])}</a>`;
                    cursor += urlMatch[1].length;
                    isLineStart = false;
                    continue;
                }
            }

            // 4. Formatting & Newlines
            if (char === '\n') {
                flushBuffer();
                if (inCheckboxRow) {
                    output += '</span>';
                    inCheckboxRow = false;
                }
                if (inBulletRow) {
                    output += '</span></span>';
                    inBulletRow = false;
                }
                output += '<br>';
                cursor++;
                isLineStart = true;
                continue;
            }

            textBuffer += char;
            cursor++;
            isLineStart = false;
        }

        flushBuffer();
        if (inCheckboxRow) output += '</span>';
        if (inBulletRow) output += '</span></span>';
        return output;
    };

    return {
        isDashboard: isDashboardFormat,
        renderHeader: renderCategoryHeader,
        getDisplayTitle: getDisplayTitle,
        parse: (text, noteId) => {
            // Runtime Dependency Check: Ensure global sanitizer is available before tokenizing.
            if (typeof window.escapeHtml !== 'function') {
                throw new Error('NoteParser: window.escapeHtml is required but not defined.');
            }
            return parseNote(text, noteId, 0);
        }
    };
})();
