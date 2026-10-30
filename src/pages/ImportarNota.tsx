import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alerta, Botao, Campo, Entrada, EntradaValor, Modal, Opcoes, Selecao, Selo, useAvisos } from '../components/ui'
import { brl, brlUnit, dataBR, dataHoraBR, hoje, lerValor, qtd, somarDias, valorParaCampo } from '../lib/format'
import {
  abrirImagem, adicionarArquivos, buscarPrevia, descartarNota, limparAvisos, recarregarPendentes, salvarRascunho, useFilaNotas,
  type NotaImportada,
} from '../lib/filaNotas'
import {
  chaveMapa, formatarCnpjCpf, similaridade, soDigitos, sugerirFator, unidadePadrao,
  type ItemNota, type NotaLida,
} from '../lib/nfe'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Fornecedor, Insumo, NotaMapeamento, StatusCompra } from '../lib/types'
import { CATEGORIAS_AVULSAS, FORMAS_COMPRA } from './CompraForm'

interface Linha {
  item: ItemNota
  incluir: boolean
  destino: number | 'avulso' | ''   // insumo_id, item avulso ou não escolhido
  categoria: string
  fator: string
  origem: 'memoria' | 'sugestao' | null
  fatorIncerto: boolean
  /** correções feitas na conferência (texto do campo); ausente = valor lido da nota */
  qtdTxt?: string
  precoTxt?: string
  /** item que não veio na leitura, incluído à mão na conferência */
  manual?: boolean
}

const numTxt = (n: number, casas = 4) => String(Math.round(n * 10 ** casas) / 10 ** casas).replace('.', ',')
const precoTxt = (n: number) => (Math.abs(n * 100 - Math.round(n * 100)) < 1e-6 ? n.toFixed(2) : numTxt(n)).replace('.', ',')

/** Quantidade, preço e total do item já com as correções da conferência */
function efetivo(l: Linha) {
  const q = l.qtdTxt != null ? lerValor(l.qtdTxt) : l.item.quantidade
  const u = l.precoTxt != null ? lerValor(l.precoTxt) : l.item.valor_unitario
  if (l.manual) return { q, u, total: Math.round(q * u * 100) / 100, editado: false }
  const editado = Math.abs(q - l.item.quantidade) > 1e-9 || Math.abs(u - l.item.valor_unitario) > 1e-9
  return { q, u, total: editado ? Math.round(q * u * 100) / 100 : l.item.valor_total, editado }
}

/** O que fica salvo da conferência enquanto a nota não é lançada */
interface Rascunho {
  forn: number | 'novo' | 'avulso'
  novoNome: string
  linhas: (Omit<Linha, 'item'> & { item?: ItemNota })[]
  data: string
  numero: string
  status: StatusCompra
  vencimento: string
  forma: string
  frete: string
  desconto: string
  lancarCaixa: boolean
}

const SUGESTAO_MINIMA = 0.4

export function ImportarNota({ aberto, aoFechar, aoSalvar, fornecedores, insumos }: {
  aberto: boolean
  aoFechar: () => void
  aoSalvar: () => void
  fornecedores: Fornecedor[]
  insumos: Insumo[]
}) {
  const fila = useFilaNotas()
  const { confirmar, avisar } = useAvisos()
  const [atualId, setAtualId] = useState<number | null>(null)
  const [lancadas, setLancadas] = useState<{ id: number; nome: string; compraId: number }[]>([])
  const [previa, setPrevia] = useState<string | null>(null)
  const inputArq = useRef<HTMLInputElement>(null)
  const inputFoto = useRef<HTMLInputElement>(null)
  const [arrastando, setArrastando] = useState(false)
  const [perfis, setPerfis] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    if (!aberto) return
    recarregarPendentes()
    supabase.from('perfis').select('id, nome').then(({ data }) => setPerfis(new Map(((data as { id: string; nome: string }[]) ?? []).map((p) => [p.id, p.nome]))))
  }, [aberto])

  useEffect(() => {
    if (!aberto) { setLancadas([]); limparAvisos() }
  }, [aberto])

  // mantém uma nota selecionada enquanto houver pendentes
  useEffect(() => {
    if (fila.pendentes.some((p) => p.id === atualId)) return
    setAtualId(fila.pendentes[0]?.id ?? null)
  }, [fila.pendentes, atualId])

  // miniatura da foto (vem do banco: funciona até depois de atualizar a página ou em outro aparelho)
  const atual = fila.pendentes.find((p) => p.id === atualId)
  useEffect(() => {
    setPrevia(null)
    if (atual?.origem === 'foto') buscarPrevia(atual.id).then(setPrevia)
  }, [atual?.id, atual?.origem])

  const descartar = async (n: NotaImportada) => {
    const ok = await confirmar({
      titulo: 'Descartar esta leitura?',
      texto: <p>A nota <strong>{n.emitente}</strong> {n.numero ? `nº ${n.numero}` : ''} ({brl(n.total)}) sai da lista de conferência e <strong>não</strong> é lançada. Fica registrado na auditoria.</p>,
      confirmar: 'Descartar',
      perigo: true,
    })
    if (!ok) return
    try {
      await descartarNota(n.id)
      avisar('Leitura descartada.', 'info')
    } catch (e) {
      avisar(mensagemErro(e), 'erro')
    }
  }

  const proxima = () => {
    const ids = fila.pendentes.map((p) => p.id)
    const i = ids.indexOf(atualId ?? -1)
    setAtualId(ids[(i + 1) % ids.length] ?? null)
  }

  const total = fila.lendo.length + fila.pendentes.length + lancadas.length + fila.erros.length

  return (
    <Modal aberto={aberto} aoFechar={aoFechar} gaveta largo titulo="Importar nota fiscal"
      rodape={!atual && <Botao variante="primario" onClick={aoFechar}>{lancadas.length ? 'Concluir' : 'Fechar'}</Botao>}>
      <div className="importar">
        <div
          className={`zona-arquivos ${arrastando ? 'arrastando' : ''} ${total ? 'compacta' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastando(false); adicionarArquivos(e.dataTransfer.files) }}
        >
          {!total && (
            <>
              <strong>Arraste aqui o XML, o PDF ou a foto da nota</strong>
              <span>Pode mandar várias de uma vez. O XML é lido na hora e sem custo; foto e PDF são lidos por inteligência artificial. Tudo que for lido fica guardado até ser conferido — pode fechar esta janela sem perder nada.</span>
            </>
          )}
          {total > 0 && <span className="zona-dica">As notas lidas ficam guardadas até serem lançadas ou descartadas.</span>}
          <div className="zona-botoes">
            <Botao onClick={() => inputArq.current?.click()}>{total ? '+ Mais arquivos' : 'Escolher arquivos'}</Botao>
            <Botao onClick={() => inputFoto.current?.click()}>📷 Tirar foto</Botao>
          </div>
          <input ref={inputArq} type="file" hidden multiple accept=".xml,text/xml,application/xml,application/pdf,image/*"
            onChange={(e) => { adicionarArquivos(e.target.files); e.target.value = '' }} />
          <input ref={inputFoto} type="file" hidden accept="image/*" capture="environment"
            onChange={(e) => { adicionarArquivos(e.target.files); e.target.value = '' }} />
        </div>

        {total > 0 && (
          <div className="fila-notas">
            {fila.pendentes.map((p) => (
              <button key={`p${p.id}`} type="button" className={`fila-item estado-pronta ${p.id === atualId ? 'ativo' : ''}`} onClick={() => setAtualId(p.id)}
                title={`Lida em ${dataHoraBR(p.criado_em)}${p.criado_por && perfis.get(p.criado_por) ? ` por ${perfis.get(p.criado_por)}` : ''}`}>
                <span className="fila-icone">{p.origem === 'xml' ? 'XML' : 'IA'}</span>
                <span className="fila-texto">
                  <strong>{p.emitente || p.arquivo}</strong>
                  <small>{p.nota.itens.length} itens · {brl(p.total)}{p.rascunho ? ' · em conferência' : ''}</small>
                </span>
              </button>
            ))}
            {fila.lendo.map((l) => (
              <div key={`l${l.id}`} className="fila-item estado-lendo">
                <span className="fila-icone"><span className="spinner" /></span>
                <span className="fila-texto"><strong>{l.nome}</strong><small>Lendo…</small></span>
              </div>
            ))}
            {lancadas.map((l) => (
              <div key={`ok${l.id}`} className="fila-item estado-lancada">
                <span className="fila-icone">✓</span>
                <span className="fila-texto"><strong>{l.nome}</strong><small>Lançada · compra #{l.compraId}</small></span>
              </div>
            ))}
          </div>
        )}

        {fila.erros.map((f) => <Alerta key={f.id} tom="erro">{f.erro}</Alerta>)}
        {fila.avisos.map((a, i) => <Alerta key={i} tom="info">{a}</Alerta>)}

        {atual ? (
          <Conferencia
            key={atual.id}
            registro={atual}
            previa={previa}
            quem={atual.criado_por ? perfis.get(atual.criado_por) ?? null : null}
            fornecedores={fornecedores}
            insumos={insumos}
            aoDepois={fila.pendentes.length > 1 ? proxima : null}
            aoDescartar={() => descartar(atual)}
            aoLancar={(compraId) => {
              setLancadas((ls) => [...ls, { id: atual.id, nome: atual.emitente || atual.arquivo || 'Nota', compraId }])
              recarregarPendentes()
              aoSalvar()
            }}
          />
        ) : fila.lendo.length > 0 ? (
          <div className="carregando"><span className="spinner" /> Lendo {fila.lendo.length === 1 ? 'a nota' : `${fila.lendo.length} notas`}… pode fechar esta janela ou ir para outra tela: a leitura continua e a nota fica guardada.</div>
        ) : lancadas.length > 0 ? (
          <Alerta tom="ok">{lancadas.length} nota(s) lançada(s). O estoque e os custos dos insumos já foram atualizados.</Alerta>
        ) : null}
      </div>
    </Modal>
  )
}

// =====================================================================
// Conferência de uma nota
// =====================================================================
function Conferencia({ registro, previa, quem, fornecedores, insumos, aoDepois, aoDescartar, aoLancar }: {
  registro: NotaImportada
  previa: string | null
  quem: string | null
  fornecedores: Fornecedor[]
  insumos: Insumo[]
  aoDepois: (() => void) | null
  aoDescartar: () => void
  aoLancar: (compraId: number) => void
}) {
  const nota: NotaLida = registro.nota
  const salvo = registro.rascunho as Rascunho | null
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
  const [forn, setForn] = useState<number | 'novo' | 'avulso'>(() => salvo?.forn ?? casarFornecedor())
  const fornPorCnpj = forn !== 'novo' && forn !== 'avulso' && !!soDigitos(nota.emitente.documento) && soDigitos(fornecedores.find((f) => f.id === forn)?.documento) === soDigitos(nota.emitente.documento)
  const [novoNome, setNovoNome] = useState(() => salvo?.novoNome ?? tituloCaso(nota.emitente.fantasia || nota.emitente.nome))
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

  const [linhas, setLinhas] = useState<Linha[]>(() => {
    const daNota = (salvo?.linhas ?? []).filter((l) => !l.manual)
    const manuais = (salvo?.linhas ?? []).filter((l) => l.manual && l.item) as Linha[]
    return [
      ...(daNota.length === nota.itens.length ? nota.itens.map((item, k) => ({ ...daNota[k], item })) : montarLinhas()),
      ...manuais,
    ]
  })
  // com rascunho: mantém as escolhas salvas enquanto o fornecedor for o mesmo
  const fornRestaurado = useRef<typeof forn | null>(salvo ? salvo.forn : null)
  useEffect(() => {
    if (fornRestaurado.current !== null && fornRestaurado.current === forn) return
    fornRestaurado.current = null
    setLinhas((ls) => [
      ...montarLinhas().map((n, k) => ({ ...n, qtdTxt: ls[k]?.qtdTxt, precoTxt: ls[k]?.precoTxt })),
      ...ls.filter((l) => l.manual),
    ])
  }, [montarLinhas, forn])

  const alterar = (k: number, mud: Partial<Linha>) => setLinhas((ls) => ls.map((l, i) => (i === k ? { ...l, ...mud } : l)))
  const escolherDestino = (k: number, valor: string) => {
    const l = linhas[k]
    if (valor === 'avulso') return alterar(k, { destino: 'avulso', fator: '1', origem: null, fatorIncerto: false })
    if (!valor) return alterar(k, { destino: '', origem: null })
    const ins = insumo(Number(valor))!
    if (l.manual) return alterar(k, { destino: ins.id, categoria: ins.categoria, fator: '1', origem: null, fatorIncerto: false, item: { ...l.item, unidade: ins.unidade, descricao: l.item.descricao || ins.nome } })
    const f = sugerirFator(l.item, ins.unidade)
    alterar(k, { destino: ins.id, categoria: ins.categoria, fator: String(f.fator).replace('.', ','), origem: null, fatorIncerto: !f.certeza })
  }

  const adicionarItem = () => setLinhas((ls) => [...ls, {
    item: { codigo: null, descricao: '', unidade: 'un', quantidade: 1, valor_unitario: 0, valor_total: 0 },
    incluir: true, destino: '', categoria: 'Outros', fator: '1', origem: null, fatorIncerto: false, manual: true, qtdTxt: '1', precoTxt: '',
  }])
  const removerItem = (k: number) => setLinhas((ls) => ls.filter((_, i) => i !== k))

  // ---- cabeçalho e pagamento
  const aPrazo = nota.vencimentos.length > 0
  const [data, setData] = useState(salvo?.data ?? (nota.data || hoje()))
  const [numero, setNumero] = useState(salvo?.numero ?? nota.numero ?? '')
  const [status, setStatus] = useState<StatusCompra>(salvo?.status ?? (aPrazo ? 'a_pagar' : 'paga'))
  const [vencimento, setVencimento] = useState(salvo?.vencimento ?? nota.vencimentos[0]?.data ?? '')
  const [forma, setForma] = useState(salvo?.forma ?? (nota.forma_pagamento && FORMAS_COMPRA.includes(nota.forma_pagamento) ? nota.forma_pagamento : nota.forma_pagamento ? 'Pix' : aPrazo ? 'Boleto' : ''))
  const [frete, setFrete] = useState(salvo?.frete ?? valorParaCampo(nota.frete))
  const [desconto, setDesconto] = useState(salvo?.desconto ?? valorParaCampo(nota.desconto))
  const [lancarCaixa, setLancarCaixa] = useState(salvo?.lancarCaixa ?? false)
  const [salvoEm, setSalvoEm] = useState<string | null>(salvo ? 'restaurado' : null)

  // ---- salva sozinho cada ajuste (sobrevive a fechar a janela, atualizar a página ou trocar de aparelho)
  const primeiraVez = useRef(true)
  const lancando = useRef(false)
  useEffect(() => {
    if (primeiraVez.current) { primeiraVez.current = false; return }
    const r: Rascunho = {
      forn, novoNome, data, numero, status, vencimento, forma, frete, desconto, lancarCaixa,
      linhas: linhas.map(({ item, ...resto }) => (resto.manual ? { ...resto, item } : resto)),
    }
    const t = setTimeout(async () => {
      if (lancando.current) return
      if (await salvarRascunho(registro.id, r as unknown as Record<string, unknown>)) {
        setSalvoEm(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))
      }
    }, 700)
    return () => clearTimeout(t)
  }, [forn, novoNome, data, numero, status, vencimento, forma, frete, desconto, lancarCaixa, linhas, registro.id])
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
  const somaItens = Math.round(incluidas.reduce((s, l) => s + efetivo(l).total, 0) * 100) / 100
  const corrigidos = incluidas.filter((l) => efetivo(l).editado)
  const manuais = incluidas.filter((l) => l.manual)
  const total = Math.round((somaItens + lerValor(frete) - lerValor(desconto)) * 100) / 100
  const semDestino = incluidas.filter((l) => l.destino === '').length
  const difNota = Math.round((total - nota.total) * 100) / 100

  const lancar = async () => {
    setErro(null)
    if (duplicada) return setErro(`Esta nota já foi lançada (compra #${duplicada.id}).`)
    if (!incluidas.length) return setErro('Nenhum item marcado para lançar.')
    const manualRuim = manuais.findIndex((l) => !l.item.descricao.trim() || efetivo(l).total <= 0)
    if (manualRuim >= 0) return setErro('No item incluído à mão, preencha a descrição, a quantidade e o valor (ou remova o item).')
    if (semDestino) return setErro(`Escolha o insumo (ou "não é insumo") em ${semDestino} ${semDestino === 1 ? 'item' : 'itens'}.`)
    if (forn === 'novo' && !novoNome.trim()) return setErro('Informe o nome do novo fornecedor.')
    if (status === 'a_pagar' && !vencimento) return setErro('Informe o vencimento.')
    if (Math.abs(difNota) >= 0.01) {
      const ok = await confirmar({
        titulo: 'Total diferente da nota',
        texto: <p>O total a lançar ({brl(total)}) está diferente do total da nota ({brl(nota.total)}), diferença de {brl(Math.abs(difNota))}. {manuais.length ? 'Você incluiu itens que não estavam na nota.' : corrigidos.length ? 'Você corrigiu valores de itens.' : incluidas.length < linhas.length ? 'Você desmarcou itens.' : 'Confira frete e desconto.'} Lançar assim mesmo?</p>,
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
      lancando.current = true
      const { data: id, error } = await supabase.rpc('lancar_nota_importada', {
        p_nota_id: registro.id,
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
          observacao: [
            `Importada de ${nota.origem === 'xml' ? 'XML' : 'foto/PDF'} (${nota.arquivo})`,
            parcelas,
            corrigidos.length ? 'Corrigido na conferência: ' + corrigidos.map((l) => {
              const ef = efetivo(l)
              return `${tituloCaso(l.item.descricao)} ${qtd(l.item.quantidade)} × ${brlUnit(l.item.valor_unitario)} → ${qtd(ef.q)} × ${brlUnit(ef.u)}`
            }).join('; ') : '',
            manuais.length ? 'Incluído à mão: ' + manuais.map((l) => `${l.item.descricao.trim()} ${brl(efetivo(l).total)}`).join('; ') : '',
          ].filter(Boolean).join('. '),
        },
        p_itens: incluidas.map((l) => {
          const f = l.destino === 'avulso' ? 1 : fatorNum(l)
          const ef = efetivo(l)
          const q = Math.round(ef.q * f * 1000) / 1000
          const ins = typeof l.destino === 'number' ? insumo(l.destino) : undefined
          return {
            insumo_id: ins?.id ?? null,
            descricao: ins ? ins.nome : l.manual ? l.item.descricao.trim() : tituloCaso(l.item.descricao),
            categoria: ins ? ins.categoria : l.categoria,
            unidade: ins ? ins.unidade : l.item.unidade.toLowerCase(),
            quantidade: q,
            valor_unitario: q ? Math.round((ef.total / q) * 10000) / 10000 : 0,
            codigo_nota: l.item.codigo,
            descricao_nota: l.manual ? `${l.item.descricao.trim()} (incluído à mão)` : l.item.descricao,
            quantidade_nota: ef.q,
            unidade_nota: l.item.unidade,
            chave_mapa: l.manual ? null : chaveMapa(l.item),
            fator: f,
          }
        }),
        p_lancar_caixa: status === 'paga' && forma === 'Dinheiro' && lancarCaixa,
      })
      if (error) { lancando.current = false; throw error }
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
            {' '}em {dataHoraBR(registro.criado_em)}{quem ? ` por ${quem}` : ''}
          </span>
          <span className={`rascunho-status ${salvoEm ? 'ok' : ''}`}>
            {salvoEm === 'restaurado' ? '↺ Conferência retomada de onde parou' : salvoEm ? `✓ Ajustes salvos às ${salvoEm}` : 'Os ajustes são salvos automaticamente'}
          </span>
        </div>
        <div className="conf-total"><span>Total da nota</span><strong>{brl(nota.total)}</strong></div>
      </div>

      {duplicada && <Alerta tom="erro">Esta nota <strong>já foi lançada</strong> na compra #{duplicada.id} de {dataBR(duplicada.data)}. Descarte esta leitura.</Alerta>}
      {nota.avisos.map((a, i) => <Alerta key={i} tom={nota.origem === 'foto' && i === 0 ? 'info' : 'alerta'}>{a}</Alerta>)}

      <div className={nota.origem === 'foto' ? 'conf-com-previa' : ''}>
        {nota.origem === 'foto' && !previa && <div className="previa-nota previa-carregando"><span className="spinner" /></div>}
        {previa && (
          <button type="button" className="previa-nota" onClick={() => abrirImagem(previa)} title="Abrir a foto em tamanho real">
            <img src={previa} alt="Foto da nota" />
            <small>Clique para ampliar</small>
          </button>
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
          <strong>Itens da nota ({linhas.length}{linhas.some((l) => l.manual) ? `, ${linhas.filter((l) => l.manual).length} à mão` : ''})</strong>
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
                const ef = efetivo(l)
                const qEst = ef.q * f
                const mudouUn = !!ins && (Math.abs(f - 1) > 1e-9 || unidadePadrao(l.item.unidade) !== unidadePadrao(ins.unidade))
                return (
                  <tr key={k} className={l.incluir ? '' : 'excluida'}>
                    <td><input type="checkbox" checked={l.incluir} onChange={(e) => alterar(k, { incluir: e.target.checked })} aria-label="Lançar este item" title="Desmarque para não lançar este item" /></td>
                    <td className="item-nota">
                      {l.manual ? (
                        <div className="item-manual">
                          <Selo tom="alerta">incluído à mão</Selo>
                          <Entrada value={l.item.descricao} placeholder="Descrição (ex.: papel acoplado)" aria-label="Descrição do item"
                            onChange={(e) => alterar(k, { item: { ...l.item, descricao: e.target.value } })} />
                        </div>
                      ) : <strong>{l.item.descricao}</strong>}
                      {l.item.codigo && <small>cód. {l.item.codigo}</small>}
                      <div className="valores-item">
                        <Entrada className="entrada n" inputMode="decimal" aria-label="Quantidade" title="Quantidade (pode corrigir)"
                          value={l.qtdTxt ?? numTxt(l.item.quantidade, 3)} onFocus={(e) => e.target.select()}
                          onChange={(e) => alterar(k, { qtdTxt: e.target.value.replace(/[^\d,.]/g, '') })} />
                        <span>{ins && l.manual ? ins.unidade : l.item.unidade} × R$</span>
                        <Entrada className="entrada n" inputMode="decimal" aria-label="Valor unitário" title="Valor unitário (pode corrigir)"
                          value={l.precoTxt ?? precoTxt(l.item.valor_unitario)} onFocus={(e) => e.target.select()} placeholder="0,00"
                          onChange={(e) => alterar(k, { precoTxt: e.target.value.replace(/[^\d,.]/g, '') })} />
                        <b>= {brl(ef.total)}</b>
                      </div>
                      {l.manual && <button className="link link-perigo" onClick={() => removerItem(k)}>remover item</button>}
                      {ef.editado && (
                        <small className="corrigido">
                          corrigido · lido: {qtd(l.item.quantidade)} × {brlUnit(l.item.valor_unitario)} = {brl(l.item.valor_total)}{' '}
                          <button className="link" onClick={() => alterar(k, { qtdTxt: undefined, precoTxt: undefined })}>desfazer</button>
                        </small>
                      )}
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
                          <small className="sub">{brlUnit(qEst ? ef.total / qEst : 0)}/{ins.unidade}
                            {Number(ins.custo_unitario) > 0 && qEst > 0 && (() => {
                              const v = (ef.total / qEst) / Number(ins.custo_unitario) - 1
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
        <Botao variante="fantasma" className="btn-adicionar-item" onClick={adicionarItem}>+ Adicionar item que não está na nota</Botao>
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
        <Botao variante="perigo" onClick={aoDescartar} className="mr-auto">Descartar leitura</Botao>
        {aoDepois && <Botao variante="fantasma" onClick={aoDepois}>Conferir depois</Botao>}
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
