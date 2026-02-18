// /public/js/quiz/study.js

let questions = [];
let currentPage = 0;
const ITEMS_PER_PAGE = 10;

// TTS State (Replaced with Audio State)
let currentAudio = null;
let currentPlayingFile = null;

// Fetch all questions and initialize
async function initStudyMode() {
    const loadingState = document.getElementById('loading-state');
    const questionsContainer = document.getElementById('questions-container');
    const controlsContainer = document.getElementById('pagination-controls');
    const errorState = document.getElementById('error-state');
    const totalDisplay = document.getElementById('total-questions');

    try {
        const response = await fetch('/api/quiz/questions?mode=all');
        if (!response.ok) {
            throw new Error('Failed to fetch questions');
        }
        
        questions = await response.json();
        
        loadingState.style.display = 'none';
        
        if (questions.length > 0) {
            totalDisplay.textContent = `${questions.length} Questions Total`;
            questionsContainer.style.display = 'block';
            controlsContainer.style.display = 'flex';
            
            // Initial Render
            renderPage();
        } else {
            throw new Error('No questions received');
        }
    } catch (error) {
        console.error(error);
        loadingState.style.display = 'none';
        errorState.style.display = 'block';
    }
}

// Audio Playback Function
function playAudio(filename) {
    if (!filename) return;
    
    stopSpeaking(); // Always stop previous
    
    currentPlayingFile = filename;
    currentAudio = new Audio(`/audio/quiz/${filename}`);
    
    currentAudio.onended = () => {
        currentPlayingFile = null;
    };

    currentAudio.play().catch(e => console.warn("Audio playback failed:", e));
}

function stopSpeaking() {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio = null;
    }
    currentPlayingFile = null;
}

// Toggle logic for buttons
function toggleAudio(filename) {
    // Smart Toggle: Stop only if playing THIS file
    if (currentAudio && !currentAudio.paused && currentPlayingFile === filename) {
        stopSpeaking();
    } else {
        playAudio(filename);
    }
}

// Render a specific page of questions
function renderPage() {
    const container = document.getElementById('questions-container');
    container.innerHTML = '';
    stopSpeaking(); // Stop audio when changing pages

    // Calculate start and end indices
    const start = currentPage * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const pageQuestions = questions.slice(start, end);

    pageQuestions.forEach((q, index) => {
        // Find the correct answer
        const correctAnswer = q.answers.find(a => a.is_correct);
        
        // Calculate absolute question number
        const absoluteIndex = start + index + 1;

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
        
        // We use flex layouts in the HTML string to position the buttons next to text
        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
                <div style="flex: 1;">
                    <div style="color: var(--aus-gold); font-weight: 600; font-size: 0.9rem; margin-bottom: 0.5rem;">
                        Question ${absoluteIndex}
                    </div>

                    ${imageHtml}

                    <div style="display: flex; gap: 15px; align-items: flex-start; margin-bottom: 0.75rem;">
                        <div class="q-text-en" style="flex: 1;">${q.question}</div>
                        <button class="btn-tts tts-q-btn" aria-label="Read Question">🔊</button>
                    </div>

                    <div class="q-text-ph">${q.question_ph}</div>
                    <div class="q-text-th thai-text">${q.question_th}</div>
                </div>
            </div>
            
            <div style="margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid var(--glass-border);">
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem;">
                    <span style="font-size: 1.5rem;">✅</span>
                    <strong style="color: var(--aus-green);">Correct Answer:</strong>
                </div>
                
                <div style="background: rgba(0, 200, 83, 0.1); border: 1px solid var(--aus-green); border-radius: 12px; padding: 1rem;">
                    <div style="display: flex; gap: 15px; align-items: flex-start; margin-bottom: 0.5rem;">
                        <div style="font-size: 1.1rem; font-weight: 600; flex: 1;">
                            ${correctAnswer.text}
                        </div>
                        <button class="btn-tts tts-a-btn" aria-label="Read Answer">🔊</button>
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
                        <div style="color: var(--aus-gold); font-weight: 600; margin-bottom: 0.5rem;">💡 Explanation:</div>
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
        
        // Attach Event Listeners to the specific buttons in this card
        const qBtn = card.querySelector('.tts-q-btn');
        qBtn.onclick = (e) => {
            e.preventDefault();
            toggleAudio(q.audio);
        };

        const aBtn = card.querySelector('.tts-a-btn');
        aBtn.onclick = (e) => {
            e.preventDefault();
            toggleAudio(correctAnswer.audio);
        };

        container.appendChild(card);
    });

    updateControls();
    
    // Smooth scroll to top when changing pages
    const scrollTargets = [
        document.documentElement,
        document.body,
        document.querySelector('.quiz-container')
    ];
    scrollTargets.forEach(target => { if (target) target.scrollTop = 0; });
    window.scrollTo({ top: 0, behavior: 'instant' });
}

// Update button visibility and page counter
function updateControls() {
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const pageIndicator = document.getElementById('page-indicator');
    
    const totalPages = Math.ceil(questions.length / ITEMS_PER_PAGE);
    
    prevBtn.style.display = currentPage > 0 ? 'block' : 'none';
    nextBtn.style.display = currentPage < totalPages - 1 ? 'block' : 'none';
    pageIndicator.textContent = `Page ${currentPage + 1} of ${totalPages}`;
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    initStudyMode();

    document.getElementById('next-btn').addEventListener('click', () => {
        currentPage++;
        renderPage();
    });

    document.getElementById('prev-btn').addEventListener('click', () => {
        if (currentPage > 0) {
            currentPage--;
            renderPage();
        }
    });
});