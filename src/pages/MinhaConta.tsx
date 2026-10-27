import { useState } from 'react'
import { Alerta, Botao, Campo, Entrada, Modal, useAvisos } from '../components/ui'
import { useAuth } from '../lib/auth'
import { NOME_PAPEL } from '../lib/format'
import { mensagemErro, supabase } from '../lib/supabase'

export function MinhaConta({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const { perfil } = useAuth()
  const { avisar } = useAvisos()
  const [senha, setSenha] = useState('')
  const [conf, setConf] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const salvar = async () => {
    setErro(null)
    if (senha.length < 8) return setErro('A senha precisa ter pelo menos 8 caracteres.')
    if (senha !== conf) return setErro('As senhas não conferem.')
    setSalvando(true)
    const { error } = await supabase.auth.updateUser({ password: senha })
    setSalvando(false)
    if (error) return setErro(mensagemErro(error))
    setSenha('')
    setConf('')
    avisar('Senha alterada.')
    aoFechar()
  }

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Minha conta"
      rodape={<Botao variante="primario" onClick={salvar} carregando={salvando} disabled={!senha}>Trocar senha</Botao>}
    >
      <dl className="lista-def">
        <dt>Nome</dt><dd>{perfil?.nome}</dd>
        <dt>E-mail</dt><dd>{perfil?.email}</dd>
        <dt>Perfil</dt><dd>{perfil && NOME_PAPEL[perfil.papel]}</dd>
      </dl>
      <h3>Trocar senha</h3>
      {erro && <Alerta tom="erro">{erro}</Alerta>}
      <div className="grade-2">
        <Campo rotulo="Nova senha">
          <Entrada type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
        </Campo>
        <Campo rotulo="Repita">
          <Entrada type="password" autoComplete="new-password" value={conf} onChange={(e) => setConf(e.target.value)} />
        </Campo>
      </div>
    </Modal>
  )
}
