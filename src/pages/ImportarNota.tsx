import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alerta, Botao, Campo, Entrada, EntradaValor, Modal, Opcoes, Selecao, Selo, useAvisos } from '../components/ui'
import { brl, brlUnit, dataBR, hoje, lerValor, qtd, somarDias, valorParaCampo } from '../lib/format'
import {
  chaveMapa, deLeituraIA, formatarCnpjCpf, lerXmlNfe, prepararImagem, similaridade, soDigitos, sugerirFator, unidadePadrao,
  type ItemNota, type LeituraIA, type NotaLida,
} from '../lib/nfe'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Fornecedor, Insumo, NotaMapeamento, StatusCompra } from '../lib/types'
import { CATEGORIAS_AVULSAS, FORMAS_COMPRA } from './CompraForm'

type EstadoArquivo = 'lendo' | 'pronta' | 'erro' | 'lancada' | 'pulada'
interface NaFila {
  id: number
  arquivo: File
  previa: string | null
  estado: EstadoArquivo
  nota?: NotaLida
  erro?: string
  compraId?: number
}

interface Linha {
  item: ItemNota
  incluir: boolean
  destino: number | 'avulso' | ''   // insumo_id, item avulso ou não escolhido
  categoria: string
  fator: string
  origem: 'memoria' | 'sugestao' | null
  fatorIncerto: boolean
}

const SUGESTAO_MINIMA = 0.4
let seq = 0

async function lerArquivo(f: File): Promise<NotaLida> {
  const nome = f.name || 'foto'
  if (/\.xml$/i.test(nome) || f.type.includes('xml')) return lerXmlNfe(await f.text(), nome)
  if (!f.type.startsWith('image/') && f.type !== 'application/pdf') throw new Error(`${nome}: envie XML, PDF ou foto (JPG/PNG).`)
  if (f.size > 15 * 1024 * 1024) throw new Error(`${nome}: arquivo muito grande (máx. 15 MB).`)
  const { base64, tipo } = await prepararImagem(f)
  const { data, error } = await supabase.functions.invoke('ler-nota', { body: { arquivo: base64, tipo } })
  if (error) {
    let msg = error.message
    try {
      const ctx = (error as { context?: Response }).context
      if (ctx) msg = (await ctx.json()).erro ?? msg
    } catch { /* corpo não-JSON */ }
    if (/Failed to send|404|not found/i.test(msg)) msg = 'A leitura por foto não está publicada no Supabase (função "ler-nota"). Veja o README. XML funciona sem ela.'
    throw new Error(`${nome}: ${msg}`)
  }
  return deLeituraIA((data as { nota: LeituraIA }).nota, nome, hoje())
}

export function ImportarNota({ aberto, aoFechar, aoSalvar, fornecedores, insumos }: {
  aberto: boolean
  aoFechar: () => void
  aoSalvar: () => void
  fornecedores: Fornecedor[]
  insumos: Insumo[]
}) {
  const [fila, setFila] = useState<NaFila[]>([])
  const [atualId, setAtualId] = useState<number | null>(null)
  const processando = useRef(false)
  const inputArq = useRef<HTMLInputElement>(null)
  const inputFoto = useRef<HTMLInputElement>(null)
  const [arrastando, setArrastando] = useState(false)

  useEffect(() => {
    if (!aberto) {
      fila.forEach((f) => f.previa && URL.revokeObjectURL(f.previa))
      setFila([])
      setAtualId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto])

  const atualizar = (id: number, mud: Partial<NaFila>) => setFila((fs) => fs.map((f) => (f.id === id ? { ...f, ...mud } : f)))

  // processa a fila (XML na hora; fotos uma de cada vez)
  useEffect(() => {
    if (processando.current) return
    const prox = fila.find((f) => f.estado === 'lendo' && !f.nota && !f.erro)
    if (!prox) return
    processando.current = true
    lerArquivo(prox.arquivo)
      .then((nota) => atualizar(prox.id, { estado: 'pronta', nota }))
      .catch((e) => atualizar(prox.id, { estado: 'erro', erro: e instanceof Error ? e.message : String(e) }))
      .finally(() => { processando.current = false; setFila((fs) => [...fs]) })
  }, [fila])

  // abre a primeira nota pronta automaticamente
  useEffect(() => {
    const atual = fila.find((f) => f.id === atualId)
    if (atual && atual.estado === 'pronta') return
    const prox = fila.find((f) => f.estado === 'pronta')
    if (prox && prox.id !== atualId) setAtualId(prox.id)
  }, [fila, atualId])

  const adicionar = (lista: FileList | File[] | null) => {
    if (!lista) return
    const novos = Array.from(lista).map((arquivo) => ({
      id: ++seq,
      arquivo,
      previa: arquivo.type.startsWith('image/') ? URL.createObjectURL(arquivo) : null,
      estado: 'lendo' as EstadoArquivo,
    }))
    setFila((fs) => [...fs, ...novos])
  }

  const atual = fila.find((f) => f.id === atualId && f.estado === 'pronta')
  const contagem = {
    lendo: fila.filter((f) => f.estado === 'lendo').length,
    prontas: fila.filter((f) => f.estado === 'pronta').length,
    lancadas: fila.filter((f) => f.estado === 'lancada').length,
    erros: fila.filter((f) => f.estado === 'erro').length,
  }

  return (
    <Modal aberto={aberto} aoFechar={aoFechar} gaveta largo titulo="Importar nota fiscal"
      rodape={!atual && <Botao variante="primario" onClick={aoFechar}>{contagem.lancadas ? 'Concluir' : 'Fechar'}</Botao>}>
      <div className="importar">
        {/* Entrada de arquivos */}
        <div
          className={`zona-arquivos ${arrastando ? 'arrastando' : ''} ${fila.length ? 'compacta' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastando(false); adicionar(e.dataTransfer.files) }}
        >
          {!fila.length && (
            <>
              <strong>Arraste aqui o XML, o PDF ou a foto da nota</strong>
              <span>Pode mandar várias de uma vez. O XML é lido na hora e sem custo; foto e PDF são lidos por inteligência artificial.</span>
            </>
          )}
          <div className="zona-botoes">
            <Botao onClick={() => inputArq.current?.click()}>{fila.length ? '+ Mais arquivos' : 'Escolher arquivos'}</Botao>
            <Botao onClick={() => inputFoto.current?.click()}>📷 Tirar foto</Botao>
          </div>
          <input ref={inputArq} type="file" hidden multiple accept=".xml,text/xml,application/xml,application/pdf,image/*"
            onChange={(e) => { adicionar(e.target.files); e.target.value = '' }} />
          <input ref={inputFoto} type="file" hidden accept="image/*" capture="environment"
            onChange={(e) => { adicionar(e.target.files); e.target.value = '' }} />
        </div>

        {fila.length > 0 && (
          <div className="fila-notas">
            {fila.map((f) => (
              <button key={f.id} type="button" className={`fila-item ${f.id === atualId && f.estado === 'pronta' ? 'ativo' : ''} estado-${f.estado}`}
                onClick={() => f.estado === 'pronta' && setAtualId(f.id)} title={f.erro ?? f.arquivo.name}>
                <span className="fila-icone">{f.estado === 'lendo' ? <span className="spinner" /> : f.estado === 'lancada' ? '✓' : f.estado === 'erro' ? '!' : f.estado === 'pulada' ? '–' : f.nota?.origem === 'xml' ? 'XML' : 'IA'}</span>
                <span className="fila-texto">
                  <strong>{f.nota ? f.nota.emitente.fantasia || f.nota.emitente.nome : f.arquivo.name || 'Foto'}</strong>
                  <small>{f.estado === 'lendo' ? 'Lendo…' : f.estado === 'erro' ? 'Não foi possível ler' : f.estado === 'lancada' ? `Lançada · compra #${f.compraId}` : f.estado === 'pulada' ? 'Pulada' : `${f.nota!.itens.length} itens · ${brl(f.nota!.total)}`}</small>
                </span>
              </button>
            ))}
          </div>
        )}

        {fila.filter((f) => f.estado === 'erro').map((f) => <Alerta key={f.id} tom="erro">{f.erro}</Alerta>)}

        {atual?.nota ? (
          <Conferencia
            key={atual.id}
            nota={atual.nota}
            previa={atual.previa}
            fornecedores={fornecedores}
            insumos={insumos}
            aoPular={() => atualizar(atual.id, { estado: 'pulada' })}
            aoLancar={(compraId) => { atualizar(atual.id, { estado: 'lancada', compraId }); aoSalvar() }}
          />
        ) : fila.length > 0 && contagem.lendo === 0 && contagem.prontas === 0 ? (
          <Alerta tom={contagem.lancadas ? 'ok' : 'info'}>
            {contagem.lancadas ? `${contagem.lancadas} nota(s) lançada(s). O estoque e os custos dos insumos já foram atualizados.` : 'Nenhuma nota para conferir.'}
          </Alerta>
        ) : contagem.lendo > 0 && !atual ? (
          <div className="carregando"><span className="spinner" /> Lendo {contagem.lendo === 1 ? 'a nota' : `${contagem.lendo} notas`}… fotos podem levar alguns segundos.</div>
        ) : null}
      </div>
    </Modal>
  )
}

// =====================================================================
// Conferência de uma nota
// =====================================================================
function Conferencia({ nota, previa, fornecedores, insumos, aoPular, aoLancar }: {
  nota: NotaLida
  previa: string | null
  fornecedores: Fornecedor[]
  insumos: Insumo[]
  aoPular: () => void
  aoLancar: (compraId: number) => void
}) {
  const { avisar, confirmar } = useAvisos()
  const ativos = useMemo(() => insumos.filter((i) => i.ativo), [insumos])
  const insumo = useCallback((id: number) => insumos.find((i) => i.id === id), [insumos])

  // ---- fornecedor: CNPJ, depois nome
  const casarFornecedor = (): number | 'novo' => {
    const doc = soDigitos(nota.emitente.documento)
    if (doc) {
      const f = fornecedores.find((x) => soDigitos(x.documento) === doc)
      if (f) return f.id
    }
    const nomes = [nota.emitente.fantasia, nota.emitente.nome].filter(Boolean) as string[]
    let melhor: { id: number; s: number } | null = null
    for (const f of fornecedores.filter((x) => x.ativo)) {
      for (const n of nomes) {
        const s = Math.max(similaridade(n, f.nome), similaridade(f.nome, n))
        if (s >= 0.75 && (!melhor || s > melhor.s)) melhor = { id: f.id, s }
      }
    }
    return melhor?.id ?? 'novo'
  }
  const [forn, setForn] = useState<number | 'novo' | 'avulso'>(casarFornecedor)
  const fornPorCnpj = forn !== 'novo' && forn !== 'avulso' && !!soDigitos(nota.emitente.documento) && soDigitos(fornecedores.find((f) => f.id === forn)?.documento) === soDigitos(nota.emitente.documento)
  const [novoNome, setNovoNome] = useState(() => tituloCaso(nota.emitente.fantasia || nota.emitente.nome))
  const [mapas, setMapas] = useState<NotaMapeamento[]>([])
  const fornecedor = typeof forn === 'number' ? fornecedores.find((f) => f.id === forn) : undefined

  useEffect(() => {
    if (typeof forn !== 'number') return setMapas([])
    supabase.from('nota_mapeamentos').select('*').eq('fornecedor_id', forn).then(({ data }) => setMapas((data as NotaMapeamento[]) ?? []))
  }, [forn])

  // ---- itens: memória do fornecedor > sugestão por nome
  const montarLinhas = useCallback((): Linha[] => nota.itens.map((item) => {
    const mapa = mapas.find((m) => m.chave === chaveMapa(item))
    if (mapa && (mapa.insumo_id == null || insumo(mapa.insumo_id)?.ativo)) {
      return {
        item, incluir: true, destino: mapa.insumo_id ?? 'avulso', categoria: mapa.categoria ?? 'Outros',
        fator: String(Number(mapa.fator)).replace('.', ','), origem: 'memoria', fatorIncerto: false,
      }
    }
    let melhor: { ins: Insumo; s: number } | null = null
    for (const ins of ativos) {
      const s = similaridade(item.descricao, ins.nome)
      if (s >= SUGESTAO_MINIMA && (!melhor || s > melhor.s)) melhor = { ins, s }
    }
    if (melhor) {
      const f = sugerirFator(item, melhor.ins.unidade)
      return { item, incluir: true, destino: melhor.ins.id, categoria: melhor.ins.categoria, fator: String(f.fator).replace('.', ','), origem: 'sugestao', fatorIncerto: !f.certeza }
    }
    return { item, incluir: true, destino: '', categoria: 'Outros', fator: '1', origem: null, fatorIncerto: false }
  }), [nota, mapas, ativos, insumo])

  const [linhas, setLinhas] = useState<Linha[]>(montarLinhas)
  useEffect(() => { setLinhas(montarLinhas()) }, [montarLinhas])

  const alterar = (k: number, mud: Partial<Linha>) => setLinhas((ls) => ls.map((l, i) => (i === k ? { ...l, ...mud } : l)))
  const escolherDestino = (k: number, valor: string) => {
    const l = linhas[k]
    if (valor === 'avulso') return alterar(k, { destino: 'avulso', fator: '1', origem: null, fatorIncerto: false })
    if (!valor) return alterar(k, { destino: '', origem: null })
    const ins = insumo(Number(valor))!
    const f = sugerirFator(l.item, ins.unidade)
    alterar(k, { destino: ins.id, categoria: ins.categoria, fator: String(f.fator).replace('.', ','), origem: null, fatorIncerto: !f.certeza })
  }

  // ---- cabeçalho e pagamento
  const [data, setData] = useState(nota.data || hoje())
  const [numero, setNumero] = useState(nota.numero ?? '')
  const aPrazo = nota.vencimentos.length > 0
  const [status, setStatus] = useState<StatusCompra>(aPrazo ? 'a_pagar' : 'paga')
  const [vencimento, setVencimento] = useState(nota.vencimentos[0]?.data ?? '')
  const [forma, setForma] = useState(nota.forma_pagamento && FORMAS_COMPRA.includes(nota.forma_pagamento) ? nota.forma_pagamento : nota.forma_pagamento ? 'Pix' : aPrazo ? 'Boleto' : '')
  const [frete, setFrete] = useState(valorParaCampo(nota.frete))
  const [desconto, setDesconto] = useState(valorParaCampo(nota.desconto))
  const [lancarCaixa, setLancarCaixa] = useState(false)
  const [duplicada, setDuplicada] = useState<{ id: number; data: string } | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (status === 'a_pagar' && !vencimento) setVencimento(somarDias(data, fornecedor?.prazo_pagamento_dias || 7))
  }, [status, vencimento, data, fornecedor])

  useEffect(() => {
    if (!nota.chave) return
    supabase.from('compras').select('id, data').eq('chave_nfe', nota.chave).neq('status', 'cancelada').then(({ data: d }) => {
      setDuplicada(d && d.length ? (d[0] as { id: number; data: string }) : null)
    })
  }, [nota.chave])

  // ---- contas
  const fatorNum = (l: Linha) => lerValor(l.fator) || 1
  const incluidas = linhas.filter((l) => l.incluir)
  const somaItens = incluidas.reduce((s, l) => s + l.item.valor_total, 0)
  const total = Math.round((somaItens + lerValor(frete) - lerValor(desconto)) * 100) / 100
  const semDestino = incluidas.filter((l) => l.destino === '').length
  const difNota = Math.round((total - nota.total) * 100) / 100

  const lancar = async () => {
    setErro(null)
    if (duplicada) return setErro(`Esta nota já foi lançada (compra #${duplicada.id}).`)
    if (!incluidas.length) return setErro('Nenhum item marcado para lançar.')
    if (semDestino) return setErro(`Escolha o insumo (ou "não é insumo") em ${semDestino} ${semDestino === 1 ? 'item' : 'itens'}.`)
    if (forn === 'novo' && !novoNome.trim()) return setErro('Informe o nome do novo fornecedor.')
    if (status === 'a_pagar' && !vencimento) return setErro('Informe o vencimento.')
    if (Math.abs(difNota) >= 0.01) {
      const ok = await confirmar({
        titulo: 'Total diferente da nota',
        texto: <p>O total a lançar ({brl(total)}) está diferente do total da nota ({brl(nota.total)}), diferença de {brl(Math.abs(difNota))}. {incluidas.length < linhas.length ? 'Você desmarcou itens.' : 'Confira frete e desconto.'} Lançar assim mesmo?</p>,
        confirmar: 'Lançar assim',
      })
      if (!ok) return
    }

    setSalvando(true)
    try {
      let fornecedorId: number | null = typeof forn === 'number' ? forn : null
      if (forn === 'novo') {
        const { data: f, error } = await supabase.from('fornecedores').insert({
          nome: novoNome.trim(),
          razao_social: tituloCaso(nota.emitente.nome),
          documento: nota.emitente.documento ? formatarCnpjCpf(nota.emitente.documento) : null,
          ativo: true,
        }).select('id').single()
        if (error) throw error
        fornecedorId = (f as { id: number }).id
      }

      const parcelas = nota.vencimentos.length > 1
        ? `Parcelas: ${nota.vencimentos.map((v) => `${v.numero ?? ''} ${dataBR(v.data)} ${brl(v.valor)}`.trim()).join('; ')}`
        : ''
      const { data: id, error } = await supabase.rpc('salvar_compra', {
        p_compra: {
          data,
          fornecedor_id: fornecedorId,
          fornecedor_nome: forn === 'avulso' ? novoNome.trim() || nota.emitente.nome : null,
          numero_nota: numero,
          chave_nfe: nota.chave,
          origem: nota.origem,
          forma_pagamento: forma,
          status,
          vencimento: status === 'a_pagar' ? vencimento : null,
          data_pagamento: status === 'paga' ? data : null,
          frete: lerValor(frete),
          desconto: lerValor(desconto),
          observacao: [`Importada de ${nota.origem === 'xml' ? 'XML' : 'foto/PDF'} (${nota.arquivo})`, parcelas].filter(Boolean).join('. '),
        },
        p_itens: incluidas.map((l) => {
          const f = l.destino === 'avulso' ? 1 : fatorNum(l)
          const q = Math.round(l.item.quantidade * f * 1000) / 1000
          const ins = typeof l.destino === 'number' ? insumo(l.destino) : undefined
          return {
            insumo_id: ins?.id ?? null,
            descricao: ins ? ins.nome : tituloCaso(l.item.descricao),
            categoria: ins ? ins.categoria : l.categoria,
            unidade: ins ? ins.unidade : l.item.unidade.toLowerCase(),
            quantidade: q,
            valor_unitario: q ? Math.round((l.item.valor_total / q) * 10000) / 10000 : 0,
            codigo_nota: l.item.codigo,
            descricao_nota: l.item.descricao,
            quantidade_nota: l.item.quantidade,
            unidade_nota: l.item.unidade,
            chave_mapa: chaveMapa(l.item),
            fator: f,
          }
        }),
        p_lancar_caixa: status === 'paga' && forma === 'Dinheiro' && lancarCaixa,
      })
      if (error) throw error
      avisar(`Nota ${numero || ''} lançada: ${brl(total)}.`)
      aoLancar(Number(id))
    } catch (e) {
      setErro(mensagemErro(e))
    }
    setSalvando(false)
  }

  const grupos = useMemo(() => {
    const porCat = new Map<string, Insumo[]>()
    ativos.forEach((i) => porCat.set(i.categoria, [...(porCat.get(i.categoria) ?? []), i]))
    return [...porCat.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [ativos])

  const daMemoria = linhas.filter((l) => l.origem === 'memoria').length

  return (
    <div className="conferencia">
      <div className="conf-topo">
        <div>
          <h3>Conferir nota {nota.numero ? `nº ${nota.numero}` : ''}</h3>
          <span className="campo-dica">
            {nota.modelo === '65' ? 'Cupom NFC-e' : nota.modelo === '55' ? 'NF-e' : 'Nota'} · emitida em {dataBR(nota.data)} · {nota.origem === 'xml' ? 'lida do XML' : 'lida da foto por IA'}
          </span>
        </div>
        <div className="conf-total"><span>Total da nota</span><strong>{brl(nota.total)}</strong></div>
      </div>

      {duplicada && <Alerta tom="erro">Esta nota <strong>já foi lançada</strong> na compra #{duplicada.id} de {dataBR(duplicada.data)}. Pule esta nota.</Alerta>}
      {nota.avisos.map((a, i) => <Alerta key={i} tom={nota.origem === 'foto' && i === 0 ? 'info' : 'alerta'}>{a}</Alerta>)}

      <div className={previa ? 'conf-com-previa' : ''}>
        {previa && (
          <a className="previa-nota" href={previa} target="_blank" rel="noreferrer" title="Abrir a foto em tamanho real">
            <img src={previa} alt="Foto da nota" />
            <small>Clique para ampliar</small>
          </a>
        )}
        <div className="conf-campos">
          <div className="grade-2">
            <Campo rotulo="Fornecedor" dica={
              fornPorCnpj ? <span className="pos">✓ reconhecido pelo {soDigitos(nota.emitente.documento).length === 11 ? 'CPF' : 'CNPJ'} {formatarCnpjCpf(nota.emitente.documento)}</span>
                : forn === 'novo' ? `Não está cadastrado — será criado com o CNPJ ${formatarCnpjCpf(nota.emitente.documento) || '(não lido)'}`
                : typeof forn === 'number' ? 'Escolhido pelo nome — confira' : 'Compra avulsa, sem cadastro'
            }>
              <Selecao value={String(forn)} onChange={(e) => setForn(e.target.value === 'novo' || e.target.value === 'avulso' ? e.target.value : Number(e.target.value))}>
                <option value="novo">+ Cadastrar novo: {tituloCaso(nota.emitente.fantasia || nota.emitente.nome)}</option>
                <option value="avulso">Compra avulsa (não cadastrar)</option>
                {fornecedores.filter((f) => f.ativo).map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </Selecao>
            </Campo>
            {(forn === 'novo' || forn === 'avulso') && (
              <Campo rotulo={forn === 'novo' ? 'Nome do novo fornecedor' : 'Nome na compra'} dica={`Razão social na nota: ${nota.emitente.nome}`}>
                <Entrada value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
              </Campo>
            )}
          </div>
          <div className="grade-3">
            <Campo rotulo="Data da compra"><Entrada type="date" value={data} onChange={(e) => setData(e.target.value)} /></Campo>
            <Campo rotulo="Nº da nota"><Entrada value={numero} onChange={(e) => setNumero(e.target.value)} /></Campo>
            {nota.chave && <Campo rotulo="Chave de acesso"><div className="chave-nfe" title={nota.chave}>{nota.chave.replace(/(\d{4})/g, '$1 ').trim()}</div></Campo>}
          </div>
        </div>
      </div>

      <div className="itens-compra">
        <div className="itens-topo">
          <strong>Itens da nota ({linhas.length})</strong>
          <span className="campo-dica">
            {daMemoria ? `${daMemoria} reconhecido(s) pela memória deste fornecedor. ` : ''}
            As escolhas ficam salvas: na próxima nota deste fornecedor os itens já vêm ligados.
          </span>
        </div>
        <div className="rolagem largura-total">
          <table className="tabela tabela-itens tabela-conferencia">
            <thead>
              <tr><th style={{ width: 28 }} /><th>Na nota</th><th style={{ minWidth: 230 }}>Lançar como</th><th style={{ width: 150 }}>Conversão</th><th className="n" style={{ width: 150 }}>Entra no estoque</th></tr>
            </thead>
            <tbody>
              {linhas.map((l, k) => {
                const ins = typeof l.destino === 'number' ? insumo(l.destino) : undefined
                const f = fatorNum(l)
                const qEst = l.item.quantidade * f
                const mudouUn = !!ins && (Math.abs(f - 1) > 1e-9 || unidadePadrao(l.item.unidade) !== unidadePadrao(ins.unidade))
                return (
                  <tr key={k} className={l.incluir ? '' : 'excluida'}>
                    <td><input type="checkbox" checked={l.incluir} onChange={(e) => alterar(k, { incluir: e.target.checked })} aria-label="Lançar este item" title="Desmarque para não lançar este item" /></td>
                    <td className="item-nota">
                      <strong>{l.item.descricao}</strong>
                      <small>{l.item.codigo ? `cód. ${l.item.codigo} · ` : ''}{qtd(l.item.quantidade)} {l.item.unidade} × {brlUnit(l.item.valor_unitario)} = <b>{brl(l.item.valor_total)}</b></small>
                    </td>
                    <td>
                      <Selecao value={String(l.destino)} onChange={(e) => escolherDestino(k, e.target.value)} aria-label="Insumo" className={l.destino === '' && l.incluir ? 'entrada pendente' : 'entrada'}>
                        <option value="">Escolha o insumo…</option>
                        {grupos.map(([cat, is]) => (
                          <optgroup key={cat} label={cat}>{is.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}</optgroup>
                        ))}
                        <option value="avulso">Não é insumo (só despesa)</option>
                      </Selecao>
                      {l.destino === 'avulso' && (
                        <Selecao value={l.categoria} onChange={(e) => alterar(k, { categoria: e.target.value })} aria-label="Categoria" className="entrada mt-6">
                          {CATEGORIAS_AVULSAS.map((c) => <option key={c}>{c}</option>)}
                        </Selecao>
                      )}
                      {l.origem === 'memoria' && <Selo tom="ok">memória</Selo>}
                      {l.origem === 'sugestao' && <Selo tom="info">sugestão</Selo>}
                    </td>
                    <td>
                      {ins && (mudouUn || l.fatorIncerto || unidadePadrao(l.item.unidade) !== unidadePadrao(ins.unidade)) && (
                        <div className={`conversao ${l.fatorIncerto ? 'incerta' : ''}`} title={l.fatorIncerto ? 'Conversão sugerida pela descrição — confira' : undefined}>
                          <span>1 {l.item.unidade} =</span>
                          <Entrada className="entrada n" inputMode="decimal" value={l.fator} onChange={(e) => alterar(k, { fator: e.target.value.replace(/[^\d,.]/g, ''), fatorIncerto: false })} aria-label="Fator de conversão" />
                          <span>{ins.unidade}</span>
                        </div>
                      )}
                    </td>
                    <td className="n">
                      {ins ? (
                        <>
                          <strong className={mudouUn ? 'destaque-conv' : ''}>{qtd(qEst)} {ins.unidade}</strong>
                          <small className="sub">{brlUnit(qEst ? l.item.valor_total / qEst : 0)}/{ins.unidade}
                            {Number(ins.custo_unitario) > 0 && qEst > 0 && (() => {
                              const v = (l.item.valor_total / qEst) / Number(ins.custo_unitario) - 1
                              return Math.abs(v) >= 0.15 ? <span className={v > 0 ? 'neg' : 'pos'}> ({v > 0 ? '+' : ''}{Math.round(v * 100)}% vs último)</span> : null
                            })()}
                          </small>
                        </>
                      ) : l.destino === 'avulso' ? <span className="tenue">sem estoque</span> : <span className="tenue">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grade-4 resumo-compra">
        <div><span>Itens marcados</span><strong>{brl(somaItens)}</strong></div>
        <Campo rotulo="Frete / outras despesas"><EntradaValor valor={frete} aoMudar={setFrete} /></Campo>
        <Campo rotulo="Desconto"><EntradaValor valor={desconto} aoMudar={setDesconto} /></Campo>
        <div className="total-compra"><span>Total a lançar</span><strong className={Math.abs(difNota) >= 0.01 ? 'neg' : ''}>{brl(total)}</strong></div>
      </div>

      <div className="grade-3">
        <Campo rotulo="Pagamento">
          <Opcoes nome="Pagamento" valor={status} aoMudar={(v) => setStatus(v as StatusCompra)} opcoes={[{ valor: 'paga', rotulo: 'Já paga' }, { valor: 'a_pagar', rotulo: 'A pagar' }]} />
        </Campo>
        <Campo rotulo="Forma">
          <Selecao value={forma} onChange={(e) => setForma(e.target.value)}>
            <option value="">—</option>
            {FORMAS_COMPRA.map((f) => <option key={f}>{f}</option>)}
          </Selecao>
        </Campo>
        {status === 'a_pagar' && (
          <Campo rotulo="Vencimento" dica={nota.vencimentos.length > 1 ? `${nota.vencimentos.length} parcelas na nota — usei o 1º vencimento; as parcelas ficam na observação.` : nota.vencimentos.length ? 'Da duplicata da nota' : undefined}>
            <Entrada type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
          </Campo>
        )}
      </div>
      {status === 'paga' && forma === 'Dinheiro' && (
        <label className="check destaque-check">
          <input type="checkbox" checked={lancarCaixa} onChange={(e) => setLancarCaixa(e.target.checked)} />
          <span>O dinheiro saiu da <strong>gaveta do caixa</strong> — registrar a despesa no fechamento de {dataBR(data)}</span>
        </label>
      )}

      {erro && <Alerta tom="erro">{erro}</Alerta>}
      <div className="conf-acoes">
        <Botao variante="fantasma" onClick={aoPular}>Pular esta nota</Botao>
        <Botao variante="primario" onClick={lancar} carregando={salvando} disabled={!!duplicada}>Lançar compra · {brl(total)}</Botao>
      </div>
    </div>
  )
}

function tituloCaso(s: string) {
  const minusc = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com'])
  return s.toLowerCase().replace(/\s+/g, ' ').trim().split(' ').map((p, i) => {
    if (/^(ltda|me|epp|eireli|s\/a|sa)$/.test(p)) return p.toUpperCase()
    if (i > 0 && minusc.has(p)) return p
    return p.charAt(0).toUpperCase() + p.slice(1)
  }).join(' ')
}
