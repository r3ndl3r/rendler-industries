// /public/js/calendar/utils.js

/**
 * Calendar Utility Module
 * 
 * This module provides core date manipulation, formatting, and DOM-safe 
 * string processing for the Calendar system. It centralizes complex
 * viewport calculations for Month, Week, and Day views.
 * 
 * Features:
 * - Deterministic date formatting (YYYY-MM-DD) for API payloads
 * - 12-hour time localization with AM/PM resolution
 * - Intelligent viewport boundary calculation (Monday-to-Sunday alignment)
 * - Conflict-aware event filtering for specific calendar days
 * - Robust HTML sanitization for user-generated event descriptions
 */

/**
 * Serializes a Date object into a standard YYYY-MM-DD string.
 * 
 * @param {Date} date - Source date object
 * @returns {string} - Formatted date string
 */
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Localizes a server-formatted datetime string into 12-hour AM/PM format.
 * 
 * @param {string} dateTimeStr - Source: "YYYY-MM-DD HH:MM:SS"
 * @returns {string} - Formatted time (e.g., "3:30 PM")
 */
function formatTime(dateTimeStr) {
    const timePart = dateTimeStr.split(' ')[1];
    if (!timePart) return '';
    
    const [hours, minutes] = timePart.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    
    return `${displayHour}:${minutes} ${ampm}`;
}

/**
 * Generates a high-density descriptive date/time string for an event.
 * 
 * @param {Object} event - Event record from state
 * @returns {string} - Human-readable duration string
 */
function formatEventDateTime(event) {
    const startDate = new Date(event.start_date.replace(' ', 'T'));
    const dateStr = startDate.toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
    
    // Logic: Omit time components for all-day events
    if (event.all_day) {
        return dateStr;
    }
    
    return `${dateStr} at ${formatTime(event.start_date)}`;
}

/**
 * Sanitizes raw text to prevent XSS in dynamic HTML injections.
 * 
 * @param {string} text - Raw input
 * @returns {string} - Sanitized HTML string
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Resolves the absolute start date for the current calendar viewport.
 * Implements Monday-alignment for Month and Week views.
 * 
 * @returns {Date} - Start date object
 */
function getViewStartDate() {
    const d = new Date(currentDate);
    d.setHours(0, 0, 0, 0);
    
    if (currentView === 'month') {
        // Logic: determine first day of month and backtrack to nearest Monday
        const firstDay = new Date(d.getFullYear(), d.getMonth(), 1);
        const startDate = new Date(firstDay);
        const dayOfWeek = firstDay.getDay();
        const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        startDate.setDate(startDate.getDate() - diffToMonday);
        
        return startDate;
    } else if (currentView === 'week') {
        // Logic: backtrack from current pointer to nearest Monday
        const startDate = new Date(d);
        const dayOfWeek = startDate.getDay();
        const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        startDate.setDate(startDate.getDate() - diffToMonday);
        
        return startDate;
    }
    
    return d;
}

/**
 * Resolves the absolute end date for the current calendar viewport.
 * Implements Sunday-alignment for Month and Week views.
 * 
 * @returns {Date} - End date object
 */
function getViewEndDate() {
    const d = new Date(currentDate);
    d.setHours(23, 59, 59, 999);
    
    if (currentView === 'month') {
        // Logic: determine last day of month and advance to nearest Sunday
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        const endDate = new Date(lastDay);
        const lastDayOfWeek = lastDay.getDay();
        const daysUntilSunday = lastDayOfWeek === 0 ? 0 : 7 - lastDayOfWeek;
        endDate.setDate(endDate.getDate() + daysUntilSunday);
        endDate.setHours(23, 59, 59, 999);
        return endDate;
    } else if (currentView === 'week') {
        // Logic: advance 6 days from the start of the week
        const start = getViewStartDate();
        const endDate = new Date(start);
        endDate.setDate(endDate.getDate() + 6);
        endDate.setHours(23, 59, 59, 999);
        return endDate;
    }
    
    return d;
}

/**
 * Filters the active event collection for a specific calendar day.
 * 
 * @param {Date} date - Target day
 * @returns {Object[]} - Sorted collection of applicable events
 */
function getDayEvents(date) {
    const dateStr = formatDate(date);
    
    // Intersection Logic: include events that span or occur on the target date
    const events = filteredEvents.filter(event => {
        const eventStart = event.start_date.split(' ')[0];
        const eventEnd = event.end_date.split(' ')[0];
        return dateStr >= eventStart && dateStr <= eventEnd;
    });

    // Chronological Sort
    return events.sort((a, b) => {
        return a.start_date.localeCompare(b.start_date);
    });
}
