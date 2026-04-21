// /public/js/user/settings.js

const STATE = { profile: null, prefs: null, has_fcm: false };

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
 * Disables the FCM toggle when no device token is registered.
 *
 * @returns {void}
 */
function renderPrefs() {
    const prefs   = STATE.prefs;
    const hasFcm  = STATE.has_fcm;

    const channels = ['discord', 'email', 'fcm'];
    channels.forEach(function(ch) {
        const checkbox = document.getElementById('pref-' + ch);
        if (!checkbox) return;
        checkbox.checked = !!prefs[ch];
    });

    const fcmBox  = document.getElementById('pref-fcm');
    const fcmDesc = document.getElementById('fcm-desc');
    if (!hasFcm) {
        fcmBox.disabled = true;
        fcmBox.checked  = false;
        fcmDesc.textContent = 'No registered device — install the app to enable';
        document.getElementById('pref-row-fcm').classList.add('pref-row-disabled');
    }

    document.getElementById('prefs-loading').style.display = 'none';
    document.getElementById('prefsBody').style.display     = 'block';
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
        const result = await apiPost('/user/settings/api/pref', body);

        if (result && result.success) {
            STATE.prefs[channel] = value;
        } else {
            checkbox.checked = !value;
        }
    } finally {
        checkbox.disabled = false;
    }
}

document.addEventListener('DOMContentLoaded', loadState);
