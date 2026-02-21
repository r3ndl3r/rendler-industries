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
                if (typeof showToast === 'function') {
                    showToast('File too large! Maximum size is 1GB.', 'error');
                } else {
                    alert('File too large! Maximum size is 1GB.');
                }
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

    window.openPermissions = function(fileId) {
        const modal = document.getElementById('permissionModal');
        if (modal) {
            document.getElementById('permissionFileId').value = fileId;
            modal.style.display = 'flex';
        }
    };

    document.querySelectorAll('.close-modal, .files-modal-overlay').forEach(el => {
        el.addEventListener('click', function(e) {
            if (e.target === this || e.target.classList.contains('close-modal')) {
                const modal = document.getElementById('permissionModal');
                if (modal) modal.style.display = 'none';
            }
        });
    });

    document.getElementById('uploadForm')?.addEventListener('submit', function(e) {
        const fileInput = document.getElementById('file');
        if (!fileInput.files.length) {
            e.preventDefault();
            if (typeof showToast === 'function') {
                showToast('Please select a file', 'error');
            } else {
                alert('Please select a file');
            }
            return false;
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
