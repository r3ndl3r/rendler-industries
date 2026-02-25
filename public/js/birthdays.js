// /public/js/birthdays.js

/**
 * client-side ui engine for birthday tracking and countdowns.
 */

let birthdaysData = [];
let manageMode = false;

document.addEventListener('DOMContentLoaded', () => {
    refreshBirthdays();
    setInterval(updateCountdowns, 60000);

    // Use global modal closing helper
    setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay'], [
        closeModal, closeDeleteModal
    ]);
});

/**
 * Data Management
 */
async function refreshBirthdays() {
    try {
        const response = await fetch('/birthdays/api/data');
        const data = await response.json();
        if (data.success) {
            birthdaysData = data.birthdays;
            renderUI();
        }
    } catch (err) {
        showToast("Failed to load birthday data", "error");
    }
}

async function submitBirthdayForm(event) {
    event.preventDefault();
    const id = document.getElementById('field_id').value;
    const url = id ? `/birthdays/edit/${id}` : '/birthdays/add';
    
    const result = await apiPost(url, {
        name: document.getElementById('field_name').value,
        birth_date: document.getElementById('field_date').value
    });

    if (result) {
        closeModal();
        refreshBirthdays();
    }
}

async function submitDeleteForm(event) {
    event.preventDefault();
    const id = document.getElementById('deleteId').value;
    const result = await apiPost(`/birthdays/delete/${id}`);

    if (result) {
        closeDeleteModal();
        refreshBirthdays();
    }
}

/**
 * UI Rendering
 */
function renderUI() {
    renderGrid();
    renderManageList();
    updateCountdowns();
}

function renderGrid() {
    const grid = document.getElementById('birthday-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (birthdaysData.length === 0) {
        grid.innerHTML = '<div class="empty-state"><p>📭 No birthdays found.</p></div>';
        return;
    }

    birthdaysData.forEach(b => {
        const card = document.createElement('div');
        card.className = 'birthday-card glass-panel';
        card.dataset.birthdate = b.birth_date;
        
        card.innerHTML = `
            <div class="birthday-emoji">
                <div class="zodiac-icons">
                    ${b.zodiac} ${b.chinese_zodiac}
                </div>
            </div>
            <div class="birthday-info">
                <h2 class="birthday-name">${b.name}</h2>
                <div class="birthday-date">${b.formatted_date}</div>
                <div class="birthday-countdown">
                    <span class="countdown-days"></span>
                    <span class="countdown-text"></span>
                </div>
                <div class="birthday-age">Will be <span class="age-number"></span> years old</div>
            </div>
        `;
        grid.appendChild(card);
    });
}

function renderManageList() {
    const list = document.getElementById('manage-list');
    if (!list) return;
    list.innerHTML = '';

    birthdaysData.forEach(b => {
        const row = document.createElement('div');
        row.className = 'manage-row';
        
        // Use a temporary button to store the JSON safely without attribute-breaking issues
        const btn = document.createElement('button');
        btn.className = 'btn-icon-edit';
        btn.innerHTML = '✎';
        btn.dataset.birthday = JSON.stringify(b);
        btn.onclick = function() { openEditModal(this); };

        row.innerHTML = `
            <div class="manage-info">
                <span class="manage-emoji">${b.zodiac} ${b.chinese_zodiac}</span>
                <div>
                    <strong class="manage-name-text">${escapeHtml(b.name)}</strong>
                    <br>
                    <span class="manage-date-text">${b.formatted_date}</span>
                </div>
            </div>
            <div class="manage-actions">
                <!-- Button injected below -->
                <button onclick="confirmDelete(${b.id}, '${escapeHtml(b.name).replace(/'/g, "\\'")}')" class="btn-icon-delete">🗑️</button>
            </div>
        `;
        row.querySelector('.manage-actions').prepend(btn);
        list.appendChild(row);
    });
}

function updateCountdowns() {
    const cards = document.querySelectorAll('.birthday-card');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    cards.forEach(card => {
        const [y, m, d] = card.dataset.birthdate.split('-').map(Number);
        const birthDate = new Date(y, m - 1, d);
        
        // Calculate next birthday
        let nextBirthday = new Date(today.getFullYear(), m - 1, d);
        
        // Handle Leap Year Feb 29 edge case
        if (m === 2 && d === 29 && !isLeapYear(today.getFullYear())) {
            // If they are born on Feb 29 and it's not a leap year, 
            // the Date constructor naturally rolls over to March 1st. 
            // We'll leave it as is or explicitly set it.
        }

        if (nextBirthday < today) {
            nextBirthday.setFullYear(today.getFullYear() + 1);
        }
        
        const diffTime = nextBirthday.getTime() - today.getTime();
        const daysUntil = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        // Calculate age they will turn
        const age = nextBirthday.getFullYear() - birthDate.getFullYear();
        
        const daysSpan = card.querySelector('.countdown-days');
        const textSpan = card.querySelector('.countdown-text');
        const ageSpan = card.querySelector('.age-number');
        
        card.classList.remove('today');
        
        if (daysUntil === 0) {
            daysSpan.textContent = '🎉 TODAY!';
            textSpan.textContent = '';
            card.classList.add('today');
        } else {
            daysSpan.textContent = daysUntil;
            textSpan.textContent = daysUntil === 1 ? 'day until birthday!' : 'days until birthday';
        }
        
        ageSpan.textContent = age;
    });
}

/**
 * Helpers & Utilities
 */
function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Modal & Mode Toggles
 */
function toggleManageMode() {
    manageMode = !manageMode;
    const manageView = document.getElementById('manage-view');
    const grid = document.getElementById('birthday-grid');
    const btn = document.getElementById('manageBtn');

    if (manageMode) {
        if (manageView) manageView.style.display = 'block';
        if (grid) grid.style.display = 'none';
        if (btn) btn.classList.add('active');
    } else {
        if (manageView) manageView.style.display = 'none';
        if (grid) grid.style.display = 'grid';
        if (btn) btn.classList.remove('active');
    }
}

function openAddModal() {
    const modal = document.getElementById('birthdayModal');
    if (!modal) return;
    document.getElementById('modalTitle').textContent = 'Add Birthday';
    document.getElementById('field_id').value = '';
    document.getElementById('field_name').value = '';
    document.getElementById('field_date').value = '';
    modal.style.display = 'flex';
}

function openEditModal(btn) {
    const b = JSON.parse(btn.dataset.birthday);
    const modal = document.getElementById('birthdayModal');
    if (!modal) return;
    document.getElementById('modalTitle').textContent = 'Edit Birthday';
    document.getElementById('field_id').value = b.id;
    document.getElementById('field_name').value = b.name;
    document.getElementById('field_date').value = b.birth_date;
    modal.style.display = 'flex';
}

function closeModal() {
    const modal = document.getElementById('birthdayModal');
    if (modal) modal.style.display = 'none';
}

function confirmDelete(id, name) {
    const modal = document.getElementById('deleteConfirmModal');
    if (!modal) return;
    document.getElementById('deleteId').value = id;
    document.getElementById('deleteName').textContent = name;
    modal.style.display = 'flex';
}

function closeDeleteModal() {
    const modal = document.getElementById('deleteConfirmModal');
    if (modal) modal.style.display = 'none';
}
