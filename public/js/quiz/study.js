// /public/js/quiz/study.js

/**
 * Quiz Study Mode Controller Module
 * 
 * This module manages the Quiz Study Guide interface. It coordinates 
 * the paginated display of the entire citizenship question registry, 
 * including localized audio playback and educational explanations.
 * 
 * Features:
 * - Paginated rendering of all 1800+ questions
 * - Highlighted "Correct Answer" view with Thai/English translations
 * - Intelligent explanation blocks for learning reinforcement
 * - Integrated localized audio playback for every question and answer
 * - Interactive navigation with visual page indicators
 * - Automatic "Scroll-to-Top" orchestration for page transitions
 * 
 * Dependencies:
 * - default.js: For platform consistency
 */

/**
 * Application State
 */
let questions = [];                 // Master collection from server
let currentPage = 0;                // Pagination pointer
const ITEMS_PER_PAGE = 10;          // View threshold

/**
 * Returns total pages for paginated study mode.
 * @returns {number}
 */
function getTotalPages() {
    return Math.max(1, Math.ceil(questions.length / ITEMS_PER_PAGE));
}
/**
 * Clamps current page within valid bounds.
 * @returns {void}
 */
function clampCurrentPage() {
    currentPage = Math.min(Math.max(currentPage, 0), getTotalPages() - 1);
}

/**
 * TTS/Audio State
 */
let currentAudio = null;            // Active Audio reference
let currentPlayingFile = null;      // Pointer for smart-toggle logic

/**
 * Initialization System: initStudyMode
 * Fetches the complete question set and initiates the first render cycle.
 * 
 * @returns {Promise<void>}
 */
async function initStudyMode() {
    const loadingState = document.getElementById('loading-state');
    const questionsContainer = document.getElementById('questions-container');
    const controlsContainer = document.getElementById('pagination-controls');
    const errorState = document.getElementById('error-state');

    const data = await apiGet('/quiz/api/questions?mode=all');
    
    if (data && data.success) {
        questions = data.questions;
        
        if (loadingState) loadingState.classList.add('hidden');
        
        if (questions.length > 0) {
            if (questionsContainer) questionsContainer.classList.remove('hidden');
            if (controlsContainer) controlsContainer.classList.remove('hidden');
            renderPage();
        } else {
            if (errorState) errorState.classList.remove('hidden');
        }
    } else {
        if (loadingState) loadingState.classList.add('hidden');
        if (errorState) errorState.classList.remove('hidden');
    }
}

/**
 * Utility: safeAssetFilename
 * Validates and sanitizes asset filenames to prevent path traversal.
 * 
 * @param {string} filename - Raw filename input
 * @returns {string} Safe filename or empty string
 */
function safeAssetFilename(filename) {
    const value = String(filename || '').trim();
    return /^[A-Za-z0-9._-]+$/.test(value) ? encodeURIComponent(value) : '';
}

/**
 * Logic: playAudio
 * Executes the playback of a localized MP3/WAV asset.
 * Implements automated stop-and-reset for overlapping requests.
 * 
 * @param {string} filename - Target resource
 */
function playAudio(filename) {
    const safeFilename = safeAssetFilename(filename);
    if (!safeFilename) return;
    
    // Lifecycle: ensure silence before starting new stream
    stopSpeaking(); 
    
    currentPlayingFile = safeFilename;
    currentAudio = new Audio(`/audio/quiz/${safeFilename}`);
    
    currentAudio.onended = () => {
        currentPlayingFile = null;
    };

    currentAudio.play().catch(e => {
        console.warn("Audio playback failed:", e);
        stopSpeaking();
    });
}

/**
 * Logic: stopSpeaking
 * Forcefully terminates active audio playback and clears references.
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
 * Interface Logic: toggleAudio
 * Implements "Smart Toggle" behavior for audio buttons.
 * Stops current playback if the same file is clicked again.
 * 
 * @param {string} filename - Target resource
 */
function toggleAudio(filename) {
    if (currentAudio && !currentAudio.paused && currentPlayingFile === filename) {
        stopSpeaking();
    } else {
        playAudio(filename);
    }
}

/**
 * UI Engine: renderPage
 * Generates the paginated list of question cards for the current page index.
 */
function renderPage() {
    clampCurrentPage();
    const container = document.getElementById('questions-container');
    if (!container) return;
    
    container.innerHTML = '';
    // Lifecycle: Ensure silence when context changes
    stopSpeaking(); 

    // Resolution: Calculate slicing indices
    const start = currentPage * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const pageQuestions = questions.slice(start, end);

    // UI Component Generation Loop
    pageQuestions.forEach((q, index) => {
        const absoluteIndex = start + index + 1;
        const correctAnswer = q.answers.find(a => a.is_correct);
        if (!correctAnswer) {
            console.warn('Skipping study question without a correct answer:', absoluteIndex);
            return;
        }

        // UI Detail: Conditional image rendering
        const safeImage = safeAssetFilename(q.image);
        const imageHtml = safeImage 
            ? `<div class="quiz-image-wrapper">
                 <img src="/images/quiz/${safeImage}" 
                      alt="Question Illustration" 
                      loading="lazy"
                      class="hint-image">
               </div>`
            : '';
        
        const card = document.createElement('div');
        card.className = 'question-card';
        
        // Template: Building card HTML fragment
        card.innerHTML = `
            <div class="study-question-header">
                <div class="flex-1">
                    <div class="study-question-num">
                        Question ${absoluteIndex}
                    </div>

                    ${imageHtml}

                    <div class="study-question-row">
                        <div class="q-text-en flex-1">${window.escapeHtml(q.question || '')}</div>
                        <button class="btn-tts tts-q-btn" aria-label="Read Question">🔊</button>
                    </div>

                    <div class="q-text-ph">${window.escapeHtml(q.question_ph || '')}</div>
                    <div class="q-text-th thai-text">${window.escapeHtml(q.question_th || '')}</div>
                </div>
            </div>
            
            <div class="study-answer-section">
                <div class="study-answer-header">
                    <span>✅</span>
                    <strong>Correct Answer:</strong>
                </div>
                
                <div class="study-answer-box">
                    <div class="study-answer-text-row">
                        <div class="study-answer-text flex-1">
                            ${window.escapeHtml(correctAnswer.text || '')}
                        </div>
                        <button class="btn-tts tts-a-btn" aria-label="Read Answer">🔊</button>
                    </div>

                    <div class="answer-text-ph">
                        ${window.escapeHtml(correctAnswer.ph || '')}
                    </div>
                    <div class="thai-text answer-text-th">
                        ${window.escapeHtml(correctAnswer.th || '')}
                    </div>
                </div>
                
                ${correctAnswer.explanation ? `
                    <div class="study-explanation-box">
                        <div class="study-explanation-title">💡 Explanation:</div>
                        <div class="study-explanation-text">${window.escapeHtml(correctAnswer.explanation || '')}</div>
                        ${correctAnswer.explanation_th ? `
                            <div class="thai-text result-text-th">
                                ${window.escapeHtml(correctAnswer.explanation_th || '')}
                            </div>
                        ` : ''}
                    </div>
                ` : ''}
            </div>
        `;
        
        // Interaction: attach dynamic audio listeners to this specific card's buttons
        const qBtn = card.querySelector('.tts-q-btn');
        if (qBtn) qBtn.onclick = (e) => { e.preventDefault(); toggleAudio(q.audio); };

        const aBtn = card.querySelector('.tts-a-btn');
        if (aBtn) aBtn.onclick = (e) => { e.preventDefault(); toggleAudio(correctAnswer.audio); };

        container.appendChild(card);
    });

    // UI: Update state indicators
    updateControls();
    
    // UI: Ensure top-of-page focus after transition
    const scrollTargets = [
        document.documentElement,
        document.body,
        document.querySelector('.quiz-container')
    ];
    scrollTargets.forEach(target => { if (target) target.scrollTop = 0; });
    window.scrollTo({ top: 0, behavior: 'instant' });
}

/**
 * UI: updateControls
 * Synchronizes pagination button visibility and page labels.
 */
function updateControls() {
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const pageIndicator = document.getElementById('page-indicator');
    
    const totalPages = getTotalPages();
    
    if (prevBtn) prevBtn.classList.toggle('hidden', currentPage === 0);
    if (nextBtn) nextBtn.classList.toggle('hidden', currentPage >= totalPages - 1);
    if (pageIndicator) pageIndicator.textContent = `Page ${currentPage + 1} of ${totalPages}`;
}

/**
 * Initialization Block
 */
document.addEventListener('DOMContentLoaded', () => {
    initStudyMode();

    // Interaction: Next Page
    const nextBtn = document.getElementById('next-btn');
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (currentPage < getTotalPages() - 1) {
                currentPage++;
                renderPage();
            }
        });
    }

    // Interaction: Previous Page
    const prevBtn = document.getElementById('prev-btn');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentPage > 0) {
                currentPage--;
                renderPage();
            }
        });
    }
});
