import { Fragment, useCallback, useEffect, useState } from 'react'
import { Alerta, Botao, Cabecalho, Campo, Cartao, Carregando, Entrada, Modal, Selecao, Selo, useAvisos } from '../components/ui'
import { useAuth } from '../lib/auth'
import { dataBR, NOME_PAPEL } from '../lib/format'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Papel, Perfil } from '../lib/types'

/** Chama a Edge Function que usa a chave de serviço (criar usuário / trocar senha de outro usuário) */
async function adminUsuarios(corpo: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('admin-usuarios', { body: corpo })
  if (error) {
    let msg = error.message
    try {
      const ctx = (error as { context?: Response }).context
      if (ctx) msg = (await ctx.json()).erro ?? msg
    } catch { /* corpo não-JSON */ }
    if (/Failed to send|not found|404/i.test(msg)) msg = 'A função "admin-usuarios" não está publicada no Supabase. Veja o README (passo 5).'
    throw new Error(msg)
  }
  return data
}

const PAPEIS: { valor: Papel; descricao: string }[] = [
  { valor: 'caixa', descricao: 'Lança comandas e movimentos do caixa. Não confere, não exclui, não fecha o dia.' },
  { valor: 'gerente', descricao: 'Tudo do caixa + confere, exclui, fecha o dia, cadastros e relatórios.' },
  { valor: 'admin', descricao: 'Tudo + usuários, auditoria e reabrir dia fechado.' },
]

export function Usuarios() {
  const { perfil: eu } = useAuth()
  const { avisar } = useAvisos()
  const [lista, setLista] = useState<Perfil[]>([])
  const [carregando, setCarregando] = useState(true)
  const [novo, setNovo] = useState(false)
  const [edit, setEdit] = useState<Perfil | null>(null)

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('perfis').select('*').order('ativo', { ascending: false }).order('nome')
    if (error) avisar(mensagemErro(error), 'erro')
    setLista((data as Perfil[]) ?? [])
    setCarregando(false)
  }, [avisar])

  useEffect(() => {
    carregar()
  }, [carregar])

  return (
    <div className="pagina">
      <Cabecalho titulo="Usuários" subtitulo="Quem acessa o sistema e o que cada um pode fazer"
        acoes={<Botao variante="primario" onClick={() => setNovo(true)}>+ Novo usuário</Botao>} />
      <Cartao className="sem-padding">
        {carregando ? <Carregando /> : (
          <table className="tabela">
            <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Situação</th><th>Desde</th><th /></tr></thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id} className={p.ativo ? '' : 'cancelada'}>
                  <td className="forte">{p.nome}{p.id === eu?.id && <small className="sub">você</small>}</td>
                  <td>{p.email}</td>
                  <td><Selo tom={p.papel === 'admin' ? 'info' : 'neutro'}>{NOME_PAPEL[p.papel]}</Selo></td>
                  <td><Selo tom={p.ativo ? 'ok' : 'erro'}>{p.ativo ? 'Ativo' : 'Desativado'}</Selo></td>
                  <td>{dataBR(p.criado_em.slice(0, 10))}</td>
                  <td className="n"><button className="link" onClick={() => setEdit(p)}>editar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Cartao>
      <Cartao titulo="Perfis de acesso">
        <dl className="lista-def">
          {PAPEIS.map((p) => <Fragment key={p.valor}><dt>{NOME_PAPEL[p.valor]}</dt><dd>{p.descricao}</dd></Fragment>)}
        </dl>
      </Cartao>
      {novo && <NovoUsuario aoFechar={() => setNovo(false)} aoSalvar={carregar} />}
      {edit && <EditarUsuario perfil={edit} souEu={edit.id === eu?.id} aoFechar={() => setEdit(null)} aoSalvar={carregar} />}
    </div>
  )
}

function NovoUsuario({ aoFechar, aoSalvar }: { aoFechar: () => void; aoSalvar: () => void }) {
  const { avisar } = useAvisos()
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [papel, setPapel] = useState<Papel>('caixa')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const salvar = async () => {
    if (!nome.trim() || !email.trim()) return setErro('Preencha nome e e-mail.')
    if (senha.length < 8) return setErro('A senha inicial precisa ter pelo menos 8 caracteres.')
    setSalvando(true)
    try {
      await adminUsuarios({ acao: 'criar', nome: nome.trim(), email: email.trim(), senha, papel })
      avisar(`Usuário ${nome} criado.`)
      aoSalvar()
      aoFechar()
    } catch (e) {
      setErro(mensagemErro(e))
    }
    setSalvando(false)
  }

  return (
    <Modal aberto aoFechar={aoFechar} titulo="Novo usuário"
      rodape={<><Botao variante="fantasma" onClick={aoFechar}>Cancelar</Botao><Botao variante="primario" onClick={salvar} carregando={salvando}>Criar</Botao></>}>
      {erro && <Alerta tom="erro">{erro}</Alerta>}
      <Campo rotulo="Nome"><Entrada value={nome} onChange={(e) => setNome(e.target.value)} /></Campo>
      <Campo rotulo="E-mail (login)"><Entrada type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Campo>
      <Campo rotulo="Senha inicial" dica="Passe para a pessoa; ela pode trocar em Minha conta."><Entrada value={senha} onChange={(e) => setSenha(e.target.value)} /></Campo>
      <Campo rotulo="Perfil" dica={PAPEIS.find((p) => p.valor === papel)?.descricao}>
        <Selecao value={papel} onChange={(e) => setPapel(e.target.value as Papel)}>
          {PAPEIS.map((p) => <option key={p.valor} value={p.valor}>{NOME_PAPEL[p.valor]}</option>)}
        </Selecao>
      </Campo>
    </Modal>
  )
}

function EditarUsuario({ perfil, souEu, aoFechar, aoSalvar }: { perfil: Perfil; souEu: boolean; aoFechar: () => void; aoSalvar: () => void }) {
  const { avisar } = useAvisos()
  const [nome, setNome] = useState(perfil.nome)
  const [papel, setPapel] = useState<Papel>(perfil.papel)
  const [ativo, setAtivo] = useState(perfil.ativo)
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const salvar = async () => {
    setSalvando(true)
    setErro(null)
    const { error } = await supabase.from('perfis').update({ nome: nome.trim(), papel, ativo }).eq('id', perfil.id)
    if (error) {
      setSalvando(false)
      return setErro(mensagemErro(error))
    }
    if (senha) {
      try {
        await adminUsuarios({ acao: 'senha', id: perfil.id, senha })
      } catch (e) {
        setSalvando(false)
        return setErro(`Dados salvos, mas a senha não foi trocada: ${mensagemErro(e)}`)
      }
    }
    setSalvando(false)
    avisar('Usuário atualizado.')
    aoSalvar()
    aoFechar()
  }

  return (
    <Modal aberto aoFechar={aoFechar} titulo={`Editar ${perfil.nome}`}
      rodape={<><Botao variante="fantasma" onClick={aoFechar}>Cancelar</Botao><Botao variante="primario" onClick={salvar} carregando={salvando}>Salvar</Botao></>}>
      {erro && <Alerta tom="erro">{erro}</Alerta>}
      <Campo rotulo="Nome"><Entrada value={nome} onChange={(e) => setNome(e.target.value)} /></Campo>
      <Campo rotulo="Perfil" dica={souEu ? 'Você não pode mudar o seu próprio perfil.' : undefined}>
        <Selecao value={papel} disabled={souEu} onChange={(e) => setPapel(e.target.value as Papel)}>
          {PAPEIS.map((p) => <option key={p.valor} value={p.valor}>{NOME_PAPEL[p.valor]}</option>)}
        </Selecao>
      </Campo>
      <label className="check"><input type="checkbox" checked={ativo} disabled={souEu} onChange={(e) => setAtivo(e.target.checked)} /> Acesso ativo</label>
      <Campo rotulo="Definir nova senha" dica="Deixe vazio para não alterar (mínimo 8 caracteres)">
        <Entrada value={senha} onChange={(e) => setSenha(e.target.value)} />
      </Campo>
    </Modal>
  )
}
