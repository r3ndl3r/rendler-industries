// /public/js/imposter.js

/**
 * Imposter Game Controller Module
 * 
 * This module manages the client-side game logic for the Imposter party game.
 * It coordinates player management, real-time timer orchestration, and 
 * visual reveal workflows.
 * 
 * Features:
 * - Interactive player renaming using native prompts
 * - Real-time game timer with 1-second resolution
 * - Integrated haptic feedback (vibration) for timer completion
 * - Responsive display updating for minutes/seconds
 * - Automated game state transitions (Pass -> Reveal)
 */

/**
 * Interface: editPlayer
 * Handles the renaming workflow for lobby participants.
 * 
 * @param {string} oldName - The current player identifier
 */
function editPlayer(oldName) {
    // Interface: use native prompt for rapid name entry
    let newName = prompt("Edit name for " + oldName + ":", oldName);
    
    // Validation: ensure non-empty and changed value
    if (newName && newName.trim() !== "" && newName !== oldName) {
        const oldField = document.getElementById('edit_old_name');
        const newField = document.getElementById('edit_new_name');
        const form = document.getElementById('edit_form');
        
        if (oldField && newField && form) {
            oldField.value = oldName;
            newField.value = newName;
            form.submit(); // Lifecycle: trigger full POST reload for registry update
        }
    }
}

/**
 * Logic: startTimer
 * Initiates the game countdown sequence.
 * Orchestrates visual feedback and haptic signals.
 * 
 * @param {number} initialSeconds - Starting duration
 */
function startTimer(initialSeconds) {
    let time = initialSeconds;
    const display = document.getElementById('timer');
    const btn = document.getElementById('revealBtn');
    if (!display) return;
    
    // UI: Initial render
    updateDisplay(time, display);

    const countdown = setInterval(() => {
        time--;
        updateDisplay(time, display);
        
        // Scenario: Timer Expiry
        if (time <= 0) {
            clearInterval(countdown);
            // Visual: shift to warning state
            display.classList.add('text-red-500');
            // Logic: reveal the administrative "reveal" trigger
            if (btn) btn.classList.remove('hidden');
            // Haptic: trigger vibration pattern if supported
            if (window.navigator.vibrate) window.navigator.vibrate([500, 200, 500]);
        }
    }, 1000);
}

/**
 * UI Component: updateDisplay
 * Transforms raw seconds into localized MM:SS formatting.
 * 
 * @param {number} time - Remaining seconds
 * @param {HTMLElement} displayElement - Target DOM node
 */
function updateDisplay(time, displayElement) {
    if (time < 0) time = 0;
    let mins = Math.floor(time / 60);
    let secs = time % 60;
    // Formatting: ensure double-digit seconds
    displayElement.innerText = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

/**
 * Global Exposure
 * Required for event delegation and template-driven timer initiation.
 */
window.editPlayer = editPlayer;
window.startTimer = startTimer;
