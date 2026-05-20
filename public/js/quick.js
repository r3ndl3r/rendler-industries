// /public/js/quick.js

document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('quick-edit-toggle');
    const tilesContainer = document.getElementById('quick-tiles');
    if (!toggleBtn || !tilesContainer || typeof Sortable === 'undefined') return;

    let sortable = null;
    let isEditing = false;

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
        });
    }

    function exitSortMode() {
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
