/* /public/js/connect4.js */

document.addEventListener('DOMContentLoaded', () => {
    const gameContainer = document.getElementById('game-config');
    if (!gameContainer) return;

    const config = {
        gameId: parseInt(gameContainer.dataset.gameId),
        myId: parseInt(gameContainer.dataset.myId),
        myRole: parseInt(gameContainer.dataset.myRole) 
    };

    let state = {
        isMyTurn: false,
        gameStatus: 'loading',
        board: []
    };

    const boardEl = document.getElementById('board');
    const statusMsg = document.getElementById('status-message');
    const turnMsg = document.getElementById('turn-indicator');
    const restartBtn = document.getElementById('btn-restart'); // New Button

    function initBoard() {
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

    // Handle "Play Again" Click
    if (restartBtn) {
        restartBtn.addEventListener('click', () => {
            fetch('/connect4/restart', {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: `id=${config.gameId}`
            })
            .then(r => r.json())
            .then(() => syncGame()); // Immediate refresh
        });
    }

    function handleMove(e) {
        if (!state.isMyTurn || state.gameStatus !== 'active' || config.myRole === 0) return;
        
        const col = e.target.dataset.col;
        state.isMyTurn = false; 

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

    function syncGame() {
        fetch(`/connect4/play/${config.gameId}`, {headers: {'X-Requested-With': 'XMLHttpRequest'}})
            .then(r => r.json())
            .then(data => {
                updateBoard(data.board);
                updateStatus(data);
            })
            .catch(err => console.error("Sync failed", err));
    }

    function updateBoard(serverBoard) {
        const cells = document.querySelectorAll('.cell');
        let i = 0;
        for (let r = 0; r < 6; r++) {
            for (let c = 0; c < 7; c++) {
                const val = serverBoard[r][c];
                const cell = cells[i];
                cell.className = 'cell'; 
                
                if (val === 1) cell.classList.add('p1');
                if (val === 2) cell.classList.add('p2');
                
                if (state.isMyTurn && val === 0) {
                    cell.classList.add('valid-move');
                }
                i++;
            }
        }
    }

    function updateStatus(data) {
        state.gameStatus = data.status;
        state.isMyTurn = (data.turn == config.myId) && (data.status === 'active');
        
        // Helper to get names
        const p1Name = data.p1_name || "Red";
        const p2Name = data.p2_name || "Blue";

        // Hide/Show Restart Button
        if (data.status === 'finished') {
            restartBtn.style.display = 'inline-block';
        } else {
            restartBtn.style.display = 'none';
        }

        if (data.status === 'waiting') {
            statusMsg.innerText = `Waiting for ${p2Name}...`;
            statusMsg.style.color = "var(--p2-color)";
            turnMsg.innerText = "Share the URL to start!";
        } 
        else if (data.status === 'finished') {
            if (data.winner == 0) {
                statusMsg.innerText = "Draw! 🤝";
                statusMsg.style.color = "#fff";
            } else if (data.winner == config.myId) {
                statusMsg.innerText = "VICTORY! 🎉";
                statusMsg.style.color = "#4ade80"; 
            } else {
                // Show who won using their name
                const winnerName = (data.winner == data.p1_id) ? p1Name : p2Name;
                statusMsg.innerText = `${winnerName} Wins! 💀`; 
                statusMsg.style.color = "#ef4444"; 
            }
            turnMsg.innerText = "Game Over";
        } 
        else {
            // Active Game
            if (state.isMyTurn) {
                statusMsg.innerText = "YOUR TURN";
                statusMsg.style.color = "#4ade80";
                turnMsg.innerText = `You are ${config.myRole === 1 ? 'Red 🔴' : 'Blue 🔵'}`;
            } else {
                // Determine whose turn it is
                const currentTurnName = (data.turn == data.p1_id) ? p1Name : p2Name;
                
                statusMsg.innerText = `${currentTurnName}'s Turn`;
                statusMsg.style.color = "var(--text-secondary)";
                turnMsg.innerText = "Please wait...";
            }
        }
    }
    initBoard();
    setInterval(syncGame, 1500);
    syncGame();
});