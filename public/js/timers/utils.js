// /public/js/timers/utils.js

const TimerUtils = {
    // Format seconds into HH:MM:SS display
    formatTime: function(seconds) {
        if (seconds === 0) return 'EXPIRED';
        if (seconds < 0) {
            const absSeconds = Math.abs(seconds);
            const hours = Math.floor(absSeconds / 3600);
            const minutes = Math.floor((absSeconds % 3600) / 60);
            return `-${hours}:${minutes.toString().padStart(2, '0')} OVER`;
        }
        
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    },

    // Calculate status color based on usage percentage
    getStatusColor: function(elapsed, limit) {
        if (limit === 0) return 'gray';
        
        const percentage = (elapsed / limit) * 100;
        
        if (percentage >= 100) return 'red';
        if (percentage >= 80) return 'yellow';
        return 'green';
    },

    // Update visual progress bar
    updateProgressBar: function(element, elapsed, limit) {
        const percentage = limit > 0 ? Math.min((elapsed / limit) * 100, 100) : 0;
        const color = this.getStatusColor(elapsed, limit);
        
        element.style.width = percentage + '%';
        element.className = `status-fill ${color}`;
    }
};

