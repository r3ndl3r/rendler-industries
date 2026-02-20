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
    let currentFen = initialFen;
    let drawOfferByMe = false;
    let serverLastMove = null;

    // Unicode map for rendering chess pieces natively.
    const pieceUnicode = {
        'p': '♟', 'n': '♞', 'b': '♝', 'r': '♜', 'q': '♛', 'k': '♚'
    };

    /**
     * Renders the 8x8 HTML grid based on the current chess.js internal board state.
     * Flips the board perspective so the current user is always at the bottom.
     */
    function renderBoard() {
        boardElement.innerHTML = '';
        const boardState = game.board();
        const isBlackPerspective = (currentUserId === p2Id);

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                // Flip indices if playing as Black
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
     * Updates highlights for selection, valid moves, and the last move made.
     */
    function updateHighlights() {
        const squares = boardElement.querySelectorAll('.square');
        
        let lastMoveFrom = null;
        let lastMoveTo = null;

        if (serverLastMove && serverLastMove.includes('-')) {
            [lastMoveFrom, lastMoveTo] = serverLastMove.split('-');
        }

        squares.forEach(sq => {
            sq.classList.remove('selected', 'valid-move', 'last-move', 'in-check');
            
            // Selected piece highlight
            if (sq.dataset.square === selectedSquare) sq.classList.add('selected');
            
            // Valid move dots
            if (validMoves.some(m => m.to === sq.dataset.square)) sq.classList.add('valid-move');

            // Last move highlight (from and to) from server state
            if (sq.dataset.square === lastMoveFrom || sq.dataset.square === lastMoveTo) {
                sq.classList.add('last-move');
            }
        });

        // Highlight King if in check
        if (game.in_check()) {
            const board = game.board();
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    const p = board[r][c];
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
     * Handles square clicks for piece selection and move execution.
     */
    async function handleSquareClick(squareName) {
        if (currentTurnId !== currentUserId || gameStatus !== 'active') return;

        const moveAttempt = validMoves.find(m => m.to === squareName);

        if (moveAttempt) {
            // Check for pawn promotion
            const piece = game.get(selectedSquare);
            const isPawn = piece && piece.type === 'p';
            const isPromotionRank = (piece.color === 'w' && squareName[1] === '8') || 
                                    (piece.color === 'b' && squareName[1] === '1');
            
            let promotionPiece = 'q'; // Default
            if (isPawn && isPromotionRank) {
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
            
            // Play synthesized sound based on move type
            playMoveSound(moveResult.captured ? true : false, game.in_check());
            
            submitMove();
        } else {
            const piece = game.get(squareName);
            const playerColor = currentUserId === p1Id ? 'w' : 'b';

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
     * Synthesized Audio System using Web Audio API
     */
    const AudioEngine = (() => {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        
        function playTone(freq, type, duration, volume = 0.1) {
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

    function playMoveSound(isCapture = false, isCheck = false) {
        if (isCheck) {
            AudioEngine.check();
        } else if (isCapture) {
            AudioEngine.capture();
        } else {
            AudioEngine.move();
        }
    }

    /**
     * Custom Modal Helpers to replace alert/confirm
     */
    const modal = document.getElementById('game-modal');
    const modalMsg = document.getElementById('modal-message');
    const confirmBtn = document.getElementById('modal-confirm-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');
    const okBtn = document.getElementById('modal-ok-btn');

    function customAlert(message) {
        return new Promise((resolve) => {
            modalMsg.textContent = message;
            confirmBtn.style.display = 'none';
            cancelBtn.style.display = 'none';
            okBtn.style.display = 'inline-block';
            modal.style.display = 'flex';
            
            okBtn.onclick = () => {
                modal.style.display = 'none';
                resolve();
            };
        });
    }

    function customConfirm(message) {
        return new Promise((resolve) => {
            modalMsg.textContent = message;
            confirmBtn.style.display = 'inline-block';
            cancelBtn.style.display = 'inline-block';
            okBtn.style.display = 'none';
            modal.style.display = 'flex';

            confirmBtn.onclick = () => {
                modal.style.display = 'none';
                resolve(true);
            };
            cancelBtn.onclick = () => {
                modal.style.display = 'none';
                resolve(false);
            };
        });
    }

    const promoModal = document.getElementById('promotion-modal');
    function getPromotionPiece() {
        return new Promise((resolve) => {
            promoModal.style.display = 'flex';
            const buttons = promoModal.querySelectorAll('.promo-btn');
            buttons.forEach(btn => {
                btn.onclick = () => {
                    const piece = btn.dataset.piece;
                    promoModal.style.display = 'none';
                    resolve(piece);
                };
            });
        });
    }

    /**
     * Submits a move or action payload to the server.
     */
    function submitMovePayload(endpoint, payload = {}) {
        console.log("Submitting to:", endpoint, "with payload:", payload);
        fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(res => {
            console.log("Response status:", res.status);
            return res.json();
        })
        .then(data => {
            if (data.success) {
                pollGameState(); // Immediate poll after action
            } else {
                // Action failed on server (e.g., unauthorized or out of turn)
                customAlert('Action failed: ' + (data.error || 'Unknown error'));
                pollGameState(); // Force re-sync
            }
        })
        .catch(err => {
            console.error('FETCH ERROR detail:', err);
            customAlert('Network error occurred. Resyncing...');
            pollGameState();
        });
    }

    function submitMove() {
        const newFen = game.fen();
        const nextTurnId = (currentUserId === p1Id) ? p2Id : p1Id;
        let newStatus = 'active';
        let winnerId = null;

        if (game.game_over()) {
            newStatus = 'finished';
            winnerId = game.in_checkmate() ? currentUserId : 0;
        }

        // IMPORTANT: Update local tracker immediately so poll doesn't see old state
        currentFen = newFen;

        submitMovePayload('/chess/move', {
            game_id: gameId,
            fen: newFen,
            next_turn_id: nextTurnId,
            status: newStatus,
            winner_id: winnerId,
            last_move: serverLastMove
        });
    }

    /**
     * Polls the server for the current game status.
     */
    function pollGameState() {
        fetch(`/chess/status/${gameId}`)
        .then(res => res.json())
        .then(data => {
            if (data.error) return;

            // Handle Move/FEN updates
            if (data.fen !== currentFen) {
                const oldFen = currentFen;
                currentFen = data.fen;
                serverLastMove = data.last_move;
                
                // Determine if a capture occurred by checking piece count before loading new FEN
                const getPieceCount = (f) => f.split(' ')[0].replace(/[^a-zA-Z]/g, '').length;
                const wasCapture = getPieceCount(data.fen) < getPieceCount(oldFen);

                game.load(data.fen);
                renderBoard();
                updateHighlights(); // Explicitly refresh highlights
                
                if (data.turn === currentUserId) {
                    if (game.in_check()) {
                        AudioEngine.check();
                    } else if (wasCapture) {
                        AudioEngine.capture();
                    } else {
                        AudioEngine.move();
                    }
                }
            }

            // Update local state
            currentTurnId = parseInt(data.turn, 10);
            const oldStatus = gameStatus;
            gameStatus = data.status;

            if (gameStatus === 'finished' && oldStatus === 'active') {
                AudioEngine.gameOver();
            }

            // Update UI text
            const statusText = document.getElementById('game-status-text');
            if (gameStatus === 'finished') {
                const winnerId = parseInt(data.winner_id, 10);
                if (winnerId === 0) {
                    if (drawOfferByMe) {
                        customAlert('Your draw offer was accepted.');
                        drawOfferByMe = false;
                    }
                    statusText.textContent = "🤝 Game Over - Draw";
                } else {
                    const winnerName = (winnerId === p1Id) ? "White" : "Black";
                    const isMeWinner = (winnerId === currentUserId);
                    
                    if (statusText.textContent.indexOf("Game Over") === -1) {
                        if (isMeWinner) {
                            customAlert("Opponent resigned or checkmate. You win!");
                        }
                    }
                    
                    if (isMeWinner) {
                        statusText.textContent = `🏆 Game Over - You Win!`;
                    } else {
                        statusText.textContent = `Game Over - You Resigned/Lost`;
                    }
                }
                document.getElementById('offerDrawBtn').style.display = 'none';
                document.getElementById('resignBtn').style.display = 'none';
            } else if (gameStatus === 'waiting') {
                statusText.textContent = "⏳ Waiting for opponent...";
            } else {
                statusText.textContent = currentTurnId === currentUserId ? "🟢 Your Turn" : "🔴 Opponent's Turn";
            }

            document.getElementById('fen-display').textContent = `Current FEN: ${currentFen}`;

            // Handle Draw Offers
            const overlay = document.getElementById('draw-offer-overlay');
            const offerBtn = document.getElementById('offerDrawBtn');

            if (data.draw_offered_by) {
                if (parseInt(data.draw_offered_by, 10) === currentUserId) {
                    offerBtn.textContent = "⌛ Waiting for response...";
                    offerBtn.disabled = true;
                    offerBtn.style.display = 'inline-block';
                    drawOfferByMe = true;
                } else {
                    overlay.style.display = 'flex';
                }
            } else {
                // No active offer in DB. 
                // Only alert 'refused' if we previously knew we had an offer pending
                // AND this isn't just the first poll after we clicked the button
                if (drawOfferByMe && gameStatus === 'active') {
                    drawOfferByMe = false;
                    customAlert('Draw offer was refused.');
                }
                
                overlay.style.display = 'none';
                if (gameStatus === 'active') {
                    // Only reset button text if we aren't mid-action
                    if (!drawOfferByMe) {
                        offerBtn.textContent = "Offer Draw";
                        offerBtn.disabled = false;
                        offerBtn.style.display = 'inline-block';
                    }
                }
            }
        });
    }

    // Polling setup
    setInterval(pollGameState, 2000);

    // Button Listeners
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

    const acceptDrawBtn = document.getElementById('acceptDrawBtn');
    if (acceptDrawBtn) {
        acceptDrawBtn.addEventListener('click', () => {
            submitMovePayload(`/chess/respond_draw/${gameId}?accept=1`);
        });
    }

    const refuseDrawBtn = document.getElementById('refuseDrawBtn');
    if (refuseDrawBtn) {
        refuseDrawBtn.addEventListener('click', () => {
            submitMovePayload(`/chess/respond_draw/${gameId}?accept=0`);
        });
    }

    // Initial setup
    renderBoard();
});