export type Papel = 'admin' | 'gerente' | 'caixa'
export type StatusComanda = 'recebido' | 'pendente' | 'cancelado'
export type Modalidade = 'delivery_proprio' | 'delivery_plataforma' | 'retirada' | 'mesa'
export type TipoMovimento = 'suprimento' | 'sangria' | 'despesa' | 'pagamento_entregador'

export interface Perfil {
  id: string
  nome: string
  email: string
  papel: Papel
  ativo: boolean
  criado_em: string
}

export interface Canal {
  id: number
  nome: string
  marketplace: boolean
  ativo: boolean
  ordem: number
}

export interface FormaPagamento {
  id: number
  nome: string
  online: boolean
  aceita_maquina: boolean
  ativo: boolean
  ordem: number
}

export interface Maquina {
  id: number
  nome: string
  ativo: boolean
}

export interface MaquinaTaxa {
  id: number
  maquina_id: number
  forma_pagamento_id: number
  taxa_pct: number
  repasse_dias_uteis: number
  vigente_desde: string
}

export interface Entregador {
  id: number
  nome: string
  telefone: string | null
  pix: string | null
  ativo: boolean
}

export interface Comanda {
  id: number
  data: string
  numero: number
  codigo_externo: string | null
  canal_id: number
  modalidade: Modalidade
  entregador_id: number | null
  valor_comanda: number
  taxa_entrega: number
  desconto: number
  valor_pago: number
  forma_pagamento_id: number | null
  maquina_id: number | null
  taxa_pct: number
  valor_taxa: number
  valor_liquido: number
  data_prevista_recebimento: string | null
  diferenca: number
  status: StatusComanda
  observacao: string | null
  conferido: boolean
  conferido_por: string | null
  conferido_em: string | null
  criado_por: string | null
  criado_em: string
  atualizado_por: string | null
  atualizado_em: string | null
}

export type ComandaInput = Pick<
  Comanda,
  | 'data' | 'numero' | 'codigo_externo' | 'canal_id' | 'modalidade' | 'entregador_id'
  | 'valor_comanda' | 'taxa_entrega' | 'desconto' | 'valor_pago' | 'forma_pagamento_id'
  | 'maquina_id' | 'status' | 'observacao' | 'conferido'
>

export interface MovimentoCaixa {
  id: number
  data: string
  tipo: TipoMovimento
  valor: number
  descricao: string
  entregador_id: number | null
  criado_por: string | null
  criado_em: string
}

export interface Fechamento {
  data: string
  fundo_troco: number
  dinheiro_contado: number | null
  dinheiro_esperado: number | null
  diferenca_caixa: number | null
  observacao: string | null
  fechado: boolean
  fechado_por: string | null
  fechado_em: string | null
}

// ---- Relatórios ----
export interface Kpis {
  comandas: number
  valor_comanda: number
  valor_pago: number
  valor_taxa: number
  valor_liquido: number
  taxa_entrega: number
  desconto: number
  comandas_desconto: number
  ticket_medio: number
  pendentes: number
  nao_conferidas: number
  divergencias: number
  comissao_plataformas: number
}

export interface Relatorio {
  kpis: Kpis
  por_dia: { data: string; comandas: number; valor_pago: number; valor_liquido: number }[]
  por_canal: {
    canal: string; comandas: number; valor_comanda: number; valor_pago: number
    valor_liquido: number; diferenca: number; ticket_medio: number
  }[]
  por_forma: { forma: string; comandas: number; valor_pago: number; valor_liquido: number }[]
  canal_forma: { canal: string; forma: string; comandas: number; valor_pago: number }[]
  por_maquina: {
    maquina: string; forma: string; comandas: number; valor_pago: number
    valor_taxa: number; valor_liquido: number
  }[]
  por_modalidade: { modalidade: Modalidade; comandas: number; valor_pago: number }[]
  por_dia_semana: { dow: number; comandas: number; valor_pago: number; dias: number }[]
}

export interface ResumoDia {
  data: string
  fundo_troco: number
  vendas_dinheiro: number
  suprimentos: number
  saidas: number
  dinheiro_esperado: number
  fechamento: Fechamento | null
  resumo: Relatorio
}

export interface LinhaEntregador {
  entregador_id: number
  entregador: string
  entregas: number
  taxas_entrega: number
  valor_pedidos: number
  ja_pago: number
  saldo: number
}

export interface LinhaRecebivel {
  data_prevista: string
  maquina: string
  forma: string
  comandas: number
  valor_bruto: number
  valor_taxa: number
  valor_liquido: number
}

export interface Auditoria {
  id: number
  tabela: string
  registro_id: string | null
  acao: 'INSERT' | 'UPDATE' | 'DELETE'
  antes: Record<string, unknown> | null
  depois: Record<string, unknown> | null
  usuario_id: string | null
  usuario: string | null
  em: string
}
