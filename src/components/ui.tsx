import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes,
} from 'react'

// ---------- Botões e campos ----------
type Variante = 'primario' | 'secundario' | 'fantasma' | 'perigo'

export function Botao({
  variante = 'secundario', carregando, children, className = '', ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; carregando?: boolean }) {
  return (
    <button className={`btn btn-${variante} ${className}`} disabled={carregando || props.disabled} {...props}>
      {carregando && <span className="spinner" aria-hidden />}
      {children}
    </button>
  )
}

export function Campo({ rotulo, dica, erro, children, className = '' }: {
  rotulo: string; dica?: ReactNode; erro?: string; children: ReactNode; className?: string
}) {
  return (
    <label className={`campo ${className}`}>
      <span className="campo-rotulo">{rotulo}</span>
      {children}
      {erro ? <span className="campo-erro">{erro}</span> : dica ? <span className="campo-dica">{dica}</span> : null}
    </label>
  )
}

export function Entrada(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="entrada" {...props} />
}

export function Selecao({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className="entrada" {...props}>
      {children}
    </select>
  )
}

/** Campo de dinheiro em formato BR */
export function EntradaValor({ valor, aoMudar, ...props }: {
  valor: string; aoMudar: (v: string) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <div className="entrada-valor">
      <span>R$</span>
      <input
        className="entrada"
        inputMode="decimal"
        value={valor}
        onChange={(e) => aoMudar(e.target.value.replace(/[^\d,.]/g, ''))}
        onFocus={(e) => e.target.select()}
        placeholder="0,00"
        {...props}
      />
    </div>
  )
}

/** Grupo de botões de escolha única (mais rápido que select no caixa) */
export function Opcoes<T extends string | number>({ opcoes, valor, aoMudar, nome }: {
  opcoes: { valor: T; rotulo: string }[]; valor: T | null; aoMudar: (v: T) => void; nome: string
}) {
  return (
    <div className="opcoes" role="radiogroup" aria-label={nome}>
      {opcoes.map((o) => (
        <button
          type="button"
          key={String(o.valor)}
          role="radio"
          aria-checked={valor === o.valor}
          className={valor === o.valor ? 'ativo' : ''}
          onClick={() => aoMudar(o.valor)}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  )
}

export function Selo({ tom = 'neutro', children }: { tom?: 'neutro' | 'ok' | 'alerta' | 'erro' | 'info'; children: ReactNode }) {
  return <span className={`selo selo-${tom}`}>{children}</span>
}

// ---------- Estrutura ----------
export function Cartao({ titulo, acoes, children, className = '' }: {
  titulo?: ReactNode; acoes?: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <section className={`cartao ${className}`}>
      {(titulo || acoes) && (
        <header className="cartao-topo">
          {titulo && <h2>{titulo}</h2>}
          {acoes && <div className="cartao-acoes">{acoes}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export function Kpi({ rotulo, valor, detalhe, destaque }: {
  rotulo: string; valor: ReactNode; detalhe?: ReactNode; destaque?: boolean
}) {
  return (
    <div className={`kpi ${destaque ? 'kpi-destaque' : ''}`}>
      <span className="kpi-rotulo">{rotulo}</span>
      <strong className="kpi-valor">{valor}</strong>
      {detalhe && <span className="kpi-detalhe">{detalhe}</span>}
    </div>
  )
}

export function Cabecalho({ titulo, subtitulo, acoes }: { titulo: string; subtitulo?: ReactNode; acoes?: ReactNode }) {
  return (
    <div className="cabecalho">
      <div>
        <h1>{titulo}</h1>
        {subtitulo && <p>{subtitulo}</p>}
      </div>
      {acoes && <div className="cabecalho-acoes">{acoes}</div>}
    </div>
  )
}

export function Vazio({ children }: { children: ReactNode }) {
  return <div className="vazio">{children}</div>
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <div className="carregando">
      <span className="spinner" /> {texto}
    </div>
  )
}

export function Alerta({ tom = 'alerta', children }: { tom?: 'alerta' | 'erro' | 'info' | 'ok'; children: ReactNode }) {
  return <div className={`alerta alerta-${tom}`}>{children}</div>
}

// ---------- Modal / gaveta ----------
export function Modal({ aberto, aoFechar, titulo, children, rodape, largo, gaveta }: {
  aberto: boolean; aoFechar: () => void; titulo: ReactNode; children: ReactNode
  rodape?: ReactNode; largo?: boolean; gaveta?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!aberto) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && aoFechar()
    document.addEventListener('keydown', esc)
    document.body.style.overflow = 'hidden'
    setTimeout(() => ref.current?.querySelector<HTMLElement>('input, select, textarea')?.focus(), 30)
    return () => {
      document.removeEventListener('keydown', esc)
      document.body.style.overflow = ''
    }
  }, [aberto, aoFechar])
  if (!aberto) return null
  return (
    <div className={`modal-fundo ${gaveta ? 'modal-gaveta' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <div className={`modal ${largo ? 'modal-largo' : ''}`} role="dialog" aria-modal ref={ref}>
        <header className="modal-topo">
          <h2>{titulo}</h2>
          <button className="btn btn-fantasma btn-icone" onClick={aoFechar} aria-label="Fechar">✕</button>
        </header>
        <div className="modal-corpo">{children}</div>
        {rodape && <footer className="modal-rodape">{rodape}</footer>}
      </div>
    </div>
  )
}

// ---------- Avisos (toasts) e confirmação ----------
type Aviso = { id: number; texto: string; tom: 'ok' | 'erro' | 'info' }
type Confirmacao = { titulo: string; texto: ReactNode; confirmar: string; perigo?: boolean; resolver: (v: boolean) => void }

const AvisoCtx = createContext<{
  avisar: (texto: string, tom?: Aviso['tom']) => void
  confirmar: (o: Omit<Confirmacao, 'resolver'>) => Promise<boolean>
} | null>(null)

export function AvisosProvider({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [conf, setConf] = useState<Confirmacao | null>(null)

  const avisar = useCallback((texto: string, tom: Aviso['tom'] = 'ok') => {
    const id = Date.now() + Math.random()
    setAvisos((a) => [...a, { id, texto, tom }])
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), tom === 'erro' ? 7000 : 3500)
  }, [])

  const confirmar = useCallback(
    (o: Omit<Confirmacao, 'resolver'>) => new Promise<boolean>((resolver) => setConf({ ...o, resolver })),
    [],
  )

  const responder = (v: boolean) => {
    conf?.resolver(v)
    setConf(null)
  }

  return (
    <AvisoCtx.Provider value={{ avisar, confirmar }}>
      {children}
      <div className="avisos" aria-live="polite">
        {avisos.map((a) => (
          <div key={a.id} className={`aviso aviso-${a.tom}`}>{a.texto}</div>
        ))}
      </div>
      <Modal
        aberto={!!conf}
        aoFechar={() => responder(false)}
        titulo={conf?.titulo}
        rodape={
          <>
            <Botao variante="fantasma" onClick={() => responder(false)}>Cancelar</Botao>
            <Botao variante={conf?.perigo ? 'perigo' : 'primario'} onClick={() => responder(true)} autoFocus>
              {conf?.confirmar}
            </Botao>
          </>
        }
      >
        {conf?.texto}
      </Modal>
    </AvisoCtx.Provider>
  )
}

export function useAvisos() {
  const c = useContext(AvisoCtx)
  if (!c) throw new Error('useAvisos fora do provider')
  return c
}
