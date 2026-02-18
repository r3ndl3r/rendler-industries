// /public/js/calendar/render.js

function renderCalendar() {
    updatePeriodTitle();
    
    if (currentView === 'month') {
        renderMonthView();
    } else if (currentView === 'week') {
        renderWeekView();
    } else if (currentView === 'day') {
        renderDayView();
    }
}

function renderMonthView() {
    const container = document.getElementById('calendarView');
    if (!container) return;
    
    container.innerHTML = '';
    
    const calendarGrid = document.createElement('div');
    calendarGrid.className = 'calendar-grid';
    
    calendarGrid.style.display = 'grid';
    calendarGrid.style.gridTemplateColumns = 'repeat(7, 1fr)';
    calendarGrid.style.borderCollapse = 'collapse';
    calendarGrid.style.width = '100%';
    calendarGrid.style.height = '100%';
    
    container.appendChild(calendarGrid);
    
    const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    daysOfWeek.forEach(day => {
        const header = document.createElement('div');
        header.className = 'calendar-day-header';
        header.innerHTML = `<span class="day-full">${day}</span><span class="day-abbr">${day.substring(0, 3)}</span>`;
        calendarGrid.appendChild(header);
    });
    
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
    
    for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
        const dateStr = formatDate(date);
        
        const dayCell = document.createElement('div');
        dayCell.className = 'calendar-day';
        dayCell.style.height = 'calc((100vh - 240px) / 6)';
        dayCell.style.minHeight = '100px';
        dayCell.style.display = 'flex';
        dayCell.style.flexDirection = 'column';
        dayCell.style.overflow = 'hidden';
        dayCell.style.padding = '0';
        dayCell.style.border = '1px solid #ddd';
        
        // Add click listener for quick add, passing the specific date of this cell
        dayCell.setAttribute('onclick', `openAddEventModal('${dateStr}')`);
        dayCell.style.cursor = 'pointer'; // Visual cue
        
        const isToday = date.getTime() === today.getTime();
        const isOtherMonth = date.getMonth() !== currentDate.getMonth();
        
        // Check if day is strictly in the past
        const isPast = date < today;
        
        if (isToday) dayCell.classList.add('today');
        if (isOtherMonth) dayCell.classList.add('other-month');

        // Apply specific class for past days
        if (isPast) dayCell.classList.add('past-day');
        
        const dayNumber = document.createElement('div');
        dayNumber.className = 'day-number';
        dayNumber.textContent = date.getDate();
        dayNumber.style.padding = '4px';
        dayNumber.style.fontWeight = 'bold';
        dayNumber.style.flexShrink = '0';
        dayCell.appendChild(dayNumber);
        
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

        if (dayEvents.length > 0) {
            const eventsContainer = document.createElement('div');
            eventsContainer.className = 'day-events';
            eventsContainer.style.flex = '1';
            eventsContainer.style.minHeight = '0';
            eventsContainer.style.overflowY = 'auto';
            eventsContainer.style.overflowX = 'hidden';
            eventsContainer.style.display = 'flex';
            eventsContainer.style.flexDirection = 'column';
            eventsContainer.style.gap = '2px';
            eventsContainer.style.padding = '2px';
            
            const eventItems = dayEvents.map(event => {
                const isAllDay = event.all_day || event.allday;
                const startDate = event.start_date || event.startdate || '';
                const eventTime = isAllDay ? '' : ` - ${formatTime(startDate)}`;
                
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
                
                // Added event.stopPropagation() to prevent triggering the cell's quick-add click
                return `
                    <div class="event-item ${isAllDay ? 'all-day' : ''}" 
                         style="background-color: ${event.color}; padding: 2px 4px; border-radius: 2px; color: white; cursor: pointer; font-size: 0.75em;"
                         onclick="event.stopPropagation(); showEventDetails(${event.id})">
                         <div class="event-item-content">
                             <span class="event-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">${escapeHtml(event.title)}${eventTime}</span>
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

function renderWeekView() {
    const container = document.getElementById('calendarView');
    if (!container) return;
    
    container.innerHTML = '';
    
    const calendarGrid = document.createElement('div');
    calendarGrid.className = 'calendar-grid';
    calendarGrid.style.display = 'grid';
    calendarGrid.style.gridTemplateColumns = 'repeat(7, 1fr)';
    calendarGrid.style.borderCollapse = 'collapse';
    calendarGrid.style.width = '100%';
    calendarGrid.style.height = '100%';
    container.appendChild(calendarGrid);
    
    const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    daysOfWeek.forEach(day => {
        const header = document.createElement('div');
        header.className = 'calendar-day-header';
        header.innerHTML = `<span class="day-full">${day}</span><span class="day-abbr">${day.substring(0, 3)}</span>`;
        calendarGrid.appendChild(header);
    });
    
    const startOfWeek = new Date(currentDate);
    const currentDay = currentDate.getDay();
    const diffToMonday = currentDay === 0 ? 6 : currentDay - 1;
    startOfWeek.setDate(currentDate.getDate() - diffToMonday);
    startOfWeek.setHours(0, 0, 0, 0);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (let i = 0; i < 7; i++) {
        const date = new Date(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate() + i);
        date.setHours(0, 0, 0, 0);
        const dateStr = formatDate(date);
        
        const dayCell = document.createElement('div');
        dayCell.className = 'calendar-day';
        dayCell.style.height = 'calc((100vh - 180px))';
        dayCell.style.display = 'flex';
        dayCell.style.flexDirection = 'column';
        dayCell.style.overflow = 'hidden';
        dayCell.style.padding = '0';
        dayCell.style.border = '1px solid #ddd';
        dayCell.style.backgroundColor = 'white';
        
        // Add click listener for quick add
        dayCell.setAttribute('onclick', `openAddEventModal('${dateStr}')`);
        dayCell.style.cursor = 'pointer';

        if (date.getTime() === today.getTime()) {
            dayCell.classList.add('today');
        }
        
        const dayNumber = document.createElement('div');
        dayNumber.className = 'day-number';
        dayNumber.textContent = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        dayNumber.style.padding = '8px';
        dayNumber.style.fontWeight = 'bold';
        dayNumber.style.borderBottom = '1px solid #eee';
        dayNumber.style.backgroundColor = '#f9fafb';
        dayCell.appendChild(dayNumber);
        
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
            eventsContainer.style.flex = '1';
            eventsContainer.style.overflowY = 'auto';
            eventsContainer.style.padding = '4px';
            eventsContainer.style.display = 'flex';
            eventsContainer.style.flexDirection = 'column';
            eventsContainer.style.gap = '4px';
            
            const eventItems = dayEvents.map(event => {
                const isAllDay = event.all_day || event.allday;
                const startDate = event.start_date || event.startdate || '';
                const eventTime = isAllDay ? 'All Day' : formatTime(startDate);
                
                // Add stopPropagation
                return `
                    <div class="event-item" 
                         style="background-color: ${event.color}; padding: 6px; border-radius: 4px; color: white; cursor: pointer; font-size: 0.85em;" 
                         onclick="event.stopPropagation(); showEventDetails(${event.id})">
                        <div style="font-weight: bold; margin-bottom: 2px;">${escapeHtml(event.title)}</div>
                        <div style="font-size: 0.8em; opacity: 0.9;">${eventTime}</div>
                    </div>
                `;
            });
            
            eventsContainer.innerHTML = eventItems.join('');
            dayCell.appendChild(eventsContainer);
        }
        
        calendarGrid.appendChild(dayCell);
    }
}

function renderDayView() {
    const container = document.getElementById('calendarView');
    if (!container) return;
    
    container.innerHTML = '';
    
    const dayContainer = document.createElement('div');
    dayContainer.style.height = 'calc(100vh - 150px)';
    dayContainer.style.overflowY = 'auto';
    dayContainer.style.borderRadius = '8px';
    dayContainer.style.border = '1px solid #ddd';
    dayContainer.style.display = 'flex';
    dayContainer.style.flexDirection = 'column';

    container.appendChild(dayContainer);

    const dateStr = formatDate(currentDate);

    for (let hour = 0; hour < 24; hour++) {
        const hourRow = document.createElement('div');
        hourRow.style.display = 'flex';
        hourRow.style.borderBottom = '1px solid #f0f0f0';
        hourRow.style.minHeight = '60px';

        const timeLabel = document.createElement('div');
        timeLabel.style.width = '80px';
        timeLabel.style.padding = '10px';
        timeLabel.style.textAlign = 'right';
        timeLabel.style.color = '#666';
        timeLabel.style.fontSize = '0.85em';
        timeLabel.style.borderRight = '1px solid #f0f0f0';
        timeLabel.style.fontWeight = 'bold';
        
        const displayHour = hour === 0 ? '12 AM' : (hour > 12 ? `${hour - 12} PM` : (hour === 12 ? '12 PM' : `${hour} AM`));
        timeLabel.textContent = displayHour;
        
        const eventsCell = document.createElement('div');
        eventsCell.style.flex = '1';
        eventsCell.style.padding = '4px';
        eventsCell.style.position = 'relative';
        
        // Enable clicking on the empty time slot to add event
        eventsCell.setAttribute('onclick', `openAddEventModal('${dateStr}')`);
        eventsCell.style.cursor = 'pointer';

        const hourEvents = filteredEvents.filter(event => {
            const eventStart = (event.start_date || event.startdate || '').split(' ')[0];
            const eventEnd = (event.end_date || event.enddate || '').split(' ')[0];
            const isAllDay = event.all_day || event.allday;
            
            if (dateStr < eventStart || dateStr > eventEnd) return false;
            
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
                // Add stopPropagation
                return `
                    <div style="background-color: ${event.color}; color: white; padding: 4px 8px; border-radius: 4px; margin-bottom: 2px; cursor: pointer; font-size: 0.9em;"
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

function updatePeriodTitle() {
    const titleElement = document.getElementById('currentPeriod');
    if (!titleElement) return;
    
    if (currentView === 'month') {
        const monthName = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        titleElement.textContent = monthName;
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
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
    }
}