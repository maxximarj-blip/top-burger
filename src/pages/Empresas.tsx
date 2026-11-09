import { CadastroGenerico, type CampoDef } from '../components/CadastroGenerico'
import { recarregarEmpresas } from '../lib/empresas'

const so = (v: unknown) => String(v ?? '').replace(/\D/g, '')

export function cnpjValido(v: unknown) {
  const d = so(v).split('').map(Number)
  if (d.length !== 14 || new Set(d).size === 1) return false
  const dv = (n: number) => {
    const pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2].slice(13 - n)
    const r = d.slice(0, n).reduce((s, x, i) => s + x * pesos[i], 0) % 11
    return r < 2 ? 0 : 11 - r
  }
  return dv(12) === d[12] && dv(13) === d[13]
}

export function cpfValido(v: unknown) {
  const d = so(v).split('').map(Number)
  if (d.length !== 11 || new Set(d).size === 1) return false
  for (const n of [9, 10]) {
    const r = ((d.slice(0, n).reduce((s, x, i) => s + x * (n + 1 - i), 0) * 10) % 11) % 10
    if (r !== d[n]) return false
  }
  return true
}

const CAMPOS: CampoDef[] = [
  { chave: 'nome', rotulo: 'Nome fantasia', tipo: 'texto', obrigatorio: true, largura: 160 },
  { chave: 'cnpj', rotulo: 'CNPJ', tipo: 'documento', obrigatorio: true },
  { chave: 'razao_social', rotulo: 'Razão social', tipo: 'texto', naLista: false, inteiro: true },
  { chave: 'controla_comandas', rotulo: 'Loja com comandas e caixa', tipo: 'bool', dica: 'Desmarcado = franquia/unidade que só recebe repasses' },
  { chave: 'titular_nome', rotulo: 'Titular / responsável', tipo: 'texto' },
  { chave: 'titular_cpf', rotulo: 'CPF do titular', tipo: 'documento', naLista: false },
  { chave: 'titular_nascimento', rotulo: 'Nascimento do titular', tipo: 'data', naLista: false },
  { chave: 'telefone', rotulo: 'Telefone', tipo: 'telefone' },
  { chave: 'email', rotulo: 'E-mail', tipo: 'texto', naLista: false },
  { chave: 'ordem', rotulo: 'Ordem nas listas', tipo: 'numero', naLista: false, casas: 0, dica: 'A primeira é a empresa padrão das compras' },
  { chave: 'ativo', rotulo: 'Ativa', tipo: 'bool', naLista: false },
]

export function Empresas() {
  return (
    <CadastroGenerico
      titulo="Empresas (CNPJ)"
      subtitulo="Cada receita e despesa fica atribuída a um CNPJ. A loja com comandas usa caixa e fechamento; a franquia registra repasses."
      tabela="empresas"
      campos={CAMPOS}
      modo="formulario"
      ordem={[{ coluna: 'ordem' }, { coluna: 'id' }]}
      busca={['nome', 'cnpj', 'razao_social', 'titular_nome']}
      nomeItem="Empresa"
      papeisEdicao={['admin']}
      papeisExclusao={['admin']}
      novoPadrao={{ ativo: true, controla_comandas: false, ordem: 9 }}
      validarExtra={(r) => {
        if (!cnpjValido(r.cnpj)) return 'CNPJ inválido — confira os números.'
        if (r.titular_cpf && !cpfValido(r.titular_cpf)) return 'CPF do titular inválido — confira os números.'
        return null
      }}
      aoSalvar={() => recarregarEmpresas()}
    />
  )
}
