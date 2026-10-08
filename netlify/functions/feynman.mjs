const MODEL = process.env.OPENAI_MODEL || "gpt-6-luna";

const BASE_INSTRUCTIONS = `
Você é um tutor socrático especializado em Direito brasileiro e em aprendizagem pelo Método Feynman.

OBJETIVO:
Fazer o aluno demonstrar compreensão real. Não entregue uma aula pronta quando uma pergunta guiada for melhor.

REGRAS:
- Priorize linguagem clara, precisão conceitual e raciocínio jurídico.
- Diferencie "explicar" de "recitar" uma definição.
- Identifique conceitos corretos, incompletos, incorretos e saltos lógicos.
- Faça perguntas curtas e específicas que testem o ponto mais frágil.
- Peça exemplos, contraexemplos, distinções e fundamentos jurídicos quando isso ajudar.
- Não elogie excessivamente.
- Não invente artigo de lei, súmula, precedente ou entendimento jurisprudencial.
- Se não tiver certeza de uma referência jurídica, diga isso e não fabrique a fonte.
- Não trate a análise como aconselhamento jurídico para um caso real; aqui o foco é estudo.
- Responda em português do Brasil.
`;

function json(data, status=200){
  return new Response(JSON.stringify(data), {
    status,
    headers: {"Content-Type":"application/json; charset=utf-8"}
  });
}

function clean(value, max=12000){
  return typeof value === "string" ? value.trim().slice(0,max) : "";
}

function historyText(history){
  if(!Array.isArray(history)) return "";
  return history.slice(-10).map(item => {
    const role = item?.role === "assistant" ? "Tutor" : "Aluno";
    return `${role}: ${clean(item?.content,3000)}`;
  }).join("\n");
}

function buildPrompt(body){
  const subject=clean(body.subject,200);
  const topic=clean(body.topic,300);
  const explanation=clean(body.explanation);
  const history=historyText(body.history);
  const action=clean(body.action,50);
  const message=clean(body.message,5000);

  let prompt = `
Matéria: ${subject || "não informada"}
Tema: ${topic || "não informado"}

Explicação atual do aluno:
${explanation || "(não fornecida)"}

Histórico recente da sessão:
${history || "(sem histórico)"}
`;

  if(action === "analyze"){
    prompt += `
TAREFA:
Analise a explicação do aluno pelo Método Feynman.

Organize a resposta exatamente nestas seções:
1. DIAGNÓSTICO
2. PONTOS FORTES
3. LACUNAS OU CONFUSÕES
4. PERGUNTA DE APROFUNDAMENTO
5. COMO TORNAR A EXPLICAÇÃO MAIS SIMPLES

Na seção 4 faça UMA única pergunta, escolhendo o ponto de maior fragilidade.
Não dê a resposta da pergunta.
`;
  } else if(action === "question"){
    prompt += `
TAREFA:
Crie UMA pergunta no estilo Feynman sobre o tema "${topic || "indicado pelo aluno"}".
A pergunta deve obrigar o aluno a explicar o mecanismo ou a diferença entre conceitos, e não apenas repetir uma definição.
Não responda à pergunta.
`;
  } else {
    prompt += `
TAREFA:
O aluno acabou de responder:
"${message}"

Continue a sessão Feynman.
Faça UMA intervenção por vez: uma observação curta sobre a resposta e UMA pergunta que aprofunde o ponto mais importante.
Não entregue uma resposta longa.
Se houver um erro jurídico importante, sinalize o erro sem inventar fonte e faça a pergunta que permita ao aluno corrigi-lo.
`;
  }

  return prompt;
}

export default async (req) => {
  if(req.method !== "POST"){
    return json({error:"Método não permitido."},405);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if(!apiKey){
    return json({
      error:"A variável OPENAI_API_KEY ainda não foi configurada no Netlify."
    },500);
  }

  let body;
  try{
    body = await req.json();
  }catch{
    return json({error:"JSON inválido."},400);
  }

  const action = clean(body.action,50);
  if(!["analyze","question","chat"].includes(action)){
    return json({error:"Ação inválida."},400);
  }

  const prompt = buildPrompt(body);

  try{
    const response = await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":`Bearer ${apiKey}`
      },
      body:JSON.stringify({
        model:MODEL,
        instructions:BASE_INSTRUCTIONS,
        input:prompt,
        max_output_tokens:800
      })
    });

    const data = await response.json();

    if(!response.ok){
      const message=data?.error?.message || "A API da OpenAI retornou um erro.";
      return json({error:message},response.status);
    }

    const text = data?.output
      ?.flatMap(item => item?.content || [])
      ?.filter(item => item?.type === "output_text")
      ?.map(item => item?.text || "")
      ?.join("\n")
      ?.trim();

    if(!text){
      return json({error:"A OpenAI não retornou texto para esta solicitação."},502);
    }

    return json({text});
  }catch(error){
    return json({error:"Falha ao conectar com a OpenAI. Tente novamente em alguns instantes."},502);
  }
};
