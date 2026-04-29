// /public/js/quiz/study/custom.js

/**
 * Quiz Custom Study Controller Module
 *
 * Name: Custom Study
 * Purpose: Manages a user's personal study list — a curated subset of the
 *          151 citizenship questions. Displays selected questions identically
 *          to the full study guide, and provides a searchable management modal
 *          for adding and removing questions.
 *
 * Features:
 * - State-driven study card rendering (paginated, 10 per page)
 * - Empty state when the list has no questions
 * - Searchable management modal with instant add/remove via AJAX
 * - Integrated audio playback with smart toggle
 *
 * Dependencies:
 * - default.js: apiGet, apiPost, escapeHtml, showToast
 */

/**
 * Application State — single source of truth populated by api_custom_state.
 * @type {{ study_questions: Array, all_questions: Array, count: number }}
 */
const STATE = {
    study_questions: [],
    all_questions:   [],
    count:           0,
};

/** @type {number} Current pagination page index (0-based). */
let currentPage = 0;

/** @type {number} Questions rendered per page. */
const ITEMS_PER_PAGE = 10;

/** @type {Audio|null} Active Audio instance for TTS playback. */
let currentAudio = null;

/** @type {string|null} Filename of the currently playing audio track. */
let currentPlayingFile = null;

/** @type {number} Global sequence counter to prevent stale AJAX overwrites. */
let requestCounter = 0;

/**
 * Fetches the full custom study state from the server and triggers a re-render.
 * Called on initial load; add/remove actions update STATE directly from the
 * response without a second fetch.
 *
 * @returns {Promise<void>}
 */
async function loadState() {
    const data = await apiGet('/quiz/api/custom/state');
    
    if (data && data.success) {
        STATE.study_questions = data.study_questions;
        STATE.all_questions   = data.all_questions;
        STATE.count           = data.count;
        renderUI();
    } else {
        document.getElementById('loading-state')?.classList.add('hidden');
        document.getElementById('error-state')?.classList.remove('hidden');
    }
}

/**
 * Applies state to the DOM — shows the correct container (loading/empty/cards)
 * and resets pagination if the list shrank below the current page.
 *
 * @returns {void}
 */
function renderUI() {
    const loadingState       = document.getElementById('loading-state');
    const emptyState         = document.getElementById('empty-state');
    const questionsContainer = document.getElementById('questions-container');
    const paginationControls = document.getElementById('pagination-controls');
    const totalDisplay       = document.getElementById('total-questions');

    loadingState?.classList.add('hidden');

    if (STATE.study_questions.length === 0) {
        emptyState?.classList.remove('hidden');
        questionsContainer?.classList.add('hidden');
        paginationControls?.classList.add('hidden');
        if (totalDisplay) totalDisplay.classList.add('hidden');
        return;
    }

    emptyState?.classList.add('hidden');
    questionsContainer?.classList.remove('hidden');
    paginationControls?.classList.remove('hidden');
    if (totalDisplay) totalDisplay.classList.add('hidden');

    const totalPages = Math.ceil(STATE.study_questions.length / ITEMS_PER_PAGE);
    if (currentPage >= totalPages) currentPage = Math.max(0, totalPages - 1);

    renderPage();
}

/**
 * Generates the question cards for the current page from STATE.study_questions.
 * Mirrors the rendering logic of the full study guide.
 *
 * @returns {void}
 */
function renderPage() {
    const container = document.getElementById('questions-container');
    if (!container) return;

    container.innerHTML = '';
    stopSpeaking();

    const start         = currentPage * ITEMS_PER_PAGE;
    const pageQuestions = STATE.study_questions.slice(start, start + ITEMS_PER_PAGE);

    pageQuestions.forEach((q, index) => {
        const correctAnswer = q.answers.find(a => a.is_correct);
        const absoluteIndex = start + index + 1;
        const imageHtml     = q.image
            ? `<div class="quiz-image-wrapper">
                 <img src="/images/quiz/${escapeHtml(q.image)}" alt="Question Illustration" loading="lazy" class="hint-image">
               </div>`
            : '';

        const card = document.createElement('div');
        card.className = 'question-card';
        card.innerHTML = `
            <div class="study-question-header">
                <div class="flex-1">
                    <div class="study-question-num">Question ${absoluteIndex}</div>
                    ${imageHtml}
                    <div class="study-question-row">
                        <div class="q-text-en flex-1">${escapeHtml(q.question)}</div>
                        <button class="btn-tts tts-q-btn" aria-label="Read Question">🔊</button>
                    </div>
                    <div class="q-text-ph">${escapeHtml(q.question_ph)}</div>
                    <div class="q-text-th thai-text">${escapeHtml(q.question_th)}</div>
                </div>
            </div>
            <div class="study-answer-section">
                <div class="study-answer-header">
                    <span>✅</span>
                    <strong>Correct Answer:</strong>
                </div>
                <div class="study-answer-box">
                    <div class="study-answer-text-row">
                        <div class="study-answer-text flex-1">${escapeHtml(correctAnswer.text)}</div>
                        <button class="btn-tts tts-a-btn" aria-label="Read Answer">🔊</button>
                    </div>
                    <div class="answer-text-ph">${escapeHtml(correctAnswer.ph)}</div>
                    <div class="thai-text answer-text-th">${escapeHtml(correctAnswer.th)}</div>
                </div>
                ${correctAnswer.explanation ? `
                    <div class="study-explanation-box">
                        <div class="study-explanation-title">💡 Explanation:</div>
                        <div class="study-explanation-text">${escapeHtml(correctAnswer.explanation)}</div>
                        ${correctAnswer.explanation_th ? `<div class="thai-text result-text-th">${escapeHtml(correctAnswer.explanation_th)}</div>` : ''}
                    </div>
                ` : ''}
            </div>
        `;

        card.querySelector('.tts-q-btn').onclick = (e) => { e.preventDefault(); toggleAudio(q.audio); };
        card.querySelector('.tts-a-btn').onclick = (e) => { e.preventDefault(); toggleAudio(correctAnswer.audio); };
        container.appendChild(card);
    });

    updateControls();
    window.scrollTo({ top: 0, behavior: 'instant' });
}

/**
 * Synchronizes the prev/next button visibility and page label with currentPage.
 *
 * @returns {void}
 */
function updateControls() {
    const prevBtn       = document.getElementById('prev-btn');
    const nextBtn       = document.getElementById('next-btn');
    const pageIndicator = document.getElementById('page-indicator');
    const totalPages    = Math.ceil(STATE.study_questions.length / ITEMS_PER_PAGE);

    prevBtn?.classList.toggle('hidden', currentPage === 0);
    nextBtn?.classList.toggle('hidden', currentPage >= totalPages - 1);
    if (pageIndicator) pageIndicator.textContent = `Page ${currentPage + 1} of ${totalPages}`;
}

/**
 * Starts playback of a quiz audio file, stopping any active track first.
 *
 * @param {string} filename - Filename under /audio/quiz/
 * @returns {void}
 */
function playAudio(filename) {
    if (!filename) return;
    stopSpeaking();
    currentPlayingFile = filename;
    currentAudio = new Audio(`/audio/quiz/${filename}`);
    currentAudio.onended = () => { currentPlayingFile = null; };
    currentAudio.play().catch(e => console.warn('Audio playback failed:', e));
}

/**
 * Forcefully stops and clears active audio playback.
 *
 * @returns {void}
 */
function stopSpeaking() {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio = null;
    }
    currentPlayingFile = null;
}

/**
 * Toggles playback — stops if the same file is already playing, otherwise starts.
 *
 * @param {string} filename - Filename under /audio/quiz/
 * @returns {void}
 */
function toggleAudio(filename) {
    if (currentAudio && !currentAudio.paused && currentPlayingFile === filename) {
        stopSpeaking();
    } else {
        playAudio(filename);
    }
}

/**
 * Opens the management modal and renders the full question list.
 *
 * @returns {void}
 */
function openModal() {
    document.getElementById('custom-manage-modal')?.classList.remove('hidden');
    document.body.classList.add('modal-open');
    const searchInput = document.getElementById('question-search');
    if (searchInput) searchInput.value = '';
    renderModalList('');
}

/**
 * Closes the management modal.
 *
 * @returns {void}
 */
function closeModal() {
    document.getElementById('custom-manage-modal')?.classList.add('hidden');
    document.body.classList.remove('modal-open');
}

/**
 * Renders the filtered question list inside the management modal.
 * Each row shows the question text and a toggle button (➕ or ✅).
 *
 * @param {string} query - Search string to filter questions by text
 * @returns {void}
 */
function renderModalList(query) {
    const list    = document.getElementById('modal-question-list');
    const countEl = document.getElementById('modal-count');
    if (!list) return;

    const lq       = query.toLowerCase();
    const filtered = lq
        ? STATE.all_questions.filter(q => q.question.toLowerCase().includes(lq))
        : STATE.all_questions;

    if (countEl) countEl.textContent = `${STATE.count} selected · ${filtered.length} shown`;

    list.innerHTML = '';
    filtered.forEach(q => {
        const item = document.createElement('div');
        item.className = `custom-modal-item${q.in_list ? ' in-list' : ''}`;
        item.innerHTML = `
            <span class="custom-modal-q-text">${escapeHtml(q.question)}</span>
            <button class="custom-modal-toggle" data-index="${q.question_index}" aria-label="${q.in_list ? 'Remove from list' : 'Add to list'}">
                ${q.in_list ? '✅' : '➕'}
            </button>
        `;

        item.querySelector('.custom-modal-toggle').addEventListener('click', async (e) => {
            const requestId = ++requestCounter;
            const btn       = e.currentTarget;
            const index     = parseInt(btn.dataset.index, 10);
            const removing  = q.in_list;
            btn.disabled    = true;

            const endpoint = removing ? '/quiz/api/custom/remove' : '/quiz/api/custom/add';
            const res      = await apiPost(endpoint, { question_index: index });

            // Lifecycle: Ignore response if a newer request has already been initiated
            if (!res || requestId !== requestCounter) {
                if (!res) btn.disabled = false;
                return;
            }

            STATE.study_questions = res.study_questions;
            STATE.all_questions   = res.all_questions;
            STATE.count           = res.count;

            renderUI();
            renderModalList(document.getElementById('question-search')?.value ?? '');
        });

        list.appendChild(item);
    });
}

/**
 * Initialization Block
 */
document.addEventListener('DOMContentLoaded', () => {
    loadState();

    document.getElementById('next-btn')?.addEventListener('click', () => {
        currentPage++;
        renderPage();
    });

    document.getElementById('prev-btn')?.addEventListener('click', () => {
        if (currentPage > 0) { currentPage--; renderPage(); }
    });

    document.getElementById('manage-btn')?.addEventListener('click', openModal);
    document.getElementById('modal-close-btn')?.addEventListener('click', closeModal);

    document.getElementById('custom-manage-modal')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeModal();
    });

    document.getElementById('question-search')?.addEventListener('input', (e) => {
        renderModalList(e.target.value);
    });
});
