// /public/js/weather.js

/**
 * Weather Dashboard Controller
 * 
 * Manages the state-driven rendering of OpenWeatherMap One Call 3.0 data,
 * featuring a high-fidelity current observation card and a 7-day weekly forecast.
 * 
 * Features:
 * - Real-time background synchronization (10m default).
 * - Geocoding-integrated location management (Admin-only).
 * - Client-side JSON parsing for maximum flexibility and performance.
 * - Pattern B: Glassmorphism Dashboard Cards with expanded forecast logic.
 */

const CONFIG = {
    SYNC_INTERVAL_MS: 600000,   // Background synchronization frequency (10m)
    TEMP_HOT_THRESHOLD: 28,     // Celsius threshold for "Hot"
    TEMP_WARM_THRESHOLD: 22,    // Celsius threshold for "Warm"
    TEMP_MILD_THRESHOLD: 14,    // Celsius threshold for "Mild"
    TEMP_COLD_THRESHOLD: 8,     // Celsius threshold for "Cold"
    TEMP_V_COLD_THRESHOLD: 0,   // Celsius threshold for "Sub-zero"
    RAIN_THRESHOLD: 0.1,        // mm threshold for "Rainy" visual state
    GEO_DEBOUNCE_MS: 300        // Delay before triggering geocode search
};

let STATE = {
    observations: [],           // Raw OWM results from DB
    locations: [],              // Managed location metadata
    isAdmin: false
};

/**
 * Bootstraps the module state and establishes event delegation.
 */
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    
    // Establishing polling heartbeat
    setInterval(() => loadState(false), CONFIG.SYNC_INTERVAL_MS);
    
    // Register global modal closure triggers
    if (window.setupGlobalModalClosing) {
        window.setupGlobalModalClosing(['modal-overlay', 'weather-detail-overlay'], [closeLocationModal, closeDetailModal]);
    }

    // Bind UI Events
    const btnAdd = document.getElementById('btnShowAddLocation');
    if (btnAdd) btnAdd.onclick = () => openLocationModal();

    const form = document.getElementById('locationForm');
    if (form) form.onsubmit = saveLocation;

    const btnGeocode = document.getElementById('btnGeocode');
    if (btnGeocode) btnGeocode.onclick = handleGeocode;

    const geocodeInput = document.getElementById('citySearchInput');
    if (geocodeInput) {
        geocodeInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); handleGeocode(); } };
    }
});

/**
 * --- Core Data Management ---
 */

/**
 * Returns a CSS class name based on temperature value for context-aware styling.
 */
function getTempClass(temp) {
    if (temp >= CONFIG.TEMP_HOT_THRESHOLD) return 'temp-hot';      // 28+
    if (temp >= CONFIG.TEMP_WARM_THRESHOLD) return 'temp-warm';    // 22-27
    if (temp >= CONFIG.TEMP_MILD_THRESHOLD) return 'temp-mild';    // 14-21
    if (temp >= CONFIG.TEMP_COLD_THRESHOLD) return 'temp-cold';    // 8-13
    return 'temp-v-cold';                                          // Everything below 8
}

async function loadState(force = false) {
    const isModalOpen = document.getElementById('locationModal')?.classList.contains('show');
    const isInputFocused = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT');

    if (!force && (isModalOpen || isInputFocused)) return;

    try {
        const res = await apiPost('/weather/api/state');
        if (res && res.success) {
            STATE.observations = res.observations || [];
            STATE.isAdmin = !!res.is_admin;
            if (STATE.isAdmin) {
                STATE.locations = res.locations || [];
            }
            renderUI();
        }
    } catch (err) {
        console.error("Weather State Sync Failed:", err);
    }
}

/**
 * --- UI Rendering Engine ---
 */

function renderUI() {
    renderWeatherDashboard();
    if (STATE.isAdmin) {
        renderLocationLedger();
        const adminSection = document.getElementById('adminSection');
        if (adminSection) adminSection.classList.remove('hidden');
    }
}

function renderWeatherDashboard() {
    const container = document.getElementById('weatherDashboard');
    if (!container) return;

    if (STATE.observations.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="status-icon-glow">${getIcon('weather')}</div>
                <p>No locations configured or pending synchronization.</p>
                ${STATE.isAdmin ? '<p class="empty-hint">Use the "+" button to track your first city.</p>' : ''}
            </div>`;
        return;
    }

    container.innerHTML = STATE.observations.map(obs => {
        let data;
        try {
            data = JSON.parse(obs.data_json || '{}');
        } catch (e) {
            return `<div class="error-card glass-card">Parse Error: ${obs.name}</div>`;
        }

        if (!data.current) return `<div class="error-card glass-card">Waiting for sync: ${obs.name}</div>`;

        const current = data.current;
        const nowSec = Math.floor(Date.now() / 1000);
        const cityTz = data.timezone || APP_TZ;
        
        // Find the hourly sample closest to 'Now' for current metrics
        let currentHour = data.hourly?.[0];
        if (data.hourly) {
            let minDiff = Math.abs(currentHour.dt - nowSec);
            for (let h of data.hourly) {
                let diff = Math.abs(h.dt - nowSec);
                if (diff < minDiff) {
                    minDiff = diff;
                    currentHour = h;
                }
            }
        }

        const temp = parseFloat(current.temp || 0);
        const wind = (current.wind_speed * 3.6).toFixed(1); // m/s to km/h
        const description = current.weather?.[0]?.description || 'Unknown';
        const iconCode = current.weather?.[0]?.icon || '01d';
        const rainChance = currentHour?.pop !== undefined ? Math.round(currentHour.pop * 100) : 0;

        // Visual State Detection
        let visualClass = '';
        if (temp >= CONFIG.TEMP_HOT_THRESHOLD) visualClass = 'is-hot';
        else if (temp <= CONFIG.TEMP_COLD_THRESHOLD) visualClass = 'is-cold';
        if ((current.rain?.['1h'] || 0) > CONFIG.RAIN_THRESHOLD) visualClass += ' is-rainy';

        const lastRefreshed = new Date(obs.observed_at.replace(' ', 'T')).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: cityTz });

        return `
            <div class="weather-card ${visualClass}" id="weather-card-${obs.location_id}" onclick="showForecastDetail(${obs.location_id}, 0)">
                <div class="card-main-info">
                    <div class="card-header">
                        <div class="location-meta">
                            <h2 class="location-name">${escapeHtml(obs.name)}</h2>
                        </div>
                        <div class="weather-icon-large">
                            <img src="https://openweathermap.org/img/wn/${iconCode}@4x.png" alt="${description}">
                        </div>
                    </div>
                    
                    <div class="weather-primary">
                        <div class="current-temp ${getTempClass(temp)}">
                            ${Math.round(temp)}<span class="unit">°C</span>
                        </div>
                        <div class="current-condition">${description}</div>
                    </div>

                    <div class="weather-stats">
                        <div class="stat-item">
                            <span class="stat-label">Rain Chance</span>
                            <span class="stat-value">☔ ${rainChance}%</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Wind</span>
                            <span class="stat-value">💨 ${wind} <span class="unit-small">km/h</span></span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Clouds</span>
                            <span class="stat-value">☁️ ${current.clouds}%</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Humidity</span>
                            <span class="stat-value">💧 ${current.humidity}%</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Feels Like</span>
                            <span class="stat-value">🌡️ ${Math.round(current.feels_like)}°</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">UV Index</span>
                            <span class="stat-value">☀️ ${current.uvi || 0}</span>
                        </div>
                    </div>
                </div>

                <div class="forecast-section">
                    <div class="forecast-grid">
                        ${renderForecastDays(data.daily, obs.location_id, cityTz)}
                    </div>
                </div>

                <div class="card-footer-meta">
                    Last refreshed: ${lastRefreshed.toLowerCase()}
                </div>
            </div>
        `;
    }).join('');

    // Initialize Scroll Hints (Targeting the Main Container for fixed positioning)
    const grid = document.getElementById('weatherDashboard');
    const weatherContainer = document.querySelector('.weather-container');

    if (grid && weatherContainer && STATE.observations.length > 1) {
        weatherContainer.classList.add('has-multiple-locations');
        
        const btnPrev = document.getElementById('scrollPrev');
        const btnNext = document.getElementById('scrollNext');

        if (btnPrev && btnNext) {
            btnPrev.onclick = () => grid.scrollBy({ left: -grid.clientWidth * 0.95, behavior: 'smooth' });
            btnNext.onclick = () => grid.scrollBy({ left: grid.clientWidth * 0.95, behavior: 'smooth' });
        }

        const updateScrollState = () => {
            const scrollLeft = grid.scrollLeft;
            const scrollWidth = grid.scrollWidth;
            const clientWidth = grid.clientWidth;

            // More lenient buffers for various mobile browsers
            const atStart = scrollLeft <= 20;
            const atEnd = scrollLeft + clientWidth >= scrollWidth - 20;
            
            // Only show hints if we actually have enough content to scroll
            if (scrollWidth <= clientWidth) {
                weatherContainer.dataset.scrollState = 'none';
                return;
            }

            if (atStart) {
                weatherContainer.dataset.scrollState = 'start';
            } else if (atEnd) {
                weatherContainer.dataset.scrollState = 'end';
            } else {
                weatherContainer.dataset.scrollState = 'middle';
            }
        };

        grid.addEventListener('scroll', updateScrollState, { passive: true });
        
        // Immediate check and delayed checks for layout stabilization
        updateScrollState();
        setTimeout(updateScrollState, 100);
        setTimeout(updateScrollState, 500); 
    }
}

function renderForecastDays(daily = [], locationId, cityTz = APP_TZ) {
    if (!daily || daily.length === 0) return '<p>Forecast unavailable.</p>';

    // Skip today (index 0) and show next 7 days
    return daily.slice(1, 8).map((day, index) => {
        const date = new Date(day.dt * 1000);
        const dayName = date.toLocaleDateString([], { weekday: 'short', timeZone: cityTz });
        const icon = day.weather?.[0]?.icon || '01d';
        const max = Math.round(day.temp.max);
        const min = Math.round(day.temp.min);

        const isSunday = date.getDay() === 0;
        const sundayClass = isSunday ? 'is-sunday' : '';

        // forecast-day starts at index 1 of daily array
        return `
            <div class="forecast-day" onclick="showForecastDetail(${locationId}, ${index + 1}); event.stopPropagation();">
                <span class="day-name ${sundayClass}">${dayName}</span>
                <img class="forecast-icon" src="https://openweathermap.org/img/wn/${icon}@2x.png" alt="">
                <div class="day-temps">
                    <span class="temp-max ${getTempClass(max)}">${max}°</span>
                    <span class="temp-min ${getTempClass(min)}">${min}°</span>
                </div>
            </div>
        `;
    }).join('');
}

function renderLocationLedger() {
    const tbody = document.getElementById('locationLedger');
    const container = document.querySelector('.weather-container');
    if (!tbody || !container) return;

    // Toggle scroll hint based on volume
    const grid = document.querySelector('.weather-grid');
    if (grid) {
        if (STATE.observations.length > 1) {
            grid.classList.add('has-multiple-locations');
        } else {
            grid.classList.remove('has-multiple-locations');
        }
    }

    if (STATE.locations.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center">No tracked locations.</td></tr>`;
        return;
    }

    tbody.innerHTML = STATE.locations.map((l, index) => {
        const canMoveUp = index > 0;
        const canMoveDown = index < STATE.locations.length - 1;
        const lat = parseFloat(l.lat).toFixed(4);
        const lon = parseFloat(l.lon).toFixed(4);

        return `
            <tr id="location-row-${l.id}">
                <td data-label="Sort" class="text-center">
                    <div class="sort-controls">
                        <button type="button" class="btn-sort" onclick="reorderLocation(${l.id}, 'up')" ${!canMoveUp ? 'disabled' : ''}>▲</button>
                        <button type="button" class="btn-sort" onclick="reorderLocation(${l.id}, 'down')" ${!canMoveDown ? 'disabled' : ''}>▼</button>
                    </div>
                </td>
                <td data-label="Location"><strong>${escapeHtml(l.name)}</strong></td>
                <td data-label="Coordinates"><code>${lat}, ${lon}</code></td>
                <td data-label="Interval" class="text-center">${l.update_interval_mins}m</td>
                <td data-label="Actions" class="text-right">
                    <div class="action-buttons">
                        <button type="button" class="btn-icon-edit" onclick="editLocation(${l.id})" title="Edit">${getIcon('edit')}</button>
                        <button type="button" class="btn-icon-delete" onclick="confirmDeleteLocation(${l.id}, '${escapeHtml(l.name)}')" title="Delete Forever">${getIcon('delete')}</button>
                    </div>
                </td>
            </tr>`;
    }).join('');
}

/**
 * Handle re-ordering of locations.
 * Performs a local swap first for responsiveness, then persists to server.
 */
function reorderLocation(id, direction) {
    const currentIndex = STATE.locations.findIndex(l => l.id === id);
    if (currentIndex === -1) return;

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= STATE.locations.length) return;

    // Swap locally
    const temp = STATE.locations[currentIndex];
    STATE.locations[currentIndex] = STATE.locations[newIndex];
    STATE.locations[newIndex] = temp;

    // Re-render immediately
    renderLocationLedger();

    const ids = STATE.locations.map(l => l.id).join(',');
    apiPost('/weather/api/reorder', { ids: ids })
    .then(data => {
        if (data && data.success) {
            loadState();
        }
    });
}


/**
 * --- Helper Utilities ---
 */

/**
 * Formats a Unix timestamp into a localized 12-hour AM/PM string.
 * @param {number} unix - The Unix timestamp to format.
 * @returns {string} - Formatted time string (e.g., '12:00 PM').
 */

function formatTimeOnly(unix, cityTz = APP_TZ) {
    if (!unix) return '-';
    return new Intl.DateTimeFormat([], { 
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: true, 
        timeZone: cityTz 
    }).format(new Date(unix * 1000));
}

/**
 * Converts a wind degree into a compass direction (e.g., N, NE).
 * @param {number} deg - Wind direction in degrees.
 * @returns {string} - Compass direction abbreviation.
 */
function getCompassDirection(deg) {
    if (deg === undefined || deg === null) return '-';
    const val = Math.floor((deg / 22.5) + 0.5);
    const arr = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return arr[(val % 16)];
}

/**
 * maps a raw UVI value to a human-readable risk label.
 * @param {number} uvi - The UV Index value.
 * @returns {string} - Descriptive risk level (e.g., 'Low', 'High').
 */
function getUvLabel(uvi) {
    if (uvi === undefined || uvi === null) return '-';
    if (uvi < 3) return 'Low';
    if (uvi < 6) return 'Moderate';
    if (uvi < 8) return 'High';
    if (uvi < 11) return 'Very High';
    return 'Extreme';
}

/**
 * Generates an SVG-based hourly temperature trendline.
 * @param {Array} hourly - OWM hourly data array (48h max).
 * @param {Date} selectedDate - The date of the clicked forecast card.
 * @returns {string} - HTML string containing the SVG chart.
 */
function renderHourlyTrendline(hourly, selectedDate, cityTz = APP_TZ) {
    if (!hourly || !hourly.length) return '';

    // Project the selected day's boundaries into the city's local timezone
    const dayStart = new Date(selectedDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);

    const dataPoints = hourly.filter(h => {
        const hDt = h.dt * 1000;
        return hDt >= dayStart.getTime() && hDt <= dayEnd.getTime();
    });

    if (dataPoints.length < 3) return '';

    // Dynamic Range: Edge-to-edge based on available data points
    const startTime = dataPoints[0].dt;
    const endTime = dataPoints[dataPoints.length - 1].dt;
    const duration = endTime - startTime;

    // SVG parameters
    const width = 1000; 
    const height = 100;
    
    // Y-Scale based on filtered data
    const temps = dataPoints.map(p => p.temp);
    const minT = Math.min(...temps) - 1;
    const maxT = Math.max(...temps) + 1;
    const range = maxT - minT;
    
    const points = dataPoints.map((p) => {
        const x = ((p.dt - startTime) / duration) * width;
        const y = height - ((p.temp - minT) / range) * height;
        const popY = height - (p.pop * (height - 10) + 5); 
        return { x, y, popY, temp: p.temp, dt: p.dt, weather: p.weather[0], pop: p.pop };
    });

    // Generate Temperature Path (Cubic Bezier)
    let d = `M ${points[0].x},${points[0].y}`;
    let popD = `M ${points[0].x},${points[0].popY}`;

    for (let i = 0; i < points.length - 1; i++) {
        const curr = points[i];
        const next = points[i + 1];
        const cpX = (curr.x + next.x) / 2;
        d += ` C ${cpX},${curr.y} ${cpX},${next.y} ${next.x},${next.y}`;
        popD += ` C ${cpX},${curr.popY} ${cpX},${next.popY} ${next.x},${next.popY}`;
    }

    const fillD = `${d} L ${width},${height} L 0,${height} Z`;

    // Calculate 'Now' indicator (always far-left for 'today')
    const nowSec = Math.floor(Date.now() / 1000);
    let nowX = -1;
    if (nowSec >= startTime && nowSec <= endTime) {
        nowX = ((nowSec - startTime) / duration) * width;
    }

    // Dynamic bottom labels (4-5 points across the range)
    const labelIndices = [0, Math.floor(points.length*0.25), Math.floor(points.length*0.5), Math.floor(points.length*0.75), points.length-1];

    return `
        <div class="weather-trend-box">
            <svg viewBox="0 0 ${width} ${height}" class="trend-svg" preserveAspectRatio="none">
                <defs>
                    <linearGradient id="trendGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" style="stop-color:#ffffff;stop-opacity:0.8" />
                        <stop offset="100%" style="stop-color:#ffffff;stop-opacity:0" />
                    </linearGradient>
                </defs>
                <path d="${fillD}" class="trend-fill" fill="url(#trendGradient)" />
                <path d="${d}" class="trend-path" />
                <path d="${popD}" class="pop-path" />
                ${nowX >= 0 ? `<line x1="${nowX}" y1="0" x2="${nowX}" y2="${height}" class="now-marker-line" />` : ''}
            </svg>

            <div class="trend-points-overlay">
                ${nowX >= 0 ? (() => {
                    const nowPoint = points.reduce((prev, curr) => Math.abs(curr.dt - nowSec) < Math.abs(prev.dt - nowSec) ? curr : prev);
                    const nowPopVal = Math.round(nowPoint.pop * 100);
                    const nowLeft = (nowX / width) * 100;
                    return nowPopVal > 0 ? `<div class="trend-pop-label" style="left: ${nowLeft}%; color: #60a5fa; font-weight: 900; z-index: 10;">☔ ${nowPopVal}%</div>` : '';
                })() : ''}
                ${labelIndices.map(idx => {
                    const p = points[idx];
                    const icon = p.weather?.main === 'Rain' ? '🌧️' : (p.weather?.main === 'Clouds' ? '☁️' : '☀️');
                    const left = (p.x / width) * 100;
                    const top = (p.y / height) * 100;
                    return `
                        <div class="trend-point-label" style="left: ${left}%; top: ${top}%">
                            <span class="trend-emoji">${icon}</span>
                            <span class="trend-label-text">${Math.round(p.temp)}°</span>
                        </div>
                    `;
                }).join('')}
            </div>

            <div class="trend-axis-labels">
                ${labelIndices.map(idx => {
                    const p = points[idx];
                    const labelTime = new Intl.DateTimeFormat([], { hour: 'numeric', hour12: true, timeZone: cityTz }).format(new Date(p.dt * 1000));
                    const left = (p.x / width) * 100;
                    return `<div class="axis-time" style="left: ${left}%">${labelTime}</div>`;
                }).join('')}
            </div>
        </div>
    `;
}

function showForecastDetail(locationId, dayIndex) {
    const obs = STATE.observations.find(x => x.location_id === locationId);
    const loc = STATE.locations.find(x => x.id === locationId);
    if (!obs || !loc) return;

    let data;
    try {
        data = JSON.parse(obs.data_json);
    } catch (e) {
        return;
    }

    const day = data.daily[dayIndex];
    if (!day) return;

    const cityTz = data.timezone || APP_TZ;
    const modal = document.getElementById('detailModal');
    const body = document.getElementById('detailContent');
    const titleEl = document.querySelector('.weather-detail-title');
    if (!modal || !body) return;

    const date = new Date(day.dt * 1000);
    const dateStr = date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', timeZone: cityTz });
    const description = (day.summary || day.weather[0].description);
    const iconCode = day.weather[0].icon;
    
    // Visibility Extraction (from nearest hour)
    let visibility = '-';
    if (data.hourly) {
        const matchingHour = data.hourly.find(h => {
            const hDate = new Date(h.dt * 1000);
            return hDate.getDate() === date.getDate() && hDate.getHours() >= 10;
        }) || data.hourly.find(h => new Date(h.dt * 1000).getDate() === date.getDate());
        
        if (matchingHour && matchingHour.visibility) {
            visibility = (matchingHour.visibility / 1000).toFixed(1) + ' km';
        }
    }

    // Feels Like estimate (avg of relevant day periods)
    const rfHigh = Math.round(Math.max(day.feels_like.day, day.feels_like.eve, day.feels_like.morn));
    const rfLow = Math.round(Math.min(day.feels_like.night, day.feels_like.morn));
    const avgFeelsLike = Math.round((rfHigh + rfLow) / 2);

    if (titleEl) {
        titleEl.innerHTML = `${escapeHtml(loc.name)} <span style="font-weight:400; font-size:0.85rem; color:#94a3b8; margin-left:0.5rem;">${dateStr}</span>`;
    }

    const trendlineHtml = renderHourlyTrendline(data.hourly, date, cityTz);

    body.innerHTML = `
        <div class="hero-v2-container">
            <div class="hero-v2-main">
                <div class="hero-v2-temp-box">
                    <span class="hero-v2-main-temp">${Math.round(day.temp.day)}°</span>
                    <div class="hero-v2-status-line">
                        <div class="hero-v2-hi-lo-chips">
                            <span style="color:#f87171;">▲ ${Math.round(day.temp.max)}°</span>
                            <span style="color:#60a5fa;">▼ ${Math.round(day.temp.min)}°</span>
                        </div>
                        <div class="hero-v2-feels-like">FEELS LIKE <span>${avgFeelsLike}°</span></div>
                    </div>
                </div>
                
                <div class="hero-v2-icon-box">
                    <img src="https://openweathermap.org/img/wn/${iconCode}@4x.png" alt="">
                    <span class="hero-v2-description">${description}</span>
                </div>
            </div>
            <div class="accu-separator"></div>
            ${trendlineHtml ? `${trendlineHtml}<div class="accu-separator"></div>` : ''}

        <div class="accu-grid">
            <div class="accu-item">
                <div class="accu-icon">☔</div>
                <div class="accu-text">
                    <span class="accu-label">Rain Ch.</span>
                    <span class="accu-value">${Math.round(day.pop * 100)}%</span>
                </div>
            </div>
            <div class="accu-item">
                <div class="accu-icon">🌅</div>
                <div class="accu-text">
                    <span class="accu-label">Sunrise</span>
                    <span class="accu-value">${formatTimeOnly(day.sunrise, cityTz)}</span>
                </div>
            </div>
            <div class="accu-item">
                <div class="accu-icon">🌆</div>
                <div class="accu-text">
                    <span class="accu-label">Sunset</span>
                    <span class="accu-value">${formatTimeOnly(day.sunset, cityTz)}</span>
                </div>
            </div>
            <div class="accu-item">
                <div class="accu-icon">🌧️</div>
                <div class="accu-text">
                    <span class="accu-label">Precip.</span>
                    <span class="accu-value">${day.rain ? day.rain + 'mm' : '0mm'}</span>
                </div>
            </div>
            <div class="accu-item">
                <div class="accu-icon">💨</div>
                <div class="accu-text">
                    <span class="accu-label">Wind</span>
                    <span class="accu-value">${Math.round(day.wind_speed * 3.6)}km/h</span>
                </div>
            </div>
            <div class="accu-item">
                <div class="accu-icon">🧭</div>
                <div class="accu-text">
                    <span class="accu-label">Direction</span>
                    <span class="accu-value">${getCompassDirection(day.wind_deg)}</span>
                </div>
            </div>
            <div class="accu-item">
                <div class="accu-icon">🌪️</div>
                <div class="accu-text">
                    <span class="accu-label">Gusts</span>
                    <span class="accu-value">${day.wind_gust ? Math.round(day.wind_gust * 3.6) + 'km/h' : '-'}</span>
                </div>
            </div>
            <div class="accu-item">
                <div class="accu-icon">☀️</div>
                <div class="accu-text">
                    <span class="accu-label">UV Index</span>
                    <span class="accu-value">${day.uvi || 0}</span>
                </div>
            </div>
            <div class="accu-item">
                <div class="accu-icon">☁️</div>
                <div class="accu-text">
                    <span class="accu-label">Cloud</span>
                    <span class="accu-value">${day.clouds}%</span>
                </div>
            </div>
            <div class="accu-item">
                <div class="accu-icon">💧</div>
                <div class="accu-text">
                    <span class="accu-label">Humidity</span>
                    <span class="accu-value">${day.humidity}%</span>
                </div>
            </div>
            <div class="accu-item">
                <div class="accu-icon">⚖️</div>
                <div class="accu-text">
                    <span class="accu-label">Pressure</span>
                    <span class="accu-value">${day.pressure}</span>
                </div>
            </div>
            <div class="accu-item">
                <div class="accu-icon">🌡️</div>
                <div class="accu-text">
                    <span class="accu-label">Dew Pt.</span>
                    <span class="accu-value">${Math.round(day.dew_point)}°</span>
                </div>
            </div>
            <div class="accu-item">
                <div class="accu-icon">🌔</div>
                <div class="accu-text">
                    <span class="accu-label">Moonrise</span>
                    <span class="accu-value">${formatTimeOnly(day.moonrise, cityTz)}</span>
                </div>
            </div>
            <div class="accu-item">
                <div class="accu-icon">🌘</div>
                <div class="accu-text">
                    <span class="accu-label">Moonset</span>
                    <span class="accu-value">${formatTimeOnly(day.moonset, cityTz)}</span>
                </div>
            </div>
            <div class="accu-item">
                <div class="accu-icon">🌑</div>
                <div class="accu-text">
                    <span class="accu-label">Moon Ph.</span>
                    <span class="accu-value">${Math.round(day.moon_phase * 100)}%</span>
                </div>
            </div>
            <div class="accu-item">
                <div class="accu-icon">👁️</div>
                <div class="accu-text">
                    <span class="accu-label">Visibility</span>
                    <span class="accu-value">${visibility}</span>
                </div>
            </div>
            <div class="accu-item">
                <div class="accu-icon">🥶</div>
                <div class="accu-text">
                    <span class="accu-label">Wind Chill</span>
                    <span class="accu-value">${Math.round(day.feels_like.night)}°</span>
                </div>
            </div>
        </div>
    `;

    modal.classList.add('show');
    document.body.classList.add('modal-open');
}

function closeDetailModal() {
    const modal = document.getElementById('detailModal');
    if (modal) {
        modal.classList.remove('show');
        document.body.classList.remove('modal-open');
    }
}

window.showForecastDetail = showForecastDetail;
window.closeDetailModal = closeDetailModal;

/**
 * --- Administrative Handlers ---
 */

async function handleGeocode() {
    const input = document.getElementById('citySearchInput');
    const tray = document.getElementById('geocodeResults');
    const query = input?.value.trim();
    if (!query || query.length < 3) return;

    tray.innerHTML = `${getIcon('waiting')} Searching coordinates...`;
    
    try {
        const res = await apiPost('/weather/api/geocode', { q: query });
        if (res && res.success && res.results) {
            if (res.results.length === 0) {
                tray.innerHTML = '<div class="search-no-results">No cities found.</div>';
                return;
            }

            tray.innerHTML = res.results.map(city => `
                <div class="search-result-item" onclick="selectGeoCity('${escapeHtml(city.name)}', '${escapeHtml(city.state || '')}', '${escapeHtml(city.country)}', ${city.lat}, ${city.lon})">
                    <div class="result-main">${escapeHtml(city.name)}, ${escapeHtml(city.country)}</div>
                    <div class="result-sub">${escapeHtml(city.state || '')} (${city.lat.toFixed(2)}, ${city.lon.toFixed(2)})</div>
                </div>
            `).join('');
        } else {
            tray.innerHTML = `<div class="search-error">${res.error || 'Search failed.'}</div>`;
        }
    } catch (err) {
        tray.innerHTML = '<div class="search-error">Geocoding service offline.</div>';
    }
}

function selectGeoCity(name, state, country, lat, lon) {
    const fullName = `${name}${state ? ', ' + state : ''} (${country})`;
    document.getElementById('locationName').value = name;
    document.getElementById('locationLat').value = lat;
    document.getElementById('locationLon').value = lon;
    document.getElementById('geocodeResults').innerHTML = '';
    document.getElementById('citySearchInput').value = fullName;
}

function openLocationModal(id = null) {
    const modal = document.getElementById('locationModal');
    const form = document.getElementById('locationForm');
    const title = document.getElementById('modalTitle');
    if (!modal || !form) return;

    form.reset();
    document.getElementById('editLocationId').value = '';
    document.getElementById('geocodeResults').innerHTML = '';
    document.getElementById('citySearchInput').value = '';
    title.innerHTML = `${getIcon('add')} Track New Location`;

    if (id) {
        const l = STATE.locations.find(x => x.id === id);
        if (l) {
            title.innerHTML = `${getIcon('edit')} Edit Location`;
            document.getElementById('editLocationId').value = l.id;
            document.getElementById('locationName').value = l.name;
            document.getElementById('locationLat').value = l.lat;
            document.getElementById('locationLon').value = l.lon;
            document.getElementById('updateInterval').value = l.update_interval_mins;
        }
    }

    modal.classList.add('show');
    document.body.classList.add('modal-open');
}

function closeLocationModal() {
    const modal = document.getElementById('locationModal');
    if (modal) modal.classList.remove('show');
    document.body.classList.remove('modal-open');
}

window.editLocation = (id) => openLocationModal(id);

async function saveLocation(e) {
    e.preventDefault();
    const btn = document.getElementById('btnSaveLocation');
    const id = document.getElementById('editLocationId').value;
    const url = id ? `/weather/api/update/${id}` : '/weather/api/add';
    const formData = new FormData(e.target);
    formData.set('is_active', 1); // Mandatory active sync
    
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${getIcon('waiting')} Saving...`;

    try {
        const res = await apiPost(url, formData);
        if (res && res.success) {
            closeLocationModal();
            loadState(true);
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

async function confirmDeleteLocation(id, name) {
    if (!window.showConfirmModal) return;

    window.showConfirmModal({
        title: 'Stop Tracking',
        message: `Permanently delete weather data for <strong>${name}</strong>?`,
        danger: true,
        confirmText: 'Delete Forever',
        onConfirm: async () => {
            const res = await apiPost(`/weather/api/delete/${id}`);
            if (res && res.success) loadState(true);
        }
    });
}


window.loadState = loadState;
