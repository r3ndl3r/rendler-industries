// /public/js/calendar/modals.js

function setupModalListeners() {
    const modal = document.getElementById('eventModal');
    if (!modal) return;
    
    const closeBtn = modal.querySelector('.close');
    const eventForm = document.getElementById('eventForm');
    
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    
    if (eventForm) eventForm.addEventListener('submit', handleEventSubmit);

    const startDateInput = document.getElementById('eventStartDate');
    const endDateInput = document.getElementById('eventEndDate');
    const startTimeInput = document.getElementById('eventStartTime');
    const endTimeInput = document.getElementById('eventEndTime');

    if (startDateInput && endDateInput) {
        startDateInput.addEventListener('change', function() {
            endDateInput.value = this.value;
        });
    }

    if (startTimeInput && endTimeInput) {
        startTimeInput.addEventListener('change', function() {
            endTimeInput.value = this.value;
        });
    }
}

function setupEventDetailsModalListeners() {
    const modal = document.getElementById('eventDetailsModal');
    if (!modal) return;
    
    const closeBtn = modal.querySelector('.close');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeEventDetailsModal);
    }
}

function setupAllDayToggle() {
    const allDayCheckbox = document.getElementById('eventAllDay');
    if (!allDayCheckbox) return;
    
    const startTimeGroup = document.getElementById('startTimeGroup');
    const endTimeGroup = document.getElementById('endTimeGroup');
    
    allDayCheckbox.addEventListener('change', function() {
        if (this.checked) {
            startTimeGroup.style.display = 'none';
            endTimeGroup.style.display = 'none';
            document.getElementById('eventStartTime').value = '00:00';
            document.getElementById('eventEndTime').value = '23:59';
        } else {
            startTimeGroup.style.display = 'block';
            endTimeGroup.style.display = 'block';
        }
    });
}

function openAddEventModal(dateParam) {
    const modal = document.getElementById('eventModal');
    const modalTitle = document.getElementById('modalTitle');
    const form = document.getElementById('eventForm');
    
    modalTitle.textContent = 'Add New Event';
    form.reset();
    document.getElementById('eventId').value = '';
    document.getElementById('eventColor').value = '#3788d8';
    
    // Check if a specific date string was passed (from clicking a calendar cell)
    // format expected: YYYY-MM-DD
    let targetDate;
    if (typeof dateParam === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
        targetDate = dateParam;
    } else {
        // Fallback to today if clicked via "Add Event" button
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        targetDate = `${year}-${month}-${day}`;
    }

    document.getElementById('eventStartDate').value = targetDate;
    document.getElementById('eventEndDate').value = targetDate;
    
    // Hide delete and clone buttons when adding new event
    const deleteBtn = document.getElementById('deleteEventBtn');
    const cloneBtn = document.getElementById('cloneEventBtn');
    
    if (deleteBtn) deleteBtn.style.display = 'none';
    if (cloneBtn) cloneBtn.style.display = 'none';
    
    modal.style.display = 'block';
}

function openEditModal(event) {
    const modal = document.getElementById('eventModal');
    const modalTitle = document.getElementById('modalTitle');
    
    modalTitle.textContent = 'Edit Event';
    document.getElementById('eventId').value = event.id;
    document.getElementById('eventTitle').value = event.title;
    document.getElementById('eventDescription').value = event.description;
    document.getElementById('eventCategory').value = event.category;
    document.getElementById('eventColor').value = event.color || '#3788d8';
    document.getElementById('eventAllDay').checked = (event.all_day == 1 || event.allday == 1);

    const startDateStr = event.start_date || event.startdate;
    const endDateStr = event.end_date || event.enddate;
    
    if (!startDateStr || !endDateStr) {
        console.error('Event missing date properties:', event);
        alert('Error: Event data is incomplete');
        return;
    }

    // Split by Space OR 'T' to handle ISO strings correctly
    const startDateTime = startDateStr.split(/[ T]/);
    const endDateTime = endDateStr.split(/[ T]/);
    
    document.getElementById('eventStartDate').value = startDateTime[0];
    document.getElementById('eventEndDate').value = endDateTime[0];
    
    // Ensure time parts exist before substring, defaulting correctly
    document.getElementById('eventStartTime').value = (startDateTime[1] && startDateTime[1].length >= 5) 
        ? startDateTime[1].substring(0, 5) 
        : '00:00';
        
    document.getElementById('eventEndTime').value = (endDateTime[1] && endDateTime[1].length >= 5) 
        ? endDateTime[1].substring(0, 5) 
        : '23:59';

    // Handle attendees
    document.querySelectorAll('.attendee-checkbox-input').forEach(checkbox => {
        checkbox.checked = false;
    });
    
    if (event.attendees) {
        const attendeeIds = event.attendees.split(',').map(id => id.trim());
        attendeeIds.forEach(id => {
            const checkbox = document.querySelector(`.attendee-checkbox-input[value="${id}"]`);
            if (checkbox) checkbox.checked = true;
        });
    }

    // Toggle time fields
    if (event.all_day == 1 || event.allday == 1) {
        document.getElementById('startTimeGroup').style.display = 'none';
        document.getElementById('endTimeGroup').style.display = 'none';
    } else {
        // Ensure they are visible for standard events
        document.getElementById('startTimeGroup').style.display = 'block';
        document.getElementById('endTimeGroup').style.display = 'block';
    }

    // Show delete and clone buttons
    const deleteBtn = document.getElementById('deleteEventBtn');
    const cloneBtn = document.getElementById('cloneEventBtn');
    if (deleteBtn) {
        deleteBtn.style.display = 'inline-block';
        deleteBtn.onclick = () => deleteEventFromModal(event.id, event.title);
    }
    if (cloneBtn) {
        cloneBtn.style.display = 'inline-block';
        cloneBtn.onclick = () => cloneEventFromModal(event);
    }

    modal.style.display = 'block';
}

function closeModal() {
    const modal = document.getElementById('eventModal');
    if (modal) {
        modal.style.display = 'none';
        
        const form = document.getElementById('eventForm');
        if (form) {
            const submitBtn = form.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Save';
            }
        }
    }
}

function closeEventDetailsModal() {
    const modal = document.getElementById('eventDetailsModal');
    if (modal) modal.style.display = 'none';
}

function handleEventSubmit(e) {
    e.preventDefault();
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Saving...';
    
    const formData = new FormData(e.target);
    const eventId = formData.get('id');
    const allDay = formData.get('all_day') ? 1 : 0;
    
    const startDate = formData.get('start_date');
    const endDate = formData.get('end_date');
    const startTime = allDay ? '00:00:00' : formData.get('start_time') + ':00';
    const endTime = allDay ? '23:59:59' : formData.get('end_time') + ':00';
    
    const startDateTime = new Date(`${startDate}T${startTime.substring(0, 5)}`);
    const endDateTime = new Date(`${endDate}T${endTime.substring(0, 5)}`);

    if (endDateTime < startDateTime) {
        alert('End date cannot be before start date');
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
        return;
    }

    const body = new URLSearchParams();
    
    if (eventId) {
        body.append('id', eventId);
    }
    
    body.append('title', formData.get('title'));
    body.append('description', formData.get('description') || '');
    body.append('start_date', `${startDate} ${startTime}`);
    body.append('end_date', `${endDate} ${endTime}`);
    body.append('all_day', allDay);
    body.append('category', formData.get('category') || '');
    body.append('color', formData.get('color'));
    
    document.querySelectorAll('.attendee-checkbox-input:checked').forEach(checkbox => {
        body.append('attendees[]', checkbox.value);
    });
    
    const url = eventId ? '/calendar/edit' : '/calendar/add';
    
    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body
    })
    .then(response => response.json())
    .then(result => {
        if (result.success) {
            closeModal();
            if (typeof isManagementPage !== 'undefined' && isManagementPage) {
                location.reload();
            } else {
                if (typeof loadEvents === 'function') {
                    loadEvents();
                } else {
                    location.reload();
                }
            }
        } else {
            alert('Error: ' + (result.error || 'Unknown error'));
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        }
    })
    .catch(error => {
        console.error('Error saving event:', error);
        alert('Failed to save event');
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    });
}

function deleteEventFromModal(eventId, title) {
    const modal = document.getElementById('deleteConfirmModal');
    if (!modal) {
        // Fallback if modal doesn't exist in template
        if (!confirm(`Are you sure you want to delete "${title || 'this event'}"?`)) {
            return;
        }
        performDelete(eventId);
        return;
    }
    
    // Set up the final delete button
    const finalDeleteBtn = document.getElementById('finalDeleteBtn');
    if (finalDeleteBtn) {
        finalDeleteBtn.onclick = () => performDelete(eventId);
    }
    
    // Set title if element exists
    const titleEl = document.getElementById('deleteEventTitle');
    if (titleEl) {
        titleEl.textContent = title || 'this event';
    }
    
    modal.style.display = 'flex';
}

function closeDeleteConfirmModal() {
    const modal = document.getElementById('deleteConfirmModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function performDelete(eventId) {
    const deleteBtn = document.getElementById('deleteEventBtn');
    const finalDeleteBtn = document.getElementById('finalDeleteBtn');
    
    const originalText = deleteBtn ? deleteBtn.innerHTML : 'Delete';
    if (deleteBtn) {
        deleteBtn.disabled = true;
        deleteBtn.innerHTML = 'Deleting...';
    }
    if (finalDeleteBtn) {
        finalDeleteBtn.disabled = true;
        finalDeleteBtn.innerHTML = 'Deleting...';
    }
    
    fetch('/calendar/delete', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ id: eventId })
    })
    .then(response => response.json())
    .then(result => {
        if (result.success) {
            closeDeleteConfirmModal();
            closeModal();
            if (typeof isManagementPage !== 'undefined' && isManagementPage) {
                location.reload();
            } else {
                if (typeof loadEvents === 'function') {
                    loadEvents();
                } else {
                    location.reload();
                }
            }
        } else {
            alert('Error: ' + (result.error || 'Failed to delete event'));
            if (deleteBtn) {
                deleteBtn.disabled = false;
                deleteBtn.innerHTML = originalText;
            }
            if (finalDeleteBtn) {
                finalDeleteBtn.disabled = false;
                finalDeleteBtn.innerHTML = 'Delete';
            }
            closeDeleteConfirmModal();
        }
    })
    .catch(error => {
        console.error('Error deleting event:', error);
        alert('Failed to delete event');
        if (deleteBtn) {
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = originalText;
        }
        if (finalDeleteBtn) {
            finalDeleteBtn.disabled = false;
            finalDeleteBtn.innerHTML = 'Delete';
        }
        closeDeleteConfirmModal();
    });
}

function cloneEventFromModal(event) {
    closeModal();
    
    setTimeout(() => {
        const modal = document.getElementById('eventModal');
        const modalTitle = document.getElementById('modalTitle');
        
        modalTitle.textContent = 'Clone Event';
        document.getElementById('eventId').value = ''; 
        
        document.getElementById('eventTitle').value = event.title;
        document.getElementById('eventDescription').value = event.description;
        document.getElementById('eventCategory').value = event.category;
        document.getElementById('eventColor').value = event.color || '#3788d8';
        document.getElementById('eventAllDay').checked = (event.all_day == 1 || event.allday == 1);

        const startDateStr = event.start_date || event.startdate;
        const endDateStr = event.end_date || event.enddate;
        
        if (!startDateStr || !endDateStr) {
            console.error('Event missing date properties:', event);
            alert('Error: Cannot clone event - date data missing');
            return;
        }

        // Split by Space OR 'T' here as well
        const startDateTime = startDateStr.split(/[ T]/);
        const endDateTime = endDateStr.split(/[ T]/);
        
        document.getElementById('eventStartDate').value = startDateTime[0];
        document.getElementById('eventEndDate').value = endDateTime[0];
        
        // Ensure time parts exist before substring
        document.getElementById('eventStartTime').value = (startDateTime[1] && startDateTime[1].length >= 5) 
            ? startDateTime[1].substring(0, 5) 
            : '00:00';
            
        document.getElementById('eventEndTime').value = (endDateTime[1] && endDateTime[1].length >= 5) 
            ? endDateTime[1].substring(0, 5) 
            : '23:59';

        document.querySelectorAll('.attendee-checkbox-input').forEach(checkbox => {
            checkbox.checked = false;
        });
        
        if (event.attendees) {
            const attendeeIds = event.attendees.split(',').map(id => id.trim());
            attendeeIds.forEach(id => {
                const checkbox = document.querySelector(`.attendee-checkbox-input[value="${id}"]`);
                if (checkbox) checkbox.checked = true;
            });
        }

        if (event.all_day == 1 || event.allday == 1) {
            document.getElementById('startTimeGroup').style.display = 'none';
            document.getElementById('endTimeGroup').style.display = 'none';
        } else {
            // Ensure visibility for cloned event if not all-day
            document.getElementById('startTimeGroup').style.display = 'block';
            document.getElementById('endTimeGroup').style.display = 'block';
        }

        const deleteBtn = document.getElementById('deleteEventBtn');
        const cloneBtn = document.getElementById('cloneEventBtn');
        if (deleteBtn) deleteBtn.style.display = 'none';
        if (cloneBtn) cloneBtn.style.display = 'none';

        modal.style.display = 'block';
    }, 100);
}

// Click outside modal to close
document.addEventListener('click', function(e) {
    const eventModal = document.getElementById('eventModal');
    const detailsModal = document.getElementById('eventDetailsModal');
    const deleteConfirmModal = document.getElementById('deleteConfirmModal');
    
    if (e.target === eventModal) {
        closeModal();
    }
    if (e.target === detailsModal) {
        closeEventDetailsModal();
    }
    if (e.target === deleteConfirmModal) {
        closeDeleteConfirmModal();
    }
});

// ESC key to close modals
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeModal();
        closeEventDetailsModal();
        closeDeleteConfirmModal();
    }
});