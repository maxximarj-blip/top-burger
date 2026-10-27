import { useState } from 'react'
import { Alerta, Botao, Cabecalho, Campo, Cartao, Entrada, Modal, Selecao, Selo, useAvisos } from '../components/ui'
import { useCadastros } from '../lib/cadastros'
import { dataBR, hoje, pct } from '../lib/format'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Canal, Entregador, FormaPagamento, Maquina } from '../lib/types'

type Aba = 'canais' | 'formas' | 'maquinas' | 'entregadores'

export function Cadastros() {
  const [aba, setAba] = useState<Aba>('maquinas')
  return (
    <div className="pagina">
      <Cabecalho titulo="Cadastros" subtitulo="Listas usadas no lançamento das comandas" />
      <div className="abas">
        {([['maquinas', 'Máquinas e taxas'], ['entregadores', 'Entregadores'], ['canais', 'Canais'], ['formas', 'Formas de pagamento']] as [Aba, string][]).map(([v, r]) => (
          <button key={v} className={aba === v ? 'ativo' : ''} onClick={() => setAba(v)}>{r}</button>
        ))}
      </div>
      {aba === 'maquinas' && <Maquinas />}
      {aba === 'entregadores' && <ListaEntregadores />}
      {aba === 'canais' && <Canais />}
      {aba === 'formas' && <Formas />}
    </div>
  )
}

function useSalvar() {
  const { recarregar } = useCadastros()
  const { avisar } = useAvisos()
  return async (op: PromiseLike<{ error: unknown }>, ok = 'Salvo.') => {
    const { error } = await op
    if (error) {
      avisar(mensagemErro(error), 'erro')
      return false
    }
    avisar(ok)
    await recarregar()
    return true
  }
}

function Ativo({ ativo, aoMudar }: { ativo: boolean; aoMudar: () => void }) {
  return (
    <button className="link" onClick={aoMudar} title={ativo ? 'Clique para desativar' : 'Clique para ativar'}>
      <Selo tom={ativo ? 'ok' : 'neutro'}>{ativo ? 'Ativo' : 'Inativo'}</Selo>
    </button>
  )
}

// ---------------- Máquinas e taxas ----------------
function Maquinas() {
  const { maquinas, formas, taxas } = useCadastros()
  const salvar = useSalvar()
  const [novaMaq, setNovaMaq] = useState('')
  const [taxaModal, setTaxaModal] = useState<{ maquina: Maquina } | null>(null)

  return (
    <>
      <Alerta tom="info">
        Mudou a taxa da maquininha? <strong>Não edite a antiga</strong> — adicione uma nova com a data de início. As vendas antigas
        continuam com a taxa da época e as novas já pegam a nova.
      </Alerta>
      {maquinas.map((m) => {
        const minhas = taxas.filter((t) => t.maquina_id === m.id)
        const formasComTaxa = [...new Set(minhas.map((t) => t.forma_pagamento_id))]
        return (
          <Cartao key={m.id} titulo={<>{m.nome} <Ativo ativo={m.ativo} aoMudar={() => salvar(supabase.from('maquinas').update({ ativo: !m.ativo }).eq('id', m.id))} /></>}
            acoes={<Botao onClick={() => setTaxaModal({ maquina: m })}>+ Taxa</Botao>} className="sem-padding">
            <table className="tabela">
              <thead><tr><th>Forma</th><th className="n">Taxa vigente</th><th className="n">Repasse</th><th>Desde</th><th>Histórico</th></tr></thead>
              <tbody>
                {formasComTaxa.length === 0 && <tr><td colSpan={5} className="vazio">Nenhuma taxa cadastrada.</td></tr>}
                {formasComTaxa.map((fid) => {
                  const hist = minhas.filter((t) => t.forma_pagamento_id === fid).sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde))
                  const vig = hist.find((t) => t.vigente_desde <= hoje()) ?? hist[hist.length - 1]
                  return (
                    <tr key={fid}>
                      <td className="forte">{formas.find((x) => x.id === fid)?.nome}</td>
                      <td className="n">{pct(vig.taxa_pct)}</td>
                      <td className="n">{vig.repasse_dias_uteis === 0 ? 'Na hora' : `${vig.repasse_dias_uteis} dia(s) útil(eis)`}</td>
                      <td>{vig.vigente_desde <= '2000-01-01' ? 'sempre' : dataBR(vig.vigente_desde)}</td>
                      <td className="campo-dica">
                        {hist.filter((t) => t.id !== vig.id).map((t) => `${pct(t.taxa_pct)} ${t.vigente_desde > hoje() ? 'a partir de' : 'até'} ${dataBR(t.vigente_desde)}`).join(' · ') || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Cartao>
        )
      })}
      <Cartao titulo="Nova máquina">
        <div className="linha-form">
          <Entrada placeholder="Ex.: Stone, Cielo…" value={novaMaq} onChange={(e) => setNovaMaq(e.target.value)} />
          <Botao variante="primario" disabled={!novaMaq.trim()} onClick={async () => {
            if (await salvar(supabase.from('maquinas').insert({ nome: novaMaq.trim() }), 'Máquina cadastrada.')) setNovaMaq('')
          }}>Adicionar</Botao>
        </div>
      </Cartao>
      {taxaModal && <NovaTaxa maquina={taxaModal.maquina} formas={formas.filter((f) => f.aceita_maquina)} aoFechar={() => setTaxaModal(null)} />}
    </>
  )
}

function NovaTaxa({ maquina, formas, aoFechar }: { maquina: Maquina; formas: FormaPagamento[]; aoFechar: () => void }) {
  const salvar = useSalvar()
  const [forma, setForma] = useState(formas[0]?.id ?? 0)
  const [taxa, setTaxa] = useState('')
  const [dias, setDias] = useState('0')
  const [desde, setDesde] = useState(hoje())
  const [erro, setErro] = useState<string | null>(null)

  const ok = async () => {
    const t = Number(taxa.replace(',', '.'))
    if (!forma) return setErro('Escolha a forma.')
    if (!Number.isFinite(t) || t < 0 || t >= 100) return setErro('Taxa inválida (use %, ex.: 2,99).')
    if (await salvar(supabase.from('maquina_taxas').insert({
      maquina_id: maquina.id, forma_pagamento_id: forma, taxa_pct: Math.round(t * 1000) / 100000,
      repasse_dias_uteis: Number(dias) || 0, vigente_desde: desde,
    }), 'Taxa cadastrada.')) aoFechar()
  }

  return (
    <Modal aberto aoFechar={aoFechar} titulo={`Nova taxa · ${maquina.nome}`}
      rodape={<><Botao variante="fantasma" onClick={aoFechar}>Cancelar</Botao><Botao variante="primario" onClick={ok}>Salvar</Botao></>}>
      {erro && <Alerta tom="erro">{erro}</Alerta>}
      <Campo rotulo="Forma de pagamento">
        <Selecao value={forma} onChange={(e) => setForma(Number(e.target.value))}>
          {formas.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
        </Selecao>
      </Campo>
      <div className="grade-3">
        <Campo rotulo="Taxa (%)"><Entrada inputMode="decimal" placeholder="2,99" value={taxa} onChange={(e) => setTaxa(e.target.value)} /></Campo>
        <Campo rotulo="Repasse (dias úteis)" dica="0 = na hora"><Entrada type="number" min={0} value={dias} onChange={(e) => setDias(e.target.value)} /></Campo>
        <Campo rotulo="Vale a partir de"><Entrada type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></Campo>
      </div>
    </Modal>
  )
}

// ---------------- Entregadores ----------------
function ListaEntregadores() {
  const { entregadores } = useCadastros()
  const salvar = useSalvar()
  const [edit, setEdit] = useState<Partial<Entregador> | null>(null)

  return (
    <Cartao className="sem-padding" titulo="Entregadores" acoes={<Botao variante="primario" onClick={() => setEdit({ nome: '', ativo: true })}>+ Entregador</Botao>}>
      <table className="tabela">
        <thead><tr><th>Nome</th><th>Telefone</th><th>Chave Pix</th><th>Situação</th><th /></tr></thead>
        <tbody>
          {entregadores.map((e) => (
            <tr key={e.id}>
              <td className="forte">{e.nome}</td><td>{e.telefone || '—'}</td><td>{e.pix || '—'}</td>
              <td><Ativo ativo={e.ativo} aoMudar={() => salvar(supabase.from('entregadores').update({ ativo: !e.ativo }).eq('id', e.id))} /></td>
              <td className="n"><button className="link" onClick={() => setEdit(e)}>editar</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {edit && (
        <Modal aberto aoFechar={() => setEdit(null)} titulo={edit.id ? 'Editar entregador' : 'Novo entregador'}
          rodape={<Botao variante="primario" disabled={!edit.nome?.trim()} onClick={async () => {
            const d = { nome: edit.nome!.trim(), telefone: edit.telefone || null, pix: edit.pix || null }
            const op = edit.id ? supabase.from('entregadores').update(d).eq('id', edit.id) : supabase.from('entregadores').insert(d)
            if (await salvar(op)) setEdit(null)
          }}>Salvar</Botao>}>
          <Campo rotulo="Nome"><Entrada value={edit.nome ?? ''} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} /></Campo>
          <div className="grade-2">
            <Campo rotulo="Telefone"><Entrada value={edit.telefone ?? ''} onChange={(e) => setEdit({ ...edit, telefone: e.target.value })} /></Campo>
            <Campo rotulo="Chave Pix"><Entrada value={edit.pix ?? ''} onChange={(e) => setEdit({ ...edit, pix: e.target.value })} /></Campo>
          </div>
        </Modal>
      )}
    </Cartao>
  )
}

// ---------------- Canais ----------------
function Canais() {
  const { canais } = useCadastros()
  const salvar = useSalvar()
  const [edit, setEdit] = useState<Partial<Canal> | null>(null)

  return (
    <Cartao className="sem-padding" titulo="Canais de venda" acoes={<Botao variante="primario" onClick={() => setEdit({ nome: '', marketplace: false, ordem: canais.length + 1 })}>+ Canal</Botao>}>
      <table className="tabela">
        <thead><tr><th>Canal</th><th>Tipo</th><th className="n">Ordem</th><th>Situação</th><th /></tr></thead>
        <tbody>
          {canais.map((c) => (
            <tr key={c.id}>
              <td className="forte">{c.nome}</td>
              <td>{c.marketplace ? 'Plataforma (cobra comissão)' : 'Próprio'}</td>
              <td className="n">{c.ordem}</td>
              <td><Ativo ativo={c.ativo} aoMudar={() => salvar(supabase.from('canais').update({ ativo: !c.ativo }).eq('id', c.id))} /></td>
              <td className="n"><button className="link" onClick={() => setEdit(c)}>editar</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {edit && (
        <Modal aberto aoFechar={() => setEdit(null)} titulo={edit.id ? 'Editar canal' : 'Novo canal'}
          rodape={<Botao variante="primario" disabled={!edit.nome?.trim()} onClick={async () => {
            const d = { nome: edit.nome!.trim(), marketplace: !!edit.marketplace, ordem: Number(edit.ordem) || 0 }
            const op = edit.id ? supabase.from('canais').update(d).eq('id', edit.id) : supabase.from('canais').insert(d)
            if (await salvar(op)) setEdit(null)
          }}>Salvar</Botao>}>
          <div className="grade-2">
            <Campo rotulo="Nome"><Entrada value={edit.nome ?? ''} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} /></Campo>
            <Campo rotulo="Ordem"><Entrada type="number" value={edit.ordem ?? 0} onChange={(e) => setEdit({ ...edit, ordem: Number(e.target.value) })} /></Campo>
          </div>
          <label className="check"><input type="checkbox" checked={!!edit.marketplace} onChange={(e) => setEdit({ ...edit, marketplace: e.target.checked })} /> É plataforma (99, iFood…) — o valor pago é o repasse, já descontada a comissão</label>
        </Modal>
      )}
    </Cartao>
  )
}

// ---------------- Formas ----------------
function Formas() {
  const { formas } = useCadastros()
  const salvar = useSalvar()
  const [edit, setEdit] = useState<Partial<FormaPagamento> | null>(null)

  return (
    <Cartao className="sem-padding" titulo="Formas de pagamento" acoes={<Botao variante="primario" onClick={() => setEdit({ nome: '', online: false, aceita_maquina: false, ordem: formas.length + 1 })}>+ Forma</Botao>}>
      <table className="tabela">
        <thead><tr><th>Forma</th><th>Online na plataforma</th><th>Passa na máquina</th><th className="n">Ordem</th><th>Situação</th><th /></tr></thead>
        <tbody>
          {formas.map((f) => (
            <tr key={f.id}>
              <td className="forte">{f.nome}</td><td>{f.online ? 'Sim' : '—'}</td><td>{f.aceita_maquina ? 'Sim' : '—'}</td><td className="n">{f.ordem}</td>
              <td><Ativo ativo={f.ativo} aoMudar={() => salvar(supabase.from('formas_pagamento').update({ ativo: !f.ativo }).eq('id', f.id))} /></td>
              <td className="n"><button className="link" onClick={() => setEdit(f)}>editar</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {edit && (
        <Modal aberto aoFechar={() => setEdit(null)} titulo={edit.id ? 'Editar forma' : 'Nova forma'}
          rodape={<Botao variante="primario" disabled={!edit.nome?.trim()} onClick={async () => {
            const d = { nome: edit.nome!.trim(), online: !!edit.online, aceita_maquina: !!edit.aceita_maquina, ordem: Number(edit.ordem) || 0 }
            const op = edit.id ? supabase.from('formas_pagamento').update(d).eq('id', edit.id) : supabase.from('formas_pagamento').insert(d)
            if (await salvar(op)) setEdit(null)
          }}>Salvar</Botao>}>
          {edit.id && <Alerta tom="info">O nome "Dinheiro" é usado no cálculo da gaveta — não renomeie essa forma.</Alerta>}
          <div className="grade-2">
            <Campo rotulo="Nome"><Entrada value={edit.nome ?? ''} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} /></Campo>
            <Campo rotulo="Ordem"><Entrada type="number" value={edit.ordem ?? 0} onChange={(e) => setEdit({ ...edit, ordem: Number(e.target.value) })} /></Campo>
          </div>
          <label className="check"><input type="checkbox" checked={!!edit.online} onChange={(e) => setEdit({ ...edit, online: e.target.checked })} /> Pago online dentro da plataforma</label>
          <label className="check"><input type="checkbox" checked={!!edit.aceita_maquina} onChange={(e) => setEdit({ ...edit, aceita_maquina: e.target.checked })} /> Pode ser passado em maquininha</label>
        </Modal>
      )}
    </Cartao>
  )
}
