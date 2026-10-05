# Linguagem e Pensamento — estudo interativo

Plataforma de estudos mobile first construída com HTML, CSS e JavaScript puro. Na entrada, o estudante pode estudar o material antes da avaliação ou iniciar diretamente o mesmo quiz de 60 questões. Ambos os caminhos levam ao resultado, desempenho por tópico e recomendações de revisão.

## Executar localmente

O projeto usa `fetch()` para carregar JSON e CSV, portanto deve ser servido por HTTP:

```bash
python -m http.server 8000
```

Depois, abra `http://localhost:8000`.

## Estrutura principal

```text
index.html                  Interface e telas da aplicação
css/app.css                 Identidade visual e responsividade
js/app.js                   Fluxo, quiz, resultados e persistência
data/study-material.json    11 seções extraídas do material-fonte
perguntas.csv               60 questões originais
```

## Persistência

O navegador guarda localmente o caminho escolhido (`study-first` ou `quiz-direct`), o estudo em andamento e até cinco tentativas concluídas. Não há conta, backend ou envio de dados.

Chaves utilizadas:

- `linguagemEstudo.progress.v1`
- `linguagemEstudo.history.v1`

## Conteúdo

O texto da apostila foi estruturado exclusivamente a partir de `pdf/Material_de_Estudo_Concepcoes_da_Linguagem.pdf`. O PDF não é incorporado à interface: suas explicações, destaques, comparação e perguntas de revisão são apresentados como componentes nativos do site.

As perguntas, alternativas, respostas corretas e explicações de `perguntas.csv` foram preservadas. Cada questão recebe em tempo de carregamento um `topicId` e um `sourceSectionId`, utilizados pelos atalhos de revisão do resultado.
