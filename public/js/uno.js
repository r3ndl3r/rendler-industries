/**
 * UNO Online Game Module
 * 
 * Orchestrates a multiplayer UNO experience using a 100% SPA architecture.
 * Manages the transition from lobby discovery to real-time gameplay.
 */

let STATE = {
    view: 'lobby', // 'lobby' or 'game'
    game_id: null,
    game: null,
    lobbies: [],
    pendingAction: false,
    colorPickerResolve: null,
    drawnCardPlayable: false,
    prevTopCard: null,
    failCount: 0
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
    
    // Global dependency check
    if (typeof window.apiPost !== 'function' || typeof window.apiGet !== 'function') {
        const app = document.getElementById('uno-app');
        if (app) app.innerHTML = '<div class="error-state"><p>🃏 Application failed to load. Please refresh.</p></div>';
        return;
    }

    loadInitialState();
    startPolling();
});

/**
 * Helper: Escapes HTML to prevent XSS.
 * Locally defined as a defensive fallback if global is missing.
 * @param {string} str - String to escape.
 * @returns {string} Escaped string.
 */
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * State: Fetches the appropriate state based on current view.
 * @returns {Promise<void>}
 */
async function loadState() {
    if (STATE.view === 'game') {
        await loadGameState();
    } else {
        await loadLobbyState();
    }
}

/**
 * State: Fetches initial data and starts synchronization poll.
 * @returns {Promise<void>}
 */
async function loadInitialState() {
    await loadState();
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
        if (STATE.colorPickerResolve) return; // Don't sync while picking color

        // Stop polling if game is finished
        if (STATE.game && STATE.game.status === 'finished') {
            clearInterval(SYNC_INTERVAL);
            SYNC_INTERVAL = null;
            return;
        }

        loadState();
    }, 2000); 
}

/**
 * API: Fetches open lobbies from the server.
 * @returns {Promise<void>}
 */
async function loadLobbyState() {
    try {
        const data = await window.apiGet('/uno/api/lobby');
        if (data && data.success) {
            STATE.lobbies = data.lobbies;
            renderUI();
        }
    } catch (err) {
        console.error("Failed to load UNO lobbies:", err);
    }
}

/**
 * API: Fetches detailed state for the active game.
 * @returns {Promise<void>}
 */
async function loadGameState() {
    if (!STATE.game_id) return;
    try {
        const data = await window.apiGet(`/uno/api/game/${STATE.game_id}`);
        if (data && data.success) {
            STATE.failCount = 0;
            
            // Action Card Toasts
            if (STATE.game && (STATE.game.top_card !== data.game.top_card || STATE.game.color !== data.game.color)) {
                const tc = data.game.top_card;
                const tcVal = tc.split('_').slice(1).join('_');
                if (tcVal === 'skip') window.showToast("Skip played!", "warning");
                else if (tcVal === 'reverse') window.showToast("Direction reversed!", "info");
                else if (tcVal === 'draw2') window.showToast("+2 Cards played!", "danger");
                else if (tc === 'wild_draw4') window.showToast("+4 Cards played!", "danger");
            }
            
            // Sync drawnCardPlayable from server field
            if (data.game && data.game.turn !== data.game.current_user_id) {
                STATE.drawnCardPlayable = false;
            } else if (data.game && data.game.player_drawn_this_turn) {
                STATE.drawnCardPlayable = !!data.game.player_drawn_this_turn;
            }
            
            STATE.game = data.game;
            renderUI();
        } else if (data && data.error === 'Game not found') {
            exitToLobby();
        }
    } catch (err) {
        console.error("Failed to load UNO game state:", err);
        STATE.failCount++;
        // Network disconnect warning
        if (STATE.failCount === 2) {
            window.showToast("Connection issues detected. Trying to reconnect...", "warning");
        }
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
            <h1>🃏 UNO Lobby</h1>
            <div class="manage-actions">
                <button onclick="createGame(this)" class="btn-emerald">Create Game</button>
            </div>
        </div>

        <div class="lobby-grid">
            ${STATE.lobbies.map(l => `
                <div class="lobby-card">
                    <div class="lobby-card-info">
                        <h3 class="lobby-card-title">${escapeHtml(l.host_name)}'s Game</h3>
                        <div class="lobby-card-meta">
                            <span>Created: ${window.format_datetime(l.created_at)}</span>
                            <span class="player-count-badge">${l.player_count}/4 Players</span>
                        </div>
                    </div>
                    <button onclick="joinGame(${l.id}, this)" class="btn-slate lobby-join-btn">Join Game</button>
                </div>
            `).join('')}
            ${STATE.lobbies.length === 0 ? `
                <div class="empty-state">
                    <p>🃏 No games waiting. Create one to start!</p>
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
                <button onclick="leaveGame(this)" class="btn-slate">Leave</button>
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
                            <div class="player-card-actions">
                                <span class="ready-label ${p.ready ? 'is-ready' : 'not-ready'}">
                                    ${p.ready ? 'Ready' : 'Not Ready'}
                                </span>
                                ${isHost && p.id !== STATE.game.current_user_id ? `<button onclick="kickPlayer(${p.id}, this)" class="btn-danger btn-small">Kick</button>` : ''}
                            </div>
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
    const mustDraw = isMyTurn && !hasPlayable && !STATE.drawnCardPlayable;

    let html = `
        <div class="game-table-container">
            <div class="game-info-overlay">
                <div class="current-color-indicator ${STATE.game.color}">
                    ${STATE.game.color}
                </div>
                <div class="game-direction">
                    ${STATE.game.direction === 1 ? '↻ Clockwise' : '↺ Counter-Clockwise'}
                </div>
                <button onclick="leaveGame(this)" class="btn-slate btn-small-exit">Exit Game</button>
            </div>

            <div class="opponents-grid">
                ${orderedPlayers.map((p, i) => i === 0 ? '' : `
                    <div class="player-slot slot-${i} ${STATE.game.turn === p.id ? 'active-turn' : ''}">
                        <div class="player-avatar">
                            ${window.getUserIcon ? window.getUserIcon(p.name) : '<div class="default-avatar">' + p.name.charAt(0).toUpperCase() + '</div>'}
                        </div>
                        <div class="player-meta">
                            <span class="player-name">${escapeHtml(p.name)}</span>
                            <span class="card-count">${p.card_count} Cards</span>
                            ${p.said_uno ? '<span class="uno-badge">UNO!</span>' : ''}
                            ${p.card_count === 1 && !p.said_uno ? `<button onclick="catchUno(${p.id}, this)" class="btn-danger btn-small catch-btn">Catch!</button>` : ''}
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
                    <div class="user-actions">
                        ${STATE.drawnCardPlayable ? `<button onclick="passTurn(this)" class="btn-slate btn-pass">Pass Turn</button>` : ''}
                        ${myHand.length <= 2 ? `<button onclick="shoutUno(this)" class="btn-shout ${myHand.length <= 2 ? 'highlight' : ''}">UNO!</button>` : ''}
                    </div>
                </div>
                <div class="hand-container">
                    ${myHand.map((c, idx) => `
                        <div class="card-wrapper" data-idx="${idx}" data-card="${escapeHtml(c)}" onclick="playCard(this.dataset.idx, this.dataset.card, this)">
                            ${renderCard(c, isMyTurn && canPlay(c) ? 'playable' : '')}
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
    container.innerHTML = html;

    if (STATE.game.status === 'finished') {
        showWinModal();
    }
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
    const topCard = STATE.game.top_card;
    const [topColor, topValue] = topCard.split('_', 2);
    
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
    if (STATE.game.turn !== STATE.game.current_user_id || STATE.pendingAction) return;
    
    if (!canPlay(card)) {
        window.showToast("Cannot play this card!", "error");
        return;
    }

    let color = null;
    if (card.startsWith('wild')) {
        color = await promptColor();
        if (!color) return; // Cancelled
    }

    STATE.drawnCardPlayable = false;
    apiAction('/uno/api/play_card', { id: STATE.game_id, idx: idx, color: color }, el);
}

/**
 * Action: Draw a card from the deck.
 * @param {HTMLElement} el - Trigger element.
 * @returns {Promise<void>}
 */
async function drawCard(el) {
    if (STATE.game.turn !== STATE.game.current_user_id || STATE.pendingAction) return;
    
    if (STATE.drawnCardPlayable) {
        window.showToast("You already drew. Play the card or pass your turn.", "warning");
        return;
    }

    STATE.pendingAction = true;
    el.classList.add('pending');
    
    try {
        const res = await window.apiPost('/uno/api/draw_card', { id: STATE.game_id });
        if (res && res.success) {
            if (res.playable) {
                STATE.drawnCardPlayable = true;
                window.showToast("You drew a playable card!", "info");
            } else {
                STATE.drawnCardPlayable = false;
            }
            loadGameState();
        }
    } catch (err) {
        console.error("Draw Card Failed:", err);
    } finally {
        STATE.pendingAction = false;
        el.classList.remove('pending');
    }
}

/**
 * Action: Pass turn after drawing a playable card.
 * @param {HTMLElement} btn - Trigger element.
 * @returns {Promise<void>}
 */
async function passTurn(btn) {
    if (STATE.pendingAction) return;
    STATE.pendingAction = true;
    if (btn) btn.classList.add('pending');
    try {
        const res = await window.apiPost('/uno/api/play_card', { id: STATE.game_id, idx: -1 });
        if (res && res.success) {
            STATE.drawnCardPlayable = false;
            loadGameState();
        } else {
            window.showToast(res?.error || "Pass failed", "error");
        }
    } catch (err) {
        console.error("Pass Turn Failed:", err);
    } finally {
        STATE.pendingAction = false;
        if (btn) btn.classList.remove('pending');
    }
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
 * UI Component: Wild color selection overlay.
 * @returns {Promise<string|null>} Resolves to selected color or null.
 */
function promptColor() {
    return new Promise((resolve) => {
        STATE.colorPickerResolve = resolve;
        let overlay = document.getElementById('color-picker-overlay-global');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'color-picker-overlay-global';
            overlay.className = 'color-picker-overlay hidden';
            overlay.innerHTML = `
                <div class="color-picker-content">
                    <h2>Select Color</h2>
                    <div class="color-grid">
                        <button class="color-btn red" onclick="resolveColor('red')"></button>
                        <button class="color-btn blue" onclick="resolveColor('blue')"></button>
                        <button class="color-btn green" onclick="resolveColor('green')"></button>
                        <button class="color-btn yellow" onclick="resolveColor('yellow')"></button>
                    </div>
                    <button class="btn-slate color-picker-cancel" onclick="resolveColor(null)">Cancel</button>
                </div>
            `;
            document.body.appendChild(overlay);
        }
        overlay.classList.remove('hidden');
    });
}

/**
 * Global bridge for color selection.
 * @param {string|null} color - Selected color.
 * @returns {void}
 */
window.resolveColor = (color) => {
    const overlay = document.getElementById('color-picker-overlay-global');
    if (overlay) overlay.classList.add('hidden');
    
    if (STATE.colorPickerResolve) {
        STATE.colorPickerResolve(color);
        STATE.colorPickerResolve = null;
    }
};

/**
 * Action: Create a new game.
 * @param {HTMLElement} btn - Trigger element.
 * @returns {Promise<void>}
 */
async function createGame(btn) {
    if (STATE.pendingAction) return;
    STATE.pendingAction = true;
    if (btn) btn.classList.add('pending');
    try {
        const res = await window.apiPost('/uno/api/create');
        if (res && res.success) {
            STATE.game_id = res.game_id;
            STATE.view = 'game';
            history.pushState(null, '', `/uno/play/${res.game_id}`);
            loadGameState();
            startPolling();
        }
    } catch (err) {
        console.error("Failed to create UNO game:", err);
    } finally {
        STATE.pendingAction = false;
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
    if (STATE.pendingAction) return;
    STATE.pendingAction = true;
    if (btn) btn.classList.add('pending');
    try {
        const res = await window.apiPost('/uno/api/join', { id: id });
        if (res && res.success) {
            STATE.game_id = id;
            STATE.view = 'game';
            history.pushState(null, '', `/uno/play/${id}`);
            loadGameState();
            startPolling();
        }
    } catch (err) {
        console.error("Failed to join UNO game:", err);
    } finally {
        STATE.pendingAction = false;
        if (btn) btn.classList.remove('pending');
    }
}

/**
 * Action: Leave the current game and return to lobby.
 * @param {HTMLElement} btn - Trigger element.
 * @returns {Promise<void>}
 */
async function leaveGame(btn) {
    if (STATE.pendingAction) return;
    STATE.pendingAction = true;
    if (btn) btn.classList.add('pending');
    try {
        const res = await window.apiPost('/uno/api/leave', { id: STATE.game_id });
        if (res && res.success) {
            exitToLobby();
        }
    } catch (err) {
        console.error("Failed to leave UNO game:", err);
    } finally {
        STATE.pendingAction = false;
        if (btn) btn.classList.remove('pending');
    }
}

/**
 * Helper: Transitions back to lobby state.
 * @returns {void}
 */
function exitToLobby() {
    if (SYNC_INTERVAL) {
        clearInterval(SYNC_INTERVAL);
        SYNC_INTERVAL = null;
    }
    const winModal = document.querySelector('.win-modal-body');
    if (winModal) winModal.remove();
    
    STATE.view = 'lobby';
    STATE.game_id = null;
    STATE.game = null;
    STATE.drawnCardPlayable = false;
    STATE.prevTopCard = null;
    STATE.failCount = 0;
    
    if (STATE.colorPickerResolve) {
        window.resolveColor(null);
    }
    STATE.colorPickerResolve = null;

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
 * Appends to body for correct stacking.
 * @returns {void}
 */
function showWinModal() {
    if (document.querySelector('.win-modal-body')) return;
    
    const winnerName = STATE.game.players.find(p => p.id === STATE.game.winner)?.name || "Someone";
    const div = document.createElement('div');
    div.className = 'modal-overlay show win-modal-body win-modal-overlay';
    div.innerHTML = `
        <div class="modal-content win-modal">
            <div class="win-icon">🏆</div>
            <h1 class="win-title">WINNER!</h1>
            <p class="win-message">${escapeHtml(winnerName)} won!</p>
            <button onclick="leaveGame(this)" class="btn-emerald btn-win-action">Return to Lobby</button>
        </div>
    `;
    document.body.appendChild(div);
}

/**
 * Helper: Reorders players for first-person perspective.
 * @param {Object[]} players - List of player objects.
 * @returns {Object[]} Reordered list.
 */
function getOrderedPlayers(players) {
    if (!players || !STATE.game || !STATE.game.current_user_id) return players || [];
    
    const myIndex = players.findIndex(p => Number(p.id) === Number(STATE.game.current_user_id));
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
    if (STATE.pendingAction) return;
    STATE.pendingAction = true;
    if (btn) btn.classList.add('pending');
    try {
        const res = await window.apiPost(url, params);
        if (res && res.success) {
            loadGameState();
        } else if (res && !res.success) {
            window.showToast(res.error || "Action failed", "error");
        }
    } catch (err) {
        console.error("API Action Failed:", url, err);
    } finally {
        STATE.pendingAction = false;
        if (btn) btn.classList.remove('pending');
    }
}

/**
 * Action: Catch a player who forgot to say UNO.
 * @param {number} targetId - User ID to catch.
 * @param {HTMLElement} btn - Trigger element.
 * @returns {void}
 */
function catchUno(targetId, btn) {
    apiAction('/uno/api/catch', { id: STATE.game_id, target_id: targetId }, btn);
}

/**
 * Action: Kick an AFK player from the lobby (Host only).
 * @param {number} targetId - User ID to kick.
 * @param {HTMLElement} btn - Trigger element.
 * @returns {void}
 */
function kickPlayer(targetId, btn) {
    window.showConfirmModal("Kick Player?", "Are you sure you want to kick this player from the game?", () => {
        apiAction('/uno/api/kick', { id: STATE.game_id, target_id: targetId }, btn);
    });
}

window.loadState = loadState;
window.createGame = createGame;
window.joinGame = joinGame;
window.leaveGame = leaveGame;
window.playCard = playCard;
window.drawCard = drawCard;
window.shoutUno = shoutUno;
window.startGame = startGame;
window.apiAction = apiAction;
window.passTurn = passTurn;
window.catchUno = catchUno;
window.kickPlayer = kickPlayer;

