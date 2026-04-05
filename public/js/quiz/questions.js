// /public/js/quiz/questions.js

/**
 * Quiz Engine Controller Module
 * 
 * This module manages the Australian Citizenship Quiz interface. It coordinates 
 * the fetching of randomized question sets, real-time feedback logic, 
 * and localized audio playback for educational accessibility.
 * 
 * Features:
 * - Real-time question synchronization with server-side JSON assets
 * - Automatic answer randomization for every attempt
 * - Interactive feedback container with Thai/English translations
 * - Integrated localized audio playback for questions and correct answers
 * - High-resolution progress tracking and dynamic score badges
 * - Visual "Hint" system for image-based questions
 * 
 * Dependencies:
 * - default.js: For getIcon and platform consistency
 * - toast.js: For connection feedback
 */

/**
 * Application State
 */
let questions = [];                 // Local collection of randomized records
let currentQuestionIndex = 0;       // active pointer
let score = 0;                      // User tally
let isAnswered = false;             // Interaction semaphore

/**
 * TTS/Audio State
 */
let currentAudio = null;            // Global Audio element reference
let currentPlayingFile = null;      // Identifier for smart-toggle logic

/**
 * Initialization System: initQuiz
 * Boots the quiz interface based on URL context (Random vs. All).
 * 
 * @returns {Promise<void>}
 */
async function initQuiz() {
    const loadingState = document.getElementById('loading-state');
    const quizInterface = document.getElementById('quiz-interface');
    const errorState = document.getElementById('error-state');

    // Context: detect "Study All" vs "Test Mode" from path
    const isAllMode = window.location.pathname.includes('/all');
    const apiUrl = isAllMode ? '/quiz/api/questions?mode=all' : '/quiz/api/questions';

    try {
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error('Failed to fetch questions');

        questions = await response.json();
        
        if (loadingState) loadingState.classList.add('hidden');
        if (questions.length > 0) {
            if (quizInterface) quizInterface.classList.remove('hidden');
            startQuiz();
        } else {
            throw new Error('No questions received');
        }

    } catch (error) {
        console.error('initQuiz failure:', error);
        if (loadingState) loadingState.classList.add('hidden');
        if (errorState) errorState.classList.remove('hidden');
    }
}

/**
 * Logic: playAudio
 * Executes the playback of a localized MP3/WAV asset.
 * Implements automated stop-and-reset for overlapping requests.
 * 
 * @param {string} filename - The target audio resource
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
 * Logic: startQuiz
 * Resets tallies and triggers the primary render cycle.
 */
function startQuiz() {
    currentQuestionIndex = 0;
    score = 0;
    const totalEl = document.getElementById('total-q');
    if (totalEl) totalEl.textContent = questions.length;
    renderQuestion();
}

/**
 * UI Engine: renderQuestion
 * Orchestrates the DOM construction for the active question.
 * Implements randomization and image-hint logic.
 */
function renderQuestion() {
    isAnswered = false;
    const currentQ = questions[currentQuestionIndex];
    if (!currentQ) return;
    
    // Lifecycle: ensure silence during transition
    stopSpeaking();
    
    const hintBtn = document.getElementById('hint-btn');
    const hintContainer = document.getElementById('hint-image-container');
    const hintImage = document.getElementById('hint-image');

    // Reset Hint Interface
    if (hintContainer) hintContainer.classList.add('hidden'); 
    if (hintBtn) hintBtn.classList.remove('active');

    // Context: resolve image-based hints
    if (currentQ.image && hintBtn && hintImage) {
        hintBtn.classList.remove('hidden'); 
        hintImage.src = `/images/quiz/${currentQ.image}`; 
        
        // Interaction: attach toggle logic via cloning to purge previous listeners
        const newBtn = hintBtn.cloneNode(true);
        hintBtn.parentNode.replaceChild(newBtn, hintBtn);
        
        newBtn.onclick = function() {
            if (hintContainer.classList.contains('hidden')) {
                hintContainer.classList.remove('hidden');
                newBtn.classList.add('active'); 
            } else {
                hintContainer.classList.add('hidden');
                newBtn.classList.remove('active');
            }
        };
    } else if (hintBtn) {
        hintBtn.classList.add('hidden');
    }

    // UI: Reset navigation and feedback states
    const nextBtn = document.getElementById('next-btn');
    const feedback = document.getElementById('feedback-container');
    if (nextBtn) nextBtn.disabled = true;
    if (feedback) {
        feedback.classList.add('hidden');
        feedback.className = 'feedback-box hidden';
    }
    
    // UI: Update progress markers
    const curQEl = document.getElementById('current-q');
    const scoreEl = document.getElementById('score-tracker');
    const progEl = document.getElementById('progress-fill');
    
    if (curQEl) curQEl.textContent = currentQuestionIndex + 1;
    if (scoreEl) scoreEl.textContent = `Score: ${score}`;
    if (progEl) {
        const progressPercent = ((currentQuestionIndex) / questions.length) * 100;
        progEl.style.width = `${progressPercent}%`;
    }

    // UI: Populate localized question text
    document.getElementById('question-text-en').textContent = currentQ.question;
    document.getElementById('question-text-ph').textContent = currentQ.question_ph;
    document.getElementById('question-text-th').textContent = currentQ.question_th;

    // Action: Automated TTS button logic
    const ttsBtn = document.getElementById('tts-btn');
    if (ttsBtn) {
        ttsBtn.onclick = function(e) {
            e.preventDefault();
            // Logic: toggle playback if already active, else start
            if (currentAudio && !currentAudio.paused && currentPlayingFile === currentQ.audio) {
                stopSpeaking();
            } else {
                playAudio(currentQ.audio);
            }
        };
    }

    // UI Component: Answer Grid construction
    const answersContainer = document.getElementById('answers-container');
    if (answersContainer) {
        answersContainer.innerHTML = '';

        // Logic: Shuffle answers to prevent pattern-guessing
        const shuffledAnswers = [...currentQ.answers].sort(() => Math.random() - 0.5);

        shuffledAnswers.forEach(answer => {
            const btn = document.createElement('button');
            btn.className = 'answer-btn';
            
            // Context: tag for validation hook
            btn.dataset.correct = answer.is_correct; 

            btn.innerHTML = `
                <div class="answer-text-en">${answer.text}</div>
                <div class="answer-text-ph">${answer.ph}</div>
                <div class="thai-text answer-text-th">${answer.th}</div>
            `;

            btn.onclick = () => handleAnswer(btn, answer);
            answersContainer.appendChild(btn);
        });
    }
}

/**
 * Action: handleAnswer
 * Validates the user selection and triggers visual/audio feedback.
 * 
 * @param {HTMLElement} selectedBtn - The DOM node clicked
 * @param {Object} answerObj - The source answer metadata
 */
function handleAnswer(selectedBtn, answerObj) {
    if (isAnswered) return; 
    isAnswered = true;

    // Lifecycle: Stop reading question if user interrupts with an answer
    stopSpeaking();
    
    const nextBtn = document.getElementById('next-btn');
    const allBtns = document.querySelectorAll('.answer-btn');
    const feedbackContainer = document.getElementById('feedback-container');
    const feedbackIcon = document.getElementById('feedback-icon');
    const feedbackEn = document.getElementById('feedback-msg-en');
    const feedbackTh = document.getElementById('feedback-msg-th');

    // UI: Disable all interactions after selection
    allBtns.forEach(btn => btn.disabled = true);

    // Logic: Identify target records from state
    const currentQ = questions[currentQuestionIndex];
    const correctAnswerObj = currentQ.answers.find(a => a.is_correct);

    if (answerObj.is_correct) {
        // Scenario: Success
        score++;
        selectedBtn.classList.add('correct-answer');
        if (feedbackContainer) {
            feedbackContainer.className = 'feedback-box alert-success';
            if (feedbackIcon) feedbackIcon.innerHTML = '✅';
            if (feedbackEn) feedbackEn.textContent = 'Correct!';
            if (feedbackTh) feedbackTh.textContent = 'ถูกต้อง';
        }
    } else {
        // Scenario: Failure
        selectedBtn.classList.add('incorrect-answer'); 
        // Logic: reveal the correct answer visually for learning reinforcement
        const correctBtn = document.querySelector('.answer-btn[data-correct="true"]');
        if (correctBtn) correctBtn.classList.add('correct-answer');
        
        if (feedbackContainer) {
            feedbackContainer.className = 'feedback-box alert-danger';
            if (feedbackIcon) feedbackIcon.innerHTML = '❌';
            if (feedbackEn) feedbackEn.textContent = 'Incorrect';
            if (feedbackTh) feedbackTh.textContent = 'ไม่ถูกต้อง';
        }
    }

    // Logic: automatic audio reinforcement for the correct answer
    if (correctAnswerObj && correctAnswerObj.audio) {
        setTimeout(() => {
            playAudio(correctAnswerObj.audio);
        }, 300); // 300ms delay for visual processing
    }

    if (feedbackContainer) feedbackContainer.classList.remove('hidden');
    if (nextBtn) nextBtn.disabled = false;
    
    const scoreTracker = document.getElementById('score-tracker');
    if (scoreTracker) scoreTracker.textContent = `Score: ${score}`;
}

/**
 * Interface: nextQuestion
 * Advances the pointer and resets the viewport for the next challenge.
 */
function nextQuestion() {
    stopSpeaking();
    currentQuestionIndex++;

    // UI: Ensure top-of-page focus for new question
    const scrollTargets = [
        document.documentElement,
        document.body,
        document.querySelector('.quiz-container')
    ];

    scrollTargets.forEach(target => {
        if (target) target.scrollTop = 0;
    });

    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    
    if (currentQuestionIndex < questions.length) {
        renderQuestion();
    } else {
        finishQuiz();
    }
}

/**
 * UI Component: finishQuiz
 * Generates the final performance summary.
 */
function finishQuiz() {
    const quizInt = document.getElementById('quiz-interface');
    const resInt = document.getElementById('results-interface');
    
    if (quizInt) quizInt.classList.add('hidden');
    if (resInt) resInt.classList.remove('hidden');
    
    const percentage = Math.round((score / questions.length) * 100);
    const scoreDisplay = document.getElementById('final-score-display');
    const resultMsg = document.getElementById('result-message');
    
    if (scoreDisplay) {
        scoreDisplay.textContent = `${percentage}%`;
        
        // Logic: set color based on 75% passing threshold
        if (percentage >= 75) {
            scoreDisplay.className = 'final-score-circle score-pass';
            if (resultMsg) resultMsg.innerHTML = `
                <h4 class="result-header-pass">Congratulations!</h4>
                <p>You passed the practice test.</p>
                <p class="thai-text result-text-th">ขอแสดงความยินดี! คุณสอบผ่านแบบทดสอบฝึกหัด</p>
            `;
        } else {
            scoreDisplay.className = 'final-score-circle score-fail';
            if (resultMsg) resultMsg.innerHTML = `
                <h4 class="result-header-fail">Keep Practicing</h4>
                <p>You need 75% to pass.</p>
                <p class="thai-text result-text-th">ฝึกฝนต่อไป คุณต้องได้คะแนน 75% เพื่อสอบผ่าน</p>
            `;
        }
    }
}

/**
 * Event Listener Initialization
 */
document.addEventListener('DOMContentLoaded', function() {
    initQuiz();
    
    const nextBtn = document.getElementById('next-btn');
    const restartBtn = document.getElementById('restart-btn');
    
    if (nextBtn) nextBtn.addEventListener('click', nextQuestion);
    
    if (restartBtn) {
        restartBtn.addEventListener('click', function() {
            const resInt = document.getElementById('results-interface');
            const loadInt = document.getElementById('loading-state');
            if (resInt) resInt.classList.add('hidden');
            if (loadInt) loadInt.classList.remove('hidden');
            initQuiz();
        });
    }
});
