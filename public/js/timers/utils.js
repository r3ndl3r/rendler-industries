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

    // Make API call with error handling
    apiCall: async function(url, method = 'GET', data = null) {
        try {
            const options = {
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                }
            };
            
            if (data && method !== 'GET') {
                options.body = JSON.stringify(data);
            }
            
            const response = await fetch(url, options);
            return await response.json();
        } catch (error) {
            console.error('API call failed:', error);
            return { success: false, message: 'Network error' };
        }
    },

    // Show toast notification
    showToast: function(message, type = 'info') {
        if (typeof showToast === 'function') {
            showToast(message, type);
        } else {
            console.warn('Global showToast not found, falling back to alert');
            alert(message);
        }
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

