// /public/js/quiz/questions.js

// State variables for managing the quiz lifecycle
let questions = [];
let currentQuestionIndex = 0;
let score = 0;
let isAnswered = false;

// TTS State (Replaced with Audio State)
let currentAudio = null;
let currentPlayingFile = null;

// Initializes the quiz by fetching data from the internal API.
// Behavior:
//   - Detects mode (standard vs all) from the window path
//   - Toggles visibility between loading, error, and quiz states
async function initQuiz() {
    const loadingState = document.getElementById('loading-state');
    const quizInterface = document.getElementById('quiz-interface');
    const errorState = document.getElementById('error-state');

    // Determine if we are in "All Questions" mode based on the current URL
    const isAllMode = window.location.pathname.includes('/all');
    const apiUrl = isAllMode ? '/api/quiz/questions?mode=all' : '/api/quiz/questions';

    try {
        const response = await fetch(apiUrl);
        
        if (!response.ok) {
            throw new Error('Failed to fetch questions');
        }

        questions = await response.json();
        
        loadingState.style.display = 'none';
        if (questions.length > 0) {
            quizInterface.style.display = 'block';
            startQuiz();
        } else {
            throw new Error('No questions received');
        }

    } catch (error) {
        console.error(error);
        loadingState.style.display = 'none';
        errorState.style.display = 'block';
    }
}

// Native Speak Function (Replaced with File Audio)
function playAudio(filename) {
    if (!filename) return;
    
    // Always cancel before speaking to prevent queue buildups
    stopSpeaking(); 

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

// Resets game state and triggers the first question render.
function startQuiz() {
    currentQuestionIndex = 0;
    score = 0;
    document.getElementById('total-q').textContent = questions.length;
    renderQuestion();
}

// Handles DOM construction for the current question and answers.
// Behavior:
//   - Randomizes answer order visually for every question
//   - Attaches correctness data to buttons for validation
function renderQuestion() {
    isAnswered = false;
    const currentQ = questions[currentQuestionIndex];
    
    // Ensure silence
    stopSpeaking();
    
    const hintBtn = document.getElementById('hint-btn');
    const hintContainer = document.getElementById('hint-image-container');
    const hintImage = document.getElementById('hint-image');

    // Reset Hint State for the new question
    hintContainer.style.display = 'none'; 
    hintBtn.classList.remove('active');

    // Check if this question has an image
    if (currentQ.image) {
        hintBtn.style.display = 'flex'; // Show the button
        hintImage.src = `/images/quiz/${currentQ.image}`; // Set image source
        
        // Remove old event listeners to prevent duplicates (cloning is a quick hack)
        const newBtn = hintBtn.cloneNode(true);
        hintBtn.parentNode.replaceChild(newBtn, hintBtn);
        
        // Add click listener to toggle image
        newBtn.onclick = function() {
            if (hintContainer.style.display === 'none') {
                hintContainer.style.display = 'block'; // Show image
                newBtn.classList.add('active'); // Light up button
            } else {
                hintContainer.style.display = 'none'; // Hide image
                newBtn.classList.remove('active'); // Dim button
            }
        };
    } else {
        hintBtn.style.display = 'none'; // Hide button if no image
    }

    // Reset UI and navigation states
    document.getElementById('next-btn').disabled = true;
    document.getElementById('feedback-container').style.display = 'none';
    document.getElementById('feedback-container').className = 'feedback-box';
    
    // Update progress markers and score display
    document.getElementById('current-q').textContent = currentQuestionIndex + 1;
    document.getElementById('score-tracker').textContent = `Score: ${score}`;
    const progressPercent = ((currentQuestionIndex) / questions.length) * 100;
    document.getElementById('progress-fill').style.width = `${progressPercent}%`;

    // Populate question text (English, Phonetic, and Thai)
    document.getElementById('question-text-en').textContent = currentQ.question;
    document.getElementById('question-text-ph').textContent = currentQ.question_ph;
    document.getElementById('question-text-th').textContent = currentQ.question_th;

    const ttsBtn = document.getElementById('tts-btn');
    
    ttsBtn.onclick = function(e) {
        e.preventDefault();
        // Smart Toggle: Stop only if playing THIS file
        if (currentAudio && !currentAudio.paused && currentPlayingFile === currentQ.audio) {
            stopSpeaking();
        } else {
            playAudio(currentQ.audio);
        }
    };

    const answersContainer = document.getElementById('answers-container');
    answersContainer.innerHTML = '';

    // Shuffle answer array to prevent position-based guessing
    const shuffledAnswers = [...currentQ.answers].sort(() => Math.random() - 0.5);

    shuffledAnswers.forEach(answer => {
        const btn = document.createElement('button');
        btn.className = 'answer-btn';
        
        // Tag the button for validation during the handleAnswer phase
        btn.dataset.correct = answer.is_correct; 

        btn.innerHTML = `
            <div style="font-weight: 700; font-size: 1.1rem; margin-bottom: 4px;">${answer.text}</div>
            <div style="color: var(--aus-gold); font-size: 0.9rem; font-style: italic; margin-bottom: 4px;">${answer.ph}</div>
            <div class="thai-text" style="color: var(--text-secondary); font-size: 0.95rem;">${answer.th}</div>
        `;

        // Pass the answer object itself so we can access text for TTS
        btn.onclick = () => handleAnswer(btn, answer);
        answersContainer.appendChild(btn);
    });
}

// Validates the user selection and provides immediate feedback.
// Parameters:
//   selectedBtn : The DOM element clicked
//   isCorrect   : Boolean result from the data source
// Behavior:
//   - Highlights correct/incorrect choices
//   - Automatically scrolls to the bottom to show the Next button
function handleAnswer(selectedBtn, answerObj) {
    if (isAnswered) return; 
    isAnswered = true;

    // Stop reading question if user interrupts
    stopSpeaking();
    
    const allBtns = document.querySelectorAll('.answer-btn');
    const feedbackContainer = document.getElementById('feedback-container');
    const feedbackIcon = document.getElementById('feedback-icon');
    const feedbackEn = document.getElementById('feedback-msg-en');
    const feedbackTh = document.getElementById('feedback-msg-th');
    const nextBtn = document.getElementById('next-btn');

    allBtns.forEach(btn => btn.disabled = true);

    // Find the correct answer object from the current question data
    const currentQ = questions[currentQuestionIndex];
    const correctAnswerObj = currentQ.answers.find(a => a.is_correct);

    if (answerObj.is_correct) {
        score++;
        selectedBtn.classList.add('btn-success');
        feedbackContainer.className = 'feedback-box alert-success';
        feedbackIcon.textContent = '✅';
        feedbackEn.textContent = 'Correct!';
        feedbackTh.textContent = 'ถูกต้อง';
    } else {
        selectedBtn.classList.add('btn-danger'); 
        // Reveal the correct answer visually if the user was wrong
        const correctBtn = document.querySelector('.answer-btn[data-correct="true"]');
        if (correctBtn) {
            correctBtn.classList.add('btn-success');
        }
        feedbackContainer.className = 'feedback-box alert-danger';
        feedbackIcon.textContent = '❌';
        feedbackEn.textContent = 'Incorrect';
        feedbackTh.textContent = 'ไม่ถูกต้อง';
    }

    if (correctAnswerObj && correctAnswerObj.audio) {
        // Small delay to ensure the stopSpeaking() above fully clears the audio buffer
        setTimeout(() => {
            playAudio(correctAnswerObj.audio);
        }, 300);
    }

    feedbackContainer.style.display = 'flex';
    nextBtn.disabled = false;
    document.getElementById('score-tracker').textContent = `Score: ${score}`;

    // Ensure user sees the feedback and navigation button
    window.scrollTo({
        top: document.body.scrollHeight,
        behavior: 'smooth'
    });
}

// Advances the question index and resets the viewport.
// Targets multiple scroll containers to ensure cross-browser/mobile compatibility.
function nextQuestion() {
    stopSpeaking();
    currentQuestionIndex++;

    const scrollTargets = [
        document.documentElement,
        document.body,
        document.querySelector('.quiz-container')
    ];

    scrollTargets.forEach(target => {
        if (target) target.scrollTop = 0;
    });

    window.scrollTo({
        top: 0,
        left: 0,
        behavior: 'instant'
    });
    
    if (currentQuestionIndex < questions.length) {
        renderQuestion();
    } else {
        finishQuiz();
    }
}

// Renders the final score and results panel.
function finishQuiz() {
    document.getElementById('quiz-interface').style.display = 'none';
    document.getElementById('results-interface').style.display = 'block';
    
    const percentage = Math.round((score / questions.length) * 100);
    const scoreDisplay = document.getElementById('final-score-display');
    const resultMsg = document.getElementById('result-message');
    
    scoreDisplay.textContent = `${percentage}%`;
    
    if (percentage >= 75) {
        scoreDisplay.style.color = 'var(--aus-green)';
        resultMsg.innerHTML = `
            <h4 style="color: var(--aus-green); margin-bottom: 10px;">Congratulations!</h4>
            <p>You passed the practice test.</p>
            <p class="thai-text" style="color: var(--text-secondary); margin-bottom: 0;">ขอแสดงความยินดี! คุณสอบผ่านแบบทดสอบฝึกหัด</p>
        `;
    } else {
        scoreDisplay.style.color = 'var(--danger-red)';
        resultMsg.innerHTML = `
            <h4 style="color: var(--danger-red); margin-bottom: 10px;">Keep Practicing</h4>
            <p>You need 75% to pass.</p>
            <p class="thai-text" style="color: var(--text-secondary); margin-bottom: 0;">ฝึกฝนต่อไป คุณต้องได้คะแนน 75% เพื่อสอบผ่าน</p>
        `;
    }
}

// Main event loop initialization
document.addEventListener('DOMContentLoaded', function() {
    initQuiz();
    document.getElementById('next-btn').addEventListener('click', nextQuestion);
    document.getElementById('restart-btn').addEventListener('click', function() {
        document.getElementById('results-interface').style.display = 'none';
        document.getElementById('loading-state').style.display = 'block';
        initQuiz();
    });
});