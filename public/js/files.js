// public/js/files.js

document.addEventListener('DOMContentLoaded', function() {
    console.log('Files module loaded');

    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('file');
    const fileNameDisplay = document.getElementById('fileName');

    if (dropZone && fileInput) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, highlight, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, unhighlight, false);
        });

        function highlight(e) {
            dropZone.classList.add('dragover');
        }

        function unhighlight(e) {
            dropZone.classList.remove('dragover');
        }

        dropZone.addEventListener('drop', handleDrop, false);

        function handleDrop(e) {
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files.length > 0) {
                fileInput.files = files;
                updateFileName(files[0].name);
                handleFiles(files);
            }
        }

        fileInput.addEventListener('change', function() {
            if (this.files.length > 0) {
                updateFileName(this.files[0].name);
                handleFiles(this.files);
            }
        });

        function updateFileName(name) {
            if (fileNameDisplay) {
                fileNameDisplay.textContent = name;
                fileNameDisplay.style.display = 'block';
            }
        }

        function handleFiles(files) {
            const file = files[0];
            const maxSize = 1024 * 1024 * 1024;
            if (file.size > maxSize) {
                showToast('File too large! Maximum size is 1GB.', 'error');
                fileInput.value = '';
                if (fileNameDisplay) {
                    fileNameDisplay.textContent = '';
                    fileNameDisplay.style.display = 'none';
                }
                return;
            }
        }
    }

    window.copyLink = function(id) {
        const fullUrl = `${window.location.origin}/files/serve/${id}`;
        navigator.clipboard.writeText(fullUrl).then(function() {
            showToast('Link copied to clipboard!', 'success');
        }).catch(function() {
            const textArea = document.createElement('textarea');
            textArea.value = fullUrl;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            showToast('Link copied to clipboard!', 'success');
        });
    };

    window.openPermissions = function(file) {
        const modal = document.getElementById('permissionModal');
        if (modal) {
            document.getElementById('permissionFileId').value = file.id;
            
            // Set Admin Only checkbox
            document.getElementById('permissionAdminOnly').checked = file.admin_only == 1;
            
            // Reset all user checkboxes
            document.querySelectorAll('.user-permission-checkbox').forEach(cb => cb.checked = false);
            
            // Set allowed users
            if (file.allowed_users) {
                const allowed = file.allowed_users.split(',');
                allowed.forEach(username => {
                    const cb = document.querySelector(`.user-permission-checkbox[data-username="${username}"]`);
                    if (cb) cb.checked = true;
                });
            }
            
            modal.style.display = 'flex';
        }
    };

    window.confirmDeleteFile = function(id, filename) {
        showConfirmModal({
            title: 'Delete File',
            message: `Are you sure you want to permanently delete "<strong>${filename}</strong>"?`,
            danger: true,
            confirmText: 'Delete',
            loadingText: 'Deleting...',
            onConfirm: async () => {
                const result = await apiPost(`/files/delete/${id}`);
                if (result && result.success) {
                    window.location.reload();
                }
            }
        });
    };

    // Use global modal closing helper
    setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay'], [
        () => document.getElementById('permissionModal').style.display = 'none',
        closeConfirmModal
    ]);

    // Handle Permissions Form
    document.getElementById('permissionForm')?.addEventListener('submit', async function(e) {
        e.preventDefault();
        const id = document.getElementById('permissionFileId').value;
        const btn = this.querySelector('button[type="submit"]');
        const originalHtml = btn.innerHTML;

        btn.disabled = true;
        btn.innerHTML = `${getIcon('waiting')} Saving...`;

        const formData = new FormData(this);
        const result = await apiPost(`/files/permissions/${id}`, formData);

        if (result && result.success) {
            window.location.reload();
        } else {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    });

    // Handle Upload Form
    document.getElementById('uploadForm')?.addEventListener('submit', async function(e) {
        e.preventDefault();
        const fileInput = document.getElementById('file');
        if (!fileInput.files.length) {
            showToast('Please select a file', 'error');
            return;
        }

        const btn = this.querySelector('button[type="submit"]');
        const originalHtml = btn.innerHTML;

        btn.disabled = true;
        btn.innerHTML = `${getIcon('waiting')} Uploading...`;

        const formData = new FormData(this);
        
        // Use Fetch directly for upload to handle progress if needed in future, 
        // but for now apiPost supports FormData
        const result = await apiPost('/files', formData);

        if (result && result.success) {
            window.location.href = '/files';
        } else {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    });

    document.querySelectorAll('.alert').forEach(alert => {
        setTimeout(() => {
            alert.style.opacity = '0';
            alert.style.transform = 'translateY(-10px)';
            setTimeout(() => alert.remove(), 500);
        }, 5000);
    });
});
