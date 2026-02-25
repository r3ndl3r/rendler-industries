// /public/js/ai.js

/**
 * Family Pulse AI - Interaction Logic
 */

document.addEventListener('DOMContentLoaded', () => {
    scrollToBottom();
    console.log("Family Pulse AI UI initialized.");
});

function scrollToBottom() {
    const container = document.getElementById('chat-messages');
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

async function sendPrompt(event) {
    if (event) event.preventDefault();
    
    const input = document.getElementById('prompt-input');
    const prompt = input.value.trim();
    const fileId = document.getElementById('file-id').value;
    const fileType = document.getElementById('file-type').value;
    
    if (!prompt) return;

    console.log(`Sending prompt: "${prompt}" (Attached ${fileType || 'none'}: ${fileId || 'none'})`);

    // 1. UI: Append user message
    appendMessage('user', prompt);
    input.value = '';
    
    // 2. UI: Show typing
    const typing = showTyping();

    // 3. API Call
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
        console.log("AI Response received:", data);
        
        typing.remove();

        if (data.success) {
            appendMessage('model', data.content);
            clearFile(); // Clear attachment after use
        } else {
            showToast(data.error || "AI error", "error");
        }
    } catch (err) {
        if (typing) typing.remove();
        console.error("Fetch failure:", err);
        showToast("Network error", "error");
    }
}

function appendMessage(role, content) {
    const container = document.getElementById('chat-messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    
    const icon = role === 'user' ? '👤' : '🧠';
    
    msgDiv.innerHTML = `
        <div class="message-bubble">
            <span class="role-icon">${icon}</span>
            <div class="text-content">${formatMarkdown(content)}</div>
        </div>
    `;
    
    container.appendChild(msgDiv);
    scrollToBottom();
}

function showTyping() {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'message model typing-indicator';
    div.textContent = 'Family Pulse is thinking...';
    container.appendChild(div);
    scrollToBottom();
    return div;
}

/**
 * Basic Markdown Formatter
 */
function formatMarkdown(text) {
    if (!text) return "";
    return text
        // Bold: **text** -> <strong>text</strong>
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        // Bullets at start of lines: * item or - item
        .replace(/^\s*[\*\-]\s+/gm, '• ')
        // Bullets in the middle of a string (Gemini sometimes packs them)
        .replace(/ \*\s+/g, '<br>• ')
        // Preserve line breaks
        .replace(/\n/g, '<br>');
}

function quickPrompt(text) {
    console.log(`Quick chip clicked: ${text}`);
    document.getElementById('prompt-input').value = text;
    sendPrompt();
}

async function clearChat() {
    if (confirm('Clear entire conversation history?')) {
        console.log("Clearing chat history...");
        const result = await apiPost('/ai/clear');
        if (result && result.success) {
            document.getElementById('chat-messages').innerHTML = '';
            showToast('History cleared', 'success');
        }
    }
}

/**
 * File Analysis Hook
 */
function attachFile(id, type, label) {
    console.log(`Attaching ${type} ID ${id} for analysis: ${label}`);
    document.getElementById('file-id').value = id;
    document.getElementById('file-type').value = type;
    document.getElementById('file-label').textContent = `Analyzing ${type}: ${label}`;
    document.getElementById('file-indicator').style.display = 'inline-flex';
}

function clearFile() {
    document.getElementById('file-id').value = '';
    document.getElementById('file-type').value = '';
    document.getElementById('file-indicator').style.display = 'none';
}
