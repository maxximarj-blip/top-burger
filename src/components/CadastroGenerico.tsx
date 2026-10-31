import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import { baixarCsv, brl, dataBR, lerValor, num } from '../lib/format'
import { buscarTudo, mensagemErro, supabase } from '../lib/supabase'
import type { Papel } from '../lib/types'
import { Alerta, Botao, Cabecalho, Campo, Cartao, Carregando, Entrada, EntradaValor, Modal, Selecao, Selo, useAvisos, Vazio } from './ui'

/**
 * Tela de cadastro reutilizável.
 * - modo "formulario": lista + janela de edição (clientes, fornecedores)
 * - modo "planilha":   edição direto na tabela, salvando em lote (produtos, insumos)
 */

export type TipoCampo = 'texto' | 'numero' | 'dinheiro' | 'select' | 'bool' | 'data' | 'textarea' | 'telefone' | 'documento'

export interface CampoDef {
  chave: string
  rotulo: string
  tipo: TipoCampo
  opcoes?: { valor: string | number; rotulo: string }[]
  /** permite digitar valor fora da lista (categorias) */
  livre?: boolean
  obrigatorio?: boolean
  naLista?: boolean
  noFormulario?: boolean
  dica?: string
  casas?: number
  largura?: number
  /** ocupa a linha inteira no formulário */
  inteiro?: boolean
}

export interface ColunaExtra {
  rotulo: string
  valor: (linha: Registro) => ReactNode
  numerica?: boolean
}

export type Registro = Record<string, unknown> & { id?: number }

interface Props {
  titulo: string
  subtitulo?: ReactNode
  tabela: string
  /** tabela/visão usada para ler (ex.: clientes_resumo) */
  leitura?: string
  campos: CampoDef[]
  modo: 'formulario' | 'planilha'
  ordem: { coluna: string; asc?: boolean }[]
  busca: string[]
  agruparPor?: string
  nomeItem: string
  papeisEdicao?: Papel[]
  papeisExclusao?: Papel[]
  novoPadrao?: Registro
  colunasExtras?: ColunaExtra[]
  destaque?: (linha: Registro) => 'alerta' | 'erro' | null
  resumo?: (linhas: Registro[]) => ReactNode
  topo?: ReactNode
  /** conteúdo do topo que depende dos registros carregados (ex.: mapa) */
  topoDados?: (linhas: Registro[], recarregar: () => void) => ReactNode
  /** bloco extra no formulário (ex.: localização) */
  extraFormulario?: (edit: Registro, mudar: (fn: (r: Registro) => Registro) => void) => ReactNode
  /** ajusta os dados antes de gravar (recebe o formulário inteiro) */
  antesDeSalvar?: (dados: Registro, edit: Registro) => Promise<Registro>
}

const vazioParaNull = (v: unknown) => (v === '' || v === undefined ? null : v)

function soDigitos(s: string) {
  return s.replace(/\D/g, '')
}

export function formatarTelefone(v: string) {
  const d = soDigitos(v).replace(/^55(?=\d{10,11}$)/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return v.trim()
}

export function formatarDocumento(v: string) {
  const d = soDigitos(v)
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  return v.trim()
}

function exibir(c: CampoDef, v: unknown): ReactNode {
  if (v == null || v === '') return <span className="tenue">—</span>
  switch (c.tipo) {
    case 'dinheiro': return brl(Number(v))
    case 'numero': return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: c.casas ?? 3 })
    case 'bool': return v ? 'Sim' : 'Não'
    case 'data': return dataBR(String(v))
    case 'select': return c.opcoes?.find((o) => String(o.valor) === String(v))?.rotulo ?? String(v)
    default: return String(v)
  }
}

/** Valor do registro -> texto do campo */
function paraCampo(c: CampoDef, v: unknown): string {
  if (v == null) return ''
  if (c.tipo === 'dinheiro') return Number(v) === 0 ? '' : Number(v).toFixed(2).replace('.', ',')
  if (c.tipo === 'numero') return String(Number(v)).replace('.', ',')
  return String(v)
}

/** Texto do campo -> valor gravado */
function deCampo(c: CampoDef, v: unknown): unknown {
  if (c.tipo === 'bool') return Boolean(v)
  if (typeof v !== 'string') return v ?? null
  if (c.tipo === 'dinheiro' || c.tipo === 'numero') return v.trim() === '' ? (c.tipo === 'dinheiro' ? 0 : null) : lerValor(v)
  if (c.tipo === 'telefone') return vazioParaNull(formatarTelefone(v))
  if (c.tipo === 'documento') return vazioParaNull(formatarDocumento(v))
  if (c.tipo === 'select' && c.opcoes && typeof c.opcoes[0]?.valor === 'number') return v === '' ? null : Number(v)
  return vazioParaNull(v.trim())
}

const NOVA_OPCAO = '__nova__'

/** Lista com as opções + "Nova…" para digitar uma que não existe (ex.: categorias). */
function SelecaoLivre({ c, txt, aoMudar }: { c: CampoDef; txt: string; aoMudar: (v: unknown) => void }) {
  const [digitando, setDigitando] = useState(false)
  const opcoes = (c.opcoes ?? []).map((o) => String(o.valor))
  if (txt && !opcoes.some((o) => o.toLowerCase() === txt.toLowerCase())) opcoes.push(txt)
  if (digitando)
    return (
      <Entrada
        autoFocus
        value={txt}
        placeholder={`Nova ${c.rotulo.toLowerCase()}`}
        onChange={(e) => aoMudar(e.target.value)}
        onBlur={() => setDigitando(false)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setDigitando(false) }}
        aria-label={c.rotulo}
      />
    )
  return (
    <Selecao
      value={txt}
      onChange={(e) => {
        if (e.target.value === NOVA_OPCAO) { setDigitando(true); aoMudar('') }
        else aoMudar(e.target.value)
      }}
      aria-label={c.rotulo}
    >
      {!txt && <option value="">{c.obrigatorio ? 'Escolha…' : '—'}</option>}
      {opcoes.map((o) => <option key={o} value={o}>{o}</option>)}
      <option value={NOVA_OPCAO}>+ Nova {c.rotulo.toLowerCase()}…</option>
    </Selecao>
  )
}

function EditorCampo({ c, valor, aoMudar, compacto }: { c: CampoDef; valor: unknown; aoMudar: (v: unknown) => void; compacto?: boolean }) {
  const txt = typeof valor === 'string' ? valor : paraCampo(c, valor)
  switch (c.tipo) {
    case 'bool':
      return <input type="checkbox" className="check-inline" checked={Boolean(valor)} onChange={(e) => aoMudar(e.target.checked)} aria-label={c.rotulo} />
    case 'dinheiro':
      return <EntradaValor valor={txt} aoMudar={aoMudar} aria-label={c.rotulo} />
    case 'numero':
      return <Entrada inputMode="decimal" value={txt} onChange={(e) => aoMudar(e.target.value.replace(/[^\d,.-]/g, ''))} className="entrada n" aria-label={c.rotulo} />
    case 'data':
      return <Entrada type="date" value={txt} onChange={(e) => aoMudar(e.target.value)} aria-label={c.rotulo} />
    case 'textarea':
      return compacto
        ? <Entrada value={txt} onChange={(e) => aoMudar(e.target.value)} aria-label={c.rotulo} />
        : <textarea className="entrada" rows={2} value={txt} onChange={(e) => aoMudar(e.target.value)} />
    case 'select':
      if (c.livre) return <SelecaoLivre c={c} txt={txt} aoMudar={aoMudar} />
      return (
        <Selecao value={txt} onChange={(e) => aoMudar(e.target.value)} aria-label={c.rotulo}>
          <option value="">{c.obrigatorio ? 'Escolha…' : '—'}</option>
          {c.opcoes?.map((o) => <option key={String(o.valor)} value={String(o.valor)}>{o.rotulo}</option>)}
        </Selecao>
      )
    default:
      return (
        <Entrada
          type={c.tipo === 'telefone' ? 'tel' : 'text'}
          value={txt}
          onChange={(e) => aoMudar(e.target.value)}
          onBlur={(e) => {
            if (c.tipo === 'telefone') aoMudar(formatarTelefone(e.target.value))
            if (c.tipo === 'documento') aoMudar(formatarDocumento(e.target.value))
          }}
          aria-label={c.rotulo}
        />
      )
  }
}

export function CadastroGenerico(p: Props) {
  const { pode } = useAuth()
  const { avisar, confirmar } = useAvisos()
  const podeEditar = pode(...(p.papeisEdicao ?? ['admin', 'gerente']))
  const podeExcluir = pode(...(p.papeisExclusao ?? ['admin', 'gerente']))

  const [linhas, setLinhas] = useState<Registro[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [grupo, setGrupo] = useState('')
  const [mostrarInativos, setMostrarInativos] = useState(false)

  // planilha: alterações pendentes por id (novas linhas usam id negativo)
  const [pendentes, setPendentes] = useState<Record<number, Registro>>({})
  const [novas, setNovas] = useState<Registro[]>([])
  const [salvando, setSalvando] = useState(false)

  // formulário
  const [edit, setEdit] = useState<Registro | null>(null)
  const [erroForm, setErroForm] = useState<string | null>(null)

  const camposLista = p.campos.filter((c) => c.naLista !== false)
  const camposForm = p.campos.filter((c) => c.noFormulario !== false)
  const temAtivo = p.campos.some((c) => c.chave === 'ativo')

  const ordemChave = JSON.stringify(p.ordem)
  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      const dados = await buscarTudo<Registro>((de, ate) => {
        let q = supabase.from(p.leitura ?? p.tabela).select('*')
        ;(JSON.parse(ordemChave) as Props['ordem']).forEach((o) => { q = q.order(o.coluna, { ascending: o.asc !== false }) })
        return q.range(de, ate)
      })
      setLinhas(dados)
      setErro(null)
    } catch (e) {
      setErro(mensagemErro(e))
    }
    setCarregando(false)
  }, [p.leitura, p.tabela, ordemChave])

  useEffect(() => {
    carregar()
  }, [carregar])

  const grupos = useMemo(() => {
    if (!p.agruparPor) return []
    return [...new Set(linhas.map((l) => String(l[p.agruparPor!] ?? '')).filter(Boolean))]
  }, [linhas, p.agruparPor])

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return linhas.filter((l) => {
      if (temAtivo && !mostrarInativos && l.ativo === false) return false
      if (grupo && String(l[p.agruparPor!] ?? '') !== grupo) return false
      if (t && !p.busca.some((k) => String(l[k] ?? '').toLowerCase().includes(t))) return false
      return true
    })
  }, [linhas, busca, grupo, mostrarInativos, temAtivo, p.busca, p.agruparPor])

  const validar = (r: Registro): string | null => {
    for (const c of p.campos) {
      if (c.obrigatorio && (r[c.chave] == null || r[c.chave] === '')) return `Preencha "${c.rotulo}".`
    }
    return null
  }

  const montar = (base: Registro, campos: CampoDef[]) => {
    const r: Registro = {}
    campos.forEach((c) => { if (c.chave in base) r[c.chave] = deCampo(c, base[c.chave]) })
    return r
  }

  // ---------------- Planilha ----------------
  const alterar = (linha: Registro, chave: string, valor: unknown) => {
    if (linha.id! < 0) {
      setNovas((ns) => ns.map((n) => (n.id === linha.id ? { ...n, [chave]: valor } : n)))
    } else {
      setPendentes((pd) => ({ ...pd, [linha.id!]: { ...(pd[linha.id!] ?? {}), [chave]: valor } }))
    }
  }

  const qtdPendentes = Object.keys(pendentes).length + novas.length

  const salvarPlanilha = async () => {
    setSalvando(true)
    let ok = 0
    const falhas: string[] = []
    for (const [id, mud] of Object.entries(pendentes)) {
      const campos = p.campos.filter((c) => c.chave in mud)
      const dados = montar(mud, campos)
      const original = linhas.find((l) => l.id === Number(id))!
      const v = validar({ ...original, ...dados })
      if (v) { falhas.push(`${original[p.campos[0].chave]}: ${v}`); continue }
      const { error } = await supabase.from(p.tabela).update(dados).eq('id', Number(id))
      if (error) falhas.push(`${original[p.campos[0].chave]}: ${mensagemErro(error)}`)
      else ok++
    }
    const novasRestantes: Registro[] = []
    for (const n of novas) {
      const dados = montar(n, p.campos)
      const v = validar(dados)
      if (v) { falhas.push(`Nova linha: ${v}`); novasRestantes.push(n); continue }
      const { error } = await supabase.from(p.tabela).insert(dados)
      if (error) { falhas.push(`${dados[p.campos[0].chave] ?? 'Nova linha'}: ${mensagemErro(error)}`); novasRestantes.push(n) }
      else ok++
    }
    setSalvando(false)
    setPendentes({})
    setNovas(novasRestantes)
    if (ok) avisar(`${ok} ${ok === 1 ? 'linha salva' : 'linhas salvas'}.`)
    if (falhas.length) avisar(falhas.slice(0, 3).join(' · '), 'erro')
    carregar()
  }

  const novaLinha = () => {
    setNovas((ns) => [{ id: -Date.now(), ...(p.novoPadrao ?? {}), ...(grupo && p.agruparPor ? { [p.agruparPor]: grupo } : {}) }, ...ns])
  }

  // ---------------- Formulário ----------------
  const salvarForm = async () => {
    if (!edit) return
    let dados = montar(edit, camposForm)
    const v = validar(dados)
    if (v) return setErroForm(v)
    setSalvando(true)
    if (p.antesDeSalvar) {
      try { dados = await p.antesDeSalvar(dados, edit) } catch { /* segue com os dados do formulário */ }
    }
    const { error } = edit.id
      ? await supabase.from(p.tabela).update(dados).eq('id', edit.id)
      : await supabase.from(p.tabela).insert(dados)
    setSalvando(false)
    if (error) return setErroForm(mensagemErro(error))
    avisar(edit.id ? `${p.nomeItem} atualizado.` : `${p.nomeItem} cadastrado.`)
    if (edit.id) setPendentes((pd) => { const r = { ...pd }; delete r[edit.id!]; return r })
    setEdit(null)
    carregar()
  }

  const excluir = async (r: Registro) => {
    const ok = await confirmar({
      titulo: `Excluir "${String(r[p.campos[0].chave])}"?`,
      texto: temAtivo ? 'Se ele já foi usado, prefira desativar (desmarcar "Ativo") — assim o histórico fica preservado.' : 'Essa ação fica registrada na auditoria.',
      confirmar: 'Excluir',
      perigo: true,
    })
    if (!ok) return
    const { error } = await supabase.from(p.tabela).delete().eq('id', r.id!)
    if (error) return avisar(mensagemErro(error), 'erro')
    avisar(`${p.nomeItem} excluído.`, 'info')
    setEdit(null)
    carregar()
  }

  const exportar = () => {
    const cols = [...camposLista, ...p.campos.filter((c) => c.naLista === false)]
    baixarCsv(`${p.tabela}.csv`, [
      [...cols.map((c) => c.rotulo), ...(p.colunasExtras ?? []).map((x) => x.rotulo)],
      ...filtradas.map((l) => [
        ...cols.map((c) => {
          const v = l[c.chave]
          if (c.tipo === 'dinheiro' || c.tipo === 'numero') return v == null ? null : Number(v)
          if (c.tipo === 'bool') return v ? 'Sim' : 'Não'
          if (c.tipo === 'select') return c.opcoes?.find((o) => String(o.valor) === String(v))?.rotulo ?? (v as string)
          return v as string
        }),
        ...(p.colunasExtras ?? []).map((x) => {
          const v = x.valor(l)
          return typeof v === 'string' || typeof v === 'number' ? v : ''
        }),
      ]),
    ])
  }

  const planilha = p.modo === 'planilha' && podeEditar
  const valorLinha = (l: Registro, chave: string) => (l.id! > 0 && pendentes[l.id!] && chave in pendentes[l.id!] ? pendentes[l.id!][chave] : l[chave])
  const linhaAtual = (l: Registro): Registro => {
    if (l.id! < 0) return { ...l, ...montar(l, p.campos) }
    return pendentes[l.id!] ? { ...l, ...montar(pendentes[l.id!], p.campos.filter((c) => c.chave in pendentes[l.id!])) } : l
  }

  return (
    <div className="pagina">
      <Cabecalho
        titulo={p.titulo}
        subtitulo={p.subtitulo}
        acoes={
          <>
            <Botao onClick={exportar} disabled={!filtradas.length}>Exportar CSV</Botao>
            {podeEditar && (
              <Botao variante="primario" onClick={() => (p.modo === 'planilha' ? novaLinha() : (setErroForm(null), setEdit({ ...(p.novoPadrao ?? {}) })))}>
                + {p.nomeItem}
              </Botao>
            )}
          </>
        }
      />

      {p.topo}
      {erro && <Alerta tom="erro">{erro}</Alerta>}
      {p.resumo && !carregando && p.resumo(linhas.filter((l) => l.ativo !== false))}
      {p.topoDados && (!carregando || linhas.length > 0) && p.topoDados(linhas, carregar)}

      <div className="barra-filtros">
        <Entrada className="entrada busca" placeholder="Buscar…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        {temAtivo && (
          <label className="check">
            <input type="checkbox" checked={mostrarInativos} onChange={(e) => setMostrarInativos(e.target.checked)} /> Mostrar inativos
          </label>
        )}
      </div>

      {grupos.length > 1 && (
        <div className="abas">
          <button className={grupo === '' ? 'ativo' : ''} onClick={() => setGrupo('')}>Todos ({linhas.filter((l) => mostrarInativos || l.ativo !== false).length})</button>
          {grupos.map((g) => (
            <button key={g} className={grupo === g ? 'ativo' : ''} onClick={() => setGrupo(g)}>
              {g} ({linhas.filter((l) => String(l[p.agruparPor!]) === g && (mostrarInativos || l.ativo !== false)).length})
            </button>
          ))}
        </div>
      )}

      {planilha && qtdPendentes > 0 && (
        <div className="barra-selecao">
          <span>{qtdPendentes} {qtdPendentes === 1 ? 'alteração não salva' : 'alterações não salvas'}</span>
          <Botao variante="primario" onClick={salvarPlanilha} carregando={salvando}>Salvar alterações</Botao>
          <Botao variante="fantasma" onClick={() => { setPendentes({}); setNovas([]) }}>Descartar</Botao>
        </div>
      )}

      <Cartao className="sem-padding">
        {carregando ? <Carregando /> : filtradas.length === 0 && novas.length === 0 ? (
          <Vazio>{linhas.length ? 'Nada encontrado com esses filtros.' : `Nenhum ${p.nomeItem.toLowerCase()} cadastrado ainda.`}</Vazio>
        ) : (
          <div className="rolagem">
            <table className={`tabela ${planilha ? 'tabela-planilha' : 'tabela-clicavel'}`}>
              <thead>
                <tr>
                  {planilha && <th className="col-editar" />}
                  {camposLista.map((c) => (
                    <th key={c.chave} className={['dinheiro', 'numero'].includes(c.tipo) ? 'n' : ''} style={c.largura ? { minWidth: c.largura } : undefined}>{c.rotulo}</th>
                  ))}
                  {p.colunasExtras?.map((x) => <th key={x.rotulo} className={x.numerica ? 'n' : ''}>{x.rotulo}</th>)}
                  {planilha && <th />}
                </tr>
              </thead>
              <tbody>
                {[...novas, ...filtradas].map((l) => {
                  const atual = linhaAtual(l)
                  const tom = p.destaque?.(atual)
                  const sujo = l.id! < 0 || Boolean(pendentes[l.id!])
                  return (
                    <tr
                      key={l.id}
                      className={[tom ? `linha-${tom}` : '', sujo ? 'linha-suja' : '', l.ativo === false ? 'inativa' : ''].join(' ')}
                      onClick={!planilha && (podeEditar || p.modo === 'formulario') ? () => { setErroForm(null); setEdit(l) } : undefined}
                    >
                      {planilha && (
                        <td className="col-editar">
                          {l.id! > 0 && <button className="btn btn-fantasma btn-icone" title="Editar tudo deste item" aria-label={`Editar ${String(l[p.campos[0].chave])}`} onClick={() => { setErroForm(null); setEdit({ ...l, ...(pendentes[l.id!] ?? {}) }) }}>✏️</button>}
                        </td>
                      )}
                      {camposLista.map((c) => (
                        <td key={c.chave} className={['dinheiro', 'numero'].includes(c.tipo) && !planilha ? 'n' : ''}>
                          {planilha ? (
                            <EditorCampo c={c} valor={valorLinha(l, c.chave)} aoMudar={(v) => alterar(l, c.chave, v)} compacto />
                          ) : c.tipo === 'bool' && c.chave === 'ativo' ? (
                            <Selo tom={l.ativo ? 'ok' : 'neutro'}>{l.ativo ? 'Ativo' : 'Inativo'}</Selo>
                          ) : exibir(c, l[c.chave])}
                        </td>
                      ))}
                      {p.colunasExtras?.map((x) => <td key={x.rotulo} className={x.numerica ? 'n' : ''}>{x.valor(atual)}</td>)}
                      {planilha && (
                        <td className="n acoes-linha">
                          {l.id! < 0
                            ? <button className="link" onClick={() => setNovas((ns) => ns.filter((n) => n.id !== l.id))}>remover</button>
                            : podeExcluir && <button className="btn btn-fantasma btn-icone" title="Excluir" onClick={() => excluir(l)}>🗑</button>}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>
      <p className="campo-dica">
        {num(filtradas.length)} de {num(linhas.length)} {linhas.length === 1 ? 'registro' : 'registros'}
        {planilha && ' · edite direto nas células e clique em "Salvar alterações", ou use ✏️ para abrir o item'}
        {!podeEditar && ' · somente leitura para o seu perfil'}
      </p>

      {edit && (
        <Modal
          aberto
          largo
          aoFechar={() => setEdit(null)}
          titulo={edit.id ? `${p.nomeItem}: ${String(edit[p.campos[0].chave] ?? '')}` : `Novo ${p.nomeItem.toLowerCase()}`}
          rodape={
            <>
              {edit.id && podeExcluir && <Botao variante="perigo" className="mr-auto" onClick={() => excluir(edit)}>Excluir</Botao>}
              <Botao variante="fantasma" onClick={() => setEdit(null)}>{podeEditar ? 'Cancelar' : 'Fechar'}</Botao>
              {podeEditar && <Botao variante="primario" onClick={salvarForm} carregando={salvando}>Salvar</Botao>}
            </>
          }
        >
          {erroForm && <Alerta tom="erro">{erroForm}</Alerta>}
          <div className="grade-form">
            {camposForm.map((c) => (
              <Campo key={c.chave} rotulo={c.rotulo + (c.obrigatorio ? ' *' : '')} dica={c.dica} className={c.inteiro || c.tipo === 'textarea' ? 'inteiro' : ''}>
                {c.tipo === 'bool' ? (
                  <label className="check">
                    <input type="checkbox" checked={Boolean(edit[c.chave])} disabled={!podeEditar} onChange={(e) => setEdit({ ...edit, [c.chave]: e.target.checked })} /> {c.rotulo}
                  </label>
                ) : podeEditar ? (
                  <EditorCampo c={c} valor={edit[c.chave]} aoMudar={(v) => setEdit({ ...edit, [c.chave]: v })} />
                ) : (
                  <div className="valor-leitura">{exibir(c, edit[c.chave])}</div>
                )}
              </Campo>
            ))}
          </div>
          {p.extraFormulario?.(edit, (fn) => setEdit((e) => (e ? fn(e) : e)))}
          {p.colunasExtras && edit.id && (
            <dl className="lista-def">
              {p.colunasExtras.map((x) => <Fragment key={x.rotulo}><dt>{x.rotulo}</dt><dd>{x.valor(edit)}</dd></Fragment>)}
            </dl>
          )}
        </Modal>
      )}
    </div>
  )
}
