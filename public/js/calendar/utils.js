// /public/js/calendar/utils.js

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatTime(dateTimeStr) {
    const timePart = dateTimeStr.split(' ')[1];
    if (!timePart) return '';
    
    const [hours, minutes] = timePart.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    
    return `${displayHour}:${minutes} ${ampm}`;
}

function formatEventDateTime(event) {
    const startDate = new Date(event.start_date.replace(' ', 'T'));
    const dateStr = startDate.toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
    
    if (event.all_day) {
        return dateStr;
    }
    
    return `${dateStr} at ${formatTime(event.start_date)}`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getViewStartDate() {
    const d = new Date(currentDate);
    d.setHours(0, 0, 0, 0);
    
    if (currentView === 'month') {
        const firstDay = new Date(d.getFullYear(), d.getMonth(), 1);
        const startDate = new Date(firstDay);
        const dayOfWeek = firstDay.getDay();
        const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        startDate.setDate(startDate.getDate() - diffToMonday);
        
        return startDate;
    } else if (currentView === 'week') {
        const startDate = new Date(d);
        const dayOfWeek = startDate.getDay();
        const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        startDate.setDate(startDate.getDate() - diffToMonday);
        
        return startDate;
    }
    
    return d;
}

function getViewEndDate() {
    const d = new Date(currentDate);
    d.setHours(23, 59, 59, 999);
    
    if (currentView === 'month') {
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        const endDate = new Date(lastDay);
        const lastDayOfWeek = lastDay.getDay();
        const daysUntilSunday = lastDayOfWeek === 0 ? 0 : 7 - lastDayOfWeek;
        endDate.setDate(endDate.getDate() + daysUntilSunday);
        endDate.setHours(23, 59, 59, 999);
        return endDate;
    } else if (currentView === 'week') {
        const start = getViewStartDate();
        const endDate = new Date(start);
        endDate.setDate(endDate.getDate() + 6);
        endDate.setHours(23, 59, 59, 999);
        return endDate;
    }
    
    return d;
}

function getDayEvents(date) {
    const dateStr = formatDate(date);
    
    const events = filteredEvents.filter(event => {
        const eventStart = event.start_date.split(' ')[0];
        const eventEnd = event.end_date.split(' ')[0];
        return dateStr >= eventStart && dateStr <= eventEnd;
    });

    return events.sort((a, b) => {
        return a.start_date.localeCompare(b.start_date);
    });
}