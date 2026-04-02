// /public/js/connect4.js

/**
 * Connect 4 Controller Module
 * 
 * Manages the unified logic for the Connect 4 module.
 * Incorporates routing, lobby synchronization, and real-time game engine execution.
 * 
 * Features:
 * - History API based view routing (Lobby vs Active Game)
 * - Real-time board synchronization with authoritative server state
 * - Precision landing-cell move validation highlighting
 * - Integrated game-over modal and status management
 * - Synthesized Web Audio API feedback for moves and victory
 * - Background state polling with interaction inhibition
 * 
 * Dependencies:
 * - default.js: Platform helpers
 */

/**
 * --- Module State & Config ---
 */
const CONFIG = {
    SYNC_LOBBY_MS: 5000,
    SYNC_GAME_MS: 1500
};

let STATE = {
    userId: null,
    view: 'lobby',          // 'lobby' or 'game'
    activeGameId: null,
    isInteracting: false,
    pollInterval: null,
    
    // Game Specifics
    board: [],
    isMyTurn: false,
    gameStatus: 'loading',
    myRole: 0               // Predicted role (1=Host, 2=Joiner)
};

/**
 * --- Synthesized Audio Engine ---
 */
const AudioEngine = (() => {
    let audioCtx = null;
    function getCtx() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    }
    
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
        resume: () => getCtx(),
        drop: () => {
            playTone(400, 'sine', 0.1, 0.1);
            setTimeout(() => playTone(200, 'sine', 0.1, 0.1), 50);
        },
        victory: () => {
            playTone(523.25, 'triangle', 0.2, 0.1); // C5
            setTimeout(() => playTone(659.25, 'triangle', 0.2, 0.1), 150); // E5
            setTimeout(() => playTone(783.99, 'triangle', 0.4, 0.1), 300); // G5
        },
        defeat: () => {
            playTone(220, 'sawtooth', 0.3, 0.05);
            setTimeout(() => playTone(185, 'sawtooth', 0.5, 0.05), 200);
        }
    };
})();

/**
 * --- Primary Controller ---
 */
const Connect4App = {
    init: function() {
        const appContainer = document.getElementById('connect4-app');
        if (!appContainer) return;
        
        STATE.userId = parseInt(appContainer.dataset.userId, 10) || 0;
        
        // Setup global handlers
        this.setupEventListeners();
        
        // Prime audio context on first click anywhere in the app
        appContainer.addEventListener('click', () => AudioEngine.resume(), { once: true });

        // Initial route resolution
        this.resolveRoute(window.location.pathname);
        
        // History binding
        window.addEventListener('popstate', () => {
            this.resolveRoute(window.location.pathname);
        });
    },

    /**
     * Resolves the active view based on path.
     * 
     * @param {string} path - The current URL path.
     * @returns {void}
     */
    resolveRoute: function(path) {
        if (STATE.pollInterval) clearInterval(STATE.pollInterval);
        
        const match = path.match(/\/connect4\/play\/(\d+)/);
        if (match && match[1]) {
            this.showGame(match[1]);
        } else {
            this.showLobby();
        }
    },

    /**
     * Toggles visibility of the primary DOM containers.
     * 
     * @param {string} viewName - Name of the view to activate.
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
     * --- Lobby Workflow ---
     */
    showLobby: function() {
        if (STATE.view !== 'lobby') {
            window.history.pushState({}, '', '/connect4');
        }
        this.toggleView('lobby');
        this.pollLobby();
        STATE.pollInterval = setInterval(() => this.pollLobby(), CONFIG.SYNC_LOBBY_MS);
    },

    pollLobby: async function() {
        if (STATE.isInteracting || STATE.view !== 'lobby') return;
        try {
            const response = await fetch('/connect4/api/lobby');
            const data = await response.json();
            if (data.success) {
                this.renderLobby(data.open_games, data.user_games);
            }
        } catch (e) {
            console.error('Lobby poll failed', e);
        }
    },

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
                    <button type="button" class="btn-join" onclick="Connect4App.showGame(${g.id})">Resume &rarr;</button>
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
                    <button type="button" class="btn-join" onclick="Connect4App.joinGame(${g.id})">Join Game &rarr;</button>
                </div>
            `).join('');
        }
    },

    createGame: async function() {
        const result = await window.apiPost('/connect4/api/create');
        if (result && result.success && result.game_id) {
            STATE.myRole = 1;
            this.showGame(result.game_id);
        }
    },

    joinGame: async function(id) {
        const result = await window.apiPost('/connect4/api/join', { id });
        if (result && result.success) {
            STATE.myRole = 2; // Predicted role
            this.showGame(id);
        }
    },

    /**
     * --- Game Workflow ---
     */
    showGame: async function(id) {
        if (window.location.pathname !== `/connect4/play/${id}`) {
            window.history.pushState({}, '', `/connect4/play/${id}`);
        }
        STATE.activeGameId = id;
        document.getElementById('game-title').textContent = `Connect 4 - Game #${id}`;
        
        this.toggleView('game');
        this.initBoard();
        
        // Initial Fetch
        const success = await this.pollGame(true);
        if (success) {
            STATE.pollInterval = setInterval(() => this.pollGame(), CONFIG.SYNC_GAME_MS);
        } else {
            this.showLobby();
            window.showToast("Could not load game.", "error");
        }
    },

    pollGame: async function(force = false) {
        if (!force && (STATE.isInteracting || STATE.view !== 'game')) return true;

        try {
            const response = await fetch(`/connect4/api/game/${STATE.activeGameId}`);
            const data = await response.json();
            
            if (data.error) return false;
            
            const gameData = data.game;
            const oldBoard = JSON.stringify(STATE.board);
            
            // Synchronize state
            STATE.isMyTurn = (gameData.turn == STATE.userId) && (gameData.status === 'active');
            STATE.board = gameData.board;
            STATE.myRole = gameData.player_role;

            // Detect board change for audio
            if (oldBoard !== JSON.stringify(STATE.board) && oldBoard !== '[]') {
                AudioEngine.drop();
            }

            this.updateBoard();
            this.updateControlUI(gameData);
            return true;
        } catch (err) {
            console.error('pollGame failed:', err);
            return false;
        }
    },

    initBoard: function() {
        const boardEl = document.getElementById('board');
        if (!boardEl) return;
        boardEl.innerHTML = '';
        for (let r = 0; r < 6; r++) {
            for (let c = 0; c < 7; c++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.col = c;
                cell.dataset.row = r;
                cell.onclick = () => this.handleMove(c);
                boardEl.appendChild(cell);
            }
        }
    },

    updateBoard: function() {
        if (STATE.isInteracting) return;
        
        const cells = document.querySelectorAll('.cell');
        
        // Calculate landing spots for highlights
        const landingRows = new Array(7).fill(-1);
        for (let c = 0; c < 7; c++) {
            for (let r = 5; r >= 0; r--) {
                if (STATE.board[r][c] === 0) {
                    landingRows[c] = r;
                    break;
                }
            }
        }

        let i = 0;
        for (let r = 0; r < 6; r++) {
            for (let c = 0; c < 7; c++) {
                const val = STATE.board[r][c];
                const cell = cells[i];
                if (!cell) continue;

                cell.className = 'cell'; 
                if (val === 1) cell.classList.add('p1');
                if (val === 2) cell.classList.add('p2');
                
                // Precision Highlighting: Only landing cell in active columns
                if (STATE.isMyTurn && landingRows[c] === r) {
                    cell.classList.add('valid-move');
                }
                i++;
            }
        }
    },

    handleMove: async function(col) {
        if (!STATE.isMyTurn || STATE.gameStatus !== 'active') return;
        
        // Immediate auditory feedback for move attempt
        AudioEngine.drop();

        STATE.isMyTurn = false; 
        STATE.isInteracting = true;

        try {
            const result = await window.apiPost('/connect4/api/move', { id: STATE.activeGameId, col: col });
            if (result && result.success) await this.pollGame(true);
        } finally {
            STATE.isInteracting = false;
        }
    },

    handleRestart: async function() {
        STATE.isInteracting = true;
        try {
            const result = await window.apiPost('/connect4/api/restart', { id: STATE.activeGameId });
            if (result && result.success) {
                const gameOverModal = document.getElementById('game-over-modal');
                if (gameOverModal) gameOverModal.classList.remove('active');
                await this.pollGame(true);
            }
        } finally {
            STATE.isInteracting = false;
        }
    },

    updateControlUI: function(data) {
        const oldStatus = STATE.gameStatus;
        STATE.gameStatus = data.status;

        const boardFrame = document.querySelector('.board-frame');
        const statusMsg = document.getElementById('status-message');
        const turnMsg = document.getElementById('turn-indicator');
        const restartBtn = document.getElementById('btn-restart');
        const gameOverModal = document.getElementById('game-over-modal');

        // Reset status themes
        statusMsg.classList.remove('theme-waiting', 'status-draw', 'status-victory', 'status-defeat', 'status-active', 'status-waiting');

        if (STATE.gameStatus === 'finished') {
            if (boardFrame) boardFrame.classList.remove('my-turn-pulse');
            
            if (oldStatus === 'active') {
                const winnerId = parseInt(data.winner, 10);
                const modalPanel = gameOverModal.querySelector('.game-over-panel');
                const iconEl = document.getElementById('game-over-icon');
                const titleEl = document.getElementById('game-over-title');
                const msgEl = document.getElementById('game-over-msg');

                modalPanel.classList.remove('victory', 'defeat', 'draw');
                
                if (winnerId === 0) {
                    modalPanel.classList.add('draw');
                    iconEl.innerHTML = window.getIcon('draw');
                    titleEl.innerText = "DRAW GAME";
                    msgEl.innerText = "The board is full. It's a stalemate!";
                } else if (winnerId === STATE.userId) {
                    AudioEngine.victory();
                    modalPanel.classList.add('victory');
                    iconEl.innerHTML = window.getIcon('trophy');
                    titleEl.innerText = "VICTORY!";
                    msgEl.innerText = "Four in a row! You win!";
                } else {
                    AudioEngine.defeat();
                    modalPanel.classList.add('defeat');
                    iconEl.innerHTML = window.getIcon('error');
                    titleEl.innerText = "DEFEAT";
                    msgEl.innerText = "Better luck next time. Watch your vectors!";
                }
                
                gameOverModal.classList.add('active');
            }

            if (data.winner == 0) {
                statusMsg.innerText = "Draw! 🤝";
                statusMsg.classList.add('status-draw');
            } else if (data.winner == STATE.userId) {
                statusMsg.innerText = "VICTORY! 🎉";
                statusMsg.classList.add('status-victory');
            } else {
                const winnerName = (data.winner == data.p1_id) ? data.p1_name : data.p2_name;
                statusMsg.innerText = `${winnerName} Wins! 💀`; 
                statusMsg.classList.add('status-defeat');
            }
            turnMsg.innerText = "Game Over";
            if (restartBtn) restartBtn.classList.add('active');
        } 
        else {
            if (gameOverModal) gameOverModal.classList.remove('active');
            if (restartBtn) restartBtn.classList.remove('active');

            if (STATE.gameStatus === 'waiting') {
                statusMsg.innerText = `Waiting for ${data.p2_name || 'Opponent'}...`;
                statusMsg.classList.add('theme-waiting');
                turnMsg.innerText = "Share the URL to start!";
                if (boardFrame) boardFrame.classList.remove('my-turn-pulse');
            } else {
                if (STATE.isMyTurn) {
                    statusMsg.innerText = "YOUR TURN";
                    statusMsg.classList.add('status-active');
                    turnMsg.innerHTML = `You are ${STATE.myRole === 1 ? 'Red ' + window.getIcon('connect4') : 'Blue ' + window.getIcon('connect4_blue')}`;
                    if (boardFrame) boardFrame.classList.add('my-turn-pulse');
                } else {
                    const currentTurnName = (data.turn == data.p1_id) ? data.p1_name : data.p2_name;
                    statusMsg.innerText = `${currentTurnName}'s Turn`;
                    statusMsg.classList.add('status-waiting');
                    turnMsg.innerText = "Please wait...";
                    if (boardFrame) boardFrame.classList.remove('my-turn-pulse');
                }
            }
        }
    },

    setupEventListeners: function() {
        const restartBtn = document.getElementById('btn-restart');
        if (restartBtn) restartBtn.onclick = () => this.handleRestart();
    },

    /**
     * Helpers
     */
    escapeHtml: window.escapeHtml,
    capitalize: function(s) {
        if (!s) return '';
        return s.charAt(0).toUpperCase() + s.slice(1);
    }
};

document.addEventListener('DOMContentLoaded', () => Connect4App.init());
// Expose for inline handlers
window.Connect4App = Connect4App;
