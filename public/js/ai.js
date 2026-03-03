// /public/js/ai.js

/**
 * Family Pulse AI Controller Module
 * 
 * This module manages the Conversational AI interface, facilitating the 
 * handshake between the dashboard UI and the Gemini 2.0 LLM engine.
 * 
 * Features:
 * - Real-time chat interactions with markdown rendering support
 * - Automatic "Scroll-to-Bottom" orchestration for conversational flow
 * - Multimodal attachment system (analyzing system files and receipts)
 * - Integrated "Quick Prompt" system for common family queries
 * - Administrative conversation history management (Clear History)
 * - Optimized visual feedback (Typing indicators and Toast notifications)
 * 
 * Dependencies:
 * - default.js: For getIcon, apiPost, and modal helpers
 * - toast.js: For system-level alerts
 */

/**
 * Initialization System
 * Boots the chat interface and ensures correct viewport positioning.
 */
document.addEventListener('DOMContentLoaded', () => {
    // UI: Ensure latest messages are visible on load
    scrollToBottom();
});

/**
 * UI Engine: scrollToBottom
 * Orchestrates vertical positioning within the message container.
 */
function scrollToBottom() {
    const container = document.getElementById('chat-messages');
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

/**
 * Action: sendPrompt
 * Executes the AI handshake including UI updates and API transmission.
 * 
 * @param {Event|null} event - Triggering form event
 * @returns {Promise<void>}
 */
async function sendPrompt(event) {
    if (event) event.preventDefault();
    
    const input = document.getElementById('prompt-input');
    const prompt = input.value.trim();
    const fileId = document.getElementById('file-id').value;
    const fileType = document.getElementById('file-type').value;
    
    if (!prompt) return;

    // 1. UI: Capture intent and clear input immediately for responsiveness
    appendMessage('user', prompt);
    input.value = '';
    
    // 2. UI: Reveal asynchronous processing indicator
    const typing = showTyping();

    // 3. API Execution
    try {
        const response = await fetch('/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                prompt: prompt,
                file_id: fileId,
                file_type: fileType
            })
        });
        
        const data = await response.json();
        
        // Logic: cleanup indicator before rendering response
        if (typing) typing.remove();

        if (data.success) {
            // Success: append generated content and clear multimodal state
            appendMessage('model', data.content);
            clearFile(); 
        } else {
            showToast(data.error || "AI error", "error");
        }
    } catch (err) {
        if (typing) typing.remove();
        console.error("sendPrompt failure:", err);
        showToast("Network error", "error");
    }
}

/**
 * UI Component: appendMessage
 * Generates and injects a message bubble into the conversation stream.
 * 
 * @param {string} role - 'user' or 'model'
 * @param {string} content - Message text (supports limited markdown)
 */
function appendMessage(role, content) {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    
    // Icon Logic: resolve based on role context
    const icon = getIcon(role === 'user' ? 'user' : 'ai');
    
    msgDiv.innerHTML = `
        <div class="message-bubble">
            <span class="role-icon">${icon}</span>
            <div class="text-content">${formatMarkdown(content)}</div>
        </div>
    `;
    
    container.appendChild(msgDiv);
    scrollToBottom();
}

/**
 * UI Component: showTyping
 * Displays the pulse indicator while AI response is in flight.
 * 
 * @returns {HTMLElement} - The created indicator element for later removal
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
 * Logic: formatMarkdown
 * Lightweight formatter for Gemini response strings.
 * Transforms bold markers, bullet points, and newlines into HTML.
 * 
 * @param {string} text - Raw model response
 * @returns {string} - Formatted HTML string
 */
function formatMarkdown(text) {
    if (!text) return "";
    return text
        // Bold: **text** -> <strong>text</strong>
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        // List: items at start of lines
        .replace(/^\s*[\*\-]\s+/gm, '• ')
        // List: packing handling for inline bullets
        .replace(/ \*\s+/g, '<br>• ')
        // Spacing: preserve manual line breaks
        .replace(/\n/g, '<br>');
}

/**
 * Interface: quickPrompt
 * Injects pre-defined text into the prompt system and triggers immediate execution.
 * 
 * @param {string} text - The preset query
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
 * Triggers confirmation and purges the administrative chat log.
 * 
 * @returns {Promise<void>}
 */
async function clearChat() {
    // Confirmation: mandatory for destructive history purge
    if (confirm('Clear entire conversation history?')) {
        const result = await apiPost('/ai/clear');
        if (result && result.success) {
            const container = document.getElementById('chat-messages');
            if (container) container.innerHTML = '';
            showToast('History cleared', 'success');
        }
    }
}

/**
 * Interface: attachFile
 * Bridges system files into the AI context via multimodal hidden fields.
 * 
 * @param {number} id - Resource ID
 * @param {string} type - Resource type (receipt/file)
 * @param {string} label - Display filename
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
 * Interface: clearFile
 * Resets the multimodal attachment state.
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
 * Global Exposure
 * Required for event handling in templates and external attachments.
 */
window.sendPrompt = sendPrompt;
window.quickPrompt = quickPrompt;
window.clearChat = clearChat;
window.attachFile = attachFile;
window.clearFile = clearFile;
window.formatMarkdown = formatMarkdown;
