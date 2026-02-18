// /public/js/calendar/events.js

function setupEventListeners() {
    const prevBtn = document.getElementById('prevPeriod');
    const nextBtn = document.getElementById('nextPeriod');
    const todayBtn = document.getElementById('todayBtn');
    const addEventBtn = document.getElementById('addEventBtn');
    const categoryFilter = document.getElementById('categoryFilter');
    
    if (prevBtn) prevBtn.addEventListener('click', navigatePrevious);
    if (nextBtn) nextBtn.addEventListener('click', navigateNext);
    if (todayBtn) todayBtn.addEventListener('click', navigateToday);
    if (addEventBtn) addEventBtn.addEventListener('click', openAddEventModal);
    if (categoryFilter) categoryFilter.addEventListener('change', filterEventsByCategory);
    
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            currentView = this.dataset.view;
            updateViewButtons();
            loadEvents();
        });
    });
    
    setupModalListeners();
    setupAllDayToggle();
}

function loadEvents() {
    const start = getViewStartDate();
    const end = getViewEndDate();
    
    const calendarGrid = document.querySelector('.calendar-grid');
    if (calendarGrid) calendarGrid.classList.add('loading-data');
    
    fetch(`/calendar/events?start=${formatDate(start)}&end=${formatDate(end)}`)
        .then(response => response.json())
        .then(events => {
            allEvents = events;
            
            // Preserve category filter when reloading events
            const categoryFilter = document.getElementById('categoryFilter');
            if (categoryFilter && categoryFilter.value) {
                filteredEvents = events.filter(event => 
                    event.category === categoryFilter.value
                );
            } else {
                filteredEvents = events;
            }
            
            renderCalendar();
            renderUpcomingEvents();
        })
        .catch(error => {
            console.error('Error loading events:', error);
        })
        .finally(() => {
            if (calendarGrid) calendarGrid.classList.remove('loading-data');
        });
}

function filterEventsByCategory() {
    const category = document.getElementById('categoryFilter').value;
    
    if (!category) {
        filteredEvents = allEvents;
    } else {
        filteredEvents = allEvents.filter(event => event.category === category);
    }
    
    renderCalendar();
}

function showEventDetails(eventId) {
    const event = allEvents.find(e => e.id == eventId);
    if (!event) return;
    
    const modal = document.getElementById('eventDetailsModal');
    const content = document.getElementById('eventDetailsContent');
    
    const timeInfo = event.all_day ? 'All day event' : 
        `${formatTime(event.start_date)} - ${formatTime(event.end_date)}`;
    
    const dateStr = formatEventDateTime(event);
    
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
            <h2 style="color: ${event.color}">${escapeHtml(event.title)}</h2>
        </div>
        <div class="event-details-body">
            <div class="event-detail-row">
                <strong>📅 Date:</strong>
                <span>${dateStr}</span>
            </div>
            <div class="event-detail-row">
                <strong>🕒 Time:</strong>
                <span>${timeInfo}</span>
            </div>
            ${event.category ? `
            <div class="event-detail-row">
                <strong>🏷️ Category:</strong>
                <span>${escapeHtml(event.category)}</span>
            </div>` : ''}
            ${event.description ? `
            <div class="event-detail-row">
                <strong>📝 Description:</strong>
                <span>${escapeHtml(event.description)}</span>
            </div>` : ''}
            ${attendeePills ? `
            <div class="event-detail-row">
                <strong>👥 Attendees:</strong>
                <span class="event-detail-attendees">${attendeePills}</span>
            </div>` : ''}
            <div class="event-detail-row">
                <strong>👤 Created By:</strong>
                <span>${event.creator_name || 'Unknown'}</span>
            </div>
        </div>
        <div class="event-details-actions">
            <button class="btn-secondary" onclick="cloneEventFromDetails(${event.id})">Clone</button>
            <button class="btn-primary" onclick="editEventFromDetails(${event.id})">Edit</button>
        </div>
    `;
    
    modal.style.display = 'block';
}

function editEventFromDetails(eventId) {
    closeEventDetailsModal();
    const event = allEvents.find(e => e.id == eventId);
    if (event) {
        openEditModal(event);
    }
}

function cloneEventFromDetails(eventId) {
    closeEventDetailsModal();
    const event = allEvents.find(e => e.id == eventId);
    if (event) {
        if (typeof cloneEventFromModal === 'function') {
            cloneEventFromModal(event);
        } else {
            console.error('cloneEventFromModal function not found');
        }
    }
}