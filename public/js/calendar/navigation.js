// /public/js/calendar/navigation.js

/**
 * Calendar Navigation Module
 * 
 * This module manages the high-level temporal navigation for the Calendar system.
 * It coordinates view-aware date shifting and reconciles button states
 * with the active display mode.
 * 
 * Features:
 * - Deterministic temporal shifting (Previous/Next) based on active view mode
 * - "Today" pointer reset with automated server synchronization
 * - Synchronized visual state management for navigation pills
 */

/**
 * Logic: navigatePrevious
 * Backtracks the calendar pointer based on the current viewport resolution.
 */
function navigatePrevious() {
    if (currentView === 'month') {
        currentDate.setMonth(currentDate.getMonth() - 1);
    } else if (currentView === 'week') {
        currentDate.setDate(currentDate.getDate() - 7);
    } else if (currentView === 'day') {
        currentDate.setDate(currentDate.getDate() - 1);
    }
    // Sync: Fetch new events for updated range
    loadEvents();
}

/**
 * Logic: navigateNext
 * Advances the calendar pointer based on the current viewport resolution.
 */
function navigateNext() {
    if (currentView === 'month') {
        currentDate.setMonth(currentDate.getMonth() + 1);
    } else if (currentView === 'week') {
        currentDate.setDate(currentDate.getDate() + 7);
    } else if (currentView === 'day') {
        currentDate.setDate(currentDate.getDate() + 1);
    }
    // Sync: Fetch new events for updated range
    loadEvents();
}

/**
 * Interface: navigateToday
 * Resets the calendar pointer to the current system date.
 */
function navigateToday() {
    currentDate = new Date();
    loadEvents();
}

/**
 * UI Engine: updateViewButtons
 * Reconciles the visual "active" class across the display mode selector.
 */
function updateViewButtons() {
    document.querySelectorAll('.view-btn').forEach(btn => {
        if (btn.dataset.view === currentView) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}
