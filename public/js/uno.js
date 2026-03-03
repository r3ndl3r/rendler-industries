// /public/js/uno.js

/**
 * UNO Game Controller Module
 * 
 * This module manages the real-time client logic for the UNO Online game. 
 * It implements a complex interaction engine with sprite-based card 
 * rendering, 3D CSS animations, and multimodal game states.
 * 
 * Features:
 * - Real-time synchronization of player hands, discard pile, and direction
 * - Sprite-sheet based card rendering with mathematical coordinate resolution
 * - Smooth 3D flying card animations for drawing and playing
 * - Interactive color-picker for Wild card logic
 * - Integrated "UNO!" shout workflow with automated state detection
 * - Role-relative opponent slot mapping (Me -> Left -> Top -> Right)
 * - Real-time turn indicators and visual countdowns
 * 
 * Dependencies:
 * - default.js: For getIcon and status feedback
 */

document.addEventListener('DOMContentLoaded', () => {
    // Context: resolve game identifiers from data attributes
    const configContainer = document.getElementById('game-config');
    if (!configContainer) return;

    /**
     * Immutable Game Configuration
     */
    const config = {
        gameId: configContainer.dataset.gameId,
        myId: parseInt(configContainer.dataset.myId),
        myRole: parseInt(configContainer.dataset.myRole)
    };

    /**
     * UI Element Cache
     */
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
        unoShoutBtn: document.querySelector('.btn-uno-shout')
    };

    /**
     * Mutable Game State
     */
    let gameState = {
        isMyTurn: false,            // Local turn status
        myHand: [],                 // Collection of card strings (e.g., 'red_5', 'wild')
        pendingCardIdx: null,       // Pointer for color-selection callbacks
        pendingCardElement: null,   // Element reference for animations
        turn: null,                 // Current active player ID
        direction: null,            // 1 (Clockwise) or -1 (Counter)
        isDrawing: false,           // Drawing animation semaphore
        isPlaying: false            // Play animation semaphore
    };

    /**
     * --- Animation Engine ---
     */
    const animations = {
        duration: 800,              // Speed of the "flying" card transition
        
        /**
         * Orchestrates the 3D draw animation from deck to hand.
         * 
         * @param {function} callback - Execution hook after animation completes
         */
        animateDraw(callback) {
            if (!els.deck || !els.myHand) return;
            const deckRect = els.deck.getBoundingClientRect();
            const handRect = els.myHand.getBoundingClientRect();
            
            // Target: Center of the user's hand container
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
            
            // Performance: trigger transition in the next paint cycle
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
        
        /**
         * Orchestrates the 3D play animation from hand to discard pile.
         * 
         * @param {HTMLElement} cardElement - The specific card being played
         * @param {function} callback - Post-animation hook
         */
        animatePlay(cardElement, callback) {
            if (!cardElement || !els.discardPile) return;
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
            
            // Visual: hide actual card from hand during flight
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

    /**
     * --- Action Handlers ---
     */

    // Interaction: Handle card drawing
    els.deck.addEventListener('click', () => {
        if (!gameState.isMyTurn) {
            showToast('Not your turn!');
            return;
        }
        
        // Semaphore: prevent multiple draw requests
        if (gameState.isDrawing) return;
        gameState.isDrawing = true;

        // UI: physical press feedback
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

    /**
     * Logic: playCard
     * Determines whether to trigger color picking or immediate play.
     * 
     * @param {number} index - Position in player hand
     */
    window.playCard = function(index) {
        if (!gameState.isMyTurn) {
            showToast('Not your turn!');
            return;
        }

        const card = gameState.myHand[index];
        const cardElement = els.myHand.children[index];

        // Workflow: Wild cards require a color choice before submission
        if (card.startsWith('wild')) {
            gameState.pendingCardIdx = index;
            gameState.pendingCardElement = cardElement;
            showColorPicker();
        } else {
            sendMove(index, null, cardElement);
        }
    };

    /**
     * Displays the color selection overlay.
     */
    function showColorPicker() {
        if (els.colorModal) els.colorModal.style.display = 'block';
    }

    /**
     * Resolution: pickColor
     * Completes the Wild card workflow with the user's color selection.
     */
    window.pickColor = function(color) {
        if (els.colorModal) els.colorModal.style.display = 'none';
        if (gameState.pendingCardIdx !== null) {
            sendMove(gameState.pendingCardIdx, color, gameState.pendingCardElement);
            gameState.pendingCardIdx = null;
            gameState.pendingCardElement = null;
        }
    };

    /**
     * Action: sendMove
     * Transmits the chosen card index and color to the server.
     * Orchestrates the play animation.
     */
    function sendMove(idx, color, cardElement) {
        if (gameState.isPlaying) return;
        gameState.isPlaying = true;

        gameState.isMyTurn = false; // UI: lock interaction
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

    /**
     * --- UI Rendering Engine ---
     */

    /**
     * UI Component: renderCard
     * Creates a card DOM node with correct sprite positioning.
     * 
     * @param {string} cardString - Key (e.g., 'blue_reverse')
     * @param {boolean} isPlayable - Interaction flag
     * @param {number} index - Optional index for event context
     * @returns {HTMLElement} - Card node
     */
    function renderCard(cardString, isPlayable = false, index = -1) {
        const card = parseCard(cardString);
        
        const div = document.createElement('div');
        div.className = `uno-card`;
        
        // Logic: Correct % for 14x8 sprite grid: (index / (total_units - 1)) * 100
        const pctX = (card.col / 13) * 100;
        const pctY = (card.row / 7) * 100;
        div.style.backgroundPosition = `${pctX}% ${pctY}%`;

        if (isPlayable) {
            div.onclick = () => window.playCard(index);
            div.classList.add('is-playable');
        } else {
            div.classList.add('uno-disabled');
        }
        
        return div;
    }

    /**
     * Logic: parseCard
     * Maps a card string to its coordinate system in the sprite asset.
     * 
     * @param {string} cardString - Server card identifier
     * @returns {Object} - Metadata {color, val, col, row}
     */
    function parseCard(cardString) {
        // Fallback: red 0
        let res = { color: 'red', val: '0', col: 0, row: 0 };
        
        // Specific: handle standalone wild cards
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
        
        return res;
    }

    /**
     * Interface: shoutUno
     * Registers an "UNO!" declaration for the current player.
     */
    window.shoutUno = function() {
        fetch('/uno/shout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `id=${config.gameId}`
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showToast(`${getIcon('shout')} You shouted UNO!`, 2000);
                syncGame();
            }
        });
    };

    /**
     * Logic: syncGame
     * Performs comprehensive re-synchronization of board and player state.
     */
    function syncGame() {
        fetch(`/uno/play/${config.gameId}`, {
            method: 'GET',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        })
        .then(res => res.json())
        .then(data => {
            const oldTurn = gameState.turn;
            const oldDirection = gameState.direction;
            
            // Update master local state
            gameState.myHand = data.myhand || [];
            gameState.turn = data.turn;
            gameState.direction = data.direction;
            gameState.isMyTurn = (data.turn === config.myId && data.status === 'active');

            // UI: Handle "UNO!" shout button visibility (only on 2 cards remaining)
            const shoutBtn = document.getElementById('uno-shout-container');
            if (shoutBtn) {
                if (gameState.myHand.length === 2 && gameState.isMyTurn) {
                    shoutBtn.classList.add('visible');
                } else {
                    shoutBtn.classList.remove('visible');
                }
            }

            // UI: Feedback for Direction reversals
            if (oldDirection !== undefined && oldDirection !== data.direction) {
                showToast(`Direction: ${data.direction === 1 ? 'Clockwise ' + getIcon('back') : 'Counter-Clockwise ' + getIcon('back')}`);
            }

            // Scenario: Game Resolution
            if (data.status === 'finished') {
                if (data.winner === config.myId) {
                    showToast(`${getIcon('victory')} You Win! ${getIcon('victory')}`, 3000);
                } else {
                    const winnerName = data.players.find(p => p.id === data.winner)?.name || 'Someone';
                    showToast(`${getIcon('loss')} ${winnerName} Wins!`, 3000);
                }
                updateTurnIndicators(null);
                return;
            }

            // UI: Re-render player hand with playable logic
            const topCard = data.topcard;
            els.myHand.innerHTML = '';
            gameState.myHand.forEach((card, idx) => {
                const isPlayable = canPlayCard(card, topCard, data.color);
                const cardEl = renderCard(card, isPlayable && gameState.isMyTurn, idx);
                els.myHand.appendChild(cardEl);
            });

            if (els.myCardCount) els.myCardCount.textContent = `${gameState.myHand.length} cards`;

            // UI: Sync Discard Pile
            if (els.discardPile) {
                els.discardPile.innerHTML = '';
                els.discardPile.appendChild(renderCard(topCard));
            }

            // UI Logic: relative opponent slot mapping
            const opponents = data.players.filter(p => p.id !== config.myId);
            const slots = ['left', 'top', 'right'];
            slots.forEach(s => {
                const panel = document.getElementById(`opp-slot-${s}`);
                if (panel) {
                    panel.style.visibility = 'hidden';
                    const oldHandDisplay = panel.querySelector('.opponent-hand-display');
                    if (oldHandDisplay) oldHandDisplay.remove();
                }
            });

            opponents.forEach(opp => {
                // Resolution: determine clockwise position relative to current user
                let relativePos = (opp.role - config.myRole + 4) % 4;
                let slotName;
                if (relativePos === 1) slotName = 'left';
                if (relativePos === 2) slotName = 'top';
                if (relativePos === 3) slotName = 'right';

                const panel = document.getElementById(`opp-slot-${slotName}`);
                if (!panel) return;

                panel.style.visibility = 'visible';
                panel.querySelector('.player-name').textContent = (opp.said_uno ? getIcon('shout') + ' ' : '') + opp.name;

                // Visual: build card back hand display for opponents
                const handDisplay = document.createElement('div');
                handDisplay.className = 'opponent-hand-display';
                for (let i = 0; i < opp.card_count; i++) {
                    const cardBack = document.createElement('div');
                    cardBack.className = 'opponent-hand-card-back';
                    handDisplay.appendChild(cardBack);
                }
                panel.querySelector('.player-details').appendChild(handDisplay);

                // Turn Focus: apply glow to active opponent
                if (data.turn === opp.id) {
                    panel.classList.add('active');
                } else {
                    panel.classList.remove('active');
                }
            });

            updateTurnIndicators(data.turn);

            // Visual: sync active wild color dot
            const colorMap = { red: '#ef4444', blue: '#3b82f6', green: '#22c55e', yellow: '#eab308' };
            if (els.colorDot) els.colorDot.style.backgroundColor = colorMap[data.color] || '#8b5cf6';
        });
    }

    /**
     * Logic: canPlayCard
     * Implements core UNO matching rules.
     * 
     * @param {string} card - Card in hand
     * @param {string} topCard - Card on discard pile
     * @param {string} currentColor - Active wild color
     * @returns {boolean}
     */
    function canPlayCard(card, topCard, currentColor) {
        // Rule: Wilds are always playable
        if (card.startsWith('wild')) return true;
        
        const [cardColor, cardVal] = card.split('_');
        const [topColor, topVal] = topCard.split('_');
        
        // Rule: Match by color
        if (cardColor === currentColor) return true;
        // Rule: Match by value/symbol
        if (cardVal && topVal && cardVal === topVal) return true;
        
        // Edge Case: handle playing on a Wild (server provides active 'color')
        if (topColor === 'wild' && cardColor === currentColor) return true;

        return false;
    }

    /**
     * UI: updateTurnIndicators
     * Manages visual glow states for active players.
     */
    function updateTurnIndicators(activeTurnId) {
        if (activeTurnId === config.myId) {
            if (els.myPanel) els.myPanel.classList.add('active');
            if (els.deck.parentElement) els.deck.parentElement.classList.add('my-turn');
        } else {
            if (els.myPanel) els.myPanel.classList.remove('active');
            if (els.deck.parentElement) els.deck.parentElement.classList.remove('my-turn');
        }
    }

    /**
     * Interface: showToast
     * Displays transient status messages within the game container.
     */
    function showToast(message, duration = 1500) {
        if (!els.statusToast) return;
        els.statusToast.textContent = message;
        els.statusToast.classList.add('show');
        setTimeout(() => {
            els.statusToast.classList.remove('show');
        }, duration);
    }

    // Lifecycle: Bootstrap sync loop (2s)
    syncGame();
    setInterval(syncGame, 2000);
});
