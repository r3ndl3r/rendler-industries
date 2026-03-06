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
 * - Multi-modal attachment system for file analysis
 * - Dynamic markdown formatting for AI responses
 * - Automatic scroll orchestration for dialogue flow
 * - High-density JSDoc documentation
 * 
 * Dependencies:
 * - default.js: For getIcon, apiPost, and modal helpers
 * - toast.js: For operation feedback
 */

/**
 * --- Module Configuration & State ---
 */
const CONFIG = {
    MAX_HISTORY: 50,                 // Client-side message retention limit
    SCROLL_DELAY_MS: 50              // UI timing for vertical alignment
};

let STATE = {
    history: [],                    // Collection of {role, content, timestamp}
    username: 'user'                // Active user for avatar resolution
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
        const response = await fetch('/ai/api/state');
        const data = await response.json();
        
        if (data && data.success) {
            STATE.history = data.history;
            STATE.username = data.username;
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
    const iconHtml = getIcon(isUser ? STATE.username : 'ai');
    const content = formatMarkdown(msg.content);

    return `
        <div class="message ${msg.role}">
            <div class="message-bubble">
                <span class="role-icon">${iconHtml}</span>
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
    
    const input = document.getElementById('prompt-input');
    const prompt = input.value.trim();
    const fileId = document.getElementById('file-id').value;
    const fileType = document.getElementById('file-type').value;
    
    if (!prompt) return;

    // 1. Optimistic Update: append user turn
    STATE.history.push({ role: 'user', content: prompt });
    input.value = '';
    renderMessages();
    
    // 2. UI: reveal thinking indicator
    const typing = showTyping();

    // 3. API Dispatch
    try {
        const result = await apiPost('/ai/api/chat', {
            prompt: prompt,
            file_id: fileId,
            file_type: fileType
        });
        
        if (typing) typing.remove();

        if (result && result.success) {
            // Success: reconcile state with model response
            STATE.history.push({ role: 'model', content: result.content });
            clearFile(); 
            renderMessages();
        }
    } catch (err) {
        if (typing) typing.remove();
        showToast("Neural link failure", "error");
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
    return text
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
        icon: 'delete',
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
 * Bridges files into AI context.
 * 
 * @param {number} id - Resource ID.
 * @param {string} type - Resource type.
 * @param {string} label - File label.
 * @returns {void}
 */
function attachFile(id, type, label) {
    const idField = document.getElementById('file-id');
    const typeField = document.getElementById('file-type');
    const labelField = document.getElementById('file-label');
    const indicator = document.getElementById('file-indicator');

    if (idField) idField.value = id;
    if (typeField) typeField.value = type;
    if (labelField) labelField.textContent = `Analyzing ${type}: ${label}`;
    if (indicator) indicator.style.display = 'inline-flex';
}

/**
 * Resets multimodal context.
 * 
 * @returns {void}
 */
function clearFile() {
    const idField = document.getElementById('file-id');
    const typeField = document.getElementById('file-type');
    const indicator = document.getElementById('file-indicator');

    if (idField) idField.value = '';
    if (typeField) typeField.value = '';
    if (indicator) indicator.style.display = 'none';
}

/**
 * --- Global Exposure ---
 */
window.sendPrompt = sendPrompt;
window.quickPrompt = quickPrompt;
window.clearChat = clearChat;
window.attachFile = attachFile;
window.clearFile = clearFile;
window.loadState = loadState;
