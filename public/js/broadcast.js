// /public/js/broadcast.js

/**
 * Broadcast System
 * 
 * Manages the generation and distribution of high-priority alerts to 
 * system administrators through coordinated notification channels.
 * 
 * Features:
 * - Dynamic UI generation based on system permission states.
 * - Multi-step confirmation workflow for urgent alerts.
 * - Asynchronous transmission with real-time feedback.
 * 
 * Dependencies:
 * - default.js: For apiPost and showConfirmModal
 */

/**
 * --- Application State ---
 */
let STATE = {
    isProcessing: false,
    canBroadcast: true
};

/**
 * --- Initialization ---
 */
document.addEventListener('DOMContentLoaded', () => {
    // Initiates the module state synchronization
    loadState();
});

/**
 * --- Logic & UI Operations ---
 */

/**
 * Coordinates the synchronization of the module's initial state.
 * Triggers the UI rendering once the environment is validated.
 * 
 * @async
 * @returns {Promise<void>}
 */
async function loadState() {
    // Current module doesn't require complex state, but follows standard lifecycle
    renderUI();
}

/**
 * Renders the primary broadcast interface.
 * Provides the interactive area for alert composition and dispatch.
 * 
 * @returns {void}
 */
function renderUI() {
    const container = document.getElementById('broadcast-content');
    if (!container) return;

    container.innerHTML = `
        <div class="emergency-banner">
            <div class="banner-icon">
                📢
            </div>
            <div class="banner-text">
                <h3>Emergency Alert System</h3>
                <p>
                    A broadcast notifies <strong>ALL administrators</strong>
                    via Discord, Email, Pushover, Gotify, and FCM. This tool is reserved for
                    urgent system reports or emergency communication.
                </p>
            </div>
        </div>

        <div class="broadcast-form-card glass-panel">
            <div class="form-group">
                <label for="broadcast-message">Emergency Message Content</label>
                <textarea 
                    id="broadcast-message" 
                    class="broadcast-textarea" 
                    placeholder="Describe the issue or emergency here..."
                    spellcheck="true"
                    maxlength="1000"
                ></textarea>
            </div>


            
            <div class="broadcast-actions">
                <button 
                    id="send-btn" 
                    class="btn-broadcast-send pulse-animation" 
                    onclick="confirmBroadcast()"
                >
                    📢 Send Broadcast
                </button>
            </div>
        </div>
    `;
}

/**
 * Executes the confirmation workflow before alert distribution.
 * 
 * @returns {void}
 */
function confirmBroadcast() {
    const messageInput = document.getElementById('broadcast-message');
    const message = messageInput ? messageInput.value.trim() : '';
    
    if (!message) {
        showToast('Please enter a message before broadcasting.', 'error');
        return;
    }

    showConfirmModal({
        title: 'Confirm System Broadcast',
        icon: '🚨',
        message: 'A high-priority alert will be sent to ALL administrators.',
        subMessage: 'Transmission includes Discord DMs, Emails, Pushover, Gotify, and FCM. Proceed with caution.',
        danger: true,
        hideCancel: true,
        confirmText: 'Send Broadcast',
        confirmIcon: '📢',
        alignment: 'center',
        onConfirm: async () => {
            await sendBroadcast(message);
        }
    });
}

/**
 * Executes the transmission of the alert via the system API.
 * 
 * @async
 * @param {string} message - The content to be distributed.
 * @returns {Promise<void>}
 */
async function sendBroadcast(message) {
    const btn = document.getElementById('send-btn');
    const originalContent = btn ? btn.innerHTML : '';

    if (STATE.isProcessing) return;

    // UI Transition: Indicate transmission activity
    STATE.isProcessing = true;
    if (btn) {
        btn.disabled = true;
        btn.classList.remove('pulse-animation');
        btn.innerHTML = `⌛ Broadcast in progress...`;
    }

    try {
        const result = await apiPost('/broadcast/api/send', { message: message });
        
        if (result && result.success) {
            const messageInput = document.getElementById('broadcast-message');
            if (messageInput) messageInput.value = '';
            showToast('Broadcast successfully dispatched.', 'success');
        }
    } catch (err) {
        console.error('Dispatch Failure:', err);
    } finally {
        // Lifecycle: Restores button state after transmission attempt
        STATE.isProcessing = false;
        if (btn) {
            btn.disabled = false;
            btn.classList.add('pulse-animation');
            btn.innerHTML = originalContent;
        }
    }
}

// Global Exposure
window.confirmBroadcast = confirmBroadcast;
