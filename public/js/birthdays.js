// /public/js/birthdays.js

function calculateAllBirthdays() {
    const cards = document.querySelectorAll('.birthday-card');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    cards.forEach(card => {
        const birthDate = new Date(card.dataset.birthdate);
        const name = card.dataset.name;
        
        // Calculate next birthday
        const nextBirthday = new Date(today.getFullYear(), birthDate.getMonth(), birthDate.getDate());
        if (nextBirthday < today) {
            nextBirthday.setFullYear(today.getFullYear() + 1);
        }
        
        // Calculate days until birthday
        const daysUntil = Math.ceil((nextBirthday - today) / (1000 * 60 * 60 * 24));
        
        // Calculate age
        const age = nextBirthday.getFullYear() - birthDate.getFullYear();
        
        // Update DOM
        const daysSpan = card.querySelector('.countdown-days');
        const textSpan = card.querySelector('.countdown-text');
        const ageSpan = card.querySelector('.age-number');
        
        if (daysUntil === 0) {
            daysSpan.textContent = '🎉 TODAY!';
            textSpan.textContent = '';
            card.classList.add('today');
        } else if (daysUntil === 1) {
            daysSpan.textContent = daysUntil;
            textSpan.textContent = 'day until birthday!';
        } else {
            daysSpan.textContent = daysUntil;
            textSpan.textContent = 'days until birthday';
        }
        
        ageSpan.textContent = age;
    });
}

function editBirthday(id, name, date, emoji) {
    document.getElementById('edit_id').value = id;
    document.getElementById('edit_name').value = name;
    document.getElementById('edit_date').value = date;
    document.getElementById('edit_emoji').value = emoji;
    document.getElementById('editModal').style.display = 'flex';
}

function closeEditModal() {
    const modal = document.getElementById('editModal');
    if (modal) modal.style.display = 'none';
}

function confirmDeleteBirthday(id, name) {
    const modal = document.getElementById('deleteConfirmModal');
    const nameEl = document.getElementById('deleteBirthdayName');
    const idInput = document.getElementById('deleteBirthdayId');
    
    if (nameEl) nameEl.textContent = name;
    if (idInput) idInput.value = id;
    if (modal) modal.style.display = 'flex';
}

function closeDeleteModal() {
    const modal = document.getElementById('deleteConfirmModal');
    if (modal) modal.style.display = 'none';
}

// Close modals on outside click
window.onclick = function(event) {
    const editModal = document.getElementById('editModal');
    const deleteModal = document.getElementById('deleteConfirmModal');
    
    if (event.target == editModal) {
        closeEditModal();
    }
    if (event.target == deleteModal) {
        closeDeleteModal();
    }
}
