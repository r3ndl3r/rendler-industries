// /public/js/calendar/calendar.js

/**
 * Calendar Module Bootloader
 * 
 * This module orchestrates the sequential loading of all calendar sub-systems.
 * It ensures that dependencies (utilities, navigation) are fully available
 * before the main application logic (events, manage) is initialized.
 * 
 * Features:
 * - Deterministic loading order for calendar-specific scripts
 * - Centralized registry of calendar subsystem paths
 * - Automated DOM-based script injection
 */

(function() {
    /**
     * Constant: Subsystem Load Order
     * Defined sequentially to prevent dependency race conditions.
     */
    const scripts = [
        '/js/calendar/utils.js',       // 1. Core Helpers
        '/js/calendar/modals.js',      // 2. Interface Layer
        '/js/calendar/navigation.js',  // 3. Viewport Control
        '/js/calendar/render.js',      // 4. Viewport Layout
        '/js/calendar/upcoming.js',    // 5. Sidebar Widget
        '/js/calendar/events.js',      // 6. Interaction Engine
        '/js/calendar/manage.js',      // 7. Administrative Layer
        '/js/calendar/init.js'         // 8. Bootstrapper (Target: DOMContentLoaded)
    ];
    
    // Lifecycle: Inject script tags with async=false to preserve definition order
    scripts.forEach(src => {
        const script = document.createElement('script');
        script.src = src;
        script.async = false;
        document.head.appendChild(script);
    });
})();
