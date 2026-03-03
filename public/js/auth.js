// /public/js/auth.js

/**
 * Authentication Controller Module
 * 
 * This module handles client-side interactions for the login and registration 
 * interfaces. It manages form submission feedback and provides a framework
 * for future validation rules.
 * 
 * Features:
 * - Real-time submission feedback (button state management)
 * - Unified event delegation for all authentication forms
 * - Visual status indication during credential verification
 */

/**
 * Initialization System
 * Sets up listeners for authentication workflows when the DOM is ready.
 */
document.addEventListener('DOMContentLoaded', function() {
    // Scan for all forms within the auth container
    const forms = document.querySelectorAll('form');
    
    forms.forEach(form => {
        /**
         * Action: Form Submission Handler
         * Manages UI state during the authentication handshake.
         */
        form.addEventListener('submit', function(e) {
            const submitBtn = form.querySelector('input[type="submit"]');
            
            // Only proceed if a submit button is found
            if(submitBtn) {
                // UI Feedback: indicate processing to prevent double-submission
                submitBtn.style.opacity = '0.7';
                submitBtn.value = 'Processing...';
            }
        });
    });
});
