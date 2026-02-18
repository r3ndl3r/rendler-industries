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
        pendingCardElement: null
    };

    const animations = {
        duration: 800,
        
        createFlyingCard(cardHTML, fromRect, toRect) {
            const flyingCard = document.createElement('div');
            flyingCard.className = 'flying-card';
            flyingCard.innerHTML = cardHTML;
            flyingCard.style.position = 'fixed';
            flyingCard.style.left = fromRect.left + 'px';
            flyingCard.style.top = fromRect.top + 'px';
            flyingCard.style.width = fromRect.width + 'px';
            flyingCard.style.height = fromRect.height + 'px';
            flyingCard.style.zIndex = '9999';
            flyingCard.style.pointerEvents = 'none';
            
            document.body.appendChild(flyingCard);
            
            const deltaX = toRect.left - fromRect.left;
            const deltaY = toRect.top - fromRect.top;
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            const midX = fromRect.left + deltaX / 2;
            const midY = fromRect.top + deltaY / 2 - distance * 0.3;
            
            const path = `path("M ${fromRect.left + fromRect.width/2},${fromRect.top + fromRect.height/2} Q ${midX},${midY} ${toRect.left + toRect.width/2},${toRect.top + toRect.height/2}")`;
            
            requestAnimationFrame(() => {
                flyingCard.style.transition = `all ${this.duration}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
                flyingCard.style.left = toRect.left + 'px';
                flyingCard.style.top = toRect.top + 'px';
                flyingCard.style.width = toRect.width + 'px';
                flyingCard.style.height = toRect.height + 'px';
                flyingCard.style.transform = 'rotate(360deg)';
            });
            
            return flyingCard;
        },
        
        animateDraw(callback) {
            const deckRect = els.deck.getBoundingClientRect();
            const handRect = els.myHand.getBoundingClientRect();
            
            const targetRect = {
                left: handRect.left + handRect.width / 2 - 45,
                top: handRect.top + handRect.height / 2 - 67.5,
                width: 90,
                height: 135
            };
            
            const cardHTML = '<div class="uno-card card-back-style"><div class="card-inner"></div></div>';
            const flyingCard = this.createFlyingCard(cardHTML, deckRect, targetRect);
            
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
            
            const cardHTML = cardElement.outerHTML;
            const flyingCard = this.createFlyingCard(cardHTML, cardRect, targetRect);
            
            cardElement.style.opacity = '0';
            
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
        
        gameState.isMyTurn = false;
        updateTurnIndicators();
        
        els.deck.style.transform = 'scale(0.95)';
        setTimeout(() => els.deck.style.transform = '', 100);
        
        animations.animateDraw(() => {
            fetch('/uno/draw_card', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `id=${config.gameId}`
            })
            .then(() => syncGame());
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
        gameState.isMyTurn = false;
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
        let [color, val] = cardString.split('_');
        if (cardString.startsWith('wild')) {
            color = 'wild';
            val = cardString === 'wild' ? 'W' : '+4';
        }
        if (val === 'skip') val = '🚫';
        if (val === 'reverse') val = '🔄';
        if (val === 'draw2') val = '+2';

        const div = document.createElement('div');
        div.className = `uno-card uno-${color}`;
        if (isPlayable) {
            div.onclick = () => window.playCard(index);
        } else if (index !== -1) {
            div.classList.add('uno-disabled');
        }
        div.innerHTML = `<div class="card-inner"><span class="card-val">${val}</span></div>`;
        return div;
    }

    function syncGame() {
        fetch(`/uno/play/${config.gameId}`, {
            method: 'GET',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        })
        .then(res => res.json())
        .then(data => {
            gameState.myHand = data.myhand;
            gameState.isMyTurn = (data.turn === config.myId && data.status === 'active');

            updateTurnIndicators();
            
            if (data.status === 'finished') {
                if (data.winner === config.myId) {
                    showToast('🎉 You Win! 🎉', 3000);
                } else {
                    showToast('💔 You Lose', 3000);
                }
                return;
            }

            els.oppHand.innerHTML = '';
            for (let i = 0; i < data.oppcount; i++) {
                const back = document.createElement('div');
                back.className = 'card-back';
                els.oppHand.appendChild(back);
            }

            const topCard = data.topcard;
            els.discardPile.innerHTML = '';
            if (topCard) {
                const discardCard = renderCard(topCard);
                els.discardPile.appendChild(discardCard);
            }

            els.myHand.innerHTML = '';
            gameState.myHand.forEach((card, idx) => {
                const isPlayable = canPlayCard(card, topCard, data.color);
                const cardEl = renderCard(card, isPlayable && gameState.isMyTurn, idx);
                els.myHand.appendChild(cardEl);
            });

            const colorMap = { red: '#ef4444', blue: '#3b82f6', green: '#22c55e', yellow: '#eab308' };
            els.colorDot.style.backgroundColor = colorMap[data.color] || '#8b5cf6';

            if (els.myCardCount) els.myCardCount.textContent = `${gameState.myHand.length} cards`;
            if (els.oppCardCount) els.oppCardCount.textContent = `${data.oppcount} cards`;
        });
    }

    function canPlayCard(card, topCard, currentColor) {
        if (card.startsWith('wild')) return true;
        
        const [cardColor, cardVal] = card.split('_');
        const [topColor, topVal] = topCard.split('_');
        
        if (cardColor === currentColor) return true;
        if (cardVal && topVal && cardVal === topVal) return true;
        
        return false;
    }

    function updateTurnIndicators() {
        if (gameState.isMyTurn) {
            els.myPanel.classList.add('active');
            els.oppPanel.classList.remove('active');
            if (els.deck.parentElement) els.deck.parentElement.classList.add('my-turn');
        } else {
            els.myPanel.classList.remove('active');
            els.oppPanel.classList.add('active');
            if (els.deck.parentElement) els.deck.parentElement.classList.remove('my-turn');
        }
    }

    function showToast(message, duration = 1500) {
        els.statusToast.textContent = message;
        els.statusToast.classList.add('show');
        setTimeout(() => {
            els.statusToast.classList.remove('show');
        }, duration);
    }

    syncGame();
    setInterval(syncGame, 2000);
});
