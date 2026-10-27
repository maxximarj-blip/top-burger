import { CadastroGenerico, type CampoDef } from '../components/CadastroGenerico'
import { Kpi } from '../components/ui'
import { brl, dataBR, hoje, num } from '../lib/format'

const BAIRROS_DICA = 'Ajuda a entender de onde vêm os pedidos'

function linkWhats(tel: unknown) {
  const d = String(tel ?? '').replace(/\D/g, '')
  if (d.length < 10) return null
  return `https://wa.me/55${d}`
}

const CAMPOS_CLIENTE: CampoDef[] = [
  { chave: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true, largura: 180 },
  { chave: 'telefone', rotulo: 'Telefone / WhatsApp', tipo: 'telefone' },
  { chave: 'bairro', rotulo: 'Bairro', tipo: 'texto', dica: BAIRROS_DICA },
  { chave: 'endereco', rotulo: 'Endereço', tipo: 'texto', naLista: false, inteiro: true },
  { chave: 'complemento', rotulo: 'Complemento / referência', tipo: 'texto', naLista: false },
  { chave: 'email', rotulo: 'E-mail', tipo: 'texto', naLista: false },
  { chave: 'documento', rotulo: 'CPF', tipo: 'documento', naLista: false, dica: 'Opcional — para nota fiscal' },
  { chave: 'data_nascimento', rotulo: 'Aniversário', tipo: 'data', naLista: false },
  { chave: 'observacao', rotulo: 'Observações', tipo: 'textarea', naLista: false, dica: 'Ex.: sem cebola, alérgico a…, portão azul' },
  { chave: 'ativo', rotulo: 'Ativo', tipo: 'bool', naLista: false },
]

export function Clientes() {
  const mesAtual = hoje().slice(5, 7)
  return (
    <CadastroGenerico
      titulo="Clientes"
      subtitulo="Cadastro nominal — vincule o cliente na comanda para acompanhar quem compra e quanto"
      tabela="clientes"
      leitura="clientes_resumo"
      campos={CAMPOS_CLIENTE}
      modo="formulario"
      ordem={[{ coluna: 'nome' }]}
      busca={['nome', 'telefone', 'bairro', 'email', 'documento']}
      nomeItem="Cliente"
      papeisEdicao={['admin', 'gerente', 'caixa']}
      novoPadrao={{ ativo: true }}
      colunasExtras={[
        {
          rotulo: 'WhatsApp',
          valor: (l) => {
            const url = linkWhats(l.telefone)
            return url ? <a href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>abrir</a> : ''
          },
        },
        { rotulo: 'Pedidos', valor: (l) => num(Number(l.pedidos ?? 0)), numerica: true },
        { rotulo: 'Total gasto', valor: (l) => brl(Number(l.total_gasto ?? 0)), numerica: true },
        { rotulo: 'Última compra', valor: (l) => (l.ultima_compra ? dataBR(String(l.ultima_compra)) : '—') },
      ]}
      resumo={(ls) => {
        const compraram = ls.filter((l) => Number(l.pedidos) > 0)
        const total = compraram.reduce((s, l) => s + Number(l.total_gasto), 0)
        const aniversariantes = ls.filter((l) => String(l.data_nascimento ?? '').slice(5, 7) === mesAtual)
        return (
          <div className="kpis">
            <Kpi destaque rotulo="Clientes ativos" valor={num(ls.length)} />
            <Kpi rotulo="Já compraram" valor={num(compraram.length)} detalhe={`${brl(total)} no total`} />
            <Kpi rotulo="Ticket médio por cliente" valor={brl(compraram.length ? total / compraram.length : 0)} />
            <Kpi rotulo="Aniversariantes do mês" valor={num(aniversariantes.length)} detalhe={aniversariantes.slice(0, 3).map((a) => String(a.nome).split(' ')[0]).join(', ') || '—'} />
          </div>
        )
      }}
    />
  )
}

export const CATEGORIAS_FORNECEDOR = ['Carnes', 'Pães', 'Queijos e frios', 'Hortifruti', 'Bebidas', 'Embalagens', 'Congelados', 'Mercearia', 'Limpeza', 'Gás', 'Serviços', 'Outros']

const CAMPOS_FORNECEDOR: CampoDef[] = [
  { chave: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true, largura: 180, dica: 'Como vocês chamam o fornecedor' },
  { chave: 'categoria', rotulo: 'Categoria', tipo: 'select', livre: true, opcoes: CATEGORIAS_FORNECEDOR.map((c) => ({ valor: c, rotulo: c })) },
  { chave: 'contato', rotulo: 'Contato', tipo: 'texto' },
  { chave: 'telefone', rotulo: 'Telefone / WhatsApp', tipo: 'telefone' },
  { chave: 'prazo_pagamento_dias', rotulo: 'Prazo (dias)', tipo: 'numero', casas: 0, dica: '0 = à vista' },
  { chave: 'dias_entrega', rotulo: 'Dias de entrega', tipo: 'texto', dica: 'Ex.: ter e sex' },
  { chave: 'razao_social', rotulo: 'Razão social', tipo: 'texto', naLista: false, inteiro: true },
  { chave: 'documento', rotulo: 'CNPJ / CPF', tipo: 'documento', naLista: false },
  { chave: 'email', rotulo: 'E-mail', tipo: 'texto', naLista: false },
  { chave: 'pix', rotulo: 'Chave Pix', tipo: 'texto', naLista: false },
  { chave: 'observacao', rotulo: 'Observações', tipo: 'textarea', naLista: false, dica: 'Pedido mínimo, condições, horário…' },
  { chave: 'ativo', rotulo: 'Ativo', tipo: 'bool', naLista: false },
]

export function Fornecedores() {
  return (
    <CadastroGenerico
      titulo="Fornecedores"
      subtitulo="Quem abastece a cozinha — contatos, prazos e dados de pagamento"
      tabela="fornecedores"
      campos={CAMPOS_FORNECEDOR}
      modo="formulario"
      ordem={[{ coluna: 'nome' }]}
      busca={['nome', 'razao_social', 'documento', 'categoria', 'contato', 'telefone']}
      agruparPor="categoria"
      nomeItem="Fornecedor"
      novoPadrao={{ ativo: true }}
      colunasExtras={[
        {
          rotulo: 'WhatsApp',
          valor: (l) => {
            const url = linkWhats(l.telefone)
            return url ? <a href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>abrir</a> : ''
          },
        },
      ]}
    />
  )
}
