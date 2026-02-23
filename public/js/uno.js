// /public/js/uno.js

document.addEventListener('DOMContentLoaded', () => {
    const configContainer = document.getElementById('game-config');
    if (!configContainer) return;

    const config = {
        gameId: configContainer.dataset.gameId,
        myId: parseInt(configContainer.dataset.myId),
        myRole: parseInt(configContainer.dataset.myRole)
    };

    const els = {
        oppHand: document.getElementById('opp-hand'),
        discardPile: document.getElementById('discard-pile'),
        myHand: document.getElementById('my-hand'),
        deck: document.getElementById('draw-deck'),
        colorModal: document.getElementById('color-modal'),
        oppName: document.getElementById('opp-name'),
        oppCardCount: document.getElementById('opp-card-count'),
        myCardCount: document.getElementById('my-card-count'),
        colorDot: document.getElementById('color-dot'),
        statusToast: document.getElementById('status-toast'),
        myPanel: document.getElementById('my-panel'),
        oppPanel: document.getElementById('opponent-panel')
    };

    let gameState = {
        isMyTurn: false,
        myHand: [],
        pendingCardIdx: null,
        pendingCardElement: null,
        turn: null,
        direction: null,
        isDrawing: false,
        isPlaying: false,
        selectedCardIdx: null
    };

    const animations = {
        duration: 800,
        
        animateDraw(callback) {
            const deckRect = els.deck.getBoundingClientRect();
            const handRect = els.myHand.getBoundingClientRect();
            
            const targetRect = {
                left: handRect.left + handRect.width / 2 - 45,
                top: handRect.top + handRect.height / 2 - 67.5,
                width: 90,
                height: 135
            };
            
            const flyingCard = document.createElement('div');
            flyingCard.className = 'flying-card';
            flyingCard.innerHTML = '<div class="uno-card card-back"></div>';
            flyingCard.style.position = 'fixed';
            flyingCard.style.left = deckRect.left + 'px';
            flyingCard.style.top = deckRect.top + 'px';
            flyingCard.style.width = deckRect.width + 'px';
            flyingCard.style.height = deckRect.height + 'px';
            
            document.body.appendChild(flyingCard);
            
            requestAnimationFrame(() => {
                flyingCard.style.transition = `all ${this.duration}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
                flyingCard.style.left = targetRect.left + 'px';
                flyingCard.style.top = targetRect.top + 'px';
                flyingCard.style.transform = 'rotate(360deg)';
            });
            
            setTimeout(() => {
                flyingCard.remove();
                if (callback) callback();
            }, this.duration);
        },
        
        animatePlay(cardElement, callback) {
            const cardRect = cardElement.getBoundingClientRect();
            const discardRect = els.discardPile.getBoundingClientRect();
            
            const targetRect = {
                left: discardRect.left + discardRect.width / 2 - cardRect.width / 2,
                top: discardRect.top + discardRect.height / 2 - cardRect.height / 2,
                width: cardRect.width,
                height: cardRect.height
            };
            
            const flyingCard = document.createElement('div');
            flyingCard.className = 'flying-card';
            const clone = cardElement.cloneNode(true);
            clone.style.backgroundPosition = cardElement.style.backgroundPosition;
            flyingCard.appendChild(clone);
            
            flyingCard.style.position = 'fixed';
            flyingCard.style.left = cardRect.left + 'px';
            flyingCard.style.top = cardRect.top + 'px';
            flyingCard.style.width = cardRect.width + 'px';
            flyingCard.style.height = cardRect.height + 'px';
            flyingCard.style.zIndex = '9999';
            flyingCard.style.pointerEvents = 'none';
            
            document.body.appendChild(flyingCard);
            
            cardElement.style.opacity = '0';
            
            requestAnimationFrame(() => {
                flyingCard.style.transition = `all ${this.duration}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
                flyingCard.style.left = targetRect.left + 'px';
                flyingCard.style.top = targetRect.top + 'px';
                flyingCard.style.transform = 'rotate(360deg)';
            });
            
            setTimeout(() => {
                flyingCard.remove();
                if (callback) callback();
            }, this.duration);
        }
    };

    els.deck.addEventListener('click', () => {
        if (!gameState.isMyTurn) {
            showToast('Not your turn!');
            return;
        }
        
        // Prevent double-clicks
        if (gameState.isDrawing) return;
        gameState.isDrawing = true;

        els.deck.style.transform = 'scale(0.95)';
        setTimeout(() => els.deck.style.transform = '', 100);
        
        animations.animateDraw(() => {
            fetch('/uno/draw_card', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `id=${config.gameId}`
            })
            .then(res => res.json())
            .then(data => {
                gameState.isDrawing = false;
                if (data.success) {
                    if (data.playable) {
                        showToast('You drew a playable card!', 2000);
                    }
                    syncGame();
                }
            });
        });
    });

    window.playCard = function(index) {
        if (!gameState.isMyTurn) {
            showToast('Not your turn!');
            return;
        }

        const card = gameState.myHand[index];
        const cardElement = els.myHand.children[index];

        if (card.startsWith('wild')) {
            gameState.pendingCardIdx = index;
            gameState.pendingCardElement = cardElement;
            showColorPicker();
        } else {
            sendMove(index, null, cardElement);
        }
    };

    function showColorPicker() {
        els.colorModal.style.display = 'block';
    }

    window.pickColor = function(color) {
        els.colorModal.style.display = 'none';
        if (gameState.pendingCardIdx !== null) {
            sendMove(gameState.pendingCardIdx, color, gameState.pendingCardElement);
            gameState.pendingCardIdx = null;
            gameState.pendingCardElement = null;
        }
    };

    function sendMove(idx, color, cardElement) {
        if (gameState.isPlaying) return;
        gameState.isPlaying = true;

        gameState.isMyTurn = false;
        gameState.selectedCardIdx = null; // Reset selection
        updateTurnIndicators();
        
        animations.animatePlay(cardElement, () => {
            const body = `id=${config.gameId}&idx=${idx}${color ? `&color=${color}` : ''}`;
            fetch('/uno/play_card', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body
            })
            .then(res => res.json())
            .then(data => {
                gameState.isPlaying = false;
                if (data.success) {
                    syncGame();
                } else {
                    showToast('Invalid move!');
                    syncGame();
                }
            });
        });
    }

    function renderCard(cardString, isPlayable = false, index = -1) {
        const card = parseCard(cardString);
        
        const div = document.createElement('div');
        div.className = `uno-card`;
        if (gameState.selectedCardIdx === index) {
            div.classList.add('selected');
        }
        
        // Calculate background position based on sprite sheet
        const posX = card.col * 90 + (card.col * 0.375); 
        const posY = card.row * 135 + (card.row * 0.375);
        div.style.backgroundPosition = `-${posX}px -${posY}px`;

        if (isPlayable) {
            div.onclick = (e) => {
                e.stopPropagation();
                if (gameState.selectedCardIdx === index) {
                    gameState.selectedCardIdx = null;
                } else {
                    gameState.selectedCardIdx = index;
                }
                syncGame();
            };
            div.ondblclick = (e) => {
                e.stopPropagation();
                window.playCard(index);
            };
        } else if (index !== -1) {
            div.classList.add('uno-disabled');
        }
        
        return div;
    }

    function parseCard(cardString) {
        // Default to a safe fallback (red 0)
        let res = { color: 'red', val: '0', col: 0, row: 0 };
        
        if (cardString === 'wild') {
            return { color: 'wild', val: 'W', col: 13, row: 0 };
        }
        if (cardString === 'wild_draw4') {
            return { color: 'wild', val: '+4', col: 13, row: 4 };
        }

        const [color, val] = cardString.split('_');
        const colorBaseRows = { red: 0, yellow: 1, green: 2, blue: 3 };
        const valCols = {
            '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
            'skip': 10, 'reverse': 11, 'draw2': 12
        };

        res.row = colorBaseRows[color] ?? 0;
        res.col = valCols[val] ?? 0;

        // Note: The sprite sheet actually has two sets: 
        // rows 0-3 (red, yellow, green, blue) 
        // rows 4-7 (red, yellow, green, blue again)
        // We'll stick to rows 0-3 for consistency.
        
        return res;
    }

    window.shoutUno = function() {
        fetch('/uno/shout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `id=${config.gameId}`
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showToast('📢 You shouted UNO!', 2000);
                syncGame();
            }
        });
    };

    function syncGame() {
        console.log('Syncing game state...');
        fetch(`/uno/play/${config.gameId}`, {
            method: 'GET',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        })
        .then(res => res.json())
        .then(data => {
            console.log('Game state received:', data);
            const oldTurn = gameState.turn;
            const oldDirection = gameState.direction;
            
            gameState.myHand = data.myhand || [];
            gameState.turn = data.turn;
            gameState.direction = data.direction;
            gameState.isMyTurn = (data.turn === config.myId && data.status === 'active');

            console.log(`Hand size: ${gameState.myHand.length}, My Turn: ${gameState.isMyTurn}`);

            // UNO Shout Button visibility
            const shoutBtn = document.getElementById('uno-shout-container');
            if (gameState.myHand.length === 2 && gameState.isMyTurn) {
                shoutBtn.classList.add('visible');
            } else {
                shoutBtn.classList.remove('visible');
            }

            // Feedback for Turn Change
            if (oldTurn !== data.turn && gameState.isMyTurn) {
                // Not showing toast anymore, visual glow is enough
            }

            // Feedback for Direction Change
            if (oldDirection !== undefined && oldDirection !== data.direction) {
                showToast(data.direction === 1 ? 'Direction: Clockwise ➡️' : 'Direction: Counter-Clockwise ⬅️');
            }

            if (data.status === 'finished') {
                if (data.winner === config.myId) {
                    showToast('🎉 You Win! 🎉', 3000);
                } else {
                    const winnerName = data.players.find(p => p.id === data.winner)?.name || 'Someone';
                    showToast(`💔 ${winnerName} Wins!`, 3000);
                }
                updateTurnIndicators(null); // Clear all
                return;
            }

            // Sync My Hand
            const topCard = data.topcard;
            els.myHand.innerHTML = '';
            gameState.myHand.forEach((card, idx) => {
                const isPlayable = canPlayCard(card, topCard, data.color);
                const cardEl = renderCard(card, isPlayable && gameState.isMyTurn, idx);
                els.myHand.appendChild(cardEl);
            });

            if (els.myCardCount) els.myCardCount.textContent = `${gameState.myHand.length} cards`;

            // Sync Discard Pile
            els.discardPile.innerHTML = '';
            els.discardPile.appendChild(renderCard(topCard));

            // Sync Opponents
            const opponents = data.players.filter(p => p.id !== config.myId);
            
            // Map opponents to slots relative to me
            // Slot logic for 4 players (clockwise): Me -> Left -> Top -> Right
            // Role 1: 2 is Left, 3 is Top, 4 is Right
            // Role 2: 3 is Left, 4 is Top, 1 is Right
            // ...
            const slots = ['left', 'top', 'right'];
            slots.forEach(s => {
                const panel = document.getElementById(`opp-slot-${s}`);
                if (panel) panel.style.visibility = 'hidden';
            });

            opponents.forEach(opp => {
                // Determine which slot this opponent goes into
                // Simple version: 1-3 based on relative role
                let relativePos = (opp.role - config.myRole + 4) % 4;
                let slotName;
                if (relativePos === 1) slotName = 'left';
                if (relativePos === 2) slotName = 'top';
                if (relativePos === 3) slotName = 'right';

                const panel = document.getElementById(`opp-slot-${slotName}`);
                if (!panel) return;

                panel.style.visibility = 'visible';
                panel.querySelector('.player-name').textContent = (opp.said_uno ? '📢 ' : '') + opp.name;
                panel.querySelector('.card-count').textContent = `${opp.card_count} cards`;
                
                if (data.turn === opp.id) {
                    panel.classList.add('active');
                } else {
                    panel.classList.remove('active');
                }
            });

            updateTurnIndicators(data.turn);

            const colorMap = { red: '#ef4444', blue: '#3b82f6', green: '#22c55e', yellow: '#eab308' };
            els.colorDot.style.backgroundColor = colorMap[data.color] || '#8b5cf6';
        });
    }

    function canPlayCard(card, topCard, currentColor) {
        if (card.startsWith('wild')) return true;
        
        const [cardColor, cardVal] = card.split('_');
        const [topColor, topVal] = topCard.split('_');
        
        if (cardColor === currentColor) return true;
        if (cardVal && topVal && cardVal === topVal) return true;
        
        // Handle playing on a Wild (where topCard is 'wild' or 'wild_draw4')
        if (topColor === 'wild' && cardColor === currentColor) return true;

        return false;
    }

    function updateTurnIndicators(activeTurnId) {
        // My Panel
        if (activeTurnId === config.myId) {
            els.myPanel.classList.add('active');
            if (els.deck.parentElement) els.deck.parentElement.classList.add('my-turn');
        } else {
            els.myPanel.classList.remove('active');
            if (els.deck.parentElement) els.deck.parentElement.classList.remove('my-turn');
        }

        // Opponent Panels
        ['left', 'top', 'right'].forEach(slot => {
            const panel = document.getElementById(`opp-slot-${slot}`);
            if (panel && panel.style.visibility === 'visible') {
                // The slot's active state is handled inside syncGame loop for opponents
            }
        });
    }

    function showToast(message, duration = 1500) {
        els.statusToast.textContent = message;
        els.statusToast.classList.add('show');
        setTimeout(() => {
            els.statusToast.classList.remove('show');
        }, duration);
    }

    document.addEventListener('click', () => {
        if (gameState.selectedCardIdx !== null) {
            gameState.selectedCardIdx = null;
            syncGame();
        }
    });

    syncGame();
    setInterval(syncGame, 2000);
});
