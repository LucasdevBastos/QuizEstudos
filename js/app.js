(() => {
  'use strict';

  const STORAGE_KEY = 'linguagemEstudo.progress.v1';
  const HISTORY_KEY = 'linguagemEstudo.history.v1';
  const STAGES = ['home', 'study', 'summary', 'quiz', 'result'];
  const screens = { home: 'homeScreen', study: 'studyScreen', summary: 'summaryScreen', quiz: 'quizScreen', result: 'endScreen' };
  const stageNames = { home: 'Início', study: 'Material de estudo', summary: 'Resumo', quiz: 'Quiz', result: 'Resultado' };
  const $ = id => document.getElementById(id);

  let material = null;
  let questions = [];
  let state = freshState();
  let selectedAnswer = null;
  let savedProgress = null;
  let toastTimer = null;

  function freshState(stage = 'home') {
    return { version: 1, stage, studyMode: null, studyIndex: 0, readSections: [], questionIndex: 0, answers: [], score: 0, performance: [], startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  }

  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index], next = text[index + 1];
      if (char === '"' && quoted && next === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) { row.push(field); field = ''; }
      else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && next === '\n') index += 1;
        row.push(field); if (row.some(value => value.trim())) rows.push(row); row = []; field = '';
      } else field += char;
    }
    row.push(field); if (row.some(value => value.trim())) rows.push(row);
    return rows.slice(1).filter(rowData => rowData.length >= 8).map((rowData, index) => {
      const answer = rowData[6].trim();
      const correct = /^[A-D]$/i.test(answer) ? answer.toUpperCase().charCodeAt(0) - 65 : Number.parseInt(answer, 10);
      const sectionId = sectionForQuestion(index + 1);
      return { id: index + 1, author: rowData[0].trim(), text: rowData[1].trim(), options: rowData.slice(2, 6).map(value => value.trim()), correct, explanation: rowData.slice(7).join(',').trim(), topicId: sectionId, sourceSectionId: sectionId };
    });
  }

  function sectionForQuestion(id) {
    if (id >= 1 && id <= 3) return 'introducao-linguagem';
    if (id === 4) return 'nucleo-prova';
    if (id >= 5 && id <= 12) return 'inatista';
    if ((id >= 13 && id <= 20) || (id >= 54 && id <= 58)) return 'historico-social';
    if (id >= 21 && id <= 26) return 'processos-sociais';
    if (id >= 27 && id <= 37) return 'trabalho';
    if ((id >= 43 && id <= 50) || id === 59) return 'trabalho-linguagem';
    if (id >= 38 && id <= 42) return 'marx';
    if (id >= 51 && id <= 53) return 'bakhtin';
    return 'comparacao';
  }

  async function loadData() {
    try {
      const [materialResponse, questionResponse] = await Promise.all([
        fetch('data/study-material.json', { cache: 'no-store' }),
        fetch(`perguntas.csv?v=${Date.now()}`, { cache: 'no-store' })
      ]);
      if (!materialResponse.ok || !questionResponse.ok) throw new Error('Não foi possível carregar os arquivos de estudo.');
      material = await materialResponse.json();
      questions = parseCSV(await questionResponse.text());
      validateData();
      $('topicCount').textContent = material.sections.length;
      $('questionCount').textContent = questions.length;
      document.querySelectorAll('[data-home-entry]').forEach(button => { button.disabled = false; });
      $('loadStatus').textContent = 'Trilha pronta para começar.';
      restoreHome();
    } catch (error) {
      console.error(error);
      document.querySelectorAll('[data-home-entry]').forEach(button => { button.disabled = true; });
      $('loadStatus').textContent = 'Não foi possível carregar o conteúdo. Use um servidor HTTP e tente novamente.';
    }
  }

  function validateData() {
    const sectionIds = new Set(material.sections.map(section => section.id));
    if (material.sections.length !== 11) throw new Error('O material deve conter as onze seções do PDF.');
    if (questions.length !== 60) throw new Error('O arquivo deve conter as 60 questões originais.');
    if (questions.some(question => question.options.length !== 4 || question.correct < 0 || question.correct > 3 || !sectionIds.has(question.sourceSectionId))) throw new Error('Há perguntas ou metadados inválidos.');
  }

  function readJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  }

  function saveProgress() {
    if (state.stage === 'home' || state.stage === 'result') return;
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function clearProgress() { localStorage.removeItem(STORAGE_KEY); savedProgress = null; }

  function restoreHome() {
    savedProgress = readJSON(STORAGE_KEY, null);
    const valid = savedProgress && savedProgress.version === 1 && ['study', 'summary', 'quiz'].includes(savedProgress.stage);
    $('resumeCard').classList.toggle('is-hidden', !valid);
    if (valid) {
      const detail = savedProgress.stage === 'quiz' ? `Quiz: questão ${Math.min(savedProgress.questionIndex + 1, questions.length)} de ${questions.length}.` : savedProgress.stage === 'study' ? `Material: seção ${savedProgress.studyIndex + 1} de ${material.sections.length}.` : 'Resumo pronto para continuar.';
      const chosenPath = savedProgress.studyMode === 'quiz-direct' ? 'Quiz direto' : 'Estudar primeiro';
      $('resumeDescription').textContent = `${chosenPath} · ${detail}`;
    }
    renderHistory();
  }

  function renderHistory() {
    const history = readJSON(HISTORY_KEY, []);
    $('historyBlock').classList.toggle('is-hidden', history.length === 0);
    $('historyList').innerHTML = '';
    history.slice(0, 4).forEach(attempt => {
      const item = document.createElement('article'); item.className = 'history-item';
      const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(attempt.completedAt));
      item.innerHTML = `<div><strong>${attempt.correct} de ${attempt.total}</strong><span>${date}</span></div><div class="history-score">${attempt.percentage}%</div>`;
      $('historyList').appendChild(item);
    });
  }

  function showStage(stage, options = {}) {
    if (!STAGES.includes(stage)) return;
    state.stage = stage;
    Object.entries(screens).forEach(([name, id]) => $(id).classList.toggle('is-active', name === stage));
    $('stageLabel').textContent = stageNames[stage];
    $('headerBack').classList.toggle('is-hidden', stage === 'home' || stage === 'quiz' || stage === 'result');
    updateHeader();
    if (stage === 'study') renderStudy();
    if (stage === 'summary') renderSummary();
    if (stage === 'quiz') renderQuestion();
    if (stage === 'result') renderResults();
    if (!options.skipSave) saveProgress();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    requestAnimationFrame(() => $('mainContent').focus({ preventScroll: true }));
  }

  function updateHeader() {
    let progress = 0;
    if (state.stage === 'study') progress = ((state.studyIndex + 1) / material.sections.length) * 40;
    else if (state.stage === 'summary') progress = 45;
    else if (state.stage === 'quiz') progress = 45 + (state.answers.length / questions.length) * 50;
    else if (state.stage === 'result') progress = 100;
    const rounded = Math.round(progress);
    $('headerPercent').textContent = `${rounded}%`;
    $('headerProgress').style.width = `${rounded}%`;
  }

  function renderStudy() {
    const section = material.sections[state.studyIndex];
    $('studyIndex').textContent = `Seção ${state.studyIndex + 1} de ${material.sections.length}`;
    $('studyTime').textContent = `${Math.round(((state.studyIndex + 1) / material.sections.length) * 100)}% do material`; $('studyNumber').textContent = String(state.studyIndex + 1).padStart(2, '0');
    $('studyGroup').textContent = section.group; $('studyTitle').textContent = section.title; $('studySubtitle').textContent = section.subtitle;
    $('studyReference').textContent = section.reference || ''; $('studyReference').classList.toggle('is-hidden', !section.reference);
    $('studyContent').innerHTML = ''; section.content.forEach(text => { const paragraph = document.createElement('p'); paragraph.textContent = text; $('studyContent').appendChild(paragraph); });
    setOptionalBlock('keyConceptBlock', 'keyConcept', section.keyConcept);
    setOptionalBlock('exampleBlock', 'studyExample', section.example);
    setOptionalBlock('rememberBlock', 'studyRemember', section.remember);
    renderComparison(section.comparison || []); renderActiveReview(section.reviewQuestions || []);
    renderKeywords($('studyKeywords'), section.keywords);
    $('previousTopicBtn').disabled = state.studyIndex === 0;
    const isLast = state.studyIndex === material.sections.length - 1;
    $('nextTopicBtn').classList.toggle('is-hidden', isLast); $('studyFinalActions').classList.toggle('is-hidden', !isLast);
    $('previousTopicBtn').parentElement.classList.toggle('single-action', isLast);
    $('nextTopicBtn').textContent = 'Próximo tópico';
    updateHeader();
  }

  function setOptionalBlock(blockId, contentId, value) {
    $(contentId).textContent = value || ''; $(blockId).classList.toggle('is-hidden', !value);
  }

  function renderComparison(items) {
    const container = $('comparisonList'); container.innerHTML = ''; container.classList.toggle('is-hidden', items.length === 0);
    items.forEach(item => {
      const card = document.createElement('article'); card.className = 'comparison-card';
      card.innerHTML = '<h2></h2><div class="comparison-sides"><div class="comparison-side"><span>Inatista</span><p></p></div><div class="comparison-side"><span>Histórico-social</span><p></p></div></div>';
      card.querySelector('h2').textContent = item.aspect; const paragraphs = card.querySelectorAll('p'); paragraphs[0].textContent = item.inatista; paragraphs[1].textContent = item.historicoSocial; container.appendChild(card);
    });
  }

  function renderActiveReview(items) {
    const container = $('activeReviewList'); container.innerHTML = ''; container.classList.toggle('is-hidden', items.length === 0);
    items.forEach((item, index) => {
      const details = document.createElement('details'); details.className = 'review-question';
      details.innerHTML = '<summary><span></span><strong></strong><span aria-hidden="true">+</span></summary><p class="review-answer"></p>';
      details.querySelector('summary span').textContent = String(index + 1).padStart(2, '0'); details.querySelector('strong').textContent = item.question; details.querySelector('p').textContent = item.answer; container.appendChild(details);
    });
  }

  function renderKeywords(container, values) {
    container.innerHTML = '';
    [...new Set(values)].forEach(value => { const tag = document.createElement('span'); tag.className = 'keyword'; tag.textContent = value; container.appendChild(tag); });
  }

  function renderSummary() {
    $('summaryList').innerHTML = '';
    material.sections.forEach((section, index) => {
      const article = document.createElement('article'); article.className = 'summary-point';
      article.innerHTML = `<span>${String(index + 1).padStart(2, '0')}</span><div><h2></h2><p></p></div>`;
      article.querySelector('h2').textContent = section.title; article.querySelector('p').textContent = section.summary; $('summaryList').appendChild(article);
    });
    const [left, right] = material.review.dontConfuse;
    $('dontConfuse').innerHTML = `<div class="contrast-pair"><span></span><b>≠</b><span></span></div>`;
    const pair = $('dontConfuse').querySelectorAll('span'); pair[0].textContent = left; pair[1].textContent = right;
    renderKeywords($('summaryKeywords'), material.sections.flatMap(section => section.keywords));
    $('summaryPhrase').textContent = material.review.phrase;
  }

  function renderQuestion() {
    if (state.questionIndex >= questions.length) { showStage('result'); return; }
    const question = questions[state.questionIndex], section = sectionById(question.topicId);
    selectedAnswer = null;
    $('questionCounter').textContent = `Questão ${state.questionIndex + 1} de ${questions.length}`;
    $('topicBadge').textContent = section.title; $('questionText').textContent = question.text; $('selectionStatus').textContent = 'Selecione uma alternativa.';
    $('confirmBtn').disabled = true; $('confirmBtn').classList.remove('is-hidden'); $('answerFeedback').classList.add('is-hidden'); $('optionsContainer').innerHTML = '';
    question.options.forEach((option, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'option'; button.setAttribute('aria-pressed', 'false');
      button.innerHTML = `<span class="option-letter">${String.fromCharCode(65 + index)}</span><span class="option-text"></span>`; button.querySelector('.option-text').textContent = option;
      button.addEventListener('click', () => selectOption(index)); $('optionsContainer').appendChild(button);
    });
    updateHeader(); saveProgress();
  }

  function selectOption(index) {
    selectedAnswer = index;
    document.querySelectorAll('.option').forEach((button, buttonIndex) => { const active = buttonIndex === index; button.classList.toggle('selected', active); button.setAttribute('aria-pressed', String(active)); });
    $('confirmBtn').disabled = false; $('selectionStatus').textContent = `Alternativa ${String.fromCharCode(65 + index)} selecionada.`;
  }

  function confirmAnswer() {
    if (selectedAnswer === null) return;
    const question = questions[state.questionIndex], isCorrect = selectedAnswer === question.correct;
    document.querySelectorAll('.option').forEach((button, index) => { button.disabled = true; button.classList.remove('selected'); if (index === question.correct) button.classList.add('correct'); else if (index === selectedAnswer) button.classList.add('incorrect'); });
    state.answers.push({ questionId: question.id, topicId: question.topicId, sourceSectionId: question.sourceSectionId, selectedAnswer, correctAnswer: question.correct, isCorrect, answeredAt: new Date().toISOString() });
    state.score = state.answers.filter(answer => answer.isCorrect).length;
    state.performance = calculatePerformance().map(item => ({ topicId: item.topicId, correct: item.correct, total: item.total, percentage: item.percentage }));
    $('feedbackState').textContent = isCorrect ? 'Resposta correta' : 'Resposta incorreta'; $('feedbackState').className = `feedback-state ${isCorrect ? 'correct' : 'incorrect'}`;
    $('explanationText').textContent = question.explanation; $('selectionStatus').textContent = ''; $('confirmBtn').classList.add('is-hidden'); $('answerFeedback').classList.remove('is-hidden');
    updateHeader(); saveProgress(); $('nextQuestionBtn').focus();
  }

  function nextQuestion() { state.questionIndex += 1; if (state.questionIndex < questions.length) renderQuestion(); else showStage('result'); }

  function calculatePerformance() {
    return material.sections.filter(section => section.includeInPerformance !== false).map(section => {
      const answers = state.answers.filter(answer => answer.topicId === section.topicId), correct = answers.filter(answer => answer.isCorrect).length;
      return { ...section, total: answers.length, correct, percentage: answers.length ? Math.round((correct / answers.length) * 100) : 0 };
    });
  }

  function renderResults() {
    const correct = state.answers.filter(answer => answer.isCorrect).length, errors = state.answers.length - correct, percentage = Math.round((correct / questions.length) * 100);
    $('scorePercentage').textContent = `${percentage}%`; $('scoreRing').style.background = `conic-gradient(var(--accent) ${percentage}%, #242424 ${percentage}%)`;
    $('finalScore').textContent = correct; $('finalCorrect').textContent = correct; $('finalErrors').textContent = errors; $('resultTotal').textContent = questions.length;
    $('performanceMessage').textContent = performanceMessage(percentage);
    const performance = calculatePerformance(); renderTopicPerformance(performance); renderReviewPoints(performance); renderErrors();
    recordHistory({ correct, total: questions.length, percentage, studyMode: state.studyMode, completedAt: new Date().toISOString(), performance: performance.map(item => ({ topicId: item.topicId, percentage: item.percentage })) });
    clearProgress(); updateHeader();
  }

  function performanceMessage(value) {
    if (value >= 90) return 'Excelente domínio do conteúdo.';
    if (value >= 75) return 'Bom desempenho. Alguns pontos ainda podem ser reforçados.';
    if (value >= 60) return 'Você compreendeu boa parte do conteúdo, mas alguns assuntos precisam de revisão.';
    return 'Recomenda-se revisar o material antes de tentar novamente.';
  }

  function renderTopicPerformance(performance) {
    $('topicPerformance').innerHTML = '';
    performance.forEach(item => {
      const row = document.createElement('div'); row.innerHTML = `<div class="performance-head"><strong></strong><span>${item.correct} / ${item.total} · ${item.percentage}%</span></div><div class="mini-track"><span style="width:${item.percentage}%"></span></div>`;
      row.querySelector('strong').textContent = item.title; $('topicPerformance').appendChild(row);
    });
  }

  function renderReviewPoints(performance) {
    const difficult = performance.filter(item => item.total && item.percentage < 75).sort((a, b) => a.percentage - b.percentage).slice(0, 3);
    $('reviewPointsList').innerHTML = '';
    $('reviewIntro').textContent = difficult.length ? 'Você apresentou maior dificuldade nestes assuntos:' : 'Nenhum tópico ficou abaixo de 75%. Use a revisão para consolidar o aprendizado.';
    difficult.forEach((item, index) => {
      const card = document.createElement('article'); card.className = 'review-point'; card.innerHTML = `<div class="review-point-head"><h3></h3><strong>${item.percentage}%</strong></div><button class="button ghost" type="button">Revisar este assunto</button>`;
      card.querySelector('h3').textContent = `${index + 1}. ${item.title}`; card.querySelector('button').addEventListener('click', () => reviewSection(item.id)); $('reviewPointsList').appendChild(card);
    });
  }

  function renderErrors() {
    const errors = state.answers.filter(answer => !answer.isCorrect); $('errorList').innerHTML = ''; $('errorReviewCount').textContent = `${errors.length} ${errors.length === 1 ? 'erro' : 'erros'}`;
    $('errorReview').classList.toggle('is-hidden', errors.length === 0);
    errors.forEach(answer => {
      const question = questions.find(item => item.id === answer.questionId), article = document.createElement('article'); article.className = 'mistake';
      article.innerHTML = `<p class="card-label">Questão ${question.id}</p><h3></h3><p class="selected-copy"></p><p class="correct-copy"></p><p class="explain-copy"></p><button class="button ghost" type="button">Revisar conteúdo</button>`;
      article.querySelector('h3').textContent = question.text; article.querySelector('.selected-copy').textContent = `Sua resposta: ${String.fromCharCode(65 + answer.selectedAnswer)} — ${question.options[answer.selectedAnswer]}`;
      article.querySelector('.correct-copy').textContent = `Resposta correta: ${String.fromCharCode(65 + answer.correctAnswer)} — ${question.options[answer.correctAnswer]}`; article.querySelector('.explain-copy').textContent = `Entenda: ${question.explanation}`;
      article.querySelector('button').addEventListener('click', () => reviewSection(answer.sourceSectionId)); $('errorList').appendChild(article);
    });
  }

  function recordHistory(attempt) {
    const history = readJSON(HISTORY_KEY, []), duplicate = history[0] && history[0].completedAt === attempt.completedAt;
    if (!duplicate) localStorage.setItem(HISTORY_KEY, JSON.stringify([attempt, ...history].slice(0, 5)));
  }

  function sectionById(id) { return material.sections.find(section => section.id === id); }
  function reviewSection(id) { const index = material.sections.findIndex(section => section.id === id); state.stage = 'study'; state.studyIndex = Math.max(0, index); showStage('study'); showToast('Abrimos o tópico relacionado para sua revisão.'); }
  function startStudy() { clearProgress(); state = freshState('study'); state.studyMode = 'study-first'; showStage('study'); }
  function startHomeSummary() { clearProgress(); state = freshState('summary'); state.studyMode = 'study-first'; showStage('summary'); }
  function startDirectQuiz() { clearProgress(); state = freshState('quiz'); state.studyMode = 'quiz-direct'; startQuiz(); }
  function startQuiz() { state.stage = 'quiz'; state.questionIndex = 0; state.answers = []; state.score = 0; state.performance = []; state.startedAt = new Date().toISOString(); selectedAnswer = null; showStage('quiz'); }
  function goHome() { state = freshState(); showStage('home', { skipSave: true }); restoreHome(); }
  function showToast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.remove('is-hidden'); toastTimer = setTimeout(() => $('toast').classList.add('is-hidden'), 3000); }

  function bindEvents() {
    document.querySelectorAll('[data-home-entry]').forEach(button => { button.disabled = true; });
    $('startStudyBtn').addEventListener('click', startStudy); $('directQuizBtn').addEventListener('click', startDirectQuiz);
    $('homeStudyBtn').addEventListener('click', startStudy); $('homeSummaryBtn').addEventListener('click', startHomeSummary); $('homeQuizBtn').addEventListener('click', startDirectQuiz);
    $('continueBtn').addEventListener('click', () => { state = savedProgress; showStage(state.stage); });
    $('resetBtn').addEventListener('click', startStudy);
    $('previousTopicBtn').addEventListener('click', () => { if (state.studyIndex > 0) { state.studyIndex -= 1; showStage('study'); } });
    $('nextTopicBtn').addEventListener('click', () => { const id = material.sections[state.studyIndex].id; if (!state.readSections.includes(id)) state.readSections.push(id); if (state.studyIndex < material.sections.length - 1) { state.studyIndex += 1; showStage('study'); } else showStage('summary'); });
    $('studyToSummaryBtn').addEventListener('click', () => { const id = material.sections[state.studyIndex].id; if (!state.readSections.includes(id)) state.readSections.push(id); showStage('summary'); });
    $('studyToQuizBtn').addEventListener('click', () => startQuiz());
    $('reviewMaterialBtn').addEventListener('click', () => { state.studyIndex = 0; showStage('study'); });
    $('startQuizBtn').addEventListener('click', () => startQuiz()); $('confirmBtn').addEventListener('click', confirmAnswer); $('nextQuestionBtn').addEventListener('click', nextQuestion);
    $('retryQuizBtn').addEventListener('click', () => startQuiz()); $('restudyBtn').addEventListener('click', startStudy); $('goHomeBtn').addEventListener('click', goHome);
    $('headerBack').addEventListener('click', () => { if (state.stage === 'study') state.studyIndex > 0 ? (state.studyIndex -= 1, showStage('study')) : goHome(); else if (state.stage === 'summary') { state.studyIndex = material.sections.length - 1; showStage('study'); } });
    window.addEventListener('scroll', () => $('appHeader').classList.toggle('scrolled', window.scrollY > 5), { passive: true });
  }

  bindEvents(); loadData();
})();
