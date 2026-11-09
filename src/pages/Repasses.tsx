import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alerta, Botao, Cabecalho, Campo, Cartao, Carregando, Entrada, EntradaValor, Kpi, Modal, Selecao, useAvisos, Vazio } from '../components/ui'
import { SeletorEmpresa, TagEmpresa, useEmpresas } from '../lib/empresas'
import { baixarCsv, brl, dataBR, fimMes, hoje, inicioMes, lerValor, mesExtenso, num, valorParaCampo } from '../lib/format'
import { mensagemErro, supabase } from '../lib/supabase'
import { SeletorMes } from './Compras'

export interface Repasse {
  id: number
  empresa_id: number
  data: string
  origem: string
  descricao: string | null
  forma: string | null
  valor: number
  observacao: string | null
}

const ORIGENS = ['iFood', '99', 'Franqueadora', 'Vendas balcão', 'Delivery próprio', 'Outras receitas']
const FORMAS = ['Transferência', 'Pix', 'Dinheiro', 'Cartão (máquina)', 'Boleto', 'Outros']

export function Repasses() {
  const emp = useEmpresas()
  const [mes, setMes] = useState(inicioMes(hoje()))
  const [empresa, setEmpresa] = useState(-1)   // -1 = ainda não escolhida; 0 = todas
  const [lista, setLista] = useState<Repasse[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [edit, setEdit] = useState<Partial<Repasse> | null>(null)

  // abre na franquia (quem não tem comandas); se não houver, em todas
  useEffect(() => {
    if (empresa === -1 && emp.ativas.length) setEmpresa(emp.ativas.find((e) => !e.controla_comandas)?.id ?? 0)
  }, [empresa, emp.ativas])

  const carregar = useCallback(async () => {
    if (empresa === -1) return
    setCarregando(true)
    let q = supabase.from('repasses').select('*').gte('data', mes).lte('data', fimMes(mes))
    if (empresa) q = q.eq('empresa_id', empresa)
    const { data, error } = await q.order('data', { ascending: false }).order('id', { ascending: false })
    if (error) setErro(mensagemErro(error))
    else { setErro(null); setLista((data as Repasse[]) ?? []) }
    setCarregando(false)
  }, [mes, empresa])
  useEffect(() => { carregar() }, [carregar])

  const total = lista.reduce((s, r) => s + Number(r.valor), 0)
  const porOrigem = useMemo(() => {
    const m = new Map<string, number>()
    lista.forEach((r) => m.set(r.origem, (m.get(r.origem) ?? 0) + Number(r.valor)))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [lista])

  const exportar = () => baixarCsv(`repasses_${mes.slice(0, 7)}.csv`, [
    ['Data', 'Empresa', 'Origem', 'Descrição', 'Forma / conta', 'Valor', 'Observação'],
    ...lista.map((r) => [dataBR(r.data), emp.nome(r.empresa_id), r.origem, r.descricao, r.forma, Number(r.valor), r.observacao]),
  ])

  const novo = () => setEdit({ empresa_id: empresa > 0 ? empresa : emp.ativas.find((e) => !e.controla_comandas)?.id ?? emp.padrao, data: hoje() < fimMes(mes) && hoje() >= mes ? hoje() : mes, origem: '', forma: 'Transferência' })

  return (
    <div className="pagina">
      <Cabecalho
        titulo="Repasses e receitas"
        subtitulo="Receitas que não passam por comanda — o que a franquia recebe (iFood, 99, franqueadora…). Entram no DRE do CNPJ."
        acoes={
          <>
            <Botao onClick={exportar} disabled={!lista.length}>Exportar CSV</Botao>
            <Botao variante="primario" onClick={novo}>+ Repasse</Botao>
          </>
        }
      />
      <div className="barra-filtros">
        <SeletorMes valor={mes} aoMudar={setMes} />
        {emp.varias && <SeletorEmpresa valor={Math.max(empresa, 0)} aoMudar={setEmpresa} todas aria-label="Filtrar por empresa" />}
      </div>
      {erro && <Alerta tom="erro">{erro}</Alerta>}

      <div className="kpis">
        <Kpi destaque rotulo={`Recebido em ${mesExtenso(mes)}`} valor={brl(total)} detalhe={`${num(lista.length)} lançamento(s)`} />
        {porOrigem.slice(0, 3).map(([o, v]) => <Kpi key={o} rotulo={o} valor={brl(v)} detalhe={total ? `${Math.round((v / total) * 100)}% do total` : undefined} />)}
      </div>

      <Cartao className="sem-padding">
        {carregando ? <Carregando /> : lista.length === 0 ? (
          <Vazio>Nenhum repasse em {mesExtenso(mes)}. Clique em <strong>+ Repasse</strong> para lançar.</Vazio>
        ) : (
          <table className="tabela tabela-clicavel">
            <thead><tr><th>Data</th><th>Origem</th><th>Descrição</th><th>Entrou como</th><th className="n">Valor</th></tr></thead>
            <tbody>
              {lista.map((r) => (
                <tr key={r.id} onClick={() => setEdit(r)}>
                  <td>{dataBR(r.data)}{empresa === 0 && <small className="sub"><TagEmpresa id={r.empresa_id} /></small>}</td>
                  <td className="forte">{r.origem}</td>
                  <td>{r.descricao || <span className="tenue">—</span>}{r.observacao && <small className="sub">{r.observacao}</small>}</td>
                  <td>{r.forma || <span className="tenue">—</span>}</td>
                  <td className="n forte">{brl(r.valor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4}>Total</td><td className="n">{brl(total)}</td></tr></tfoot>
          </table>
        )}
      </Cartao>

      {edit && <FormRepasse inicial={edit} aoFechar={() => setEdit(null)} aoSalvar={() => { setEdit(null); carregar() }} />}
    </div>
  )
}

function FormRepasse({ inicial, aoFechar, aoSalvar }: { inicial: Partial<Repasse>; aoFechar: () => void; aoSalvar: () => void }) {
  const { avisar, confirmar } = useAvisos()
  const emp = useEmpresas()
  const [f, setF] = useState({
    empresa_id: inicial.empresa_id ?? emp.padrao,
    data: inicial.data ?? hoje(),
    origem: inicial.origem ?? '',
    descricao: inicial.descricao ?? '',
    forma: inicial.forma ?? '',
    valor: inicial.valor != null ? valorParaCampo(Number(inicial.valor)) : '',
    observacao: inicial.observacao ?? '',
  })
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const mudar = (k: keyof typeof f, v: string | number) => setF((x) => ({ ...x, [k]: v }))

  const salvar = async () => {
    if (!f.empresa_id) return setErro('Escolha a empresa (CNPJ).')
    if (!f.data) return setErro('Informe a data.')
    if (!f.origem.trim()) return setErro('Informe a origem (ex.: iFood, Franqueadora).')
    if (!lerValor(f.valor)) return setErro('Informe o valor.')
    setSalvando(true)
    const dados = {
      empresa_id: f.empresa_id, data: f.data, origem: f.origem.trim(), descricao: f.descricao.trim() || null,
      forma: f.forma || null, valor: lerValor(f.valor), observacao: f.observacao.trim() || null,
    }
    const { error } = inicial.id
      ? await supabase.from('repasses').update(dados).eq('id', inicial.id)
      : await supabase.from('repasses').insert(dados)
    setSalvando(false)
    if (error) return setErro(mensagemErro(error))
    avisar(inicial.id ? 'Repasse atualizado.' : `Repasse de ${brl(dados.valor)} lançado.`)
    aoSalvar()
  }

  const excluir = async () => {
    if (!inicial.id) return
    if (!(await confirmar({ titulo: 'Excluir este repasse?', texto: 'Fica registrado na auditoria.', confirmar: 'Excluir', perigo: true }))) return
    const { error } = await supabase.from('repasses').delete().eq('id', inicial.id)
    if (error) return setErro(mensagemErro(error))
    avisar('Repasse excluído.', 'info')
    aoSalvar()
  }

  return (
    <Modal aberto aoFechar={aoFechar} titulo={inicial.id ? 'Repasse' : 'Novo repasse'}
      rodape={
        <>
          {inicial.id && <Botao variante="perigo" className="mr-auto" onClick={excluir}>Excluir</Botao>}
          <Botao variante="fantasma" onClick={aoFechar}>Cancelar</Botao>
          <Botao variante="primario" onClick={salvar} carregando={salvando}>Salvar</Botao>
        </>
      }>
      {erro && <Alerta tom="erro">{erro}</Alerta>}
      <div className="grade-form">
        <Campo rotulo="Empresa (CNPJ)" className="inteiro">
          <SeletorEmpresa valor={f.empresa_id} aoMudar={(v) => mudar('empresa_id', v)} aria-label="Empresa do repasse" />
        </Campo>
        <Campo rotulo="Data em que entrou"><Entrada type="date" value={f.data} onChange={(e) => mudar('data', e.target.value)} /></Campo>
        <Campo rotulo="Valor"><EntradaValor valor={f.valor} aoMudar={(v) => mudar('valor', v)} aria-label="Valor do repasse" /></Campo>
        <Campo rotulo="Origem">
          <Entrada list="origens-repasse" value={f.origem} onChange={(e) => mudar('origem', e.target.value)} placeholder="iFood, 99, Franqueadora…" aria-label="Origem" />
          <datalist id="origens-repasse">{ORIGENS.map((o) => <option key={o} value={o} />)}</datalist>
        </Campo>
        <Campo rotulo="Entrou como">
          <Selecao value={f.forma} onChange={(e) => mudar('forma', e.target.value)} aria-label="Forma">
            <option value="">—</option>
            {FORMAS.map((x) => <option key={x}>{x}</option>)}
          </Selecao>
        </Campo>
        <Campo rotulo="Descrição" className="inteiro"><Entrada value={f.descricao} onChange={(e) => mudar('descricao', e.target.value)} placeholder="Ex.: repasse semanal 01 a 07/11" /></Campo>
        <Campo rotulo="Observação" className="inteiro"><Entrada value={f.observacao} onChange={(e) => mudar('observacao', e.target.value)} /></Campo>
      </div>
    </Modal>
  )
}
