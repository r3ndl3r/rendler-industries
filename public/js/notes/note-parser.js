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
     * Processes basic Markdown (Bold/Italic) within component labels.
     * Does not recurse to prevent depth-based vulnerabilities.
     */
    const renderInline = (text) => {
        const escaped = window.escapeHtml(text);
        return escaped
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>');
    };

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
            const id = parseInt(data.value, 10);
            if (isNaN(id)) return null;
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
            const id = parseInt(data.value, 10);
            if (isNaN(id)) return null;
            const target = STATE.note_map[id];
            const safeTitle = target ? window.escapeHtml(target.title || target) : `Note #${id}`;
            return `<span class="note-ref note-link-trigger" data-target-id="${id}" title="Jump to Note: ${safeTitle}">${safeTitle}</span>`;
        },
        'file': (data) => {
            const id = parseInt(data.value, 10);
            if (isNaN(id)) return null;
            const meta        = STATE.note_map[id];
            const attachments = meta ? (meta.attachments || []) : [];
            const blobId      = (meta && meta.blob_id) ? meta.blob_id : (attachments[0] ? attachments[0].blob_id : null);
            const src         = blobId ? `/notes/attachment/serve/${blobId}` : `/notes/serve/${id}`;
            const safeTitle   = meta   ? window.escapeHtml(meta.title || id) : `File #${id}`;
            return `<a href="${src}" class="note-ref" download data-action="stop-propagation"><span class="global-icon">📁</span> ${safeTitle}</a>`;
        },
        'color': (pos, noteId, rawContent, depth = 0) => {
            const color = pos.value.toLowerCase();
            const isHex = CONFIG.hexRegex.test(color);
            const isNamed = CONFIG.colors.includes(color);

            if (!isHex && !isNamed) return null;

            const hexColor = (typeof window.normalizeColorHex === 'function') 
                ? window.normalizeColorHex(color) 
                : color;

            const openPrefix = '[color:';
            const closeTag = '[/color]';
            let nesting = 1;
            let scan = 0;
            let endIdx = -1;

            while (scan < rawContent.length) {
                const nextOpen = rawContent.indexOf(openPrefix, scan);
                const nextClose = rawContent.indexOf(closeTag, scan);

                if (nextClose === -1) break;

                if (nextOpen !== -1 && nextOpen < nextClose) {
                    nesting++;
                    scan = nextOpen + openPrefix.length;
                    continue;
                }

                nesting--;
                if (nesting === 0) {
                    endIdx = nextClose;
                    break;
                }
                scan = nextClose + closeTag.length;
            }

            if (endIdx === -1) return null;

            const innerText = rawContent.substring(0, endIdx);
            const innerHtml = parseNote(innerText, noteId, depth + 1);

            return {
                html: `<span style="color: ${hexColor}">${innerHtml}</span>`,
                consumed: endIdx + closeTag.length
            };
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

    /**
     * Recursive Tokenizer Engine:
     * Converts raw text into sanitized HTML components with support for nested tags.
     * @param {string} text - The content to parse.
     * @param {number} noteId - Parent note ID for context-sensitive renderers.
     * @param {number} depth - Current recursion depth (Guard against infinite loops).
     * @returns {string} - Rendered HTML.
     */
    function parseNote(text, noteId, depth = 0) {
        if (!text) return '';

        // 0. Safety Guards: Length and Depth Limits
        // Prevents main-thread blocking on oversized notes or malicious recursion
        if (text.length > 50000) {
            if (typeof showToast === 'function') {
                showToast('Note too large to format', 'warning');
            }
            return window.escapeHtml(text).replace(/\n/g, '<br>');
        }

        if (depth > 3) {
            return renderInline(text).replace(/\n/g, '<br>');
        }
        
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
                
                // a) Horizontal Rule: ---
                const hrMatch = lineRemainder.match(/^(\s*)---(\s*)(\n|$)/);
                if (hrMatch) {
                    flushBuffer();
                    output += '<hr class="note-hr">';
                    cursor += hrMatch[0].length;
                    isLineStart = true;
                    continue;
                }

                // b) Bullet Points: * item or - item
                const bulletMatch = lineRemainder.match(/^(\s*)([*•-])\s+/);
                if (bulletMatch) {
                    flushBuffer();
                    output += `${window.escapeHtml(bulletMatch[1])}<span class="note-bullet"></span> `;
                    cursor += bulletMatch[0].length;
                    isLineStart = false;
                    continue;
                }

                // c) Checkbox Detection
                const cbMatch = lineRemainder.match(/^([ \t]*)\[([ xX]?)\]/);
                if (cbMatch) {
                    flushBuffer();
                    const prefix  = cbMatch[1];
                    const state   = cbMatch[2].toLowerCase();
                    const checked = state === 'x';
                    const checkedClass = checked ? 'checked' : '';
                    
                    let lineIndex = 0;
                    for (let i = 0; i < cursor; i++) if (text[i] === '\n') lineIndex++;

                    output += `${window.escapeHtml(prefix)}<span class="checkbox-row-inline note-check-trigger ${checkedClass}" data-note-id="${noteId}" data-index="${lineIndex}"><span class="cb ${checkedClass}"></span>`;
                    
                    inCheckboxRow = true;
                    isLineStart = false;
                    cursor += cbMatch[0].length;
                    continue;
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
                    // Pass current depth to the renderer for potential recursion
                    const result = renderer(pos, noteId, text.substring(endIdx + 1), depth);
                    if (result !== null) {
                        flushBuffer();
                        if (typeof result === 'string') {
                            output += result;
                            cursor = endIdx + 1;
                        } else {
                            // Complex renderer (e.g. color) that handles own internal content
                            output += result.html;
                            cursor = endIdx + 1 + result.consumed;
                        }
                        isLineStart = false;
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
        return output;
    }
})();
