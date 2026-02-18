// /public/js/imposter.js

// Handles renaming a player via prompt
function editPlayer(oldName) {
    let newName = prompt("Edit name for " + oldName + ":", oldName);
    if (newName && newName.trim() !== "" && newName !== oldName) {
        document.getElementById('edit_old_name').value = oldName;
        document.getElementById('edit_new_name').value = newName;
        document.getElementById('edit_form').submit();
    }
}

// Handles the game timer countdown
function startTimer(initialSeconds) {
    let time = initialSeconds;
    const display = document.getElementById('timer');
    const btn = document.getElementById('revealBtn');
    
    // Initial display
    updateDisplay(time, display);

    const countdown = setInterval(() => {
        time--;
        updateDisplay(time, display);
        
        if (time <= 0) {
            clearInterval(countdown);
            display.classList.add('text-red-500');
            btn.classList.remove('hidden');
            if (window.navigator.vibrate) window.navigator.vibrate([500, 200, 500]);
        }
    }, 1000);
}

function updateDisplay(time, displayElement) {
    if (time < 0) time = 0;
    let mins = Math.floor(time / 60);
    let secs = time % 60;
    displayElement.innerText = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}