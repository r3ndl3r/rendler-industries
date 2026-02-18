// /public/js/timers/dashboard.js

const TimerDashboard = {
    config: {
        updateInterval: 10000, // Poll server every 10 seconds
        statusEndpoint: '/timers/api/status'
    },
    
    updateTimer: null,
    localTimers: {},
    
    init: function(options) {
        this.config = { ...this.config, ...options };
        this.initializeLocalState();
        this.attachEventListeners();
        this.startPolling();
    },
    
    initializeLocalState: function() {
        const cards = document.querySelectorAll('.timer-card');
        cards.forEach(card => {
            const timerId = card.dataset.timerId;
            const elapsedEl = card.querySelector('.elapsed-time');
            const remainingEl = card.querySelector('.remaining-time');
            
            if (elapsedEl && remainingEl) {
                this.localTimers[timerId] = {
                    elapsed: parseInt(elapsedEl.dataset.seconds) || 0,
                    remaining: parseInt(remainingEl.dataset.seconds) || 0,
                    isRunning: card.querySelector('.running-indicator') !== null,
                    lastUpdate: Date.now()
                };
            }
        });
    },
    
    attachEventListeners: function() {
        document.addEventListener('click', (e) => {
            if (e.target.closest('.btn-start')) {
                this.handleStart(e.target.closest('.btn-start'));
            } else if (e.target.closest('.btn-pause')) {
                this.handlePause(e.target.closest('.btn-pause'));
            }
        });
    },
    
    handleStart: async function(button) {
        const timerId = button.dataset.timerId;
        button.disabled = true;
        
        const result = await TimerUtils.apiCall('/timers/start', 'POST', { timer_id: timerId });
        
        if (result.success) {
            TimerUtils.showToast('Timer started', 'success');
            await this.refreshStatus();
        } else {
            TimerUtils.showToast(result.message || 'Failed to start timer', 'error');
        }
        
        button.disabled = false;
    },
    
    handlePause: async function(button) {
        const timerId = button.dataset.timerId;
        button.disabled = true;
        
        const result = await TimerUtils.apiCall('/timers/pause', 'POST', { timer_id: timerId });
        
        if (result.success) {
            const message = result.paused ? 'Timer paused' : 'Timer resumed';
            TimerUtils.showToast(message, 'success');
            await this.refreshStatus();
        } else {
            TimerUtils.showToast(result.message || 'Failed to toggle pause', 'error');
        }
        
        button.disabled = false;
    },
    
    startPolling: function() {
        // Update local timers every second for smooth display
        this.updateLocalTimers();
        this.updateTimer = setInterval(() => this.updateLocalTimers(), 1000);
        
        // Poll server for actual state every 10 seconds
        setInterval(() => this.refreshStatus(), this.config.updateInterval);
    },
    
    updateLocalTimers: function() {
        const now = Date.now();
        
        Object.keys(this.localTimers).forEach(timerId => {
            const timer = this.localTimers[timerId];
            
            if (timer.isRunning) {
                const card = document.querySelector(`[data-timer-id="${timerId}"]`);
                if (!card) return;
                
                const elapsedEl = card.querySelector('.elapsed-time');
                const remainingEl = card.querySelector('.remaining-time');
                const progressBar = card.querySelector('.status-fill');
                
                // Increment local state
                timer.elapsed++;
                timer.remaining = Math.max(0, timer.remaining - 1);
                
                // Update display
                if (elapsedEl) {
                    elapsedEl.textContent = TimerUtils.formatTime(timer.elapsed);
                    elapsedEl.dataset.seconds = timer.elapsed;
                }
                
                if (remainingEl) {
                    remainingEl.textContent = TimerUtils.formatTime(timer.remaining);
                    remainingEl.dataset.seconds = timer.remaining;
                    
                    if (timer.remaining <= 0) {
                        remainingEl.classList.add('expired');
                    }
                }
                
                if (progressBar) {
                    const limit = timer.elapsed + timer.remaining;
                    TimerUtils.updateProgressBar(progressBar, timer.elapsed, limit);
                }
                
                // Show expired overlay if time is up
                if (timer.remaining <= 0) {
                    timer.isRunning = false;
                    this.showExpiredOverlay(card);
                }
            }
        });
    },
    
    refreshStatus: async function() {
        const result = await TimerUtils.apiCall(this.config.statusEndpoint);
        
        if (result && result.timers) {
            this.updateTimerCards(result.timers);
        }
    },
    
    updateTimerCards: function(timers) {
        timers.forEach(timer => {
            const card = document.querySelector(`[data-timer-id="${timer.id}"]`);
            if (!card) return;

            // Sync local state with server data (always update from server)
            this.localTimers[timer.id] = {
                elapsed: timer.elapsed_seconds,
                remaining: timer.remaining_seconds,
                isRunning: timer.is_running,
                lastUpdate: Date.now()
            };

            const elapsedEl = card.querySelector('.elapsed-time');
            const remainingEl = card.querySelector('.remaining-time');
            const progressBar = card.querySelector('.status-fill');
            const limitEl = card.querySelector('.stat-row:nth-child(3) .stat-value');

            if (elapsedEl && timer.elapsed_seconds !== undefined) {
                elapsedEl.textContent = TimerUtils.formatTime(timer.elapsed_seconds);
                elapsedEl.dataset.seconds = timer.elapsed_seconds;
            }

            if (remainingEl) {
                remainingEl.textContent = TimerUtils.formatTime(timer.remaining_seconds);
                remainingEl.dataset.seconds = timer.remaining_seconds;
                
                if (timer.remaining_seconds <= 0) {
                    remainingEl.classList.add('expired');
                } else {
                    remainingEl.classList.remove('expired');
                }
            }

            // Update daily limit display
            if (limitEl && timer.limit_seconds !== undefined) {
                const limitMinutes = Math.floor(timer.limit_seconds / 60);
                limitEl.textContent = `${limitMinutes} minutes`;
            }

            if (progressBar) {
                TimerUtils.updateProgressBar(progressBar, timer.elapsed_seconds, timer.limit_seconds);
            }

            card.dataset.status = timer.status_color;

            this.updateControls(card, timer);

            if (timer.remaining_seconds <= 0 && !card.querySelector('.expired-overlay')) {
                this.showExpiredOverlay(card);
            }
        });
    },

    updateControls: function(card, timer) {
        const controlsDiv = card.querySelector('.timer-controls');
        if (!controlsDiv) return;
        
        let html = '';
        
        // Show ONE button based on current state
        if (timer.is_running) {
            // Timer is running → Show Pause button
            html += `<button class="btn btn-pause" data-timer-id="${timer.id}">⏸️ Pause</button>`;
        } else if (timer.is_paused) {
            // Timer is paused → Show Resume button (clicking unpauses)
            html += `<button class="btn btn-pause paused" data-timer-id="${timer.id}">▶️ Resume</button>`;
        } else {
            // Timer is idle → Show Start button
            const disabled = timer.remaining_seconds <= 0 ? 'disabled' : '';
            html += `<button class="btn btn-start" data-timer-id="${timer.id}" ${disabled}>▶️ Start</button>`;
        }
        
        controlsDiv.innerHTML = html;
        
        // Update running indicator
        const runningIndicator = card.querySelector('.running-indicator');
        if (timer.is_running && !runningIndicator) {
            const indicator = document.createElement('div');
            indicator.className = 'running-indicator';
            indicator.innerHTML = '<span class="pulse-dot"></span>RUNNING';
            controlsDiv.after(indicator);
        } else if (!timer.is_running && runningIndicator) {
            runningIndicator.remove();
        }
    },
    
    showExpiredOverlay: function(card) {
        if (card.querySelector('.expired-overlay')) return;
        
        const overlay = document.createElement('div');
        overlay.className = 'expired-overlay';
        overlay.innerHTML = `
            <div class="expired-message">
                <span class="expired-icon">⏰</span>
                <p>Time's Up!</p>
                <small>Ask an admin for more time</small>
            </div>
        `;
        
        card.appendChild(overlay);
    }
};
