import { useState } from 'react'
import { CadastroGenerico, type CampoDef, type Registro } from '../components/CadastroGenerico'
import { MapaClientes, MapaPonto, useLoja } from '../components/MapaClientes'
import { Botao, Campo, Entrada, Kpi } from '../components/ui'
import { brl, dataBR, hoje, num } from '../lib/format'
import { buscarCep, chaveEndereco, formatarCep, geocodificar, temEndereco, type Loja } from '../lib/geo'

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
  { chave: 'endereco', rotulo: 'Endereço (rua e número)', tipo: 'texto', naLista: false, inteiro: true },
  { chave: 'complemento', rotulo: 'Complemento / referência', tipo: 'texto', naLista: false },
  { chave: 'email', rotulo: 'E-mail', tipo: 'texto', naLista: false },
  { chave: 'documento', rotulo: 'CPF', tipo: 'documento', naLista: false, dica: 'Opcional — para nota fiscal' },
  { chave: 'data_nascimento', rotulo: 'Aniversário', tipo: 'data', naLista: false },
  { chave: 'observacao', rotulo: 'Observações', tipo: 'textarea', naLista: false, dica: 'Ex.: sem cebola, alérgico a…, portão azul' },
  { chave: 'ativo', rotulo: 'Ativo', tipo: 'bool', naLista: false },
]

const PRECISAO: Record<string, string> = {
  endereco: '📍 Posição achada pelo endereço',
  bairro: '📍 Posição aproximada (centro do bairro/CEP) — arraste o pin para a casa do cliente',
  manual: '📍 Posição ajustada à mão',
}

function LocalizacaoCliente({ edit, mudar, loja }: { edit: Registro; mudar: (fn: (r: Registro) => Registro) => void; loja: Loja | null }) {
  const [buscando, setBuscando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const lat = edit.latitude != null ? Number(edit.latitude) : null
  const lng = edit.longitude != null ? Number(edit.longitude) : null
  const mudouEndereco = lat != null && edit.geo_endereco != null && edit.geo_endereco !== chaveEndereco(edit, loja)

  const doCep = async () => {
    const r = await buscarCep(edit.cep)
    if (!r) return
    mudar((e) => ({ ...e, cep: formatarCep(e.cep), endereco: e.endereco || r.endereco, bairro: r.bairro || e.bairro, cidade: r.cidade, uf: r.uf }))
  }
  const buscar = async () => {
    setBuscando(true); setAviso(null)
    try {
      const p = await geocodificar(edit, loja)
      if (p) mudar((e) => ({ ...e, latitude: p.lat, longitude: p.lng, geo_precisao: p.precisao, geo_endereco: chaveEndereco(e, loja) }))
      else setAviso('Não achei esse endereço. Confira rua, bairro e cidade — ou clique no mapa no lugar certo.')
    } catch {
      setAviso('A busca de endereço não respondeu. Tente de novo em instantes.')
    }
    setBuscando(false)
  }
  const centro: [number, number] | null = lat != null && lng != null ? [lat, lng] : loja?.latitude != null && loja.longitude != null ? [loja.latitude, loja.longitude] : null

  return (
    <div className="localizacao-cliente">
      <strong className="secao-form">Localização no mapa</strong>
      <div className="grade-form">
        <Campo rotulo="CEP" dica="Preenche rua, bairro e cidade">
          <Entrada value={String(edit.cep ?? '')} inputMode="numeric" placeholder="00000-000" aria-label="CEP"
            onChange={(e) => { const v = e.target.value; mudar((x) => ({ ...x, cep: v })) }} onBlur={doCep} />
        </Campo>
        <Campo rotulo="Cidade / UF" dica={loja?.cidade ? `Vazio = ${loja.cidade}${loja.uf ? '/' + loja.uf : ''} (cidade da loja)` : undefined}>
          <div className="cidade-uf">
            <Entrada value={String(edit.cidade ?? '')} onChange={(e) => { const v = e.target.value; mudar((x) => ({ ...x, cidade: v })) }} aria-label="Cidade" />
            <Entrada value={String(edit.uf ?? '')} maxLength={2} onChange={(e) => { const v = e.target.value.toUpperCase(); mudar((x) => ({ ...x, uf: v })) }} aria-label="UF" />
          </div>
        </Campo>
      </div>
      <MapaPonto lat={lat} lng={lng} centro={centro}
        aoMover={(la, ln) => mudar((e) => ({ ...e, latitude: la, longitude: ln, geo_precisao: 'manual', geo_endereco: chaveEndereco(e, loja) }))} />
      <div className="localizacao-status">
        <span className="campo-dica">
          {lat == null
            ? (temEndereco(edit) ? 'Ainda sem posição: será buscada pelo endereço ao salvar.' : 'Sem endereço. Preencha o endereço ou clique no mapa no lugar do cliente.')
            : mudouEndereco ? 'O endereço mudou: a posição será buscada de novo ao salvar.'
            : PRECISAO[String(edit.geo_precisao)] ?? '📍 Posição definida'}
          {' · '}clique no mapa ou arraste o pin para corrigir
        </span>
        <Botao onClick={buscar} carregando={buscando} disabled={!temEndereco(edit)}>Buscar pelo endereço</Botao>
      </div>
      {aviso && <p className="campo-erro">{aviso}</p>}
    </div>
  )
}

export function Clientes() {
  const mesAtual = hoje().slice(5, 7)
  const loja = useLoja()

  /** grava CEP/cidade/posição junto e busca a posição quando o endereço mudou */
  const antesDeSalvar = async (dados: Registro, edit: Registro): Promise<Registro> => {
    const r: Registro = {
      ...dados,
      cep: formatarCep(edit.cep) || null,
      cidade: String(edit.cidade ?? '').trim() || null,
      uf: String(edit.uf ?? '').trim().toUpperCase() || null,
      latitude: edit.latitude ?? null,
      longitude: edit.longitude ?? null,
      geo_precisao: edit.geo_precisao ?? null,
      geo_endereco: edit.geo_endereco ?? null,
    }
    const chave = chaveEndereco(r, loja)
    if (r.latitude != null && r.geo_endereco === chave) return r            // posição em dia (achada ou ajustada à mão)
    if (!temEndereco(r)) return r.geo_precisao === 'manual' ? r : { ...r, latitude: null, longitude: null, geo_precisao: null, geo_endereco: null }
    try {
      const p = await geocodificar(r, loja)
      return p
        ? { ...r, latitude: p.lat, longitude: p.lng, geo_precisao: p.precisao, geo_endereco: chave }
        : { ...r, latitude: null, longitude: null, geo_precisao: null, geo_endereco: null }
    } catch {
      return r   // busca fora do ar: grava o resto; o botão "Localizar" do mapa tenta depois
    }
  }

  return (
    <CadastroGenerico
      titulo="Clientes"
      subtitulo="Cadastro nominal — vincule o cliente na comanda para acompanhar quem compra e quanto"
      tabela="clientes"
      leitura="clientes_resumo"
      campos={CAMPOS_CLIENTE}
      modo="formulario"
      ordem={[{ coluna: 'nome' }]}
      busca={['nome', 'telefone', 'bairro', 'email', 'documento', 'cidade', 'cep']}
      nomeItem="Cliente"
      papeisEdicao={['admin', 'gerente', 'caixa']}
      novoPadrao={{ ativo: true }}
      topoDados={(linhas, recarregar) => <MapaClientes linhas={linhas} recarregar={recarregar} />}
      extraFormulario={(edit, mudar) => <LocalizacaoCliente edit={edit} mudar={mudar} loja={loja} />}
      antesDeSalvar={antesDeSalvar}
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
