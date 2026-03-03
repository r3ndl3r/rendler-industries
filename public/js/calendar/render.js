// /public/js/calendar/render.js

/**
 * Calendar Rendering Engine Module
 * 
 * This module coordinates the dynamic generation of the Calendar interface. 
 * It implements three distinct layout engines (Month, Week, Day) and 
 * manages high-performance DOM reconciliation for event overlays.
 * 
 * Features:
 * - Dynamic 7-column Month grid with past-day dimming
 * - Time-aware Week view with multi-day span support
 * - High-resolution 24-hour Day timeline with hourly event slots
 * - Monday-aligned perspective for all weekly views
 * - Complex event overlap resolution and participant pill rendering
 * - Integrated "Quick Add" click-hooks for empty date cells
 * 
 * Dependencies:
 * - calendar/utils.js: For formatting and boundary calculations
 * - default.js: For getIcon and escapeHtml
 */

/**
 * Main Controller: renderCalendar
 * Orchestrates the selection and execution of the active layout engine.
 */
function renderCalendar() {
    // 1. Sync: Update period label (e.g., "March 2026")
    updatePeriodTitle();
    
    // 2. Execution: Switch to target engine
    if (currentView === 'month') renderMonthView();
    else if (currentView === 'week') renderWeekView();
    else if (currentView === 'day') renderDayView();
}

/**
 * UI Engine: renderMonthView
 * Generates the traditional 7-column grid.
 * Implements sophisticated boundary logic to include previous/next month days.
 */
function renderMonthView() {
    const container = document.getElementById('calendarView');
    if (!container) return;
    
    container.innerHTML = '';
    
    const calendarGrid = document.createElement('div');
    calendarGrid.className = 'calendar-grid';
    container.appendChild(calendarGrid);
    
    // Header: generate weekday labels
    const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    daysOfWeek.forEach(day => {
        const header = document.createElement('div');
        header.className = 'calendar-day-header';
        header.innerHTML = `<span class="day-full">${day}</span><span class="day-abbr">${day.substring(0, 3)}</span>`;
        calendarGrid.appendChild(header);
    });
    
    // Logic: calculate Monday-aligned start date for the Month view
    const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const lastDay = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
    
    const startDate = new Date(firstDay);
    const dayOfWeek = firstDay.getDay();
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    startDate.setDate(startDate.getDate() - diffToMonday);
    
    const endDate = new Date(lastDay);
    const lastDayOfWeek = lastDay.getDay();
    const daysUntilSunday = lastDayOfWeek === 0 ? 0 : 7 - lastDayOfWeek;
    endDate.setDate(endDate.getDate() + daysUntilSunday);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    /**
     * Component Loop: Grid Generation
     */
    for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
        const dateStr = formatDate(date);
        
        const dayCell = document.createElement('div');
        dayCell.className = 'calendar-day';
        
        // Interaction: click empty cell to rapid-trigger creation modal
        dayCell.setAttribute('onclick', `openAddEventModal('${dateStr}')`);
        
        const isToday = date.getTime() === today.getTime();
        const isOtherMonth = date.getMonth() !== currentDate.getMonth();
        const isPast = date < today;
        
        // Visual State management
        if (isToday) dayCell.classList.add('today');
        if (isOtherMonth) dayCell.classList.add('other-month');
        if (isPast) dayCell.classList.add('past-day');
        
        const dayNumber = document.createElement('div');
        dayNumber.className = 'day-number';
        dayNumber.textContent = date.getDate();
        dayCell.appendChild(dayNumber);
        
        // Logic: identify and sort events for this specific cell
        const dayEvents = filteredEvents
            .filter(event => {
                const eventStart = (event.start_date || event.startdate || '').split(' ')[0];
                const eventEnd = (event.end_date || event.enddate || '').split(' ')[0];
                return dateStr >= eventStart && dateStr <= eventEnd;
            })
            .sort((a, b) => {
                const aDate = a.start_date || a.startdate || '';
                const bDate = b.start_date || b.startdate || '';
                return aDate.localeCompare(bDate);
            });

        // UI Detail: Event Overlay construction
        if (dayEvents.length > 0) {
            const eventsContainer = document.createElement('div');
            eventsContainer.className = 'day-events';
            
            const eventItems = dayEvents.map(event => {
                const isAllDay = event.all_day || event.allday;
                const startDate = event.start_date || event.startdate || '';
                const eventTime = isAllDay ? '' : ` - ${formatTime(startDate)}`;
                
                // logic: build participant initials/pills
                let attendeePills = '';
                const attendeeNames = event.attendee_names || event.attendeenames || '';
                if (attendeeNames) {
                    const attendees = attendeeNames.split(',').map(name => name.trim());
                    attendeePills = attendees.map((name, index) => {
                        const colorClass = `attendee-color-${(index % 8) + 1}`;
                        const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
                        return `<span class="attendee-pill ${colorClass}" title="${escapeHtml(name)}">${initials}</span>`;
                    }).join('');
                }
                
                return `
                    <div class="event-item ${isAllDay ? 'all-day' : ''}" 
                         style="--event-color: ${event.color};"
                         onclick="event.stopPropagation(); showEventDetails(${event.id})">
                         <div class="event-item-content">
                             <span class="event-title">${escapeHtml(event.title)}${eventTime}</span>
                             ${attendeePills ? `<div class="event-attendees">${attendeePills}</div>` : ''}
                         </div>
                    </div>
                `;
            }).join('');
            
            eventsContainer.innerHTML = eventItems;
            dayCell.appendChild(eventsContainer);
        }
        
        calendarGrid.appendChild(dayCell);
    }
}

/**
 * UI Engine: renderWeekView
 * Generates a focused 7-day strip layout.
 * Optimized for high-density weekly planning.
 */
function renderWeekView() {
    const container = document.getElementById('calendarView');
    if (!container) return;
    
    container.innerHTML = '';
    
    const calendarGrid = document.createElement('div');
    calendarGrid.className = 'calendar-grid calendar-view-week';
    container.appendChild(calendarGrid);
    
    const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    daysOfWeek.forEach(day => {
        const header = document.createElement('div');
        header.className = 'calendar-day-header';
        header.innerHTML = `<span class="day-full">${day}</span><span class="day-abbr">${day.substring(0, 3)}</span>`;
        calendarGrid.appendChild(header);
    });
    
    // Logic: calculate the Monday anchor for the active week strip
    const startOfWeek = new Date(currentDate);
    const currentDay = currentDate.getDay();
    const diffToMonday = currentDay === 0 ? 6 : currentDay - 1;
    startOfWeek.setDate(currentDate.getDate() - diffToMonday);
    startOfWeek.setHours(0, 0, 0, 0);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Component Loop: Week Generation
    for (let i = 0; i < 7; i++) {
        const date = new Date(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate() + i);
        date.setHours(0, 0, 0, 0);
        const dateStr = formatDate(date);
        
        const dayCell = document.createElement('div');
        dayCell.className = 'calendar-day';
        dayCell.setAttribute('onclick', `openAddEventModal('${dateStr}')`);

        if (date.getTime() === today.getTime()) dayCell.classList.add('today');
        
        const dayNumber = document.createElement('div');
        dayNumber.className = 'day-number';
        dayNumber.textContent = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        dayCell.appendChild(dayNumber);
        
        // Logic: Event filtering and chronological sorting
        const dayEvents = filteredEvents.filter(event => {
            const eventStart = (event.start_date || event.startdate || '').split(' ')[0];
            const eventEnd = (event.end_date || event.enddate || '').split(' ')[0];
            return dateStr >= eventStart && dateStr <= eventEnd;
        }).sort((a, b) => {
            const aDate = a.start_date || a.startdate || '';
            const bDate = b.start_date || b.startdate || '';
            return aDate.localeCompare(bDate);
        });
        
        if (dayEvents.length > 0) {
            const eventsContainer = document.createElement('div');
            eventsContainer.className = 'day-events';
            
            const eventItems = dayEvents.map(event => {
                const isAllDay = event.all_day || event.allday;
                const startDate = event.start_date || event.startdate || '';
                const eventTime = isAllDay ? 'All Day' : formatTime(startDate);
                
                return `
                    <div class="event-item" 
                         style="--event-color: ${event.color};" 
                         onclick="event.stopPropagation(); showEventDetails(${event.id})">
                        <div class="event-title">${escapeHtml(event.title)}</div>
                        <div class="event-time">${eventTime}</div>
                    </div>
                `;
            });
            
            eventsContainer.innerHTML = eventItems.join('');
            dayCell.appendChild(eventsContainer);
        }
        
        calendarGrid.appendChild(dayCell);
    }
}

/**
 * UI Engine: renderDayView
 * Generates a high-resolution 24-hour vertical timeline.
 * Implements "all-day" logic via the 12AM slot.
 */
function renderDayView() {
    const container = document.getElementById('calendarView');
    if (!container) return;
    
    container.innerHTML = '';
    
    const dayContainer = document.createElement('div');
    dayContainer.className = 'calendar-day-view-container';
    container.appendChild(dayContainer);

    const dateStr = formatDate(currentDate);

    // Component Loop: Hour Timeline Generation
    for (let hour = 0; hour < 24; hour++) {
        const hourRow = document.createElement('div');
        hourRow.className = 'calendar-hour-row';

        const timeLabel = document.createElement('div');
        timeLabel.className = 'calendar-hour-label';
        
        // Formatting: 12-hour display for labels
        const displayHour = hour === 0 ? '12 AM' : (hour > 12 ? `${hour - 12} PM` : (hour === 12 ? '12 PM' : `${hour} AM`));
        timeLabel.textContent = displayHour;
        
        const eventsCell = document.createElement('div');
        eventsCell.className = 'calendar-hour-events';
        eventsCell.setAttribute('onclick', `openAddEventModal('${dateStr}')`);

        // Logic: filter for events occurring exactly within this hour slot
        const hourEvents = filteredEvents.filter(event => {
            const eventStart = (event.start_date || event.startdate || '').split(' ')[0];
            const eventEnd = (event.end_date || event.enddate || '').split(' ')[0];
            const isAllDay = event.all_day || event.allday;
            
            if (dateStr < eventStart || dateStr > eventEnd) return false;
            
            // Logic: Force all-day events to the 12AM strip
            if (isAllDay && hour === 0) return true;
            if (isAllDay) return false;

            const timePart = (event.start_date || event.startdate || '').split(' ')[1];
            if (!timePart) return false;
            const eventHour = parseInt(timePart.split(':')[0]);
            return eventHour === hour;
        });

        if (hourEvents.length > 0) {
            eventsCell.innerHTML = hourEvents.map(event => {
                const isAllDay = event.all_day || event.allday;
                
                return `
                    <div class="event-item" 
                         style="--event-color: ${event.color};"
                         onclick="event.stopPropagation(); showEventDetails(${event.id})">
                        <strong>${escapeHtml(event.title)}</strong> 
                        ${isAllDay ? '(All Day)' : ''}
                    </div>
                `;
            }).join('');
        }

        hourRow.appendChild(timeLabel);
        hourRow.appendChild(eventsCell);
        dayContainer.appendChild(hourRow);
    }
}

/**
 * UI Engine: updatePeriodTitle
 * Reconciles the primary viewport label based on mode and date pointer.
 */
function updatePeriodTitle() {
    const titleElement = document.getElementById('currentPeriod');
    if (!titleElement) return;
    
    if (currentView === 'month') {
        titleElement.textContent = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    } else if (currentView === 'week') {
        const startOfWeek = new Date(currentDate);
        const currentDay = currentDate.getDay();
        const diffToMonday = currentDay === 0 ? 6 : currentDay - 1;
        startOfWeek.setDate(currentDate.getDate() - diffToMonday);
        
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(endOfWeek.getDate() + 6);
        
        const startStr = startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const endStr = endOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        titleElement.textContent = `${startStr} - ${endStr}`;
    } else if (currentView === 'day') {
        titleElement.textContent = currentDate.toLocaleDateString('en-US', { 
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
        });
    }
}
