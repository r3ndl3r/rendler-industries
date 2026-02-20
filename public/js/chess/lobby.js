// /public/js/chess/lobby.js

/**
 * Handles real-time updates for the Chess Lobby using AJAX polling.
 * Periodically fetches open games and user-specific games from the server
 * and updates the DOM without requiring a full page refresh.
 */

document.addEventListener('DOMContentLoaded', () => {
    const userGameList = document.getElementById('user-game-list');
    const openGameList = document.getElementById('open-game-list');
    const userSection = document.getElementById('user-games-section');

    function pollLobbyStatus() {
        fetch('/chess/lobby_status')
            .then(res => res.json())
            .then(data => {
                updateUserGames(data.user_games);
                updateOpenGames(data.open_games);
            })
            .catch(err => console.error('Lobby polling failed:', err));
    }

    /**
     * Updates the 'Your Active Games' section.
     */
    function updateUserGames(games) {
        if (!games || games.length === 0) {
            userSection.style.display = 'none';
            userGameList.innerHTML = '';
            return;
        }

        userSection.style.display = 'block';
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

    /**
     * Updates the 'Open Games' list.
     */
    function updateOpenGames(games) {
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

    // Helper: Escape HTML to prevent XSS
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Helper: Capitalize first letter
    function capitalize(s) {
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    // Poll every 5 seconds
    setInterval(pollLobbyStatus, 5000);
});
