// /public/js/moment-lite.js

/**
 * Moment-Lite: Native Replacement Shim
 * 
 * This module provides a minimal implementation of the Moment.js API 
 * used within Rendler Industries. It leverages the native browser 
 * Intl.DateTimeFormat API to handle timezones and formatting without 
 * the massive dependency overhead.
 * 
 * Supported Patterns:
 * - 'dddd, D MMMM YYYY'
 * - 'dddd MMMM h:mm:ss a'
 */

(function(window) {
    /**
     * Minimal Moment-like object.
     * 
     * @param {Date|number|string} date - Input date
     */
    function MomentLite(date) {
        this._date = date ? new Date(date) : new Date();
        this._tz = null;
    }

    /**
     * Sets the target timezone for subsequent formatting.
     * 
     * @param {string} zone - IANA Timezone (e.g., APP_TZ)
     * @returns {MomentLite}
     */
     MomentLite.prototype.tz = function(zone) {
        this._tz = zone;
        return this;
     };

     /**
     * Formats the date into a specific string pattern.
     * Implements specific logic for the project's dashboard clocks.
     * 
     * @param {string} pattern - Moment-style pattern
     * @returns {string} - Formatted output
     */
    MomentLite.prototype.format = function(pattern) {
        // Fallback sequence: Specific TZ -> Global Config -> Safe Default
        const activeTz = this._tz || (typeof APP_TZ !== 'undefined' ? APP_TZ : 'UTC');
        
        const options = {
            timeZone: activeTz,
            hour12: true
        };

        // Pattern: 'dddd, D MMMM YYYY'
        if (pattern.includes('dddd, D MMMM')) {
            const d = new Intl.DateTimeFormat('en-AU', {
                ...options,
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            }).formatToParts(this._date);
            
            const p = {};
            d.forEach(part => p[part.type] = part.value);
            return `${p.weekday}, ${p.day} ${p.month} ${p.year}`;
        }

         // Pattern: 'dddd MMMM h:mm:ss a'
         if (pattern.includes('h:mm:ss a')) {
             const d = new Intl.DateTimeFormat('en-AU', {
                 ...options,
                 weekday: 'long',
                 month: 'long',
                 hour: 'numeric',
                 minute: '2-digit',
                 second: '2-digit'
             }).formatToParts(this._date);
 
             const p = {};
             d.forEach(part => p[part.type] = part.value);
             const ampm = p.dayPeriod ? p.dayPeriod.toLowerCase() : '';
             return `${p.weekday} ${p.month} ${p.hour}:${p.minute}:${p.second} ${ampm}`;
         }
 
         // Pattern: 'h:mm A'
         if (pattern === 'h:mm A') {
             const d = new Intl.DateTimeFormat('en-AU', {
                 ...options,
                 hour: 'numeric',
                 minute: '2-digit',
                 hour12: true
             }).formatToParts(this._date);
 
             const p = {};
             d.forEach(part => p[part.type] = part.value);
             const ampm = p.dayPeriod ? p.dayPeriod.toUpperCase() : '';
             return `${p.hour}:${p.minute} ${ampm}`;
         }
 
         // Fallback to standard local string if pattern is unknown
         return this._date.toLocaleString('en-AU', options);
     };
 
     /**
      * Returns the timezone abbreviation (e.g., 'AEDT').
      * 
      * @returns {string} - Short timezone notation
      */
     MomentLite.prototype.zoneAbbr = function() {
         const activeTz = this._tz || (typeof APP_TZ !== 'undefined' ? APP_TZ : 'UTC');
         try {
             const d = new Intl.DateTimeFormat('en-AU', {
                 timeZone: activeTz,
                 timeZoneName: 'short'
             }).formatToParts(this._date);
             const p = d.find(part => part.type === 'timeZoneName');
             return p ? p.value : '';
         } catch (e) {
             return '';
         }
     };

    /**
     * Global Entry Point
     */
    window.moment = function(date) {
        return new MomentLite(date);
    };

})(window);
