// /public/js/chess.js

/**
 * Chess Controller Module
 * 
 * Manages the unified logic for the Chess module.
 * Incorporates routing, lobby synchronization, and real-time game engine execution.
 * 
 * Features:
 * - History API based view routing (Lobby vs Active Game)
 * - FEN-based board synchronization and legal move validation
 * - Web Audio API integration for move feedback
 * - Background state polling with interaction inhibition
 * 
 * Dependencies:
 * - chess.js: Logic engine
 * - default.js: Platform helpers
 */

/**
 * --- Module State & Config ---
 */
const CONFIG = {
    SYNC_LOBBY_MS: 2000,
    SYNC_GAME_MS: 2000
};

const PIECE_UNICODE = {
    'p': '♟', 'n': '♞', 'b': '♝', 'r': '♜', 'q': '♛', 'k': '♚'
};

let STATE = {
    userId: null,
    view: 'lobby',          // 'lobby' or 'game'
    activeGameId: null,
    isInteracting: false,
    pollInterval: null,
    
    // Game Specifics
    engine: null,
    currentFen: '',
    selectedSquare: null,
    validMoves: [],
    drawOfferByMe: false,
    serverLastMove: null,
    currentTurnId: 0,
    gameStatus: 'loading',
    p1Id: 0,
    p2Id: 0
};

/**
 * --- Synthesized Audio Engine ---
 */
const AudioEngine = (() => {
    let audioCtx = null;

    /**
     * Lazily initializes and returns the Web Audio Context.
     * @returns {AudioContext} - The active audio context.
     */
    function getCtx() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    }
    
    /**
     * Dispatches a specific synthesized tone to the hardware output.
     * @param {number} freq - Frequency in Hz.
     * @param {string} type - Oscillator type (sine, square, sawtooth, triangle).
     * @param {number} duration - Duration in seconds.
     * @param {number} volume - Initial gain level.
     * @returns {void}
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
        } catch (e) {}
    }

    return {
        /**
         * Plays the sound effect for a standard move.
         * @returns {void}
         */
        move: () => playTone(600, 'sine', 0.1),

        /**
         * Plays the sound effect for a piece capture.
         * @returns {void}
         */
        capture: () => {
            playTone(400, 'square', 0.05, 0.05);
            setTimeout(() => playTone(300, 'square', 0.1, 0.05), 50);
        },

        /**
         * Plays the sound effect for a king in check.
         * @returns {void}
         */
        check: () => {
            playTone(800, 'sawtooth', 0.1, 0.05);
            setTimeout(() => playTone(800, 'sawtooth', 0.1, 0.05), 150);
        },

        /**
         * Plays the sound sequence for a completed game.
         * @returns {void}
         */
        gameOver: () => {
            playTone(400, 'sine', 0.5);
            setTimeout(() => playTone(300, 'sine', 0.5), 200);
            setTimeout(() => playTone(200, 'sine', 0.8), 400);
        }
    };
})();

/**
 * --- Primary Controller ---
 */
const ChessApp = {
    /**
     * Initializes the Chess application.
     * Sets up state, event listeners, and resolves the initial route.
     * @returns {void}
     */
    init: function() {
        const appContainer = document.getElementById('chess-app');
        if (!appContainer) return;
        
        STATE.userId = parseInt(appContainer.dataset.userId, 10) || 0;
        
        // Setup global handlers
        this.setupEventListeners();
        
        // Initial route resolution
        this.resolveRoute(window.location.pathname);
        
        // History binding
        window.addEventListener('popstate', () => {
            this.resolveRoute(window.location.pathname);
        });
    },

    /**
     * Resolves the active view based on the URL path.
     * @param {string} path - The current window location path.
     * @returns {void}
     */
    resolveRoute: function(path) {
        if (STATE.pollInterval) clearInterval(STATE.pollInterval);
        
        const match = path.match(/\/chess\/play\/(\d+)/);
        if (match && match[1]) {
            this.showGame(match[1]);
        } else {
            this.showLobby();
        }
    },

    /**
     * Toggles visibility between the lobby and game DOM containers.
     * @param {string} viewName - The name of the view to activate ('lobby' or 'game').
     * @returns {void}
     */
    toggleView: function(viewName) {
        STATE.view = viewName;
        
        const lobby = document.getElementById('view-lobby');
        const game = document.getElementById('view-game');
        
        if (viewName === 'lobby') {
            lobby.classList.remove('hidden');
            lobby.classList.add('active');
            game.classList.remove('active');
            game.classList.add('hidden');
        } else {
            game.classList.remove('hidden');
            game.classList.add('active');
            lobby.classList.remove('active');
            lobby.classList.add('hidden');
        }
    },

    /**
     * Activates the lobby view and starts the polling interval.
     * @returns {void}
     */
    showLobby: function() {
        if (STATE.view !== 'lobby') {
            window.history.pushState({}, '', '/chess');
        }
        this.toggleView('lobby');
        this.pollLobby();
        STATE.pollInterval = setInterval(() => this.pollLobby(), CONFIG.SYNC_LOBBY_MS);
    },

    /**
     * Fetches the current lobby state from the API.
     * Inhibits polling during active user interaction.
     * @returns {Promise<void>}
     */
    pollLobby: async function() {
        if (STATE.isInteracting || STATE.view !== 'lobby') return;
        try {
            const response = await fetch('/chess/api/lobby');
            const data = await response.json();
            if (data.success) {
                this.renderLobby(data.open_games, data.user_games);
            }
        } catch (e) {
            console.error('Lobby poll failed', e);
        }
    },

    /**
     * Renders the lobby UI with open and user-specific games.
     * @param {Array} openGames - List of available game sessions.
     * @param {Array} userGames - List of games involving the current user.
     * @returns {void}
     */
    renderLobby: function(openGames, userGames) {
        const userList = document.getElementById('user-game-list');
        const userSection = document.getElementById('user-games-section');
        const openList = document.getElementById('open-game-list');

        if (!userGames || userGames.length === 0) {
            userSection.classList.add('hidden');
        } else {
            userSection.classList.remove('hidden');
            userList.innerHTML = userGames.map(g => `
                <div class="game-item user-game">
                    <div class="host-info">
                        <span class="host-name">${this.escapeHtml(g.p1_name)} vs ${this.escapeHtml(g.p2_name || '?')}</span>
                        <span class="game-time">Status: <span class="status-badge ${g.status}">${this.capitalize(g.status)}</span></span>
                    </div>
                    <button type="button" class="btn-join" onclick="ChessApp.showGame(${g.id})">Resume &rarr;</button>
                </div>
            `).join('');
        }

        if (!openGames || openGames.length === 0) {
            openList.innerHTML = '<div class="empty-state">No active games found.<br>Be the first to start one!</div>';
        } else {
            openList.innerHTML = openGames.map(g => `
                <div class="game-item">
                    <div class="host-info">
                        <span class="host-name">Host: ${this.escapeHtml(g.host_name)}</span>
                        <span class="game-time">Created: ${g.created_at}</span>
                    </div>
                    <button type="button" class="btn-join" onclick="ChessApp.joinGame(${g.id})">Join Game &rarr;</button>
                </div>
            `).join('');
        }
    },

    /**
     * Requests the creation of a new chess game session.
     * @returns {Promise<void>}
     */
    createGame: async function() {
        const result = await window.apiPost('/chess/api/create');
        if (result && result.success && result.game_id) {
            this.showGame(result.game_id);
        }
    },

    /**
     * Requests to join an existing game session.
     * @param {number|string} id - The unique identifier of the game.
     * @returns {Promise<void>}
     */
    joinGame: async function(id) {
        const result = await window.apiPost('/chess/api/join', { id });
        if (result && result.success) {
            STATE.p2Id = STATE.userId;
            this.showGame(id);
        }
    },

    /**
     * Activates the active game view and starts the game state polling interval.
     * @param {number|string} id - The unique identifier of the game.
     * @returns {Promise<void>}
     */
    showGame: async function(id) {
        if (window.location.pathname !== `/chess/play/${id}`) {
            window.history.pushState({}, '', `/chess/play/${id}`);
        }
        STATE.activeGameId = id;
        document.getElementById('game-title').textContent = `Chess - Game #${id}`;
        
        this.toggleView('game');
        
        // Initial Fetch
        const success = await this.pollGame(true);
        if (success) {
            STATE.pollInterval = setInterval(() => this.pollGame(), CONFIG.SYNC_GAME_MS);
        } else {
            this.showLobby();
            window.showToast("Could not load game.", "error");
        }
    },

    /**
     * Fetches the current game state from the API.
     * Synchronizes the internal logic engine and triggers board re-renders.
     * @param {boolean} force - Whether to bypass interaction inhibition.
     * @returns {Promise<boolean>} - Success status of the poll.
     */
    pollGame: async function(force = false) {
        // Network requests are suppressed if the user is currently interacting
        // or if the game view is not the active interface.
        if (!force && (STATE.isInteracting || STATE.view !== 'game')) return true;

        try {
            const response = await fetch(`/chess/api/game/${STATE.activeGameId}`);
            const data = await response.json();
            
            if (data.error) return false;
            
            const gameData = data.game;
            
            // Synchronize participant identities and turn sequence.
            STATE.p1Id = parseInt(gameData.player1_id, 10) || 0;
            STATE.p2Id = parseInt(gameData.player2_id, 10) || 0;
            STATE.currentTurnId = parseInt(gameData.current_turn, 10);

            // Reconcile the local engine with the server board state.
            if (!STATE.engine || force) {
                if (typeof Chess === 'undefined') return false;
                STATE.engine = new Chess(gameData.fen_state);
                STATE.currentFen = gameData.fen_state;
                STATE.serverLastMove = gameData.last_move;
                this.renderBoard();
            } else if (gameData.fen_state !== STATE.currentFen) {
                const oldFen = STATE.currentFen;
                STATE.currentFen = gameData.fen_state;
                STATE.serverLastMove = gameData.last_move;
                
                const getPieceCount = (f) => f.split(' ')[0].replace(/[^a-zA-Z]/g, '').length;
                const wasCapture = getPieceCount(gameData.fen_state) < getPieceCount(oldFen);

                STATE.engine.load(gameData.fen_state);

                // Preserve an in-progress piece selection; the engine is already
                // loaded to the latest server state so local consistency is maintained.
                if (!STATE.selectedSquare) {
                    STATE.validMoves = [];
                    this.renderBoard();
                }
                
                if (STATE.currentTurnId === STATE.userId) {
                    if (STATE.engine.in_check()) AudioEngine.check();
                    else if (wasCapture) AudioEngine.capture();
                    else AudioEngine.move();
                }
            }

            this.updateControlUI(gameData);
            return true;
        } catch (err) {
            console.error('pollGame failed:', err);
            return false;
        }
    },

    /**
     * Renders the physical chess board based on the current engine state.
     * Handles perspective flipping for the second player.
     * @returns {void}
     */
    renderBoard: function() {
        if (STATE.isInteracting || !STATE.engine) return;
        
        const boardElement = document.getElementById('chess-board');
        boardElement.innerHTML = '';
        
        const boardState = STATE.engine.board();
        const isBlackPerspective = (STATE.userId === STATE.p2Id);

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const row = isBlackPerspective ? (7 - r) : r;
                const col = isBlackPerspective ? (7 - c) : c;

                const squareDiv = document.createElement('div');
                squareDiv.classList.add('square');
                if ((row + col) % 2 !== 0) squareDiv.classList.add('dark');

                const file = String.fromCharCode(97 + col);
                const rank = 8 - row;
                const squareName = `${file}${rank}`;
                squareDiv.dataset.square = squareName;

                const piece = boardState[row][col];
                if (piece) {
                    const pieceSpan = document.createElement('span');
                    pieceSpan.classList.add('piece', piece.color === 'w' ? 'white-piece' : 'black-piece');
                    pieceSpan.textContent = PIECE_UNICODE[piece.type];
                    squareDiv.appendChild(pieceSpan);
                }

                squareDiv.onclick = () => this.handleSquareClick(squareName);
                boardElement.appendChild(squareDiv);
            }
        }
        this.updateHighlights();
    },

    /**
     * Updates visual highlights for selection, valid moves, and the last move executed.
     * @returns {void}
     */
    updateHighlights: function() {
        const squares = document.querySelectorAll('.square');
        let lastMoveFrom = null, lastMoveTo = null;

        // Only show last-move highlights if it is currently my turn (showing opponent's move)
        const isMyTurn = STATE.currentTurnId === STATE.userId;
        if (isMyTurn && STATE.serverLastMove?.includes('-')) {
            [lastMoveFrom, lastMoveTo] = STATE.serverLastMove.split('-');
        }

        squares.forEach(sq => {
            sq.classList.remove('selected', 'valid-move', 'last-move', 'in-check');
            if (sq.dataset.square === STATE.selectedSquare) sq.classList.add('selected');
            if (STATE.validMoves.some(m => m.to === sq.dataset.square)) sq.classList.add('valid-move');
            if (sq.dataset.square === lastMoveFrom || sq.dataset.square === lastMoveTo) {
                sq.classList.add('last-move');
            }
        });

        if (STATE.engine.in_check()) {
            const board = STATE.engine.board();
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    const p = board[r][c];
                    if (p?.type === 'k' && p.color === STATE.engine.turn()) {
                        const sqName = String.fromCharCode(97 + c) + (8 - r);
                        const sqEl = document.querySelector(`[data-square="${sqName}"]`);
                        if (sqEl) sqEl.classList.add('in-check');
                    }
                }
            }
        }

        this.updateMoveLine(lastMoveFrom, lastMoveTo);
    },

    /**
     * Draws an SVG line representing the last move on the board.
     * Only displays the line if it is the current player's turn (showing opponent's move).
     * @param {string|null} from - Starting square coordinate.
     * @param {string|null} to - Ending square coordinate.
     * @returns {void}
     */
    updateMoveLine: function(from, to) {
        const svg = document.getElementById('move-line-overlay');
        if (!svg) return;
        
        svg.innerHTML = '';
        
        // Only show the line if it's my turn (meaning the opponent just moved)
        const isMyTurn = STATE.currentTurnId === STATE.userId;
        if (!from || !to || !isMyTurn) return;

        const isBlackPerspective = (STATE.userId === STATE.p2Id);
        
        const getCoords = (square) => {
            const file = square.charCodeAt(0) - 97;
            const rank = 8 - parseInt(square[1], 10);
            
            const physicalCol = isBlackPerspective ? (7 - file) : file;
            const physicalRow = isBlackPerspective ? (7 - rank) : rank;
            
            return {
                x: (physicalCol * 12.5) + 6.25,
                y: (physicalRow * 12.5) + 6.25
            };
        };

        const start = getCoords(from);
        const end = getCoords(to);

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', `${start.x}%`);
        line.setAttribute('y1', `${start.y}%`);
        line.setAttribute('x2', `${end.x}%`);
        line.setAttribute('y2', `${end.y}%`);
        line.setAttribute('stroke', 'rgba(255, 255, 0, 0.4)');
        line.setAttribute('stroke-width', '4');
        line.setAttribute('stroke-linecap', 'round');
        
        svg.appendChild(line);
    },

    /**
     * Handles user interaction with board squares.
     * Manages piece selection, move execution, and promotion workflows.
     * @param {string} squareName - Algebraic coordinate of the clicked square.
     * @returns {Promise<void>}
     */
    handleSquareClick: async function(squareName) {
        AudioEngine.move(); 
        
        if (STATE.currentTurnId !== STATE.userId || STATE.gameStatus !== 'active') return;

        const moveAttempt = STATE.validMoves.find(m => m.to === squareName);

        if (moveAttempt) {
            const piece = STATE.engine.get(STATE.selectedSquare);
            const isPawn = piece?.type === 'p';
            const isPromotionRank = (piece.color === 'w' && squareName[1] === '8') || 
                                    (piece.color === 'b' && squareName[1] === '1');
            
            let promotionPiece = 'q';
            if (isPawn && isPromotionRank) {
                promotionPiece = await this.getPromotionPiece();
            }

            const moveStr = `${STATE.selectedSquare}-${squareName}`;
            const moveResult = STATE.engine.move({
                from: STATE.selectedSquare,
                to: squareName,
                promotion: promotionPiece
            });

            STATE.selectedSquare = null;
            STATE.validMoves = [];
            this.renderBoard();
            this.updateMoveLine(null, null);

            if (STATE.engine.in_check()) AudioEngine.check();
            else if (moveResult && moveResult.captured) AudioEngine.capture();
            else AudioEngine.move();
            
            await this.submitMove(moveStr);
        } else {
            const piece = STATE.engine.get(squareName);
            const playerColor = STATE.userId === STATE.p1Id ? 'w' : 'b';

            if (piece?.color === playerColor) {
                STATE.selectedSquare = squareName;
                STATE.validMoves = STATE.engine.moves({ square: squareName, verbose: true });
            } else {
                STATE.selectedSquare = null;
                STATE.validMoves = [];
            }
            this.updateHighlights();
        }
    },

    /**
     * Displays the promotion modal and waits for user selection.
     * @returns {Promise<string>} - The type of piece chosen for promotion (e.g., 'q').
     */
    getPromotionPiece: function() {
        const promoModal = document.getElementById('promotion-modal');
        if (!promoModal) return Promise.resolve('q');

        STATE.isInteracting = true;
        return new Promise((resolve) => {
            promoModal.classList.add('active');
            const buttons = promoModal.querySelectorAll('.promo-btn');
            buttons.forEach(btn => {
                btn.onclick = () => {
                    const piece = btn.dataset.piece;
                    promoModal.classList.remove('active');
                    STATE.isInteracting = false;
                    resolve(piece);
                };
            });
        });
    },

    /**
     * Synchronizes the locally executed move with the server.
     * @param {string} moveStr - The coordinate pair string (e.g., "e2-e4").
     * @returns {Promise<void>}
     */
    submitMove: async function(moveStr) {
        const newFen = STATE.engine.fen();
        const nextTurnId = (STATE.userId === STATE.p1Id) ? STATE.p2Id : STATE.p1Id;
        let newStatus = 'active', winnerId = null;

        if (STATE.engine.game_over()) {
            newStatus = 'finished';
            winnerId = STATE.engine.in_checkmate() ? STATE.userId : 0;
        }

        STATE.currentFen = newFen;
        STATE.drawOfferByMe = false;

        STATE.isInteracting = true;
        try {
            await window.apiPost('/chess/api/move', {
                game_id: STATE.activeGameId, 
                fen: newFen, 
                next_turn_id: nextTurnId,
                status: newStatus, 
                winner_id: winnerId, 
                last_move: moveStr
            });
            await this.pollGame(true);
        } finally {
            STATE.isInteracting = false;
        }
    },

    /**
     * Updates the control panel UI elements based on game progress and server responses.
     * Handles game-over modals and draw offer overlays.
     * @param {Object} data - The game state metadata from the server.
     * @returns {void}
     */
    updateControlUI: function(data) {
        const oldStatus = STATE.gameStatus;
        STATE.gameStatus = data.status;

        const boardEl = document.getElementById('chess-board');
        const offerBtn = document.getElementById('offerDrawBtn');
        const resignBtn = document.getElementById('resignBtn');
        const statusText = document.getElementById('game-status-text');
        const gameOverModal = document.getElementById('game-over-modal');

        if (STATE.gameStatus === 'finished') {
            if (boardEl) boardEl.classList.remove('my-turn-pulse');
            if (oldStatus === 'active') {
                AudioEngine.gameOver();
                
                const winnerId = parseInt(data.winner_id, 10);
                const modalPanel = gameOverModal.querySelector('.game-over-panel');
                const iconEl = document.getElementById('game-over-icon');
                const titleEl = document.getElementById('game-over-title');
                const msgEl = document.getElementById('game-over-msg');

                modalPanel.classList.remove('victory', 'defeat', 'draw');
                
                if (winnerId === 0) {
                    modalPanel.classList.add('draw');
                    iconEl.innerHTML = '🤝';
                    
                    if (STATE.engine && STATE.engine.in_stalemate()) {
                        titleEl.innerText = "STALEMATE";
                        msgEl.innerText = "The king has no legal moves and is not in check. It's a draw!";
                    } else if (STATE.engine && STATE.engine.insufficient_material()) {
                        titleEl.innerText = "DRAW (Material)";
                        msgEl.innerText = "Neither player has enough material to force a checkmate.";
                    } else if (STATE.engine && STATE.engine.in_threefold_repetition()) {
                        titleEl.innerText = "DRAW (Repetition)";
                        msgEl.innerText = "The same board position has occurred three times.";
                    } else {
                        titleEl.innerText = "DRAW (Agreed)";
                        msgEl.innerText = "Both players have agreed to a draw.";
                    }
                } else if (winnerId === STATE.userId) {
                    modalPanel.classList.add('victory');
                    iconEl.innerHTML = '🏆';
                    titleEl.innerText = "VICTORY!";
                    msgEl.innerText = data.last_move === null && data.fen_state === STATE.engine.fen() 
                        ? "Your opponent has resigned. You win by default!" 
                        : "Checkmate! You have mastered the board.";
                } else {
                    modalPanel.classList.add('defeat');
                    iconEl.innerHTML = '❌';
                    titleEl.innerText = "DEFEAT";
                    msgEl.innerText = "Better luck next time. Strategy is a journey.";
                }
                
                gameOverModal.classList.add('active');
            }
            
            if (STATE.pollInterval) clearInterval(STATE.pollInterval);
            
            const winnerId = parseInt(data.winner_id, 10);
            if (winnerId === 0) {
                statusText.innerHTML = `🤝 Game Over - Draw`;
            } else {
                const isMeWinner = (winnerId === STATE.userId);
                statusText.innerHTML = isMeWinner ? `🏆 Game Over - You Win!` : `Game Over - You Lost`;
            }
            
            if (offerBtn) offerBtn.classList.remove('active');
            if (resignBtn) resignBtn.classList.remove('active');
        } else {
            if (gameOverModal) gameOverModal.classList.remove('active');
            if (STATE.gameStatus === 'waiting') {
                statusText.innerHTML = `⏳ Waiting for opponent...`;
                if (boardEl) boardEl.classList.remove('my-turn-pulse');
            } else {
                const isMyTurn = STATE.currentTurnId === STATE.userId;
                statusText.innerHTML = isMyTurn ? `<span class="turn-pill">✅ Your Turn</span>` : `❌ Opponent's Turn`;
                
                if (boardEl) {
                    if (isMyTurn) boardEl.classList.add('my-turn-pulse');
                    else boardEl.classList.remove('my-turn-pulse');
                }

                if (offerBtn) offerBtn.classList.add('active');
                if (resignBtn) resignBtn.classList.add('active');
            }
        }

        const overlay = document.getElementById('draw-offer-overlay');
        if (data.draw_offered_by) {
            if (parseInt(data.draw_offered_by, 10) === STATE.userId) {
                if (offerBtn) { offerBtn.textContent = "⌛ Waiting..."; offerBtn.disabled = true; }
                STATE.drawOfferByMe = true;
            } else if (overlay) {
                overlay.classList.add('active');
            }
        } else {
            if (overlay) overlay.classList.remove('active');
            if (offerBtn) { offerBtn.textContent = `🤝 Offer Draw`; offerBtn.disabled = false; }
        }
        
        document.getElementById('fen-display').textContent = `FEN: ${data.fen_state}`;
    },

    /**
     * Binds DOM events to controller logic for buttons and interactive components.
     * @returns {void}
     */
    setupEventListeners: function() {
        const resignBtn = document.getElementById('resignBtn');
        if (resignBtn) {
            resignBtn.onclick = async () => {
                if (STATE.gameStatus !== 'active') return;
                window.showConfirmModal({
                    title: 'Resign Game',
                    message: 'Are you sure you want to resign?',
                    danger: true,
                    confirmText: 'Resign',
                    onConfirm: async () => {
                        const opponentId = (STATE.userId === STATE.p1Id) ? STATE.p2Id : STATE.p1Id;
                        STATE.isInteracting = true;
                        await window.apiPost('/chess/api/move', {
                            game_id: STATE.activeGameId, 
                            fen: STATE.engine.fen(), 
                            next_turn_id: 0, 
                            status: 'finished', 
                            winner_id: opponentId,
                            last_move: null 
                        });
                        STATE.isInteracting = false;
                        this.pollGame(true);
                    }
                });
            };
        }

        const offerDrawBtn = document.getElementById('offerDrawBtn');
        if (offerDrawBtn) {
            offerDrawBtn.onclick = async () => {
                if (STATE.gameStatus !== 'active') return;
                window.showConfirmModal({
                    title: 'Offer Draw',
                    message: 'Do you want to offer a draw to your opponent?',
                    confirmText: 'Offer Draw',
                    onConfirm: async () => {
                        STATE.drawOfferByMe = true;
                        STATE.isInteracting = true;
                        await window.apiPost(`/chess/api/offer_draw/${STATE.activeGameId}`);
                        STATE.isInteracting = false;
                        this.pollGame(true);
                    }
                });
            };
        }

        const acceptDrawBtn = document.getElementById('acceptDrawBtn');
        if (acceptDrawBtn) {
            acceptDrawBtn.onclick = async () => {
                STATE.isInteracting = true;
                await window.apiPost(`/chess/api/respond_draw/${STATE.activeGameId}`, { accept: 1 });
                STATE.isInteracting = false;
                this.pollGame(true);
            };
        }

        const refuseDrawBtn = document.getElementById('refuseDrawBtn');
        if (refuseDrawBtn) {
            refuseDrawBtn.onclick = async () => {
                STATE.isInteracting = true;
                await window.apiPost(`/chess/api/respond_draw/${STATE.activeGameId}`, { accept: 0 });
                STATE.isInteracting = false;
                this.pollGame(true);
            };
        }
    },

    /**
     * Helpers
     */
    escapeHtml: window.escapeHtml,

    /**
     * Capitalizes the first character of a string.
     * @param {string} s - The input string.
     * @returns {string} - The capitalized string.
     */
    capitalize: function(s) {
        if (!s) return '';
        return s.charAt(0).toUpperCase() + s.slice(1);
    }
};

document.addEventListener('DOMContentLoaded', () => ChessApp.init());
// Expose for inline handlers
window.ChessApp = ChessApp;
