// /public/js/calendar/modals.js

/**
 * Calendar Modal Controller Module
 * 
 * This module manages the interactive dialog systems for event creation, 
 * modification, and cloning. It coordinates form state, validation,
 * and multimodal administrative confirmation workflows.
 * 
 * Features:
 * - Dynamic form pre-filling for Add, Edit, and Clone modes
 * - Real-time date/time synchronization (End Date auto-follows Start Date)
 * - Conditional visibility management for All-Day event fields
 * - Specialized administrative notification toggling for family-wide alerts
 * - Integrated confirmation workflows for event deletion
 * - Unified click-outside and keyboard (ESC) closure handling
 * 
 * Dependencies:
 * - calendar/utils.js: For formatting and DOM-safe processing
 * - default.js: For apiPost, getIcon, and global modal integration
 */

/**
 * Initialization Block: setupModalListeners
 * Establishes event delegation for modal control and form synchronization.
 */
function setupModalListeners() {
    const modal = document.getElementById('eventModal');
    if (!modal) return;
    
    const closeBtn = modal.querySelector('.close');
    const eventForm = document.getElementById('eventForm');
    
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (eventForm) eventForm.addEventListener('submit', handleEventSubmit);

    /**
     * UI: Automatic Duration Synchronization
     * Improves UX by making the end date follow the start date until manually overridden.
     */
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

/**
 * Initializes listeners for the event detail lightbox.
 */
function setupEventDetailsModalListeners() {
    const modal = document.getElementById('eventDetailsModal');
    if (!modal) return;
    
    const closeBtn = modal.querySelector('.close');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeEventDetailsModal);
    }
}

/**
 * UI Component: setupAllDayToggle
 * Manages visibility transitions for time-related fields.
 */
function setupAllDayToggle() {
    const allDayCheckbox = document.getElementById('eventAllDay');
    if (!allDayCheckbox) return;
    
    const startTimeGroup = document.getElementById('startTimeGroup');
    const endTimeGroup = document.getElementById('endTimeGroup');
    
    allDayCheckbox.addEventListener('change', function() {
        if (this.checked) {
            // Logic: mask time inputs and assume full calendar coverage
            startTimeGroup.classList.add('hidden');
            endTimeGroup.classList.add('hidden');
            document.getElementById('eventStartTime').value = '00:00';
            document.getElementById('eventEndTime').value = '23:59';
        } else {
            startTimeGroup.classList.remove('hidden');
            endTimeGroup.classList.remove('hidden');
        }
    });
}

/**
 * Interface: openAddEventModal
 * Prepares the creation interface for a new record.
 * 
 * @param {string|undefined} dateParam - Optional target date (YYYY-MM-DD)
 */
function openAddEventModal(dateParam) {
    const modal = document.getElementById('eventModal');
    const modalTitle = document.getElementById('modalTitle');
    const form = document.getElementById('eventForm');
    
    if (!modal || !form) return;

    modalTitle.innerHTML = `${getIcon('add')} Add New Event`;
    form.reset();
    document.getElementById('eventId').value = '';
    document.getElementById('eventColor').value = '#3788d8';
    
    // Resolution: determine target date from cell context or system clock
    let targetDate;
    if (typeof dateParam === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
        targetDate = dateParam;
    } else {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        targetDate = `${year}-${month}-${day}`;
    }

    document.getElementById('eventStartDate').value = targetDate;
    document.getElementById('eventEndDate').value = targetDate;
    
    // Administrative: enable notifications for new records by default
    const notificationGroup = document.getElementById('notificationGroup');
    const sendNotificationsCb = document.getElementById('sendNotifications');
    if (notificationGroup) notificationGroup.classList.remove('hidden');
    if (sendNotificationsCb) sendNotificationsCb.checked = true;
    
    // Lifecycle: reset interactive actions
    const deleteBtn = document.getElementById('deleteEventBtn');
    const cloneBtn = document.getElementById('cloneEventBtn');
    
    if (deleteBtn) deleteBtn.classList.add('hidden');
    if (cloneBtn) cloneBtn.classList.add('hidden');
    
    modal.classList.add('show');
}

/**
 * Interface: openEditModal
 * Pre-fills the editor with authoritative data from an existing record.
 * 
 * @param {Object} event - The source event record
 */
function openEditModal(event) {
    const modal = document.getElementById('eventModal');
    const modalTitle = document.getElementById('modalTitle');
    if (!modal) return;
    
    modalTitle.innerHTML = `${getIcon('edit')} Edit Event`;
    document.getElementById('eventId').value = event.id;
    document.getElementById('eventTitle').value = event.title;
    document.getElementById('eventDescription').value = event.description;
    document.getElementById('eventCategory').value = event.category;
    document.getElementById('eventColor').value = event.color || '#3788d8';
    document.getElementById('eventAllDay').checked = (event.all_day == 1 || event.allday == 1);

    // Context: inhibit administrative notifications during modification
    const notificationGroup = document.getElementById('notificationGroup');
    if (notificationGroup) notificationGroup.classList.add('hidden');

    const startDateStr = event.start_date || event.startdate;
    const endDateStr = event.end_date || event.enddate;
    
    if (!startDateStr || !endDateStr) {
        console.error('Incomplete event data:', event);
        alert('Error: Event data is incomplete');
        return;
    }

    // Resolution: handle mixed space/ISO time formatting
    const startDateTime = startDateStr.split(/[ T]/);
    const endDateTime = endDateStr.split(/[ T]/);
    
    document.getElementById('eventStartDate').value = startDateTime[0];
    document.getElementById('eventEndDate').value = endDateTime[0];
    
    // Formatting: ensure 5-character time strings (HH:MM)
    document.getElementById('eventStartTime').value = (startDateTime[1] && startDateTime[1].length >= 5) 
        ? startDateTime[1].substring(0, 5) 
        : '00:00';
        
    document.getElementById('eventEndTime').value = (endDateTime[1] && endDateTime[1].length >= 5) 
        ? endDateTime[1].substring(0, 5) 
        : '23:59';

    // UI Sync: update attendee checkbox grid
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

    // Logic: manage time input visibility based on event type
    if (event.all_day == 1 || event.allday == 1) {
        document.getElementById('startTimeGroup').classList.add('hidden');
        document.getElementById('endTimeGroup').classList.add('hidden');
    } else {
        document.getElementById('startTimeGroup').classList.remove('hidden');
        document.getElementById('endTimeGroup').classList.remove('hidden');
    }

    // Interface: reveal specialized record actions
    const deleteBtn = document.getElementById('deleteEventBtn');
    const cloneBtn = document.getElementById('cloneEventBtn');
    if (deleteBtn) {
        deleteBtn.classList.remove('hidden');
        deleteBtn.onclick = () => deleteEventFromModal(event.id, event.title);
    }
    if (cloneBtn) {
        cloneBtn.classList.remove('hidden');
        cloneBtn.onclick = () => cloneEventFromModal(event);
    }

    modal.classList.add('show');
}

/**
 * Hides the event modification interface.
 */
function closeModal() {
    const modal = document.getElementById('eventModal');
    if (modal) {
        modal.classList.remove('show');
        
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

/**
 * Hides the event detail lightbox.
 */
function closeEventDetailsModal() {
    const modal = document.getElementById('eventDetailsModal');
    if (modal) modal.classList.remove('show');
}

/**
 * Action: handleEventSubmit
 * Universal validator and transmitter for event forms.
 * Performs date/time merging and duration safety checks.
 */
function handleEventSubmit(e) {
    e.preventDefault();
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = `${getIcon('waiting')} Saving...`;
    
    const formData = new FormData(e.target);
    const eventId = formData.get('id');
    const allDay = formData.get('all_day') ? 1 : 0;
    
    const startDate = formData.get('start_date');
    const endDate = formData.get('end_date');
    const startTime = allDay ? '00:00:00' : formData.get('start_time') + ':00';
    const endTime = allDay ? '23:59:59' : formData.get('end_time') + ':00';
    
    // Validation: Enforce chronological integrity
    const startDateTime = new Date(`${startDate}T${startTime.substring(0, 5)}`);
    const endDateTime = new Date(`${endDate}T${endTime.substring(0, 5)}`);

    if (endDateTime < startDateTime) {
        showToast('End date cannot be before start date', 'error');
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
        return;
    }

    // Logic: merge inputs for DB-compatible datetime fields
    formData.set('start_date', `${startDate} ${startTime}`);
    formData.set('end_date', `${endDate} ${endTime}`);
    formData.set('all_day', allDay);

    // Interface workaround: explicitly set notification flag (FormData omission)
    const sendNotificationsCb = document.getElementById('sendNotifications');
    if (sendNotificationsCb) {
        formData.set('send_notifications', sendNotificationsCb.checked ? '1' : '0');
    }
    
    const url = eventId ? '/calendar/edit' : '/calendar/add';
    
    apiPost(url, formData).then(result => {
        if (result && result.success) {
            closeModal();
            // Lifecycle: coordinate refresh based on current view mode
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
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        }
    }).catch(error => {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    });
}

/**
 * Action: deleteEventFromModal
 * Specialized deletion workflow from within the modal context.
 */
function deleteEventFromModal(eventId, title) {
    showConfirmModal({
        title: 'Delete Event',
        message: `Are you sure you want to delete "<strong>${title || 'this event'}</strong>"?`,
        danger: true,
        confirmText: 'Delete',
        loadingText: 'Deleting...',
        onConfirm: async () => {
            const result = await apiPost('/calendar/delete', { id: eventId });
            if (result && result.success) {
                closeModal();
                if (typeof isManagementPage !== 'undefined' && isManagementPage) {
                    location.reload();
                } else {
                    if (typeof loadEvents === 'function') loadEvents();
                    else location.reload();
                }
            }
        }
    });
}

/**
 * Hides the deletion confirmation lightbox.
 */
window.closeDeleteConfirmModal = function() {
    if (typeof window.closeConfirmModal === 'function') window.closeConfirmModal();
};

/**
 * Placeholder for low-level deletion execution logic.
 */
function performDelete(eventId) {
}

/**
 * Workflow: cloneEventFromModal
 * Orchestrates the duplication of a record by resetting the ID and re-triggering the "Add" modal.
 */
function cloneEventFromModal(event) {
    // Lifecycle: clear interface before re-filling
    closeModal();
    
    setTimeout(() => {
        const modal = document.getElementById('eventModal');
        const modalTitle = document.getElementById('modalTitle');
        if (!modal) return;
        
        modalTitle.innerHTML = `${getIcon('copy')} Clone Event`;
        document.getElementById('eventId').value = ''; // Reset ID to trigger Addition on submit
        
        document.getElementById('eventTitle').value = event.title;
        document.getElementById('eventDescription').value = event.description;
        document.getElementById('eventCategory').value = event.category;
        document.getElementById('eventColor').value = event.color || '#3788d8';
        document.getElementById('eventAllDay').checked = (event.all_day == 1 || event.allday == 1);

        const startDateStr = event.start_date || event.startdate;
        const endDateStr = event.end_date || event.enddate;
        
        if (!startDateStr || !endDateStr) {
            alert('Error: Cannot clone event - date data missing');
            return;
        }

        const startDateTime = startDateStr.split(/[ T]/);
        const endDateTime = endDateStr.split(/[ T]/);
        
        document.getElementById('eventStartDate').value = startDateTime[0];
        document.getElementById('eventEndDate').value = endDateTime[0];
        
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
            document.getElementById('startTimeGroup').classList.add('hidden');
            document.getElementById('endTimeGroup').classList.add('hidden');
        } else {
            document.getElementById('startTimeGroup').classList.remove('hidden');
            document.getElementById('endTimeGroup').classList.remove('hidden');
        }

        const deleteBtn = document.getElementById('deleteEventBtn');
        const cloneBtn = document.getElementById('cloneEventBtn');
        if (deleteBtn) deleteBtn.classList.add('hidden');
        if (cloneBtn) cloneBtn.classList.add('hidden');

        // Logic: new event clone requires notification permission check
        const notificationGroup = document.getElementById('notificationGroup');
        const sendNotificationsCb = document.getElementById('sendNotifications');
        if (notificationGroup) notificationGroup.classList.remove('hidden');
        if (sendNotificationsCb) sendNotificationsCb.checked = true;

        modal.classList.add('show');
    }, 100);
}

/**
 * Global Interaction Handler: Click-outside closure logic.
 */
document.addEventListener('click', function(e) {
    const eventModal = document.getElementById('eventModal');
    const detailsModal = document.getElementById('eventDetailsModal');
    
    if (e.target === eventModal) closeModal();
    if (e.target === detailsModal) closeEventDetailsModal();
});

/**
 * Global Keyboard Handler: ESC closure logic.
 */
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeModal();
        closeEventDetailsModal();
    }
});
