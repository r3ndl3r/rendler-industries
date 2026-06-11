// /public/js/notes/api.js

/**
 * NoteAPI: Centralized AJAX Orchestrator for the Whiteboard Module.
 * Provides a standardized, signal-aware transport layer with built-in CSRF 
 * protection, session management, and silent abort handling.
 */
window.NoteAPI = {
    STATE_CACHE_PREFIX: 'notes_state_cache:',
    STATE_CACHE_LAST_KEY: 'notes_state_cache:last',
    STATE_CACHE_STORAGE_NAME: 'notes-state-cache-v1',
    STATE_CACHE_MAX_ENTRIES: 5,
    STATE_CACHE_MAX_AGE_MS: 86400000 * 7,
    stateCacheQuotaWarningShown: false,

    /**
     * Determines whether the browser currently reports an offline transport state.
     * @returns {boolean} True when network requests should fail quietly.
     */
    isOffline() {
        return typeof navigator !== 'undefined'
            && typeof navigator.onLine === 'boolean'
            && !navigator.onLine;
    },

    /**
     * Determines whether a GET request carries the full notes state payload.
     * @param {string} url - Target endpoint.
     * @returns {boolean} True when the endpoint can hydrate the notes board.
     */
    isStateUrl(url) {
        try {
            return new URL(url, window.location.origin).pathname === '/notes/api/state';
        } catch (_) {
            return false;
        }
    },

    /**
     * Builds a stable local cache key for a notes state request.
     * @param {string} url - Target endpoint.
     * @param {string|null} userId - User ID to scope the cache key.
     * @returns {string|null} Cache key scoped to user, board, and layer.
     */
    stateCacheUserId(data = null) {
        return data?.user_id || (typeof STATE !== 'undefined' ? STATE.user_id : null) || null;
    },

    stateCacheLastKey(userId = null) {
        return userId ? `${this.STATE_CACHE_LAST_KEY}:${userId}` : this.STATE_CACHE_LAST_KEY;
    },

    stateCacheKey(url, userId = null) {
        if (!userId) return null;
        const parsed = new URL(url, window.location.origin);
        const canvasId = parsed.searchParams.get('canvas_id') || 'default';
        const layerId = parsed.searchParams.get('layer_id') || 'default';
        return `${this.STATE_CACHE_PREFIX}${userId}:${canvasId}:${layerId}`;
    },

    stateCacheStorageRequest(key) {
        const url = new URL('/notes/__state_cache', window.location.origin);
        url.searchParams.set('key', key);
        return new Request(url.href);
    },

    stateCacheStorageKey(request) {
        try {
            return new URL(request.url).searchParams.get('key') || '';
        } catch (_) {
            return '';
        }
    },

    /**
     * Collects notes-state localStorage cache entries with approximate byte sizes.
     * @returns {Array<{key:string,timestamp:number,bytes:number,corrupt:boolean}>}
     */
    stateCacheEntries() {
        const entries = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith(this.STATE_CACHE_PREFIX) || key.startsWith(this.STATE_CACHE_LAST_KEY)) continue;

            const raw = localStorage.getItem(key) || '';
            let timestamp = 0;
            let corrupt = false;
            try {
                timestamp = JSON.parse(raw)?.timestamp || 0;
            } catch (_) {
                corrupt = true;
            }
            entries.push({ key, timestamp, bytes: key.length + raw.length, corrupt });
        }
        return entries;
    },

    /**
     * Prunes notes state caches by age and count, returning diagnostics.
     * Keeps the current key when supplied, then pops oldest non-current entries.
     * @param {Object} options - { maxEntries, maxAgeMs, keepKey, force }
     * @returns {{removed:number, removedBytes:number, beforeCount:number, beforeBytes:number, afterCount:number, afterBytes:number}}
     */
    pruneStateCache(options = {}) {
        const maxEntries = options.maxEntries ?? this.STATE_CACHE_MAX_ENTRIES;
        const maxAgeMs = options.maxAgeMs ?? this.STATE_CACHE_MAX_AGE_MS;
        const keepKey = options.keepKey || null;
        const now = Date.now();
        const before = this.stateCacheEntries();
        const removed = [];

        const removeEntry = (entry) => {
            if (!entry || entry.key === keepKey) return false;
            localStorage.removeItem(entry.key);
            removed.push(entry);
            return true;
        };

        before
            .filter(entry => entry.key !== keepKey)
            .filter(entry => options.force || entry.corrupt || !entry.timestamp || (now - entry.timestamp > maxAgeMs))
            .forEach(removeEntry);

        const remaining = this.stateCacheEntries()
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        while (remaining.length > maxEntries) {
            const entry = remaining.shift();
            if (entry.key === keepKey) {
                remaining.push(entry);
                if (remaining.every(item => item.key === keepKey)) break;
                continue;
            }
            removeEntry(entry);
        }

        const after = this.stateCacheEntries();
        return {
            removed: before.length - after.length,
            removedBytes: removed.reduce((sum, entry) => sum + entry.bytes, 0),
            beforeCount: before.length,
            beforeBytes: before.reduce((sum, entry) => sum + entry.bytes, 0),
            afterCount: after.length,
            afterBytes: after.reduce((sum, entry) => sum + entry.bytes, 0)
        };
    },

    /**
     * Provides broad localStorage diagnostics for investigating quota pressure.
     * @returns {Array<{prefix:string,count:number,bytes:number}>}
     */
    localStorageDiagnostics() {
        const buckets = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const value = localStorage.getItem(key) || '';
            const prefix = key?.split(':')[0]?.split('_u')[0] || '(unknown)';
            if (!buckets[prefix]) buckets[prefix] = { prefix, count: 0, bytes: 0 };
            buckets[prefix].count++;
            buckets[prefix].bytes += (key?.length || 0) + value.length;
        }
        return Object.values(buckets).sort((a, b) => b.bytes - a.bytes);
    },

    /**
     * Attempts to write a state cache payload, popping oldest non-current entries
     * if localStorage quota is exhausted.
     * @param {string[]} keys - Cache keys to write.
     * @param {string} payload - Serialized payload.
     * @param {string} currentKey - Entry that should be preserved where possible.
     * @returns {{success:boolean,popped:number,poppedBytes:number,error?:any}}
     */
    writeStateCacheWithQuotaRecovery(keys, payload, currentKey, lastKeyName = this.STATE_CACHE_LAST_KEY) {
        let popped = 0;
        let poppedBytes = 0;
        let replacedCurrent = false;
        const aliases = keys.filter(key => key !== currentKey);
        const maxAttempts = this.stateCacheEntries().filter(entry => entry.key !== currentKey).length + 2;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                localStorage.setItem(currentKey, payload);
                localStorage.setItem(lastKeyName, currentKey);
                aliases.forEach((key) => {
                    try {
                        localStorage.setItem(key, payload);
                    } catch (_) {
                        localStorage.removeItem(key);
                    }
                });
                return { success: true, popped, poppedBytes };
            } catch (err) {
                const candidates = this.stateCacheEntries()
                    .filter(entry => entry.key !== currentKey)
                    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

                const victim = candidates[0];
                if (!victim) {
                    if (!replacedCurrent) {
                        const currentPayload = localStorage.getItem(currentKey) || '';
                        localStorage.removeItem(currentKey);
                        localStorage.removeItem(lastKeyName);
                        popped++;
                        poppedBytes += currentKey.length + currentPayload.length;
                        replacedCurrent = true;
                        continue;
                    }
                    return { success: false, popped, poppedBytes, error: err };
                }

                localStorage.removeItem(victim.key);
                popped++;
                poppedBytes += victim.bytes;
                console.warn('Notes state cache quota pressure: popped oldest entry', {
                    key: victim.key,
                    bytes: victim.bytes,
                    popped,
                    poppedBytes
                });
            }
        }

        return { success: false, popped, poppedBytes, error: new Error('Notes state cache quota recovery exhausted') };
    },

    compactStateForCache(data) {
        return {
            success: data.success,
            canvas_id: data.canvas_id,
            notes: data.notes,
            user_id: data.user_id,
            canvases: data.canvases,
            viewport: data.viewport,
            layer_map: data.layer_map,
            last_mutation: data.last_mutation,
            is_locked: data.is_locked
        };
    },

    async writeStateCacheStorage(keys, payload, currentKey, lastKeyName = this.STATE_CACHE_LAST_KEY) {
        if (typeof caches === 'undefined') return { success: false, error: new Error('Cache Storage unavailable') };

        try {
            const cache = await caches.open(this.STATE_CACHE_STORAGE_NAME);
            const responseInit = { headers: { 'Content-Type': 'application/json' } };
            await cache.put(this.stateCacheStorageRequest(currentKey), new Response(payload, responseInit));
            await cache.put(this.stateCacheStorageRequest(lastKeyName), new Response(currentKey, { headers: { 'Content-Type': 'text/plain' } }));

            for (const key of keys.filter(key => key !== currentKey)) {
                try {
                    await cache.put(this.stateCacheStorageRequest(key), new Response(payload, responseInit));
                } catch (_) {
                    await cache.delete(this.stateCacheStorageRequest(key));
                }
            }

            const removable = (await cache.keys()).filter((request) => {
                const key = this.stateCacheStorageKey(request);
                return key && key !== lastKeyName && key !== currentKey;
            });
            while (removable.length > this.STATE_CACHE_MAX_ENTRIES - 1) {
                await cache.delete(removable.shift());
            }
            return { success: true };
        } catch (err) {
            return { success: false, error: err };
        }
    },

    /**
     * Stores a successful notes state payload for offline hydration.
     * @param {string} url - Target endpoint.
     * @param {Object} data - Parsed state payload.
     */
    async cacheState(url, data) {
        if (!data || !data.success || data.is_locked || !Array.isArray(data.notes)) return;
        const userId = this.stateCacheUserId(data);
        if (!userId) return;
        const timestamp = Date.now();
        const payload = JSON.stringify({ timestamp, data });
        const requestKey = this.stateCacheKey(url, userId);
        const resolvedKey = `${this.STATE_CACHE_PREFIX}${userId}:${data.canvas_id || 'default'}:${data.viewport?.layer_id || 'default'}`;
        const keys = Array.from(new Set([requestKey, resolvedKey]));
        const lastKeyName = this.stateCacheLastKey(userId);
        let fallbackPayload = payload;

        const pruned = this.pruneStateCache({ keepKey: resolvedKey });
        let result = this.writeStateCacheWithQuotaRecovery(keys, payload, resolvedKey, lastKeyName);
        let compacted = false;

        if (!result.success) {
            const compactPayload = JSON.stringify({ timestamp, data: this.compactStateForCache(data) });
            if (compactPayload.length < payload.length) {
                fallbackPayload = compactPayload;
                result = this.writeStateCacheWithQuotaRecovery(keys, compactPayload, resolvedKey, lastKeyName);
                compacted = result.success;
            }
        }

        if (!result.success) {
            const storageResult = await this.writeStateCacheStorage(keys, fallbackPayload, resolvedKey, lastKeyName);
            if (storageResult.success) {
                keys.forEach(key => localStorage.removeItem(key));
                localStorage.removeItem(lastKeyName);
                console.warn('Notes state cache stored in Cache Storage after localStorage quota pressure.', {
                    pruned,
                    quotaRecovery: result,
                    compacted
                });
                return;
            }

            const noNotesCacheLeft = pruned.beforeCount === 0 && result.poppedBytes <= resolvedKey.length;
            if (noNotesCacheLeft) {
                if (!this.stateCacheQuotaWarningShown) {
                    this.stateCacheQuotaWarningShown = true;
                    console.info('Notes state cache skipped: localStorage quota is full and no notes cache entries remain to prune.', {
                        payloadBytes: payload.length,
                        storage: this.localStorageDiagnostics(),
                        cacheStorageError: storageResult.error
                    });
                }
                return;
            }
            console.warn('Unable to cache notes state after quota recovery:', {
                error: result.error,
                cacheStorageError: storageResult.error,
                pruned,
                popped: result.popped,
                poppedBytes: result.poppedBytes,
                storage: this.localStorageDiagnostics()
            });
        } else if (pruned.removed > 0 || result.popped > 0 || compacted) {
            console.warn('Notes state cache maintained:', { pruned, quotaRecovery: result, compacted });
        }
    },

    /**
     * Reads the most relevant cached notes state for offline hydration.
     * @param {string} url - Target endpoint.
     * @returns {Object|null} Cached state payload or null.
     */
    cachedState(url) {
        try {
            const userId = this.stateCacheUserId();
            if (!userId) return null;
            const keys = [this.stateCacheKey(url, userId), localStorage.getItem(this.stateCacheLastKey(userId))].filter(Boolean);
            for (const key of keys) {
                const cached = localStorage.getItem(key);
                if (!cached) continue;
                const parsed = JSON.parse(cached);
                if (parsed && parsed.data && parsed.data.success) {
                    parsed.data.offline_cached = true;
                    return parsed.data;
                }
            }
        } catch (err) {
            console.warn('Unable to read cached notes state:', err);
        }
        return null;
    },

    async cachedStateFromStorage(url) {
        if (typeof caches === 'undefined') return null;

        try {
            const userId = this.stateCacheUserId();
            if (!userId) return null;
            const cache = await caches.open(this.STATE_CACHE_STORAGE_NAME);
            const lastResponse = await cache.match(this.stateCacheStorageRequest(this.stateCacheLastKey(userId)));
            const lastKey = lastResponse ? await lastResponse.text() : null;
            const keys = [this.stateCacheKey(url, userId), lastKey].filter(Boolean);

            for (const key of keys) {
                const response = await cache.match(this.stateCacheStorageRequest(key));
                if (!response) continue;
                const parsed = await response.json();
                if (parsed && parsed.data && parsed.data.success) {
                    parsed.data.offline_cached = true;
                    return parsed.data;
                }
            }
        } catch (err) {
            console.warn('Unable to read cached notes state from Cache Storage:', err);
        }
        return null;
    },

    async cachedStateAny(url) {
        return this.cachedState(url) || await this.cachedStateFromStorage(url);
    },

    /**
     * Standard GET Wrapper.
     * @param {string} url - Target endpoint.
     * @param {Object} options - { signal: AbortSignal, timeout: number, silent: boolean }
     * @returns {Promise<Object|null>} Parsed response data.
     */
    async get(url, options = {}) {
        const isStateRequest = this.isStateUrl(url);
        const timeoutMs = options.timeout || (isStateRequest && !options.signal ? 3000 : 0);
        let controller = null;
        let timeoutId = null;
        let timedOut = false;
        let signal = options.signal;

        if (timeoutMs && !signal) {
            controller = new AbortController();
            signal = controller.signal;
            timeoutId = setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, timeoutMs);
        }

        try {
            const response = await fetch(url, { signal });
            if (timeoutId) clearTimeout(timeoutId);
            
            // Session Guard: Centralized 403 handling
            if (response.status === 403) {
                let body403 = null;
                try { body403 = await response.json(); } catch (_) {}
                
                if (body403 && (body403.error === 'Canvas is locked' || body403.error === 'Note is locked by another session')) {
                    if (body403.error === 'Canvas is locked' && typeof showLockedOverlay === 'function') {
                        showLockedOverlay();
                    }
                    return body403;
                }
                
                window.location.href = '/login';
                return null;
            }

            if (!response.ok) {
                console.error(`NoteAPI Get: HTTP ${response.status} for ${url}`);
                if (isStateRequest) return await this.cachedStateAny(url);
                return null;
            }

            const data = await response.json();
            if (isStateRequest) {
                try {
                    await this.cacheState(url, data);
                } catch (cacheErr) {
                    console.warn('Unable to maintain notes state cache:', cacheErr);
                }
            }
            if (data.error && !data.success) {
                if (!options.silent) showToast(data.error, 'error');
            }
            return data;
        } catch (err) {
            if (timeoutId) clearTimeout(timeoutId);
            // Signal Management: Silence intentional context-switch abortions
            if (err.name === 'AbortError' && !timedOut) return null;
            if (isStateRequest) {
                const cached = await this.cachedStateAny(url);
                if (cached) return cached;
            }
            console.error('NoteAPI Get Error:', err);
            if (!options.silent && !this.isOffline()) showToast('Network request failed', 'error');
            return null;
        }
    },

    /**
     * Standard POST Wrapper (Supports JSON, Form-encoded, and FormData).
     * @param {string} url - Target endpoint.
     * @param {Object|FormData} params - Payload.
     * @param {Object} options - { signal: AbortSignal, keepalive: boolean, silent: boolean }
     */
    async post(url, params, options = {}) {
        const isFormData = params instanceof FormData;
        const csrfToken  = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');

        const headers = { 'X-CSRF-Token': csrfToken };
        let body;

        if (isFormData) {
            body = params;
            if (typeof STATE !== 'undefined' && STATE.sessionId && !params.has('session_id')) {
                params.append('session_id', STATE.sessionId);
            }
        } else if (Array.isArray(params)) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(params);
        } else {
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
            params = params || {};
            if (typeof STATE !== 'undefined' && STATE.sessionId && !params.session_id) {
                params.session_id = STATE.sessionId;
            }
            body = new URLSearchParams(params);
        }

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: body,
                signal: options.signal,
                keepalive: options.keepalive
            });
            
            // Session Guard: Hard redirect on expiry
            if (response.status === 403) {
                let body403 = null;
                try { body403 = await response.json(); } catch (_) {}
                
                if (body403 && (body403.error === 'Canvas is locked' || body403.error === 'Note is locked by another session')) {
                    if (body403.error === 'Canvas is locked' && typeof showLockedOverlay === 'function') {
                        showLockedOverlay();
                    }
                    return body403;
                }
                
                window.location.href = '/login';
                return null;
            }

            if (!response.ok) {
                console.error(`NoteAPI Post: HTTP ${response.status} for ${url}`);
                return null;
            }

            const data = await response.json();
            if (data.error && !data.success) {
                if (!options.silent) showToast(data.error, 'error');
            }
            return data;
        } catch (err) {
            if (err.name === 'AbortError') return null;
            console.error('NoteAPI Post Error:', err);
            if (!options.silent && !options.keepalive && !this.isOffline()) showToast('Network request failed', 'error');
            return null;
        }
    },

    /**
     * Binary Fragment/Image Orchestrator.
     * Ensures consistent security handling even for media transfers.
     */
    async blob(url, options = {}) {
        try {
            const response = await fetch(url, { signal: options.signal });
            
            // Binary Session Guard: Redirect on 403 to prevent silent binary failure.
            // Canvas lock returns plain text 'Canvas Locked'; session expiry returns login HTML.
            if (response.status === 403) {
                const text = await response.text();
                if (text === 'Canvas Locked') {
                    if (typeof showLockedOverlay === 'function') showLockedOverlay();
                    return null;
                }
                window.location.href = '/login';
                return null;
            }

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.blob();
        } catch (err) {
            if (err.name === 'AbortError') return null;
            console.error('NoteAPI Blob Error:', err);
            if (!options.silent && !this.isOffline()) showToast('Media fetch failed', 'error');
            return null;
        }
    },

    /**
     * Collaborative Locking: Attempts to acquire an exclusive edit lock.
     * @param {number|string} id - The note ID.
     */
    async lock(id) {
        return await this.post('/notes/api/lock', { id });
    },

    /**
     * Collaborative Locking: Releases an active edit lock.
     * @param {number|string} id - The note ID.
     */
    async unlock(id) {
        return await this.post('/notes/api/unlock', { id });
    }
};

/**
 * Positional Sync Orchestration: Prevents server saturation during rapid coordinate 
 * adjustments by collapsing multiple micro-moves into a single "Final State" save.
 */
const POSITION_SYNC_TIMERS   = new Map();
const POSITION_SYNC_PROMISES = new Map(); // Global registry for debounced settlement contexts

/**
 * Note Deletion Bridge (Soft-Delete)
 * Moves a note or a group of selected notes to the Recycle Bin.
 * @param {number|null} id - Target note ID (or null if deleting current selection).
 */
function deleteNote(id) {
    const isBulk = !id && STATE.selectedNoteIds.size > 0;
    const targetIds = isBulk ? Array.from(STATE.selectedNoteIds) : [id];
    const count = targetIds.length;

    if (count === 0) return;

    showConfirmModal({
        title: count > 1 ? `Delete ${count} Notes` : 'Delete Note',
        icon: '🗑️',
        message: count > 1 
            ? `Are you sure you want to move these ${count} sticky notes to the Recycle Bin?`
            : 'Are you sure you want to remove this sticky note? It will be moved to the Recycle Bin.',
        danger: true,
        confirmText: 'DELETE',
        confirmIcon: '🗑️',
        hideCancel: true,
        onConfirm: async () => {
            showLoadingOverlay(count > 1 ? `Moving ${count} notes...` : 'Deleting...');
            
            try {
                // Flush all pending position syncs before any delete to prevent stale-position saves racing the deletes
                for (const tid of targetIds) {
                    const sid = String(tid);
                    if (POSITION_SYNC_TIMERS.has(sid)) {
                        clearTimeout(POSITION_SYNC_TIMERS.get(sid));
                        POSITION_SYNC_TIMERS.delete(sid);
                        POSITION_SYNC_PROMISES.delete(sid);
                        if (typeof window.removeActiveSync === 'function') window.removeActiveSync(sid);
                    }
                }

                let res;
                try {
                    if (isBulk) {
                        // Atomic Batch Path: Execute a single transaction for all selected notes.
                        res = await NoteAPI.post('/notes/api/batch_delete', { 
                            ids: JSON.stringify(targetIds), 
                            canvas_id: STATE.canvas_id 
                        });
                    } else {
                        // Standard Path: Individual note deletion
                        res = await NoteAPI.post('/notes/api/delete', { 
                            id: targetIds[0], 
                            canvas_id: STATE.canvas_id 
                        });
                    }
                } catch (err) {
                    console.error(`[deleteNote] network failure:`, err);
                    showToast("Network error during deletion", "error");
                    return;
                }

                if (res && res.success) {
                    if (res.notes && typeof window.mergeNoteState === 'function') {
                        window.mergeNoteState(res.notes);
                    } else if (res.notes) {
                        STATE.notes = res.notes;
                    }
                    if (!STATE.last_mutation || res.last_mutation > STATE.last_mutation) {
                        STATE.last_mutation = res.last_mutation;
                    }

                    if (isBulk) {
                        STATE.selectedNoteIds.clear();
                        showToast(`${count} notes moved to Recycle Bin`, 'success');
                    } else {
                        showToast('Note moved to Recycle Bin', 'success');
                    }
                    if (typeof renderUI === 'function') renderUI();
                } else if (res && res.error) {
                    showToast(`Deletion failed: ${res.error}`, 'error');
                }
            } finally {
                hideLoadingOverlay();
            }
        }
    });
}

/**
 * Atomic Synchronization: Persists note state to the backend.
 * Handles both immediate and debounced (moving/resizing) updates.
 * @param {number|string} id - The note ID.
 * @param {string} type - 'normal' (standard) or 'silent' (background sync).
 * @param {number} debounceMs - Delay in milliseconds before firing the API call.
 * @returns {Promise<Object>} - The backend response.
 */
async function syncNotePosition(id, type = 'normal', debounceMs = 0) {
    const el = document.getElementById(`note-${id}`);
    const note = STATE.notes.find(n => n.id == id);
    if (!el || !note) return Promise.resolve({ success: 0, error: 'Note not found' });

    const sid = String(id); // Standardize ID to string for Map key consistency

    // --- Debounce Strategy ---
    if (debounceMs > 0) {
        // Lifecycle Tracking: If no promise is pending for this ID, initialize a new settlement context.
        // This allows multiple 'jitter' calls to wait for the same eventual result.
        if (!POSITION_SYNC_PROMISES.has(sid)) {
            let resolve, reject;
            const promise = new Promise((res, rej) => {
                resolve = res;
                reject = rej;
            });
            POSITION_SYNC_PROMISES.set(sid, { promise, resolve, reject });
        }

        // Atomic Lock Acquisition: Ensure the note is protected while the user is still 'jittering'
        if (!POSITION_SYNC_TIMERS.has(sid)) {
            if (typeof window.addActiveSync === 'function') window.addActiveSync(sid);
        }

        if (POSITION_SYNC_TIMERS.has(sid)) {
            clearTimeout(POSITION_SYNC_TIMERS.get(sid));
        }

        const timerToken = {};
        POSITION_SYNC_TIMERS._tokens = POSITION_SYNC_TIMERS._tokens || new Map();
        POSITION_SYNC_TIMERS._tokens.set(sid, timerToken);

        const timer = setTimeout(async () => {
            // Ownership check: bail if a newer timer has replaced us or an immediate sync ran.
            if (POSITION_SYNC_TIMERS._tokens.get(sid) !== timerToken) return;

            const context = POSITION_SYNC_PROMISES.get(sid);
            if (context) {
                POSITION_SYNC_PROMISES.delete(sid);
                POSITION_SYNC_TIMERS.delete(sid);
                POSITION_SYNC_TIMERS._tokens.delete(sid);

                // Abort if the note was deleted while the debounce timer was pending
                if (!STATE.notes.find(n => n.id == id)) {
                    if (typeof window.removeActiveSync === 'function') window.removeActiveSync(sid);
                    context.resolve({ success: 0, error: 'Note deleted' });
                    return;
                }

                // Re-capture fresh DOM coordinates at the moment the timer fires
                const latestColorInput = el.querySelector('.inline-color-input');
                const latestWidth = parseInt(el.style.width, 10);
                const latestHeight = parseInt(el.style.height, 10);
                const latestParams = {
                    id: id,
                    canvas_id: STATE.canvas_id,
                    x: parseInt(el.style.left),
                    y: parseInt(el.style.top),
                    width:  note.is_collapsed ? (note.width  || el.offsetWidth)  : (!isNaN(latestWidth)  ? latestWidth  : el.offsetWidth),
                    height: note.is_collapsed ? (note.height || el.offsetHeight) : (!isNaN(latestHeight) ? latestHeight : el.offsetHeight),
                    z_index: window.getNoteZIndex?.(note) || el.style.zIndex,
                    layer_id: note.layer_id || 1,
                    is_collapsed: note.is_collapsed,
                    is_options_expanded: note.is_options_expanded ?? 0,
                    color: latestColorInput ? latestColorInput.value : note.color
                };

                try {
                    const res = await NoteAPI.post('/notes/api/geometry', latestParams, { silent: type === 'silent' });
                    if (res && res.success) {
                        if (res.notes && typeof window.mergeNoteState === 'function') {
                            window.mergeNoteState(res.notes, id);
                        } else if (res.notes) {
                            STATE.notes = res.notes;
                        }
                        if (!STATE.last_mutation || res.last_mutation > STATE.last_mutation) {
                            STATE.last_mutation = res.last_mutation;
                        }
                        context.resolve(res);
                    } else {
                        context.reject(new Error(res?.error || 'Save failed'));
                    }
                } catch (e) {
                    console.error(`[syncNotePosition] Debounced save failed for note ${id}:`, e);
                    context.reject(e);
                } finally {
                    // Only release the sync guard if no new timer was registered for this sid
                    // while the API call was in flight (i.e. we are still the active owner).
                    if (!POSITION_SYNC_TIMERS.has(sid)) {
                        if (typeof window.removeActiveSync === 'function') window.removeActiveSync(sid);
                    }
                }
            }
        }, debounceMs);

        POSITION_SYNC_TIMERS.set(sid, timer);
        return POSITION_SYNC_PROMISES.get(sid).promise;
    }

    // --- Immediate Fire Path (Legacy & Administrative Syncs) ---
    // Cleanup: If there is a pending debounced timer/promise, clear it now to prevent race conditions.
    if (POSITION_SYNC_TIMERS.has(sid)) {
        clearTimeout(POSITION_SYNC_TIMERS.get(sid));
        POSITION_SYNC_TIMERS.delete(sid);
    }
    const pendingContext = POSITION_SYNC_PROMISES.get(sid) || null;
    POSITION_SYNC_PROMISES.delete(sid);

    if (type !== 'silent') el.classList.add('pending');
    if (typeof window.addActiveSync === 'function') window.addActiveSync(sid);

    const colorInput = el.querySelector('.inline-color-input');
    const parsedWidth = parseInt(el.style.width, 10);
    const parsedHeight = parseInt(el.style.height, 10);
    const params = {
        id: id,
        canvas_id: STATE.canvas_id,
        x: parseInt(el.style.left),
        y: parseInt(el.style.top),
        width:  note.is_collapsed ? (note.width  || el.offsetWidth)  : (!isNaN(parsedWidth)  ? parsedWidth  : el.offsetWidth),
        height: note.is_collapsed ? (note.height || el.offsetHeight) : (!isNaN(parsedHeight) ? parsedHeight : el.offsetHeight),
        z_index: window.getNoteZIndex?.(note) || el.style.zIndex,
        layer_id: note.layer_id || 1,
        is_collapsed: note.is_collapsed,
        is_options_expanded: note.is_options_expanded ?? 0,
        color: colorInput ? colorInput.value : note.color
    };

    try {
        const res = await NoteAPI.post('/notes/api/geometry', params, { silent: type === 'silent' });
        if (res && res.success) {
            if (res.notes && typeof window.mergeNoteState === 'function') {
                window.mergeNoteState(res.notes);
            } else if (res.notes) {
                STATE.notes = res.notes;
            }
            if (!STATE.last_mutation || res.last_mutation > STATE.last_mutation) {
                STATE.last_mutation = res.last_mutation;
            }
            if (pendingContext) {
                try { pendingContext.resolve(res); } catch (_) {}
            }
            return res;
        } else {
            const error = new Error(res?.error || 'Save failed');
            if (pendingContext) {
                try { pendingContext.reject(error); } catch (_) {}
            }
            throw error;
        }
    } catch (e) {
        console.error(`[syncNotePosition] Immediate save failed for note ${id}:`, e);
        if (pendingContext) {
            try { pendingContext.reject(e); } catch (_) {}
        }
        throw e;
    } finally {
        if (type !== 'silent') el.classList.remove('pending');
        if (typeof window.removeActiveSync === 'function') window.removeActiveSync(sid);
        
        // Settle orphaned debounce promise if the immediate path arrived after the debounce deleted it
        if (pendingContext) {
            try { pendingContext.resolve({ success: 0, error: 'superseded_by_immediate' }); } catch (_) {}
        }
    }
}

/**
 * Atomic Synchronization (Batch): Persists coordinate changes for multiple notes.
 * Used at the conclusion of a Lasso/Marquee bulk move.
 * @param {Array|Set} ids - Collection of note IDs involved in the move.
 * @returns {Promise<Object>} - The backend response.
 */
async function syncBatchNotePositions(ids) {
    if (!ids) return { success: 1 };
    const idsArray = Array.isArray(ids) ? ids : Array.from(ids);
    if (idsArray.length === 0) return { success: 1 };
    ids = idsArray;

    const updates = [];
    const notesMap = new Map(STATE.notes.map(n => [String(n.id), n]));
    ids.forEach(id => {
        const sid  = String(id);
        const el   = document.getElementById(`note-${sid}`);
        const note = notesMap.get(sid);
        if (!el || !note) return;

        const parsedX = parseInt(el.style.left, 10);
        const parsedY = parseInt(el.style.top, 10);
        const parsedZ = parseInt(el.style.zIndex, 10);
        updates.push({
            id: id,
            x:        !isNaN(parsedX) ? parsedX : (note.x       ?? 0),
            y:        !isNaN(parsedY) ? parsedY : (note.y       ?? 0),
            z_index:  window.getNoteZIndex?.(note) || (!isNaN(parsedZ) ? parsedZ : (note.z_index ?? 1)),
            layer_id: note.layer_id ?? 1
        });
    });

    if (updates.length === 0) return { success: 1 };

    updates.forEach(u => {
        const el = document.getElementById(`note-${u.id}`);
        if (el) el.classList.add('pending');
        if (typeof window.addActiveSync === 'function') window.addActiveSync(String(u.id));
    });

    try {
        const res = await NoteAPI.post('/notes/api/batch_geometry', {
            updates:    JSON.stringify(updates),
            canvas_id:  STATE.canvas_id,
            session_id: STATE.sessionId
        });

        if (res && res.success) {
            if (!STATE.last_mutation || res.last_mutation > STATE.last_mutation) {
                STATE.last_mutation = res.last_mutation;
            }
            return res;
        } else {
            throw new Error(res?.error || 'Batch sync failed');
        }
    } catch (e) {
        console.error(`[syncBatchNotePositions] failure:`, e);
        showToast("Group move failed to save", "error");
        return { success: 0, error: e.message };
    } finally {
        ids.forEach(id => {
            const el = document.getElementById(`note-${id}`);
            if (el) el.classList.remove('pending');
            if (typeof window.removeActiveSync === 'function') window.removeActiveSync(String(id));
        });
    }
}

/**
 * Recycle Bin Fetch
 */
async function loadBin() {
    return await NoteAPI.get('/notes/api/bin');
}

/**
 * Restoration Engine
 */
async function restoreNote(id, canvas_id, layer_id, x, y) {
    return await NoteAPI.post('/notes/api/restore', { id, canvas_id, layer_id, x, y });
}



/**
 * Canvas Management
 */
async function renameCanvas(canvas_id, name) {
    return await NoteAPI.post('/notes/api/canvases/rename', { canvas_id, name });
}

async function deleteCanvasApi(canvas_id) {
    return await NoteAPI.post('/notes/api/canvases/delete', { canvas_id });
}

async function createCanvas(name) {
    return await NoteAPI.post('/notes/api/canvases/create', { name });
}

/**
 * Sharing & ACL
 */
async function addShare(canvas_id, username) {
    const res = await NoteAPI.post('/notes/api/canvases/share', { canvas_id, username, can_edit: 1 });
    if (res && res.success) {
        // State Synchronization: Only update if the modified board is active
        if (canvas_id == STATE.canvas_id) {
            STATE.share_list = res.share_list;
        }
        if (typeof renderShareList === 'function') {
            renderShareList(canvas_id, res.share_list);
        }
        showToast('Shared successfully', 'success');
    }
    return res;
}

async function updateSharePermission(canvasId, username, canEdit) {
    const res = await NoteAPI.post('/notes/api/canvases/share', { canvas_id: canvasId, username, can_edit: canEdit });
    if (res && res.success) {
        if (canvasId == STATE.canvas_id) {
            STATE.share_list = res.share_list;
        }
        showToast('Permissions updated', 'success');
    }
    return res;
}

async function revokeShare(canvasId, username) {
    const res = await NoteAPI.post('/notes/api/canvases/share', { canvas_id: canvasId, username, revoke: 1 });
    if (res && res.success) {
        // State Synchronization: Re-align shared list baseline
        if (canvasId == STATE.canvas_id) {
            STATE.share_list = res.share_list;
        }
        if (typeof renderShareList === 'function') {
            renderShareList(canvasId, res.share_list);
        }
        showToast('Access revoked', 'info');
    }
    return res;
}

/**
 * Sharing & ACL
 */
async function updateShare(canvas_id, username, can_edit, revoke = 0) {
    const params = { canvas_id, username, can_edit };
    if (revoke) params.revoke = 1;
    return await NoteAPI.post('/notes/api/canvases/share', params);
}

/**
 * Navigation
 */
async function switchLevel(id) {
    if (id == STATE.activeLayerId || STATE.isSwitchingLayer) return;
    
    STATE.isSwitchingLayer = true;
    if (typeof saveViewportImmediate === 'function') await saveViewportImmediate();
    
    STATE.isEditingNote = false;
    showLoadingOverlay('Transitioning Perspective...');
    
    try {
        if (typeof loadState === 'function') await loadState(false, STATE.canvas_id, null, id);
        // Persist the new Layer ID as the 'most recent' immediately to survive page reloads
        if (typeof saveViewportImmediate === 'function') await saveViewportImmediate();
    } finally {
        hideLoadingOverlay();
        STATE.isSwitchingLayer = false;
    }
}

/**
 * Directional Navigation: Moves the isolation layer context up or down.
 * @param {number} direction - -1 (Up) or 1 (Down).
 */
async function moveLevel(direction) {
    if (STATE.isSwitchingLayer) return;

    // Type Safety: Ensure activeLayerId is treated as a number to prevent string concatenation
    let nextLevel = Number(STATE.activeLayerId) + direction;

    // Circular Loop Resolution: 1 <-> 99 wrapping
    if (nextLevel > 99) nextLevel = 1;
    if (nextLevel < 1) nextLevel = 99;

    await switchLevel(nextLevel);
}

/**
 * Copy/Clone Actions
 */
async function copyNoteToBoard(id, canvas_id) {
    const res = await NoteAPI.post('/notes/api/notes/copy', { id, canvas_id });
    if (res && res.success) {
        showToast('Note copied to board', 'success');
        if (typeof closeMoveModal === 'function') closeMoveModal();
    }
    return res;
}

/**
 * Copy/Clone Actions
 * Deep-copies a note across isolation layers within the same board.
 */
async function copyNoteToLevel(id, newLevelId) {
    const note = STATE.notes.find(n => n.id == id);
    if (!note) return;

    // Interaction Locking
    const el = document.getElementById(`note-${id}`);
    if (el) el.classList.add('pending');

    try {
        const res = await NoteAPI.post('/notes/api/save', {
            id: null, // Force creation of a NEW record
            source_id: id, // Link for binary deep-copy (images)
            canvas_id: STATE.canvas_id,
            layer_id: newLevelId,
            type: note.type || 'text', // Preserve 'image' vs 'text' identity
            title: note.title, // Clean clone: No (Copy) suffix
            content: note.content,
            filename: note.filename || '',
            x: note.x + 20, // Offset horizontally for clarity
            y: note.y + 20, // Offset vertically for clarity
            width: note.width,
            height: note.height,
            color: note.color,
            z_index: window.getNoteZIndex?.(note) || note.z_index,
            is_collapsed: note.is_collapsed
        });

        if (res && res.success) {
            if (res.notes && typeof window.mergeNoteState === 'function') {
                window.mergeNoteState(res.notes);
            } else if (res.notes) {
                STATE.notes = res.notes;
            }
            if (!STATE.last_mutation || res.last_mutation > STATE.last_mutation) {
                STATE.last_mutation = res.last_mutation;
            }
            if (newLevelId == STATE.activeLayerId && typeof renderUI === 'function') {
                renderUI();
            }
        }
    } catch (e) {
        console.error("Duplication failure:", e);
        showToast("Failed to copy note between levels", "error");
    } finally {
        if (el) el.classList.remove('pending');
    }
}

/**
 * Moves one or more notes to a different layer on the same canvas.
 * @param {number[]} ids - Note IDs to move.
 * @param {number} layerId - Target layer (1-99).
 * @returns {Promise<boolean>} True on success.
 */
async function moveNotesToLevel(ids, layerId) {
    const res = await NoteAPI.post('/notes/api/notes/set-layer', {
        ids:       JSON.stringify(ids),
        canvas_id: STATE.canvas_id,
        layer_id:  layerId
    });
    if (res && res.success) {
        if (res.notes && typeof window.mergeNoteState === 'function') {
            window.mergeNoteState(res.notes);
        } else if (res.notes) {
            STATE.notes = res.notes;
        }
        if (res.last_mutation) STATE.last_mutation = res.last_mutation;
        STATE.selectedNoteIds.clear();
        if (typeof renderUI === 'function') renderUI();
        return true;
    }
    return false;
}

/**
 * Clones one or more notes to a different layer on the same canvas.
 * @param {number[]} ids - Note IDs to clone.
 * @param {number} layerId - Target layer (1-99).
 * @returns {Promise<boolean>} True on success.
 */
async function bulkCopyToLevel(ids, layerId) {
    const res = await NoteAPI.post('/notes/api/notes/bulk-copy-level', {
        ids:       JSON.stringify(ids),
        canvas_id: STATE.canvas_id,
        layer_id:  layerId
    });
    if (res && res.success) {
        const label = ids.length === 1 ? '1 note' : `${ids.length} notes`;
        showToast(`Copied ${label} to Level ${layerId}`, 'success');
        if (res.notes && typeof window.mergeNoteState === 'function') {
            window.mergeNoteState(res.notes);
        } else if (res.notes) {
            STATE.notes = res.notes;
        }
        if (res.last_mutation) STATE.last_mutation = res.last_mutation;
        STATE.selectedNoteIds.clear();
        if (typeof renderUI === 'function') renderUI();
        return true;
    }
    return false;
}

/**
 * Copies one or more notes to a different canvas.
 * @param {number[]} ids - Note IDs to copy.
 * @param {number} targetCanvasId - Destination canvas ID.
 * @param {number} [targetLayerId=1] - Target layer on the destination canvas.
 * @returns {Promise<boolean>} True on success.
 */
async function bulkCopyToCanvas(ids, targetCanvasId, targetLayerId = 1) {
    const res = await NoteAPI.post('/notes/api/notes/bulk-copy-canvas', {
        ids:              JSON.stringify(ids),
        target_canvas_id: targetCanvasId,
        target_layer_id:  targetLayerId
    });
    if (res && res.success) {
        const label = ids.length === 1 ? '1 note' : `${ids.length} notes`;
        showToast(`Copied ${label} to canvas`, 'success');
        STATE.selectedNoteIds.clear();
        return true;
    }
    return false;
}

/**
 * Moves one or more notes to a different canvas by updating canvas_id in place.
 * Note IDs are preserved so existing [note:id] references remain valid.
 * @param {number[]} ids - Note IDs to move.
 * @param {number} targetCanvasId - Destination canvas ID.
 * @param {number} [targetLayerId=1] - Target layer on the destination canvas.
 * @returns {Promise<boolean>} True on success.
 */
async function moveNotesToCanvas(ids, targetCanvasId, targetLayerId = 1) {
    const res = await NoteAPI.post('/notes/api/notes/move-canvas', {
        ids:              JSON.stringify(ids),
        canvas_id:        STATE.canvas_id,
        target_canvas_id: targetCanvasId,
        target_layer_id:  targetLayerId
    });
    if (res && res.success) {
        const label = ids.length === 1 ? '1 note' : `${ids.length} notes`;
        showToast(`Moved ${label} to canvas`, 'success');
        if (res.notes && typeof window.mergeNoteState === 'function') {
            window.mergeNoteState(res.notes);
        } else if (res.notes) {
            STATE.notes = res.notes;
        }
        if (res.last_mutation) STATE.last_mutation = res.last_mutation;
        STATE.selectedNoteIds.clear();
        if (typeof renderUI === 'function') renderUI();
        return true;
    }
    return false;
}
