// /public/js/rubiks.js

/**
 * Rubik's Moves Generator & Global Library
 *
 * Features:
 * - 2D Grid Generator (3x3, 4x4, Rotations)
 * - Family Algorithm Storage (CRUD)
 * - SVG Export
 */

const RUBIKS_CONFIG = {
    gridSize: 40,
    strokeWidth: 2,
    arrowColor: '#000000',
    gridColor: '#000000',
    fontFamily: 'Inter, sans-serif'
};

let RUBIKS_STATE = {
    sequence: '',
    cubeSize: 3,
    algorithms: []
};

document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('moveSequence');
    if (input) {
        input.addEventListener('input', (e) => {
            RUBIKS_STATE.sequence = e.target.value;
            generateDiagram();
        });
    }

    loadLibrary();

    if (typeof setupGlobalModalClosing === 'function') {
        setupGlobalModalClosing(['modal-overlay'], []);
    }
});

/**
 * Fetches the global algorithm library from the server and renders it.
 * @returns {Promise<void>}
 */
async function loadLibrary() {
    try {
        const res = await fetch('/rubiks/api/state');
        const data = await res.json();

        if (data.success) {
            RUBIKS_STATE.algorithms = data.algorithms || [];
        }
        renderLibrary();
    } catch (err) {
        console.error('Failed to load library:', err);
        renderLibrary();
    }
}

/**
 * Renders the saved algorithm list filtered by the current search query.
 * @returns {void}
 */
function renderLibrary() {
    const list = document.getElementById('algorithm-list');
    const count = document.getElementById('library-count');
    if (!list || !count) return;

    const query = (document.getElementById('library-search')?.value || '').toLowerCase().trim();
    const visible = query
        ? RUBIKS_STATE.algorithms.filter(a =>
            a.name.toLowerCase().includes(query) ||
            a.category.toLowerCase().includes(query) ||
            a.sequence.toLowerCase().includes(query))
        : RUBIKS_STATE.algorithms;

    count.textContent = RUBIKS_STATE.algorithms.length;

    if (RUBIKS_STATE.algorithms.length === 0) {
        list.innerHTML = '<p class="empty-hint">No algorithms saved yet.</p>';
        return;
    }

    if (visible.length === 0) {
        list.innerHTML = '<p class="empty-hint">No results for &ldquo;' + escapeHtml(query) + '&rdquo;.</p>';
        return;
    }

    list.innerHTML = visible.map(alg => {
        const safeAlg = JSON.stringify(alg).replace(/"/g, '&quot;');
        return `
            <div class="library-item" onclick="loadAlgorithm(${safeAlg})">
                <div class="alg-info">
                    <span class="alg-category badge-small">${escapeHtml(alg.category)}</span>
                    <div class="alg-name">${escapeHtml(alg.name)}</div>
                    <div class="alg-seq-preview">${escapeHtml(alg.sequence)}</div>
                </div>
                <div class="alg-actions">
                    <button class="btn-tiny" onclick="event.stopPropagation(); editAlgorithm(${safeAlg})">✏️</button>
                    <button class="btn-tiny danger" onclick="event.stopPropagation(); deleteAlgorithm(${alg.id})">🗑️</button>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Loads a saved algorithm into the sequence input and regenerates the diagram.
 * @param {Object} alg - Algorithm record with `sequence` and `name` fields.
 * @returns {void}
 */
function loadAlgorithm(alg) {
    const input = document.getElementById('moveSequence');
    if (input) {
        input.value = alg.sequence;
        RUBIKS_STATE.sequence = alg.sequence;
        generateDiagram();
        showToast(`Loaded: ${alg.name}`, 'info');
    }
}

/**
 * Opens the save modal pre-populated with the current sequence.
 * @returns {void}
 */
function openSaveModal() {
    const sequence = document.getElementById('moveSequence').value.trim();
    if (!sequence) {
        showToast('Enter a sequence first!', 'warning');
        return;
    }

    document.getElementById('edit-id').value = '';
    document.getElementById('alg-name').value = '';
    document.getElementById('alg-category').value = 'General';
    document.getElementById('alg-sequence').value = sequence;
    document.getElementById('saveModal').classList.add('show');
}

/**
 * Closes the save modal.
 * @returns {void}
 */
function closeSaveModal() {
    document.getElementById('saveModal').classList.remove('show');
}

/**
 * Opens the save modal pre-populated with an existing algorithm for editing.
 * @param {Object} alg - Algorithm record to edit.
 * @returns {void}
 */
function editAlgorithm(alg) {
    document.getElementById('edit-id').value = alg.id;
    document.getElementById('alg-name').value = alg.name;
    document.getElementById('alg-category').value = alg.category;
    document.getElementById('alg-sequence').value = alg.sequence;
    document.getElementById('saveModal').classList.add('show');
}

/**
 * Handles the save form submission for both create and update operations.
 * @param {SubmitEvent} e - The form submission event.
 * @returns {Promise<void>}
 */
async function handleSaveAlgorithm(e) {
    e.preventDefault();
    const saveBtn = document.getElementById('saveBtn');
    const originalText = saveBtn.innerHTML;

    const formData = new FormData(e.target);
    const data = {
        id: formData.get('edit-id'),
        name: formData.get('alg-name'),
        category: formData.get('alg-category'),
        sequence: formData.get('alg-sequence')
    };

    saveBtn.disabled = true;
    saveBtn.innerHTML = '⌛ Saving...';

    try {
        const res = await apiPost('/rubiks/api/save', data);
        if (res && res.success) {
            closeSaveModal();
            loadLibrary();
        } else {
            showToast(res?.error || 'Save failed. Please try again.', 'error');
        }
    } catch (err) {
        console.error("Rubiks: Save Error:", err);
        showToast('Save failed. Please try again.', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalText;
    }
}

/**
 * Prompts for confirmation then deletes an algorithm by ID.
 * @param {number} id - The algorithm record ID to delete.
 * @returns {Promise<void>}
 */
async function deleteAlgorithm(id) {
    const confirmed = await showConfirmModal({
        title: 'Delete Algorithm',
        message: 'Are you sure you want to remove this algorithm from the family library?',
        confirmText: 'Delete',
        confirmIcon: '🗑️',
        danger: true
    });

    if (confirmed) {
        try {
            const res = await apiPost(`/rubiks/api/delete/${id}`);
            if (res && res.success) {
                loadLibrary();
            } else {
                showToast(res?.error || 'Delete failed. Please try again.', 'error');
            }
        } catch (err) {
            console.error("Rubiks: Delete Error:", err);
            showToast('Delete failed. Please try again.', 'error');
        }
    }
}

/**
 * Sets the active cube size and regenerates the diagram.
 * @param {number} size - Cube dimension (3 or 4).
 * @returns {void}
 */
function setCubeSize(size) {
    RUBIKS_STATE.cubeSize = size;
    document.querySelectorAll('.size-selector .btn-tab').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.size) === size);
    });
    generateDiagram();
}

/**
 * Updates the grid cell size used for SVG rendering.
 * @param {string} val - New pixel size as a string (from range input).
 * @returns {void}
 */
function setGridScale(val) {
    const size = parseInt(val);
    if (isNaN(size) || size < 1) return;
    RUBIKS_CONFIG.gridSize = size;
    const label = document.getElementById('scale-value');
    if (label) label.textContent = val + 'px';
    generateDiagram();
}

/**
 * Parses the current sequence and renders one SVG card per move into the diagram canvas.
 * @returns {void}
 */
function generateDiagram() {
    const container = document.getElementById('cube-diagram-container');
    if (!container) return;

    const moves = parseNotation(RUBIKS_STATE.sequence);

    if (moves.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>⌨️ Enter a move sequence to begin...</p></div>`;
        return;
    }

    const gallery = document.createElement('div');
    gallery.className = 'diagram-gallery';

    moves.forEach((move) => {
        const moveCard = document.createElement('div');
        moveCard.className = 'move-card';
        moveCard.innerHTML = renderMoveSVG(move);

        if (moves.length > 1) {
            const label = document.createElement('div');
            label.className = 'move-label';
            label.textContent = move.raw;
            moveCard.appendChild(label);
        }
        gallery.appendChild(moveCard);
    });

    container.innerHTML = '';
    container.appendChild(gallery);
}

/**
 * Tokenises a WCA notation string into an array of structured move objects.
 * @param {string} str - Raw move sequence string (space or comma separated).
 * @returns {Array<{layer: number, face: string, wide: boolean, prime: boolean, count: number, raw: string}>}
 */
function parseNotation(str) {
    if (!str) return [];
    const normalized = str.replace(/,/g, ' ').trim();
    const parts = normalized.split(/\s+/).filter(p => p.length > 0);
    const moves = [];

    parts.forEach(p => {
        const match = p.match(/^(\d)?([UDLRFBMESXYZudlrfbxyz])(w)?(['])?(\d)?$/);
        if (match) {
            moves.push({
                layer: match[1] ? parseInt(match[1]) : 1,
                face: match[2],
                wide: !!match[3],
                prime: !!match[4],
                count: match[5] ? parseInt(match[5]) : 1,
                raw: p
            });
        }
    });
    return moves;
}

/**
 * Renders a single move as an SVG grid with directional arrows.
 * @param {{face: string, wide: boolean, prime: boolean, count: number, layer: number, raw: string}} move
 * @returns {string} SVG markup string.
 */
function renderMoveSVG(move) {
    const size = RUBIKS_STATE.cubeSize;
    const padding = 8;
    const boxSize = RUBIKS_CONFIG.gridSize;
    const totalSize = size * boxSize + (padding * 2);
    let svg = `<svg width="${totalSize}" height="${totalSize}" viewBox="0 0 ${totalSize} ${totalSize}" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<g class="cube-grid">`;
    for (let i = 0; i <= size; i++) {
        const pos = padding + (i * boxSize);
        svg += `<line x1="${pos}" y1="${padding}" x2="${pos}" y2="${padding + (size * boxSize)}" stroke="${RUBIKS_CONFIG.gridColor}" stroke-width="${RUBIKS_CONFIG.strokeWidth}" />`;
        svg += `<line x1="${padding}" y1="${pos}" x2="${padding + (size * boxSize)}" y2="${pos}" stroke="${RUBIKS_CONFIG.gridColor}" stroke-width="${RUBIKS_CONFIG.strokeWidth}" />`;
    }
    svg += `</g>`;
    svg += drawArrows(move, padding, boxSize, size);
    if (move.count === 2) {
        const textX = padding + (size * boxSize) / 2;
        const textY = padding + (size * boxSize) / 2;
        const fontSize = Math.max(boxSize * 0.85, 10);
        const strokeWidth = Math.max(boxSize * 0.1, 1.5);
        svg += `<text x="${textX}" y="${textY}" font-family="${RUBIKS_CONFIG.fontFamily}" font-size="${fontSize}" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#000" style="paint-order: stroke; stroke: #fff; stroke-width: ${strokeWidth}px; stroke-linejoin: round;">×2</text>`;
    }
    svg += `</svg>`;
    return svg;
}

/**
 * Builds SVG arrow elements for a move, covering all affected layers and directions.
 * @param {{face: string, wide: boolean, prime: boolean, layer: number}} move
 * @param {number} padding - Grid inset in pixels.
 * @param {number} boxSize - Size of each cell in pixels.
 * @param {number} size - Cube dimension (3 or 4).
 * @returns {string} SVG markup string for all arrows.
 */
function drawArrows(move, padding, boxSize, size) {
    let arrows = '';
    const arrowPadding = 10;
    const headSize = 8;
    const arrow = (x1, y1, x2, y2, color = RUBIKS_CONFIG.arrowColor) => {
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const p1x = x2 - headSize * Math.cos(angle - Math.PI / 6);
        const p1y = y2 - headSize * Math.sin(angle - Math.PI / 6);
        const p2x = x2 - headSize * Math.cos(angle + Math.PI / 6);
        const p2y = y2 - headSize * Math.sin(angle + Math.PI / 6);
        return `<g class="move-arrow"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="3" stroke-linecap="round" /><path d="M ${x2} ${y2} L ${p1x} ${p1y} L ${p2x} ${p2y} Z" fill="${color}" /></g>`;
    };
    const face = move.face.toUpperCase();
    const isPrime = move.prime;
    const isWide = move.wide;
    const isRotation = 'XYZ'.includes(face);
    let affectedLayers = [];
    if (isRotation) {
        for (let i = 0; i < size; i++) affectedLayers.push(i);
    } else if (isWide) {
        const count = Math.max(move.layer, 2);
        for (let i = 0; i < count; i++) affectedLayers.push(i);
    } else if (move.face !== move.face.toUpperCase()) {
        // Lowercase move (e.g. r, l) is a slice move (inner only)
        affectedLayers.push(1);
    } else {
        // Uppercase move (e.g. R, L) is a single outer layer
        affectedLayers.push(0);
    }
    const startY = padding + arrowPadding, endY = padding + size * boxSize - arrowPadding;
    const startX = padding + arrowPadding, endX = padding + size * boxSize - arrowPadding;
    affectedLayers.forEach(layerIdx => {
        let x1, y1, x2, y2;
        const color = isPrime ? '#ef4444' : RUBIKS_CONFIG.arrowColor;
        switch (face) {
            case 'R': case 'X':
                const rx = padding + (size - 0.5 - layerIdx) * boxSize; [x1, y1, x2, y2] = isPrime ? [rx, startY, rx, endY] : [rx, endY, rx, startY]; arrows += arrow(x1, y1, x2, y2, color); break;
            case 'L':
                const lx = padding + (0.5 + layerIdx) * boxSize; [x1, y1, x2, y2] = isPrime ? [lx, endY, lx, startY] : [lx, startY, lx, endY]; arrows += arrow(x1, y1, x2, y2, color); break;
            case 'U': case 'Y':
                const uy = padding + (0.5 + layerIdx) * boxSize; [x1, y1, x2, y2] = isPrime ? [endX, uy, startX, uy] : [startX, uy, endX, uy]; arrows += arrow(x1, y1, x2, y2, color); break;
            case 'D':
                const dy = padding + (size - 0.5 - layerIdx) * boxSize; [x1, y1, x2, y2] = isPrime ? [startX, dy, endX, dy] : [endX, dy, startX, dy]; arrows += arrow(x1, y1, x2, y2, color); break;
            case 'M':
                const mx = padding + (size / 2) * boxSize; [x1, y1, x2, y2] = isPrime ? [mx, endY, mx, startY] : [mx, startY, mx, endY]; arrows += arrow(x1, y1, x2, y2, color); break;
            case 'F': case 'Z':
                const offset = layerIdx * boxSize; const fx1 = padding + 5 + offset, fx2 = padding + size * boxSize - 5 - offset;
                if (!isPrime) { arrows += arrow(fx2, endY, fx2, startY, color); arrows += arrow(fx1, startY, fx1, endY, color); }
                else { arrows += arrow(fx1, endY, fx1, startY, color); arrows += arrow(fx2, startY, fx2, endY, color); }
                break;
            case 'B':
                const boffset = layerIdx * boxSize; const bx1 = padding + 5 + boffset, bx2 = padding + size * boxSize - 5 - boffset;
                if (!isPrime) { arrows += arrow(bx1, endY, bx1, startY, color); arrows += arrow(bx2, startY, bx2, endY, color); }
                else { arrows += arrow(bx2, endY, bx2, startY, color); arrows += arrow(bx1, startY, bx1, endY, color); }
                break;
            case 'E':
                const ey = padding + (size / 2) * boxSize; [x1, y1, x2, y2] = isPrime ? [startX, ey, endX, ey] : [endX, ey, startX, ey]; arrows += arrow(x1, y1, x2, y2, color); break;
            case 'S':
                const soffset = layerIdx * boxSize; const sx1 = padding + 5 + soffset, sx2 = padding + size * boxSize - 5 - soffset;
                if (!isPrime) { arrows += arrow(sx2, endY, sx2, startY, color); arrows += arrow(sx1, startY, sx1, endY, color); }
                else { arrows += arrow(sx1, endY, sx1, startY, color); arrows += arrow(sx2, startY, sx2, endY, color); }
                break;
        }
    });
    return arrows;
}

/**
 * Clears the current sequence and resets the diagram to its empty state.
 * @returns {void}
 */
function resetCube() {
    const input = document.getElementById('moveSequence');
    if (input) input.value = '';
    RUBIKS_STATE.sequence = '';
    generateDiagram();
}

/**
 * Combines all visible SVG move cards into a single SVG file and triggers a download.
 * @returns {void}
 */
function downloadSVG() {
    const container = document.getElementById('cube-diagram-container');
    const svgs = container.querySelectorAll('svg');
    if (svgs.length === 0) return;
    let combinedSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1500" viewBox="0 0 1000 1500">`;
    svgs.forEach((svg, i) => {
        const x = (i % 5) * 200, y = Math.floor(i / 5) * 200;
        combinedSVG += `<g transform="translate(${x}, ${y})">${svg.innerHTML}</g>`;
    });
    combinedSVG += `</svg>`;
    const blob = new Blob([combinedSVG], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `rubiks_alg_${Date.now()}.svg`; a.click(); URL.revokeObjectURL(url);
}

window.searchLibrary = () => renderLibrary();
window.generateDiagram = generateDiagram;
window.resetCube = resetCube;
window.downloadSVG = downloadSVG;
window.setCubeSize = setCubeSize;
window.openSaveModal = openSaveModal;
window.closeSaveModal = closeSaveModal;
window.handleSaveAlgorithm = handleSaveAlgorithm;
window.loadAlgorithm = loadAlgorithm;
window.editAlgorithm = editAlgorithm;
window.deleteAlgorithm = deleteAlgorithm;
window.setGridScale = setGridScale;
