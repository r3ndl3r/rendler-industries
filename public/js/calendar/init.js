// /public/js/calendar/init.js

/**
 * Calendar Bootstrapper Module
 * 
 * This module handles the primary application initialization for the 
 * Calendar system. It coordinates view-state detection from URL parameters
 * and initiates the correct display mode logic.
 * 
 * Features:
 * - Deterministic detection of administrative vs dashboard view modes
 * - View-state persistence (Month/Week/Day) from URL parameters
 * - Automatic "Today" pointer resolution
 * - Centralized event-listener attachment for calendar components
 * - 60-second background synchronization start
 * 
 * Dependencies:
 * - calendar/manage.js: For administrative view logic
 * - calendar/events.js: For core event synchronization
 * - calendar/render.js: For initial layout generation
 */

/**
 * Global View State
 */
let currentDate = new Date();       // Active temporal pointer
let currentView = 'month';          // Display resolution
let allEvents = [];                 // Master collection cache
let filteredEvents = [];            // Active view collection
let isManagementPage = false;       // Logic flag for admin mode

/**
 * Initialization Block: startCalendarApp
 * Directs execution to the appropriate sub-system based on URL context.
 */
function startCalendarApp() {
    // Context: resolve administrative context from path
    isManagementPage = window.location.pathname.includes('/manage');
    
    if (isManagementPage) {
        // administrative flow
        setupManagementPage();
    } else {
        // Dashboard flow
        initializeCalendar();
        setupEventListeners();
        setupEventDetailsModalListeners();
        renderCalendar();
        loadEvents();
        startUpcomingCountdownTimer();
    }
}

/**
 * Lifecycle Hook: establish DOM baseline before logic initiation.
 */
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startCalendarApp);
} else {
    startCalendarApp();
}

/**
 * Logic: initializeCalendar
 * Resolves initial temporal pointers and display modes from URL parameters.
 */
function initializeCalendar() {
    const urlParams = new URLSearchParams(window.location.search);
    const viewParam = urlParams.get('view');
    const dateParam = urlParams.get('date');
    
    // Resolution: apply view mode override if valid
    if (viewParam && ['month', 'week', 'day'].includes(viewParam)) {
        currentView = viewParam;
    }
    
    // Resolution: apply date pointer override if valid
    if (dateParam) {
        currentDate = new Date(dateParam);
    }
    
    // UI: Sync navigation pill highlights
    updateViewButtons();
}
