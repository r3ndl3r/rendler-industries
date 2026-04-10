// /public/js/notes/note-parser.js

/**
 * High-Fidelity Note Parser (Secure Tokenizer)
 * 
 * This module replaces regex-based substitutions with a single-pass tokenized 
 * parser. It enforces strict protocol whitelists, depth-balanced tag detection,
 * and positional parameter validation to prevent XSS and tag-breakout bypasses.
 */
const NoteParser = (() => {
    // 1. Dependency Assertion: Fail fast if the global sanitizer is missing.
    if (typeof window.escapeHtml !== 'function') {
        throw new Error('NoteParser: window.escapeHtml is required but not defined.');
    }

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
                
            return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="note-external-link" onclick="event.stopPropagation()">${labelContent}</a>`;
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
            const viewAction  = blobId ? `if(typeof viewNoteImage === 'function') viewNoteImage(${id}, ${blobId});` : `if(typeof handleNoteLinkClick === 'function') handleNoteLinkClick(${id});`;
            
            const att      = attachments[0] || {};
            const ext      = att.mime_type ? att.mime_type.split('/')[1].toUpperCase() : 'IMG';
            const sizeStr  = att.file_size ? ` • ${window.formatBytes(att.file_size)}` : '';
            const metaInfo = `${ext}${sizeStr} • #${id}`;

            return `<div class="note-embedded-wrap" onclick="${viewAction} event.stopPropagation();" title="View: ${safeTitle}" style="width: ${width}%;"><img src="${src}" class="note-embedded-img" alt="${safeTitle}" loading="lazy"><div class="note-embedded-caption">🖼️ ${safeTitle} (${metaInfo})</div></div>`;
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
            return `<a href="${src}" class="note-ref" download onclick="event.stopPropagation()"><span class="global-icon">📁</span> ${safeTitle}</a>`;
        },
        'color': (data, noteId, rawContent) => {
            const color = data.value.toLowerCase();
            const isHex = CONFIG.hexRegex.test(color);
            const isNamed = CONFIG.colors.includes(color);
            
            if (!isHex && !isNamed) return null;
            
            // Resolve semantic names (accent, info, etc.) to valid hex codes
            const hexColor = (typeof window.normalizeColorHex === 'function') 
                ? window.normalizeColorHex(color) 
                : color;

            // Find closing [/color]
            const closeTag = '[/color]';
            const endIdx = rawContent.indexOf(closeTag);
            if (endIdx === -1) return null; // Unclosed color tag
            
            const innerText = rawContent.substring(0, endIdx);
            return {
                html: `<span style="color: ${hexColor}">${renderInline(innerText).replace(/\n/g, '<br>')}</span>`,
                consumed: endIdx + closeTag.length
            };
        }
    };

    return {
        parse: (text, noteId) => {
            if (!text) return '';
            
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
                    // Relaxed Regex: Now supports legacy [] brackets without explicit space
                    const cbMatch = lineRemainder.match(/^(\s*)\[([ xX]?)\]/);
                    if (cbMatch) {
                        flushBuffer();
                        const prefix  = cbMatch[1];
                        const state   = cbMatch[2].toLowerCase();
                        const checked = state === 'x';
                        const checkedClass = checked ? 'checked' : '';
                        
                        // Line Index Calculation (for interactive toggle resolution)
                        let lineIndex = 0;
                        for (let i = 0; i < cursor; i++) if (text[i] === '\n') lineIndex++;

                        // Start the interactive row wrapper
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

                    // Unbalanced bracket: emit literal [ and continue
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
                        const result = renderer(pos, noteId, text.substring(endIdx + 1));
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

                    // Markdown Link Fallback: [label](url)
                    const remainder = text.substring(endIdx + 1);
                    const linkMatch = remainder.match(/^\((https?:\/\/[^\s\)]+)\)/);
                    if (linkMatch) {
                        const url = getSafeUrl(linkMatch[1]);
                        if (url) {
                            flushBuffer();
                            output += `<a href="${url}" target="_blank" rel="noopener noreferrer" class="note-external-link" onclick="event.stopPropagation()">${renderInline(rawTag)}</a>`;
                            cursor = endIdx + 1 + linkMatch[0].length;
                            isLineStart = false;
                            continue;
                        }
                    }

                    // Security: If balanced but rejected/malformed, emit ENTIRE span as literal
                    // and advance cursor past it to prevent re-scan of internal tags.
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
                        output += `<a href="${url}" target="_blank" rel="noopener noreferrer" class="note-external-link" onclick="event.stopPropagation()">${window.escapeHtml(urlMatch[1])}</a>`;
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

                // 5. Text Accumulation
                textBuffer += char;
                cursor++;
                isLineStart = false;
            }

            flushBuffer();
            if (inCheckboxRow) output += '</span>';
            return output;
        }
    };
})();
