// /public/js/quiz/study/custom/print.js

/**
 * Quiz Custom Study Print Controller Module
 *
 * Name: Custom Study Print
 * Purpose: Renders the user's custom study list in a printer-friendly format.
 *          All questions appear on a single page with no images, no pagination,
 *          and minimal styling suited to paper output.
 *
 * Features:
 * - Renders all selected questions in insertion order
 * - Shows question text, correct answer, and translations
 * - Print button triggers window.print()
 * - Screen styles hidden during print via CSS media query
 *
 * Dependencies:
 * - default.js: escapeHtml
 */

/**
 * Fetches the custom study state and renders all questions for printing.
 *
 * @returns {Promise<void>}
 */
async function loadPrintContent() {
    const data = await apiGet('/quiz/api/custom/state');
    
    if (data && data.success) {
        document.getElementById('loading-state')?.classList.add('hidden');

        if (data.study_questions.length === 0) {
            document.getElementById('empty-state')?.classList.remove('hidden');
            return;
        }

        renderQuestions(data.study_questions);
    } else {
        document.getElementById('loading-state')?.classList.add('hidden');
        document.getElementById('error-state')?.classList.remove('hidden');
    }
}

/**
 * Renders all questions into the print content area.
 *
 * @param {Array} questions - Array of question objects from the state payload
 * @returns {void}
 */
function renderQuestions(questions) {
    const list     = document.getElementById('questions-list');
    const subtitle = document.getElementById('print-subtitle');
    const content  = document.getElementById('print-content');

    if (!list || !content) return;

    if (subtitle) subtitle.textContent = `${questions.length} Questions`;

    questions.forEach((q, index) => {
        const correctAnswer = q.answers.find(a => a.is_correct);

        const item = document.createElement('div');
        item.className = 'print-item';
        item.innerHTML = `
            <div class="print-q-num">Question ${index + 1}</div>
            <div class="print-q-text">${escapeHtml(q.question)}</div>
            <div class="print-q-ph">${escapeHtml(q.question_ph)}</div>
            <div class="print-q-th">${escapeHtml(q.question_th)}</div>
            <div class="print-answer-block">
                <div class="print-answer-label">✅ Correct Answer</div>
                <div class="print-answer-text">${escapeHtml(correctAnswer.text)}</div>
                <div class="print-answer-ph">${escapeHtml(correctAnswer.ph)}</div>
                <div class="print-answer-th">${escapeHtml(correctAnswer.th)}</div>
                ${correctAnswer.explanation ? `
                    <div class="print-explanation">
                        <span class="print-explanation-label">💡 </span>${escapeHtml(correctAnswer.explanation)}
                    </div>
                ` : ''}
            </div>
        `;

        list.appendChild(item);
    });

    content.classList.remove('hidden');
}

/**
 * Initialization Block
 */
document.addEventListener('DOMContentLoaded', () => {
    loadPrintContent();

    document.getElementById('print-btn')?.addEventListener('click', () => {
        window.print();
    });
});
