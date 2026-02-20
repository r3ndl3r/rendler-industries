// /public/js/chess/chess.js

/* * Frontend logic for the Chess application.
 * Utilizes the chess.js library for complex move validation (checkmate, castling, en passant)
 * entirely on the client side. This reduces server load and latency by only sending 
 * finalized FEN strings back to the Mojolicious backend.
 * * Flow:
 * 1. Read initial state from DOM data attributes.
 * 2. Render 8x8 grid.
 * 3. Handle user interactions (click to select, click to move).
 * 4. Submit valid moves via fetch() to /chess/move.
 * 5. Poll for updates if it is the opponent's turn.
 */

document.addEventListener('DOMContentLoaded', () => {
    const boardElement = document.getElementById('chess-board');
    if (!boardElement) return;

    // Extract game state provided by the Mojolicious controller
    const gameId = boardElement.dataset.gameId;
    const initialFen = boardElement.dataset.fen;
    let currentTurnId = parseInt(boardElement.dataset.turn, 10);
    const p1Id = parseInt(boardElement.dataset.p1, 10); // White
    const p2Id = parseInt(boardElement.dataset.p2, 10); // Black
    const currentUserId = parseInt(boardElement.dataset.userId, 10);
    let gameStatus = boardElement.dataset.status;

    // Initialize the chess.js engine with the server-provided FEN
    const game = new Chess(initialFen);
    
    // State variables for UI interaction
    let selectedSquare = null;
    let validMoves = [];

    // Unicode map for rendering chess pieces natively.
    // We use the solid versions for both, and will color them via CSS.
    const pieceUnicode = {
        'p': '♟', 'n': '♞', 'b': '♝', 'r': '♜', 'q': '♛', 'k': '♚'
    };

    /**
     * Renders the 8x8 HTML grid based on the current chess.js internal board state.
     * Clears the board container and rebuilds the squares to ensure exact synchronization.
     * * Parameters: None
     * Returns: void
     */
    function renderBoard() {
        boardElement.innerHTML = '';
        const boardState = game.board(); // Returns 2D array [8][8] from a8 to h1

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const squareDiv = document.createElement('div');
                squareDiv.classList.add('square');
                
                // Determine square color (alternating pattern)
                const isDark = (row + col) % 2 !== 0;
                if (isDark) squareDiv.classList.add('dark');

                // Convert [row, col] to algebraic notation (e.g., 'e2')
                const file = String.fromCharCode(97 + col);
                const rank = 8 - row;
                const squareName = `${file}${rank}`;
                squareDiv.dataset.square = squareName;

                // Render piece if it exists on this square
                const piece = boardState[row][col];
                if (piece) {
                    const pieceSpan = document.createElement('span');
                    pieceSpan.classList.add('piece');
                    // Color class based on 'w' or 'b'
                    pieceSpan.classList.add(piece.color === 'w' ? 'white-piece' : 'black-piece');
                    pieceSpan.textContent = pieceUnicode[piece.type];
                    squareDiv.appendChild(pieceSpan);
                }

                // Attach click listener for interaction
                squareDiv.addEventListener('click', () => handleSquareClick(squareName));
                
                boardElement.appendChild(squareDiv);
            }
        }
        updateHighlights();
    }

    /**
     * Updates the DOM to visually indicate the currently selected piece and its legal moves.
     * Matches the 'squareName' against the 'selectedSquare' state and the 'validMoves' array.
     * * Parameters: None
     * Returns: void
     */
    function updateHighlights() {
        const squares = boardElement.querySelectorAll('.square');
        squares.forEach(sq => {
            sq.classList.remove('selected', 'valid-move');
            if (sq.dataset.square === selectedSquare) {
                sq.classList.add('selected');
            }
            if (validMoves.some(m => m.to === sq.dataset.square)) {
                sq.classList.add('valid-move');
            }
        });
    }

    /**
     * Processes user clicks on the chess board.
     * Determines whether to select a piece, change selection, or execute a move.
     * Enforces turn-based locking to prevent a player from moving out of turn.
     * * Parameters:
     * squareName (String) : Algebraic notation of the clicked square (e.g., 'e4')
     * Returns: void
     */
    function handleSquareClick(squareName) {
        // Prevent interaction if it is not the user's turn or game is finished
        if (currentTurnId !== currentUserId || gameStatus !== 'active') return;

        // Check if the clicked square is a valid destination for the currently selected piece
        const moveAttempt = validMoves.find(m => m.to === squareName);

        if (moveAttempt) {
            // Execute the move in the chess.js engine
            game.move(moveAttempt.san);
            selectedSquare = null;
            validMoves = [];
            renderBoard();
            submitMove();
        } else {
            // Select a new piece
            const piece = game.get(squareName);
            const playerColor = currentUserId === p1Id ? 'w' : 'b';

            // Only allow selecting pieces that belong to the current player
            if (piece && piece.color === playerColor) {
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
     * Transmits the updated board state (FEN) to the Mojolicious backend after a valid move.
     * Calculates the next player's ID and determines if the game has ended (checkmate/draw).
     * * Parameters: None
     * Returns: void
     */
    function submitMove() {
        const newFen = game.fen();
        const nextTurnId = currentUserId === p1Id ? p2Id : p1Id;
        
        let newStatus = 'active';
        let winnerId = null;

        if (game.game_over()) {
            newStatus = 'finished';
            if (game.in_checkmate()) {
                winnerId = currentUserId; // The person who just moved wins
            } else {
                winnerId = 0; // Draw
            }
        }

        // Send payload to controller
        fetch('/chess/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                game_id: gameId,
                fen: newFen,
                next_turn_id: nextTurnId,
                status: newStatus,
                winner_id: winnerId
            })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                // Update local state and wait for opponent
                currentTurnId = nextTurnId;
                gameStatus = newStatus;
                document.getElementById('game-status-text').textContent = "🔴 Opponent's Turn";
                document.getElementById('fen-display').textContent = `Current FEN: ${newFen}`;
                startPolling();
            } else {
                alert('Move synchronization failed.');
            }
        });
    }

    /**
     * Periodically fetches the latest game state from the server if it is the opponent's turn.
     * Reloads the page if a new move is detected to ensure full state synchronization.
     * * Parameters: None
     * Returns: void
     */
    function startPolling() {
        if (currentTurnId === currentUserId || gameStatus !== 'active') return;

        const pollInterval = setInterval(() => {
            // Note: If you don't have an API endpoint like /api/chess/state/:id,
            // polling by reloading the page is a simple fallback mechanism.
            window.location.reload();
        }, 3000);
    }

    // Initial render and setup
    renderBoard();
    if (currentTurnId !== currentUserId && gameStatus === 'active') {
        startPolling();
    }
});