import { useEffect, useRef, useState } from 'react'
import { mensagemErro, supabase } from '../lib/supabase'
import { formatarTelefone } from './CadastroGenerico'
import { Botao, Entrada } from './ui'

export interface ClienteResumo {
  id: number
  nome: string
  telefone: string | null
  bairro: string | null
}

/** Campo de cliente da comanda: busca por nome/telefone e cadastro rápido */
export function BuscaCliente({ valor, aoMudar }: {
  valor: ClienteResumo | null
  aoMudar: (c: ClienteResumo | null) => void
}) {
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState<ClienteResumo[]>([])
  const [aberto, setAberto] = useState(false)
  const [criando, setCriando] = useState(false)
  const [telefone, setTelefone] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const caixa = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = texto.trim()
    if (t.length < 2) {
      setResultados([])
      return
    }
    const id = setTimeout(async () => {
      const digitos = t.replace(/\D/g, '')
      const termo = t.replace(/[%,()]/g, ' ')
      const filtro = digitos.length >= 4 ? `nome.ilike.%${termo}%,telefone.ilike.%${digitos.slice(-4)}%` : `nome.ilike.%${termo}%`
      const { data } = await supabase.from('clientes').select('id, nome, telefone, bairro').eq('ativo', true).or(filtro).order('nome').limit(8)
      setResultados((data as ClienteResumo[]) ?? [])
      setAberto(true)
    }, 250)
    return () => clearTimeout(id)
  }, [texto])

  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [])

  const cadastrar = async () => {
    setErro(null)
    const nome = texto.trim()
    if (nome.length < 2) return setErro('Digite o nome do cliente.')
    const tel = telefone.trim() ? formatarTelefone(telefone) : null
    const { data, error } = await supabase.from('clientes').insert({ nome, telefone: tel }).select('id, nome, telefone, bairro').single()
    if (error) return setErro(mensagemErro(error))
    aoMudar(data as ClienteResumo)
    setCriando(false)
    setTexto('')
    setTelefone('')
  }

  if (valor) {
    return (
      <div className="cliente-escolhido">
        <span>
          <strong>{valor.nome}</strong>
          {(valor.telefone || valor.bairro) && <small className="sub">{[valor.telefone, valor.bairro].filter(Boolean).join(' · ')}</small>}
        </span>
        <button type="button" className="link" onClick={() => aoMudar(null)}>trocar</button>
      </div>
    )
  }

  return (
    <div className="busca-cliente" ref={caixa}>
      <Entrada
        placeholder="Nome ou telefone (opcional)"
        value={texto}
        onChange={(e) => { setTexto(e.target.value); setCriando(false) }}
        onFocus={() => resultados.length && setAberto(true)}
      />
      {aberto && texto.trim().length >= 2 && !criando && (
        <div className="busca-lista">
          {resultados.map((c) => (
            <button type="button" key={c.id} onClick={() => { aoMudar(c); setTexto(''); setAberto(false) }}>
              <strong>{c.nome}</strong>
              <small>{[c.telefone, c.bairro].filter(Boolean).join(' · ')}</small>
            </button>
          ))}
          <button type="button" className="busca-novo" onClick={() => { setCriando(true); setAberto(false) }}>
            + Cadastrar “{texto.trim()}”
          </button>
        </div>
      )}
      {criando && (
        <div className="cliente-rapido">
          <Entrada placeholder="Telefone / WhatsApp" type="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} autoFocus />
          <Botao onClick={cadastrar}>Salvar cliente</Botao>
          <Botao variante="fantasma" onClick={() => setCriando(false)}>Cancelar</Botao>
          {erro && <span className="campo-erro">{erro}</span>}
        </div>
      )}
    </div>
  )
}
