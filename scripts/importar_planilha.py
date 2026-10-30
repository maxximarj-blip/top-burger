#!/usr/bin/env python3
"""
Converte a planilha antiga (aba "Fechamento de Caixa") em um SQL de carga
para o banco do sistema, limpando os erros de digitação mais comuns.

Uso:
    pip install openpyxl
    python scripts/importar_planilha.py "Top Burguers.xlsx" dados/importacao.sql

Depois, cole o conteúdo de dados/importacao.sql no SQL Editor do Supabase.
O script imprime um relatório com tudo que foi corrigido ou ignorado.

SEM DUPLICAR: pode rodar com a planilha inteira sempre que quiser. O SQL só
grava os dias que ainda NÃO têm nenhuma comanda no sistema; dias que já têm
(importados antes ou lançados pelo caixa) ficam de fora e aparecem no
resultado como "já existia". Rodar o mesmo arquivo duas vezes não muda nada.

ATENÇÃO: o arquivo gerado contém dados de vendas. A pasta dados/ está no
.gitignore — não suba esse arquivo para o GitHub.
"""
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime

import openpyxl

ABA = "Fechamento de Caixa"

CANAIS = {"multipedidos": "MultiPedidos", "99": "99", "99.0": "99", "ifood": "iFood"}
MARKETPLACES = {"99", "iFood"}
FORMAS = {
    "online na plataforma": "Online na plataforma",
    "oline na plataforma": "Online na plataforma",
    "online": "Online na plataforma",
    "pix": "Pix",
    "pix na maquina": "Pix",
    "dinheiro": "Dinheiro",
    "debito": "Débito",
    "credito": "Crédito",
    "voucher": "Voucher",
}
ACEITA_MAQUINA = {"Pix", "Débito", "Crédito", "Voucher"}
# máquina+forma com taxa cadastrada no seed
TAXAS = {
    ("Getnet", "Débito"), ("Getnet", "Crédito"), ("Getnet", "Pix"), ("Getnet", "Voucher"),
    ("PagBank", "Débito"), ("PagBank", "Crédito"), ("PagBank", "Pix"),
}
ENTREGA_ESPECIAL = {"ent. plataforma": "delivery_plataforma", "retirada": "retirada", "mesa": "mesa"}


def norm(s):
    if s is None:
        return ""
    s = str(s).strip().lower()
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c))


def sql_str(v):
    if v is None or v == "":
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def sql_num(v):
    if v is None or v == "":
        return "0"
    return f"{round(float(v), 2):.2f}"


def parse_valor(v, campo, notas):
    """Aceita número ou texto ('R$ 12,50'). Texto sem número vira 0 e entra na observação."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    txt = str(v).strip()
    m = re.fullmatch(r"(?:R\$)?\s*(-?[\d.]*\d(?:,\d{1,2})?)", txt)
    if m:
        return float(m.group(1).replace(".", "").replace(",", "."))
    notas.append(f"{campo} digitado como texto: '{txt}'")
    return None


def parse_data(v, avisos, linha):
    if isinstance(v, datetime):
        d = v.date()
    elif isinstance(v, date):
        d = v
    elif isinstance(v, str):
        m = re.match(r"\s*(\d{1,2})/(\d{1,2})/(\d{2,4})", v)
        if not m:
            return None
        d = date(int(m.group(3)) if len(m.group(3)) == 4 else 2000 + int(m.group(3)), int(m.group(2)), int(m.group(1)))
    else:
        return None
    if d.year < 2020:  # 2006, 0206... digitação errada do ano
        corrigida = d.replace(year=2026)
        avisos.append(f"linha {linha}: data {v!r} corrigida para {corrigida:%d/%m/%Y}")
        d = corrigida
    return d


def parse_numero(v):
    """'14- 506013' -> (14, '506013'); 7.0 -> (7, None)"""
    if v is None:
        return None, None
    if isinstance(v, (int, float)):
        return int(v), None
    m = re.match(r"\s*(\d+)\s*[-–]?\s*(.*)$", str(v))
    if not m:
        return None, str(v).strip()
    externo = m.group(2).strip() or None
    return int(m.group(1)), externo


def main(origem, destino):
    wb = openpyxl.load_workbook(origem, data_only=True)
    ws = wb[ABA]

    avisos, ignoradas, pendencias = [], [], []
    registros = []

    for linha, row in enumerate(ws.iter_rows(min_row=2, max_col=17, values_only=True), start=2):
        (data_v, num_v, canal_v, v_comanda, v_pago, v_entrega, entregador_v, forma_v,
         pago_maq, desconto, maquina_v, _taxa, _vtaxa, _liq, _status, obs, _conf) = row

        if data_v is None and num_v is None:
            continue
        if canal_v is None and v_comanda is None and v_pago is None:
            ignoradas.append(f"linha {linha}: comanda {num_v!r} em branco (sem canal/valor)")
            continue

        d = parse_data(data_v, avisos, linha)
        if d is None:
            ignoradas.append(f"linha {linha}: data inválida {data_v!r}")
            continue

        numero, externo = parse_numero(num_v)
        sem_numero = numero is None
        if sem_numero:
            numero = 10**6  # recebe o próximo nº livre do dia mais abaixo
            externo = None
        notas = []
        status = "recebido"
        v_comanda = parse_valor(v_comanda, "valor da comanda", notas)
        v_pago = parse_valor(v_pago, "valor pago", notas)
        v_entrega = parse_valor(v_entrega, "taxa de entrega", notas)
        desconto = parse_valor(desconto, "desconto", notas)

        canal = CANAIS.get(norm(canal_v).replace(",", "."))
        if canal is None:
            canal = "MultiPedidos"
            notas.append("canal não informado na planilha (assumido MultiPedidos)")
            pendencias.append(f"linha {linha}: canal vazio -> MultiPedidos")

        forma = FORMAS.get(norm(forma_v))
        if forma_v is not None and forma is None:
            notas.append(f"forma '{forma_v}' não reconhecida")
        if forma is None:
            status = "pendente"
            notas.append("forma de pagamento não informada na planilha")
            pendencias.append(f"linha {linha}: sem forma de pagamento -> pendente")
        elif forma_v is not None and str(forma_v).strip() != forma and norm(forma_v) != "pix na maquina":
            avisos.append(f"linha {linha}: forma {forma_v!r} corrigida para {forma!r}")

        maquina = None
        maq_txt = (str(maquina_v).strip() if maquina_v else None)
        if forma in ACEITA_MAQUINA and (maq_txt or norm(pago_maq) == "sim"):
            if not maq_txt:
                status = "pendente"
                notas.append("marcado como pago em máquina, mas sem máquina informada")
                pendencias.append(f"linha {linha}: pago em máquina sem máquina -> pendente")
            elif (maq_txt, forma) not in TAXAS:
                status = "pendente"
                notas.append(f"{forma} na {maq_txt}: taxa não cadastrada")
                pendencias.append(f"linha {linha}: {forma} na {maq_txt} sem taxa cadastrada -> pendente")
            else:
                maquina = maq_txt

        ent_norm = norm(entregador_v)
        entregador = None
        if ent_norm in ENTREGA_ESPECIAL:
            modalidade = ENTREGA_ESPECIAL[ent_norm]
        elif ent_norm:
            modalidade = "delivery_proprio"
            entregador = str(entregador_v).strip()
        elif v_entrega:
            modalidade = "delivery_proprio"
            notas.append("entregador não informado")
        elif canal in MARKETPLACES:
            modalidade = "delivery_plataforma"
        else:
            modalidade = "retirada"
            notas.append("modalidade não informada (assumida retirada)")

        if v_pago is None:
            v_pago = v_comanda
            notas.append("valor pago vazio (usado valor da comanda)")
        if v_comanda is None:
            v_comanda = v_pago

        observacao = "; ".join(x for x in [str(obs).strip() if obs else "", *(f"[importação] {n}" for n in notas)] if x)

        if sem_numero:
            notas.append(f"sem número na planilha ({num_v!r})")
            avisos.append(f"linha {linha}: comanda sem número ({num_v!r}) recebeu o próximo nº livre do dia")
        registros.append(dict(
            sem_numero=sem_numero, data=d, numero=numero, externo=externo, canal=canal, modalidade=modalidade, entregador=entregador,
            valor_comanda=v_comanda, taxa_entrega=v_entrega, desconto=desconto, valor_pago=v_pago,
            forma=forma, maquina=maquina, status=status, observacao=observacao or None,
        ))

    # Numeração que reinicia no mesmo dia: as repetidas recebem o próximo nº livre do dia
    maior = defaultdict(int)
    for r in registros:
        if not r["sem_numero"]:
            maior[r["data"]] = max(maior[r["data"]], r["numero"])
    usados = set()
    repetidas = Counter()
    for r in registros:
        if r["sem_numero"]:
            maior[r["data"]] += 1
            r["numero"] = maior[r["data"]]
        elif (r["data"], r["numero"]) in usados:
            maior[r["data"]] += 1
            original = r["numero"]
            r["numero"] = maior[r["data"]]
            nota = f"[importação] nº original na planilha: {original} (numeração reiniciou no mesmo dia — confira a data)"
            r["observacao"] = "; ".join(x for x in [r["observacao"], nota] if x)
            repetidas[r["data"]] += 1
        usados.add((r["data"], r["numero"]))
    for d, n in sorted(repetidas.items()):
        avisos.append(f"{d:%d/%m}: {n} comanda(s) com número repetido renumeradas (nº original guardado na observação)")

    entregadores = sorted({r["entregador"] for r in registros if r["entregador"]})

    with open(destino, "w", encoding="utf-8") as f:
        f.write("-- Carga gerada por scripts/importar_planilha.py\n")
        f.write(f"-- Origem: {origem} | {len(registros)} comandas | gerado em {datetime.now():%d/%m/%Y %H:%M}\n")
        # Tudo num comando só: o SQL Editor do Supabase pode rodar cada comando separado,
        # então nada aqui depende de tabela temporária ou de "begin/commit".
        f.write("-- 1) entregadores que aparecem na planilha\n")
        f.write("insert into public.entregadores (nome) values\n  ")
        f.write(",\n  ".join(f"({sql_str(e)})" for e in entregadores))
        f.write("\non conflict (nome) do nothing;\n\n")
        f.write("-- 2) comandas: só entram os dias que ainda não têm nenhuma comanda no sistema\n"
                "with planilha (data, numero, externo, canal, modalidade, entregador, vc, te, de, vp, forma, maquina, status, obs) as (\n"
                "  values\n")
        linhas = []
        for r in registros:
            linhas.append("  (" + ", ".join([
                sql_str(r["data"].isoformat()) + "::date", str(r["numero"]), sql_str(r["externo"]), sql_str(r["canal"]),
                sql_str(r["modalidade"]), sql_str(r["entregador"]),
                sql_num(r["valor_comanda"]) + "::numeric", sql_num(r["taxa_entrega"]) + "::numeric",
                sql_num(r["desconto"]) + "::numeric", sql_num(r["valor_pago"]) + "::numeric",
                sql_str(r["forma"]), sql_str(r["maquina"]), sql_str(r["status"]), sql_str(r["observacao"]),
            ]) + ")")
        f.write(",\n".join(linhas))
        f.write("\n),\n"
                "modo as (select set_config('topburguer.importando', 'on', true) as ok),\n"
                "ja_existia as (\n"
                "  select data, count(*) as qtd from public.comandas where data in (select distinct data from planilha) group by data\n"
                "),\n"
                "gravadas as (\n"
                "  insert into public.comandas (data, numero, codigo_externo, canal_id, modalidade, entregador_id,\n"
                "    valor_comanda, taxa_entrega, desconto, valor_pago, forma_pagamento_id, maquina_id, status, observacao)\n"
                "  select v.data, v.numero, v.externo, c.id, v.modalidade::public.modalidade, e.id,\n"
                "    v.vc, v.te, v.de, v.vp, f.id, m.id, v.status::public.status_comanda, v.obs\n"
                "  from modo, planilha v\n"
                "  join public.canais c on c.nome = v.canal\n"
                "  left join public.entregadores e on e.nome = v.entregador\n"
                "  left join public.formas_pagamento f on f.nome = v.forma\n"
                "  left join public.maquinas m on m.nome = v.maquina\n"
                "  where modo.ok = 'on' and v.data not in (select data from ja_existia)\n"
                "  on conflict (data, numero) do nothing\n"
                "  returning data\n"
                "),\n"
                "por_dia as (select data, count(*) as qtd from gravadas group by data)\n"
                "select to_char(p.data, 'DD/MM/YYYY') as dia, count(*) as comandas_na_planilha,\n"
                "  'R$ ' || translate(to_char(sum(p.vp), 'FM999,990.00'), ',.', '.,') as valor_pago,\n"
                "  case when g.data is not null then 'IMPORTADO (' || g.qtd || ')'\n"
                "       when j.qtd = count(*) then 'já existia (' || j.qtd || ' no sistema) - ok'\n"
                "       when j.data is not null then 'já existia, NÃO importado: sistema tem ' || j.qtd || ', planilha tem ' || count(*) || ' - conferir'\n"
                "       else 'não gravado - avise' end as situacao\n"
                "from planilha p\n"
                "left join ja_existia j on j.data = p.data\n"
                "left join por_dia g on g.data = p.data\n"
                "group by p.data, j.data, j.qtd, g.data, g.qtd order by p.data;\n")

    # Relatório
    print(f"\n✔ {len(registros)} comandas exportadas para {destino}")
    print(f"  período: {min(r['data'] for r in registros):%d/%m/%Y} a {max(r['data'] for r in registros):%d/%m/%Y}")
    print(f"  por canal: {dict(Counter(r['canal'] for r in registros))}")
    print(f"  por status: {dict(Counter(r['status'] for r in registros))}")
    for titulo, lista in [("Correções automáticas", avisos), ("Viraram PENDENTE (revisar no sistema)", pendencias),
                          ("Linhas ignoradas", ignoradas)]:
        print(f"\n{titulo}: {len(lista)}")
        for x in lista[:200]:
            print("  -", x)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
