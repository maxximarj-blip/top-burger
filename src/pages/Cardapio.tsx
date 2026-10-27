import { useEffect, useState } from 'react'
import { CadastroGenerico, type CampoDef } from '../components/CadastroGenerico'
import { Kpi, Selo } from '../components/ui'
import { brl, num, pct } from '../lib/format'
import { supabase } from '../lib/supabase'

export const CATEGORIAS_PRODUTO = ['Hambúrgueres', 'Combos', 'Porções', 'Bebidas', 'Sobremesas', 'Adicionais']

const CAMPOS_PRODUTO: CampoDef[] = [
  { chave: 'codigo', rotulo: 'Código', tipo: 'texto', largura: 70 },
  { chave: 'nome', rotulo: 'Produto', tipo: 'texto', obrigatorio: true, largura: 180 },
  { chave: 'categoria', rotulo: 'Categoria', tipo: 'select', livre: true, obrigatorio: true, largura: 160, opcoes: CATEGORIAS_PRODUTO.map((c) => ({ valor: c, rotulo: c })) },
  { chave: 'descricao', rotulo: 'Descrição', tipo: 'textarea', largura: 220 },
  { chave: 'preco', rotulo: 'Preço', tipo: 'dinheiro', largura: 110 },
  { chave: 'custo', rotulo: 'Custo (CMV)', tipo: 'dinheiro', largura: 110 },
  { chave: 'ordem', rotulo: 'Ordem', tipo: 'numero', casas: 0, largura: 70 },
  { chave: 'ativo', rotulo: 'Ativo', tipo: 'bool' },
]

function margem(preco: number, custo: number) {
  return preco > 0 ? (preco - custo) / preco : 0
}

export function Produtos() {
  return (
    <CadastroGenerico
      titulo="Produtos"
      subtitulo="Cardápio da casa — edite preço e custo direto na tabela; a margem recalcula na hora"
      tabela="produtos"
      campos={CAMPOS_PRODUTO}
      modo="planilha"
      ordem={[{ coluna: 'ordem' }, { coluna: 'nome' }]}
      busca={['nome', 'codigo', 'categoria', 'descricao']}
      agruparPor="categoria"
      nomeItem="Produto"
      novoPadrao={{ ativo: true, categoria: 'Hambúrgueres', preco: 0, custo: 0, ordem: 99 }}
      colunasExtras={[
        {
          rotulo: 'Margem',
          numerica: true,
          valor: (l) => {
            const m = margem(Number(l.preco), Number(l.custo))
            return <Selo tom={m >= 0.6 ? 'ok' : m >= 0.45 ? 'alerta' : 'erro'}>{pct(m)}</Selo>
          },
        },
        { rotulo: 'Lucro/un.', numerica: true, valor: (l) => brl(Number(l.preco) - Number(l.custo)) },
      ]}
      destaque={(l) => (Number(l.preco) > 0 && Number(l.custo) >= Number(l.preco) ? 'erro' : null)}
      resumo={(ls) => {
        const comPreco = ls.filter((l) => Number(l.preco) > 0)
        const mMedia = comPreco.length ? comPreco.reduce((s, l) => s + margem(Number(l.preco), Number(l.custo)), 0) / comPreco.length : 0
        const baixa = comPreco.filter((l) => margem(Number(l.preco), Number(l.custo)) < 0.45)
        const burgers = ls.filter((l) => l.categoria === 'Hambúrgueres')
        return (
          <div className="kpis">
            <Kpi destaque rotulo="Produtos ativos" valor={num(ls.length)} detalhe={`${new Set(ls.map((l) => l.categoria)).size} categorias`} />
            <Kpi rotulo="Margem média" valor={pct(mMedia)} detalhe="(preço − custo) ÷ preço" />
            <Kpi rotulo="Margem abaixo de 45%" valor={num(baixa.length)} detalhe={baixa.slice(0, 3).map((b) => String(b.nome)).join(', ') || 'nenhum'} />
            <Kpi rotulo="Preço médio dos burgers" valor={brl(burgers.length ? burgers.reduce((s, l) => s + Number(l.preco), 0) / burgers.length : 0)} />
          </div>
        )
      }}
    />
  )
}

export const CATEGORIAS_INSUMO = ['Carnes', 'Pães', 'Queijos e frios', 'Hortifruti', 'Molhos', 'Congelados', 'Mercearia', 'Bebidas', 'Embalagens', 'Limpeza', 'Outros']
const UNIDADES = ['kg', 'g', 'L', 'ml', 'un', 'pct', 'cx', 'fardo']

export function Insumos() {
  const [fornecedores, setFornecedores] = useState<{ valor: number; rotulo: string }[]>([])

  useEffect(() => {
    supabase.from('fornecedores').select('id, nome').eq('ativo', true).order('nome').then(({ data }) => {
      setFornecedores((data ?? []).map((f) => ({ valor: f.id as number, rotulo: f.nome as string })))
    })
  }, [])

  const campos: CampoDef[] = [
    { chave: 'nome', rotulo: 'Insumo', tipo: 'texto', obrigatorio: true, largura: 200 },
    { chave: 'categoria', rotulo: 'Categoria', tipo: 'select', livre: true, obrigatorio: true, largura: 130, opcoes: CATEGORIAS_INSUMO.map((c) => ({ valor: c, rotulo: c })) },
    { chave: 'unidade', rotulo: 'Un.', tipo: 'select', obrigatorio: true, largura: 80, opcoes: UNIDADES.map((u) => ({ valor: u, rotulo: u })) },
    { chave: 'custo_unitario', rotulo: 'Custo/un.', tipo: 'dinheiro', largura: 110 },
    { chave: 'estoque_atual', rotulo: 'Estoque', tipo: 'numero', largura: 90 },
    { chave: 'estoque_minimo', rotulo: 'Mínimo', tipo: 'numero', largura: 90 },
    { chave: 'fornecedor_id', rotulo: 'Fornecedor', tipo: 'select', largura: 150, opcoes: fornecedores },
    { chave: 'ativo', rotulo: 'Ativo', tipo: 'bool' },
  ]

  const abaixo = (l: Record<string, unknown>) => Number(l.estoque_minimo) > 0 && Number(l.estoque_atual) < Number(l.estoque_minimo)

  return (
    <CadastroGenerico
      key={fornecedores.length}
      titulo="Insumos"
      subtitulo="Matéria-prima e embalagens — atualize o estoque na contagem e o custo a cada compra"
      tabela="insumos"
      campos={campos}
      modo="planilha"
      ordem={[{ coluna: 'categoria' }, { coluna: 'nome' }]}
      busca={['nome', 'categoria']}
      agruparPor="categoria"
      nomeItem="Insumo"
      novoPadrao={{ ativo: true, categoria: 'Outros', unidade: 'un', custo_unitario: 0, estoque_atual: 0, estoque_minimo: 0 }}
      colunasExtras={[
        { rotulo: 'Valor em estoque', numerica: true, valor: (l) => brl(Math.max(0, Number(l.estoque_atual)) * Number(l.custo_unitario)) },
        {
          rotulo: 'Situação',
          valor: (l) => (Number(l.estoque_atual) <= 0 && Number(l.estoque_minimo) > 0
            ? <Selo tom="erro">Zerado</Selo>
            : abaixo(l) ? <Selo tom="alerta">Repor</Selo> : <Selo tom="ok">OK</Selo>),
        },
      ]}
      destaque={(l) => (abaixo(l) ? 'alerta' : null)}
      resumo={(ls) => {
        const repor = ls.filter(abaixo)
        const valor = ls.reduce((s, l) => s + Math.max(0, Number(l.estoque_atual)) * Number(l.custo_unitario), 0)
        return (
          <div className="kpis">
            <Kpi destaque rotulo="Valor em estoque" valor={brl(valor)} detalhe={`${num(ls.length)} insumos ativos`} />
            <Kpi rotulo="Abaixo do mínimo" valor={num(repor.length)} detalhe={repor.slice(0, 3).map((r) => String(r.nome)).join(', ') || 'tudo em dia'} />
            <Kpi rotulo="Sem fornecedor" valor={num(ls.filter((l) => !l.fornecedor_id).length)} detalhe="vincule para saber de quem comprar" />
          </div>
        )
      }}
    />
  )
}
