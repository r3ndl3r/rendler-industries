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
    const forms = document.querySelectorAll('form');
    const resetSubmitButton = (button) => {
        if (!button) return;
        button.style.opacity = button.dataset.originalOpacity || '';
        button.value = button.dataset.originalValue || button.value;
        button.disabled = false;
    };

    forms.forEach(form => {
        form.addEventListener('submit', function(e) {
            const submitBtn = form.querySelector('input[type="submit"]');

            if(submitBtn) {
                submitBtn.dataset.originalOpacity = submitBtn.style.opacity || '';
                submitBtn.dataset.originalValue = submitBtn.value;
                submitBtn.style.opacity = '0.7';
                submitBtn.value = 'Processing...';
                submitBtn.disabled = true;
            }
        });
    });

    window.addEventListener('pageshow', () => {
        forms.forEach(form => resetSubmitButton(form.querySelector('input[type="submit"]')));
    });
});
