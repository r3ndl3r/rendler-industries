// /public/js/calendar/manage.js

function setupManagementPage() {
    setupModalListeners();
    setupAllDayToggle();
    setupManagementListeners();
    
    const categoryFilter = document.getElementById('categoryFilter');
    if (categoryFilter) {
        categoryFilter.addEventListener('change', filterManagementTable);
    }
}

function filterManagementTable() {
    const category = document.getElementById('categoryFilter').value;
    const rows = document.querySelectorAll('.events-table-body tr');
    
    rows.forEach(row => {
        const rowCategory = row.dataset.category || '';
        if (!category || rowCategory === category) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}

function setupManagementListeners() {
    // Sort logic handled server-side now, so this is just a placeholder
    const sortBy = document.getElementById('sortBy');
    if (sortBy) {
        sortBy.addEventListener('change', sortEventsTable);
    }
    
    document.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', function() {
            const eventId = this.dataset.id;
            editEventFromTable(eventId);
        });
    });
}

function editEventFromTable(eventId) {
    const row = document.querySelector(`tr[data-event-id="${eventId}"]`);
    if (!row) return;
    
    fetch(`/calendar/events?start=2020-01-01&end=2030-12-31`)
        .then(response => response.json())
        .then(events => {
            const event = events.find(e => e.id == eventId);
            if (event) {
                openEditModal(event);
            }
        })
        .catch(error => {
            console.error('Error loading event:', error);
            alert('Failed to load event details');
        });
}

function sortEventsTable() {
    console.log('Sort events table - handled by server');
}