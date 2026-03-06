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
 * - default.js: For getIcon and platform consistency
 */

/**
 * Application State
 */
let questions = [];                 // Master collection from server
let currentPage = 0;                // Pagination pointer
const ITEMS_PER_PAGE = 10;          // View threshold

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
    const totalDisplay = document.getElementById('total-questions');

    try {
        const response = await fetch('/quiz/api/questions?mode=all');
        if (!response.ok) throw new Error('Failed to fetch questions');
        
        questions = await response.json();
        
        if (loadingState) loadingState.style.display = 'none';
        
        if (questions.length > 0) {
            // UI: Update metadata and show containers
            if (totalDisplay) totalDisplay.textContent = `${questions.length} Questions Total`;
            if (questionsContainer) questionsContainer.style.display = 'block';
            if (controlsContainer) controlsContainer.style.display = 'flex';
            
            // Initial Render
            renderPage();
        } else {
            throw new Error('No questions received');
        }
    } catch (error) {
        console.error('initStudyMode failure:', error);
        if (loadingState) loadingState.style.display = 'none';
        if (errorState) errorState.style.display = 'block';
    }
}

/**
 * Logic: playAudio
 * Executes the playback of a localized MP3/WAV asset.
 * Implements automated stop-and-reset for overlapping requests.
 * 
 * @param {string} filename - Target resource
 */
function playAudio(filename) {
    if (!filename) return;
    
    // Lifecycle: ensure silence before starting new stream
    stopSpeaking(); 
    
    currentPlayingFile = filename;
    currentAudio = new Audio(`/audio/quiz/${filename}`);
    
    currentAudio.onended = () => {
        currentPlayingFile = null;
    };

    currentAudio.play().catch(e => console.warn("Audio playback failed:", e));
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
        const correctAnswer = q.answers.find(a => a.is_correct);
        const absoluteIndex = start + index + 1;

        // UI Detail: Conditional image rendering
        const imageHtml = q.image 
            ? `<div class="quiz-image-wrapper" style="margin: 1rem 0; text-align: center;">
                 <img src="/images/quiz/${q.image}" 
                      alt="Question Illustration" 
                      loading="lazy"
                      style="max-width: 100%; max-height: 300px; border-radius: 12px; border: 1px solid var(--glass-border);">
               </div>`
            : '';
        
        const card = document.createElement('div');
        card.className = 'question-card';
        card.style.marginBottom = '2rem';
        
        // Template: Building card HTML fragment
        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
                <div style="flex: 1;">
                    <div style="color: var(--aus-gold); font-weight: 600; font-size: 0.9rem; margin-bottom: 0.5rem;">
                        Question ${absoluteIndex}
                    </div>

                    ${imageHtml}

                    <div style="display: flex; gap: 15px; align-items: flex-start; margin-bottom: 0.75rem;">
                        <div class="q-text-en" style="flex: 1;">${q.question}</div>
                        <button class="btn-tts tts-q-btn" aria-label="Read Question">${getIcon('audio')}</button>
                    </div>

                    <div class="q-text-ph">${q.question_ph}</div>
                    <div class="q-text-th thai-text">${q.question_th}</div>
                </div>
            </div>
            
            <div style="margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid var(--glass-border);">
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem;">
                    <span style="font-size: 1.5rem;">${getIcon('success')}</span>
                    <strong style="color: var(--aus-green);">Correct Answer:</strong>
                </div>
                
                <div style="background: rgba(0, 200, 83, 0.1); border: 1px solid var(--aus-green); border-radius: 12px; padding: 1rem;">
                    <div style="display: flex; gap: 15px; align-items: flex-start; margin-bottom: 0.5rem;">
                        <div style="font-size: 1.1rem; font-weight: 600; flex: 1;">
                            ${correctAnswer.text}
                        </div>
                        <button class="btn-tts tts-a-btn" aria-label="Read Answer">${getIcon('audio')}</button>
                    </div>

                    <div style="color: var(--aus-gold); font-size: 0.95rem; font-style: italic; margin-top: 0.5rem;">
                        ${correctAnswer.ph}
                    </div>
                    <div class="thai-text" style="color: var(--text-secondary); margin-top: 0.5rem;">
                        ${correctAnswer.th}
                    </div>
                </div>
                
                ${correctAnswer.explanation ? `
                    <div style="margin-top: 1rem; padding: 1rem; background: var(--glass-bg); border-radius: 12px; border-left: 3px solid var(--aus-gold);">
                        <div style="color: var(--aus-gold); font-weight: 600; margin-bottom: 0.5rem;">${getIcon('idea')} Explanation:</div>
                        <div style="line-height: 1.6;">${correctAnswer.explanation}</div>
                        ${correctAnswer.explanation_th ? `
                            <div class="thai-text" style="color: var(--text-secondary); margin-top: 0.5rem; font-size: 0.9rem;">
                                ${correctAnswer.explanation_th}
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
    
    const totalPages = Math.ceil(questions.length / ITEMS_PER_PAGE);
    
    if (prevBtn) prevBtn.style.display = currentPage > 0 ? 'block' : 'none';
    if (nextBtn) nextBtn.style.display = currentPage < totalPages - 1 ? 'block' : 'none';
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
            currentPage++;
            renderPage();
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
