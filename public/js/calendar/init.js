// /public/js/calendar/init.js

let currentDate = new Date();
let currentView = 'month';
let allEvents = [];
let filteredEvents = [];
let isManagementPage = false;

function startCalendarApp() {
    isManagementPage = window.location.pathname.includes('/manage');
    
    if (isManagementPage) {
        setupManagementPage();
    } else {
        initializeCalendar();
        setupEventListeners();
        setupEventDetailsModalListeners();
        renderCalendar();
        loadEvents();
        startUpcomingCountdownTimer();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startCalendarApp);
} else {
    startCalendarApp();
}

function initializeCalendar() {
    const urlParams = new URLSearchParams(window.location.search);
    const viewParam = urlParams.get('view');
    const dateParam = urlParams.get('date');
    
    if (viewParam && ['month', 'week', 'day'].includes(viewParam)) {
        currentView = viewParam;
    }
    
    if (dateParam) {
        currentDate = new Date(dateParam);
    }
    
    updateViewButtons();
}