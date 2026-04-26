// /public/js/admin/notifications/test.js

/**
 * Notification Test Tool
 *
 * Purpose: Admin-only tool to dispatch test notifications to any approved
 *          family user on any combination of supported channels.
 * Features:
 *   - User selector with per-user channel availability indicators.
 *   - Channel cards hidden when the selected user lacks the required credential.
 *   - Gotify and Pushover are admin-scoped — only shown when the selected user is an admin.
 *   - Fire-and-forget dispatch; results appear in /admin/notifications/logs.
 * Dependencies:
 *   - default.js: apiPost, showToast, escapeHtml
 */

const CHANNELS = [
    { id: 'discord',  label: 'Discord DM',  icon: '💬', scope: 'user'  },
    { id: 'email',    label: 'Email',        icon: '📧', scope: 'user'  },
    { id: 'fcm',      label: 'FCM (Mobile)', icon: '📱', scope: 'user'  },
    { id: 'gotify',   label: 'Gotify',       icon: '🔔', scope: 'admin' },
    { id: 'pushover', label: 'Pushover',     icon: '📢', scope: 'admin' },
];

let STATE = {
    users: [],
};

/**
 * Bootstraps the tool: fetches users and renders the form.
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', () => {
    loadState();
});

/**
 * Fetches approved family users from the API and renders the full form.
 * @returns {void}
 */
function loadState() {
    fetch('/admin/notifications/test/api/state')
        .then(r => r.json())
        .then(data => {
            if (!data.success) { showToast('Failed to load users', 'error'); return; }
            STATE.users = data.users || [];
            renderForm();
        })
        .catch(() => showToast('Network error loading users', 'error'));
}

/**
 * Renders the full test form into #testFormWrap.
 * Replaces the loading skeleton entirely on first load.
 * @returns {void}
 */
function renderForm() {
    const wrap = document.getElementById('testFormWrap');
    if (!wrap) return;

    const userOptions = STATE.users.map(u =>
        `<option value="${u.id}">${escapeHtml(u.emoji || '👤')} ${escapeHtml(u.username)}</option>`
    ).join('');

    wrap.innerHTML = `
        <form id="testForm" class="test-form" onsubmit="handleSend(event)">
            <div class="form-section">
                <h3 class="section-title">Target User</h3>
                <p class="section-hint">Select a user to see their available channels. Gotify and Pushover are only available for admin users.</p>
                <select id="userSelect" class="game-input" onchange="updateChannelStates()">
                    <option value="">— Select a user —</option>
                    ${userOptions}
                </select>
            </div>

            <div class="form-section">
                <h3 class="section-title">Channels</h3>
                <div class="channel-grid" id="channelGrid">
                    ${renderChannelCards()}
                </div>
            </div>

            <div class="form-section">
                <h3 class="section-title">Message</h3>
                <div class="form-group">
                    <label for="testSubject">Subject <span class="hint-inline">(Email / FCM / Gotify)</span></label>
                    <input type="text" id="testSubject" class="game-input no-emoji" placeholder="Test Notification" maxlength="200">
                </div>
                <div class="form-group">
                    <label for="testMessage">Message <span class="required-star">*</span></label>
                    <textarea id="testMessage" class="game-input no-emoji" rows="4" placeholder="Enter test message..." maxlength="2000"></textarea>
                </div>
            </div>

            <div class="form-actions">
                <button type="submit" id="sendBtn" class="btn-primary">
                    🚀 Send Test
                </button>
            </div>
        </form>
    `;

    updateChannelStates();
}

/**
 * Builds the HTML for all channel selection cards.
 * @returns {string} HTML string for the channel grid.
 */
function renderChannelCards() {
    return CHANNELS.map(ch => `
        <label class="channel-card hidden" id="card-${ch.id}" for="ch-${ch.id}">
            <input type="checkbox" id="ch-${ch.id}" name="channels[]" value="${ch.id}" class="channel-checkbox">
            <span class="channel-icon">${ch.icon}</span>
            <span class="channel-name">${ch.label}</span>
        </label>
    `).join('');
}

/**
 * Updates channel card visibility and state based on the selected user's credentials.
 * Only channels available to the selected user are shown; others are hidden entirely.
 * Gotify and Pushover are admin-only channels — shown only when the selected user is an admin.
 * @returns {void}
 */
function updateChannelStates() {
    const userId = document.getElementById('userSelect')?.value;
    const user   = STATE.users.find(u => String(u.id) === String(userId)) || null;

    CHANNELS.forEach(ch => {
        const card  = document.getElementById(`card-${ch.id}`);
        const input = document.getElementById(`ch-${ch.id}`);
        if (!card || !input) return;

        let available = false;

        if (ch.scope === 'admin') {
            available = !!(user && user.is_admin);
        } else if (user) {
            if (ch.id === 'discord')  available = !!user.discord_id;
            if (ch.id === 'email')    available = !!user.email;
            if (ch.id === 'fcm')      available = !!user.has_fcm;
        }

        card.classList.toggle('hidden', !available);
        input.disabled = !available;
        if (!available) input.checked = false;
    });
}

/**
 * Handles form submission — validates inputs, posts to api/send, shows result.
 * @param {Event} e - Form submit event.
 * @returns {void}
 */
async function handleSend(e) {
    e.preventDefault();

    const userId   = document.getElementById('userSelect')?.value || '';
    const subject  = document.getElementById('testSubject')?.value.trim() || '';
    const message  = document.getElementById('testMessage')?.value.trim() || '';
    const btn      = document.getElementById('sendBtn');

    const checkedChannels = [...document.querySelectorAll('.channel-checkbox:checked')];
    if (!checkedChannels.length) { showToast('Select at least one channel', 'error'); return; }
    if (!message)                { showToast('Message is required', 'error'); return; }

    const userChannels = checkedChannels.filter(cb => ['discord','email','fcm'].includes(cb.value));
    if (userChannels.length && !userId) {
        showToast('Select a target user for Discord / Email / FCM', 'error');
        return;
    }

    btn.disabled    = true;
    btn.textContent = '⌛ Sending...';

    const fd = new FormData();
    if (userId)  fd.append('user_id', userId);
    if (subject) fd.append('subject', subject);
    fd.append('message', message);
    checkedChannels.forEach(cb => fd.append('channels[]', cb.value));

    try {
        const res = await apiPost('/admin/notifications/test/api/send', fd);
        if (res && res.success) {
            const channelMap = { discord: '💬', email: '📧', fcm: '📱', gotify: '🔔', pushover: '📢' };
            const labels = (res.dispatched || []).map(c => `${channelMap[c] || ''}${c}`).join(', ');
            showToast(`Dispatched: ${labels || 'none'} — check Notification Logs`, 'success');
        }
    } finally {
        btn.disabled    = false;
        btn.textContent = '🚀 Send Test';
    }
}
