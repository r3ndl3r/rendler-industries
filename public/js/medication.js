// /public/js/medication.js

/**
 * Enhanced Medication Tracker Logic
 * - User-centric layout management
 * - Dropdown-driven medication selector
 * - Custom datetime handling
 * - Live interval updates
 */

document.addEventListener('DOMContentLoaded', () => {
    updateAllIntervals();
    setInterval(updateAllIntervals, 60000);
    
    // Auto-prefill "taken_at" with current time for new logs
    const addTakenAt = document.getElementById('add_taken_at');
    if (addTakenAt) {
        addTakenAt.value = getLocalISOString();
    }
});

/**
 * Formats current date for datetime-local input (YYYY-MM-DDTHH:MM)
 */
function getLocalISOString() {
    const now = new Date();
    const tzoffset = now.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(now - tzoffset)).toISOString().slice(0, 16);
    return localISOTime;
}

/**
 * Fills the medication name and dosage in the active form
 * Called when the "Quick Select" dropdown changes
 */
function fillForm(mode, name, dosage) {
    if (!name) return;
    document.getElementById(`${mode}_med_name`).value = name;
    if (dosage && dosage > 0) {
        document.getElementById(`${mode}_dosage`).value = dosage;
    }
}

/**
 * Calculates human-readable time elapsed
 */
function getTimeSince(unix) {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - unix;

    if (diff < -10) return "Scheduled (Future)";
    if (diff < 60) return "Just now";
    
    const minutes = Math.floor(diff / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    const remainingMins = minutes % 60;
    if (hours < 24) return `${hours}h ${remainingMins}m ago`;
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h ago`;
}

function updateAllIntervals() {
    document.querySelectorAll('.interval-update').forEach(el => {
        const unix = parseInt(el.getAttribute('data-unix'));
        if (unix) el.textContent = getTimeSince(unix);
    });
}

/**
 * Toggles expanded state of a medication item
 */
function toggleMedExpand(el) {
    // If user clicked a button inside, stopPropagation should have handled it, 
    // but we can double check if we clicked a button
    if (el.classList.contains('expanded')) {
        el.classList.remove('expanded');
    } else {
        // Optional: collapse others in the same list
        const list = el.closest('.user-med-list');
        list.querySelectorAll('.med-item.expanded').forEach(item => {
            if (item !== el) item.classList.remove('expanded');
        });
        el.classList.add('expanded');
    }
}

/**
 * Registry Management Modals
 */
function openManageModal(id, name, dosage) {
    const modal = document.getElementById('manageEditModal');
    const form = document.getElementById('manageEditForm');
    
    form.action = `/medication/manage/update/${id}`;
    document.getElementById('manage_id').value = id;
    document.getElementById('manage_name').value = name;
    document.getElementById('manage_dosage').value = dosage;
    
    modal.style.display = 'block';
}

function closeManageModal() {
    document.getElementById('manageEditModal').style.display = 'none';
}

/**
 * Modal Handling
 */
function openDoseModal() {
    document.getElementById('doseModal').style.display = 'block';
    // Refresh time on open
    const addTakenAt = document.getElementById('add_taken_at');
    if (addTakenAt) {
        addTakenAt.value = getLocalISOString();
    }
}

function closeDoseModal() {
    document.getElementById('doseModal').style.display = 'none';
}

function openEditModal(data) {
    const modal = document.getElementById('editModal');
    const form = document.getElementById('editForm');
    
    // Set form action dynamically
    form.action = `/medication/edit/${data.id}`;
    
    // Fill fields
    document.getElementById('edit_member_select').value = data.family_member_id;
    document.getElementById('edit_med_name').value = data.medication_name;
    document.getElementById('edit_dosage').value = data.dosage;
    
    // Format timestamp for datetime-local (YYYY-MM-DDTHH:MM)
    const dt = data.taken_at.replace(' ', 'T').substring(0, 16);
    document.getElementById('edit_taken_at').value = dt;
    
    modal.style.display = 'block';
}

function closeEditModal() {
    document.getElementById('editModal').style.display = 'none';
}

function confirmDeleteMedication(id, name) {
    const modal = document.getElementById('deleteConfirmModal');
    const nameEl = document.getElementById('deleteMedName');
    const form = document.getElementById('deleteForm');
    
    nameEl.textContent = name;
    form.action = `/medication/delete/${id}`;
    modal.style.display = 'flex';
}

function closeDeleteModal() {
    document.getElementById('deleteConfirmModal').style.display = 'none';
}

window.onclick = (event) => {
    if (event.target.classList.contains('modal-overlay') || event.target.classList.contains('delete-modal-overlay')) {
        closeDoseModal();
        closeEditModal();
        closeDeleteModal();
    }
};
