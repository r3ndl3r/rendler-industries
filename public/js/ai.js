// /public/js/ai.js

/**
 * Family Pulse AI Controller
 * 
 * Manages the Conversational AI interface using a state-driven architecture. 
 * Facilitates the handshake between the dashboard UI and the LLM engine
 * with full conversational persistence.
 * 
 * Features:
 * - State-driven message history rendering
 * - Dynamic markdown formatting for AI responses
 * - Automatic scroll orchestration for dialogue flow
 * - High-density JSDoc documentation
 * 
 * Dependencies:
 * - default.js: For apiPost and modal helpers
 * - toast.js: For operation feedback
 */

/**
 * --- Module Configuration & State ---
 */
const CONFIG = {
    MAX_HISTORY: 100,                 // Client-side message retention limit
    SCROLL_DELAY_MS: 100             // UI timing for vertical alignment
};

function trimHistory() {
    if (STATE.history.length > CONFIG.MAX_HISTORY) {
        STATE.history = STATE.history.slice(-CONFIG.MAX_HISTORY);
    }
}

let STATE = {
    history: [],                    // Collection of {role, content, timestamp}
    username: 'user',               // Active user for avatar resolution
    isSending: false
};

/**
 * Bootstraps the module state and establishes background lifecycles.
 * 
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', () => {
    // Initial fetch of the conversation history
    loadState();

    // Modal: Configure global click-outside-to-close behavior
    setupGlobalModalClosing(['modal-overlay'], [closeConfirmModal]);
});

/**
 * --- Logic & UI Operations ---
 */

/**
 * Synchronizes the module state with the server.
 * 
 * @async
 * @returns {Promise<void>}
 */
async function loadState() {
    try {
        const data = await apiGet('/ai/api/state');
        
        if (data && data.success) {
            STATE.history = data.history;
            STATE.username = data.username;
            trimHistory();
            renderMessages();
        }
    } catch (err) {
        console.error('loadState failed:', err);
    }
}

/**
 * Orchestrates the generation of message bubbles from state.
 * 
 * @returns {void}
 */
function renderMessages() {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    if (STATE.history.length === 0) {
        container.innerHTML = `
            <div class="welcome-hint">
                <p>🧠 I'm your dashboard assistant. Ask me anything about your medications, shopping, or calendar.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = STATE.history.map(msg => renderMessageRow(msg)).join('');
    scrollToBottom();
}

/**
 * Generates the HTML fragment for a single message bubble.
 * 
 * @param {Object} msg - Message metadata.
 * @returns {string} - Rendered HTML.
 */
function renderMessageRow(msg) {
    const isUser = msg.role === 'user';
    const iconHtml = isUser ? window.getUserIcon(STATE.username) : '🤖';
    const content = formatMarkdown(msg.content);

    return `
        <div class="message ${msg.role}">
            <div class="message-bubble">
                <span class="role-icon">${iconHtml}</span>
                    <div class="ai-status-glow">🧠</div>
                <div class="text-content">${content}</div>
            </div>
        </div>
    `;
}

/**
 * Vertical positioning orchestration.
 * 
 * @returns {void}
 */
function scrollToBottom() {
    const container = document.getElementById('chat-messages');
    if (container) {
        setTimeout(() => {
            container.scrollTop = container.scrollHeight;
        }, CONFIG.SCROLL_DELAY_MS);
    }
}

/**
 * Action: sendPrompt
 * Executes the AI handshake and reconciles state.
 * 
 * @async
 * @param {Event} event - Triggering form event.
 * @returns {Promise<void>}
 */
async function sendPrompt(event) {
    if (event) event.preventDefault();
    if (STATE.isSending) return;

    const input = document.getElementById('prompt-input');
    const btn = document.getElementById('send-btn');
    const prompt = input.value.trim();
    if (!prompt) return;

    STATE.isSending = true;
    if (btn) btn.disabled = true;

    // 1. Optimistic Update: append user turn
    const optimisticIndex = STATE.history.length;
    STATE.history.push({ role: 'user', content: prompt });
    input.value = '';
    renderMessages();

    // 2. UI: reveal thinking indicator
    const typing = showTyping();

    // 3. API Dispatch
    try {
        const result = await apiPost('/ai/api/chat', { prompt: prompt }, 300000);

        if (typing) typing.remove();

        if (result && result.success) {
            // Success: reconcile state with model response
            STATE.history.push({ role: 'model', content: result.content });
            trimHistory();
            renderMessages();
        } else {
            STATE.history.splice(optimisticIndex, 1);
            renderMessages();
        }
    } catch (err) {
        if (typing) typing.remove();
        STATE.history.splice(optimisticIndex, 1);
        renderMessages();
        showToast("Neural link failure", "error");
    } finally {
        STATE.isSending = false;
        if (btn) btn.disabled = false;
    }
}

/**
 * Displays the pulse indicator while processing.
 * 
 * @returns {HTMLElement|null} - The indicator node.
 */
function showTyping() {
    const container = document.getElementById('chat-messages');
    if (!container) return null;

    const div = document.createElement('div');
    div.className = 'message model typing-indicator';
    div.textContent = 'Family Pulse is thinking...';
    container.appendChild(div);
    scrollToBottom();
    return div;
}

/**
 * Transforms raw markdown into sanitized HTML.
 * 
 * @param {string} text - Raw content.
 * @returns {string} - Formatted HTML.
 */
function formatMarkdown(text) {
    if (!text) return "";
    return escapeHtml(String(text))
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/^\s*[\*\-]\s+/gm, '• ')
        .replace(/ \*\s+/g, '<br>• ')
        .replace(/\n/g, '<br>');
}

/**
 * Injects a preset query and triggers transmission.
 * 
 * @param {string} text - Preset prompt.
 * @returns {void}
 */
function quickPrompt(text) {
    const input = document.getElementById('prompt-input');
    if (input) {
        input.value = text;
        sendPrompt();
    }
}

/**
 * Action: clearChat
 * Orchestrates the terminal history purge.
 * 
 * @returns {void}
 */
function clearChat() {
    showConfirmModal({
        title: 'Clear History',
        icon: '🗑️',
        message: 'Are you sure you want to clear your entire conversation history? This action is permanent.',
        danger: true,
        confirmText: 'Clear All',
        hideCancel: true,
        alignment: 'center',
        onConfirm: async () => {
            const result = await apiPost('/ai/api/clear');
            if (result && result.success) {
                STATE.history = [];
                renderMessages();
            }
        }
    });
}

/**
 * --- Global Exposure ---
 */
window.sendPrompt = sendPrompt;
window.quickPrompt = quickPrompt;
window.clearChat = clearChat;
window.loadState = loadState;
