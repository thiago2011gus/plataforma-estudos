const MODEL = process.env.OPENAI_MODEL || "gpt-6-luna";

const SYSTEM_PROMPT = `
Você é um tutor socrático especializado em Direito brasileiro e no Método Feynman.

Seu objetivo é ajudar o aluno a demonstrar compreensão real, não apenas repetir definições.

Regras:
- Responda sempre em português do Brasil.
- Seja preciso com conceitos jurídicos.
- Identifique acertos, lacunas, confusões e saltos de raciocínio.
- Não invente artigos de lei, súmulas, precedentes ou jurisprudência.
- Faça uma pergunta por vez quando estiver conduzindo a sessão.
- Priorize perguntas que obriguem o aluno a explicar com linguagem simples.
- Use exemplos, contraexemplos, distinções entre institutos e fundamentos jurídicos quando forem úteis.
- Não dê uma aula longa quando uma pergunta guiada for melhor.
- O objetivo é estudo, não aconselhamento jurídico para um caso concreto.
`;

const headers = {
  "Content-Type": "application/json; charset=utf-8"
};

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers
  });
}

function text(value, limit = 12000) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, limit);
}

function historyToText(history) {
  if (!Array.isArray(history)) return "";

  return history
    .slice(-10)
    .map((item) => {
      const role = item?.role === "assistant" ? "Tutor" : "Aluno";
      return `${role}: ${text(item?.content, 3000)}`;
    })
    .join("\n");
}

function buildUserPrompt(body) {
  const action = text(body.action, 30);
  const subject = text(body.subject, 200);
  const topic = text(body.topic, 300);
  const explanation = text(body.explanation);
  const message = text(body.message, 5000);
  const history = historyToText(body.history);

  const context = `
Matéria: ${subject || "não informada"}
Tema: ${topic || "não informado"}

Explicação do aluno:
${explanation || "(não fornecida)"}

Histórico recente:
${history || "(sem histórico)"}
`;

  if (action === "analyze") {
    return `${context}

Analise a explicação pelo Método Feynman.

Use exatamente estas seções:
1. DIAGNÓSTICO
2. PONTOS FORTES
3. LACUNAS OU CONFUSÕES
4. PERGUNTA DE APROFUNDAMENTO
5. COMO TORNAR A EXPLICAÇÃO MAIS SIMPLES

Na seção 4 faça UMA única pergunta.
Não responda essa pergunta.`;
  }

  if (action === "question") {
    return `${context}

Crie UMA pergunta Feynman sobre o tema.
A pergunta deve testar compreensão do mecanismo, da lógica ou da diferença entre conceitos próximos.
Não responda à pergunta.`;
  }

  return `${context}

O aluno acabou de responder:
${message}

Continue a sessão Feynman.

Faça uma observação curta sobre a resposta e depois UMA única pergunta que aprofunde o ponto mais importante.

Se houver erro jurídico relevante, sinalize-o sem inventar fonte e conduza o aluno para corrigi-lo.`;
}

export default async (req) => {
  if (req.method !== "POST") {
    return reply(
      { error: "Método não permitido. Use POST." },
      405
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return reply(
      {
        error:
          "OPENAI_API_KEY não está configurada nas variáveis de ambiente do Netlify."
      },
      500
    );
  }

  let body;

  try {
    body = await req.json();
  } catch {
    return reply(
      {
        error:
          "O corpo da requisição não contém JSON válido."
      },
      400
    );
  }

  const action = text(body.action, 30);

  if (!["analyze", "question", "chat"].includes(action)) {
    return reply(
      {
        error: "Ação inválida."
      },
      400
    );
  }

  try {
    const openaiResponse = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: MODEL,
          instructions: SYSTEM_PROMPT,
          input: buildUserPrompt(body),
          max_output_tokens: 900
        })
      }
    );

    const data = await openaiResponse.json();

    if (!openaiResponse.ok) {
      return reply(
        {
          error:
            data?.error?.message ||
            `A OpenAI retornou HTTP ${openaiResponse.status}.`
        },
        openaiResponse.status
      );
    }

    const output = Array.isArray(data?.output)
      ? data.output
      : [];

    const resultText = output
      .flatMap((item) =>
        Array.isArray(item?.content)
          ? item.content
          : []
      )
      .filter(
        (item) => item?.type === "output_text"
      )
      .map((item) => item?.text || "")
      .join("\n")
      .trim();

    if (!resultText) {
      return reply(
        {
          error:
            "A OpenAI respondeu, mas não retornou texto."
        },
        502
      );
    }

    return reply({
      text: resultText
    });

  } catch (error) {
    return reply(
      {
        error:
          "Falha ao conectar com a OpenAI. Verifique a API key e tente novamente."
      },
      502
    );
  }
};
