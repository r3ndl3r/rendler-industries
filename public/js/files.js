// /public/js/files.js

/**
 * File Management Controller Module
 * 
 * This module manages the Platform Binary Storage interface. It handles
 * large file transfers, drag-and-drop orchestration, and permission-based
 * access control for the central file vault.
 * 
 * Features:
 * - Multipart file upload with 1GB capacity support
 * - Drag-and-drop upload zone with high-resolution file validation
 * - Dynamic permission management (Admin Only vs. User Restricted)
 * - Browser-compatible clipboard sharing for public/restricted links
 * - Integrated confirmation workflows for permanent file deletion
 * 
 * Dependencies:
 * - default.js: For apiPost, getIcon, and modal helpers
 * - toast.js: For status feedback
 */

/**
 * Initialization System
 * Boots the module and establishes drop-zone event delegation
 */
document.addEventListener('DOMContentLoaded', function() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('file');
    const fileNameDisplay = document.getElementById('fileName');

    if (dropZone && fileInput) {
        // Lifecycle: Attach unified event prevention for all drag states
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        // UI Feedback: Highlight zone during active drag
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

        // Action: Process file drop
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

        // Action: Process manual file selection
        fileInput.addEventListener('change', function() {
            if (this.files.length > 0) {
                updateFileName(this.files[0].name);
                handleFiles(this.files);
            }
        });

        /**
         * UI: updateFileName
         * Updates the display label in the upload zone.
         * 
         * @param {string} name - Selected filename
         */
        function updateFileName(name) {
            if (fileNameDisplay) {
                fileNameDisplay.textContent = name;
                fileNameDisplay.style.display = 'block';
            }
        }

        /**
         * Logic: handleFiles
         * Performs pre-transmission validation on selected binaries.
         * 
         * @param {FileList} files - List of target files
         */
        function handleFiles(files) {
            const file = files[0];
            const maxSize = 1024 * 1024 * 1024; // 1GB Threshold
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

    /**
     * Interface: copyLink
     * Copies the full file retrieval URL to the system clipboard.
     * Implements legacy fallback for non-secure contexts.
     * 
     * @param {number} id - File resource ID
     */
    window.copyLink = function(id) {
        const fullUrl = `${window.location.origin}/files/serve/${id}`;
        
        // Context: try modern Clipboard API first
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(fullUrl).then(function() {
                showToast('Link copied to clipboard!', 'success');
            }).catch(function() {
                fallbackCopy(fullUrl);
            });
        } else {
            fallbackCopy(fullUrl);
        }
        
        /**
         * Legacy Fallback for document.execCommand('copy')
         */
        function fallbackCopy(text) {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            showToast('Link copied to clipboard!', 'success');
        }
    };

    /**
     * Interface: openPermissions (Admin)
     * Displays the ACL management interface for a specific file.
     * 
     * @param {Object} file - File record object from table
     */
    window.openPermissions = function(file) {
        const modal = document.getElementById('permissionModal');
        if (modal) {
            document.getElementById('permissionFileId').value = file.id;
            
            // Sync Admin Only flag
            document.getElementById('permissionAdminOnly').checked = file.admin_only == 1;
            
            // UI Sync: Reset and apply allowed user checkboxes
            document.querySelectorAll('.user-permission-checkbox').forEach(cb => cb.checked = false);
            
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

    /**
     * Action: confirmDeleteFile (Admin)
     * Triggers permanent resource deletion confirmation.
     * 
     * @param {number} id - File ID
     * @param {string} filename - Display name for confirmation
     */
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
                    // Logic: full reload required to sync storage stats and table
                    window.location.reload();
                }
            }
        });
    };

    // Modal: Configure global closure logic
    setupGlobalModalClosing(['modal-overlay', 'delete-modal-overlay'], [
        () => {
            const modal = document.getElementById('permissionModal');
            if (modal) modal.style.display = 'none';
        },
        closeConfirmModal
    ]);

    /**
     * Form: Permissions Submission (Admin)
     * Transmits ACL updates to the server.
     */
    document.getElementById('permissionForm')?.addEventListener('submit', async function(e) {
        e.preventDefault();
        const id = document.getElementById('permissionFileId').value;
        const btn = this.querySelector('button[type="submit"]');
        const originalHtml = btn.innerHTML;

        // UI Feedback: indicate network flight
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

    /**
     * Form: File Upload Submission
     * Executes the binary transfer to server storage.
     */
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
        
        // Use global Fetch wrapper for multipart support
        const result = await apiPost('/files', formData);

        if (result && result.success) {
            // Redirect back to vault on success
            window.location.href = '/files';
        } else {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    });

    // Workflow: Automated alert cleanup
    document.querySelectorAll('.alert').forEach(alert => {
        setTimeout(() => {
            alert.style.opacity = '0';
            alert.style.transform = 'translateY(-10px)';
            setTimeout(() => alert.remove(), 500);
        }, 5000);
    });
});
