/**
 * Fila de leitura de notas — vive fora das telas.
 * - A leitura continua mesmo se a pessoa fechar a janela ou trocar de página.
 * - Cada nota lida é gravada no banco (notas_importadas) na hora: nada se perde
 *   ao atualizar a página, fechar o navegador ou trocar de aparelho.
 */
import { useSyncExternalStore } from 'react'
import { hoje } from './format'
import { deLeituraIA, lerXmlNfe, prepararImagem, type LeituraIA, type NotaLida } from './nfe'
import { mensagemErro, supabase } from './supabase'

export interface NotaImportada {
  id: number
  criado_em: string
  criado_por: string | null
  arquivo: string | null
  origem: 'xml' | 'foto'
  chave_nfe: string | null
  emitente: string | null
  numero: string | null
  total: number | null
  nota: NotaLida
  rascunho: Record<string, unknown> | null
}

interface Lendo { id: number; nome: string }
interface ErroLeitura { id: number; nome: string; erro: string }

interface Estado {
  lendo: Lendo[]
  erros: ErroLeitura[]
  pendentes: NotaImportada[]
  carregado: boolean
  avisos: string[]
}

let estado: Estado = { lendo: [], erros: [], pendentes: [], carregado: false, avisos: [] }
const ouvintes = new Set<() => void>()
const fila: { id: number; arquivo: File }[] = []
let processando = false
let seq = 0

function mudar(m: Partial<Estado>) {
  estado = { ...estado, ...m }
  ouvintes.forEach((f) => f())
}

export function useFilaNotas() {
  return useSyncExternalStore(
    (f) => { ouvintes.add(f); return () => ouvintes.delete(f) },
    () => estado,
  )
}

const CAMPOS = 'id, criado_em, criado_por, arquivo, origem, chave_nfe, emitente, numero, total, nota, rascunho'

export async function recarregarPendentes() {
  const { data, error } = await supabase.from('notas_importadas').select(CAMPOS).eq('estado', 'pendente').order('criado_em')
  if (!error) mudar({ pendentes: (data as NotaImportada[]) ?? [], carregado: true })
}

export function limparAvisos() {
  mudar({ erros: [], avisos: [] })
}

export function adicionarArquivos(arquivos: FileList | File[] | null) {
  if (!arquivos) return
  const novos = Array.from(arquivos).map((arquivo) => ({ id: ++seq, arquivo }))
  fila.push(...novos)
  mudar({ lendo: [...estado.lendo, ...novos.map((n) => ({ id: n.id, nome: n.arquivo.name || 'Foto' }))] })
  void processar()
}

async function processar() {
  if (processando) return
  processando = true
  while (fila.length) {
    const { id, arquivo } = fila.shift()!
    const nome = arquivo.name || 'Foto'
    try {
      const nota = await lerArquivo(arquivo)
      if (nota.chave) {
        const ja = estado.pendentes.find((p) => p.chave_nfe === nota.chave)
        if (ja) {
          mudar({ avisos: [...estado.avisos, `${nome}: esta nota já estava aguardando conferência.`] })
          continue
        }
      }
      const previa = arquivo.type.startsWith('image/') ? await miniatura(arquivo) : null
      const { error } = await supabase.from('notas_importadas').insert({
        arquivo: nome,
        origem: nota.origem,
        chave_nfe: nota.chave,
        emitente: nota.emitente.fantasia || nota.emitente.nome,
        numero: nota.numero,
        total: nota.total,
        nota,
        previa,
      })
      if (error) throw new Error(`${nome}: não consegui guardar a leitura (${mensagemErro(error)}).`)
      await recarregarPendentes()
    } catch (e) {
      mudar({ erros: [...estado.erros, { id, nome, erro: e instanceof Error ? e.message : String(e) }] })
    } finally {
      mudar({ lendo: estado.lendo.filter((l) => l.id !== id) })
    }
  }
  processando = false
}

export async function salvarRascunho(id: number, rascunho: Record<string, unknown>) {
  const { error } = await supabase.from('notas_importadas').update({ rascunho, atualizado_em: new Date().toISOString() }).eq('id', id)
  if (!error) mudar({ pendentes: estado.pendentes.map((p) => (p.id === id ? { ...p, rascunho } : p)) })
  return !error
}

export async function descartarNota(id: number) {
  const { data: u } = await supabase.auth.getUser()
  const { error } = await supabase.from('notas_importadas')
    .update({ estado: 'descartada', previa: null, finalizado_por: u.user?.id ?? null, finalizado_em: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
  await recarregarPendentes()
}

export async function buscarPrevia(id: number): Promise<string | null> {
  const { data } = await supabase.from('notas_importadas').select('previa').eq('id', id).maybeSingle()
  return (data as { previa: string | null } | null)?.previa ?? null
}

// ---------------------------------------------------------------------
async function lerArquivo(f: File): Promise<NotaLida> {
  const nome = f.name || 'foto'
  if (/\.xml$/i.test(nome) || f.type.includes('xml')) return lerXmlNfe(await f.text(), nome)
  if (!f.type.startsWith('image/') && f.type !== 'application/pdf') throw new Error(`${nome}: envie XML, PDF ou foto (JPG/PNG).`)
  if (f.size > 15 * 1024 * 1024) throw new Error(`${nome}: arquivo muito grande (máx. 15 MB).`)
  const { base64, tipo } = await prepararImagem(f)
  const { data, error } = await supabase.functions.invoke('ler-nota', { body: { arquivo: base64, tipo } })
  if (error) {
    let msg = error.message
    try {
      const ctx = (error as { context?: Response }).context
      if (ctx) msg = (await ctx.json()).erro ?? msg
    } catch { /* corpo não-JSON */ }
    if (/Failed to send|404|not found/i.test(msg)) msg = 'A leitura por foto não está publicada no Supabase (função "ler-nota"). Veja o README. XML funciona sem ela.'
    throw new Error(`${nome}: ${msg}`)
  }
  return deLeituraIA((data as { nota: LeituraIA }).nota, nome, hoje())
}

/** Miniatura leve da foto para mostrar na conferência (fica no banco até a nota ser lançada) */
async function miniatura(f: File, maxLado = 1100): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(f)
    const escala = Math.min(1, maxLado / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * escala)
    c.height = Math.round(bmp.height * escala)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.72)
  } catch {
    return null
  }
}

/** Abre a miniatura em outra aba (navegadores bloqueiam abrir data: direto) */
export function abrirImagem(dataUrl: string) {
  const [cab, b64] = dataUrl.split(',')
  const tipo = cab.match(/data:(.*?);/)?.[1] ?? 'image/jpeg'
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  window.open(URL.createObjectURL(new Blob([bytes], { type: tipo })), '_blank')
}
