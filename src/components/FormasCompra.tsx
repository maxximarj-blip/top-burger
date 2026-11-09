import { brl, lerValor } from '../lib/format'
import { Campo, EntradaValor, Selecao } from './ui'

export interface ParteForma { forma: string; valor: string }

/** Formas de pagamento da compra: a 1ª fica com o restante do total. */
export function montarFormas(total: number, forma: string, extras: ParteForma[]) {
  const somaExtras = extras.reduce((s, x) => s + lerValor(x.valor), 0)
  const principal = Math.round((total - somaExtras) * 100) / 100
  const pagamentos = forma
    ? [{ forma, valor: principal }, ...extras.map((x) => ({ forma: x.forma, valor: lerValor(x.valor) }))].filter((p) => p.valor > 0)
    : []
  return { principal, somaExtras, pagamentos, dinheiro: pagamentos.filter((p) => p.forma === 'Dinheiro').reduce((s, p) => s + p.valor, 0) }
}

export function validarFormas(total: number, forma: string, extras: ParteForma[]): string | null {
  if (!extras.length) return null
  if (!forma) return 'Escolha a 1ª forma de pagamento.'
  for (const [i, x] of extras.entries()) {
    if (!x.forma) return `Escolha a ${i + 2}ª forma de pagamento.`
    if (!lerValor(x.valor)) return `Informe o valor da ${i + 2}ª forma de pagamento.`
  }
  const { principal, somaExtras } = montarFormas(total, forma, extras)
  if (principal <= 0) return `As outras formas somam ${brl(somaExtras)}, mais que o total da compra (${brl(total)}).`
  return null
}

export function FormasCompra({ formas, total, forma, aoMudarForma, extras, aoMudarExtras, rotulo = 'Forma de pagamento' }: {
  formas: string[]
  total: number
  forma: string
  aoMudarForma: (f: string) => void
  extras: ParteForma[]
  aoMudarExtras: (e: ParteForma[]) => void
  rotulo?: string
}) {
  const { principal } = montarFormas(total, forma, extras)
  const dividido = extras.length > 0
  const mudar = (i: number, m: Partial<ParteForma>) => aoMudarExtras(extras.map((x, k) => (k === i ? { ...x, ...m } : x)))
  return (
    <div className="formas-compra">
      <Campo rotulo={dividido ? `1ª forma · ${brl(principal)} (o restante)` : rotulo}>
        <Selecao value={forma} onChange={(e) => aoMudarForma(e.target.value)} aria-label="Forma de pagamento">
          <option value="">—</option>
          {formas.map((f) => <option key={f}>{f}</option>)}
        </Selecao>
      </Campo>
      {extras.map((x, i) => (
        <div className="forma-extra forma-extra-compra" key={i}>
          <Campo rotulo={`${i + 2}ª forma`}>
            <Selecao value={x.forma} onChange={(e) => mudar(i, { forma: e.target.value })} aria-label={`${i + 2}ª forma`}>
              <option value="">Escolha…</option>
              {formas.map((f) => <option key={f}>{f}</option>)}
            </Selecao>
          </Campo>
          <Campo rotulo="Valor">
            <EntradaValor valor={x.valor} aoMudar={(v) => mudar(i, { valor: v })} aria-label={`Valor da ${i + 2}ª forma`} />
          </Campo>
          <button type="button" className="btn btn-fantasma btn-icone" aria-label={`Tirar a ${i + 2}ª forma`} title="Tirar esta forma"
            onClick={() => aoMudarExtras(extras.filter((_, k) => k !== i))}>✕</button>
        </div>
      ))}
      {forma && (
        <div className="dividir-linha">
          <button type="button" className="link" onClick={() => aoMudarExtras([...extras, { forma: '', valor: '' }])}>
            + {dividido ? 'Mais uma forma' : 'Dividir com outra forma (ex.: parte no Pix, parte em dinheiro)'}
          </button>
          {dividido && (
            <span className={principal <= 0 ? 'neg' : 'campo-dica'}>
              {[{ f: forma, v: principal }, ...extras.map((x) => ({ f: x.forma || '?', v: lerValor(x.valor) }))].map((p) => `${p.f} ${brl(p.v)}`).join(' + ')} = {brl(total)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
