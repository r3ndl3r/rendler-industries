// /public/js/imposter.js

/**
 * Imposter Game Module
 * 
 * Manages the client-side lifecycle of the Imposter party game.
 * Implements a 100% SPA architecture using centralized state-driven rendering.
 * 
 * Features:
 * - Real-time state synchronization.
 * - Dynamic lobby management with "Add" action buttons.
 * - Turn-based role reveal workflow.
 * - Absolute server-side timer synchronization.
 * - Multi-language hint support.
 */

let STATE = {
    game: { status: 'lobby' },
    lobby: [],
    lang: 'en',
    now: 0
};

let TIMER_INTERVAL = null;

/**
 * Lifecycle: Initialize application state on DOM load.
 */
document.addEventListener('DOMContentLoaded', () => {
    loadState(true);
});

/**
 * State: Fetches current game and lobby data from the server.
 * 
 * @param {boolean} force - If true, bypasses inhibition guards.
 * @returns {Promise<void>}
 */
async function loadState(force = false) {
    // Inhibition: Prevent sync during active input or active modal
    if (!force) {
        if (document.querySelector('.modal-overlay.show')) return;
        if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    }

    try {
        const res = await fetch('/imposter/api/state');
        const data = await res.json();
        if (data.success) {
            STATE.game = data.game;
            STATE.lobby = data.lobby;
            STATE.lang = data.lang;
            STATE.now = data.now;
            renderUI();
        }
    } catch (err) {
        console.error("Failed to load Imposter state:", err);
    }
}

/**
 * UI: Orchestrates the rendering of the active game phase.
 * @returns {void}
 */
function renderUI() {
    const container = document.getElementById('imposter-game');
    if (!container) return;

    // Remove loading skeleton on first successful render
    container.classList.remove('component-loading');

    if (STATE.game.status === 'lobby') {
        renderLobby(container);
    } else if (STATE.game.status === 'passing') {
        renderPassing(container);
    } else if (STATE.game.status === 'timer') {
        renderTimer(container);
    } else if (STATE.game.status === 'finished') {
        renderResults(container);
    }
}

/**
 * Phase: Lobby - Player management and game configuration.
 * @param {HTMLElement} container - The DOM container.
 * @returns {void}
 */
function renderLobby(container) {
    if (TIMER_INTERVAL) {
        clearInterval(TIMER_INTERVAL);
        TIMER_INTERVAL = null;
    }

    let lobbyHtml = `
        <div class="header-bar">
            <h1>Imposter</h1>
            <div class="manage-actions"></div>
        </div>

        <div class="player-grid">
            ${STATE.lobby.map(player => `
                <div class="player-card">
                    <span class="player-card-name">${escapeHtml(player)}</span>
                    <div class="player-card-actions">
                        <button onclick="editPlayer('${escapeHtml(player).replace(/'/g, "\\'")}')" class="btn-icon-edit">
                            ${window.getIcon('edit')}
                        </button>
                        <button onclick="removePlayer('${escapeHtml(player).replace(/'/g, "\\'")}')" class="btn-icon-delete">
                            ${window.getIcon('delete')}
                        </button>
                    </div>
                </div>
            `).join('')}
            ${STATE.lobby.length === 0 ? `
                <div class="empty-state">
                    <p>Add players to begin</p>
                </div>
            ` : ''}
        </div>

        <div class="fixed-bottom-bar">
            <div class="controls-inner">
                <div class="input-with-action">
                    <input type="text" id="new-player-name" placeholder="Enter player name..." 
                           onkeypress="if(event.key === 'Enter') addPlayer()"
                           class="game-input">
                    <button onclick="addPlayer()" class="btn-add-input">
                        ${window.getIcon('add')}
                    </button>
                </div>

                ${STATE.lobby.length >= 3 ? `
                    <div class="timer-config-container">
                        <span class="timer-config-label">Timer (Minutes)</span>
                        <div class="timer-config-options">
                            ${[1, 2, 3, 4, 5].map(m => `
                                <label class="timer-option-wrapper">
                                    <input type="radio" name="timer_duration" value="${m}" class="is-hidden" ${m === 1 ? 'checked' : ''}>
                                    <div class="timer-box">${m}</div>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                    <button onclick="startGame(this)" class="btn-start-game">START GAME</button>
                ` : ''}
            </div>
        </div>
    `;
    container.innerHTML = lobbyHtml;
}

/**
 * Phase: Passing - Sequential role reveal for players.
 * @param {HTMLElement} container - The DOM container.
 * @returns {void}
 */
function renderPassing(container) {
    if (!STATE.game.players) return;
    const currentName = STATE.game.players[STATE.game.current_index];
    const isImposter = STATE.game.is_current_imposter;
    
    let html = `
        <div class="phase-container">
            <div class="lang-toggle">
                <button onclick="toggleLang(this)" class="btn-lang">
                    ${STATE.lang === 'en' ? '🇺🇸 EN' : '🇹🇭 TH'}
                </button>
            </div>

            <div class="passing-phase-content">
                <div class="phase-header"><span class="badge-slate">Current Turn</span></div>
                <h1 class="player-title">${escapeHtml(currentName)}</h1>

                ${!STATE.game.show_secret ? `
                    <button onclick="apiAction('/imposter/api/toggle_view', {}, this)" class="tap-reveal-btn">
                        <span class="reveal-prompt">Tap to Reveal</span>
                    </button>
                ` : `
                    ${STATE.game.image_url && !isImposter ? `
                        <img src="${sanitizeUrl(STATE.game.image_url)}?t=${Date.now()}" class="imposter-secret-image">
                    ` : ''}

                    <div class="secret-reveal-box">
                        <div class="accent-line ${isImposter ? 'imposter' : 'player'}"></div>
                        
                        ${isImposter ? `
                            <div class="hint-label">Your Hint</div>
                            <div class="hint-word">"${escapeHtml(STATE.game.word_data[STATE.lang].hint)}"</div>
                        ` : `
                            <div class="secret-label">Secret Word</div>
                            <div class="secret-word">${escapeHtml(STATE.game.word_data[STATE.lang].word)}</div>
                        `}
                    </div>
                    <button onclick="apiAction('/imposter/api/next_player', {}, this)" class="btn-purple btn-next-player">NEXT PLAYER ${window.getIcon('arrow_forward')}</button>
                `}
            </div>
        </div>
    `;
    container.innerHTML = html;
}

/**
 * Phase: Timer - Synchronized discussion countdown.
 * @param {HTMLElement} container - The DOM container.
 * @returns {void}
 */
function renderTimer(container) {
    if (!STATE.game.timer_ends_at) return;
    
    const remainingOnLoad = Math.max(0, STATE.game.timer_ends_at - STATE.now);
    const localTargetMs = Date.now() + (remainingOnLoad * 1000);

    let html = `
        <div class="phase-container">
            <div class="timer-indicator">
                <span class="timer-starter-name">${escapeHtml(STATE.game.starter)}</span>
                <span class="timer-starter-suffix">Starts First</span>
            </div>

            <div id="countdown-display" class="timer-display">
                ${formatTime(remainingOnLoad)}
            </div>
            
            <div class="timer-actions-container">
                <button id="reveal-trigger" onclick="apiAction('/imposter/api/reveal', {}, this)" class="${remainingOnLoad > 0 ? 'is-hidden' : ''} btn-danger btn-reveal-imposter">
                    REVEAL IMPOSTER
                </button>
                <button onclick="apiAction('/imposter/api/end_game_early', {}, this)" class="btn-slate btn-end-early">
                    End Game Early
                </button>
            </div>
        </div>
    `;
    container.innerHTML = html;

    if (!TIMER_INTERVAL && remainingOnLoad > 0) {
        TIMER_INTERVAL = setInterval(() => {
            // Inhibit visual updates if a modal is open to prevent jumping/glitching
            if (document.querySelector('.modal-overlay.show')) return;

            const nowMs = Date.now();
            const currentRemaining = Math.max(0, Math.floor((localTargetMs - nowMs) / 1000));
            
            const display = document.getElementById('countdown-display');
            if (display) display.innerText = formatTime(currentRemaining);

            if (currentRemaining <= 0) {
                clearInterval(TIMER_INTERVAL);
                TIMER_INTERVAL = null;
                const trigger = document.getElementById('reveal-trigger');
                if (trigger) trigger.classList.remove('is-hidden');
                if (window.navigator.vibrate) window.navigator.vibrate([500, 200, 500]);
            }
        }, 1000);
    }
}

/**
 * Phase: Results - Identity reveal and game summary.
 * @param {HTMLElement} container - The DOM container.
 * @returns {void}
 */
function renderResults(container) {
    if (TIMER_INTERVAL) {
        clearInterval(TIMER_INTERVAL);
        TIMER_INTERVAL = null;
    }

    let html = `
        <div class="phase-container results-phase-padding">
            <div class="result-card">
                <div class="result-header-gradient"></div>
                
                ${STATE.game.image_url ? `
                    <img src="${sanitizeUrl(STATE.game.image_url)}?t=${Date.now()}" class="imposter-secret-image results">
                ` : ''}
                
                <p class="result-label-imposter">The Imposter Was</p>
                <h2 class="player-title large">${escapeHtml(STATE.game.imposter)}</h2>
                
                <div class="secret-reveal-box results">
                    <p class="result-label-word">The Secret Word Was</p>
                    <p class="result-word-en">${escapeHtml(STATE.game.word_data.en.word)}</p>
                    <p class="result-word-th">${escapeHtml(STATE.game.word_data.th.word)}</p>
                </div>
                
                <button onclick="apiAction('/imposter/api/play_again', {}, this)" class="btn-purple btn-play-again">Play Again</button>
            </div>
        </div>
    `;
    container.innerHTML = html;
}

/**
 * Action: Generic handler for state-changing API calls.
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
            await loadState(true);
        }
    } catch (err) {
        console.error("API Action Failed:", url, err);
    } finally {
        if (btn) btn.classList.remove('pending');
    }
}

/**
 * Action: Adds a player to the roster.
 * @returns {void}
 */
function addPlayer() {
    const input = document.getElementById('new-player-name');
    const btn = document.querySelector('.btn-add-input');
    if (!input || !input.value.trim()) return;
    apiAction('/imposter/api/add_player', { player_name: input.value.trim() }, btn);
    input.value = '';
}

/**
 * Action: Triggers the game start sequence.
 * @param {HTMLElement} btn - The start button.
 * @returns {void}
 */
function startGame(btn) {
    const timer = document.querySelector('input[name="timer_duration"]:checked');
    apiAction('/imposter/api/start', { timer_duration: timer ? timer.value : 1 }, btn);
}

/**
 * Action: Toggles the display language for hints.
 * @param {HTMLElement} btn - The toggle button.
 * @returns {void}
 */
function toggleLang(btn) {
    const nextLang = STATE.lang === 'en' ? 'th' : 'en';
    apiAction('/imposter/api/set_lang', { lang: nextLang }, btn);
}

/**
 * Action: Renames an existing player using the project's standard confirm modal.
 * @param {string} oldName - The existing name.
 * @returns {void}
 */
function editPlayer(oldName) {
    window.showConfirmModal({
        title: 'Edit Player',
        icon: 'edit',
        message: `Enter a new name for <strong>${escapeHtml(oldName)}</strong>:`,
        confirmText: 'Save Changes',
        confirmIcon: 'save',
        autoFocus: true,
        input: {
            type: 'text',
            placeholder: 'New player name...',
            value: oldName,
            requiredText: '' 
        },
        onConfirm: async (newName) => {
            const trimmed = (newName || "").trim();
            if (trimmed && trimmed !== oldName) {
                await apiAction('/imposter/api/edit_player', { old_name: oldName, new_name: trimmed });
            }
        }
    });
}

/**
 * Action: Removes a player using the project's standard confirm modal.
 * @param {string} playerName - Name of player to remove.
 * @returns {void}
 */
function removePlayer(playerName) {
    window.showConfirmModal({
        title: 'Remove Player',
        icon: 'delete',
        danger: true,
        message: `Are you sure you want to remove <strong>${escapeHtml(playerName)}</strong>?`,
        confirmText: 'Remove',
        onConfirm: async () => {
            await apiAction('/imposter/api/remove_player', { player_name: playerName });
        }
    });
}

/**
 * Helper: Formats raw seconds to MM:SS.
 * @param {number} seconds - Total seconds.
 * @returns {string} Formatted time string.
 */
function formatTime(seconds) {
    const mins = Math.floor(Math.max(0, seconds) / 60);
    const secs = Math.max(0, seconds) % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Helper: Sanitizes user input for DOM injection.
 * @param {string} text - The unsafe string.
 * @returns {string} Safe HTML string.
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Helper: Sanitizes URLs to prevent javascript: injections.
 * @param {string} url - The URL to sanitize.
 * @returns {string} The sanitized URL.
 */
function sanitizeUrl(url) {
    if (!url) return '';
    const clean = url.trim();
    if (clean.toLowerCase().startsWith('javascript:') || clean.toLowerCase().startsWith('data:')) {
        return '';
    }
    return escapeHtml(clean);
}

// Global exposure
window.editPlayer = editPlayer;
window.removePlayer = removePlayer;
window.addPlayer = addPlayer;
window.startGame = startGame;
window.apiAction = apiAction;
window.toggleLang = toggleLang;
