/* /public/js/menu/manage.js */

document.addEventListener('DOMContentLoaded', function() {
    const modal = document.getElementById('linkModal');
    const form = document.getElementById('linkForm');
    const addBtn = document.getElementById('addLinkBtn');
    const closeBtn = document.querySelector('.close');
    const cancelBtn = document.getElementById('cancelBtn');
    const saveOrderBtn = document.getElementById('saveOrderBtn');
    const tableBody = document.getElementById('menuTableBody');
    
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
            deleteBtn.style.display = 'block';
            deleteBtn.dataset.id = data.id;
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

    addBtn.addEventListener('click', () => openModal('Add Menu Link'));
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    
    window.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
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

        // If it's a separator, we can provide defaults if empty
        if (isSeparator) {
            if (!labelInput.value.trim()) labelInput.value = 'SEPARATOR';
            if (!urlInput.value.trim()) urlInput.value = '#';
        }

        const endpoint = id ? '/menu/update' : '/menu/add';
        const formData = new FormData(form);
        
        // Ensure checkbox value is sent correctly (is_active)
        if (!formData.has('is_active')) {
            formData.append('is_active', '0');
        }
        
        // Ensure checkbox value is sent correctly (is_separator)
        if (!formData.has('is_separator')) {
            formData.append('is_separator', '0');
        }

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

    // Delete Button Click (Now in Modal)
    document.getElementById('modalDeleteBtn').addEventListener('click', async function() {
        if (!confirm('Are you sure you want to delete this menu link? (Child items will also be deleted)')) return;
        
        const id = this.dataset.id;
        const formData = new FormData();
        formData.append('id', id);

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
            }
        } catch (error) {
            console.error('Delete error:', error);
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
            orders[row.dataset.id] = (index + 1) * 10; // Use increments of 10
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
                // No reload needed after simple reorder success, 
                // but reload if we want the child-row classes to re-align properly
                setTimeout(() => location.reload(), 500);
            } else {
                if (typeof showToast === 'function') showToast('Reorder failed', 'error');
            }
        } catch (error) {
            console.error('Reorder error:', error);
        }
    });
});
