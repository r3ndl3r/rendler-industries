// /public/js/brief.js

/**
 * Daily Brief Module
 *
 * Name: Daily Brief
 * Purpose: Renders a live personal dashboard aggregating weather, calendar,
 *          chores, reminders, points, and upcoming birthdays into a single view.
 * Features:
 *   - State-driven architecture with 5-minute background polling
 *   - Client-side contextual summary generated from live state
 *   - Inhibited sync during modal/focus interaction
 * Dependencies:
 *   - default.js: escapeHtml, format_datetime, APP_TZ
 *   - moment-lite.js: moment().tz()
 */

const CONFIG = {
    SYNC_INTERVAL_MS: 5 * 60 * 1000,
};

const WEATHER_ICONS = {
    '01': '☀️', '02': '⛅', '03': '🌥️', '04': '☁️',
    '09': '🌧️', '10': '🌦️', '11': '⛈️', '13': '❄️', '50': '🌫️',
};

let STATE = {};

/**
 * Bootstraps the module on DOMContentLoaded.
 *
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    setInterval(loadState, CONFIG.SYNC_INTERVAL_MS);

    // Add click delegation for tiles to navigate to respective modules
    const content = document.getElementById('briefContent');
    if (content) {
        content.addEventListener('click', (e) => {
            const tile = e.target.closest('.brief-tile');
            if (!tile) return;

            const urlMap = {
                'tile-weather':   '/weather',
                'tile-calendar':  '/calendar',
                'tile-chores':    '/chores',
                'tile-reminders': '/reminders',
                'tile-points':    '/points',
                'tile-birthdays': '/birthdays'
            };

            const url = urlMap[tile.id];
            if (url) window.location.href = url;
        });
    }
});

/**
 * Fetches the consolidated brief state from the server.
 * Inhibits background syncs if a modal is open or an input has focus.
 *
 * @param {boolean} [force=false] - Bypasses interaction guards when true.
 * @returns {Promise<void>}
 */
async function loadState(force = false) {
    const anyModalOpen  = document.querySelector('.modal-overlay.show');
    const inputFocused  = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);

    if (!force && (anyModalOpen || inputFocused) && STATE.weather) return;

    try {
        const res  = await fetch('/brief/api/state');
        const data = await res.json();
        if (!data.success) return;
        STATE = data;
        renderUI();
    } catch (err) {
        console.error('Brief loadState error:', err);
    }
}

/**
 * Orchestrates the full render pass from current STATE.
 *
 * @returns {void}
 */
function renderUI() {
    document.getElementById('briefLoading').classList.add('hidden');
    document.getElementById('briefContent').classList.remove('hidden');
    document.getElementById('briefSummaryBar').classList.remove('hidden');

    renderSummary();
    renderWeather();
    renderCalendar();
    renderChores();
    renderReminders();
    renderPoints();
    renderBirthdays();
}

/**
 * Builds a contextual greeting/summary string from STATE and injects it
 * into the summary bar. Tone shifts by server_hour.
 *
 * @returns {void}
 */
function renderSummary() {
    const bar  = document.getElementById('briefSummaryBar');
    const hour      = STATE.server_hour ?? moment().tz(APP_TZ).hour();
    const dateLabel = moment().tz(APP_TZ).format('dddd, D MMMM YYYY');
    const cal  = STATE.calendar_today ?? [];
    const bdays = STATE.birthdays ?? [];
    const chores = STATE.chores  ?? [];

    let greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    let parts = [];

    if (bdays.length > 0) {
        const b = bdays[0];
        const label = b.days_until === 0 ? `today is ${escapeHtml(b.name)}'s birthday! 🎂`
                    : b.days_until === 1 ? `${escapeHtml(b.name)}'s birthday is tomorrow`
                    : `${escapeHtml(b.name)}'s birthday is in ${b.days_until} days`;
        parts.push(label);
    }

    if (cal.length > 0) {
        parts.push(`${cal.length} calendar event${cal.length > 1 ? 's' : ''} today`);
    }

    if (chores.length > 0) {
        parts.push(`${chores.length} active chore${chores.length > 1 ? 's' : ''} waiting`);
    }

    const body = parts.length > 0 ? parts.join(' · ') : 'No events, chores, or birthdays today.';
    bar.innerHTML = `<div class="brief-date">${escapeHtml(dateLabel)}</div>${escapeHtml(greeting)}. ${escapeHtml(body)}`;
}

/**
 * Renders weather location cards into #tile-weather.
 *
 * @returns {void}
 */
function renderWeather() {
    const tile = document.getElementById('tile-weather');
    const w = STATE.weather ?? null;

    let html = `<h3>🌤 Weather</h3>`;

    if (!w || !w.name || !w.data) {
        html += `<p class="brief-tile-empty">No weather data available.</p>`;
        tile.innerHTML = html;
        return;
    }

    const obs = JSON.parse(w.data);
    const cur = obs.current ?? {};
    const temp     = cur.temp != null ? cur.temp.toFixed(1) : '—';
    const desc     = cur.weather?.[0]?.description ?? '';
    const iconCode = (cur.weather?.[0]?.icon ?? '').slice(0, 2);
    const icon     = WEATHER_ICONS[iconCode] ?? '🌡️';
    const humidity = cur.humidity ?? '';
    const pop      = obs.hourly?.[0]?.pop != null ? Math.round(obs.hourly[0].pop * 100) : null;

    html += `
        <div class="weather-location">
            <div class="weather-icon">${icon}</div>
            <div>
                <div class="weather-name">${escapeHtml(w.name)}</div>
                <div class="weather-desc">${escapeHtml(desc)}</div>
                <div class="weather-meta">
                    ${humidity ? `💧 ${humidity}%` : ''}
                    ${pop != null ? `🌂 ${pop}% rain` : ''}
                </div>
            </div>
            <div class="weather-temp">${temp}°C</div>
        </div>`;

    tile.innerHTML = html;
}

/**
 * Renders today's calendar events into #tile-calendar.
 *
 * @returns {void}
 */
function renderCalendar() {
    const tile     = document.getElementById('tile-calendar');
    const today    = STATE.calendar_today    ?? [];
    const tomorrow = STATE.calendar_tomorrow ?? [];

    const userMap = Object.fromEntries((STATE.users ?? []).map(u => [String(u.id), u.username]));

    const renderEvents = (events) => events.map(e => {
        const color      = escapeHtml(e.color || '#a78bfa');
        const time       = e.all_day ? 'All day' : format_datetime(e.start_date, false);
        const attendeeIds = e.attendees ? String(e.attendees).split(',') : [];
        const pills      = attendeeIds
            .filter(id => userMap[id])
            .map((id, i) => `<span class="attendee-pill attendee-color-${(i % 8) + 1}">${escapeHtml(userMap[id])}</span>`)
            .join('');
        return `
            <div class="calendar-event">
                <div class="calendar-event-dot" style="background:${color}"></div>
                <div>
                    <div class="calendar-event-title">${escapeHtml(e.title)}</div>
                    <div class="calendar-event-time">${escapeHtml(time)}</div>
                    ${pills ? `<div class="attendee-pills">${pills}</div>` : ''}
                </div>
            </div>`;
    }).join('');

    let html = `<h3>📅 Today</h3>`;
    html += today.length
        ? renderEvents(today)
        : `<p class="brief-tile-empty">Nothing scheduled today.</p>`;

    html += `<div class="calendar-day-divider">Tomorrow</div>`;
    html += tomorrow.length
        ? renderEvents(tomorrow)
        : `<p class="brief-tile-empty">Nothing scheduled tomorrow.</p>`;

    tile.innerHTML = html;
}

/**
 * Renders active chores into #tile-chores.
 *
 * @returns {void}
 */
function renderChores() {
    const tile   = document.getElementById('tile-chores');
    const chores = STATE.chores ?? [];

    let html = `<h3>🧹 Chores</h3>`;

    if (!chores.length) {
        html += `<p class="brief-tile-empty">No active chores.</p>`;
        tile.innerHTML = html;
        return;
    }

    html += chores.map(c => `
        <div class="chore-item">
            <span>${escapeHtml(c.title)}</span>
            ${c.points ? `<span class="chore-points">+${escapeHtml(String(c.points))} pts</span>` : ''}
        </div>
    `).join('');

    tile.innerHTML = html;
}

/**
 * Renders today's reminders into #tile-reminders.
 *
 * @returns {void}
 */
function renderReminders() {
    const tile      = document.getElementById('tile-reminders');
    const reminders = STATE.reminders ?? [];

    let html = `<h3>🔔 Reminders</h3>`;

    if (!reminders.length) {
        html += `<p class="brief-tile-empty">No reminders for today.</p>`;
        tile.innerHTML = html;
        return;
    }

    html += reminders.map(r => {
        const [h, m]  = (r.reminder_time ?? '00:00').split(':');
        const hour    = parseInt(h, 10);
        const ampm    = hour >= 12 ? 'PM' : 'AM';
        const hour12  = hour % 12 || 12;
        const time    = `${hour12}:${m} ${ampm}`;
        return `
            <div class="reminder-item">
                <span>${escapeHtml(r.title)}</span>
                <span class="reminder-time">${escapeHtml(time)}</span>
            </div>`;
    }).join('');

    tile.innerHTML = html;
}

/**
 * Renders the points balance and recent transactions into #tile-points.
 *
 * @returns {void}
 */
function renderPoints() {
    const tile   = document.getElementById('tile-points');
    const points = STATE.points ?? { total: 0, recent: [] };

    let html = `<h3>⭐ Points</h3>`;
    html += `<div class="points-balance">${points.total}<span>pts</span></div>`;

    if (points.recent?.length) {
        html += points.recent.map(p => {
            const cls = p.amount < 0 ? ' negative' : '';
            const sign = p.amount > 0 ? '+' : '';
            return `
                <div class="points-recent-item">
                    <span>${escapeHtml(p.reason ?? '')}</span>
                    <span class="points-recent-amount${cls}">${sign}${p.amount}</span>
                </div>`;
        }).join('');
    }

    tile.innerHTML = html;
}

/**
 * Renders upcoming birthdays within 14 days into #tile-birthdays.
 *
 * @returns {void}
 */
function renderBirthdays() {
    const tile    = document.getElementById('tile-birthdays');
    const bdays   = STATE.birthdays ?? [];

    let html = `<h3>🎂 Birthdays</h3>`;

    if (!bdays.length) {
        html += `<p class="brief-tile-empty">No birthdays in the next 14 days.</p>`;
        tile.innerHTML = html;
        return;
    }

    html += bdays.map(b => {
        const label = b.days_until === 0 ? 'Today!' : b.days_until === 1 ? 'Tomorrow' : `In ${b.days_until} days`;
        const cls   = b.days_until === 0 ? ' today' : '';
        return `
            <div class="birthday-item">
                <span>${escapeHtml(b.name)}</span>
                <span class="birthday-countdown${cls}">${escapeHtml(label)}</span>
            </div>`;
    }).join('');

    tile.innerHTML = html;
}
