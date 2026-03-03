// /public/js/chess/lobby.js

/**
 * Chess Lobby Management Module
 * 
 * This module manages the real-time interaction for the Chess Lobby interface. 
 * It implements a non-blocking background polling system to ensure participants 
 * have accurate visibility of active and pending games.
 * 
 * Features:
 * - Real-time synchronization of open and active user games
 * - Asynchronous UI reconciliation using AJAX polling (5s interval)
 * - Dynamic list rendering with role-based "Resume" vs "Join" actions
 * - Themed status badge management based on game progression
 * - Robust HTML sanitization for dynamic user data
 */

document.addEventListener('DOMContentLoaded', () => {
    /**
     * UI Element Cache
     */
    const userGameList = document.getElementById('user-game-list');
    const openGameList = document.getElementById('open-game-list');
    const userSection = document.getElementById('user-games-section');

    /**
     * Logic: pollLobbyStatus
     * Orchestrates background state fetching and triggers UI updates.
     */
    function pollLobbyStatus() {
        fetch('/chess/lobby_status')
            .then(res => res.json())
            .then(data => {
                updateUserGames(data.user_games);
                updateOpenGames(data.open_games);
            })
            .catch(err => console.error('pollLobbyStatus failure:', err));
    }

    /**
     * UI Component: updateUserGames
     * Manages the "Your Active Games" panel based on session context.
     * 
     * @param {Array} games - List of user-participating games
     */
    function updateUserGames(games) {
        if (!games || games.length === 0) {
            if (userSection) userSection.style.display = 'none';
            if (userGameList) userGameList.innerHTML = '';
            return;
        }

        if (userSection) userSection.style.display = 'block';
        if (userGameList) {
            userGameList.innerHTML = games.map(game => `
                <div class="game-item user-game">
                    <div class="host-info">
                        <span class="host-name">
                            ${escapeHtml(game.p1_name)} vs ${escapeHtml(game.p2_name || '?')}
                        </span>
                        <span class="game-time">
                            Status: <span class="status-badge ${game.status}">${capitalize(game.status)}</span>
                        </span>
                    </div>
                    <a href="/chess/play/${game.id}" class="btn-join">Resume &rarr;</a>
                </div>
            `).join('');
        }
    }

    /**
     * UI Component: updateOpenGames
     * Manages the public matchmaking list.
     * 
     * @param {Array} games - List of games awaiting opponents
     */
    function updateOpenGames(games) {
        if (!openGameList) return;

        // Handle empty state
        if (!games || games.length === 0) {
            openGameList.innerHTML = `
                <div class="empty-state">
                    No active games found.<br>
                    Be the first to start one!
                </div>
            `;
            return;
        }

        openGameList.innerHTML = games.map(game => `
            <div class="game-item">
                <div class="host-info">
                    <span class="host-name">Host: ${escapeHtml(game.host_name)}</span>
                    <span class="game-time">Created: ${game.created_at}</span>
                </div>
                <form action="/chess/join" method="POST" style="margin: 0;">
                    <input type="hidden" name="id" value="${game.id}">
                    <button type="submit" class="btn-join">Join Game &rarr;</button>
                </form>
            </div>
        `).join('');
    }

    /**
     * --- Helpers & Utilities ---
     */

    /**
     * Prevents XSS by sanitizing dynamic character data.
     * 
     * @param {string} text - Raw input
     * @returns {string} - Sanitized HTML
     */
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Localized string formatter.
     * 
     * @param {string} s - Input string
     * @returns {string} - Title-cased output
     */
    function capitalize(s) {
        if (!s) return '';
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    // Lifecycle: Establish background sync loop (5s)
    setInterval(pollLobbyStatus, 5000);
});
