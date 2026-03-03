// /public/js/calendar/upcoming.js

/**
 * Upcoming Events Controller Module
 * 
 * This module manages the real-time "Next 10" events sidebar widget. It 
 * coordinates with the server state to provide high-resolution countdowns 
 * and persistent status awareness for immediate events.
 * 
 * Features:
 * - Rolling 12-month event lookahead fetch
 * - Real-time countdowns (updated every 60 seconds)
 * - Dynamic attendee visualization with themed pills
 * - Integrated click-hooks for full event detail viewing
 * - High-density localized date/time formatting
 * 
 * Dependencies:
 * - calendar/utils.js: For formatting and countdown logic
 * - default.js: For getIcon and escapeHtml
 */

/**
 * Global State
 * Handle for the background ticker loop.
 */
let upcomingTimerInterval = null;

/**
 * UI Engine: renderUpcomingEvents
 * Fetches and generates the upcoming events strip.
 * Implements specific filtering for future-only events within the response.
 * 
 * @returns {Promise<void>}
 */
function renderUpcomingEvents() {
    const upcomingList = document.getElementById('upcomingEventsList');
    if (!upcomingList) return;
    
    const now = new Date();
    const today = formatDate(now);
    
    // Logic: calculate 1-year lookahead window
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
                // Logic: discard events that finished in the past but exist in today's set
                .filter(event => event.startDate >= now)
                .sort((a, b) => a.startDate - b.startDate)
                .slice(0, 10);
            
            // Handle empty state
            if (upcomingEvents.length === 0) {
                upcomingList.innerHTML = '<div class="upcoming-empty">No upcoming events</div>';
                return;
            }
            
            // UI Component loop
            const upcomingItems = upcomingEvents.map(event => {
                const countdown = getCountdown(event.startDate);
                const dateStr = formatEventDateTime(event);
                
                // Logic: build participant visualization
                let attendeePills = '';
                if (event.attendee_names) {
                    const attendees = event.attendee_names.split(',').map(name => name.trim());
                    attendeePills = attendees.map((name, index) => {
                        const colorClass = `attendee-color-${(index % 8) + 1}`;
                        return `<span class="attendee-pill ${colorClass}">${escapeHtml(name)}</span>`;
                    }).join('');
                }
                
                return `
                    <div class="upcoming-event-item" style="--event-color: ${event.color}" onclick="showEventDetails(${event.id})">
                        <div class="upcoming-event-color"></div>
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
            console.error('renderUpcomingEvents failure:', error);
            upcomingList.innerHTML = '<div class="upcoming-empty">Error loading events</div>';
        });
}

/**
 * Initialization Block: startUpcomingCountdownTimer
 * Triggers initial render and initiates the 60s background sync.
 */
function startUpcomingCountdownTimer() {
    if (upcomingTimerInterval) {
        clearInterval(upcomingTimerInterval);
    }
    
    renderUpcomingEvents();
    upcomingTimerInterval = setInterval(renderUpcomingEvents, 60000);
}

/**
 * Logic: getCountdown
 * Generates a human-readable duration string relative to the target date.
 * 
 * @param {Date} targetDate - The event start time
 * @returns {string} - Descriptive countdown (e.g., "In 3 days, 5 hours")
 */
function getCountdown(targetDate) {
    const now = new Date();
    const diff = targetDate - now;
    
    if (diff < 0) return 'Started';
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    // Resolution: prioritize significant units
    if (days > 0) {
        return `In ${days} day${days !== 1 ? 's' : ''}, ${hours} hour${hours !== 1 ? 's' : ''}`;
    } else if (hours > 0) {
        return `In ${hours} hour${hours !== 1 ? 's' : ''}, ${minutes} minute${minutes !== 1 ? 's' : ''}`;
    } else {
        return `In ${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }
}
