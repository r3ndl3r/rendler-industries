// /public/js/user/settings.js

/**
 * User Settings Controller
 *
 * Manages the user profile editor and notification preference toggles.
 * Provides API-driven state loading, profile updates (email, password,
 * discord, emoji), and FCM push notification registration.
 *
 * Features:
 *   - Profile field editing (username, email, discord, emoji, password)
 *   - Notification channel toggles (discord, email, fcm)
 *   - FCM push token registration via Firebase
 *   - Password change with current password verification
 *
 * Dependencies:
 *   - default.js: For apiPost helper and toast notifications
 */

const STATE = { profile: null, prefs: null, has_fcm: false };
const FIREBASE_APP_MODULE = '/js/vendor/firebase/firebase-app-10.12.4.js';
const FIREBASE_MESSAGING_MODULE = '/js/vendor/firebase/firebase-messaging-10.12.4.js';

/**
 * Fetches full settings state from the server and renders both cards.
 *
 * @async
 * @returns {Promise<void>}
 */
async function loadState() {
    try {
        const res = await fetch('/user/settings/api/state');
        const data = await res.json();
        if (!data.success) return;

        STATE.profile = data.profile;
        STATE.prefs   = data.prefs;
        STATE.has_fcm = data.has_fcm;

        renderProfile();
        renderPrefs();
    } catch (e) {
        console.error('Failed to load settings state:', e);
    }
}

/**
 * Populates the profile form fields from STATE.profile and reveals the form.
 *
 * @returns {void}
 */
function renderProfile() {
    const p = STATE.profile;
    document.getElementById('profileUsername').value    = p.username    || '';
    document.getElementById('profileEmail').value       = p.email       || '';
    document.getElementById('profileDiscord').value     = p.discord_id  || '';
    document.getElementById('profileEmoji').value       = p.emoji       || '';
    document.getElementById('profileCurrentPass').value = '';
    document.getElementById('profileNewPass').value     = '';
    document.getElementById('profileConfirmPass').value = '';

    document.getElementById('profile-loading').style.display = 'none';
    document.getElementById('profileForm').style.display     = 'block';
}

/**
 * Renders notification preference toggles from STATE.prefs.
 * Always sets both enabled and disabled states so it is safe to call
 * repeatedly (e.g. after a profile save that adds or removes a Discord ID).
 *
 * @returns {void}
 */
function renderPrefs() {
    const prefs = STATE.prefs;
    const p     = STATE.profile;
    
    // Null guard for early render cycles
    if (!prefs || !p) return;

    const hasFcm     = STATE.has_fcm;
    const hasDiscord = !!p.discord_id;
    const hasEmail   = !!p.email;

    // 1. Initial State Sync (preserve checked state regardless of usability)
    const channels = ['discord', 'email', 'fcm'];
    channels.forEach(function(ch) {
        const checkbox = document.getElementById('pref-' + ch);
        if (!checkbox) return;
        checkbox.checked = !!prefs[ch];
    });

    // 2. Usability Gating (Shared Helper Pattern)
    updatePrefRow(
        'discord', 
        hasDiscord, 
        'Direct messages via your linked Discord account',
        'No Discord account linked — add your Discord ID in your profile to enable'
    );

    updatePrefRow(
        'email',
        hasEmail,
        'Notifications sent to your registered email address',
        'No email address on file — add one in your profile to enable'
    );

    updatePrefRow(
        'fcm', 
        hasFcm, 
        'Push notifications to the Rendler Industries app',
        'No registered device — install the app to enable'
    );
    renderPwaPushSetup();

    document.getElementById('prefs-loading').style.display = 'none';
    document.getElementById('prefsBody').style.display     = 'block';
}

/**
 * Checks whether the browser supports PWA push notifications.
 * @returns {boolean}
 */
function pwaPushSupported() {
    return window.isSecureContext &&
        'serviceWorker' in navigator &&
        'Notification' in window &&
        'PushManager' in window;
}

/**
 * Renders the PWA push setup UI: enables/disables button and shows status.
 */
function renderPwaPushSetup() {
    const box = document.getElementById('pwaPushBox');
    const btn = document.getElementById('pwaPushBtn');
    const status = document.getElementById('pwaPushStatus');
    if (!box || !btn || !status) return;

    if (!pwaPushSupported()) {
        btn.disabled = true;
        status.textContent = 'PWA push is not supported in this browser session.';
        return;
    }

    if (Notification.permission === 'denied') {
        btn.disabled = true;
        status.textContent = 'Notifications are blocked for this site. Enable them in browser settings to register this PWA.';
        return;
    }

    btn.disabled = false;
    status.textContent = STATE.has_fcm
        ? 'This account already has push enabled. Use this button to register this PWA as another device.'
        : 'Register this installed web app to receive push notifications.';
}

/**
 * Wraps a promise with a timeout that rejects if it doesn't settle in time.
 * @param {Promise} promise - The promise to race.
 * @param {number} ms - Timeout in milliseconds.
 * @param {string} message - Timeout error message.
 * @returns {Promise}
 */
function withTimeout(promise, ms, message) {
    let timer;
    const timeout = new Promise(function(_, reject) {
        timer = setTimeout(function() { reject(new Error(message)); }, ms);
    });
    return Promise.race([promise, timeout]).finally(function() {
        clearTimeout(timer);
    });
}

/**
 * Registers the PWA service worker.
 * @returns {Promise<ServiceWorkerRegistration>}
 */
async function getPwaServiceWorkerRegistration() {
    return navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
}

/**
 * Updates the UI state of a notification channel row.
 * Sets the description and enabled/disabled state based on channel usability.
 * 
 * @param {string}  channel         - 'discord' | 'email' | 'fcm'
 * @param {boolean} isUsable        - Flag for usability (linked ID or token present)
 * @param {string}  usableMessage   - Label when active
 * @param {string}  disabledMessage - Label when inactive
 * @returns {void}
 */
function updatePrefRow(channel, isUsable, usableMessage, disabledMessage) {
    const box  = document.getElementById('pref-' + channel);
    const row  = document.getElementById('pref-row-' + channel);
    const desc = document.getElementById(channel + '-desc');

    if (!box || !row || !desc) {
        console.warn(`Attempted to update notification row for '${channel}' but elements are missing.`, { box, row, desc });
        return;
    }

    if (!isUsable) {
        box.disabled = true;
        box.checked  = false;
        desc.textContent = disabledMessage;
        row.classList.add('pref-row-disabled');
    } else {
        box.disabled = false;
        desc.textContent = usableMessage;
        row.classList.remove('pref-row-disabled');
    }
}

/**
 * Handles profile form submission. Validates emoji and password confirmation
 * client-side before posting to the server.
 *
 * @async
 * @param {Event} event
 * @returns {Promise<void>}
 */
async function handleProfileSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const btn  = document.getElementById('profileSaveBtn');
    const orig = btn.innerHTML;

    const emojiVal = document.getElementById('profileEmoji').value.trim();
    if (!isValidSingleEmoji(emojiVal)) {
        showToast('Profile emoji must be a single emoji character.', 'error');
        return;
    }

    const newPass     = document.getElementById('profileNewPass').value;
    const confirmPass = document.getElementById('profileConfirmPass').value;
    if (newPass && newPass !== confirmPass) {
        showToast('New passwords do not match.', 'error');
        return;
    }

    btn.disabled  = true;
    btn.innerHTML = '⌛ Saving...';

    try {
        const result = await apiPost('/user/settings/api/profile', new FormData(form));
        if (result && result.success) {
            STATE.profile.email      = document.getElementById('profileEmail').value;
            STATE.profile.discord_id = document.getElementById('profileDiscord').value;
            STATE.profile.emoji      = emojiVal;
            document.getElementById('profileCurrentPass').value = '';
            document.getElementById('profileNewPass').value     = '';
            document.getElementById('profileConfirmPass').value = '';
            renderPrefs();
        }
    } finally {
        btn.disabled  = false;
        btn.innerHTML = orig;
    }
}

/**
 * Toggles a notification channel preference. Enforces the at-least-one-active
 * rule client-side before making the request, reverting the checkbox on failure.
 *
 * @async
 * @param {string}           channel - 'discord' | 'email' | 'fcm'
 * @param {HTMLInputElement} checkbox
 * @returns {Promise<void>}
 */
async function togglePref(channel, checkbox) {
    const value = checkbox.checked ? 1 : 0;

    if (!value) {
        const active = ['discord', 'email', 'fcm'].filter(function(ch) {
            const el = document.getElementById('pref-' + ch);
            return el && !el.disabled && el.checked;
        }).length;

        if (active < 1) {
            showToast('At least one notification channel must remain active.', 'error');
            checkbox.checked = true;
            return;
        }
    }

    checkbox.disabled = true;

    try {
        const body = new FormData();
        body.append('channel', channel);
        body.append('value',   value);
        const names = { discord: 'Discord', email: 'Email', fcm: 'Push' };
        const label = names[channel] || channel;
        const result = await apiPost('/user/settings/api/pref', body);

        if (result && result.success) {
            STATE.prefs[channel] = value;
            showToast(`${label} notifications ${value ? 'enabled' : 'disabled'}.`, 'success');
        } else {
            checkbox.checked = !value;
        }
    } finally {
        checkbox.disabled = false;
    }
}

/**
 * Full PWA push enrollment flow: checks support, requests permission,
 * registers SW, gets Firebase token, and saves it server-side.
 */
async function enablePwaPush() {
    const btn = document.getElementById('pwaPushBtn');
    const status = document.getElementById('pwaPushStatus');
    const original = btn ? btn.textContent : '';

    if (!pwaPushSupported()) {
        showToast('PWA push is not supported in this browser session.', 'error');
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Registering...';
    }

    window.__PWA_PUSH_REGISTERING = true;
    try {
        if (status) status.textContent = 'Loading PWA push configuration...';
        const cfgRes = await withTimeout(fetch('/api/fcm/web-config'), 10000, 'Timed out loading PWA push configuration.');
        const cfg = await cfgRes.json();
        if (!cfg.success || !cfg.enabled) {
            throw new Error('PWA push is not configured on this server yet.');
        }

        if (status) status.textContent = 'Waiting for notification permission...';
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            throw new Error('Notification permission was not granted.');
        }

        if (status) status.textContent = 'Registering service worker...';
        const registration = await withTimeout(getPwaServiceWorkerRegistration(), 10000, 'Timed out registering the service worker.');
        if (status) status.textContent = 'Loading Firebase Messaging...';
        const appMod = await withTimeout(import(FIREBASE_APP_MODULE), 10000, 'Timed out loading Firebase app module.');
        const messagingMod = await withTimeout(import(FIREBASE_MESSAGING_MODULE), 10000, 'Timed out loading Firebase messaging module.');
        const app = appMod.getApps().find(existing => existing.name === 'rendler-pwa-push') ||
            appMod.initializeApp(cfg.config, 'rendler-pwa-push');
        const messaging = messagingMod.getMessaging(app);
        if (status) status.textContent = 'Requesting browser push token...';
        const token = await withTimeout(messagingMod.getToken(messaging, {
            vapidKey: cfg.vapid_key,
            serviceWorkerRegistration: registration,
        }), 15000, 'Timed out requesting browser push token.');
        if (!token) throw new Error('Firebase did not return a web push token.');

        if (status) status.textContent = 'Saving browser push token...';
        const body = new FormData();
        body.append('token', token);
        body.append('platform', 'pwa_web');
        const registered = await apiPost('/api/fcm/register', body);
        if (!registered || !registered.success) {
            throw new Error((registered && registered.error) || 'Failed to register PWA token.');
        }

        if (!STATE.prefs.fcm) {
            const pref = new FormData();
            pref.append('channel', 'fcm');
            pref.append('value', '1');
            const prefResult = await apiPost('/user/settings/api/pref', pref);
            if (prefResult && prefResult.success) STATE.prefs.fcm = 1;
        }

        STATE.has_fcm = true;
        renderPrefs();
        showToast('PWA notifications registered.', 'success');
    } catch (e) {
        console.error('PWA push registration failed:', e);
        if (status) status.textContent = e.message || 'PWA push registration failed.';
        showToast(e.message || 'PWA push registration failed.', 'error');
    } finally {
        window.__PWA_PUSH_REGISTERING = false;
        if (btn) {
            btn.disabled = false;
            btn.textContent = original;
        }
    }
}

document.addEventListener('DOMContentLoaded', loadState);
