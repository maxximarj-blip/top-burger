// Edge Function: administração de usuários (só admin).
// Usa a SERVICE ROLE KEY, que nunca vai para o navegador — fica só aqui, no servidor.
//
// Deploy:  supabase functions deploy admin-usuarios
// (SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY já vêm configuradas no Supabase)

import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PAPEIS = ['admin', 'gerente', 'caixa']

function resposta(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return resposta(405, { erro: 'Método não permitido' })

  const url = Deno.env.get('SUPABASE_URL')!
  const servico = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  // 1) Quem está chamando? Precisa ser admin ativo.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: quem, error: errUser } = await servico.auth.getUser(token)
  if (errUser || !quem.user) return resposta(401, { erro: 'Sessão inválida. Entre novamente.' })

  const { data: perfil } = await servico.from('perfis').select('papel, ativo').eq('id', quem.user.id).maybeSingle()
  if (!perfil?.ativo || perfil.papel !== 'admin') return resposta(403, { erro: 'Só administradores podem gerenciar usuários.' })

  let corpo: Record<string, string>
  try {
    corpo = await req.json()
  } catch {
    return resposta(400, { erro: 'Corpo inválido' })
  }

  // 2) Ações
  if (corpo.acao === 'criar') {
    const { email, senha, nome, papel } = corpo
    if (!email || !nome) return resposta(400, { erro: 'Informe nome e e-mail.' })
    if (!senha || senha.length < 8) return resposta(400, { erro: 'Senha com no mínimo 8 caracteres.' })
    if (!PAPEIS.includes(papel)) return resposta(400, { erro: 'Perfil inválido.' })

    const { data, error } = await servico.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password: senha,
      email_confirm: true,
      user_metadata: { nome, papel },
    })
    if (error) {
      const msg = /already|registered|exists/i.test(error.message) ? 'Já existe um usuário com esse e-mail.' : error.message
      return resposta(400, { erro: msg })
    }
    // o gatilho do banco cria o perfil; garante nome/papel certos
    await servico.from('perfis').update({ nome, papel }).eq('id', data.user.id)
    return resposta(200, { id: data.user.id })
  }

  if (corpo.acao === 'senha') {
    const { id, senha } = corpo
    if (!id || !senha || senha.length < 8) return resposta(400, { erro: 'Senha com no mínimo 8 caracteres.' })
    const { error } = await servico.auth.admin.updateUserById(id, { password: senha })
    if (error) return resposta(400, { erro: error.message })
    return resposta(200, { ok: true })
  }

  return resposta(400, { erro: 'Ação desconhecida' })
})
