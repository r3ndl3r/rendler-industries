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
    algorithms: [],
    solves: [],
    timerCubeType: '3x3',
    statsCubeFilter: 'all',
    timerRunning: false,
    timerStartedAt: 0,
    timerInterval: null,
    solverPreviews: { image1: null, image2: null },
    initialSolverState: null,
    reviewedSolverState: '',
    solverDimension: 'auto'
};

/**
 * Lightweight Rubik's Cube state manager for NxN color simulation.
 */
class RubiksCube {
    constructor(stateString, dimension = 3) {
        this.dim = dimension;
        this.state = (stateString || this.getSolvedString()).split('');
    }

    getSolvedString() {
        const stickersPerFace = this.dim * this.dim;
        return 'U'.repeat(stickersPerFace) + 'R'.repeat(stickersPerFace) + 'F'.repeat(stickersPerFace) +
               'D'.repeat(stickersPerFace) + 'L'.repeat(stickersPerFace) + 'B'.repeat(stickersPerFace);
    }

    getFaceOffset(faceName) {
        const idx = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 }[faceName];
        return idx * this.dim * this.dim;
    }

    move(m) {
        if (this.dim !== 3) return; // Rotation simulation currently limited to 3x3 for performance
        const count = m.count || 1;
        const face = m.face.toUpperCase();
        for (let i = 0; i < count; i++) {
            this.rotate(face, m.prime);
        }
    }

    rotate(face, prime) {
        const dim = this.dim;
        const stickers = dim * dim;
        const s = this.state;
        const f = {
            U: 0, R: stickers, F: stickers * 2, D: stickers * 3, L: stickers * 4, B: stickers * 5
        };

        const rotateFace = (idx) => {
            const temp = s.slice(idx, idx + stickers);
            if (!prime) {
                s[idx] = temp[6]; s[idx+1] = temp[3]; s[idx+2] = temp[0];
                s[idx+3] = temp[7]; s[idx+4] = temp[4]; s[idx+5] = temp[1];
                s[idx+6] = temp[8]; s[idx+7] = temp[5]; s[idx+8] = temp[2];
            } else {
                s[idx] = temp[2]; s[idx+1] = temp[5]; s[idx+2] = temp[8];
                s[idx+3] = temp[1]; s[idx+4] = temp[4]; s[idx+5] = temp[7];
                s[idx+6] = temp[0]; s[idx+7] = temp[3]; s[idx+8] = temp[6];
            }
        };

        const cycle = (arr) => {
            if (!prime) {
                const temp = [s[arr[3][0]], s[arr[3][1]], s[arr[3][2]]];
                for (let i = 3; i > 0; i--) {
                    s[arr[i][0]] = s[arr[i-1][0]]; s[arr[i][1]] = s[arr[i-1][1]]; s[arr[i][2]] = s[arr[i-1][2]];
                }
                s[arr[0][0]] = temp[0]; s[arr[0][1]] = temp[1]; s[arr[0][2]] = temp[2];
            } else {
                const temp = [s[arr[0][0]], s[arr[0][1]], s[arr[0][2]]];
                for (let i = 0; i < 3; i++) {
                    s[arr[i][0]] = s[arr[i+1][0]]; s[arr[i][1]] = s[arr[i+1][1]]; s[arr[i][2]] = s[arr[i+1][2]];
                }
                s[arr[3][0]] = temp[0]; s[arr[3][1]] = temp[1]; s[arr[3][2]] = temp[2];
            }
        };

        switch(face) {
            case 'U': rotateFace(f.U); cycle([[f.F,0,1,2], [f.L,0,1,2], [f.B,0,1,2], [f.R,0,1,2]]); break;
            case 'D': rotateFace(f.D); cycle([[f.F,6,7,8], [f.R,6,7,8], [f.B,6,7,8], [f.L,6,7,8]]); break;
            case 'L': rotateFace(f.L); cycle([[f.F,0,3,6], [f.U,0,3,6], [f.B,8,5,2], [f.D,0,3,6]]); break;
            case 'R': rotateFace(f.R); cycle([[f.F,2,5,8], [f.D,2,5,8], [f.B,6,3,0], [f.U,2,5,8]]); break;
            case 'F': rotateFace(f.F); cycle([[f.U,6,7,8], [f.R,0,3,6], [f.D,2,1,0], [f.L,8,5,2]]); break;
            case 'B': rotateFace(f.B); cycle([[f.U,0,1,2], [f.L,0,3,6], [f.D,8,7,6], [f.R,8,5,2]]); break;
        }
    }

    getFaceColors(faceName) {
        const start = this.getFaceOffset(faceName);
        const count = this.dim * this.dim;
        return this.state.slice(start, start + count).map(c => {
            return { U: '#ffffff', D: '#ffff00', L: '#ff8000', R: '#ff0000', F: '#00ff00', B: '#0000ff' }[c] || '#cccccc';
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('moveSequence');
    if (input) {
        input.addEventListener('input', (e) => {
            RUBIKS_STATE.sequence = e.target.value;
            generateDiagram();
        });

        const importedSequence = sessionStorage.getItem('rubiks_imported_sequence');
        if (importedSequence) {
            input.value = importedSequence;
            RUBIKS_STATE.sequence = importedSequence;
            sessionStorage.removeItem('rubiks_imported_sequence');
            generateDiagram();
        }
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
        const data = await apiGet('/rubiks/api/state');
        if (data && data.success) {
            RUBIKS_STATE.algorithms = data.algorithms || [];
            RUBIKS_STATE.solves = data.solves || [];
        }
        renderLibrary();
        renderSolveDashboard();
    } catch (err) {
        console.error('Failed to load library:', err);
        renderLibrary();
        renderSolveDashboard();
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
    showConfirmModal({
        title: 'Delete Algorithm',
        message: 'Are you sure you want to remove this algorithm from the family library?',
        confirmText: 'Delete',
        confirmIcon: '🗑️',
        danger: true,
        onConfirm: async () => {
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
    });
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
function renderMoveSVG(move, colors) {
    const size = RUBIKS_STATE.cubeSize;
    const padding = 8;
    const boxSize = RUBIKS_CONFIG.gridSize;
    const totalSize = size * boxSize + (padding * 2);
    let svg = `<svg width="${totalSize}" height="${totalSize}" viewBox="0 0 ${totalSize} ${totalSize}" xmlns="http://www.w3.org/2000/svg">`;

    // Render colored stickers behind the grid if colors are provided
    if (colors && colors.length === size * size) {
        for (let i = 0; i < colors.length; i++) {
            const col = i % size;
            const row = Math.floor(i / size);
            const x = padding + (col * boxSize);
            const y = padding + (row * boxSize);
            svg += `<rect x="${x}" y="${y}" width="${boxSize}" height="${boxSize}" fill="${colors[i]}" stroke="none" />`;
        }
    }

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

/**
 * Selects the cube type used by the stopwatch.
 * @param {string} cubeType - Either "3x3" or "4x4".
 * @returns {void}
 */
function setTimerCubeType(cubeType) {
    if (!['3x3', '4x4'].includes(cubeType) || RUBIKS_STATE.timerRunning) return;
    RUBIKS_STATE.timerCubeType = cubeType;
    document.querySelectorAll('[data-timer-cube]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.timerCube === cubeType);
    });
    renderSolveDashboard();
}

/**
 * Starts a new solve timer.
 * @returns {void}
 */
function startSolveTimer() {
    if (RUBIKS_STATE.timerRunning) return;

    RUBIKS_STATE.timerRunning = true;
    RUBIKS_STATE.timerStartedAt = performance.now();
    document.getElementById('timerStartBtn').disabled = true;

    const overlay = document.getElementById('solve-overlay');
    if (overlay) overlay.classList.add('active');

    document.addEventListener('keydown', handleSolveOverlayInput);
    document.addEventListener('mousedown', handleSolveOverlayInput);
    document.addEventListener('touchstart', handleSolveOverlayInput, { passive: false });

    RUBIKS_STATE.timerInterval = setInterval(updateTimerDisplay, 31);
    updateTimerDisplay();
}

/**
 * Stops the active timer and asks whether to save the solve.
 * @returns {Promise<void>}
 */
async function stopSolveTimer() {
    if (!RUBIKS_STATE.timerRunning) return;

    const overlay = document.getElementById('solve-overlay');
    if (overlay) overlay.classList.remove('active');

    document.removeEventListener('keydown', handleSolveOverlayInput);
    document.removeEventListener('mousedown', handleSolveOverlayInput);
    document.removeEventListener('touchstart', handleSolveOverlayInput);

    const duration = Math.round(performance.now() - RUBIKS_STATE.timerStartedAt);
    const cubeType = RUBIKS_STATE.timerCubeType;
    clearInterval(RUBIKS_STATE.timerInterval);
    RUBIKS_STATE.timerInterval = null;
    RUBIKS_STATE.timerRunning = false;

    document.getElementById('timerStartBtn').disabled = false;
    setTimerDisplay(duration);

    showConfirmModal({
        title: 'Save Solve?',
        icon: '⏱️',
        message: `Save ${formatSolveTime(duration)} as a ${cubeType} solve?`,
        confirmText: 'Save Time',
        confirmIcon: '💾',
        cancelText: 'Discard',
        success: true,
        onConfirm: () => saveSolveTime(duration, cubeType)
    });
}

/**
 * Persists a confirmed solve time.
 * @param {number} duration - Solve duration in milliseconds.
 * @param {string} cubeType - Cube type for the solve.
 * @returns {Promise<void>}
 */
async function saveSolveTime(duration, cubeType) {
    try {
        const res = await apiPost('/rubiks/api/solves/save', {
            cube_type: cubeType,
            duration_ms: duration
        });
        if (res && res.success) {
            RUBIKS_STATE.solves = res.solves || [];
            renderSolveDashboard(duration, cubeType);
        } else {
            showToast(res?.error || 'Solve save failed. Please try again.', 'error');
        }
    } catch (err) {
        console.error('Rubiks solve save failed:', err);
        showToast('Solve save failed. Please try again.', 'error');
    }
}

/**
 * Stops the solve timer when any input is detected on the overlay.
 * Prevents default for keyboard and mouse events to avoid triggering
 * other handlers or closing the save confirmation via a follow-up click.
 * @param {KeyboardEvent|MouseEvent|TouchEvent} e
 * @returns {void}
 */
function handleSolveOverlayInput(e) {
    if (!RUBIKS_STATE.timerRunning) return;
    if (e.type === 'keydown' || e.type === 'mousedown' || e.type === 'touchstart') {
        e.preventDefault();
        e.stopPropagation();
    }
    stopSolveTimer();
}

/**
 * Refreshes the live stopwatch display.
 * @returns {void}
 */
function updateTimerDisplay() {
    if (!RUBIKS_STATE.timerRunning) return;
    setTimerDisplay(Math.round(performance.now() - RUBIKS_STATE.timerStartedAt));
}

/**
 * Writes a formatted duration to the stopwatch display.
 * @param {number} ms - Duration in milliseconds.
 * @returns {void}
 */
function setTimerDisplay(ms) {
    const el = document.getElementById('solve-timer-display');
    if (el) el.textContent = formatSolveTime(ms);
    const overlayEl = document.getElementById('solve-timer-overlay-display');
    if (overlayEl) overlayEl.textContent = formatSolveTime(ms);
}

/**
 * Sets the cube filter used by statistics and history.
 * @param {string} filter - "all", "3x3", or "4x4".
 * @returns {void}
 */
function setStatsCubeFilter(filter) {
    RUBIKS_STATE.statsCubeFilter = ['3x3', '4x4'].includes(filter) ? filter : 'all';
    renderSolveDashboard();
}

/**
 * Deletes a solve from the current user's history.
 * @param {number} id - Solve ID.
 * @returns {Promise<void>}
 */
async function deleteSolve(id) {
    showConfirmModal({
        title: 'Delete Solve',
        message: 'Remove this recorded solve from your personal history?',
        confirmText: 'Delete',
        confirmIcon: '🗑️',
        danger: true,
        onConfirm: async () => {
            try {
                const res = await apiPost(`/rubiks/api/solves/delete/${id}`);
                if (res && res.success) {
                    RUBIKS_STATE.solves = res.solves || [];
                    renderSolveDashboard();
                }
            } catch (err) {
                console.error('Rubiks solve delete failed:', err);
                showToast('Delete failed. Please try again.', 'error');
            }
        }
    });
}

/**
 * Reassigns a solve's cube type (3x3 ↔ 4x4) via a confirmation dialog.
 * The confirmation dialog has no cancel button — only a confirm action.
 * @param {number} id - Solve ID.
 * @param {string} currentType - Current cube type ("3x3" or "4x4").
 * @returns {void}
 */
function reassignSolveCubeType(id, currentType) {
    const targetType = currentType === '3x3' ? '4x4' : '3x3';

    showConfirmModal({
        title: 'Change Cube Type',
        message: `Change this solve from ${currentType} to ${targetType}?`,
        icon: '🔄',
        confirmText: `Change to ${targetType}`,
        confirmIcon: '🔄',
        hideCancel: true,
        onConfirm: async () => {
            try {
                const res = await apiPost(`/rubiks/api/solves/reassign/${id}`);
                if (res && res.success) {
                    RUBIKS_STATE.solves = res.solves || [];
                    renderSolveDashboard();
                } else {
                    showToast(res?.error || 'Reassign failed. Please try again.', 'error');
                }
            } catch (err) {
                console.error('Rubiks solve reassign failed:', err);
                showToast('Reassign failed. Please try again.', 'error');
            }
        }
    });
}

/**
 * Renders all stopwatch analytics and history.
 * @param {number|null} latestDuration - Latest solve duration in ms.
 * @param {string|null} latestCube - Latest solve cube type.
 * @returns {void}
 */
function renderSolveDashboard(latestDuration = null, latestCube = null) {
    const solves = filteredSolves();
    const historySolves = timerCubeSolves();
    const chronological = solves.slice().reverse();
    const stats = computeSolveStats(chronological);

    renderStatsGrid(stats);
    renderSolveHistory(historySolves);
    renderSessionSummary(stats, latestDuration, latestCube);
    renderLineChart('solve-trend-chart', chronological.slice(-30).map((s, i) => ({
        label: `#${chronological.length - Math.min(30, chronological.length) + i + 1}`,
        value: s.duration_ms
    })), 'Solve time');
    renderLineChart('average-trend-chart', rollingAverageSeries(chronological, 5), 'Ao5');
    loadLeaderboard();

    const count = document.getElementById('solve-count');
    if (count) count.textContent = `${historySolves.length} ${RUBIKS_STATE.timerCubeType} solve${historySolves.length === 1 ? '' : 's'}`;

}

/**
 * Returns solve records matching the active timer cube selection.
 * @returns {Array<Object>}
 */
function timerCubeSolves() {
    return RUBIKS_STATE.solves.filter(s => s.cube_type === RUBIKS_STATE.timerCubeType);
}

/**
 * Returns solve records matching the active statistics filter.
 * @returns {Array<Object>}
 */
function filteredSolves() {
    if (RUBIKS_STATE.statsCubeFilter === 'all') return RUBIKS_STATE.solves.slice();
    return RUBIKS_STATE.solves.filter(s => s.cube_type === RUBIKS_STATE.statsCubeFilter);
}

/**
 * Computes detailed solve statistics for chronological solves.
 * @param {Array<Object>} solves - Oldest to newest solve records.
 * @returns {Object}
 */
function computeSolveStats(solves) {
    const durations = solves.map(s => Number(s.duration_ms)).filter(ms => ms > 0);
    const sorted = durations.slice().sort((a, b) => a - b);
    const total = durations.reduce((sum, ms) => sum + ms, 0);
    const avg = durations.length ? total / durations.length : 0;
    const variance = durations.length ? durations.reduce((sum, ms) => sum + Math.pow(ms - avg, 2), 0) / durations.length : 0;
    const last = durations[durations.length - 1] || 0;
    const previous = durations[durations.length - 2] || 0;

    return {
        count: durations.length,
        best: sorted[0] || 0,
        worst: sorted[sorted.length - 1] || 0,
        average: avg,
        median: median(sorted),
        stddev: Math.sqrt(variance),
        latest: last,
        delta: previous ? last - previous : 0,
        ao5: averageOfLast(durations, 5),
        ao12: averageOfLast(durations, 12),
        ao50: averageOfLast(durations, 50),
        today: countSince(solves, 1),
        week: countSince(solves, 7),
        month: countSince(solves, 30)
    };
}

/**
 * Renders statistics cards.
 * @param {Object} stats - Computed statistics object.
 * @returns {void}
 */
function renderStatsGrid(stats) {
    const grid = document.getElementById('stats-grid');
    if (!grid) return;

    const cards = [
        ['Solves', stats.count, 'Total in filter'],
        ['Best', formatStatTime(stats.best), 'Fastest solve'],
        ['Average', formatStatTime(stats.average), 'Mean solve time'],
        ['Median', formatStatTime(stats.median), 'Middle solve'],
        ['Ao5', formatStatTime(stats.ao5), 'Average of last 5'],
        ['Ao12', formatStatTime(stats.ao12), 'Average of last 12'],
        ['Ao50', formatStatTime(stats.ao50), 'Average of last 50'],
        ['Worst', formatStatTime(stats.worst), 'Slowest solve'],
        ['Std Dev', formatStatTime(stats.stddev), 'Consistency spread'],
        ['Today', stats.today, 'Solves today'],
        ['7 Days', stats.week, 'Recent volume'],
        ['30 Days', stats.month, 'Monthly volume']
    ];

    grid.innerHTML = cards.map(([label, value, hint]) => `
        <div class="stat-tile">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(String(value))}</strong>
            <small>${escapeHtml(hint)}</small>
        </div>
    `).join('');
}

/**
 * Renders the latest solve/session summary.
 * @param {Object} stats - Computed statistics object.
 * @param {number|null} latestDuration - Latest duration in ms.
 * @param {string|null} latestCube - Latest cube type.
 * @returns {void}
 */
function renderSessionSummary(stats, latestDuration, latestCube) {
    const el = document.getElementById('latest-session-summary');
    if (!el) return;

    if (!stats.count) {
        el.innerHTML = '<p>Record a solve to unlock session stats, averages, streaks, and trend graphs.</p>';
        return;
    }

    const latest = latestDuration || stats.latest;
    const trend = stats.delta < 0 ? `${formatSolveTime(Math.abs(stats.delta))} faster than previous` :
        stats.delta > 0 ? `${formatSolveTime(stats.delta)} slower than previous` : 'No previous solve delta yet';
    el.innerHTML = `
        <div class="summary-main">
            <span>Latest ${escapeHtml(latestCube || RUBIKS_STATE.statsCubeFilter)}</span>
            <strong>${formatSolveTime(latest)}</strong>
        </div>
        <div class="summary-details">
            <span>${escapeHtml(trend)}</span>
            <span>Best: ${formatStatTime(stats.best)}</span>
            <span>Ao5: ${formatStatTime(stats.ao5)}</span>
        </div>
    `;
}

/**
 * Renders solve history with delete controls.
 * @param {Array<Object>} solves - Newest-first solve records.
 * @returns {void}
 */
function renderSolveHistory(solves) {
    const history = document.getElementById('solve-history');
    if (!history) return;

    if (solves.length === 0) {
        history.innerHTML = `<p class="empty-hint">No ${RUBIKS_STATE.timerCubeType} solves recorded yet.</p>`;
        return;
    }

    history.innerHTML = solves.slice(0, 5).map((solve, idx) => `
        <div class="solve-row">
            <div>
                <span class="badge-small">${escapeHtml(solve.cube_type)}</span>
                <strong>${formatSolveTime(solve.duration_ms)}</strong>
                <small>${formatDateTime(solve.solved_at)}</small>
            </div>
            <div class="solve-row-actions">
                <span>#${solves.length - idx}</span>
                <button type="button" class="btn-icon-edit" onclick="reassignSolveCubeType(${solve.id}, '${escapeHtml(solve.cube_type)}')" title="Change cube type">🔄</button>
                <button type="button" class="btn-icon-delete" onclick="deleteSolve(${solve.id})" title="Delete Solve">🗑️</button>
            </div>
        </div>
    `).join('');
}

/**
 * Fetches and renders the global top 5 leaderboard.
 */
async function loadLeaderboard() {
    const container = document.getElementById('leaderboard-container');
    const caption = document.getElementById('leaderboard-caption');
    if (!container) return;

    if (caption) caption.textContent = `Top 5 Absolute Bests (${RUBIKS_STATE.timerCubeType})`;

    try {
        const res = await apiGet(`/rubiks/api/solves/top/${RUBIKS_STATE.timerCubeType}`);
        if (res && res.success) {
            renderLeaderboard(res.top);
        }
    } catch (err) {
        console.error('Rubiks: Failed to load leaderboard', err);
        container.innerHTML = '<div class="empty-state">Leaderboard unavailable</div>';
    }
}

/**
 * Builds the HTML table for the global leaderboard.
 * @param {Array<Object>} top - List of top 5 solve records.
 */
function renderLeaderboard(top) {
    const container = document.getElementById('leaderboard-container');
    if (!container) return;

    if (!top || top.length === 0) {
        container.innerHTML = '<div class="empty-state">No global records yet</div>';
        return;
    }

    const medals = ['🥇', '🥈', '🥉', '4', '5'];
    
    let html = `
        <table class="leaderboard-table">
            <thead>
                <tr>
                    <th>Rank</th>
                    <th>User</th>
                    <th>Time</th>
                    <th class="text-right">When</th>
                </tr>
            </thead>
            <tbody>
    `;

    html += top.map((s, i) => `
        <tr>
            <td class="rank-cell">${medals[i]}</td>
            <td class="user-cell">
                <span class="user-icon">${window.getUserIcon ? window.getUserIcon(s.username) : '👤'}</span>
                <span class="username">${s.username}</span>
            </td>
            <td class="time-cell font-mono">${formatSolveTime(s.duration_ms)}</td>
            <td class="when-cell text-right text-xs text-slate-500">${window.getTimeSince ? window.getTimeSince(s.unix_time) : ''}</td>
        </tr>
    `).join('');

    html += '</tbody></table>';
    container.innerHTML = html;
}

/**
 * Renders a compact SVG line chart.
 * @param {string} id - Chart container element ID.
 * @param {Array<{label:string,value:number}>} points - Chart points.
 * @param {string} title - Accessible chart title.
 * @returns {void}
 */
function renderLineChart(id, points, title) {
    const el = document.getElementById(id);
    if (!el) return;

    const valid = points.filter(p => Number(p.value) > 0);
    if (valid.length < 2) {
        el.innerHTML = '<p class="empty-hint">More solves needed for this graph.</p>';
        return;
    }

    const width = 680, height = 220, pad = 28;
    const values = valid.map(p => p.value);
    const min = Math.min(...values), max = Math.max(...values);
    const range = Math.max(max - min, 1);
    const xStep = (width - pad * 2) / Math.max(valid.length - 1, 1);
    const coords = valid.map((p, i) => {
        const x = pad + (i * xStep);
        const y = height - pad - (((p.value - min) / range) * (height - pad * 2));
        return { x, y, value: p.value, label: p.label };
    });
    const path = coords.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const circles = coords.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4"><title>${escapeHtml(p.label)}: ${formatSolveTime(p.value)}</title></circle>`).join('');

    el.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
            <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" class="chart-axis"></line>
            <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" class="chart-axis"></line>
            <text x="${pad}" y="18" class="chart-label">${formatSolveTime(max)}</text>
            <text x="${pad}" y="${height - 6}" class="chart-label">${formatSolveTime(min)}</text>
            <path d="${path}" class="chart-line"></path>
            <g class="chart-points">${circles}</g>
        </svg>
    `;
}

/**
 * Builds a rolling average chart series.
 * @param {Array<Object>} solves - Oldest to newest solve records.
 * @param {number} size - Window size.
 * @returns {Array<{label:string,value:number}>}
 */
function rollingAverageSeries(solves, size) {
    const durations = solves.map(s => Number(s.duration_ms)).filter(ms => ms > 0);
    return durations.map((_, i) => {
        if (i + 1 < size) return null;
        const window = durations.slice(i + 1 - size, i + 1);
        return { label: `#${i + 1}`, value: window.reduce((a, b) => a + b, 0) / size };
    }).filter(Boolean).slice(-30);
}

/**
 * Average of the last N durations.
 * @param {Array<number>} durations - Oldest to newest durations.
 * @param {number} size - Number of solves.
 * @returns {number}
 */
function averageOfLast(durations, size) {
    if (durations.length < size) return 0;
    const last = durations.slice(-size);
    return last.reduce((sum, ms) => sum + ms, 0) / last.length;
}

/**
 * Median for a sorted duration array.
 * @param {Array<number>} sorted - Ascending durations.
 * @returns {number}
 */
function median(sorted) {
    if (!sorted.length) return 0;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Counts solves since N days ago.
 * @param {Array<Object>} solves - Solve records.
 * @param {number} days - Lookback in days.
 * @returns {number}
 */
function countSince(solves, days) {
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    return solves.filter(s => new Date(s.solved_at).getTime() >= cutoff).length;
}

/**
 * Formats a solve duration.
 * @param {number} ms - Duration in milliseconds.
 * @returns {string}
 */
function formatSolveTime(ms) {
    ms = Math.max(0, Math.round(Number(ms) || 0));
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const millis = ms % 1000;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/**
 * Formats a stat time or dash for missing values.
 * @param {number} ms - Duration in milliseconds.
 * @returns {string}
 */
function formatStatTime(ms) {
    return ms > 0 ? formatSolveTime(ms) : '—';
}

/**
 * Formats a database datetime for display.
 * @param {string} value - SQL datetime string.
 * @returns {string}
 */
function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value || '';
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Opens the Rubik's solver upload modal.
 */
function openUploadModal() {
    const modal = document.getElementById('uploadModal');
    if (modal) modal.classList.add('show');
    document.body.classList.add('modal-open');
    resetUploadForm();
}

/**
 * Closes the Rubik's solver upload modal.
 */
function closeUploadModal() {
    const modal = document.getElementById('uploadModal');
    if (modal) modal.classList.remove('show');
    document.body.classList.remove('modal-open');
}

/**
 * Resets the upload form and previews.
 */
function resetUploadForm() {
    const form = document.getElementById('uploadForm');
    if (form) form.reset();
    RUBIKS_STATE.solverDimension = 'auto';
    ['image1', 'image2'].forEach(id => {
        RUBIKS_STATE.solverPreviews[id] = null;
        const input = document.getElementById(id);
        const preview = document.getElementById(`preview-${id}`);
        const placeholder = document.querySelector(`#slot-${id} .upload-placeholder`);
        if (input) input.value = '';
        if (preview) {
            preview.removeAttribute('src');
            preview.hidden = true;
        }
        if (placeholder) placeholder.hidden = false;
    });
    const btn = document.getElementById('uploadSubmitBtn');
    if (btn) btn.disabled = true;
}

/**
 * Opens the camera capture flow for a solver image.
 */
function openSolverFilePicker(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.click();
}

/**
 * Renders a local preview of the uploaded cube photo.
 */
function renderSolverPreview(inputId) {
    const input = document.getElementById(inputId);
    const preview = document.getElementById(`preview-${inputId}`);
    const placeholder = document.querySelector(`#slot-${inputId} .upload-placeholder`);
    if (!input || !input.files || !input.files[0] || !preview) return;

    const file = input.files[0];

    const reader = new FileReader();
    reader.onload = () => {
        RUBIKS_STATE.solverPreviews[inputId] = reader.result;
        preview.src = reader.result;
        preview.hidden = false;
        if (placeholder) placeholder.hidden = true;
    };
    reader.onerror = () => {
        showToast('Could not render photo preview. Try choosing the image again.', 'warning');
    };
    reader.readAsDataURL(file);

    const btn = document.getElementById('uploadSubmitBtn');
    if (btn) {
        btn.disabled = !(document.getElementById('image1').files.length && document.getElementById('image2').files.length);
    }
}

/**
 * Handles the dual-photo upload and AI analysis.
 */
async function handleSolverUpload(e) {
    e.preventDefault();
    const form = e.target;

    if (typeof showLoadingOverlay === 'function') {
        showLoadingOverlay('Analyzing Cube State...', 'AI is parsing stickers from your photos.');
    }

    try {
        const res = await apiPost('/rubiks/api/solver/upload', new FormData(form), 60000);
        if (res && res.success && res.state_string) {
            closeUploadModal();
            const detectedDimension = Number(res.dimension || RUBIKS_STATE.solverDimension || 3);
            RUBIKS_STATE.solverDimension = [3, 4].includes(detectedDimension) ? detectedDimension : 3;
            if (RUBIKS_STATE.solverDimension === 3) {
                if ((res.missing_count || 0) > 0 || res.state_string.includes('?')) {
                    showManualStateEditor(res.state_string, res.notes);
                    showToast(`Captured partial state. Fill ${res.missing_count || 0} unknown sticker${(res.missing_count || 0) === 1 ? '' : 's'}.`, 'info');
                } else {
                    computeLocalSolution(res.state_string);
                }
            } else {
                if ((res.missing_count || 0) > 0 || res.state_string.includes('?')) {
                    showManualStateEditor(res.state_string, res.notes || '4x4 state extracted. Fill unknown stickers to review the captured state.');
                    showToast(`4x4 partial state captured. Fill ${res.missing_count || 0} unknown sticker${(res.missing_count || 0) === 1 ? '' : 's'}.`, 'info');
                } else {
                    showToast('4x4 State Extracted! Rigorous 4x4 algorithmic solving is under development.', 'info');
                    display4x4State(res.state_string);
                }
            }
        } else {
            showToast(res?.error || 'Vision analysis failed. Ensure photos are clear.', 'error');
        }
    } catch (err) {
        console.error('Rubiks solver upload failed:', err);
        showToast('Server error during analysis.', 'error');
    } finally {
        if (typeof hideLoadingOverlay === 'function') hideLoadingOverlay();
    }
}

/**
 * Runs the local Kociemba solver library on the state string returned by AI.
 */
async function computeLocalSolution(stateString) {
    const display = document.getElementById('solve-sequence');
    const card = document.getElementById('solution-card');
    const count = document.getElementById('move-count');

    if (!display || !card || !count) return;

    try {
        const solver = getRubiksSolver();
        if (!solver) {
            showManualStateEditor(
                stateString,
                'Captured state is saved below, but the solver library is not ready. Review the stickers and press Solve Reviewed State again.'
            );
            showToast('Solver library is still loading. Your captured state is still available below.', 'warning');
            return;
        }

        const solution = await solver(stateString);

        if (!solution || String(solution).includes('Error')) {
            showToast('Invalid cube state detected. Please try clearer photos.', 'warning');
            showManualStateEditor(stateString, 'The solver rejected this state. Review the extracted stickers and correct any mistakes.');
            return;
        }

        display.textContent = String(solution);
        count.textContent = `${String(solution).trim().split(/\s+/).length} moves`;
        card.style.display = 'block';
        const editor = document.getElementById('state-editor-card');
        if (editor) editor.style.display = 'none';
        showToast('Solution found!', 'success');

        RUBIKS_STATE.sequence = String(solution);
        RUBIKS_STATE.initialSolverState = stateString;

        // Trigger the graphical SVG diagram generation with state simulation
        if (typeof generateDiagram === 'function') {
            generateStatefulDiagram(stateString, String(solution));
        }
    } catch (err) {
        console.error('Local solve failed:', err);
        showManualStateEditor(stateString, 'The solver failed while using this state. Review the stickers and try again.');
        showToast('Mathematical solve failed. The captured state is still available below.', 'error');
    }
}

/**
 * Returns the available Rubik's solver function, accounting for common min2phase globals.
 */
function getRubiksSolver() {
    if (window.Search && typeof window.Search.solution === 'function') {
        return (state) => window.Search.solution(state);
    }
    if (window.min2phase && typeof window.min2phase.solve === 'function') {
        return (state) => window.min2phase.solve(state);
    }
    if (window.min2phase && typeof window.min2phase.Search === 'function') {
        return (state) => {
            const search = new window.min2phase.Search();
            return search.solution(state, 21, 100000000, 0, 0);
        };
    }
    return null;
}

/**
 * Shows an editable sticker grid for partial or rejected cube states.
 */
function showManualStateEditor(stateString, notes = '') {
    const card = document.getElementById('state-editor-card');
    const solutionCard = document.getElementById('solution-card');
    const notesEl = document.getElementById('state-editor-notes');
    if (!card) return;

    RUBIKS_STATE.reviewedSolverState = normalizeSolverState(stateString);
    if (solutionCard) solutionCard.style.display = 'none';
    if (notesEl) {
        notesEl.textContent = notes || 'Tap any sticker to cycle its face/color. Unknown stickers are marked with ?.';
    }
    renderStateEditor();
    card.style.display = 'block';
}

/**
 * Normalizes a lossy Kociemba state string for the manual editor.
 */
function normalizeSolverState(stateString) {
    const needed = RUBIKS_STATE.solverDimension * RUBIKS_STATE.solverDimension * 6;
    const clean = String(stateString || '').toUpperCase().replace(/[^URFDLB?]/g, '?');
    return (clean + '?'.repeat(needed)).slice(0, needed);
}

/**
 * Renders the editable cube state grid.
 */
function renderStateEditor() {
    const grid = document.getElementById('state-editor-grid');
    if (!grid) return;

    const dim = RUBIKS_STATE.solverDimension;
    const faceSize = dim * dim;
    const faces = ['U', 'R', 'F', 'D', 'L', 'B'];

    grid.innerHTML = faces.map((face, faceIndex) => {
        const cells = Array.from({ length: faceSize }, (_, offset) => {
            const index = faceIndex * faceSize + offset;
            const value = RUBIKS_STATE.reviewedSolverState[index] || '?';
            const className = value === '?' ? 'state-unknown' : `state-${value}`;
            return `<button type="button" class="state-cell ${className}" onclick="cycleSolverSticker(${index})">${value}</button>`;
        }).join('');
        return `
            <div class="state-face">
                <div class="state-face-label">${face}</div>
                <div class="state-face-grid" style="grid-template-columns: repeat(${dim}, 1fr);">${cells}</div>
            </div>
        `;
    }).join('');
}

/**
 * Cycles one sticker through unknown and face values.
 */
function cycleSolverSticker(index) {
    const choices = ['?', 'U', 'R', 'F', 'D', 'L', 'B'];
    const state = RUBIKS_STATE.reviewedSolverState.split('');
    const current = state[index] || '?';
    state[index] = choices[(choices.indexOf(current) + 1) % choices.length];
    RUBIKS_STATE.reviewedSolverState = state.join('');
    renderStateEditor();
}

/**
 * Attempts to solve the manually reviewed state.
 */
function solveReviewedState() {
    const state = RUBIKS_STATE.reviewedSolverState;
    const missing = (state.match(/\?/g) || []).length;
    if (missing > 0) {
        showToast(`Fill ${missing} unknown sticker${missing === 1 ? '' : 's'} before solving.`, 'warning');
        return;
    }
    const invalidFace = ['U', 'R', 'F', 'D', 'L', 'B'].find(face => (state.match(new RegExp(face, 'g')) || []).length !== 9);
    if (RUBIKS_STATE.solverDimension === 3 && invalidFace) {
        showToast('A 3x3 cube needs exactly 9 stickers for each face/color.', 'warning');
        return;
    }
    computeLocalSolution(state);
}

/**
 * Generates move SVGs where each move shows the actual resulting colors.
 */
function generateStatefulDiagram(initialState, sequence) {
    const container = document.getElementById('cube-diagram-container');
    if (!container) return;

    const moves = parseNotation(sequence);
    const cube = new RubiksCube(initialState);

    const gallery = document.createElement('div');
    gallery.className = 'diagram-gallery';

    moves.forEach((move) => {
        cube.move(move);
        // For the solver, we show the Front face colors
        const colors = cube.getFaceColors('F');

        const moveCard = document.createElement('div');
        moveCard.className = 'move-card';
        moveCard.innerHTML = renderMoveSVG(move, colors);

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
 * Transfers the found solution to the main generator page.
 */
function loadSolutionToGenerator() {
    sessionStorage.setItem('rubiks_imported_sequence', RUBIKS_STATE.sequence);
    window.location.href = '/rubiks/generator';
}

/**
 * Hides the solution card and resets state.
 */
function resetSolverUI() {
    const card = document.getElementById('solution-card');
    const editor = document.getElementById('state-editor-card');
    if (card) card.style.display = 'none';
    if (editor) editor.style.display = 'none';
    RUBIKS_STATE.reviewedSolverState = '';
}

/**
 * Displays the static 4x4 state if algorithmic solve is not available.
 */
function display4x4State(stateString) {
    const container = document.getElementById('cube-diagram-container');
    const card = document.getElementById('solution-card');
    const display = document.getElementById('solve-sequence');

    if (!container || !card || !display) return;

    display.textContent = "4x4 STATE EXTRACTED";
    card.style.display = 'block';

    RUBIKS_STATE.cubeSize = 4;
    const cube = new RubiksCube(stateString, 4);
    const colors = cube.getFaceColors('F');

    container.innerHTML = `<div class="diagram-gallery"><div class="move-card">${renderMoveSVG({ face: 'F', count: 0 }, colors)}</div></div>`;
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
window.setTimerCubeType = setTimerCubeType;
window.startSolveTimer = startSolveTimer;
window.stopSolveTimer = stopSolveTimer;
window.setStatsCubeFilter = setStatsCubeFilter;
window.deleteSolve = deleteSolve;
window.reassignSolveCubeType = reassignSolveCubeType;
window.openUploadModal = openUploadModal;
window.closeUploadModal = closeUploadModal;
window.openSolverFilePicker = openSolverFilePicker;
window.renderSolverPreview = renderSolverPreview;
window.handleSolverUpload = handleSolverUpload;
window.loadSolutionToGenerator = loadSolutionToGenerator;
window.resetSolverUI = resetSolverUI;
window.display4x4State = display4x4State;
window.cycleSolverSticker = cycleSolverSticker;
window.solveReviewedState = solveReviewedState;
