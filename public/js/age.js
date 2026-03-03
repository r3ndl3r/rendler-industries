// /public/js/age.js

/**
 * Uptime and Clock Synchronization Module
 * 
 * This module coordinates the real-time uptime counters and system clocks 
 * displayed on the landing page. It manages synchronization with the server
 * time and implements local incrementing for high-resolution updates.
 * 
 * Features:
 * - Real-time local clock (AEST) with 1-second resolution
 * - Incremental uptime tracking for family members and system core
 * - Periodic server state re-synchronization
 * 
 * Dependencies:
 * - jquery.js: For simplified state fetching
 * - moment.js & moment-tz.js: For timezone-aware clock rendering
 */

/**
 * Data Management: upIndex
 * Fetches the master uptime state from the server.
 */
function upIndex() {
    $.getJSON( 'age', function() { })
    .done(function(data) {
        // Update DOM with exact server values
        document.getElementById('andrea').innerHTML = data.andrea;
        document.getElementById('nicky').innerHTML = data.nicky;
        document.getElementById('andreas').innerHTML = data.andreas;
        document.getElementById('nickys').innerHTML = data.nickys;
        document.getElementById('server').innerHTML = data.server;
        document.getElementById('servers').innerHTML = data.servers;
    });
}

/**
 * UI Engine: upValues
 * Performs optimistic local incrementing of second-based counters.
 * Prevents "lagging" appearance between server polls.
 */
function upValues() {
    document.getElementById('andreas').innerHTML++;
    document.getElementById('nickys').innerHTML++;
    document.getElementById('servers').innerHTML++;
}

/**
 * Main Controller: upPage
 * Initiates the real-time update loop.
 */
function upPage() {
    // Initial sync
    upIndex();
    
    /**
     * Update Loop
     * Resolves local time and increments uptime every 1000ms
     */
    setInterval(function() {
        const timeEl = document.getElementById('time');
        if (timeEl) {
            // Apply timezone-aware formatting
            timeEl.innerHTML = moment(new Date).tz("Australia/Melbourne").format('dddd MMMM h:mm:ss a');
        }
        upValues();
    }, 1000);
}
