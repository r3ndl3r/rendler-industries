// /public/js/calendar/calendar.js

// Load all calendar modules in order
(function() {
    const scripts = [
        '/js/calendar/utils.js',       // 1. Helpers
        '/js/calendar/modals.js',      // 2. Modal logic
        '/js/calendar/navigation.js',  // 3. Navigation logic
        '/js/calendar/render.js',      // 4. Rendering logic
        '/js/calendar/upcoming.js',    // 5. Upcoming widget
        '/js/calendar/events.js',      // 6. Event handling
        '/js/calendar/manage.js',      // 7. Management page logic
        '/js/calendar/init.js'         // 8. Start the app (LAST)
    ];
    
    scripts.forEach(src => {
        const script = document.createElement('script');
        script.src = src;
        script.async = false;
        document.head.appendChild(script);
    });
})();
