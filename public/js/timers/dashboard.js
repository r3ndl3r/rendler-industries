// /public/js/timers/dashboard.js

/**
 * Timer Dashboard Controller Module
 * 
 * This module manages the real-time device usage timer interface. It 
 * coordinates local optimistic countdowns with high-frequency server 
 * status polling to ensure accurate and responsive time tracking.
 * 
 * Features:
 * - Real-time local countdowns (updated every 1000ms)
 * - Server-side synchronization polling (updated every 10s)
 * - Interactive Start/Pause controls with visual status indicators
 * - Dynamic progress bar management based on daily limits
 * - Full-screen expiry overlays for time-out events
 * - Role-based administrative override detection
 * 
 * Dependencies:
 * - default.js: For apiPost, getIcon, and platform consistency
 * - timers/utils.js: For formatting and progress calculation
 */

const TimerDashboard = {
    /**
     * Module Configuration
     */
    config: {
        updateInterval: 10000,      // Server sync frequency
        statusEndpoint: '/timers/api/status'
    },
    
    updateTimer: null,              // reference for the 1s local loop
    localTimers: {},                // state cache: {timerId: {elapsed, remaining, isRunning, lastUpdate}}
    
    /**
     * Initialization System
     * Boots the dashboard logic and establishes polling loops.
     * 
     * @param {Object} options - Configuration overrides
     */
    init: function(options) {
        this.config = { ...this.config, ...options };
        this.initializeLocalState();
        this.attachEventListeners();
        this.startPolling();
    },
    
    /**
     * Logic: initializeLocalState
     * Bootstraps the local state cache from server-rendered data attributes.
     */
    initializeLocalState: function() {
        const cards = document.querySelectorAll('.timer-card');
        cards.forEach(card => {
            const timerId = card.dataset.timerId;
            const elapsedEl = card.querySelector('.elapsed-time');
            const remainingEl = card.querySelector('.remaining-time');
            
            // Context: only track if the necessary UI nodes are present
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
    
    /**
     * Orchestrates event delegation for timer interaction controls.
     */
    attachEventListeners: function() {
        document.addEventListener('click', (e) => {
            const startBtn = e.target.closest('.btn-start');
            const pauseBtn = e.target.closest('.btn-pause');
            
            if (startBtn) this.handleStart(startBtn);
            else if (pauseBtn) this.handlePause(pauseBtn);
        });
    },
    
    /**
     * Action: handleStart
     * Transmits the start command and triggers an immediate state sync.
     * 
     * @param {HTMLElement} button - Triggering element
     */
    handleStart: async function(button) {
        const timerId = button.dataset.timerId;
        const originalHtml = button.innerHTML;
        
        // UI Feedback: disable button and pulse icon
        button.disabled = true;
        button.innerHTML = `${getIcon('waiting')} ...`;
        
        const result = await apiPost('/timers/start', { timer_id: timerId });
        
        if (result && result.success) {
            // Success: reconcile with server immediately
            await this.refreshStatus();
        } else {
            // Failure: restore button for retry
            button.disabled = false;
            button.innerHTML = originalHtml;
        }
    },
    
    /**
     * Action: handlePause
     * Transmits the pause command and triggers an immediate state sync.
     * 
     * @param {HTMLElement} button - Triggering element
     */
    handlePause: async function(button) {
        const timerId = button.dataset.timerId;
        const originalHtml = button.innerHTML;
        
        // UI Feedback: disable button and pulse icon
        button.disabled = true;
        button.innerHTML = `${getIcon('waiting')} ...`;
        
        const result = await apiPost('/timers/pause', { timer_id: timerId });
        
        if (result && result.success) {
            await this.refreshStatus();
        } else {
            button.disabled = false;
            button.innerHTML = originalHtml;
        }
    },
    
    /**
     * Initialization Block: startPolling
     * Establishes the high-frequency local loop and low-frequency sync loop.
     */
    startPolling: function() {
        // UI Loop: high-resolution 1s updates for smooth UI
        this.updateLocalTimers();
        this.updateTimer = setInterval(() => this.updateLocalTimers(), 1000);
        
        // Sync Loop: background reconciliation with server maintenance
        setInterval(() => this.refreshStatus(), this.config.updateInterval);
    },
    
    /**
     * Logic: updateLocalTimers
     * Increments/Decrements local time counters for active timers.
     * Triggers UI reconciliation for progress bars and overlays.
     */
    updateLocalTimers: function() {
        Object.keys(this.localTimers).forEach(timerId => {
            const timer = this.localTimers[timerId];
            
            // Logic: only mutate active countdowns
            if (timer.isRunning) {
                const card = document.querySelector(`[data-timer-id="${timerId}"]`);
                if (!card) return;
                
                const elapsedEl = card.querySelector('.elapsed-time');
                const remainingEl = card.querySelector('.remaining-time');
                const progressBar = card.querySelector('.status-fill');
                
                // Operation: local state increment
                timer.elapsed++;
                timer.remaining = Math.max(0, timer.remaining - 1);
                
                // UI: Update labels
                if (elapsedEl) {
                    elapsedEl.textContent = TimerUtils.formatTime(timer.elapsed);
                    elapsedEl.dataset.seconds = timer.elapsed;
                }
                
                if (remainingEl) {
                    remainingEl.textContent = TimerUtils.formatTime(timer.remaining);
                    remainingEl.dataset.seconds = timer.remaining;
                    
                    if (timer.remaining <= 0) remainingEl.classList.add('expired');
                }
                
                // UI: Re-calculate progress visual
                if (progressBar) {
                    const limit = timer.elapsed + timer.remaining;
                    TimerUtils.updateProgressBar(progressBar, timer.elapsed, limit);
                }
                
                // Scenario: Threshold Reached
                if (timer.remaining <= 0) {
                    timer.isRunning = false;
                    this.showExpiredOverlay(card);
                }
            }
        });
    },
    
    /**
     * Action: refreshStatus
     * Fetches the latest administrative state from the server.
     * 
     * @returns {Promise<void>}
     */
    refreshStatus: async function() {
        try {
            const response = await fetch(this.config.statusEndpoint, {
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            const result = await response.json();
            
            if (result && result.timers) {
                this.updateTimerCards(result.timers);
            }
        } catch (e) {
            console.error('refreshStatus failure:', e);
        }
    },
    
    /**
     * UI Engine: updateTimerCards
     * Reconciles the local dashboard components with provide server data.
     * 
     * @param {Array} timers - Collection of latest timer configurations
     */
    updateTimerCards: function(timers) {
        timers.forEach(timer => {
            const card = document.querySelector(`[data-timer-id="${timer.id}"]`);
            if (!card) return;

            // Sync: Overwrite local cache with authoritative server data
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

            // UI: Synchronize labels
            if (elapsedEl && timer.elapsed_seconds !== undefined) {
                elapsedEl.textContent = TimerUtils.formatTime(timer.elapsed_seconds);
                elapsedEl.dataset.seconds = timer.elapsed_seconds;
            }

            if (remainingEl) {
                remainingEl.textContent = TimerUtils.formatTime(timer.remaining_seconds);
                remainingEl.dataset.seconds = timer.remaining_seconds;
                
                if (timer.remaining_seconds <= 0) remainingEl.classList.add('expired');
                else remainingEl.classList.remove('expired');
            }

            if (limitEl && timer.limit_seconds !== undefined) {
                const limitMinutes = Math.floor(timer.limit_seconds / 60);
                limitEl.textContent = `${limitMinutes} minutes`;
            }

            if (progressBar) {
                TimerUtils.updateProgressBar(progressBar, timer.elapsed_seconds, timer.limit_seconds);
            }

            // Visual: Update status color classes
            card.dataset.status = timer.status_color;

            // Logic: reconcile interactive buttons
            this.updateControls(card, timer);

            // UI Detail: trigger expiry overlay if newly expired
            if (timer.remaining_seconds <= 0 && !card.querySelector('.expired-overlay')) {
                this.showExpiredOverlay(card);
            }
        });
    },

    /**
     * UI Component: updateControls
     * Manages Start/Pause/Resume button toggling based on timer state.
     * 
     * @param {HTMLElement} card - Target component
     * @param {Object} timer - Source configuration
     */
    updateControls: function(card, timer) {
        const controlsDiv = card.querySelector('.timer-controls');
        if (!controlsDiv) return;
        
        let html = '';
        
        // Resolution: determine active action button
        if (timer.is_running) {
            html += `<button class="btn btn-pause" data-timer-id="${timer.id}">${getIcon('paused')} Pause</button>`;
        } else if (timer.is_paused) {
            html += `<button class="btn btn-pause paused" data-timer-id="${timer.id}">${getIcon('running')} Resume</button>`;
        } else {
            const disabled = timer.remaining_seconds <= 0 ? 'disabled' : '';
            html += `<button class="btn btn-start" data-timer-id="${timer.id}" ${disabled}>${getIcon('running')} Start</button>`;
        }
        
        controlsDiv.innerHTML = html;
        
        // UI Logic: Manage the pulse indicator
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
    
    /**
     * Interface: showExpiredOverlay
     * Renders the administrative time-out block over a timer card.
     * 
     * @param {HTMLElement} card - Target component
     */
    showExpiredOverlay: function(card) {
        if (card.querySelector('.expired-overlay')) return;
        
        const overlay = document.createElement('div');
        overlay.className = 'expired-overlay';
        overlay.innerHTML = `
            <div class="expired-message">
                <span class="expired-icon">${getIcon('clock')}</span>
                <p>Time's Up!</p>
                <small>Ask an admin for more time</small>
            </div>
        `;
        
        card.appendChild(overlay);
    }
};
