import { useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { NOME_PAPEL } from '../lib/format'
import type { Papel } from '../lib/types'
import { MinhaConta } from '../pages/MinhaConta'

const I = {
  painel: <path d="M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-18v6h8V3z" />,
  comandas: <path d="M7 3h10a2 2 0 0 1 2 2v16l-3-2-2 2-2-2-2 2-2-2-3 2V5a2 2 0 0 1 2-2zm1 5h8M8 12h8M8 16h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  caixa: <path d="M3 7h18v12H3zM3 11h18M7 15h3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  moto: <path d="M5 17a3 3 0 1 0 0-.01M19 17a3 3 0 1 0 0-.01M8 17h7l3-6h-4l-2-4H9M14 11l-4 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  calendario: <path d="M4 6h16v14H4zM4 10h16M8 3v5M16 3v5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  config: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" fill="none" stroke="currentColor" strokeWidth="1.8" />,
  usuarios: <path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm13 9v-1a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  historico: <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
}

const MENU: { para: string; rotulo: string; icone: ReactNode; papeis: Papel[] }[] = [
  { para: '/', rotulo: 'Painel', icone: I.painel, papeis: ['admin', 'gerente', 'caixa'] },
  { para: '/comandas', rotulo: 'Comandas', icone: I.comandas, papeis: ['admin', 'gerente', 'caixa'] },
  { para: '/caixa', rotulo: 'Fechamento de caixa', icone: I.caixa, papeis: ['admin', 'gerente', 'caixa'] },
  { para: '/entregadores', rotulo: 'Entregadores', icone: I.moto, papeis: ['admin', 'gerente'] },
  { para: '/recebiveis', rotulo: 'Recebíveis', icone: I.calendario, papeis: ['admin', 'gerente'] },
  { para: '/cadastros', rotulo: 'Cadastros', icone: I.config, papeis: ['admin', 'gerente'] },
  { para: '/usuarios', rotulo: 'Usuários', icone: I.usuarios, papeis: ['admin'] },
  { para: '/auditoria', rotulo: 'Auditoria', icone: I.historico, papeis: ['admin'] },
]

export function Layout() {
  const { perfil, sair, pode } = useAuth()
  const [menuAberto, setMenuAberto] = useState(false)
  const [conta, setConta] = useState(false)
  const local = useLocation()
  const atual = MENU.find((m) => (m.para === '/' ? local.pathname === '/' : local.pathname.startsWith(m.para)))

  return (
    <div className={`app ${menuAberto ? 'menu-aberto' : ''}`}>
      <aside className="lateral">
        <div className="marca">
          <img src="./favicon.svg" alt="" width={34} height={34} />
          <div>
            <strong>Top Burguer</strong>
            <span>Gestão</span>
          </div>
        </div>
        <nav>
          {MENU.filter((m) => pode(...m.papeis)).map((m) => (
            <NavLink key={m.para} to={m.para} end={m.para === '/'} onClick={() => setMenuAberto(false)}>
              <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden>{m.icone}</svg>
              {m.rotulo}
            </NavLink>
          ))}
        </nav>
        <div className="usuario">
          <button className="usuario-info" onClick={() => setConta(true)} title="Minha conta">
            <span className="avatar">{perfil?.nome.slice(0, 1).toUpperCase()}</span>
            <span>
              <strong>{perfil?.nome}</strong>
              <small>{perfil && NOME_PAPEL[perfil.papel]}</small>
            </span>
          </button>
          <button className="btn btn-fantasma" onClick={sair}>Sair</button>
        </div>
      </aside>
      <div className="fundo-menu" onClick={() => setMenuAberto(false)} />
      <main className="conteudo">
        <header className="topo-movel">
          <button className="btn btn-fantasma btn-icone" onClick={() => setMenuAberto(true)} aria-label="Abrir menu">☰</button>
          <strong>{atual?.rotulo ?? 'Top Burguer'}</strong>
          <span />
        </header>
        <Outlet />
      </main>
      <MinhaConta aberto={conta} aoFechar={() => setConta(false)} />
    </div>
  )
}
