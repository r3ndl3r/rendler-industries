/* /public/js/menu/manage.js */

document.addEventListener('DOMContentLoaded', function() {
    const modal = document.getElementById('linkModal');
    const deleteConfirmModal = document.getElementById('deleteConfirmModal');
    const form = document.getElementById('linkForm');
    const addBtn = document.getElementById('addLinkBtn');
    const closeBtn = document.getElementById('closeModalBtn');
    const saveOrderBtn = document.getElementById('saveOrderBtn');
    const tableBody = document.getElementById('menuTableBody');
    
    let linkIdToDelete = null;

    // --- Modal Logic ---
    
    function openModal(title, data = null) {
        document.getElementById('modalTitle').textContent = title;
        form.reset();
        
        const deleteBtn = document.getElementById('modalDeleteBtn');
        
        if (data) {
            document.getElementById('linkId').value = data.id;
            document.getElementById('linkSort').value = data.sort || "0";
            document.getElementById('linkLabel').value = data.label;
            document.getElementById('linkUrl').value = data.url;
            document.getElementById('linkParent').value = data.parent || "";
            document.getElementById('linkPermission').value = data.permission;
            document.getElementById('linkClass').value = data.class || "";
            document.getElementById('linkTarget').value = data.target;
            document.getElementById('linkActive').checked = data.active == "1";
            document.getElementById('linkSeparator').checked = data.separator == "1";
            deleteBtn.style.display = 'inline-flex';
            deleteBtn.dataset.id = data.id;
            deleteBtn.dataset.label = data.label;
        } else {
            document.getElementById('linkId').value = "";
            document.getElementById('linkSort').value = "0";
            document.getElementById('linkActive').checked = true;
            document.getElementById('linkSeparator').checked = false;
            deleteBtn.style.display = 'none';
        }
        
        modal.style.display = 'flex';
    }

    function closeModal() {
        modal.style.display = 'none';
    }

    function openDeleteConfirmModal(id, label) {
        linkIdToDelete = id;
        document.getElementById('deleteLinkLabel').textContent = label;
        deleteConfirmModal.style.display = 'flex';
    }

    window.closeDeleteConfirmModal = function() {
        linkIdToDelete = null;
        deleteConfirmModal.style.display = 'none';
    }

    if (addBtn) addBtn.addEventListener('click', () => openModal('Add Menu Link'));
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    
    window.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
        if (e.target === deleteConfirmModal) closeDeleteConfirmModal();
    });

    // --- CRUD Actions ---

    // Edit Button Click
    document.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', function() {
            const data = {
                id: this.dataset.id,
                label: this.dataset.label,
                url: this.dataset.url,
                parent: this.dataset.parent,
                permission: this.dataset.permission,
                class: this.dataset.class,
                target: this.dataset.target,
                active: this.dataset.active,
                sort: this.dataset.sort,
                separator: this.dataset.separator
            };
            openModal('Edit Menu Link', data);
        });
    });

    // Form Submission (Add/Update)
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const id = document.getElementById('linkId').value;
        const isSeparator = document.getElementById('linkSeparator').checked;
        const labelInput = document.getElementById('linkLabel');
        const urlInput = document.getElementById('linkUrl');

        if (isSeparator) {
            if (!labelInput.value.trim()) labelInput.value = 'SEPARATOR';
            if (!urlInput.value.trim()) urlInput.value = '#';
        }

        const endpoint = id ? '/menu/update' : '/menu/add';
        const formData = new FormData(form);
        
        if (!formData.has('is_active')) formData.append('is_active', '0');
        if (!formData.has('is_separator')) formData.append('is_separator', '0');

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success) {
                if (typeof showToast === 'function') showToast(id ? 'Link updated!' : 'Link added!', 'success');
                location.reload();
            } else {
                if (typeof showToast === 'function') showToast('Error: ' + result.error, 'error');
            }
        } catch (error) {
            console.error('Submission error:', error);
            if (typeof showToast === 'function') showToast('Request failed', 'error');
        }
    });

    // Intermediate Delete Button Click (Inside Edit Modal)
    document.getElementById('modalDeleteBtn').addEventListener('click', function() {
        const id = this.dataset.id;
        const label = this.dataset.label;
        openDeleteConfirmModal(id, label);
    });

    // Final Delete Confirmation Click
    document.getElementById('finalDeleteBtn').addEventListener('click', async function() {
        if (!linkIdToDelete) return;
        
        const formData = new FormData();
        formData.append('id', linkIdToDelete);

        try {
            const response = await fetch('/menu/delete', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success) {
                if (typeof showToast === 'function') showToast('Link deleted', 'success');
                location.reload();
            } else {
                if (typeof showToast === 'function') showToast('Error: ' + result.error, 'error');
                closeDeleteConfirmModal();
            }
        } catch (error) {
            console.error('Delete error:', error);
            closeDeleteConfirmModal();
        }
    });

    // --- Reordering (SortableJS) ---

    if (tableBody && typeof Sortable !== 'undefined') {
        const sortable = new Sortable(tableBody, {
            handle: '.drag-handle',
            animation: 150,
            ghostClass: 'sortable-ghost',
            onUpdate: function() {
                saveOrderBtn.style.display = 'block';
            }
        });
    }

    saveOrderBtn.addEventListener('click', async function() {
        const orders = {};
        document.querySelectorAll('#menuTableBody tr').forEach((row, index) => {
            orders[row.dataset.id] = (index + 1) * 10;
        });

        try {
            const response = await fetch('/menu/reorder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orders: orders })
            });
            
            const result = await response.json();
            
            if (result.success) {
                if (typeof showToast === 'function') showToast('Order saved!', 'success');
                saveOrderBtn.style.display = 'none';
                setTimeout(() => location.reload(), 500);
            } else {
                if (typeof showToast === 'function') showToast('Reorder failed', 'error');
            }
        } catch (error) {
            console.error('Reorder error:', error);
        }
    });
});
