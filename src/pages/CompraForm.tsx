import { useEffect, useMemo, useState } from 'react'
import { Alerta, Botao, Campo, Entrada, EntradaValor, Modal, Opcoes, Selecao, useAvisos } from '../components/ui'
import { brl, hoje, lerValor, somarDias, valorParaCampo } from '../lib/format'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Compra, CompraItem, Fornecedor, Insumo, StatusCompra } from '../lib/types'

export const FORMAS_COMPRA = ['Pix', 'Boleto', 'Dinheiro', 'Cartão de crédito', 'Cartão de débito', 'Transferência', 'Fiado / conta']
export const CATEGORIAS_AVULSAS = ['Manutenção', 'Serviços', 'Utensílios', 'Limpeza', 'Descartáveis', 'Escritório', 'Outros']

interface LinhaItem {
  chave: number
  insumo_id: number | null // null = item avulso
  avulso: boolean
  descricao: string
  categoria: string
  unidade: string
  quantidade: string
  valor_unitario: string
  modoTotal: boolean // digitando o total da linha em vez do preço unitário
  total: string
  nota?: Pick<CompraItem, 'codigo_nota' | 'descricao_nota' | 'quantidade_nota' | 'unidade_nota'> // como veio na nota fiscal
}

const novaLinha = (): LinhaItem => ({
  chave: Math.random(), insumo_id: null, avulso: false, descricao: '', categoria: 'Outros', unidade: 'un',
  quantidade: '', valor_unitario: '', modoTotal: false, total: '',
})

const num4 = (v: number) => (v ? String(Math.round(v * 10000) / 10000).replace('.', ',') : '')

function totalLinha(l: LinhaItem) {
  if (l.modoTotal) return lerValor(l.total)
  return Math.round(lerValor(l.quantidade) * lerNum(l.valor_unitario) * 100) / 100
}

/** Preço unitário pode ter até 4 casas (ex.: 0,1234) */
function lerNum(txt: string) {
  const limpo = txt.replace(/[^\d,.-]/g, '')
  if (!limpo) return 0
  const n = limpo.includes(',') ? Number(limpo.replace(/\./g, '').replace(',', '.')) : Number(limpo)
  return Number.isFinite(n) ? n : 0
}

function unitarioDe(l: LinhaItem) {
  if (!l.modoTotal) return lerNum(l.valor_unitario)
  const q = lerValor(l.quantidade)
  return q ? Math.round((lerValor(l.total) / q) * 10000) / 10000 : 0
}

export function CompraForm({ aberto, compra, itensIniciais, fornecedores, insumos, aoFechar, aoSalvar }: {
  aberto: boolean
  compra: Compra | null
  itensIniciais: CompraItem[]
  fornecedores: Fornecedor[]
  insumos: Insumo[]
  aoFechar: () => void
  aoSalvar: () => void
}) {
  const { avisar, confirmar } = useAvisos()
  const [data, setData] = useState(hoje())
  const [fornecedorId, setFornecedorId] = useState<number | 0 | -1>(0) // -1 = avulso
  const [fornecedorNome, setFornecedorNome] = useState('')
  const [nota, setNota] = useState('')
  const [linhas, setLinhas] = useState<LinhaItem[]>([novaLinha()])
  const [frete, setFrete] = useState('')
  const [desconto, setDesconto] = useState('')
  const [status, setStatus] = useState<StatusCompra>('paga')
  const [forma, setForma] = useState('Pix')
  const [vencimento, setVencimento] = useState('')
  const [dataPagamento, setDataPagamento] = useState('')
  const [lancarCaixa, setLancarCaixa] = useState(false)
  const [obs, setObs] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!aberto) return
    setErro(null)
    setLancarCaixa(false)
    if (compra) {
      setData(compra.data)
      setFornecedorId(compra.fornecedor_id ?? -1)
      setFornecedorNome(compra.fornecedor_nome ?? '')
      setNota(compra.numero_nota ?? '')
      setFrete(valorParaCampo(compra.frete))
      setDesconto(valorParaCampo(compra.desconto))
      setStatus(compra.status)
      setForma(compra.forma_pagamento ?? '')
      setVencimento(compra.vencimento ?? '')
      setDataPagamento(compra.data_pagamento ?? '')
      setObs(compra.observacao ?? '')
      setLinhas(
        itensIniciais.length
          ? itensIniciais.map((i) => ({
              chave: i.id, insumo_id: i.insumo_id, avulso: i.insumo_id == null, descricao: i.descricao,
              categoria: i.categoria, unidade: i.unidade, quantidade: String(Number(i.quantidade)).replace('.', ','),
              valor_unitario: num4(Number(i.valor_unitario)), modoTotal: false, total: '',
              nota: i.descricao_nota ? { codigo_nota: i.codigo_nota, descricao_nota: i.descricao_nota, quantidade_nota: i.quantidade_nota, unidade_nota: i.unidade_nota } : undefined,
            }))
          : [novaLinha()],
      )
    } else {
      setData(hoje())
      setFornecedorId(0)
      setFornecedorNome('')
      setNota('')
      setFrete('')
      setDesconto('')
      setStatus('paga')
      setForma('Pix')
      setVencimento('')
      setDataPagamento('')
      setObs('')
      setLinhas([novaLinha()])
    }
  }, [aberto, compra, itensIniciais])

  const fornecedor = fornecedores.find((f) => f.id === fornecedorId)

  // Ao escolher "a pagar", sugere o vencimento pelo prazo do fornecedor
  useEffect(() => {
    if (status === 'a_pagar' && !vencimento) setVencimento(somarDias(data, fornecedor?.prazo_pagamento_dias || 7))
  }, [status, fornecedor, data, vencimento])

  // insumos do fornecedor escolhido aparecem primeiro
  const grupos = useMemo(() => {
    const ativos = insumos.filter((i) => i.ativo)
    const doForn = fornecedor ? ativos.filter((i) => i.fornecedor_id === fornecedor.id) : []
    const porCat = new Map<string, Insumo[]>()
    ativos.filter((i) => !doForn.includes(i)).forEach((i) => porCat.set(i.categoria, [...(porCat.get(i.categoria) ?? []), i]))
    return { doForn, porCat: [...porCat.entries()].sort((a, b) => a[0].localeCompare(b[0])) }
  }, [insumos, fornecedor])

  const alterar = (chave: number, mud: Partial<LinhaItem>) => setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, ...mud } : l)))

  const escolherInsumo = (l: LinhaItem, valor: string) => {
    if (valor === 'avulso') return alterar(l.chave, { insumo_id: null, avulso: true, descricao: '', categoria: 'Outros', unidade: 'un' })
    if (!valor) return alterar(l.chave, { insumo_id: null, avulso: false })
    const ins = insumos.find((i) => i.id === Number(valor))
    if (!ins) return
    alterar(l.chave, {
      insumo_id: ins.id, avulso: false, descricao: ins.nome, categoria: ins.categoria, unidade: ins.unidade,
      valor_unitario: l.valor_unitario || num4(Number(ins.custo_unitario)),
    })
  }

  const subtotal = linhas.reduce((s, l) => s + totalLinha(l), 0)
  const total = Math.round((subtotal + lerValor(frete) - lerValor(desconto)) * 100) / 100
  const linhasValidas = linhas.filter((l) => (l.insumo_id || (l.avulso && l.descricao.trim())) && lerValor(l.quantidade) > 0)

  const salvar = async () => {
    setErro(null)
    if (fornecedorId === 0) return setErro('Escolha o fornecedor (ou "Outro / avulso").')
    if (fornecedorId === -1 && !fornecedorNome.trim()) return setErro('Digite o nome do fornecedor avulso.')
    const incompletas = linhas.filter((l) => (l.insumo_id || l.avulso) && !linhasValidas.includes(l))
    if (incompletas.length) return setErro('Há item sem descrição ou sem quantidade. Complete ou remova a linha.')
    if (!linhasValidas.length) return setErro('Inclua pelo menos um item.')
    if (total < 0) return setErro('O desconto é maior que o valor da compra.')
    if (status === 'a_pagar' && !vencimento) return setErro('Informe o vencimento.')

    const aumentos = linhasValidas.filter((l) => {
      const ins = insumos.find((i) => i.id === l.insumo_id)
      return ins && Number(ins.custo_unitario) > 0 && unitarioDe(l) > Number(ins.custo_unitario) * 1.15
    })
    if (aumentos.length) {
      const ok = await confirmar({
        titulo: 'Preço bem acima do último',
        texto: (
          <>
            <p>Estes itens estão mais de 15% acima do último custo cadastrado:</p>
            <ul>
              {aumentos.map((l) => {
                const ins = insumos.find((i) => i.id === l.insumo_id)!
                return <li key={l.chave}><strong>{ins.nome}</strong>: {brl(ins.custo_unitario)} → {brl(unitarioDe(l))} / {ins.unidade}</li>
              })}
            </ul>
            <p>Confira se o preço e a unidade estão certos.</p>
          </>
        ),
        confirmar: 'Está certo, salvar',
      })
      if (!ok) return
    }

    setSalvando(true)
    const { error } = await supabase.rpc('salvar_compra', {
      p_compra: {
        id: compra?.id ?? null,
        data,
        fornecedor_id: fornecedorId > 0 ? fornecedorId : null,
        fornecedor_nome: fornecedorId === -1 ? fornecedorNome.trim() : null,
        numero_nota: nota,
        forma_pagamento: forma,
        status,
        vencimento: status === 'a_pagar' ? vencimento : null,
        data_pagamento: status === 'paga' ? dataPagamento || data : null,
        frete: lerValor(frete),
        desconto: lerValor(desconto),
        observacao: obs,
      },
      p_itens: linhasValidas.map((l) => ({
        insumo_id: l.insumo_id,
        descricao: l.descricao,
        categoria: l.categoria,
        unidade: l.unidade,
        quantidade: lerValor(l.quantidade),
        valor_unitario: unitarioDe(l),
        ...(l.nota ?? {}),
      })),
      p_lancar_caixa: !compra && status === 'paga' && forma === 'Dinheiro' && lancarCaixa,
    })
    setSalvando(false)
    if (error) return setErro(mensagemErro(error))
    avisar(compra ? 'Compra atualizada.' : `Compra de ${brl(total)} lançada. Estoque atualizado.`)
    aoSalvar()
    aoFechar()
  }

  const mudarStatusCompra = async (novo: StatusCompra) => {
    if (!compra) return
    const cancelar = novo === 'cancelada'
    const ok = await confirmar({
      titulo: cancelar ? 'Cancelar esta compra?' : 'Reativar esta compra?',
      texto: cancelar
        ? 'Os itens saem do estoque e a compra deixa de contar nos relatórios. Se ela foi paga com dinheiro da gaveta, a despesa lançada no caixa também é removida. Fica registrado na auditoria.'
        : 'Os itens voltam para o estoque e a compra volta a contar nos relatórios.',
      confirmar: cancelar ? 'Cancelar compra' : 'Reativar',
      perigo: cancelar,
    })
    if (!ok) return
    const { error } = await supabase.from('compras').update({ status: novo }).eq('id', compra.id)
    if (error) return setErro(mensagemErro(error))
    avisar(cancelar ? 'Compra cancelada.' : 'Compra reativada.', 'info')
    aoSalvar()
    aoFechar()
  }

  const excluir = async () => {
    if (!compra) return
    const ok = await confirmar({
      titulo: `Excluir a compra #${compra.id}?`,
      texto: 'Use só para lançamento duplicado ou feito por engano. Os itens saem do estoque e a despesa no caixa (se houver) é removida. Para registrar uma devolução, prefira cancelar.',
      confirmar: 'Excluir',
      perigo: true,
    })
    if (!ok) return
    const { error } = await supabase.from('compras').delete().eq('id', compra.id)
    if (error) return setErro(mensagemErro(error))
    avisar('Compra excluída.', 'info')
    aoSalvar()
    aoFechar()
  }

  const cancelada = compra?.status === 'cancelada'

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      gaveta
      largo
      titulo={compra ? `Compra #${compra.id}${cancelada ? ' (cancelada)' : ''}` : 'Nova compra'}
      rodape={
        <>
          {compra && <Botao variante="perigo" onClick={excluir}>Excluir</Botao>}
          {compra && !cancelada && <Botao variante="fantasma" onClick={() => mudarStatusCompra('cancelada')} className="mr-auto">Cancelar compra</Botao>}
          {compra && cancelada && <Botao variante="fantasma" onClick={() => mudarStatusCompra(compra.vencimento ? 'a_pagar' : 'paga')} className="mr-auto">Reativar</Botao>}
          {!compra && <span className="mr-auto" />}
          <Botao variante="fantasma" onClick={aoFechar}>Fechar</Botao>
          {!cancelada && <Botao variante="primario" onClick={salvar} carregando={salvando}>Salvar compra · {brl(total)}</Botao>}
        </>
      }
    >
      <div className="form-comanda">
        {erro && <Alerta tom="erro">{erro}</Alerta>}
        {cancelada && <Alerta tom="info">Compra cancelada: não conta no estoque nem nos relatórios. Clique em <strong>Reativar</strong> para voltar a valer.</Alerta>}

        <div className="grade-3">
          <Campo rotulo="Data da compra">
            <Entrada type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </Campo>
          <Campo rotulo="Fornecedor" className="span-2-col">
            <Selecao value={fornecedorId} onChange={(e) => setFornecedorId(Number(e.target.value) as number)}>
              <option value={0}>Escolha…</option>
              {fornecedores.filter((f) => f.ativo || f.id === fornecedorId).map((f) => <option key={f.id} value={f.id}>{f.nome}{f.categoria ? ` — ${f.categoria}` : ''}</option>)}
              <option value={-1}>Outro / avulso (mercado, sem cadastro)</option>
            </Selecao>
          </Campo>
        </div>
        <div className="grade-3">
          {fornecedorId === -1 && (
            <Campo rotulo="Nome do fornecedor avulso" className="span-2-col">
              <Entrada value={fornecedorNome} onChange={(e) => setFornecedorNome(e.target.value)} placeholder="Ex.: Supermercado Guanabara" autoFocus />
            </Campo>
          )}
          <Campo rotulo="Nº da nota / cupom" dica="Opcional">
            <Entrada value={nota} onChange={(e) => setNota(e.target.value)} />
          </Campo>
        </div>

        <div className="itens-compra">
          <div className="itens-topo">
            <strong>Itens</strong>
            <span className="campo-dica">Itens ligados a um insumo entram no estoque e atualizam o custo.</span>
          </div>
          <table className="tabela tabela-itens">
            <thead>
              <tr><th>Insumo / item</th><th className="n" style={{ width: 96 }}>Qtd.</th><th style={{ width: 50 }}>Un.</th><th className="n" style={{ width: 130 }}>Preço un.</th><th className="n" style={{ width: 120 }}>Total</th><th style={{ width: 32 }} /></tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.chave}>
                  <td>
                    <Selecao value={l.avulso ? 'avulso' : l.insumo_id ?? ''} onChange={(e) => escolherInsumo(l, e.target.value)} aria-label="Insumo">
                      <option value="">Escolha o insumo…</option>
                      {grupos.doForn.length > 0 && (
                        <optgroup label={`Deste fornecedor`}>
                          {grupos.doForn.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
                        </optgroup>
                      )}
                      {grupos.porCat.map(([cat, is]) => (
                        <optgroup key={cat} label={cat}>
                          {is.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
                        </optgroup>
                      ))}
                      <option value="avulso">+ Outro item (não é insumo)</option>
                    </Selecao>
                    {l.nota?.descricao_nota && <small className="sub">na nota: {l.nota.descricao_nota}{l.nota.quantidade_nota ? ` · ${Number(l.nota.quantidade_nota)} ${l.nota.unidade_nota ?? ''}` : ''}</small>}
                    {l.avulso && (
                      <div className="item-avulso">
                        <Entrada placeholder="Descrição (ex.: conserto da chapa)" value={l.descricao} onChange={(e) => alterar(l.chave, { descricao: e.target.value })} aria-label="Descrição" />
                        <Selecao value={l.categoria} onChange={(e) => alterar(l.chave, { categoria: e.target.value })} aria-label="Categoria">
                          {CATEGORIAS_AVULSAS.map((c) => <option key={c}>{c}</option>)}
                        </Selecao>
                      </div>
                    )}
                  </td>
                  <td><Entrada className="entrada n" inputMode="decimal" value={l.quantidade} onChange={(e) => alterar(l.chave, { quantidade: e.target.value.replace(/[^\d,.]/g, '') })} aria-label="Quantidade" /></td>
                  <td>
                    {l.avulso ? (
                      <Entrada value={l.unidade} onChange={(e) => alterar(l.chave, { unidade: e.target.value })} aria-label="Unidade" />
                    ) : <span className="tenue">{l.insumo_id ? l.unidade : ''}</span>}
                  </td>
                  <td>
                    {l.modoTotal
                      ? <span className="tenue n-bloco">{unitarioDe(l) ? brl(unitarioDe(l)) : '—'}</span>
                      : <EntradaValor valor={l.valor_unitario} aoMudar={(v) => alterar(l.chave, { valor_unitario: v })} aria-label="Preço unitário" />}
                  </td>
                  <td>
                    {l.modoTotal
                      ? <EntradaValor valor={l.total} aoMudar={(v) => alterar(l.chave, { total: v })} aria-label="Total do item" />
                      : <button type="button" className="link total-item" title="Clique para digitar o total da linha" onClick={() => alterar(l.chave, { modoTotal: true, total: valorParaCampo(totalLinha(l)) })}>{brl(totalLinha(l))}</button>}
                  </td>
                  <td className="n">
                    <button type="button" className="btn btn-fantasma btn-icone" title="Remover item" onClick={() => setLinhas((ls) => (ls.length > 1 ? ls.filter((x) => x.chave !== l.chave) : [novaLinha()]))}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Botao onClick={() => setLinhas((ls) => [...ls, novaLinha()])}>+ Adicionar item</Botao>
          <p className="campo-dica">Dica: clique no total de uma linha para digitar o valor total da nota daquele item — o preço unitário é calculado.</p>
        </div>

        <div className="grade-4 resumo-compra">
          <div><span>Itens</span><strong>{brl(subtotal)}</strong></div>
          <Campo rotulo="Frete"><EntradaValor valor={frete} aoMudar={setFrete} /></Campo>
          <Campo rotulo="Desconto"><EntradaValor valor={desconto} aoMudar={setDesconto} /></Campo>
          <div className="total-compra"><span>Total</span><strong>{brl(total)}</strong></div>
        </div>

        <Campo rotulo="Pagamento">
          <Opcoes nome="Pagamento" valor={status === 'cancelada' ? 'paga' : status} aoMudar={(v) => setStatus(v as StatusCompra)}
            opcoes={[{ valor: 'paga', rotulo: 'Já paga' }, { valor: 'a_pagar', rotulo: 'A pagar (vai para Contas a pagar)' }]} />
        </Campo>
        <div className="grade-3">
          <Campo rotulo={status === 'a_pagar' ? 'Forma prevista' : 'Forma de pagamento'}>
            <Selecao value={forma} onChange={(e) => setForma(e.target.value)}>
              <option value="">—</option>
              {FORMAS_COMPRA.map((f) => <option key={f}>{f}</option>)}
            </Selecao>
          </Campo>
          {status === 'a_pagar' ? (
            <Campo rotulo="Vencimento" dica={fornecedor?.prazo_pagamento_dias ? `Prazo do fornecedor: ${fornecedor.prazo_pagamento_dias} dias` : undefined}>
              <Entrada type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
            </Campo>
          ) : (
            <Campo rotulo="Pago em">
              <Entrada type="date" value={dataPagamento || data} onChange={(e) => setDataPagamento(e.target.value)} />
            </Campo>
          )}
        </div>
        {!compra && status === 'paga' && forma === 'Dinheiro' && (
          <label className="check destaque-check">
            <input type="checkbox" checked={lancarCaixa} onChange={(e) => setLancarCaixa(e.target.checked)} />
            <span>O dinheiro saiu da <strong>gaveta do caixa</strong> — registrar como despesa no fechamento de caixa do dia {(dataPagamento || data).split('-').reverse().join('/')}</span>
          </label>
        )}

        <Campo rotulo="Observação">
          <textarea className="entrada" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
        </Campo>
      </div>
    </Modal>
  )
}
