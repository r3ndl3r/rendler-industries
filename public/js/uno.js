/**
 * UNO Online Game Module
 * 
 * Orchestrates a multiplayer UNO experience using a 100% SPA architecture.
 * Manages the transition from lobby discovery to real-time gameplay.
 * 
 * Features:
 * - Real-time matchmaking and lobby creation.
 * - Secure card masking (opponent hands are hidden).
 * - Polling-based state synchronization for multiplayer turns.
 * - Dynamic card rendering and interaction.
 * - Wild color selection workflow via unified confirm modal.
 * - Visual affordances for drawing and shouting UNO.
 */

let STATE = {
    view: 'lobby', // 'lobby' or 'game'
    game_id: null,
    game: null,
    lobbies: []
};

let SYNC_INTERVAL = null;

/**
 * Lifecycle: Entry point for the UNO application.
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', () => {
    // Determine initial view based on URL
    const match = window.location.pathname.match(/\/uno\/play\/(\d+)/);
    if (match) {
        STATE.game_id = match[1];
        STATE.view = 'game';
    } else {
        STATE.view = 'lobby';
    }
    
    loadInitialState();
});

/**
 * State: Fetches initial data and starts synchronization poll.
 * @returns {Promise<void>}
 */
async function loadInitialState() {
    if (STATE.view === 'game') {
        await loadGameState(true);
        startPolling();
    } else {
        await loadLobbyState();
        startPolling();
    }
}

/**
 * Polling: Recurring state synchronization.
 * @returns {void}
 */
function startPolling() {
    if (SYNC_INTERVAL) clearInterval(SYNC_INTERVAL);
    SYNC_INTERVAL = setInterval(() => {
        // Inhibition: Skip sync if user is interacting with modal or inputs
        if (document.querySelector('.modal-overlay.show')) return;
        if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

        if (STATE.view === 'game') {
            loadGameState();
        } else {
            loadLobbyState();
        }
    }, 2000); 
}

/**
 * API: Fetches open lobbies from the server.
 * @returns {Promise<void>}
 */
async function loadLobbyState() {
    try {
        const res = await fetch('/uno/api/lobby');
        const data = await res.json();
        if (data.success) {
            STATE.lobbies = data.lobbies;
            renderUI();
        }
    } catch (err) {
        console.error("Failed to load UNO lobbies:", err);
    }
}

/**
 * API: Fetches detailed state for the active game.
 * @param {boolean} force - If true, bypasses synchronization logic (currently unused).
 * @returns {Promise<void>}
 */
async function loadGameState(force = false) {
    if (!STATE.game_id) return;
    try {
        const res = await fetch(`/uno/api/game/${STATE.game_id}`);
        const data = await res.json();
        if (data.success) {
            STATE.game = data.game;
            renderUI();
        } else if (res.status === 404) {
            // Kick to lobby only if game is missing/deleted
            STATE.view = 'lobby';
            STATE.game_id = null;
            history.pushState(null, '', '/uno');
            renderUI();
        }
    } catch (err) {
        console.error("Failed to load UNO game state:", err);
    }
}

/**
 * UI: Main rendering router.
 * @returns {void}
 */
function renderUI() {
    const container = document.getElementById('uno-app');
    if (!container) return;

    container.classList.remove('component-loading');

    if (STATE.view === 'lobby') {
        renderLobby(container);
    } else {
        renderGame(container);
    }
}

/**
 * Phase: Lobby - Matchmaking and game creation.
 * @param {HTMLElement} container - Target container.
 * @returns {void}
 */
function renderLobby(container) {
    let html = `
        <div class="header-bar">
            <h1>UNO Lobby</h1>
            <div class="manage-actions">
                <button onclick="createGame(this)" class="btn-emerald">Create Game</button>
            </div>
        </div>

        <div class="lobby-grid">
            ${STATE.lobbies.map(l => `
                <div class="lobby-card">
                    <div class="lobby-card-info">
                        <h3 class="lobby-card-title">${escapeHtml(l.host_name)}'s Game</h3>
                        <p class="lobby-card-meta">Created: ${l.created_at}</p>
                    </div>
                    <button onclick="joinGame(${l.id}, this)" class="btn-slate lobby-join-btn">Join Game</button>
                </div>
            `).join('')}
            ${STATE.lobbies.length === 0 ? `
                <div class="empty-state">
                    <p>No games waiting. Create one to start!</p>
                </div>
            ` : ''}
        </div>
    `;
    container.innerHTML = html;
}

/**
 * Phase: Game - Active gameplay board.
 * @param {HTMLElement} container - Target container.
 * @returns {void}
 */
function renderGame(container) {
    if (!STATE.game) return;

    if (STATE.game.status === 'waiting') {
        renderWaitingRoom(container);
    } else {
        renderBoard(container);
    }
}

/**
 * View: Waiting Room - Lobby before game start.
 * @param {HTMLElement} container - Target container.
 * @returns {void}
 */
function renderWaitingRoom(container) {
    const isHost = STATE.game.player_role === 1;
    const allReady = STATE.game.players.every(p => p.ready);
    const minPlayers = STATE.game.players.length >= 2;

    let html = `
        <div class="header-bar">
            <h1>Waiting Room</h1>
            <div class="manage-actions">
                <button onclick="leaveGame()" class="btn-slate">Leave</button>
            </div>
        </div>

        <div class="waiting-room-container">
            <div class="waiting-room-card">
                <div class="waiting-player-list">
                    ${STATE.game.players.map(p => `
                        <div class="player-card">
                            <div class="player-card-identity">
                                <span class="ready-indicator ${p.ready ? 'is-ready' : 'not-ready'}"></span>
                                <span class="player-card-name">${escapeHtml(p.name)} ${p.role === 1 ? '(Host)' : ''}</span>
                            </div>
                            <span class="ready-label ${p.ready ? 'is-ready' : 'not-ready'}">
                                ${p.ready ? 'Ready' : 'Not Ready'}
                            </span>
                        </div>
                    `).join('')}
                </div>

                <div class="waiting-room-actions">
                    <button onclick="apiAction('/uno/api/ready', {id: STATE.game_id}, this)" class="btn-purple btn-action-large">
                        ${STATE.game.players.find(p => p.id === STATE.game.current_user_id)?.ready ? 'UNREADY' : 'READY UP'}
                    </button>
                    ${isHost ? `
                        <button onclick="startGame(this)" ${!(allReady && minPlayers) ? 'disabled' : ''} class="btn-emerald btn-action-large ${!(allReady && minPlayers) ? 'btn-disabled' : ''}">
                            START GAME
                        </button>
                    ` : '<p class="waiting-status-label">Waiting for host to start...</p>'}
                </div>
            </div>
        </div>
    `;
    container.innerHTML = html;
}

/**
 * View: Board - The main UNO table.
 * @param {HTMLElement} container - Target container.
 * @returns {void}
 */
function renderBoard(container) {
    const isMyTurn = STATE.game.turn === STATE.game.current_user_id;
    const myHand = STATE.game.my_hand || [];
    const players = STATE.game.players;
    const topCard = STATE.game.top_card;
    
    const orderedPlayers = getOrderedPlayers(players);
    const hasPlayable = myHand.some(c => canPlay(c));
    const mustDraw = isMyTurn && !hasPlayable;

    let html = `
        <div class="game-table-container">
            <div class="game-info-overlay">
                <div class="current-color-indicator ${STATE.game.color}">
                    ${STATE.game.color}
                </div>
                <div class="game-direction">
                    ${STATE.game.direction === 1 ? '↻ Clockwise' : '↺ Counter-Clockwise'}
                </div>
            </div>

            <div class="opponents-grid">
                ${orderedPlayers.map((p, i) => i === 0 ? '' : `
                    <div class="player-slot slot-${i} ${STATE.game.turn === p.id ? 'active-turn' : ''}">
                        <div class="player-avatar">
                            ${window.getIcon('user')}
                        </div>
                        <div class="player-meta">
                            <span class="player-name">${escapeHtml(p.name)}</span>
                            <span class="card-count">${p.card_count} Cards</span>
                            ${p.said_uno ? '<span class="uno-badge">UNO!</span>' : ''}
                        </div>
                    </div>
                `).join('')}
            </div>

            <div class="table-center">
                <div class="deck-area ${mustDraw ? 'must-draw' : ''}" onclick="drawCard(this)">
                    <div class="uno-card back">
                        <div class="uno-logo">UNO</div>
                    </div>
                </div>
                <div class="discard-area">
                    ${renderCard(topCard)}
                </div>
            </div>

            <div class="user-area">
                <div class="user-meta">
                    <span class="user-name">Your Hand</span>
                    ${isMyTurn ? '<span class="turn-label">YOUR TURN</span>' : ''}
                    <button onclick="shoutUno(this)" class="btn-shout ${myHand.length <= 2 ? 'highlight' : ''}">UNO!</button>
                </div>
                <div class="hand-container">
                    ${myHand.map((c, idx) => `
                        <div class="card-wrapper" onclick="playCard(${idx}, '${c}', this)">
                            ${renderCard(c, isMyTurn && canPlay(c) ? 'playable' : '')}
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>

        ${STATE.game.status === 'finished' ? renderWinModal() : ''}
    `;
    container.innerHTML = html;
}

/**
 * UI Component: Card Renderer.
 * @param {string} card - Card identifier.
 * @param {string} extraClass - Optional CSS classes.
 * @returns {string} HTML fragment.
 */
function renderCard(card, extraClass = '') {
    if (!card) return '';
    const [color, value] = card.split('_', 2);
    const isWild = color === 'wild';
    const displayValue = value ? value.replace('draw2', '+2').replace('reverse', '⇄').replace('skip', '⊘') : 'W';
    const finalValue = card === 'wild_draw4' ? '+4' : displayValue;

    return `
        <div class="uno-card ${isWild ? 'wild' : color} ${extraClass}">
            <div class="card-inner">
                <div class="card-top-left">${finalValue}</div>
                <div class="card-center">${finalValue}</div>
                <div class="card-bottom-right">${finalValue}</div>
            </div>
        </div>
    `;
}

/**
 * Logic: Card validation.
 * @param {string} card - Card identifier.
 * @returns {boolean} True if card can be played.
 */
function canPlay(card) {
    if (card.startsWith('wild')) return true;
    const [color, value] = card.split('_', 2);
    const [topColor, topValue] = STATE.game.top_card.split('_', 2);
    
    if (color === STATE.game.color) return true;
    if (value && topValue && value === topValue) return true;
    return false;
}

/**
 * Action: Play a card from hand.
 * @param {number} idx - Hand index.
 * @param {string} card - Card identifier.
 * @param {HTMLElement} el - Trigger element.
 * @returns {Promise<void>}
 */
async function playCard(idx, card, el) {
    if (STATE.game.turn !== STATE.game.current_user_id) return;
    if (!canPlay(card)) return;

    let color = null;
    if (card.startsWith('wild')) {
        color = await promptColor();
        if (!color) return; // Cancelled
    }

    apiAction('/uno/api/play_card', { id: STATE.game_id, idx: idx, color: color }, el);
}

/**
 * Action: Draw a card from the deck.
 * @param {HTMLElement} el - Trigger element.
 * @returns {void}
 */
function drawCard(el) {
    if (STATE.game.turn !== STATE.game.current_user_id) return;
    apiAction('/uno/api/draw_card', { id: STATE.game_id }, el);
}

/**
 * Action: Shout "UNO!".
 * @param {HTMLElement} btn - Trigger element.
 * @returns {void}
 */
function shoutUno(btn) {
    apiAction('/uno/api/shout', { id: STATE.game_id }, btn);
}

/**
 * UI Component: Wild color selection modal.
 * @returns {Promise<string|null>} Resolves to selected color or null.
 */
function promptColor() {
    return new Promise((resolve) => {
        window.showConfirmModal({
            title: 'Select Color',
            icon: 'ai',
            hideCancel: false,
            persistent: true,
            confirmText: 'Cancel', // We hijack the modal's internal structure for a grid
            onConfirm: () => resolve(null),
            onCancel: () => resolve(null),
            message: `
                <div class="color-grid">
                    <button class="color-btn red" onclick="window.resolveUnoColor('red')"></button>
                    <button class="color-btn blue" onclick="window.resolveUnoColor('blue')"></button>
                    <button class="color-btn green" onclick="window.resolveUnoColor('green')"></button>
                    <button class="color-btn yellow" onclick="window.resolveUnoColor('yellow')"></button>
                </div>
            `
        });

        // Global bridge for the modal buttons
        window.resolveUnoColor = (color) => {
            window.closeConfirmModal();
            resolve(color);
        };
    });
}

/**
 * Action: Create a new game.
 * @param {HTMLElement} btn - Trigger element.
 * @returns {Promise<void>}
 */
async function createGame(btn) {
    if (btn) btn.classList.add('pending');
    try {
        const res = await window.apiPost('/uno/api/create');
        if (res && res.success) {
            STATE.game_id = res.game_id;
            STATE.view = 'game';
            history.pushState(null, '', `/uno/play/${res.game_id}`);
            loadGameState(true);
        }
    } catch (err) {
        console.error("Failed to create UNO game:", err);
    } finally {
        if (btn) btn.classList.remove('pending');
    }
}

/**
 * Action: Join an existing game.
 * @param {number} id - Game ID.
 * @param {HTMLElement} btn - Trigger element.
 * @returns {Promise<void>}
 */
async function joinGame(id, btn) {
    if (btn) btn.classList.add('pending');
    try {
        const res = await window.apiPost('/uno/api/join', { id: id });
        if (res && res.success) {
            STATE.game_id = id;
            STATE.view = 'game';
            history.pushState(null, '', `/uno/play/${id}`);
            loadGameState(true);
        }
    } catch (err) {
        console.error("Failed to join UNO game:", err);
    } finally {
        if (btn) btn.classList.remove('pending');
    }
}

/**
 * Action: Leave the current game and return to lobby.
 * @returns {void}
 */
function leaveGame() {
    if (SYNC_INTERVAL) {
        clearInterval(SYNC_INTERVAL);
        SYNC_INTERVAL = null;
    }
    STATE.view = 'lobby';
    STATE.game_id = null;
    STATE.game = null;
    history.pushState(null, '', '/uno');
    loadLobbyState();
    startPolling();
}

/**
 * Action: Start the game (Host only).
 * @param {HTMLElement} btn - Trigger element.
 * @returns {void}
 */
function startGame(btn) {
    apiAction('/uno/api/start', { id: STATE.game_id }, btn);
}

/**
 * UI Component: Win modal.
 * @returns {string} HTML fragment.
 */
function renderWinModal() {
    const winnerName = STATE.game.players.find(p => p.id === STATE.game.winner)?.name || "Someone";
    return `
        <div class="modal-overlay show win-view">
            <div class="modal-content win-modal">
                <div class="win-icon">${window.getIcon('trophy')}</div>
                <h1 class="win-title">WINNER!</h1>
                <p class="win-message">${escapeHtml(winnerName)} won!</p>
                <button onclick="leaveGame()" class="btn-emerald btn-win-action">Return to Lobby</button>
            </div>
        </div>
    `;
}

/**
 * Helper: Reorders players for first-person perspective.
 * @param {Object[]} players - List of player objects.
 * @returns {Object[]} Reordered list.
 */
function getOrderedPlayers(players) {
    if (!players || !STATE.game || !STATE.game.current_user_id) return players || [];
    
    const myIndex = players.findIndex(p => p.id === STATE.game.current_user_id);
    if (myIndex === -1) return players;
    
    const ordered = [];
    for (let i = 0; i < players.length; i++) {
        ordered.push(players[(myIndex + i) % players.length]);
    }
    return ordered;
}

/**
 * Helper: Generic API action handler.
 * @param {string} url - API endpoint.
 * @param {Object} params - Payload.
 * @param {HTMLElement|null} btn - Button element to apply pending state.
 * @returns {Promise<void>}
 */
async function apiAction(url, params = {}, btn = null) {
    if (btn) btn.classList.add('pending');
    try {
        const res = await window.apiPost(url, params);
        if (res && res.success) {
            loadGameState(true);
        }
    } catch (err) {
        console.error("API Action Failed:", url, err);
    } finally {
        if (btn) btn.classList.remove('pending');
    }
}

/**
 * Helper: Sanitizes text for HTML injection.
 * @param {string} text - The unsafe string.
 * @returns {string} Safe HTML string.
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Global exposure
window.createGame = createGame;
window.joinGame = joinGame;
window.leaveGame = leaveGame;
window.playCard = playCard;
window.drawCard = drawCard;
window.shoutUno = shoutUno;
window.startGame = startGame;
window.apiAction = apiAction;

