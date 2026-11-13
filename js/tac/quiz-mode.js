import { getR2VocaUrl } from '../config/r2-config.js';
import { CARDS, STAGE_THEMES } from './cards-data.js';

const QUIZ_TOTAL_ROUNDS = 10;
const audioPlayer = document.getElementById('audio-player');
const quizAudioCtx = new (window.AudioContext || window.webkitAudioContext)();

let quizScore = 0;
let quizCurrentRound = 1;
let currentQuizAnswer = null;
let currentQuizPool = [];
let isCheckingAnswer = false;

function playSoundEffect(type) {
  try {
    if (quizAudioCtx.state === 'suspended') quizAudioCtx.resume();
    const now = quizAudioCtx.currentTime;

    if (type === 'correct') {
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, idx) => {
        const osc = quizAudioCtx.createOscillator();
        const gain = quizAudioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);
        gain.gain.setValueAtTime(0.22, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.3);
        osc.connect(gain);
        gain.connect(quizAudioCtx.destination);
        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.3);
      });
    } else {
      const osc = quizAudioCtx.createOscillator();
      const gain = quizAudioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.22);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(gain);
      gain.connect(quizAudioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.22);
    }
  } catch (e) {
    console.warn('효과음 에러:', e);
  }
}

export function initQuizEvents(onBackToCard) {
  document.getElementById('btn-quiz-reset').addEventListener('click', () => resetAndStartQuiz());
  document.getElementById('quiz-speaker-banner').addEventListener('click', playQuizPromptAudio);
  document.getElementById('btn-quiz-play-again').addEventListener('click', () => resetAndStartQuiz());
  document.getElementById('btn-quiz-to-card').addEventListener('click', () => {
    document.getElementById('quiz-complete-modal').classList.add('hidden');
    if (onBackToCard) onBackToCard();
  });
}

let lastSelectedSetRef = null;

export function resetAndStartQuiz(selectedSet = lastSelectedSetRef) {
  if (selectedSet) lastSelectedSetRef = selectedSet;

  quizScore = 0;
  quizCurrentRound = 1;
  isCheckingAnswer = false;
  document.getElementById('quiz-complete-modal').classList.add('hidden');

  const hasSelection = (lastSelectedSetRef && lastSelectedSetRef.size > 0 && lastSelectedSetRef.size < CARDS.length);
  const selectedPool = hasSelection
    ? CARDS.filter(c => lastSelectedSetRef.has(c.id) && !c.isStory)
    : [];

  if (selectedPool.length >= 3) {
    currentQuizPool = selectedPool;
  } else {
    currentQuizPool = CARDS.filter(c => !c.isStory);
  }

  updateQuizScoreUI();
  generateNewQuiz(false);
}

function generateNewQuiz(autoPlay = true) {
  if (quizCurrentRound > QUIZ_TOTAL_ROUNDS) {
    showQuizCompleteModal();
    return;
  }

  isCheckingAnswer = false;
  updateQuizScoreUI();

  const shuffled = [...currentQuizPool].sort(() => 0.5 - Math.random());
  const choices = shuffled.slice(0, 3);
  currentQuizAnswer = choices[Math.floor(Math.random() * choices.length)];

  const grid = document.getElementById('quiz-options-grid');
  grid.innerHTML = '';

  choices.forEach(card => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const stConfig = STAGE_THEMES[card.stage] || STAGE_THEMES["1단계"];

    btn.className = "w-full aspect-[2.1/1] bg-slate-100 rounded-2xl border-2 sm:border-3 border-slate-200 shadow-xs overflow-hidden relative cursor-pointer active:scale-[0.98] transition group text-left";
    btn.addEventListener('click', () => checkQuiz(card, btn));

    btn.innerHTML = `
      <img src="images/${card.id}.jpg" loading="lazy" decoding="async" class="w-full h-full object-cover" onerror="this.style.display='none'; this.nextElementSibling.classList.remove('hidden');">

      <div class="hidden absolute inset-0 flex flex-col items-center justify-center bg-slate-50 p-2 text-center">
        <span class="gothic-font text-base sm:text-lg text-slate-800 font-black break-words">${card.word}</span>
        <span class="text-xs text-slate-400 font-mono font-bold">${card.id}</span>
      </div>

      <div class="absolute bottom-2 right-2 bg-black/60 backdrop-blur-xs px-2.5 py-1 rounded-md text-[11px] font-mono font-bold text-white flex items-center gap-1.5 pointer-events-none">
        <span class="text-amber-300 font-black">${card.id}</span>
        <span class="text-[10px] px-1 rounded text-white ${stConfig.bg}">${stConfig.name}</span>
      </div>

      <div class="quiz-feedback-overlay absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity pointer-events-none">
        <span class="quiz-feedback-icon text-5xl sm:text-6xl drop-shadow-md"></span>
      </div>
    `;
    grid.appendChild(btn);
  });

  if (autoPlay) {
    setTimeout(() => playQuizPromptAudio(), 250);
  }
}

function playQuizPromptAudio() {
  if (!currentQuizAnswer) return;
  audioPlayer.src = getR2VocaUrl(currentQuizAnswer.id);
  audioPlayer.currentTime = 0;
  audioPlayer.play().catch(e => console.warn(e));
}

function checkQuiz(chosen, btn) {
  if (isCheckingAnswer) return;

  const overlay = btn.querySelector('.quiz-feedback-overlay');
  const icon = btn.querySelector('.quiz-feedback-icon');

  if (chosen.id === currentQuizAnswer.id) {
    isCheckingAnswer = true;
    quizScore++;

    btn.classList.remove('border-slate-200');
    btn.classList.add('border-green-500', 'ring-4', 'ring-green-400/40');

    if (overlay && icon) {
      icon.textContent = '⭕';
      overlay.classList.remove('opacity-0');
    }

    playSoundEffect('correct');

    if (typeof window.confetti === 'function') {
      window.confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } });
    }

    setTimeout(() => {
      quizCurrentRound++;
      generateNewQuiz(true);
    }, 1200);
  } else {
    btn.classList.remove('border-slate-200');
    btn.classList.add('border-rose-500', 'ring-4', 'ring-rose-400/40');

    playSoundEffect('incorrect');

    if (overlay && icon) {
      icon.textContent = '❌';
      overlay.classList.remove('opacity-0');
      setTimeout(() => {
        overlay.classList.add('opacity-0');
        btn.classList.remove('border-rose-500', 'ring-4', 'ring-rose-400/40');
        btn.classList.add('border-slate-200');
      }, 600);
    }
  }
}

function updateQuizScoreUI() {
  document.getElementById('quiz-progress-badge').textContent = `${Math.min(quizCurrentRound, QUIZ_TOTAL_ROUNDS)} / ${QUIZ_TOTAL_ROUNDS}`;
  document.getElementById('quiz-score-badge').textContent = `SCORE: ${quizScore} / ${QUIZ_TOTAL_ROUNDS}`;
}

function showQuizCompleteModal() {
  document.getElementById('quiz-final-score').textContent = quizScore;
  document.getElementById('quiz-complete-modal').classList.remove('hidden');
  if (typeof window.confetti === 'function') {
    window.confetti({ particleCount: 90, spread: 80, origin: { y: 0.5 } });
  }
}
