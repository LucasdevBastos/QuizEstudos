(() => {
  'use strict';

  const STORAGE_KEY = 'linguagemEstudo.progress.v2';
  const HISTORY_KEY = 'linguagemEstudo.history.v1';
  const STAGES = ['home', 'study', 'summary', 'quiz', 'result'];
  const screens = { home: 'homeScreen', study: 'studyScreen', summary: 'summaryScreen', quiz: 'quizScreen', result: 'endScreen' };
  const stageNames = { home: 'Início', study: 'Material de estudo', summary: 'Resumo', quiz: 'Quiz', result: 'Resultado' };
  const $ = id => document.getElementById(id);

  let material = null;
  let questions = [];
  let state = freshState();
  let selectedAnswer = null;
  let openAnswerText = '';
  let savedProgress = null;
  let toastTimer = null;

  function freshState(stage = 'home') {
    return {
      version: 2,
      stage,
      studyMode: null,
      studyIndex: 0,
      readSections: [],
      questionIndex: 0,
      answers: [],
      score: 0,
      performance: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function normalizeColumnName(value) {
    return String(value || '')
      .replace(/^\uFEFF/, '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', quoted = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index], next = text[index + 1];
      if (char === '"' && quoted && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === ',' && !quoted) {
        row.push(field);
        field = '';
      } else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && next === '\n') index += 1;
        row.push(field);
        if (row.some(value => value.trim())) rows.push(row);
        row = [];
        field = '';
      } else {
        field += char;
      }
    }

    row.push(field);
    if (row.some(value => value.trim())) rows.push(row);
    if (rows.length < 2) return [];

    const headers = rows[0].map(normalizeColumnName);
    const columnIndex = names => {
      for (const name of names) {
        const found = headers.indexOf(normalizeColumnName(name));
        if (found !== -1) return found;
      }
      return -1;
    };
    const getValue = (rowData, names) => {
      const index = columnIndex(names);
      return index === -1 ? '' : String(rowData[index] ?? '').trim();
    };

    return rows.slice(1)
      .filter(rowData => rowData.some(value => value.trim()))
      .map((rowData, index) => {
        const legacyPosition = index + 1;
        const rawId = getValue(rowData, ['id', 'questionId', 'questaoId']);
        const parsedId = Number.parseInt(rawId, 10);
        const id = Number.isFinite(parsedId) ? parsedId : legacyPosition;
        const answer = getValue(rowData, ['resposta', 'gabarito']);
        const options = [
          getValue(rowData, ['opcaoA', 'alternativaA']),
          getValue(rowData, ['opcaoB', 'alternativaB']),
          getValue(rowData, ['opcaoC', 'alternativaC']),
          getValue(rowData, ['opcaoD', 'alternativaD'])
        ];
        const rawType = getValue(rowData, ['tipo', 'type']).toLowerCase();
        const explicitlyOpen = ['aberta', 'discursiva', 'open'].includes(rawType);
        const looksOpen = options.every(option => !option) && answer && !/^[A-D]$/i.test(answer);
        const type = explicitlyOpen || looksOpen ? 'open' : 'multiple-choice';
        const fallbackSection = sectionForQuestion(legacyPosition);
        const topicId = getValue(rowData, ['topicId', 'topicoId', 'temaId']) || fallbackSection;
        const sourceSectionId = getValue(rowData, ['sourceSectionId', 'secaoFonteId', 'sourceId']) || topicId;
        const correct = type === 'multiple-choice'
          ? (/^[A-D]$/i.test(answer) ? answer.toUpperCase().charCodeAt(0) - 65 : Number.parseInt(answer, 10))
          : null;

        return {
          id,
          type,
          group: getValue(rowData, ['grupo', 'group']),
          author: getValue(rowData, ['autor', 'fonte', 'topico']),
          text: getValue(rowData, ['pergunta', 'questao']),
          options,
          correct,
          expectedAnswer: type === 'open' ? answer : '',
          explanation: getValue(rowData, ['explicacao', 'comentario']),
          topicId,
          sourceSectionId
        };
      });
  }

  function sectionForQuestion(id) {
    if (id >= 1 && id <= 3) return 'introducao-linguagem';
    if (id === 4) return 'nucleo-prova';
    if (id >= 5 && id <= 12) return 'inatista';
    if (id >= 13 && id <= 20) return 'historico-social';
    if (id >= 21 && id <= 25) return 'comparacao';
    if (id >= 26 && id <= 30) return 'trabalho';
    if (id >= 31 && id <= 33) return 'marx';
    if (id >= 34 && id <= 39) return 'trabalho-linguagem';
    return 'bakhtin';
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
      updateQuizCardCopy();
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
    if (!material.sections.length) throw new Error('O material de estudo está vazio.');
    if (!questions.length) throw new Error('O arquivo de perguntas está vazio.');

    for (const question of questions) {
      if (!question.text || !sectionIds.has(question.sourceSectionId)) throw new Error(`Questão ${question.id} possui dados inválidos.`);
      if (question.type === 'multiple-choice') {
        if (question.options.some(option => !option) || !Number.isInteger(question.correct) || question.correct < 0 || question.correct > 3) {
          throw new Error(`Questão objetiva ${question.id} está inválida.`);
        }
      } else if (!question.expectedAnswer) {
        throw new Error(`Questão aberta ${question.id} está sem resposta esperada.`);
      }
    }
  }

  function updateQuizCardCopy() {
    const openCount = questions.filter(question => question.type === 'open').length;
    const objectiveCount = questions.length - openCount;
    const quizCard = $('homeQuizBtn')?.closest('.material-card');
    const description = quizCard?.querySelector('.material-description');
    if (description) {
      description.textContent = openCount
        ? `${objectiveCount} objetivas + ${openCount} abertas, com pontuação e análise dos temas que precisam de revisão.`
        : `${questions.length} questões com explicações, pontuação e análise dos temas que precisam de revisão.`;
    }
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

  function clearProgress() {
    localStorage.removeItem(STORAGE_KEY);
    savedProgress = null;
  }

  function restoreHome() {
    savedProgress = readJSON(STORAGE_KEY, null);
    const valid = savedProgress && savedProgress.version === 2 && ['study', 'summary', 'quiz'].includes(savedProgress.stage);
    $('resumeCard').classList.toggle('is-hidden', !valid);

    if (valid) {
      const detail = savedProgress.stage === 'quiz'
        ? `Quiz: questão ${Math.min(savedProgress.questionIndex + 1, questions.length)} de ${questions.length}.`
        : savedProgress.stage === 'study'
          ? `Material: seção ${savedProgress.studyIndex + 1} de ${material.sections.length}.`
          : 'Resumo pronto para continuar.';
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
      const item = document.createElement('article');
      item.className = 'history-item';
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
    $('studyTime').textContent = `${Math.round(((state.studyIndex + 1) / material.sections.length) * 100)}% do material`;
    $('studyNumber').textContent = String(state.studyIndex + 1).padStart(2, '0');
    $('studyGroup').textContent = section.group;
    $('studyTitle').textContent = section.title;
    $('studySubtitle').textContent = section.subtitle;
    $('studyReference').textContent = section.reference || '';
    $('studyReference').classList.toggle('is-hidden', !section.reference);

    $('studyContent').innerHTML = '';
    (section.content || []).forEach(text => {
      const paragraph = document.createElement('p');
      paragraph.textContent = text;
      $('studyContent').appendChild(paragraph);
    });

    setOptionalBlock('keyConceptBlock', 'keyConcept', section.keyConcept);
    setOptionalBlock('exampleBlock', 'studyExample', section.example);
    setOptionalBlock('rememberBlock', 'studyRemember', section.remember);
    renderComparison(section.comparison || []);
    renderActiveReview(section.reviewQuestions || []);
    renderKeywords($('studyKeywords'), section.keywords || []);

    $('previousTopicBtn').disabled = state.studyIndex === 0;
    const isLast = state.studyIndex === material.sections.length - 1;
    $('nextTopicBtn').classList.toggle('is-hidden', isLast);
    $('studyFinalActions').classList.toggle('is-hidden', !isLast);
    $('previousTopicBtn').parentElement.classList.toggle('single-action', isLast);
    updateHeader();
  }

  function setOptionalBlock(blockId, contentId, value) {
    $(contentId).textContent = value || '';
    $(blockId).classList.toggle('is-hidden', !value);
  }

  function renderComparison(items) {
    const container = $('comparisonList');
    container.innerHTML = '';
    container.classList.toggle('is-hidden', items.length === 0);

    items.forEach(item => {
      const card = document.createElement('article');
      card.className = 'comparison-card';
      card.innerHTML = '<h2></h2><div class="comparison-sides"><div class="comparison-side"><span>Inatista</span><p></p></div><div class="comparison-side"><span>Histórico-social</span><p></p></div></div>';
      card.querySelector('h2').textContent = item.aspect;
      const paragraphs = card.querySelectorAll('p');
      paragraphs[0].textContent = item.inatista;
      paragraphs[1].textContent = item.historicoSocial;
      container.appendChild(card);
    });
  }

  function renderActiveReview(items) {
    const container = $('activeReviewList');
    container.innerHTML = '';
    container.classList.toggle('is-hidden', items.length === 0);

    items.forEach((item, index) => {
      const details = document.createElement('details');
      details.className = 'review-question';
      details.innerHTML = '<summary><span></span><strong></strong><span aria-hidden="true">+</span></summary><p class="review-answer"></p>';
      details.querySelector('summary span').textContent = String(index + 1).padStart(2, '0');
      details.querySelector('strong').textContent = item.question;
      details.querySelector('p').textContent = item.answer;
      container.appendChild(details);
    });
  }

  function renderKeywords(container, values) {
    container.innerHTML = '';
    [...new Set(values)].forEach(value => {
      const tag = document.createElement('span');
      tag.className = 'keyword';
      tag.textContent = value;
      container.appendChild(tag);
    });
  }

  function renderSummary() {
    $('summaryList').innerHTML = '';
    material.sections.forEach((section, index) => {
      const article = document.createElement('article');
      article.className = 'summary-point';
      article.innerHTML = `<span>${String(index + 1).padStart(2, '0')}</span><div><h2></h2><p></p></div>`;
      article.querySelector('h2').textContent = section.title;
      article.querySelector('p').textContent = section.summary;
      $('summaryList').appendChild(article);
    });

    const [left, right] = material.review.dontConfuse;
    $('dontConfuse').innerHTML = '<div class="contrast-pair"><span></span><b>≠</b><span></span></div>';
    const pair = $('dontConfuse').querySelectorAll('span');
    pair[0].textContent = left;
    pair[1].textContent = right;
    renderKeywords($('summaryKeywords'), material.sections.flatMap(section => section.keywords || []));
    $('summaryPhrase').textContent = material.review.phrase;
  }

  function resetQuestionUI() {
    selectedAnswer = null;
    openAnswerText = '';
    $('confirmBtn').disabled = true;
    $('confirmBtn').classList.remove('is-hidden');
    $('confirmBtn').textContent = 'Confirmar resposta';
    $('answerFeedback').classList.add('is-hidden');
    $('optionsContainer').innerHTML = '';
    $('nextQuestionBtn').classList.remove('is-hidden');

    const oldAssessment = $('answerFeedback').querySelector('.self-assessment');
    if (oldAssessment) oldAssessment.remove();
    const explanationLabel = $('answerFeedback').querySelector('.explanation span');
    if (explanationLabel) explanationLabel.textContent = 'Entenda';
  }

  function renderQuestion() {
    if (state.questionIndex < state.answers.length) state.questionIndex = state.answers.length;
    if (state.questionIndex >= questions.length) {
      showStage('result');
      return;
    }

    const question = questions[state.questionIndex];
    const section = sectionById(question.topicId);
    resetQuestionUI();

    $('questionCounter').textContent = `Questão ${state.questionIndex + 1} de ${questions.length}`;
    $('topicBadge').textContent = `${section?.title || question.group || 'Tópico'}${question.type === 'open' ? ' · Aberta' : ''}`;
    $('questionText').textContent = question.text;

    if (question.type === 'open') renderOpenQuestion();
    else renderMultipleChoiceQuestion(question);

    updateHeader();
    saveProgress();
  }

  function renderMultipleChoiceQuestion(question) {
    $('selectionStatus').textContent = 'Selecione uma alternativa.';
    question.options.forEach((option, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'option';
      button.setAttribute('aria-pressed', 'false');
      button.innerHTML = `<span class="option-letter">${String.fromCharCode(65 + index)}</span><span class="option-text"></span>`;
      button.querySelector('.option-text').textContent = option;
      button.addEventListener('click', () => selectOption(index));
      $('optionsContainer').appendChild(button);
    });
  }

  function renderOpenQuestion() {
    $('selectionStatus').textContent = 'Escreva sua resposta antes de ver a resposta esperada.';
    $('confirmBtn').textContent = 'Ver resposta correta';

    const block = document.createElement('div');
    block.className = 'open-answer-block';
    block.innerHTML = `
      <label for="openAnswerInput">Sua resposta</label>
      <textarea id="openAnswerInput" rows="7" maxlength="3000" placeholder="Responda com suas palavras…" aria-describedby="openAnswerHelp"></textarea>
      <div class="open-answer-meta">
        <span id="openAnswerHelp">Depois você compara com a resposta esperada.</span>
        <span id="openAnswerCount">0 / 3000</span>
      </div>
    `;
    $('optionsContainer').appendChild(block);

    const textarea = $('openAnswerInput');
    const counter = $('openAnswerCount');
    textarea.addEventListener('input', () => {
      openAnswerText = textarea.value;
      counter.textContent = `${textarea.value.length} / 3000`;
      const hasText = textarea.value.trim().length > 0;
      $('confirmBtn').disabled = !hasText;
      $('selectionStatus').textContent = hasText
        ? 'Quando terminar, veja a resposta correta para comparar.'
        : 'Escreva sua resposta antes de ver a resposta esperada.';
    });
  }

  function selectOption(index) {
    selectedAnswer = index;
    document.querySelectorAll('.option').forEach((button, buttonIndex) => {
      const active = buttonIndex === index;
      button.classList.toggle('selected', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $('confirmBtn').disabled = false;
    $('selectionStatus').textContent = `Alternativa ${String.fromCharCode(65 + index)} selecionada.`;
  }

  function confirmAnswer() {
    const question = questions[state.questionIndex];
    if (question.type === 'open') revealOpenAnswer(question);
    else confirmMultipleChoiceAnswer(question);
  }

  function confirmMultipleChoiceAnswer(question) {
    if (selectedAnswer === null) return;
    const isCorrect = selectedAnswer === question.correct;

    document.querySelectorAll('.option').forEach((button, index) => {
      button.disabled = true;
      button.classList.remove('selected');
      if (index === question.correct) button.classList.add('correct');
      else if (index === selectedAnswer) button.classList.add('incorrect');
    });

    state.answers.push({
      questionId: question.id,
      type: question.type,
      topicId: question.topicId,
      sourceSectionId: question.sourceSectionId,
      selectedAnswer,
      correctAnswer: question.correct,
      isCorrect,
      answeredAt: new Date().toISOString()
    });
    updateAnswerState();

    $('feedbackState').textContent = isCorrect ? 'Resposta correta' : 'Resposta incorreta';
    $('feedbackState').className = `feedback-state ${isCorrect ? 'correct' : 'incorrect'}`;
    $('explanationText').textContent = question.explanation;
    $('selectionStatus').textContent = '';
    $('confirmBtn').classList.add('is-hidden');
    $('answerFeedback').classList.remove('is-hidden');

    updateHeader();
    saveProgress();
    $('nextQuestionBtn').focus();
  }

  function revealOpenAnswer(question) {
    const textarea = $('openAnswerInput');
    const writtenAnswer = textarea?.value.trim() || openAnswerText.trim();
    if (!writtenAnswer) return;

    openAnswerText = writtenAnswer;
    if (textarea) textarea.disabled = true;
    $('selectionStatus').textContent = '';
    $('confirmBtn').classList.add('is-hidden');

    $('feedbackState').textContent = 'Compare sua resposta';
    $('feedbackState').className = 'feedback-state open-review';
    const explanationLabel = $('answerFeedback').querySelector('.explanation span');
    if (explanationLabel) explanationLabel.textContent = 'Resposta esperada';
    $('explanationText').textContent = question.expectedAnswer;
    $('nextQuestionBtn').classList.add('is-hidden');

    const assessment = document.createElement('div');
    assessment.className = 'self-assessment';
    assessment.innerHTML = `
      <p>Comparando com a resposta acima, como você foi?</p>
      <div class="self-assessment-actions">
        <button class="button self-correct" type="button">✓ Acertei</button>
        <button class="button self-wrong" type="button">✕ Errei</button>
      </div>
    `;

    const [correctButton, wrongButton] = assessment.querySelectorAll('button');
    correctButton.addEventListener('click', () => assessOpenAnswer(question, true, assessment));
    wrongButton.addEventListener('click', () => assessOpenAnswer(question, false, assessment));
    $('answerFeedback').insertBefore(assessment, $('nextQuestionBtn'));
    $('answerFeedback').classList.remove('is-hidden');
    requestAnimationFrame(() => correctButton.focus());
  }

  function assessOpenAnswer(question, isCorrect, assessment) {
    if (state.answers.some(answer => answer.questionId === question.id)) return;

    assessment.querySelectorAll('button').forEach(button => { button.disabled = true; });
    assessment.classList.add(isCorrect ? 'assessed-correct' : 'assessed-wrong');
    $('feedbackState').textContent = isCorrect ? 'Você marcou que acertou' : 'Você marcou que errou';
    $('feedbackState').className = `feedback-state ${isCorrect ? 'correct' : 'incorrect'}`;

    state.answers.push({
      questionId: question.id,
      type: question.type,
      topicId: question.topicId,
      sourceSectionId: question.sourceSectionId,
      writtenAnswer: openAnswerText,
      expectedAnswer: question.expectedAnswer,
      isCorrect,
      selfAssessed: true,
      answeredAt: new Date().toISOString()
    });
    updateAnswerState();

    $('nextQuestionBtn').classList.remove('is-hidden');
    updateHeader();
    saveProgress();
    $('nextQuestionBtn').focus();
  }

  function updateAnswerState() {
    state.score = state.answers.filter(answer => answer.isCorrect).length;
    state.performance = calculatePerformance().map(item => ({
      topicId: item.topicId,
      correct: item.correct,
      total: item.total,
      percentage: item.percentage
    }));
  }

  function nextQuestion() {
    state.questionIndex = state.answers.length;
    if (state.questionIndex < questions.length) renderQuestion();
    else showStage('result');
  }

  function calculatePerformance() {
    return material.sections
      .filter(section => section.includeInPerformance !== false)
      .map(section => {
        const answers = state.answers.filter(answer => answer.topicId === section.topicId);
        const correct = answers.filter(answer => answer.isCorrect).length;
        return {
          ...section,
          total: answers.length,
          correct,
          percentage: answers.length ? Math.round((correct / answers.length) * 100) : 0
        };
      });
  }

  function renderResults() {
    const correct = state.answers.filter(answer => answer.isCorrect).length;
    const errors = state.answers.length - correct;
    const percentage = questions.length ? Math.round((correct / questions.length) * 100) : 0;

    $('scorePercentage').textContent = `${percentage}%`;
    $('scoreRing').style.background = `conic-gradient(var(--accent) ${percentage}%, #242424 ${percentage}%)`;
    $('finalScore').textContent = correct;
    $('finalCorrect').textContent = correct;
    $('finalErrors').textContent = errors;
    $('resultTotal').textContent = questions.length;
    $('performanceMessage').textContent = performanceMessage(percentage);

    const performance = calculatePerformance();
    renderTopicPerformance(performance);
    renderReviewPoints(performance);
    renderErrors();
    recordHistory({
      correct,
      total: questions.length,
      percentage,
      studyMode: state.studyMode,
      completedAt: new Date().toISOString(),
      performance: performance.map(item => ({ topicId: item.topicId, percentage: item.percentage }))
    });
    clearProgress();
    updateHeader();
  }

  function performanceMessage(value) {
    if (value >= 90) return 'Excelente domínio do conteúdo.';
    if (value >= 75) return 'Bom desempenho. Alguns pontos ainda podem ser reforçados.';
    if (value >= 60) return 'Você compreendeu boa parte do conteúdo, mas alguns assuntos precisam de revisão.';
    return 'Recomenda-se revisar o material antes de tentar novamente.';
  }

  function renderTopicPerformance(performance) {
    $('topicPerformance').innerHTML = '';
    performance.filter(item => item.total > 0).forEach(item => {
      const row = document.createElement('div');
      row.innerHTML = `<div class="performance-head"><strong></strong><span>${item.correct} / ${item.total} · ${item.percentage}%</span></div><div class="mini-track"><span style="width:${item.percentage}%"></span></div>`;
      row.querySelector('strong').textContent = item.title;
      $('topicPerformance').appendChild(row);
    });
  }

  function renderReviewPoints(performance) {
    const difficult = performance
      .filter(item => item.total && item.percentage < 75)
      .sort((a, b) => a.percentage - b.percentage)
      .slice(0, 3);

    $('reviewPointsList').innerHTML = '';
    $('reviewIntro').textContent = difficult.length
      ? 'Você apresentou maior dificuldade nestes assuntos:'
      : 'Nenhum tópico ficou abaixo de 75%. Use a revisão para consolidar o aprendizado.';

    difficult.forEach((item, index) => {
      const card = document.createElement('article');
      card.className = 'review-point';
      card.innerHTML = `<div class="review-point-head"><h3></h3><strong>${item.percentage}%</strong></div><button class="button ghost" type="button">Revisar este assunto</button>`;
      card.querySelector('h3').textContent = `${index + 1}. ${item.title}`;
      card.querySelector('button').addEventListener('click', () => reviewSection(item.id));
      $('reviewPointsList').appendChild(card);
    });
  }

  function renderErrors() {
    const errors = state.answers.filter(answer => !answer.isCorrect);
    $('errorList').innerHTML = '';
    $('errorReviewCount').textContent = `${errors.length} ${errors.length === 1 ? 'erro' : 'erros'}`;
    $('errorReview').classList.toggle('is-hidden', errors.length === 0);

    errors.forEach(answer => {
      const question = questions.find(item => item.id === answer.questionId);
      if (!question) return;

      const article = document.createElement('article');
      article.className = 'mistake';
      article.innerHTML = '<p class="card-label"></p><h3></h3><p class="selected-copy"></p><p class="correct-copy"></p><p class="explain-copy"></p><button class="button ghost" type="button">Revisar conteúdo</button>';
      article.querySelector('.card-label').textContent = `Questão ${question.id}${question.type === 'open' ? ' · Aberta' : ''}`;
      article.querySelector('h3').textContent = question.text;

      if (question.type === 'open') {
        article.querySelector('.selected-copy').textContent = `Sua resposta: ${answer.writtenAnswer}`;
        article.querySelector('.correct-copy').textContent = `Resposta esperada: ${question.expectedAnswer}`;
        const explain = article.querySelector('.explain-copy');
        if (question.explanation) explain.textContent = question.explanation;
        else explain.remove();
      } else {
        article.querySelector('.selected-copy').textContent = `Sua resposta: ${String.fromCharCode(65 + answer.selectedAnswer)} — ${question.options[answer.selectedAnswer]}`;
        article.querySelector('.correct-copy').textContent = `Resposta correta: ${String.fromCharCode(65 + answer.correctAnswer)} — ${question.options[answer.correctAnswer]}`;
        article.querySelector('.explain-copy').textContent = `Entenda: ${question.explanation}`;
      }

      article.querySelector('button').addEventListener('click', () => reviewSection(answer.sourceSectionId));
      $('errorList').appendChild(article);
    });
  }

  function recordHistory(attempt) {
    const history = readJSON(HISTORY_KEY, []);
    const duplicate = history[0] && history[0].completedAt === attempt.completedAt;
    if (!duplicate) localStorage.setItem(HISTORY_KEY, JSON.stringify([attempt, ...history].slice(0, 5)));
  }

  function sectionById(id) {
    return material.sections.find(section => section.id === id);
  }

  function reviewSection(id) {
    const index = material.sections.findIndex(section => section.id === id);
    state.stage = 'study';
    state.studyIndex = Math.max(0, index);
    showStage('study');
    showToast('Abrimos o tópico relacionado para sua revisão.');
  }

  function startStudy() {
    clearProgress();
    state = freshState('study');
    state.studyMode = 'study-first';
    showStage('study');
  }

  function startHomeSummary() {
    clearProgress();
    state = freshState('summary');
    state.studyMode = 'study-first';
    showStage('summary');
  }

  function startDirectQuiz() {
    clearProgress();
    state = freshState('quiz');
    state.studyMode = 'quiz-direct';
    startQuiz();
  }

  function startQuiz() {
    state.stage = 'quiz';
    state.questionIndex = 0;
    state.answers = [];
    state.score = 0;
    state.performance = [];
    state.startedAt = new Date().toISOString();
    selectedAnswer = null;
    openAnswerText = '';
    showStage('quiz');
  }

  function goHome() {
    state = freshState();
    showStage('home', { skipSave: true });
    restoreHome();
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').classList.remove('is-hidden');
    toastTimer = setTimeout(() => $('toast').classList.add('is-hidden'), 3000);
  }

  function injectOpenQuestionStyles() {
    if (document.getElementById('openQuestionStyles')) return;
    const style = document.createElement('style');
    style.id = 'openQuestionStyles';
    style.textContent = `
      .open-answer-block{display:grid;gap:10px}
      .open-answer-block label{font-size:.78rem;font-weight:800;color:var(--text)}
      .open-answer-block textarea{width:100%;min-height:170px;resize:vertical;padding:17px 18px;border:1px solid var(--line);border-radius:17px;background:var(--surface);color:var(--text);font:inherit;line-height:1.65;transition:border-color .15s,background .15s,box-shadow .15s}
      .open-answer-block textarea::placeholder{color:#686868}
      .open-answer-block textarea:focus{outline:none;border-color:var(--accent);background:var(--surface-2);box-shadow:0 0 0 3px var(--accent-soft)}
      .open-answer-block textarea:disabled{opacity:1;cursor:default;color:#d8d8d5}
      .open-answer-meta{display:flex;justify-content:space-between;gap:16px;color:var(--muted);font-size:.72rem}
      .feedback-state.open-review{background:var(--accent-soft);color:#dcd7ff}
      .self-assessment{margin:0 0 16px;padding:18px;border:1px solid var(--line);border-radius:18px;background:var(--surface)}
      .self-assessment>p{margin:0 0 13px;color:#d8d8d5;font-weight:700}
      .self-assessment-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .self-assessment .self-correct{border-color:rgba(95,206,145,.45);background:var(--success-soft);color:var(--success)}
      .self-assessment .self-wrong{border-color:rgba(239,122,130,.45);background:var(--danger-soft);color:var(--danger)}
      .self-assessment button:disabled{opacity:.7}
      .self-assessment.assessed-correct{border-color:rgba(95,206,145,.38)}
      .self-assessment.assessed-wrong{border-color:rgba(239,122,130,.38)}
      @media(max-width:520px){.self-assessment-actions{grid-template-columns:1fr}.open-answer-meta{align-items:flex-start;flex-direction:column;gap:4px}}
    `;
    document.head.appendChild(style);
  }

  function bindEvents() {
    document.querySelectorAll('[data-home-entry]').forEach(button => { button.disabled = true; });
    $('startStudyBtn').addEventListener('click', startStudy);
    $('directQuizBtn').addEventListener('click', startDirectQuiz);
    $('homeStudyBtn').addEventListener('click', startStudy);
    $('homeSummaryBtn').addEventListener('click', startHomeSummary);
    $('homeQuizBtn').addEventListener('click', startDirectQuiz);
    $('continueBtn').addEventListener('click', () => { state = savedProgress; showStage(state.stage); });
    $('resetBtn').addEventListener('click', startStudy);
    $('previousTopicBtn').addEventListener('click', () => {
      if (state.studyIndex > 0) {
        state.studyIndex -= 1;
        showStage('study');
      }
    });
    $('nextTopicBtn').addEventListener('click', () => {
      const id = material.sections[state.studyIndex].id;
      if (!state.readSections.includes(id)) state.readSections.push(id);
      if (state.studyIndex < material.sections.length - 1) {
        state.studyIndex += 1;
        showStage('study');
      } else showStage('summary');
    });
    $('studyToSummaryBtn').addEventListener('click', () => {
      const id = material.sections[state.studyIndex].id;
      if (!state.readSections.includes(id)) state.readSections.push(id);
      showStage('summary');
    });
    $('studyToQuizBtn').addEventListener('click', startQuiz);
    $('reviewMaterialBtn').addEventListener('click', () => { state.studyIndex = 0; showStage('study'); });
    $('startQuizBtn').addEventListener('click', startQuiz);
    $('confirmBtn').addEventListener('click', confirmAnswer);
    $('nextQuestionBtn').addEventListener('click', nextQuestion);
    $('retryQuizBtn').addEventListener('click', startQuiz);
    $('restudyBtn').addEventListener('click', startStudy);
    $('goHomeBtn').addEventListener('click', goHome);
    $('headerBack').addEventListener('click', () => {
      if (state.stage === 'study') {
        if (state.studyIndex > 0) {
          state.studyIndex -= 1;
          showStage('study');
        } else goHome();
      } else if (state.stage === 'summary') {
        state.studyIndex = material.sections.length - 1;
        showStage('study');
      }
    });
    window.addEventListener('scroll', () => $('appHeader').classList.toggle('scrolled', window.scrollY > 5), { passive: true });
  }

  injectOpenQuestionStyles();
  bindEvents();
  loadData();
})();