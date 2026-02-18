// /public/js/calendar/navigation.js

function navigatePrevious() {
    if (currentView === 'month') {
        currentDate.setMonth(currentDate.getMonth() - 1);
    } else if (currentView === 'week') {
        currentDate.setDate(currentDate.getDate() - 7);
    } else if (currentView === 'day') {
        currentDate.setDate(currentDate.getDate() - 1);
    }
    loadEvents();
}

function navigateNext() {
    if (currentView === 'month') {
        currentDate.setMonth(currentDate.getMonth() + 1);
    } else if (currentView === 'week') {
        currentDate.setDate(currentDate.getDate() + 7);
    } else if (currentView === 'day') {
        currentDate.setDate(currentDate.getDate() + 1);
    }
    loadEvents();
}

function navigateToday() {
    currentDate = new Date();
    loadEvents();
}

function updateViewButtons() {
    document.querySelectorAll('.view-btn').forEach(btn => {
        if (btn.dataset.view === currentView) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}