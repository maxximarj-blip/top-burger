import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { BuscaCliente, type ClienteResumo } from '../components/BuscaCliente'
import { Alerta, Botao, Campo, Entrada, EntradaValor, Modal, Opcoes, Selecao, useAvisos } from '../components/ui'
import { useAuth } from '../lib/auth'
import { useCadastros } from '../lib/cadastros'
import { brl, lerValor, NOME_MODALIDADE, NOME_STATUS, pct, valorParaCampo } from '../lib/format'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Comanda, ComandaInput, Modalidade, StatusComanda } from '../lib/types'

const TAXA_ENTREGA_PADRAO = '6,00'

interface Estado {
  data: string
  numero: string
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
  status: StatusComanda
  observacao: string
  conferido: boolean
}

function deComanda(c: Comanda): Estado {
  return {
    data: c.data,
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
    status: c.status,
    observacao: c.observacao ?? '',
    conferido: c.conferido,
  }
}

function vazio(data: string, anterior?: Estado): Estado {
  return {
    data,
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

  const buscarNumero = async (data: string) => {
    const { data: n } = await supabase.rpc('proximo_numero', { p_data: data })
    if (typeof n === 'number') setF((s) => (s.data === data ? { ...s, numero: String(n) } : s))
  }

  useEffect(() => {
    if (!aberto) return
    setErro(null)
    if (comanda) {
      setF(deComanda(comanda))
      if (comanda.cliente_id) {
        supabase.from('clientes').select('id, nome, telefone, bairro').eq('id', comanda.cliente_id).maybeSingle()
          .then(({ data }) => data && setF((s) => ({ ...s, cliente: data as ClienteResumo })))
      }
    }
    else {
      setF(vazio(dataPadrao))
      buscarNumero(dataPadrao)
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

  const taxa = cad.taxaVigente(f.maquina_id, f.forma_pagamento_id, f.data)
  const pago = lerValor(f.valor_pago)
  const valorTaxa = taxa ? Math.round(pago * Number(taxa.taxa_pct) * 100) / 100 : 0
  const diferenca = Math.round((sugerido - pago) * 100) / 100

  const maquinasDaForma = useMemo(
    () => cad.maquinas.filter((m) => m.ativo && cad.taxas.some((t) => t.maquina_id === m.id && t.forma_pagamento_id === f.forma_pagamento_id)),
    [cad.maquinas, cad.taxas, f.forma_pagamento_id],
  )

  const validar = (): string | null => {
    if (!f.data) return 'Informe a data.'
    if (!Number(f.numero)) return 'Informe o número da comanda.'
    if (!f.canal_id) return 'Escolha o canal.'
    if (!f.modalidade) return 'Escolha a modalidade (delivery, retirada, mesa…).'
    if (f.modalidade === 'delivery_proprio' && !f.entregador_id) return 'Escolha o entregador.'
    if (!lerValor(f.valor_comanda)) return 'Informe o valor da comanda.'
    if (f.status === 'recebido' && !f.forma_pagamento_id) return 'Escolha a forma de pagamento.'
    if (f.maquina_id && !taxa) return 'Essa máquina não tem taxa cadastrada para essa forma de pagamento.'
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

    setSalvando(true)
    const { error } = comanda
      ? await supabase.from('comandas').update(dados).eq('id', comanda.id)
      : await supabase.from('comandas').insert(dados)
    setSalvando(false)

    if (error) return setErro(mensagemErro(error))
    if (dados.maquina_id) try { localStorage.setItem('tb_ultima_maquina', String(dados.maquina_id)) } catch { /* sem storage */ }
    avisar(comanda ? `Comanda ${dados.numero} atualizada.` : `Comanda ${dados.numero} lançada.`)
    aoSalvar()
    if (continuar && !comanda) {
      setF((s) => vazio(s.data, s))
      buscarNumero(f.data)
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
      titulo={comanda ? `Comanda ${comanda.numero}` : 'Nova comanda'}
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
            <Entrada type="date" value={f.data} onChange={(e) => { set('data', e.target.value); if (!comanda) buscarNumero(e.target.value) }} />
          </Campo>
          <Campo rotulo="Nº comanda">
            <Entrada inputMode="numeric" value={f.numero} onChange={(e) => set('numero', e.target.value.replace(/\D/g, ''))} />
          </Campo>
          <Campo rotulo="Nº pedido na plataforma" dica={canal?.marketplace ? 'Ex.: 562006' : 'Opcional'}>
            <Entrada value={f.codigo_externo} onChange={(e) => set('codigo_externo', e.target.value)} />
          </Campo>
        </div>

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

        <Campo rotulo="Forma de pagamento">
          <Opcoes nome="Forma de pagamento" valor={f.forma_pagamento_id} aoMudar={escolherForma}
            opcoes={cad.formas.filter((x) => x.ativo || x.id === f.forma_pagamento_id).map((x) => ({ valor: x.id, rotulo: x.nome }))} />
        </Campo>

        {forma?.aceita_maquina && (
          <Campo rotulo="Maquininha" dica={forma.nome === 'Pix' ? 'Deixe "Pix direto" quando for na chave da loja' : undefined}>
            <Opcoes nome="Maquininha" valor={f.maquina_id ?? 0} aoMudar={(v) => set('maquina_id', v || null)}
              opcoes={[{ valor: 0, rotulo: forma.nome === 'Pix' ? 'Pix direto' : 'Sem máquina' }, ...maquinasDaForma.map((m) => ({ valor: m.id, rotulo: m.nome }))]} />
          </Campo>
        )}

        <div className="resumo-comanda">
          <div><span>Taxa da máquina</span><strong>{taxa ? `${pct(taxa.taxa_pct)} · ${brl(valorTaxa)}` : '—'}</strong></div>
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
