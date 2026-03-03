// /public/js/connect4.js

/**
 * Connect 4 Game Controller Module
 * 
 * This module manages the real-time multiplayer Connect 4 game engine. It 
 * handles board state synchronization, player turn management, and visual 
 * victory detection using a 1.5-second polling interval.
 * 
 * Features:
 * - Real-time 6x7 board synchronization with server state
 * - Role-based interaction gating (Red vs. Blue vs. Spectator)
 * - Move validation with high-visibility "valid-move" highlighting
 * - Game over state handling with specific winner identification (Draw/P1/P2)
 * - Integrated "Play Again" restart workflow for active game IDs
 * 
 * Dependencies:
 * - default.js: For getIcon and platform theme consistency
 */

/**
 * Initialization System
 * Boots the game interface and starts the polling loop if configuration exists.
 */
document.addEventListener('DOMContentLoaded', () => {
    // Context: Retrieve game configuration from data attributes injected by template
    const gameContainer = document.getElementById('game-config');
    if (!gameContainer) return;

    /**
     * Immutable Game Configuration
     */
    const config = {
        gameId: parseInt(gameContainer.dataset.gameId),
        myId: parseInt(gameContainer.dataset.myId),
        myRole: parseInt(gameContainer.dataset.myRole) 
    };

    /**
     * Mutable Game State
     */
    let state = {
        isMyTurn: false,            // Active turn status
        gameStatus: 'loading',      // current phase: waiting, active, finished
        board: []                   // Current 2D board matrix
    };

    const boardEl = document.getElementById('board');
    const statusMsg = document.getElementById('status-message');
    const turnMsg = document.getElementById('turn-indicator');
    const restartBtn = document.getElementById('btn-restart');

    /**
     * UI: initBoard
     * Generates the empty 6x7 cell grid and attaches move listeners.
     */
    function initBoard() {
        if (!boardEl) return;
        boardEl.innerHTML = '';
        for (let r = 0; r < 6; r++) {
            for (let c = 0; c < 7; c++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.col = c;
                cell.dataset.row = r;
                cell.addEventListener('click', handleMove);
                boardEl.appendChild(cell);
            }
        }
    }

    /**
     * Action: Restart Handler
     * Resets the active game board via administrative endpoint.
     */
    if (restartBtn) {
        restartBtn.addEventListener('click', () => {
            fetch('/connect4/restart', {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: `id=${config.gameId}`
            })
            .then(r => r.json())
            .then(() => syncGame()); // UI: trigger immediate sync after reset request
        });
    }

    /**
     * Action: handleMove
     * Validates and transmits a column selection to the server.
     * 
     * @param {Event} e - Click event from a board cell
     */
    function handleMove(e) {
        // Logic: inhibit moves if not turn, game not active, or spectator role (0)
        if (!state.isMyTurn || state.gameStatus !== 'active' || config.myRole === 0) return;
        
        const col = e.target.dataset.col;
        state.isMyTurn = false; // UI: disable interaction during network flight

        fetch('/connect4/move', {
            method: 'POST',
            headers: {'Content-Type': 'application/x-www-form-urlencoded'},
            body: `id=${config.gameId}&col=${col}`
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) syncGame();
        });
    }

    /**
     * Logic: syncGame
     * Performs background fetch of latest game state.
     */
    function syncGame() {
        fetch(`/connect4/play/${config.gameId}`, {headers: {'X-Requested-With': 'XMLHttpRequest'}})
            .then(r => r.json())
            .then(data => {
                updateBoard(data.board);
                updateStatus(data);
            })
            .catch(err => console.error("syncGame failure:", err));
    }

    /**
     * UI Component: updateBoard
     * Reconciles server board matrix with DOM cell classes.
     * 
     * @param {Array[]} serverBoard - 2D matrix of board values (0, 1, 2)
     */
    function updateBoard(serverBoard) {
        const cells = document.querySelectorAll('.cell');
        let i = 0;
        for (let r = 0; r < 6; r++) {
            for (let c = 0; c < 7; c++) {
                const val = serverBoard[r][c];
                const cell = cells[i];
                if (!cell) continue;

                cell.className = 'cell'; 
                
                // Visual: apply player-specific coin colors
                if (val === 1) cell.classList.add('p1');
                if (val === 2) cell.classList.add('p2');
                
                // Logic: highlight valid drop targets during active turn
                if (state.isMyTurn && val === 0) {
                    cell.classList.add('valid-move');
                }
                i++;
            }
        }
    }

    /**
     * UI Logic: updateStatus
     * Manages phase-aware messaging and action button visibility.
     * 
     * @param {Object} data - Game state object
     */
    function updateStatus(data) {
        state.gameStatus = data.status;
        state.isMyTurn = (data.turn == config.myId) && (data.status === 'active');
        
        // Metadata: resolve names with fallback defaults
        const p1Name = data.p1_name || "Red";
        const p2Name = data.p2_name || "Blue";

        // Logic: manage "Play Again" availability
        if (restartBtn) {
            restartBtn.style.display = (data.status === 'finished') ? 'inline-block' : 'none';
        }

        if (data.status === 'waiting') {
            statusMsg.innerText = `Waiting for ${p2Name}...`;
            statusMsg.style.color = "var(--p2-color)";
            turnMsg.innerText = "Share the URL to start!";
        } 
        else if (data.status === 'finished') {
            // Scenario: Game Resolution
            if (data.winner == 0) {
                statusMsg.innerText = "Draw! 🤝";
                statusMsg.style.color = "#fff";
            } else if (data.winner == config.myId) {
                statusMsg.innerText = "VICTORY! 🎉";
                statusMsg.style.color = "#4ade80"; 
            } else {
                const winnerName = (data.winner == data.p1_id) ? p1Name : p2Name;
                statusMsg.innerText = `${winnerName} Wins! 💀`; 
                statusMsg.style.color = "#ef4444"; 
            }
            turnMsg.innerText = "Game Over";
        } 
        else {
            // Scenario: Active Game Play
            if (state.isMyTurn) {
                statusMsg.innerText = "YOUR TURN";
                statusMsg.style.color = "#4ade80";
                turnMsg.innerText = `You are ${config.myRole === 1 ? 'Red ' + getIcon('connect4') : 'Blue ' + getIcon('connect4_blue')}`;
            } else {
                const currentTurnName = (data.turn == data.p1_id) ? p1Name : p2Name;
                statusMsg.innerText = `${currentTurnName}'s Turn`;
                statusMsg.style.color = "var(--text-secondary)";
                turnMsg.innerText = "Please wait...";
            }
        }
    }

    // Lifecycle: Bootstrap the board and start sync service (1500ms)
    initBoard();
    setInterval(syncGame, 1500);
    syncGame();
});
