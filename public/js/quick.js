// /public/js/quick.js

document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('quick-edit-toggle');
    const tilesContainer = document.getElementById('quick-tiles');
    if (!toggleBtn || !tilesContainer || typeof Sortable === 'undefined') return;

    let sortable = null;
    let isEditing = false;

    // Mobile scroll handle and drag-scroll state
    let scrollHandle = null;
    let isDraggingHandle = false;
    let handleStartY = 0;
    let handleStartScroll = 0;
    let autoScrollRAF = null;
    let autoScrollDirection = 0;
    let isDraggingTile = false;
    let draggedTile = null;
    const AUTO_SCROLL_SPEED = 12;
    const AUTO_SCROLL_THRESHOLD = 80;

    function isMobileView() {
        return window.innerWidth <= 768;
    }

    function createScrollHandle() {
        if (scrollHandle || !isMobileView()) return;
        scrollHandle = document.createElement('div');
        scrollHandle.className = 'quick-scroll-handle';
        scrollHandle.setAttribute('aria-label', 'Scroll handle');
        document.body.appendChild(scrollHandle);
        scrollHandle.addEventListener('pointerdown', onHandlePointerDown);
    }

    function removeScrollHandle() {
        if (scrollHandle) {
            scrollHandle.removeEventListener('pointerdown', onHandlePointerDown);
            scrollHandle.remove();
            scrollHandle = null;
        }
    }

    function onHandlePointerDown(e) {
        e.preventDefault();
        e.stopPropagation();
        isDraggingHandle = true;
        handleStartY = e.clientY;
        handleStartScroll = window.scrollY;
        scrollHandle.setPointerCapture(e.pointerId);
        scrollHandle.addEventListener('pointermove', onHandlePointerMove);
        scrollHandle.addEventListener('pointerup', onHandlePointerUp);
        scrollHandle.addEventListener('pointercancel', onHandlePointerUp);
    }

    function onHandlePointerMove(e) {
        if (!isDraggingHandle) return;
        const deltaY = e.clientY - handleStartY;
        window.scrollTo(0, handleStartScroll + deltaY);
    }

    function onHandlePointerUp(e) {
        isDraggingHandle = false;
        if (!scrollHandle) return;
        if (typeof scrollHandle.hasPointerCapture !== 'function' || scrollHandle.hasPointerCapture(e.pointerId)) {
            scrollHandle.releasePointerCapture(e.pointerId);
        }
        scrollHandle.removeEventListener('pointermove', onHandlePointerMove);
        scrollHandle.removeEventListener('pointerup', onHandlePointerUp);
        scrollHandle.removeEventListener('pointercancel', onHandlePointerUp);
    }

    function startAutoScroll() {
        if (autoScrollRAF) return;
        function tick() {
            if (autoScrollDirection !== 0) {
                window.scrollBy(0, autoScrollDirection * AUTO_SCROLL_SPEED);
            }
            autoScrollRAF = requestAnimationFrame(tick);
        }
        autoScrollRAF = requestAnimationFrame(tick);
    }

    function stopAutoScroll() {
        if (autoScrollRAF) {
            cancelAnimationFrame(autoScrollRAF);
            autoScrollRAF = null;
        }
        autoScrollDirection = 0;
        if (scrollHandle) {
            scrollHandle.classList.remove('scrolling-up', 'scrolling-down');
        }
    }

    function checkAutoScroll() {
        if (!isDraggingTile) {
            stopAutoScroll();
            return;
        }
        const dragEl = draggedTile;
        if (!dragEl || !dragEl.getBoundingClientRect) {
            stopAutoScroll();
            return;
        }
        const rect = dragEl.getBoundingClientRect();
        const viewportH = window.innerHeight;
        if (rect.bottom > viewportH - AUTO_SCROLL_THRESHOLD) {
            if (autoScrollDirection !== 1) {
                autoScrollDirection = 1;
                if (scrollHandle) {
                    scrollHandle.classList.add('scrolling-down');
                    scrollHandle.classList.remove('scrolling-up');
                }
                startAutoScroll();
            }
        } else if (rect.top < AUTO_SCROLL_THRESHOLD) {
            if (autoScrollDirection !== -1) {
                autoScrollDirection = -1;
                if (scrollHandle) {
                    scrollHandle.classList.add('scrolling-up');
                    scrollHandle.classList.remove('scrolling-down');
                }
                startAutoScroll();
            }
        } else {
            stopAutoScroll();
        }
    }

    function autoScrollLoop() {
        if (!isEditing || !sortable) return;
        checkAutoScroll();
        requestAnimationFrame(autoScrollLoop);
    }

    tilesContainer.addEventListener('click', (event) => {
        if (!isEditing) return;
        event.preventDefault();
        event.stopPropagation();
    }, true);

    toggleBtn.addEventListener('click', async () => {
        if (isEditing) {
            toggleBtn.disabled = true;
            const saved = await saveOrder();
            toggleBtn.disabled = false;
            if (saved) exitSortMode();
        } else {
            enterSortMode();
        }
    });

    function enterSortMode() {
        isEditing = true;
        toggleBtn.dataset.editing = 'true';
        toggleBtn.querySelector('.edit-text').classList.add('hidden');
        toggleBtn.querySelector('.done-text').classList.remove('hidden');

        document.body.classList.add('sort-mode');
        tilesContainer.querySelectorAll('.quick-tile-card').forEach(card => {
            card.classList.add('sorting-active');
        });

        sortable = new Sortable(tilesContainer, {
            animation: 180,
            draggable: '.quick-tile-card',
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            scroll: false,
            onStart: (evt) => {
                isDraggingTile = true;
                draggedTile = evt.item;
            },
            onEnd: () => {
                isDraggingTile = false;
                draggedTile = null;
                stopAutoScroll();
            },
        });

        if (isMobileView()) {
            createScrollHandle();
            requestAnimationFrame(autoScrollLoop);
        }
    }

    function exitSortMode() {
        stopAutoScroll();
        isDraggingTile = false;
        draggedTile = null;
        removeScrollHandle();
        isEditing = false;
        toggleBtn.dataset.editing = 'false';
        toggleBtn.querySelector('.edit-text').classList.remove('hidden');
        toggleBtn.querySelector('.done-text').classList.add('hidden');

        document.body.classList.remove('sort-mode');
        tilesContainer.querySelectorAll('.quick-tile-card').forEach(card => {
            card.classList.remove('sorting-active');
        });

        if (sortable) {
            sortable.destroy();
            sortable = null;
        }
    }

    async function saveOrder() {
        const order = Array.from(tilesContainer.querySelectorAll('.quick-tile-card'))
            .map(card => card.dataset.id)
            .filter(Boolean);

        try {
            const response = await fetch('/api/quick/order', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order }),
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || 'Save failed');
            return true;
        } catch (err) {
            console.error('Quick tile order save failed:', err);
            if (typeof showToast === 'function') showToast('Tile order could not be saved', 'error');
            return false;
        }
    }
});
