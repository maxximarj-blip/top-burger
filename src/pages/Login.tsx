import { useState, type FormEvent } from 'react'
import { Alerta, Botao, Campo, Entrada } from '../components/ui'
import { useAuth } from '../lib/auth'
import { mensagemErro, supabase } from '../lib/supabase'

export function Login() {
  const { entrar, erroPerfil } = useAuth()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [modo, setModo] = useState<'entrar' | 'esqueci'>('entrar')
  const [enviado, setEnviado] = useState(false)

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setErro(null)
    setEnviando(true)
    try {
      if (modo === 'entrar') {
        await entrar(email, senha)
      } else {
        const volta = `${window.location.origin}${window.location.pathname}?recuperar=1`
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: volta })
        if (error) throw error
        setEnviado(true)
      }
    } catch (err) {
      setErro(mensagemErro(err))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="tela-login">
      <form className="login-cartao" onSubmit={enviar}>
        <div className="login-marca">
          <img src="./favicon.svg" alt="" width={56} height={56} />
          <div>
            <h1>Top Burguer</h1>
            <p>Gestão da hamburgueria</p>
          </div>
        </div>

        {(erro || erroPerfil) && <Alerta tom="erro">{erro || erroPerfil}</Alerta>}

        {modo === 'esqueci' && enviado ? (
          <Alerta tom="ok">Se o e-mail estiver cadastrado, você vai receber um link para criar uma nova senha.</Alerta>
        ) : (
          <>
            <Campo rotulo="E-mail">
              <Entrada type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </Campo>
            {modo === 'entrar' && (
              <Campo rotulo="Senha">
                <Entrada type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
              </Campo>
            )}
            <Botao variante="primario" type="submit" carregando={enviando} className="btn-bloco">
              {modo === 'entrar' ? 'Entrar' : 'Enviar link de recuperação'}
            </Botao>
          </>
        )}

        <button
          type="button"
          className="link"
          onClick={() => {
            setModo(modo === 'entrar' ? 'esqueci' : 'entrar')
            setErro(null)
            setEnviado(false)
          }}
        >
          {modo === 'entrar' ? 'Esqueci minha senha' : '← Voltar para o login'}
        </button>
      </form>
    </div>
  )
}

export function RedefinirSenha() {
  const { concluirRecuperacao } = useAuth()
  const [senha, setSenha] = useState('')
  const [conf, setConf] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const salvar = async (e: FormEvent) => {
    e.preventDefault()
    if (senha.length < 8) return setErro('A senha precisa ter pelo menos 8 caracteres.')
    if (senha !== conf) return setErro('As senhas não conferem.')
    setEnviando(true)
    const { error } = await supabase.auth.updateUser({ password: senha })
    setEnviando(false)
    if (error) return setErro(mensagemErro(error))
    concluirRecuperacao()
  }

  return (
    <div className="tela-login">
      <form className="login-cartao" onSubmit={salvar}>
        <h1>Criar nova senha</h1>
        {erro && <Alerta tom="erro">{erro}</Alerta>}
        <Campo rotulo="Nova senha" dica="Mínimo de 8 caracteres">
          <Entrada type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} autoFocus />
        </Campo>
        <Campo rotulo="Repita a senha">
          <Entrada type="password" autoComplete="new-password" value={conf} onChange={(e) => setConf(e.target.value)} />
        </Campo>
        <Botao variante="primario" type="submit" carregando={enviando} className="btn-bloco">Salvar senha</Botao>
      </form>
    </div>
  )
}
