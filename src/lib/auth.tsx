import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { mensagemErro, supabase } from './supabase'
import type { Papel, Perfil } from './types'

interface AuthCtx {
  carregando: boolean
  sessao: Session | null
  perfil: Perfil | null
  erroPerfil: string | null
  recuperandoSenha: boolean
  entrar: (email: string, senha: string) => Promise<void>
  sair: () => Promise<void>
  pode: (...papeis: Papel[]) => boolean
  concluirRecuperacao: () => void
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [carregando, setCarregando] = useState(true)
  const [sessao, setSessao] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [erroPerfil, setErroPerfil] = useState<string | null>(null)
  const [recuperandoSenha, setRecuperando] = useState(
    () => new URLSearchParams(window.location.search).has('recuperar'),
  )

  const carregarPerfil = useCallback(async (s: Session | null) => {
    setErroPerfil(null)
    if (!s) {
      setPerfil(null)
      return
    }
    const { data, error } = await supabase.from('perfis').select('*').eq('id', s.user.id).maybeSingle()
    if (error) {
      setErroPerfil(mensagemErro(error))
      setPerfil(null)
    } else if (!data) {
      setErroPerfil('Seu usuário não tem perfil cadastrado. Fale com o administrador.')
      setPerfil(null)
    } else if (!data.ativo) {
      setErroPerfil('Seu acesso está desativado. Fale com o administrador.')
      setPerfil(null)
      await supabase.auth.signOut()
    } else {
      setPerfil(data as Perfil)
    }
  }, [])

  useEffect(() => {
    let ativo = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!ativo) return
      setSessao(data.session)
      await carregarPerfil(data.session)
      setCarregando(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((evento, s) => {
      if (evento === 'PASSWORD_RECOVERY') setRecuperando(true)
      setSessao(s)
      if (evento === 'SIGNED_IN' || evento === 'SIGNED_OUT' || evento === 'USER_UPDATED') {
        // evita deadlock do supabase-js: não aguardar consultas dentro do callback
        setTimeout(() => carregarPerfil(s), 0)
      }
    })
    return () => {
      ativo = false
      sub.subscription.unsubscribe()
    }
  }, [carregarPerfil])

  const entrar = async (email: string, senha: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha })
    if (error) throw new Error(mensagemErro(error))
  }

  const sair = async () => {
    await supabase.auth.signOut()
    setPerfil(null)
  }

  const pode = (...papeis: Papel[]) => Boolean(perfil && papeis.includes(perfil.papel))

  const concluirRecuperacao = () => {
    setRecuperando(false)
    const url = new URL(window.location.href)
    url.searchParams.delete('recuperar')
    window.history.replaceState(null, '', url.toString())
  }

  return (
    <Ctx.Provider
      value={{ carregando, sessao, perfil, erroPerfil, recuperandoSenha, entrar, sair, pode, concluirRecuperacao }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth fora do AuthProvider')
  return c
}
