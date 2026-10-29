// Edge Function: lê a foto ou o PDF de uma nota fiscal com o Google Gemini
// e devolve os dados estruturados (fornecedor, itens, totais, vencimentos).
//
// Configuração (uma vez):
//   1. Gere uma chave gratuita em https://aistudio.google.com/apikey
//   2. Supabase > Edge Functions > Secrets: GEMINI_API_KEY = sua chave
//      (opcional) GEMINI_MODEL         = gemini-3.8-flash       (padrão)
//      (opcional) GEMINI_MODEL_RESERVA = gemini-3.5-flash-lite  (usado quando o limite do principal acaba)
//   3. Publique esta função com o nome "ler-nota".
//
// A chave fica só no servidor do Supabase; o navegador nunca a vê.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const MAX_BYTES = 15 * 1024 * 1024
const API = 'https://generativelanguage.googleapis.com/v1beta/models'

const texto = { type: ['string', 'null'] }
const numero = { type: ['number', 'null'] }

export const SCHEMA = {
  type: 'object',
  required: ['legivel', 'tipo_documento', 'chave_acesso', 'numero', 'serie', 'data_emissao', 'emitente', 'itens',
    'valor_produtos', 'frete', 'desconto', 'outras_despesas', 'valor_total', 'forma_pagamento', 'vencimentos', 'observacoes'],
  properties: {
    legivel: { type: 'boolean', description: 'false se a imagem estiver ilegível demais para confiar nos números' },
    tipo_documento: { type: 'string', enum: ['nfe_danfe', 'nfce_cupom', 'nota_manual', 'recibo', 'outro'] },
    chave_acesso: { ...texto, description: 'Chave de acesso com exatamente 44 dígitos, sem espaços. null se não houver.' },
    numero: { ...texto, description: 'Número da nota (sem zeros à esquerda)' },
    serie: texto,
    data_emissao: { ...texto, description: 'Data de emissão no formato AAAA-MM-DD' },
    emitente: {
      type: 'object',
      required: ['nome', 'nome_fantasia', 'cnpj_cpf'],
      properties: {
        nome: { ...texto, description: 'Razão social / nome do emitente (quem vendeu)' },
        nome_fantasia: texto,
        cnpj_cpf: { ...texto, description: 'Somente dígitos' },
      },
    },
    itens: {
      type: 'array',
      items: {
        type: 'object',
        required: ['codigo', 'descricao', 'unidade', 'quantidade', 'valor_unitario', 'valor_total'],
        properties: {
          codigo: { ...texto, description: 'Código do produto na nota, se houver' },
          descricao: { type: 'string', description: 'Descrição exatamente como impressa' },
          unidade: { ...texto, description: 'Unidade comercial como impressa (UN, KG, CX, FD, PCT, L...)' },
          quantidade: { type: 'number' },
          valor_unitario: { type: 'number' },
          valor_total: { type: 'number' },
        },
      },
    },
    valor_produtos: { ...numero, description: 'Valor total dos produtos' },
    frete: numero,
    desconto: { ...numero, description: 'Desconto total da nota' },
    outras_despesas: { ...numero, description: 'Seguro, outras despesas acessórias, ICMS-ST, IPI — tudo que soma no total além de produtos e frete' },
    valor_total: { ...numero, description: 'Valor total da nota / valor a pagar' },
    forma_pagamento: { ...texto, description: 'Ex.: Dinheiro, Pix, Cartão de crédito, Cartão de débito, Boleto' },
    vencimentos: {
      type: 'array',
      description: 'Parcelas/duplicatas da fatura (seção FATURA/DUPLICATAS do DANFE). Vazio se à vista.',
      items: {
        type: 'object',
        required: ['data', 'valor'],
        properties: { data: { type: 'string', description: 'AAAA-MM-DD' }, valor: { type: 'number' } },
      },
    },
    observacoes: { ...texto, description: 'Avisos curtos em português sobre o que não deu para ler com segurança' },
  },
}

const INSTRUCOES = `Você é um assistente de lançamento de compras de uma hamburgueria no Brasil.
A imagem/PDF é uma nota de compra: DANFE de NF-e, cupom de NFC-e de supermercado, nota manual ou recibo.

Extraia os dados exatamente como impressos e responda SOMENTE com o JSON pedido:
- O EMITENTE é quem vendeu (topo da nota), não o destinatário.
- Liste TODOS os itens, na ordem, sem juntar nem pular nenhum. Descrição como está escrita.
- Números no padrão americano: "1.234,56" vira 1234.56; "0,850" kg vira 0.85.
- Use a quantidade e a unidade COMERCIAIS do item (as colunas QUANT/UN do DANFE).
- valor_total do item = valor do produto antes de descontos, como na coluna "V. TOTAL"/"V. PROD".
- Desconto, frete e outras despesas vêm do quadro "CÁLCULO DO IMPOSTO" do DANFE ou do rodapé do cupom.
- A chave de acesso tem 44 dígitos (impressa em blocos de 4 perto do código de barras). Só preencha se ler todos os dígitos.
- Vencimentos: só se houver parcelas/duplicatas impressas.
- NUNCA invente: se um campo não existir ou estiver ilegível, use null e explique em observacoes.
- Se a imagem não for uma nota de compra, devolva legivel=false, itens vazio e explique em observacoes.`

type Fetch = typeof fetch

// A API aceita o pedido de JSON em dois formatos (novo e antigo). Tenta o novo e, se recusar, o antigo.
function formatosDeSaida() {
  return [
    { responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: SCHEMA } } },
    { responseMimeType: 'application/json', responseJsonSchema: SCHEMA },
    { responseMimeType: 'application/json' }, // último recurso: o formato vai só nas instruções
  ]
}

export async function lerComGemini(
  arquivo: string, tipo: string, chave: string, modelos: string[], f: Fetch = fetch,
): Promise<{ status: number; corpo: unknown }> {
  const partes = [
    { inlineData: { mimeType: tipo, data: arquivo } },
    { text: 'Extraia os dados desta nota.' },
  ]
  let ultimoErro = { status: 502, corpo: { erro: 'Não foi possível ler a nota agora. Tente novamente.' } as unknown }

  for (const modelo of modelos) {
    for (const [i, saida] of formatosDeSaida().entries()) {
      const instr = i === 2 ? `${INSTRUCOES}\n\nFormato (JSON Schema):\n${JSON.stringify(SCHEMA)}` : INSTRUCOES
      const r = await f(`${API}/${modelo}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': chave },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: instr }] },
          contents: [{ role: 'user', parts: partes }],
          generationConfig: { temperature: 0, ...saida },
        }),
      })

      if (r.ok) {
        const dados = await r.json()
        const cand = dados.candidates?.[0]
        if (dados.promptFeedback?.blockReason || !cand) {
          return { status: 422, corpo: { erro: 'A leitura foi bloqueada pelo filtro do Google. Tente outra foto.' } }
        }
        if (cand.finishReason === 'MAX_TOKENS') {
          return { status: 422, corpo: { erro: 'Nota com itens demais para uma leitura. Divida em páginas/fotos.' } }
        }
        const txt = (cand.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('').trim()
        try {
          const nota = JSON.parse(txt.replace(/^```(?:json)?\s*|\s*```$/g, ''))
          return { status: 200, corpo: { nota, modelo, uso: dados.usageMetadata } }
        } catch {
          ultimoErro = { status: 422, corpo: { erro: 'A leitura não veio no formato esperado. Tente outra foto.' } }
          continue
        }
      }

      const detalhe = await r.text()
      console.error('Gemini', modelo, r.status, detalhe.slice(0, 500))
      // formato de saída não reconhecido por esta versão da API -> tenta o próximo formato
      if (r.status === 400 && /Unknown name|Invalid JSON payload|responseFormat|responseJsonSchema|schema/i.test(detalhe)) continue
      if (r.status === 400 && /API key not valid|API_KEY_INVALID/i.test(detalhe)) {
        return { status: 401, corpo: { erro: 'Chave do Gemini inválida (GEMINI_API_KEY).' } }
      }
      if (r.status === 403) return { status: 403, corpo: { erro: 'A chave do Gemini não tem permissão. Gere outra no Google AI Studio.' } }
      if (r.status === 429) {
        ultimoErro = { status: 429, corpo: { erro: 'Limite gratuito do Gemini atingido. Espere 1 minuto e tente de novo; se continuar, a cota do dia acabou — use o XML ou tente amanhã.' } }
        break // próximo modelo (reserva)
      }
      if (r.status === 404) {
        ultimoErro = { status: 502, corpo: { erro: `Modelo "${modelo}" não encontrado. Ajuste GEMINI_MODEL nos Secrets.` } }
        break
      }
      if (r.status >= 500) {
        ultimoErro = { status: 502, corpo: { erro: 'O Gemini está instável agora. Tente de novo em instantes.' } }
        break
      }
      ultimoErro = { status: 502, corpo: { erro: 'Não foi possível ler a nota agora. Tente novamente.' } }
      break
    }
  }
  return ultimoErro
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return resposta(405, { erro: 'Método não permitido' })

  const chave = Deno.env.get('GEMINI_API_KEY')
  if (!chave) {
    return resposta(501, { erro: 'Leitura por foto ainda não configurada: cadastre GEMINI_API_KEY nos Secrets das Edge Functions do Supabase (veja o README).' })
  }

  // Só gerente/admin
  const servico = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: quem } = await servico.auth.getUser(token)
  if (!quem?.user) return resposta(401, { erro: 'Sessão inválida. Entre novamente.' })
  const { data: perfil } = await servico.from('perfis').select('papel, ativo').eq('id', quem.user.id).maybeSingle()
  if (!perfil?.ativo || !['admin', 'gerente'].includes(perfil.papel)) return resposta(403, { erro: 'Só gerente ou admin pode importar notas.' })

  let corpo: { arquivo?: string; tipo?: string }
  try {
    corpo = await req.json()
  } catch {
    return resposta(400, { erro: 'Corpo inválido' })
  }
  const { arquivo, tipo } = corpo
  if (!arquivo || !tipo || !TIPOS.includes(tipo)) return resposta(400, { erro: 'Envie uma foto (JPG, PNG, WEBP) ou um PDF.' })
  if (arquivo.length * 0.75 > MAX_BYTES) return resposta(413, { erro: 'Arquivo muito grande (máx. 15 MB).' })

  const modelos = [
    Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash',
    Deno.env.get('GEMINI_MODEL_RESERVA') || 'gemini-3.5-flash-lite',
  ].filter((m, i, a) => m && a.indexOf(m) === i)

  const r = await lerComGemini(arquivo, tipo, chave, modelos)
  return resposta(r.status, r.corpo)
})
