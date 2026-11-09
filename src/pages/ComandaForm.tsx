import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { BuscaCliente, type ClienteResumo } from '../components/BuscaCliente'
import { Alerta, Botao, Campo, Entrada, EntradaValor, Modal, Opcoes, Selecao, useAvisos } from '../components/ui'
import { useAuth } from '../lib/auth'
import { useCadastros } from '../lib/cadastros'
import { brl, lerValor, NOME_MODALIDADE, NOME_STATUS, NOME_TURNO, pct, TURNOS, turnoAgora, valorParaCampo } from '../lib/format'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Comanda, ComandaInput, Modalidade, StatusComanda, Turno } from '../lib/types'

const TAXA_ENTREGA_PADRAO = '6,00'

/** Forma a mais num pagamento dividido (a 1ª forma fica com o restante) */
interface FormaExtra {
  forma_pagamento_id: number | null
  maquina_id: number | null
  valor: string
}

interface Estado {
  data: string
  turno: Turno | null
  numero: string
  numeroDigitado?: boolean
  codigo_externo: string
  cliente: ClienteResumo | null
  canal_id: number | null
  modalidade: Modalidade | null
  entregador_id: number | null
  valor_comanda: string
  taxa_entrega: string
  desconto: string
  valor_pago: string
  pagoEditado: boolean
  forma_pagamento_id: number | null
  maquina_id: number | null
  extras: FormaExtra[]
  status: StatusComanda
  observacao: string
  conferido: boolean
}

function deComanda(c: Comanda): Estado {
  return {
    data: c.data,
    turno: c.turno,
    numero: String(c.numero),
    codigo_externo: c.codigo_externo ?? '',
    cliente: null,
    canal_id: c.canal_id,
    modalidade: c.modalidade,
    entregador_id: c.entregador_id,
    valor_comanda: valorParaCampo(c.valor_comanda),
    taxa_entrega: valorParaCampo(c.taxa_entrega),
    desconto: valorParaCampo(c.desconto),
    valor_pago: valorParaCampo(c.valor_pago),
    pagoEditado: true,
    forma_pagamento_id: c.forma_pagamento_id,
    maquina_id: c.maquina_id,
    extras: [],
    status: c.status,
    observacao: c.observacao ?? '',
    conferido: c.conferido,
  }
}

function vazio(data: string, anterior?: Estado): Estado {
  return {
    data,
    turno: anterior?.turno ?? turnoAgora(),
    numero: '',
    codigo_externo: '',
    cliente: null,
    canal_id: anterior?.canal_id ?? null,
    modalidade: null,
    entregador_id: null,
    valor_comanda: '',
    taxa_entrega: '',
    desconto: '',
    valor_pago: '',
    pagoEditado: false,
    forma_pagamento_id: null,
    maquina_id: null,
    extras: [],
    status: 'recebido',
    observacao: '',
    conferido: false,
  }
}

export function ComandaForm({ aberto, aoFechar, aoSalvar, comanda, dataPadrao }: {
  aberto: boolean
  aoFechar: () => void
  aoSalvar: () => void
  comanda: Comanda | null
  dataPadrao: string
}) {
  const { pode } = useAuth()
  const cad = useCadastros()
  const { avisar, confirmar } = useAvisos()
  const gestor = pode('admin', 'gerente')
  const [f, setF] = useState<Estado>(() => vazio(dataPadrao))
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const set = <K extends keyof Estado>(k: K, v: Estado[K]) => setF((s) => ({ ...s, [k]: v }))

  // sugere o próximo nº livre do turno + plataforma (o usuário pode trocar)
  const buscarNumero = async (data: string, turno: Turno | null, canal: number | null) => {
    const { data: n } = await supabase.rpc('proximo_numero', { p_data: data, p_turno: turno, p_canal: canal })
    if (typeof n === 'number') setF((s) => (s.data === data && s.turno === turno && s.canal_id === canal && !s.numeroDigitado ? { ...s, numero: String(n) } : s))
  }

  useEffect(() => {
    if (!aberto) return
    setErro(null)
    if (comanda) {
      setF(deComanda(comanda))
      supabase.from('comanda_pagamentos').select('forma_pagamento_id, maquina_id, valor').eq('comanda_id', comanda.id).then(({ data }) => {
        const pg = ((data ?? []) as { forma_pagamento_id: number; maquina_id: number | null; valor: number }[])
          .sort((a, b) => Number(b.valor) - Number(a.valor))
        if (pg.length > 1) {
          setF((s) => ({
            ...s,
            forma_pagamento_id: pg[0].forma_pagamento_id,
            maquina_id: pg[0].maquina_id,
            extras: pg.slice(1).map((p) => ({ forma_pagamento_id: p.forma_pagamento_id, maquina_id: p.maquina_id, valor: valorParaCampo(Number(p.valor)) })),
          }))
        }
      })
      if (comanda.cliente_id) {
        supabase.from('clientes').select('id, nome, telefone, bairro').eq('id', comanda.cliente_id).maybeSingle()
          .then(({ data }) => data && setF((s) => ({ ...s, cliente: data as ClienteResumo })))
      }
    }
    else {
      const novo = vazio(dataPadrao)
      setF(novo)
      buscarNumero(dataPadrao, novo.turno, novo.canal_id)
    }
  }, [aberto, comanda, dataPadrao])

  const canal = cad.canais.find((c) => c.id === f.canal_id)
  const forma = cad.formas.find((x) => x.id === f.forma_pagamento_id)

  // Valor pago sugerido = comanda + entrega − desconto (enquanto o usuário não editar)
  const sugerido = lerValor(f.valor_comanda) + lerValor(f.taxa_entrega) - lerValor(f.desconto)
  useEffect(() => {
    if (!f.pagoEditado) setF((s) => ({ ...s, valor_pago: sugerido > 0 ? valorParaCampo(sugerido) : '' }))
  }, [sugerido, f.pagoEditado])

  const escolherCanal = (id: number) => {
    const c = cad.canais.find((x) => x.id === id)
    setF((s) => ({
      ...s,
      canal_id: id,
      modalidade: s.modalidade ?? (c?.marketplace ? 'delivery_plataforma' : null),
      forma_pagamento_id: s.forma_pagamento_id ?? (c?.marketplace ? cad.formas.find((x) => x.online)?.id ?? null : null),
    }))
    if (!comanda) buscarNumero(f.data, f.turno, id)
  }

  const escolherModalidade = (m: Modalidade) => {
    setF((s) => ({
      ...s,
      modalidade: m,
      entregador_id: m === 'delivery_proprio' ? s.entregador_id : null,
      taxa_entrega: m === 'delivery_proprio' && !s.taxa_entrega ? TAXA_ENTREGA_PADRAO : m === 'delivery_proprio' ? s.taxa_entrega : m === 'delivery_plataforma' ? s.taxa_entrega : '',
    }))
  }

  const escolherForma = (id: number) => {
    const fp = cad.formas.find((x) => x.id === id)
    setF((s) => ({
      ...s,
      forma_pagamento_id: id,
      maquina_id: fp?.aceita_maquina ? s.maquina_id ?? maquinaPadrao(id) : null,
    }))
  }

  // Sugere a última máquina usada para essa forma (Pix fica sem máquina por padrão)
  const maquinaPadrao = (formaId: number): number | null => {
    const fp = cad.formas.find((x) => x.id === formaId)
    if (!fp?.aceita_maquina || fp.nome === 'Pix') return null
    const disponiveis = cad.maquinas.filter((m) => m.ativo && cad.taxas.some((t) => t.maquina_id === m.id && t.forma_pagamento_id === formaId))
    let ultima: number | null = null
    try { ultima = Number(localStorage.getItem('tb_ultima_maquina')) || null } catch { /* sem storage */ }
    return disponiveis.find((m) => m.id === ultima)?.id ?? disponiveis[0]?.id ?? null
  }

  const pago = lerValor(f.valor_pago)
  const dividido = f.extras.length > 0
  const somaExtras = f.extras.reduce((s, x) => s + lerValor(x.valor), 0)
  const valorPrincipal = Math.round((pago - somaExtras) * 100) / 100
  const taxa = cad.taxaVigente(f.maquina_id, f.forma_pagamento_id, f.data)
  const taxaDe = (maq: number | null, forma: number | null, valor: number) => {
    const t = cad.taxaVigente(maq, forma, f.data)
    return t ? Math.round(valor * Number(t.taxa_pct) * 100) / 100 : 0
  }
  const valorTaxa = Math.round((taxaDe(f.maquina_id, f.forma_pagamento_id, valorPrincipal)
    + f.extras.reduce((s, x) => s + taxaDe(x.maquina_id, x.forma_pagamento_id, lerValor(x.valor)), 0)) * 100) / 100
  const diferenca = Math.round((sugerido - pago) * 100) / 100

  const maquinasDe = (formaId: number | null) =>
    cad.maquinas.filter((m) => m.ativo && cad.taxas.some((t) => t.maquina_id === m.id && t.forma_pagamento_id === formaId))
  const maquinasDaForma = useMemo(() => maquinasDe(f.forma_pagamento_id), [cad.maquinas, cad.taxas, f.forma_pagamento_id])  // eslint-disable-line react-hooks/exhaustive-deps

  const mudarExtra = (i: number, mud: Partial<FormaExtra>) =>
    setF((s) => ({ ...s, extras: s.extras.map((x, k) => (k === i ? { ...x, ...mud } : x)) }))
  const dividir = () => setF((s) => ({ ...s, extras: [...s.extras, { forma_pagamento_id: null, maquina_id: null, valor: '' }] }))

  const validar = (): string | null => {
    if (!f.data) return 'Informe a data.'
    if (!f.turno && (!comanda || comanda.turno)) return 'Escolha o turno (manhã, tarde ou noite).'
    if (!Number(f.numero)) return 'Informe o número da comanda.'
    if (!f.canal_id) return 'Escolha o canal.'
    if (!f.modalidade) return 'Escolha a modalidade (delivery, retirada, mesa…).'
    if (f.modalidade === 'delivery_proprio' && !f.entregador_id) return 'Escolha o entregador.'
    if (!lerValor(f.valor_comanda)) return 'Informe o valor da comanda.'
    if (f.status === 'recebido' && !f.forma_pagamento_id) return 'Escolha a forma de pagamento.'
    if (f.maquina_id && !taxa) return 'Essa máquina não tem taxa cadastrada para essa forma de pagamento.'
    for (const [i, x] of f.extras.entries()) {
      if (!x.forma_pagamento_id) return `Escolha a ${i + 2}ª forma de pagamento.`
      if (!lerValor(x.valor)) return `Informe o valor da ${i + 2}ª forma de pagamento.`
      if (x.maquina_id && !cad.taxaVigente(x.maquina_id, x.forma_pagamento_id, f.data)) return `A máquina da ${i + 2}ª forma não tem taxa cadastrada para essa forma.`
    }
    if (dividido && valorPrincipal <= 0) return `As outras formas somam ${brl(somaExtras)}, mais que o valor pago (${brl(pago)}).`
    return null
  }

  const salvar = async (continuar: boolean, e?: FormEvent) => {
    e?.preventDefault()
    const v = validar()
    if (v) return setErro(v)
    setErro(null)

    if (!canal?.marketplace && Math.abs(diferenca) >= 0.01 && f.status !== 'cancelado') {
      const ok = await confirmar({
        titulo: 'Valor pago diferente do esperado',
        texto: (
          <p>
            Comanda + entrega − desconto dá <strong>{brl(sugerido)}</strong>, mas o valor pago é <strong>{brl(pago)}</strong>{' '}
            (diferença de {brl(Math.abs(diferenca))}). Salvar mesmo assim?
          </p>
        ),
        confirmar: 'Salvar assim',
      })
      if (!ok) return
    }

    const dados: ComandaInput = {
      data: f.data,
      numero: Number(f.numero),
      turno: f.turno,
      codigo_externo: f.codigo_externo.trim() || null,
      cliente_id: f.cliente?.id ?? null,
      canal_id: f.canal_id!,
      modalidade: f.modalidade!,
      entregador_id: f.modalidade === 'delivery_proprio' ? f.entregador_id : null,
      valor_comanda: lerValor(f.valor_comanda),
      taxa_entrega: lerValor(f.taxa_entrega),
      desconto: lerValor(f.desconto),
      valor_pago: pago,
      forma_pagamento_id: f.forma_pagamento_id,
      maquina_id: forma?.aceita_maquina ? f.maquina_id : null,
      status: f.status,
      observacao: f.observacao.trim() || null,
      conferido: gestor ? f.conferido : comanda?.conferido ?? false,
    }

    const comMaquina = (formaId: number | null, maq: number | null) => (cad.formas.find((x) => x.id === formaId)?.aceita_maquina ? maq : null)
    const pagamentos = f.forma_pagamento_id
      ? [
          { forma_pagamento_id: f.forma_pagamento_id, maquina_id: comMaquina(f.forma_pagamento_id, f.maquina_id), valor: valorPrincipal },
          ...f.extras.map((x) => ({ forma_pagamento_id: x.forma_pagamento_id, maquina_id: comMaquina(x.forma_pagamento_id, x.maquina_id), valor: lerValor(x.valor) })),
        ].filter((p) => p.valor > 0)
      : []

    setSalvando(true)
    const { error } = await supabase.rpc('salvar_comanda', { p_id: comanda?.id ?? null, p_comanda: dados, p_pagamentos: pagamentos })
    setSalvando(false)

    if (error) return setErro(mensagemErro(error))
    if (dados.maquina_id) try { localStorage.setItem('tb_ultima_maquina', String(dados.maquina_id)) } catch { /* sem storage */ }
    avisar(comanda ? `Comanda ${dados.numero} atualizada.` : `Comanda ${dados.numero} lançada.`)
    aoSalvar()
    if (continuar && !comanda) {
      setF((s) => vazio(s.data, s))
      buscarNumero(f.data, f.turno, f.canal_id)
    } else {
      aoFechar()
    }
  }

  const excluir = async () => {
    if (!comanda) return
    const ok = await confirmar({
      titulo: `Excluir comanda ${comanda.numero}?`,
      texto: 'A exclusão fica registrada na auditoria. Para estornos, prefira mudar o status para "Cancelado".',
      confirmar: 'Excluir',
      perigo: true,
    })
    if (!ok) return
    const { error } = await supabase.from('comandas').delete().eq('id', comanda.id)
    if (error) return setErro(mensagemErro(error))
    avisar('Comanda excluída.', 'info')
    aoSalvar()
    aoFechar()
  }

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      gaveta
      titulo={comanda ? `Comanda ${comanda.numero}${comanda.turno ? ` · ${NOME_TURNO[comanda.turno]}` : ''}` : 'Nova comanda'}
      rodape={
        <>
          {comanda && gestor && <Botao variante="perigo" onClick={excluir} className="mr-auto">Excluir</Botao>}
          <Botao variante="fantasma" onClick={aoFechar}>Cancelar</Botao>
          {!comanda && <Botao onClick={() => salvar(true)} carregando={salvando}>Salvar e lançar outra</Botao>}
          <Botao variante="primario" onClick={() => salvar(false)} carregando={salvando}>Salvar</Botao>
        </>
      }
    >
      <form className="form-comanda" onSubmit={(e) => salvar(!comanda, e)}>
        {erro && <Alerta tom="erro">{erro}</Alerta>}

        <div className="grade-3">
          <Campo rotulo="Data">
            <Entrada type="date" value={f.data} onChange={(e) => { set('data', e.target.value); if (!comanda) buscarNumero(e.target.value, f.turno, f.canal_id) }} />
          </Campo>
          <Campo rotulo="Nº comanda" dica={comanda ? 'Pode corrigir' : 'Sugerido: próximo do turno e da plataforma — pode trocar'}>
            <Entrada inputMode="numeric" value={f.numero} aria-label="Nº comanda" onFocus={(e) => e.target.select()}
              onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setF((s) => ({ ...s, numero: v, numeroDigitado: v !== '' })) }} />
          </Campo>
          <Campo rotulo="Nº pedido na plataforma" dica={canal?.marketplace ? 'Ex.: 562006' : 'Opcional'}>
            <Entrada value={f.codigo_externo} onChange={(e) => set('codigo_externo', e.target.value)} />
          </Campo>
        </div>

        <Campo rotulo="Turno" dica={comanda && !comanda.turno && !f.turno ? 'Comanda antiga, lançada sem turno' : undefined}>
          <Opcoes nome="Turno" valor={f.turno} aoMudar={(t) => { set('turno', t); if (!comanda) buscarNumero(f.data, t, f.canal_id) }}
            opcoes={TURNOS.map((t) => ({ valor: t, rotulo: NOME_TURNO[t] }))} />
        </Campo>

        <Campo rotulo="Cliente">
          <BuscaCliente valor={f.cliente} aoMudar={(c) => set('cliente', c)} />
        </Campo>

        <Campo rotulo="Canal">
          <Opcoes nome="Canal" valor={f.canal_id} aoMudar={escolherCanal}
            opcoes={cad.canais.filter((c) => c.ativo || c.id === f.canal_id).map((c) => ({ valor: c.id, rotulo: c.nome }))} />
        </Campo>

        <Campo rotulo="Modalidade">
          <Opcoes nome="Modalidade" valor={f.modalidade} aoMudar={escolherModalidade}
            opcoes={(Object.keys(NOME_MODALIDADE) as Modalidade[]).map((m) => ({ valor: m, rotulo: NOME_MODALIDADE[m] }))} />
        </Campo>

        {f.modalidade === 'delivery_proprio' && (
          <Campo rotulo="Entregador">
            <Opcoes nome="Entregador" valor={f.entregador_id} aoMudar={(v) => set('entregador_id', v)}
              opcoes={cad.entregadores.filter((e) => e.ativo || e.id === f.entregador_id).map((e) => ({ valor: e.id, rotulo: e.nome }))} />
          </Campo>
        )}

        <div className="grade-4">
          <Campo rotulo="Valor da comanda">
            <EntradaValor valor={f.valor_comanda} aoMudar={(v) => set('valor_comanda', v)} />
          </Campo>
          <Campo rotulo="Taxa de entrega">
            <EntradaValor valor={f.taxa_entrega} aoMudar={(v) => set('taxa_entrega', v)} />
          </Campo>
          <Campo rotulo="Desconto">
            <EntradaValor valor={f.desconto} aoMudar={(v) => set('desconto', v)} />
          </Campo>
          <Campo rotulo="Valor pago" dica={f.pagoEditado ? <button type="button" className="link" onClick={() => set('pagoEditado', false)}>usar {brl(sugerido)}</button> : 'calculado'}>
            <EntradaValor valor={f.valor_pago} aoMudar={(v) => setF((s) => ({ ...s, valor_pago: v, pagoEditado: true }))} />
          </Campo>
        </div>

        <Campo rotulo={dividido ? `1ª forma de pagamento · ${brl(valorPrincipal)} (o restante)` : 'Forma de pagamento'}>
          <Opcoes nome="Forma de pagamento" valor={f.forma_pagamento_id} aoMudar={escolherForma}
            opcoes={cad.formas.filter((x) => x.ativo || x.id === f.forma_pagamento_id).map((x) => ({ valor: x.id, rotulo: x.nome }))} />
        </Campo>

        {forma?.aceita_maquina && (
          <Campo rotulo="Maquininha" dica={forma.nome === 'Pix' ? 'Deixe "Pix direto" quando for na chave da loja' : undefined}>
            <Opcoes nome="Maquininha" valor={f.maquina_id ?? 0} aoMudar={(v) => set('maquina_id', v || null)}
              opcoes={[{ valor: 0, rotulo: forma.nome === 'Pix' ? 'Pix direto' : 'Sem máquina' }, ...maquinasDaForma.map((m) => ({ valor: m.id, rotulo: m.nome }))]} />
          </Campo>
        )}

        {f.extras.map((x, i) => {
          const fx = cad.formas.find((y) => y.id === x.forma_pagamento_id)
          return (
            <div className="forma-extra" key={i}>
              <Campo rotulo={`${i + 2}ª forma`}>
                <Selecao value={x.forma_pagamento_id ?? ''} aria-label={`${i + 2}ª forma`}
                  onChange={(e) => { const id = Number(e.target.value) || null; mudarExtra(i, { forma_pagamento_id: id, maquina_id: id ? maquinaPadrao(id) : null }) }}>
                  <option value="">Escolha…</option>
                  {cad.formas.filter((y) => y.ativo || y.id === x.forma_pagamento_id).map((y) => <option key={y.id} value={y.id}>{y.nome}</option>)}
                </Selecao>
              </Campo>
              {fx?.aceita_maquina ? (
                <Campo rotulo="Máquina">
                  <Selecao value={x.maquina_id ?? 0} aria-label={`Máquina da ${i + 2}ª forma`} onChange={(e) => mudarExtra(i, { maquina_id: Number(e.target.value) || null })}>
                    <option value={0}>{fx.nome === 'Pix' ? 'Pix direto' : 'Sem máquina'}</option>
                    {maquinasDe(fx.id).map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                  </Selecao>
                </Campo>
              ) : <div />}
              <Campo rotulo="Valor">
                <EntradaValor valor={x.valor} aoMudar={(v) => mudarExtra(i, { valor: v })} aria-label={`Valor da ${i + 2}ª forma`} />
              </Campo>
              <button type="button" className="btn btn-fantasma btn-icone" title="Tirar esta forma" aria-label={`Tirar a ${i + 2}ª forma`}
                onClick={() => setF((s) => ({ ...s, extras: s.extras.filter((_, k) => k !== i) }))}>✕</button>
            </div>
          )
        })}
        {f.forma_pagamento_id && f.status !== 'pendente' && (
          <div className="dividir-linha">
            <button type="button" className="link" onClick={dividir}>+ {dividido ? 'Mais uma forma' : 'Dividir com outra forma (ex.: parte no Pix, parte em dinheiro)'}</button>
            {dividido && (
              <span className={valorPrincipal <= 0 ? 'neg' : 'campo-dica'}>
                {[{ n: cad.nomeForma(f.forma_pagamento_id), v: valorPrincipal }, ...f.extras.map((x) => ({ n: x.forma_pagamento_id ? cad.nomeForma(x.forma_pagamento_id) : '?', v: lerValor(x.valor) }))]
                  .map((p) => `${p.n} ${brl(p.v)}`).join(' + ')} = {brl(pago)}
              </span>
            )}
          </div>
        )}

        <div className="resumo-comanda">
          <div><span>Taxa da máquina</span><strong>{dividido ? (valorTaxa ? brl(valorTaxa) : '—') : taxa ? `${pct(taxa.taxa_pct)} · ${brl(valorTaxa)}` : '—'}</strong></div>
          <div><span>Líquido</span><strong>{brl(f.status === 'cancelado' ? 0 : pago - valorTaxa)}</strong></div>
          <div>
            <span>{canal?.marketplace ? 'Comissão plataforma' : 'Diferença'}</span>
            <strong className={!canal?.marketplace && Math.abs(diferenca) >= 0.01 ? 'neg' : ''}>{brl(diferenca)}</strong>
          </div>
        </div>

        <div className="grade-2">
          <Campo rotulo="Status">
            <Selecao value={f.status} onChange={(e) => set('status', e.target.value as StatusComanda)}>
              {(Object.keys(NOME_STATUS) as StatusComanda[]).map((s) => <option key={s} value={s}>{NOME_STATUS[s]}</option>)}
            </Selecao>
          </Campo>
          {gestor && (
            <label className="check">
              <input type="checkbox" checked={f.conferido} onChange={(e) => set('conferido', e.target.checked)} />
              Conferido
            </label>
          )}
        </div>

        <Campo rotulo="Observação">
          <textarea className="entrada" rows={2} value={f.observacao} onChange={(e) => set('observacao', e.target.value)} />
        </Campo>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
