import type { ReactNode } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Carregando } from './components/ui'
import { useAuth } from './lib/auth'
import { CadastrosProvider } from './lib/cadastros'
import { configurado } from './lib/supabase'
import type { Papel } from './lib/types'
import { Auditoria } from './pages/Auditoria'
import { Cadastros } from './pages/Cadastros'
import { Comandas } from './pages/Comandas'
import { Entregadores } from './pages/Entregadores'
import { Fechamento } from './pages/Fechamento'
import { Login, RedefinirSenha } from './pages/Login'
import { Painel } from './pages/Painel'
import { Recebiveis } from './pages/Recebiveis'
import { Usuarios } from './pages/Usuarios'

function Restrito({ papeis, children }: { papeis: Papel[]; children: ReactNode }) {
  const { pode } = useAuth()
  return pode(...papeis) ? <>{children}</> : <Navigate to="/" replace />
}

export default function App() {
  const { carregando, sessao, perfil, recuperandoSenha } = useAuth()

  if (!configurado) {
    return (
      <div className="tela-login">
        <div className="login-cartao">
          <h1>Configuração pendente</h1>
          <p>
            Defina <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> (arquivo <code>.env.local</code> ou
            secrets do GitHub). Veja o README.
          </p>
        </div>
      </div>
    )
  }

  if (carregando) return <Carregando texto="Abrindo o sistema…" />
  if (recuperandoSenha && sessao) return <RedefinirSenha />
  if (!sessao || !perfil) return <Login />

  return (
    <CadastrosProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Painel />} />
            <Route path="comandas" element={<Comandas />} />
            <Route path="caixa" element={<Fechamento />} />
            <Route path="entregadores" element={<Restrito papeis={['admin', 'gerente']}><Entregadores /></Restrito>} />
            <Route path="recebiveis" element={<Restrito papeis={['admin', 'gerente']}><Recebiveis /></Restrito>} />
            <Route path="cadastros" element={<Restrito papeis={['admin', 'gerente']}><Cadastros /></Restrito>} />
            <Route path="usuarios" element={<Restrito papeis={['admin']}><Usuarios /></Restrito>} />
            <Route path="auditoria" element={<Restrito papeis={['admin']}><Auditoria /></Restrito>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </CadastrosProvider>
  )
}
