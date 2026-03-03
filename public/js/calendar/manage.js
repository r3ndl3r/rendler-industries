// /public/js/calendar/manage.js

/**
 * Calendar Management Controller Module
 * 
 * This module manages the administrative Event Ledger interface. It coordinates 
 * large-scale record filtering and facilitates rapid modification of historical 
 * and future calendar data.
 * 
 * Features:
 * - Real-time ledger filtering by event category
 * - administrative edit hooks for individual ledger rows
 * - Unified synchronization with the global event modification interface
 * - Optimized viewport reconciliation for hidden row management
 * 
 * Dependencies:
 * - calendar/modals.js: For modification interface logic
 * - default.js: For status feedback and icon integration
 */

/**
 * Initialization System: setupManagementPage
 * Boots the administrative interface and established filter event delegation.
 */
function setupManagementPage() {
    setupModalListeners();
    setupAllDayToggle();
    setupManagementListeners();
    
    const categoryFilter = document.getElementById('categoryFilter');
    if (categoryFilter) {
        categoryFilter.addEventListener('change', filterManagementTable);
    }
}

/**
 * Logic: filterManagementTable
 * Surgical visibility toggling for ledger rows based on category metadata.
 */
function filterManagementTable() {
    const category = document.getElementById('categoryFilter').value;
    const rows = document.querySelectorAll('.events-table-body tr');
    
    rows.forEach(row => {
        const rowCategory = row.dataset.category || '';
        // Viewport resolution: hide rows that don't match the active filter
        if (!category || rowCategory === category) {
            row.classList.remove('hidden');
        } else {
            row.classList.add('hidden');
        }
    });
}

/**
 * Orchestrates event delegation for administrative ledger actions.
 */
function setupManagementListeners() {
    // Sort logic handled server-side now; preserving hook for future local sort extensions.
    const sortBy = document.getElementById('sortBy');
    if (sortBy) {
        sortBy.addEventListener('change', sortEventsTable);
    }
    
    // Interaction: Attach modification listeners to all edit triggers in the table
    document.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', function() {
            const eventId = this.dataset.id;
            editEventFromTable(eventId);
        });
    });
}

/**
 * Interface Workflow: editEventFromTable
 * Fetches specific record details and triggers the administrative editor.
 * 
 * @param {number} eventId - Target record ID
 */
function editEventFromTable(eventId) {
    const row = document.querySelector(`tr[data-event-id="${eventId}"]`);
    if (!row) return;
    
    // Logic: fetch full range to identify target; improved resolution recommended for large datasets
    fetch(`/calendar/events?start=2020-01-01&end=2030-12-31`)
        .then(response => response.json())
        .then(events => {
            const event = events.find(e => e.id == eventId);
            if (event) {
                // Resolution: transition to modal editor
                openEditModal(event);
            }
        })
        .catch(error => {
            console.error('editEventFromTable failure:', error);
            showToast('Failed to load event details', 'error');
        });
}

/**
 * Stub for future client-side sorting logic.
 */
function sortEventsTable() {
    console.log('sortEventsTable - currently handled via server-side ordering');
}
