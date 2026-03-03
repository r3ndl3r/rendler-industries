// /public/js/calendar/events.js

/**
 * Calendar Interaction Module
 * 
 * This module manages the high-level event synchronization and interaction 
 * logic for the Calendar system. It coordinates temporal navigation, 
 * data-fetching across viewport boundaries, and the event-detail lightbox system.
 * 
 * Features:
 * - Real-time event synchronization with server-side DB
 * - Category-aware filtering with persistent state reconciliation
 * - Multi-view event detail lightbox with administrative action hooks
 * - Optimized UI state transitions (loading overlays during data flight)
 * - Monday-to-Sunday date range resolution for diverse view modes
 * 
 * Dependencies:
 * - calendar/utils.js: For date formatting and boundary logic
 * - calendar/modals.js: For editor pre-filling and detail management
 * - default.js: For apiPost, getIcon, and modal helpers
 */

/**
 * Initialization System: setupEventListeners
 * Bootstraps the navigation and filter controls when the DOM is ready.
 */
function setupEventListeners() {
    const prevBtn = document.getElementById('prevPeriod');
    const nextBtn = document.getElementById('nextPeriod');
    const todayBtn = document.getElementById('todayBtn');
    const addEventBtn = document.getElementById('addEventBtn');
    const categoryFilter = document.getElementById('categoryFilter');
    
    // Interaction: Period navigation
    if (prevBtn) prevBtn.addEventListener('click', navigatePrevious);
    if (nextBtn) nextBtn.addEventListener('click', navigateNext);
    if (todayBtn) todayBtn.addEventListener('click', navigateToday);
    
    // Interaction: Creation workflow
    if (addEventBtn) addEventBtn.addEventListener('click', openAddEventModal);
    
    // Interaction: Filtering logic
    if (categoryFilter) categoryFilter.addEventListener('change', filterEventsByCategory);
    
    // Interaction: View mode selector
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            currentView = this.dataset.view;
            updateViewButtons();
            loadEvents();
        });
    });
    
    // Lifecycle: Bootstrap underlying modal listeners
    setupModalListeners();
    setupAllDayToggle();
}

/**
 * Logic: loadEvents
 * Resolves the active date range and fetches applicable records from the server.
 * Orchestrates subsequent UI updates for the calendar and sidebar widgets.
 * 
 * @returns {Promise<void>}
 */
function loadEvents() {
    const start = getViewStartDate();
    const end = getViewEndDate();
    
    const calendarGrid = document.querySelector('.calendar-grid');
    // UI Feedback: indicate processing
    if (calendarGrid) calendarGrid.classList.add('loading-data');
    
    fetch(`/calendar/events?start=${formatDate(start)}&end=${formatDate(end)}`)
        .then(response => response.json())
        .then(events => {
            // master sync: local cache update
            allEvents = events;
            
            // Logic: preserve existing filter selection during re-render
            const categoryFilter = document.getElementById('categoryFilter');
            if (categoryFilter && categoryFilter.value) {
                filteredEvents = events.filter(event => 
                    event.category === categoryFilter.value
                );
            } else {
                filteredEvents = events;
            }
            
            // UI Update: trigger comprehensive redraw
            renderCalendar();
            renderUpcomingEvents();
        })
        .catch(error => {
            console.error('loadEvents failure:', error);
        })
        .finally(() => {
            if (calendarGrid) calendarGrid.classList.remove('loading-data');
        });
}

/**
 * Action: filterEventsByCategory
 * Surgical filter application for active view reconciliation.
 */
function filterEventsByCategory() {
    const category = document.getElementById('categoryFilter').value;
    
    if (!category) {
        filteredEvents = allEvents;
    } else {
        filteredEvents = allEvents.filter(event => event.category === category);
    }
    
    renderCalendar();
}

/**
 * Interface: showEventDetails
 * Displays the comprehensive detail lightbox for a specific record.
 * 
 * @param {number} eventId - Target resource ID
 */
function showEventDetails(eventId) {
    const event = allEvents.find(e => e.id == eventId);
    if (!event) return;
    
    const modal = document.getElementById('eventDetailsModal');
    const content = document.getElementById('eventDetailsContent');
    if (!modal || !content) return;
    
    // Logic: resolve localized time description
    const timeInfo = event.all_day ? 'All day event' : 
        `${formatTime(event.start_date)} - ${formatTime(event.end_date)}`;
    
    const dateStr = formatEventDateTime(event);
    
    // UI: Generate participant list
    let attendeePills = '';
    if (event.attendee_names) {
        const attendees = event.attendee_names.split(',').map(name => name.trim());
        attendeePills = attendees.map((name, index) => {
            const colorClass = `attendee-color-${(index % 8) + 1}`;
            return `<span class="attendee-pill ${colorClass}">${escapeHtml(name)}</span>`;
        }).join('');
    }
    
    content.innerHTML = `
        <div class="event-details-header">
            <h2 style="--event-color: ${event.color}; color: var(--event-color);">${escapeHtml(event.title)}</h2>
        </div>
        <div class="event-details-body">
            <div class="event-detail-row">
                <strong>${getIcon('calendar')} Date:</strong>
                <span>${dateStr}</span>
            </div>
            <div class="event-detail-row">
                <strong>${getIcon('clock')} Time:</strong>
                <span>${timeInfo}</span>
            </div>
            ${event.category ? `
            <div class="event-detail-row">
                <strong>${getIcon('info')} Category:</strong>
                <span>${escapeHtml(event.category)}</span>
            </div>` : ''}
            ${event.description ? `
            <div class="event-detail-row">
                <strong>${getIcon('clipboard')} Description:</strong>
                <span>${escapeHtml(event.description)}</span>
            </div>` : ''}
            ${attendeePills ? `
            <div class="event-detail-row">
                <strong>${getIcon('family')} Attendees:</strong>
                <span class="event-detail-attendees">${attendeePills}</span>
            </div>` : ''}
            <div class="event-detail-row">
                <strong>${getIcon('user')} Created By:</strong>
                <span>${event.creator_name || 'Unknown'}</span>
            </div>
        </div>
        <div class="event-details-actions">
            <button class="btn-edit" onclick="editEventFromDetails(${event.id})">Edit</button>
        </div>
    `;
    
    modal.classList.add('show');
}

/**
 * Interface Workflow: editEventFromDetails
 * Transitions from the detail lightbox to the editor interface.
 * 
 * @param {number} eventId - Target resource ID
 */
function editEventFromDetails(eventId) {
    closeEventDetailsModal();
    const event = allEvents.find(e => e.id == eventId);
    if (event) {
        openEditModal(event);
    }
}
