import { fimMes, hoje, inicioMes, somarDias } from '../lib/format'

export interface Intervalo {
  inicio: string
  fim: string
}

const ATALHOS: { rotulo: string; calc: () => Intervalo }[] = [
  { rotulo: 'Hoje', calc: () => ({ inicio: hoje(), fim: hoje() }) },
  { rotulo: 'Ontem', calc: () => ({ inicio: somarDias(hoje(), -1), fim: somarDias(hoje(), -1) }) },
  { rotulo: '7 dias', calc: () => ({ inicio: somarDias(hoje(), -6), fim: hoje() }) },
  { rotulo: 'Este mês', calc: () => ({ inicio: inicioMes(hoje()), fim: fimMes(hoje()) }) },
  { rotulo: 'Mês passado', calc: () => ({ inicio: inicioMes(hoje(), -1), fim: fimMes(hoje(), -1) }) },
]

export function Periodo({ valor, aoMudar }: { valor: Intervalo; aoMudar: (v: Intervalo) => void }) {
  return (
    <div className="periodo">
      <div className="periodo-atalhos">
        {ATALHOS.map((a) => {
          const v = a.calc()
          const ativo = v.inicio === valor.inicio && v.fim === valor.fim
          return (
            <button key={a.rotulo} type="button" className={ativo ? 'ativo' : ''} onClick={() => aoMudar(v)}>
              {a.rotulo}
            </button>
          )
        })}
      </div>
      <div className="periodo-datas">
        <input
          type="date"
          className="entrada"
          value={valor.inicio}
          max={valor.fim}
          onChange={(e) => e.target.value && aoMudar({ ...valor, inicio: e.target.value })}
          aria-label="Data inicial"
        />
        <span>até</span>
        <input
          type="date"
          className="entrada"
          value={valor.fim}
          min={valor.inicio}
          onChange={(e) => e.target.value && aoMudar({ ...valor, fim: e.target.value })}
          aria-label="Data final"
        />
      </div>
    </div>
  )
}

/** Navegação de um dia: ‹ data › */
export function SeletorDia({ valor, aoMudar }: { valor: string; aoMudar: (v: string) => void }) {
  return (
    <div className="seletor-dia">
      <button type="button" className="btn btn-fantasma btn-icone" onClick={() => aoMudar(somarDias(valor, -1))} aria-label="Dia anterior">‹</button>
      <input type="date" className="entrada" value={valor} onChange={(e) => e.target.value && aoMudar(e.target.value)} />
      <button type="button" className="btn btn-fantasma btn-icone" onClick={() => aoMudar(somarDias(valor, 1))} aria-label="Próximo dia">›</button>
      {valor !== hoje() && (
        <button type="button" className="btn btn-fantasma" onClick={() => aoMudar(hoje())}>Hoje</button>
      )}
    </div>
  )
}
