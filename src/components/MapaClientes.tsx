import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useAuth } from '../lib/auth'
import { brl, dataBR, hoje, num } from '../lib/format'
import {
  buscarCep, chaveEndereco, CORES, diasDesde, formatarCep, geocodificar, recencia, ROTULOS, temEndereco,
  type Loja, type Recencia,
} from '../lib/geo'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Registro } from './CadastroGenerico'
import { Alerta, Botao, Campo, Entrada, Modal, useAvisos } from './ui'

// ---- endereço da loja, compartilhado entre o mapa e o formulário do cliente
let lojaAtual: Loja | null = null
const ouvintes = new Set<() => void>()
export async function recarregarLoja() {
  const { data } = await supabase.from('loja').select('*').eq('id', 1).maybeSingle()
  lojaAtual = (data as Loja) ?? null
  ouvintes.forEach((f) => f())
}
export function useLoja() {
  useEffect(() => { recarregarLoja() }, [])
  return useSyncExternalStore((f) => { ouvintes.add(f); return () => ouvintes.delete(f) }, () => lojaAtual)
}

const BRASIL: L.LatLngTuple = [-15.8, -47.9]
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATRIB = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'

function pin(cor: string, tamanho = 30) {
  return L.divIcon({
    className: 'pin-mapa',
    iconSize: [tamanho, tamanho * 1.33],
    iconAnchor: [tamanho / 2, tamanho * 1.33],
    popupAnchor: [0, -tamanho * 1.2],
    html: `<svg viewBox="0 0 24 32" width="${tamanho}" height="${tamanho * 1.33}"><path d="M12 0C5.4 0 0 5.3 0 11.9 0 20.8 12 32 12 32s12-11.2 12-20.1C24 5.3 18.6 0 12 0z" fill="${cor}" stroke="#fff" stroke-width="1.6"/><circle cx="12" cy="12" r="4.3" fill="#fff"/></svg>`,
  })
}
const PIN_LOJA = L.divIcon({
  className: 'pin-mapa pin-loja', iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -16],
  html: '<div class="pin-loja-bola">🍔</div>',
})

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

function popupCliente(c: Registro, hojeIso: string) {
  const d = diasDesde(c.ultima_compra, hojeIso)
  const quando = d == null ? 'nunca comprou' : d === 0 ? 'comprou hoje' : `última compra há ${d} dia${d === 1 ? '' : 's'} (${dataBR(String(c.ultima_compra))})`
  const tel = String(c.telefone ?? '').replace(/\D/g, '')
  const zap = tel.length >= 10 ? `<a href="https://wa.me/55${tel}" target="_blank" rel="noreferrer">WhatsApp</a>` : ''
  const aprox = c.geo_precisao === 'bairro' ? '<div class="popup-aprox">posição aproximada (centro do bairro/CEP)</div>' : ''
  return `<div class="popup-cliente">
    <strong>${esc(c.nome)}</strong>
    <div>${esc([c.endereco, c.bairro].filter(Boolean).join(' · '))}</div>
    <div class="popup-quando">${esc(quando)}</div>
    <div>${num(Number(c.pedidos ?? 0))} pedido(s) · ${brl(Number(c.total_gasto ?? 0))}</div>
    ${aprox}${zap}
  </div>`
}

export function MapaClientes({ linhas, recarregar }: { linhas: Registro[]; recarregar: () => void }) {
  const { pode } = useAuth()
  const { avisar } = useAvisos()
  const gestor = pode('admin', 'gerente')
  const hojeIso = hoje()
  const caixa = useRef<HTMLDivElement>(null)
  const mapa = useRef<L.Map | null>(null)
  const camada = useRef<L.LayerGroup | null>(null)
  const enquadrado = useRef(false)

  const loja = useLoja()
  const [visiveis, setVisiveis] = useState<Record<Recencia, boolean>>({ verde: true, amarelo: true, vermelho: true, sem: true })
  const [oculto, setOculto] = useState(() => { try { return localStorage.getItem('tb-mapa-oculto') === '1' } catch { return false } })
  const [localizando, setLocalizando] = useState<{ feito: number; total: number; achados: number } | null>(null)
  const [editLoja, setEditLoja] = useState(false)


  const ativos = useMemo(() => linhas.filter((l) => l.ativo !== false), [linhas])
  const noMapa = useMemo(() => ativos.filter((l) => l.latitude != null && l.longitude != null), [ativos])
  const semPosicao = useMemo(() => ativos.filter((l) => (l.latitude == null || l.longitude == null) && temEndereco(l)), [ativos])
  const semEndereco = ativos.length - noMapa.length - semPosicao.length
  const contagem = useMemo(() => {
    const c: Record<Recencia, number> = { verde: 0, amarelo: 0, vermelho: 0, sem: 0 }
    noMapa.forEach((l) => { c[recencia(l.ultima_compra, hojeIso)]++ })
    return c
  }, [noMapa, hojeIso])

  // cria o mapa
  useEffect(() => {
    if (oculto || !caixa.current) return
    const m = L.map(caixa.current, { scrollWheelZoom: false, zoomControl: true }).setView(BRASIL, 4)
    L.tileLayer(TILES, { maxZoom: 19, attribution: ATRIB }).addTo(m)
    m.on('focus click', () => m.scrollWheelZoom.enable())
    m.on('mouseout', () => m.scrollWheelZoom.disable())
    camada.current = L.layerGroup().addTo(m)
    mapa.current = m
    enquadrado.current = false
    const ro = new ResizeObserver(() => { if (mapa.current === m) m.invalidateSize({ pan: false }) })
    ro.observe(caixa.current)
    return () => { ro.disconnect(); mapa.current = null; camada.current = null; m.stop(); m.off(); m.remove() }
  }, [oculto])

  // desenha os pins
  useEffect(() => {
    const m = mapa.current, g = camada.current
    if (!m || !g) return
    g.clearLayers()
    const pontos: L.LatLngTuple[] = []
    // vermelhos por baixo, verdes por cima
    const ordem: Recencia[] = ['sem', 'vermelho', 'amarelo', 'verde']
    const porCor = (r: Recencia) => noMapa.filter((l) => recencia(l.ultima_compra, hojeIso) === r)
    for (const r of ordem) {
      if (!visiveis[r]) continue
      for (const c of porCor(r)) {
        const p: L.LatLngTuple = [Number(c.latitude), Number(c.longitude)]
        pontos.push(p)
        L.marker(p, { icon: pin(CORES[r]), title: String(c.nome), riseOnHover: true })
          .bindPopup(popupCliente(c, hojeIso))
          .addTo(g)
      }
    }
    let centroLoja: L.LatLngTuple | null = null
    if (loja?.latitude != null && loja.longitude != null) {
      centroLoja = [loja.latitude, loja.longitude]
      L.marker(centroLoja, { icon: PIN_LOJA, zIndexOffset: 1000, title: loja.nome })
        .bindPopup(`<div class="popup-cliente"><strong>${esc(loja.nome)}</strong><div>${esc([loja.endereco, loja.bairro].filter(Boolean).join(' · '))}</div></div>`)
        .addTo(g)
    }
    if (!enquadrado.current) {
      const todos = centroLoja ? [...pontos, centroLoja] : pontos
      if (todos.length > 1) m.fitBounds(L.latLngBounds(todos).pad(0.12), { maxZoom: 15, animate: false })
      else if (todos.length === 1) m.setView(todos[0], 14, { animate: false })
      if (todos.length) enquadrado.current = true
    }
  }, [noMapa, visiveis, loja, hojeIso, oculto])

  const enquadrar = () => {
    const m = mapa.current
    if (!m) return
    const todos: L.LatLngTuple[] = noMapa.filter((c) => visiveis[recencia(c.ultima_compra, hojeIso)]).map((c) => [Number(c.latitude), Number(c.longitude)])
    if (loja?.latitude != null && loja.longitude != null) todos.push([loja.latitude, loja.longitude])
    if (todos.length > 1) m.fitBounds(L.latLngBounds(todos).pad(0.12), { maxZoom: 15 })
    else if (todos.length === 1) m.setView(todos[0], 14)
  }

  const localizarTodos = async () => {
    const lista = semPosicao
    setLocalizando({ feito: 0, total: lista.length, achados: 0 })
    let achados = 0
    for (let i = 0; i < lista.length; i++) {
      const c = lista[i]
      try {
        const p = await geocodificar(c, loja)
        if (p) {
          const { error } = await supabase.from('clientes').update({
            latitude: p.lat, longitude: p.lng, geo_precisao: p.precisao, geo_endereco: chaveEndereco(c, loja),
          }).eq('id', c.id!)
          if (!error) achados++
        }
      } catch { /* segue para o próximo */ }
      setLocalizando({ feito: i + 1, total: lista.length, achados })
    }
    setLocalizando(null)
    avisar(achados === lista.length ? `${achados} cliente(s) colocados no mapa.` : `${achados} de ${lista.length} colocados no mapa. Os outros: confira o endereço ou arraste o pin no cadastro.`, achados ? 'ok' : 'erro')
    enquadrado.current = false
    recarregar()
  }

  const alternarOculto = () => {
    const v = !oculto
    setOculto(v)
    try { localStorage.setItem('tb-mapa-oculto', v ? '1' : '0') } catch { /* sem armazenamento */ }
  }

  return (
    <section className="cartao mapa-clientes">
      <div className="mapa-topo">
        <div>
          <strong>Mapa de clientes</strong>
          <span className="campo-dica">
            {num(noMapa.length)} de {num(ativos.length)} no mapa
            {semPosicao.length > 0 && ` · ${num(semPosicao.length)} com endereço ainda sem posição`}
            {semEndereco > 0 && ` · ${num(semEndereco)} sem endereço`}
          </span>
        </div>
        <div className="mapa-acoes">
          {!oculto && semPosicao.length > 0 && (
            <Botao variante="primario" onClick={localizarTodos} carregando={!!localizando}>
              {localizando ? `Localizando ${localizando.feito}/${localizando.total}…` : `Localizar ${semPosicao.length}`}
            </Botao>
          )}
          {!oculto && gestor && <Botao onClick={() => setEditLoja(true)}>{loja?.latitude != null ? '🍔 Loja' : '🍔 Marcar a loja'}</Botao>}
          {!oculto && <Botao onClick={enquadrar} title="Mostrar todos os pins">Enquadrar</Botao>}
          <Botao variante="fantasma" onClick={alternarOculto}>{oculto ? 'Mostrar mapa' : 'Ocultar'}</Botao>
        </div>
      </div>

      {!oculto && (
        <>
          <div className="mapa-legenda" role="group" aria-label="Filtrar por última compra">
            {(['verde', 'amarelo', 'vermelho', 'sem'] as Recencia[]).map((r) => (
              <button key={r} className={`legenda-item ${visiveis[r] ? '' : 'desligado'}`} onClick={() => setVisiveis((v) => ({ ...v, [r]: !v[r] }))} aria-pressed={visiveis[r]} title="Clique para mostrar/esconder">
                <span className="legenda-cor" style={{ background: CORES[r] }} />
                {ROTULOS[r]} <b>{num(contagem[r])}</b>
              </button>
            ))}
          </div>
          <div ref={caixa} className="mapa-caixa" />
          {localizando && <p className="campo-dica">Buscando endereços no OpenStreetMap (1 por segundo)… pode continuar usando a tela.</p>}
        </>
      )}

      {editLoja && <FormLoja loja={loja} aoFechar={() => setEditLoja(false)} aoSalvar={() => { setEditLoja(false); enquadrado.current = false; recarregarLoja() }} />}
    </section>
  )
}

function FormLoja({ loja, aoFechar, aoSalvar }: { loja: Loja | null; aoFechar: () => void; aoSalvar: () => void }) {
  const [f, setF] = useState({
    nome: loja?.nome ?? 'Top Burguer', cep: loja?.cep ?? '', endereco: loja?.endereco ?? '', bairro: loja?.bairro ?? '',
    cidade: loja?.cidade ?? '', uf: loja?.uf ?? '',
  })
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const mudar = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }))

  const doCep = async () => {
    const r = await buscarCep(f.cep)
    if (r) setF((x) => ({ ...x, cep: formatarCep(x.cep), endereco: x.endereco || r.endereco, bairro: r.bairro || x.bairro, cidade: r.cidade, uf: r.uf }))
  }

  const salvar = async () => {
    setErro(null)
    if (!f.cidade.trim()) return setErro('Informe a cidade (ou o CEP).')
    setSalvando(true)
    try {
      const p = await geocodificar(f)
      if (!p) { setSalvando(false); return setErro('Não achei esse endereço no mapa. Confira rua e número, ou só o bairro e a cidade.') }
      const { error } = await supabase.from('loja').update({ ...f, cep: formatarCep(f.cep) || null, latitude: p.lat, longitude: p.lng, atualizado_em: new Date().toISOString() }).eq('id', 1)
      if (error) throw error
      aoSalvar()
    } catch (e) {
      setErro(mensagemErro(e))
    }
    setSalvando(false)
  }

  return (
    <Modal aberto aoFechar={aoFechar} titulo="Endereço da loja"
      rodape={<><Botao variante="fantasma" onClick={aoFechar}>Cancelar</Botao><Botao variante="primario" onClick={salvar} carregando={salvando}>Salvar</Botao></>}>
      <p className="campo-dica">A loja aparece no mapa e a cidade dela é usada quando o cliente não tem cidade no cadastro.</p>
      {erro && <Alerta tom="erro">{erro}</Alerta>}
      <div className="grade-form">
        <Campo rotulo="Nome"><Entrada value={f.nome} onChange={(e) => mudar('nome', e.target.value)} /></Campo>
        <Campo rotulo="CEP"><Entrada value={f.cep} inputMode="numeric" onChange={(e) => mudar('cep', e.target.value)} onBlur={doCep} placeholder="00000-000" /></Campo>
        <Campo rotulo="Endereço (rua e número)" className="inteiro"><Entrada value={f.endereco} onChange={(e) => mudar('endereco', e.target.value)} /></Campo>
        <Campo rotulo="Bairro"><Entrada value={f.bairro} onChange={(e) => mudar('bairro', e.target.value)} /></Campo>
        <Campo rotulo="Cidade / UF">
          <div className="cidade-uf">
            <Entrada value={f.cidade} onChange={(e) => mudar('cidade', e.target.value)} />
            <Entrada value={f.uf} maxLength={2} onChange={(e) => mudar('uf', e.target.value.toUpperCase())} aria-label="UF" />
          </div>
        </Campo>
      </div>
    </Modal>
  )
}

/** Mini mapa do formulário do cliente: mostra o pin e deixa arrastar para corrigir. */
export function MapaPonto({ lat, lng, centro, aoMover }: {
  lat: number | null; lng: number | null; centro: [number, number] | null; aoMover: (lat: number, lng: number) => void
}) {
  const caixa = useRef<HTMLDivElement>(null)
  const mapa = useRef<L.Map | null>(null)
  const marca = useRef<L.Marker | null>(null)
  const mover = useRef(aoMover)
  mover.current = aoMover

  useEffect(() => {
    if (!caixa.current) return
    const m = L.map(caixa.current, { scrollWheelZoom: false }).setView(centro ?? BRASIL, centro ? 13 : 4)
    L.tileLayer(TILES, { maxZoom: 19, attribution: ATRIB }).addTo(m)
    m.on('click', (e: L.LeafletMouseEvent) => mover.current(e.latlng.lat, e.latlng.lng))
    mapa.current = m
    const t = setTimeout(() => { if (mapa.current === m) m.invalidateSize({ pan: false }) }, 250)  // o modal ainda está abrindo
    return () => { clearTimeout(t); mapa.current = null; marca.current = null; m.stop(); m.off(); m.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const m = mapa.current
    if (!m) return
    if (lat == null || lng == null) {
      marca.current?.remove(); marca.current = null
      return
    }
    if (!marca.current) {
      marca.current = L.marker([lat, lng], { icon: pin(CORES.verde, 28), draggable: true }).addTo(m)
      marca.current.on('dragend', () => { const p = marca.current!.getLatLng(); mover.current(p.lat, p.lng) })
    } else {
      marca.current.setLatLng([lat, lng])
    }
    if (!m.getBounds().contains([lat, lng]) || m.getZoom() < 14) m.setView([lat, lng], Math.max(m.getZoom(), 16), { animate: false })
  }, [lat, lng])

  return <div ref={caixa} className="mapa-ponto" />
}
