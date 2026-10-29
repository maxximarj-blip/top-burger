// Edge Function: lê a foto ou o PDF de uma nota fiscal com a API do Claude
// e devolve os dados estruturados (fornecedor, itens, totais, vencimentos).
//
// Configuração (uma vez):
//   1. Crie uma chave em https://platform.claude.com (API Keys) e coloque crédito na conta.
//   2. Supabase > Edge Functions > Secrets: ANTHROPIC_API_KEY = sua chave
//      (opcional) CLAUDE_MODEL = claude-sonnet-5-5  (padrão)
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

const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
const MAX_BYTES = 12 * 1024 * 1024

const texto = { anyOf: [{ type: 'string' }, { type: 'null' }] }
const numero = { anyOf: [{ type: 'number' }, { type: 'null' }] }

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
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
      additionalProperties: false,
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
        additionalProperties: false,
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
        additionalProperties: false,
        required: ['data', 'valor'],
        properties: { data: { type: 'string', description: 'AAAA-MM-DD' }, valor: { type: 'number' } },
      },
    },
    observacoes: { ...texto, description: 'Avisos curtos em português sobre o que não deu para ler com segurança' },
  },
}

const INSTRUCOES = `Você é um assistente de lançamento de compras de uma hamburgueria no Brasil.
A imagem/PDF é uma nota de compra: DANFE de NF-e, cupom de NFC-e de supermercado, nota manual ou recibo.

Extraia os dados exatamente como impressos:
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return resposta(405, { erro: 'Método não permitido' })

  const chaveApi = Deno.env.get('ANTHROPIC_API_KEY')
  if (!chaveApi) {
    return resposta(501, { erro: 'Leitura por foto ainda não configurada: cadastre ANTHROPIC_API_KEY nos Secrets das Edge Functions do Supabase (veja o README).' })
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
  if (arquivo.length * 0.75 > MAX_BYTES) return resposta(413, { erro: 'Arquivo muito grande (máx. 12 MB).' })

  const bloco = tipo === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: tipo, data: arquivo } }
    : { type: 'image', source: { type: 'base64', media_type: tipo, data: arquivo } }

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': chaveApi, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: Deno.env.get('CLAUDE_MODEL') || 'claude-sonnet-5-5',
      max_tokens: 8000,
      system: INSTRUCOES,
      messages: [{ role: 'user', content: [bloco, { type: 'text', text: 'Extraia os dados desta nota.' }] }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    }),
  })

  if (!r.ok) {
    const detalhe = await r.text()
    console.error('Erro da API', r.status, detalhe)
    const msg = r.status === 401 ? 'Chave da API inválida (ANTHROPIC_API_KEY).'
      : r.status === 429 ? 'Muitas leituras ao mesmo tempo. Tente de novo em instantes.'
      : /credit|billing/i.test(detalhe) ? 'Sem crédito na conta da API. Adicione créditos no console.'
      : 'Não foi possível ler a nota agora. Tente novamente.'
    return resposta(502, { erro: msg })
  }

  const dados = await r.json()
  if (dados.stop_reason === 'max_tokens') return resposta(422, { erro: 'Nota com itens demais para uma leitura. Divida em páginas/fotos.' })
  const bloco_texto = (dados.content ?? []).find((c: { type: string }) => c.type === 'text')
  try {
    const nota = JSON.parse(bloco_texto?.text ?? '')
    return resposta(200, { nota, uso: dados.usage })
  } catch {
    return resposta(422, { erro: 'A leitura não veio no formato esperado. Tente outra foto.' })
  }
})
