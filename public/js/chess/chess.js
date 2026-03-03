// /public/js/chess/chess.js

/**
 * Chess Game Controller Module
 * 
 * This module manages the real-time multiplayer Chess engine. It coordinates 
 * the interaction between the chess.js logic engine, board rendering, 
 * and server-side state synchronization.
 * 
 * Features:
 * - Real-time board synchronization using FEN (Forsyth-Edwards Notation)
 * - Move validation and legal move highlighting via chess.js
 * - Perspective flipping based on player role (White vs. Black)
 * - Synthesized audio feedback for moves, captures, and check alerts
 * - Integrated draw negotiation and resignation workflows
 * - Custom pawn promotion interface with modal resolution
 * - Automated 2-second polling for asynchronous opponent moves
 * 
 * Dependencies:
 * - chess.js: Core logic engine for move validation and state tracking
 * - default.js: For getIcon and platform theme consistency
 */

document.addEventListener('DOMContentLoaded', () => {
    /**
     * Initialization System
     * Resolves game configuration from the server-rendered DOM.
     */
    const boardElement = document.getElementById('chess-board');
    if (!boardElement) return;

    // Context: resolve game identifiers and participant roles
    const gameId = boardElement.dataset.gameId;
    const initialFen = boardElement.dataset.fen;
    let currentTurnId = parseInt(boardElement.dataset.turn, 10) || 0;
    let p1Id = parseInt(boardElement.dataset.p1, 10) || 0; 
    let p2Id = parseInt(boardElement.dataset.p2, 10) || 0; 
    const currentUserId = parseInt(boardElement.dataset.userId, 10) || 0;
    let gameStatus = boardElement.dataset.status;

    // Logic: bootstrap the chess.js engine with the server source-of-truth
    const game = new Chess(initialFen);
    
    /**
     * Interaction State
     */
    let selectedSquare = null;      // Currently active selection (e.g., 'e2')
    let validMoves = [];            // Cached legal move list for highlighting
    let currentFen = initialFen;    // Local FEN pointer for diffing
    let drawOfferByMe = false;      // Outbound draw request tracker
    let serverLastMove = null;      // Last executed move string (e.g., 'e2-e4')
    let isInteracting = false;      // Modal/UI lock to prevent polling jitters
    let pollInterval = null;        // Sync service reference

    /**
     * Constant: Unicode Piece Map
     * Native symbols for high-performance piece rendering.
     */
    const pieceUnicode = {
        'p': '♟', 'n': '♞', 'b': '♝', 'r': '♜', 'q': '♛', 'k': '♚'
    };

    /**
     * --- Synthesized Audio Engine ---
     * Uses Web Audio API to generate real-time feedback tones.
     */
    let audioCtx = null;
    const AudioEngine = (() => {
        /**
         * Resolves or initializes the global AudioContext.
         * 
         * @returns {AudioContext}
         */
        function getCtx() {
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
            return audioCtx;
        }
        
        /**
         * Generates a precise oscillator tone.
         * 
         * @private
         */
        function playTone(freq, type, duration, volume = 0.1) {
            try {
                const ctx = getCtx();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = type;
                osc.frequency.setValueAtTime(freq, ctx.currentTime);
                gain.gain.setValueAtTime(volume, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start();
                osc.stop(ctx.currentTime + duration);
            } catch (e) {
                console.warn("AudioEngine failure:", e);
            }
        }

        return {
            move: () => playTone(600, 'sine', 0.1),
            capture: () => {
                playTone(400, 'square', 0.05, 0.05);
                setTimeout(() => playTone(300, 'square', 0.1, 0.05), 50);
            },
            check: () => {
                playTone(800, 'sawtooth', 0.1, 0.05);
                setTimeout(() => playTone(800, 'sawtooth', 0.1, 0.05), 150);
            },
            gameOver: () => {
                playTone(400, 'sine', 0.5);
                setTimeout(() => playTone(300, 'sine', 0.5), 200);
                setTimeout(() => playTone(200, 'sine', 0.8), 400);
            }
        };
    })();

    /**
     * --- UI Rendering Engine ---
     */

    /**
     * Logic: renderBoard
     * Generates the 8x8 grid based on the internal engine state.
     * Implements perspective flipping for the Black player (P2).
     */
    function renderBoard() {
        // Lifecycle: inhibit during active modal interactions
        if (isInteracting) return;
        
        boardElement.innerHTML = '';
        const boardState = game.board();
        const isBlackPerspective = (currentUserId === p2Id);

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                // Resolution: map loop coordinates to correct perspective
                const row = isBlackPerspective ? (7 - r) : r;
                const col = isBlackPerspective ? (7 - c) : c;

                const squareDiv = document.createElement('div');
                squareDiv.classList.add('square');
                const isDark = (row + col) % 2 !== 0;
                if (isDark) squareDiv.classList.add('dark');

                const file = String.fromCharCode(97 + col);
                const rank = 8 - row;
                const squareName = `${file}${rank}`;
                squareDiv.dataset.square = squareName;

                const piece = boardState[row][col];
                if (piece) {
                    const pieceSpan = document.createElement('span');
                    pieceSpan.classList.add('piece');
                    pieceSpan.classList.add(piece.color === 'w' ? 'white-piece' : 'black-piece');
                    pieceSpan.textContent = pieceUnicode[piece.type];
                    squareDiv.appendChild(pieceSpan);
                }

                squareDiv.addEventListener('click', () => handleSquareClick(squareName));
                boardElement.appendChild(squareDiv);
            }
        }
        updateHighlights();
    }

    /**
     * UI Logic: updateHighlights
     * Applies CSS states for selection, legal targets, and last-move history.
     */
    function updateHighlights() {
        const squares = boardElement.querySelectorAll('.square');
        let lastMoveFrom = null, lastMoveTo = null;

        if (serverLastMove && serverLastMove.includes('-')) {
            [lastMoveFrom, lastMoveTo] = serverLastMove.split('-');
        }

        squares.forEach(sq => {
            sq.classList.remove('selected', 'valid-move', 'last-move', 'in-check');
            // Apply contextual classes based on active selection and history
            if (sq.dataset.square === selectedSquare) sq.classList.add('selected');
            if (validMoves.some(m => m.to === sq.dataset.square)) sq.classList.add('valid-move');
            if (sq.dataset.square === lastMoveFrom || sq.dataset.square === lastMoveTo) {
                sq.classList.add('last-move');
            }
        });

        // Scenario: King in Check
        if (game.in_check()) {
            const board = game.board();
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    const p = board[r][c];
                    // Visual: highlight the king currently under attack
                    if (p && p.type === 'k' && p.color === game.turn()) {
                        const sqName = String.fromCharCode(97 + c) + (8 - r);
                        const sqEl = boardElement.querySelector(`[data-square="${sqName}"]`);
                        if (sqEl) sqEl.classList.add('in-check');
                    }
                }
            }
        }
    }

    /**
     * --- Move Logic ---
     */

    /**
     * Action: handleSquareClick
     * Orchestrates piece selection and move execution.
     * 
     * @param {string} squareName - Coordinates (e.g., 'e4')
     */
    async function handleSquareClick(squareName) {
        // Gate: enforce turn and game status
        if (currentTurnId !== currentUserId || gameStatus !== 'active') return;

        const moveAttempt = validMoves.find(m => m.to === squareName);

        if (moveAttempt) {
            // Execution: valid target selected
            const piece = game.get(selectedSquare);
            const isPawn = piece && piece.type === 'p';
            const isPromotionRank = (piece.color === 'w' && squareName[1] === '8') || 
                                    (piece.color === 'b' && squareName[1] === '1');
            
            let promotionPiece = 'q';
            if (isPawn && isPromotionRank) {
                // Workflow: resolution of pawn promotion via custom modal
                promotionPiece = await getPromotionPiece();
            }

            const moveResult = game.move({
                from: selectedSquare,
                to: squareName,
                promotion: promotionPiece 
            });

            serverLastMove = `${selectedSquare}-${squareName}`;
            selectedSquare = null;
            validMoves = [];
            renderBoard();
            
            // Audio Logic: resolve sound based on move complexity
            if (game.in_check()) AudioEngine.check();
            else if (moveResult.captured) AudioEngine.capture();
            else AudioEngine.move();
            
            // Transmission: sync move with server
            submitMove();
        } else {
            // Selection: user clicking a piece
            const piece = game.get(squareName);
            const playerColor = currentUserId === p1Id ? 'w' : 'b';

            if (piece && piece.color === playerColor) {
                // Logic: cache legal moves for highlighting
                selectedSquare = squareName;
                validMoves = game.moves({ square: squareName, verbose: true });
            } else {
                selectedSquare = null;
                validMoves = [];
            }
            updateHighlights();
        }
    }

    /**
     * --- Specialized Modals ---
     */
    const modal = document.getElementById('game-modal');
    const modalMsg = document.getElementById('modal-message');
    const okBtn = document.getElementById('modal-ok-btn');
    const confirmBtn = document.getElementById('modal-confirm-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');

    /**
     * Prompts the user with a specialized pawn promotion interface.
     * 
     * @returns {Promise<string>} - The chosen piece key ('q', 'r', 'b', 'n')
     */
    function getPromotionPiece() {
        const promoModal = document.getElementById('promotion-modal');
        if (!promoModal) return Promise.resolve('q');

        isInteracting = true;
        return new Promise((resolve) => {
            promoModal.style.display = 'flex';
            const buttons = promoModal.querySelectorAll('.promo-btn');
            buttons.forEach(btn => {
                btn.onclick = () => {
                    const piece = btn.dataset.piece;
                    promoModal.style.display = 'none';
                    isInteracting = false;
                    resolve(piece);
                };
            });
        });
    }

    /**
     * Displays a themed alert.
     */
    function customAlert(message) {
        isInteracting = true;
        return new Promise((resolve) => {
            modalMsg.textContent = message;
            confirmBtn.style.display = 'none';
            cancelBtn.style.display = 'none';
            okBtn.style.display = 'inline-block';
            modal.style.display = 'flex';
            okBtn.onclick = () => { modal.style.display = 'none'; isInteracting = false; resolve(); };
        });
    }

    /**
     * Displays a themed confirmation dialog.
     */
    function customConfirm(message) {
        isInteracting = true;
        return new Promise((resolve) => {
            modalMsg.textContent = message;
            confirmBtn.style.display = 'inline-block';
            cancelBtn.style.display = 'inline-block';
            okBtn.style.display = 'none';
            modal.style.display = 'flex';
            confirmBtn.onclick = () => { modal.style.display = 'none'; isInteracting = false; resolve(true); };
            cancelBtn.onclick = () => { modal.style.display = 'none'; isInteracting = false; resolve(false); };
        });
    }

    /**
     * --- API Interactions ---
     */

    /**
     * Transmits current board state and turn identifiers to the server.
     */
    function submitMove() {
        const newFen = game.fen();
        const nextTurnId = (currentUserId === p1Id) ? p2Id : p1Id;
        let newStatus = 'active', winnerId = null;

        // Logic: resolve game termination states
        if (game.game_over()) {
            newStatus = 'finished';
            winnerId = game.in_checkmate() ? currentUserId : 0;
        }

        currentFen = newFen;
        drawOfferByMe = false;

        submitMovePayload('/chess/move', {
            game_id: gameId, fen: newFen, next_turn_id: nextTurnId,
            status: newStatus, winner_id: winnerId, last_move: serverLastMove
        });
    }

    /**
     * Logic: submitMovePayload
     * Universal wrapper for Chess AJAX commands.
     * 
     * @param {string} endpoint - API Target
     * @param {Object} payload - Data
     */
    function submitMovePayload(endpoint, payload = {}) {
        fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) pollGameState();
            else {
                customAlert(data.error || 'Action failed');
                pollGameState(); 
            }
        })
        .catch(err => console.error('submitMovePayload failure:', err));
    }

    /**
     * Logic: pollGameState
     * Checks server for opponent moves or game status changes.
     * Implements move-aware audio alerts.
     */
    function pollGameState() {
        // Lifecycle: Inhibit if user is interacting with modals or game is over
        if (isInteracting || gameStatus === 'finished') return;

        fetch(`/chess/status/${gameId}`)
        .then(res => res.json())
        .then(data => {
            if (data.error || isInteracting) return;

            // Scenario: Opponent has made a move
            if (data.fen !== currentFen) {
                const oldFen = currentFen;
                currentFen = data.fen;
                serverLastMove = data.last_move;
                
                const getPieceCount = (f) => f.split(' ')[0].replace(/[^a-zA-Z]/g, '').length;
                const wasCapture = getPieceCount(data.fen) < getPieceCount(oldFen);

                game.load(data.fen);
                renderBoard();
                
                // Alert: only sound if it's now our turn
                if (data.turn === currentUserId) {
                    if (game.in_check()) AudioEngine.check();
                    else if (wasCapture) AudioEngine.capture();
                    else AudioEngine.move();
                }
            }

            currentTurnId = parseInt(data.turn, 10);
            p1Id = parseInt(data.p1_id, 10) || p1Id;
            p2Id = parseInt(data.p2_id, 10) || p2Id;

            // UI: Sync control visibility for players vs spectators
            if (currentUserId === p1Id || currentUserId === p2Id) {
                const offerBtn = document.getElementById('offerDrawBtn');
                const resignBtn = document.getElementById('resignBtn');
                if (gameStatus === 'active') {
                    if (offerBtn) offerBtn.style.display = 'inline-block';
                    if (resignBtn) resignBtn.style.display = 'inline-block';
                }
            }

            const oldStatus = gameStatus;
            gameStatus = data.status;

            // Lifecycle: Termination detection
            if (gameStatus === 'finished') {
                if (oldStatus === 'active') AudioEngine.gameOver();
                if (pollInterval) clearInterval(pollInterval);
                
                const statusText = document.getElementById('game-status-text');
                const winnerId = parseInt(data.winner_id, 10);
                
                if (winnerId === 0) {
                    if (drawOfferByMe) { customAlert('Your draw offer was accepted.'); drawOfferByMe = false; }
                    statusText.textContent = `${getIcon('draw')} Game Over - Draw`;
                } else {
                    const isMeWinner = (winnerId === currentUserId);
                    // UI: Manage victory alerts if not already shown
                    if (statusText.textContent.indexOf("Game Over") === -1) {
                        if (isMeWinner) {
                            if (game.in_checkmate()) customAlert("Checkmate. You win!");
                            else customAlert("Opponent resigned. You win!");
                        } else {
                            if (game.in_checkmate()) customAlert("Checkmate. You lost.");
                            else customAlert("Game over. You lost.");
                        }
                    }
                    statusText.textContent = isMeWinner ? `${getIcon('trophy')} Game Over - You Win!` : `Game Over - You Lost`;
                }
                
                // UI: hide game controls after resolution
                const offerBtn = document.getElementById('offerDrawBtn');
                const resignBtn = document.getElementById('resignBtn');
                if (offerBtn) offerBtn.style.display = 'none';
                if (resignBtn) resignBtn.style.display = 'none';
            } else {
                // UI: Update active turn indicators
                const statusText = document.getElementById('game-status-text');
                if (gameStatus === 'waiting') {
                    statusText.textContent = `${getIcon('waiting')} Waiting for opponent...`;
                } else {
                    statusText.textContent = currentTurnId === currentUserId ? `${getIcon('success')} Your Turn` : `${getIcon('error')} Opponent's Turn`;
                }
            }

            if (document.getElementById('fen-display')) {
                document.getElementById('fen-display').textContent = `Current FEN: ${currentFen}`;
            }

            // Logic: Draw Offer Management
            const overlay = document.getElementById('draw-offer-overlay');
            const offerBtn = document.getElementById('offerDrawBtn');
            if (data.draw_offered_by) {
                if (parseInt(data.draw_offered_by, 10) === currentUserId) {
                    if (offerBtn) { offerBtn.textContent = "⌛ Waiting..."; offerBtn.disabled = true; }
                    drawOfferByMe = true;
                } else if (overlay) {
                    overlay.style.display = 'flex';
                }
            } else {
                if (drawOfferByMe && gameStatus === 'active') {
                    drawOfferByMe = false;
                    customAlert('Draw offer was refused.');
                }
                if (overlay) overlay.style.display = 'none';
                if (gameStatus === 'active' && !drawOfferByMe && offerBtn) {
                    offerBtn.textContent = "Offer Draw";
                    offerBtn.disabled = false;
                }
            }
        });
    }

    // Lifecycle: Bootstrap sync loop (2s)
    pollInterval = setInterval(pollGameState, 2000);

    // Interaction: Resign button
    const resignBtn = document.getElementById('resignBtn');
    if (resignBtn) {
        resignBtn.addEventListener('click', async () => {
            if (gameStatus !== 'active') return;
            if (await customConfirm('Are you sure you want to resign?')) {
                const opponentId = currentUserId === p1Id ? p2Id : p1Id;
                submitMovePayload('/chess/move', {
                    game_id: gameId, fen: game.fen(), next_turn_id: 0, status: 'finished', winner_id: opponentId
                });
            }
        });
    }

    // Interaction: Draw Offer button
    const offerDrawBtn = document.getElementById('offerDrawBtn');
    if (offerDrawBtn) {
        offerDrawBtn.addEventListener('click', async () => {
            if (gameStatus !== 'active') return;
            if (await customConfirm('Offer a draw?')) {
                drawOfferByMe = true;
                submitMovePayload(`/chess/offer_draw/${gameId}`);
            }
        });
    }

    // Interaction: Draw response buttons
    const acceptDrawBtn = document.getElementById('acceptDrawBtn');
    if (acceptDrawBtn) acceptDrawBtn.addEventListener('click', () => submitMovePayload(`/chess/respond_draw/${gameId}?accept=1`));

    const refuseDrawBtn = document.getElementById('refuseDrawBtn');
    if (refuseDrawBtn) refuseDrawBtn.addEventListener('click', () => submitMovePayload(`/chess/respond_draw/${gameId}?accept=0`));

    // UI: Initial render
    renderBoard();
});
