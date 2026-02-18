// /public/js/calendar/upcoming.js

let upcomingTimerInterval = null;

function renderUpcomingEvents() {
    const upcomingList = document.getElementById('upcomingEventsList');
    if (!upcomingList) return;
    
    const now = new Date();
    const today = formatDate(now);
    const oneYearAhead = new Date(now);
    oneYearAhead.setFullYear(oneYearAhead.getFullYear() + 1);
    const futureDate = formatDate(oneYearAhead);
    
    fetch(`/calendar/events?start=${today}&end=${futureDate}`)
        .then(response => response.json())
        .then(events => {
            const upcomingEvents = events
                .map(event => ({
                    ...event,
                    startDate: new Date(event.start_date.replace(' ', 'T'))
                }))
                .filter(event => event.startDate >= now)
                .sort((a, b) => a.startDate - b.startDate)
                .slice(0, 10);
            
            if (upcomingEvents.length === 0) {
                upcomingList.innerHTML = '<div class="upcoming-empty">No upcoming events</div>';
                return;
            }
            
            const upcomingItems = upcomingEvents.map(event => {
                const countdown = getCountdown(event.startDate);
                const dateStr = formatEventDateTime(event);
                
                let attendeePills = '';
                if (event.attendee_names) {
                    const attendees = event.attendee_names.split(',').map(name => name.trim());
                    attendeePills = attendees.map((name, index) => {
                        const colorClass = `attendee-color-${(index % 8) + 1}`;
                        return `<span class="attendee-pill ${colorClass}">${escapeHtml(name)}</span>`;
                    }).join('');
                }
                
                return `
                    <div class="upcoming-event-item" onclick="showEventDetails(${event.id})">
                        <div class="upcoming-event-color" style="background-color: ${event.color}"></div>
                        <div class="upcoming-event-details">
                            <div class="upcoming-event-title">${escapeHtml(event.title)}</div>
                            <div class="upcoming-event-datetime">${dateStr}</div>
                            ${attendeePills ? `<div class="upcoming-event-attendees">${attendeePills}</div>` : ''}
                            <div class="upcoming-event-countdown">${countdown}</div>
                        </div>
                    </div>
                `;
            }).join('');
            
            upcomingList.innerHTML = upcomingItems;
        })
        .catch(error => {
            console.error('Error loading upcoming events:', error);
            upcomingList.innerHTML = '<div class="upcoming-empty">Error loading events</div>';
        });
}

function startUpcomingCountdownTimer() {
    if (upcomingTimerInterval) {
        clearInterval(upcomingTimerInterval);
    }
    
    renderUpcomingEvents();
    upcomingTimerInterval = setInterval(renderUpcomingEvents, 60000);
}


function getCountdown(targetDate) {
    const now = new Date();
    const diff = targetDate - now;
    
    if (diff < 0) return 'Started';
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) {
        return `In ${days} day${days !== 1 ? 's' : ''}, ${hours} hour${hours !== 1 ? 's' : ''}`;
    } else if (hours > 0) {
        return `In ${hours} hour${hours !== 1 ? 's' : ''}, ${minutes} minute${minutes !== 1 ? 's' : ''}`;
    } else {
        return `In ${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }
}
