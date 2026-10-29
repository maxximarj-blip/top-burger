import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configurado = Boolean(url && key)

export const supabase = createClient(url || 'https://nao-configurado.supabase.co', key || 'nao-configurado', {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

/** Converte erros do Postgres/Supabase em mensagens legíveis */
export function mensagemErro(e: unknown): string {
  const err = e as { message?: string; code?: string; details?: string } | null
  const msg = err?.message || String(e)
  if (err?.code === '23505') return 'Já existe um registro com esses dados (ex.: mesmo nº de comanda no mesmo dia).'
  if (err?.code === '23503') return 'Esse registro está em uso e não pode ser removido. Desative-o em vez de excluir.'
  if (err?.code === '42501' || /row-level security/i.test(msg)) return 'Você não tem permissão para essa ação.'
  if (/compras_chave_nfe_uk/.test(msg)) return 'Esta nota já foi lançada em outra compra.'
  if (/fornecedor_informado/.test(msg)) return 'Informe o fornecedor (escolha um cadastrado ou digite o nome).'
  if (/vencimento_a_pagar/.test(msg)) return 'Compra a pagar precisa de data de vencimento.'
  if (err?.code === '23514') return 'Algum valor está fora do permitido (ex.: quantidade zerada ou valor negativo).'
  if (/Invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.'
  if (/Email not confirmed/i.test(msg)) return 'E-mail ainda não confirmado.'
  if (/Failed to fetch/i.test(msg)) return 'Sem conexão com o servidor. Verifique a internet.'
  return msg
}

/** Busca todas as linhas de uma consulta paginando de 1000 em 1000 (limite padrão do Supabase) */
export async function buscarTudo<T>(
  montar: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const passo = 1000
  const tudo: T[] = []
  for (let de = 0; ; de += passo) {
    const { data, error } = await montar(de, de + passo - 1)
    if (error) throw error
    tudo.push(...(data ?? []))
    if (!data || data.length < passo) break
  }
  return tudo
}
