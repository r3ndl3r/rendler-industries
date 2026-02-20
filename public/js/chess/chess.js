// /public/js/chess/chess.js

/**
 * Frontend logic for the Chess application.
 * Handles board rendering, move validation, AJAX synchronization,
 * and synthesized audio alerts.
 */

document.addEventListener('DOMContentLoaded', () => {
    const boardElement = document.getElementById('chess-board');
    if (!boardElement) return;

    // Extract game state provided by the Mojolicious controller
    const gameId = boardElement.dataset.gameId;
    const initialFen = boardElement.dataset.fen;
    let currentTurnId = parseInt(boardElement.dataset.turn, 10) || 0;
    let p1Id = parseInt(boardElement.dataset.p1, 10) || 0; 
    let p2Id = parseInt(boardElement.dataset.p2, 10) || 0; 
    const currentUserId = parseInt(boardElement.dataset.userId, 10) || 0;
    let gameStatus = boardElement.dataset.status;

    // Initialize the chess.js engine with the server-provided FEN
    const game = new Chess(initialFen);
    
    // State variables for UI interaction
    let selectedSquare = null;
    let validMoves = [];
    let currentFen = initialFen;
    let drawOfferByMe = false;
    let serverLastMove = null;
    let isInteracting = false;
    let pollInterval = null;

    // Unicode map for rendering chess pieces natively.
    const pieceUnicode = {
        'p': '♟', 'n': '♞', 'b': '♝', 'r': '♜', 'q': '♛', 'k': '♚'
    };

    /**
     * Synthesized Audio System using Web Audio API.
     * Prevents auto-start issues by initializing on first interaction.
     */
    let audioCtx = null;
    const AudioEngine = (() => {
        function getCtx() {
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
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
            } catch (e) {
                console.warn("Audio playback failed:", e);
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
     * Renders the 8x8 HTML grid based on the current chess.js internal board state.
     * Flips the board perspective so the current user is always at the bottom.
     */
    function renderBoard() {
        if (isInteracting) return;
        boardElement.innerHTML = '';
        const boardState = game.board();
        const isBlackPerspective = (currentUserId === p2Id);

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
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
     * Updates visual highlights for selection, valid moves, and the last move.
     */
    function updateHighlights() {
        const squares = boardElement.querySelectorAll('.square');
        let lastMoveFrom = null, lastMoveTo = null;

        if (serverLastMove && serverLastMove.includes('-')) {
            [lastMoveFrom, lastMoveTo] = serverLastMove.split('-');
        }

        squares.forEach(sq => {
            sq.classList.remove('selected', 'valid-move', 'last-move', 'in-check');
            if (sq.dataset.square === selectedSquare) sq.classList.add('selected');
            if (validMoves.some(m => m.to === sq.dataset.square)) sq.classList.add('valid-move');
            if (sq.dataset.square === lastMoveFrom || sq.dataset.square === lastMoveTo) {
                sq.classList.add('last-move');
            }
        });

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
            const piece = game.get(selectedSquare);
            const isPawn = piece && piece.type === 'p';
            const isPromotionRank = (piece.color === 'w' && squareName[1] === '8') || 
                                    (piece.color === 'b' && squareName[1] === '1');
            
            let promotionPiece = 'q';
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
            
            if (game.in_check()) AudioEngine.check();
            else if (moveResult.captured) AudioEngine.capture();
            else AudioEngine.move();
            
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
     * Custom themed modals.
     */
    const modal = document.getElementById('game-modal');
    const modalMsg = document.getElementById('modal-message');
    const confirmBtn = document.getElementById('modal-confirm-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');
    const okBtn = document.getElementById('modal-ok-btn');

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

    const promoModal = document.getElementById('promotion-modal');
    function getPromotionPiece() {
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
     * API communication logic with response validation.
     */
    function submitMovePayload(endpoint, payload = {}) {
        fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(res => {
            if (!res.ok) throw new Error('Response status ' + res.status);
            return res.json();
        })
        .then(data => {
            if (data.success) pollGameState();
            else {
                customAlert('Action failed: ' + (data.error || 'Unknown error'));
                pollGameState(); 
            }
        })
        .catch(err => console.error('Submission failed:', err));
    }

    function submitMove() {
        const newFen = game.fen();
        const nextTurnId = (currentUserId === p1Id) ? p2Id : p1Id;
        let newStatus = 'active', winnerId = null;

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

    function pollGameState() {
        if (isInteracting || gameStatus === 'finished') return;

        fetch(`/chess/status/${gameId}`)
        .then(res => {
            if (!res.ok) throw new Error('Poll failed');
            return res.json();
        })
        .then(data => {
            if (data.error || isInteracting) return;

            if (data.fen !== currentFen) {
                const oldFen = currentFen;
                currentFen = data.fen;
                serverLastMove = data.last_move;
                
                const getPieceCount = (f) => f.split(' ')[0].replace(/[^a-zA-Z]/g, '').length;
                const wasCapture = getPieceCount(data.fen) < getPieceCount(oldFen);

                game.load(data.fen);
                renderBoard();
                
                if (data.turn === currentUserId) {
                    if (game.in_check()) AudioEngine.check();
                    else if (wasCapture) AudioEngine.capture();
                    else AudioEngine.move();
                }
            }

            currentTurnId = parseInt(data.turn, 10);
            p1Id = parseInt(data.p1_id, 10) || p1Id;
            p2Id = parseInt(data.p2_id, 10) || p2Id;

            // Ensure controls are visible if user is now a player (relevant for P2 who just joined)
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

            if (gameStatus === 'finished') {
                if (oldStatus === 'active') AudioEngine.gameOver();
                if (pollInterval) clearInterval(pollInterval);
                
                const statusText = document.getElementById('game-status-text');
                const winnerId = parseInt(data.winner_id, 10);
                if (winnerId === 0) {
                    if (drawOfferByMe) { customAlert('Your draw offer was accepted.'); drawOfferByMe = false; }
                    statusText.textContent = "🤝 Game Over - Draw";
                } else {
                    const isMeWinner = (winnerId === currentUserId);
                    if (statusText.textContent.indexOf("Game Over") === -1) {
                        if (isMeWinner) {
                            if (game.in_checkmate()) customAlert("Checkmate. You win!");
                            else customAlert("Opponent resigned. You win!");
                        } else {
                            // I am the loser
                            if (game.in_checkmate()) customAlert("Checkmate. You lost.");
                            else if (winnerId !== 0) customAlert("Game over. You lost.");
                        }
                    }
                    
                    if (isMeWinner) {
                        statusText.textContent = `🏆 Game Over - You Win!`;
                    } else {
                        if (game.in_checkmate()) {
                            statusText.textContent = `Game Over - Checkmate (You Lost)`;
                        } else {
                            statusText.textContent = `Game Over - You Resigned`;
                        }
                    }
                }
                const offerBtn = document.getElementById('offerDrawBtn');
                const resignBtn = document.getElementById('resignBtn');
                if (offerBtn) offerBtn.style.display = 'none';
                if (resignBtn) resignBtn.style.display = 'none';
            } else if (gameStatus === 'waiting') {
                document.getElementById('game-status-text').textContent = "⏳ Waiting for opponent...";
            } else {
                document.getElementById('game-status-text').textContent = currentTurnId === currentUserId ? "🟢 Your Turn" : "🔴 Opponent's Turn";
            }

            document.getElementById('fen-display').textContent = `Current FEN: ${currentFen}`;

            const overlay = document.getElementById('draw-offer-overlay');
            const offerBtn = document.getElementById('offerDrawBtn');
            if (!offerBtn) return;

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
                if (drawOfferByMe && gameStatus === 'active') {
                    drawOfferByMe = false;
                    customAlert('Draw offer was refused.');
                }
                overlay.style.display = 'none';
                if (gameStatus === 'active' && !drawOfferByMe) {
                    offerBtn.textContent = "Offer Draw";
                    offerBtn.disabled = false;
                    offerBtn.style.display = 'inline-block';
                }
            }
        });
    }

    pollInterval = setInterval(pollGameState, 2000);

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
        acceptDrawBtn.addEventListener('click', () => submitMovePayload(`/chess/respond_draw/${gameId}?accept=1`));
    }

    const refuseDrawBtn = document.getElementById('refuseDrawBtn');
    if (refuseDrawBtn) {
        refuseDrawBtn.addEventListener('click', () => submitMovePayload(`/chess/respond_draw/${gameId}?accept=0`));
    }

    renderBoard();
});
