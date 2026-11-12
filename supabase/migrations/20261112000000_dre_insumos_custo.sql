-- =====================================================================
-- DRE: insumos são CUSTO (CMV), não despesa operacional
--  - Item de compra ligado ao cadastro de Insumos → custo da mercadoria
--    (embalagens → linha de embalagens; Limpeza fica em despesa operacional,
--    pois não entra no produto).
--  - Item avulso (sem cadastro): alimentos/bebidas → CMV; embalagens/
--    descartáveis → embalagens; o resto (manutenção, serviços…) → despesa.
-- DREs já gerados guardam a classificação antiga: desfaça e gere de novo.
-- =====================================================================

create or replace function public.dre_grupo_item(p_categoria text, p_insumo boolean)
returns text
language sql immutable
as $$
  select case
    when p_categoria in ('Embalagens', 'Descartáveis') then 'embalagens'
    when p_categoria = 'Limpeza' then 'operacionais'
    when p_insumo then 'cmv'
    when p_categoria in ('Carnes', 'Pães', 'Queijos e frios', 'Hortifruti', 'Molhos', 'Congelados', 'Mercearia', 'Bebidas') then 'cmv'
    else 'operacionais'
  end
$$;

create or replace function public.dre_mes(p_mes date, p_empresa smallint default null)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_ini date := date_trunc('month', p_mes)::date;
  v_fim date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r jsonb;
begin
  if not public.tem_papel('admin') then
    raise exception 'Só o administrador vê o DRE.';
  end if;

  with
  c as (
    select c.*, ca.marketplace
      from public.comandas c join public.canais ca on ca.id = c.canal_id
     where c.data between v_ini and v_fim and c.status <> 'cancelado'
       and (p_empresa is null or c.empresa_id = p_empresa)
  ),
  vendas as (
    select coalesce(sum(valor_comanda), 0) produtos,
           coalesce(sum(taxa_entrega), 0) entregas,
           coalesce(sum(desconto), 0) descontos,
           coalesce(sum(diferenca) filter (where marketplace), 0) comissoes,
           coalesce(sum(diferenca) filter (where not marketplace), 0) diferencas,
           coalesce(sum(valor_pago), 0) recebido,
           coalesce(sum(valor_taxa), 0) taxas,
           coalesce(sum(valor_liquido), 0) liquido,
           count(*) comandas
      from c
  ),
  rep as (
    select origem, sum(valor) valor, count(*) n
      from public.repasses
     where data between v_ini and v_fim and (p_empresa is null or empresa_id = p_empresa)
     group by origem
  ),
  compras as (
    select public.dre_grupo_item(i.categoria, i.insumo_id is not null) grupo, i.categoria,
           (i.insumo_id is not null) as insumo, sum(i.valor_total) valor
      from public.compra_itens i join public.compras co on co.id = i.compra_id
     where co.data between v_ini and v_fim and co.status <> 'cancelada'
       and (p_empresa is null or co.empresa_id = p_empresa)
     group by 1, 2, 3
  ),
  ajustes_compra as (
    select coalesce(sum(frete), 0) - coalesce(sum(desconto), 0) valor
      from public.compras where data between v_ini and v_fim and status <> 'cancelada'
       and (p_empresa is null or empresa_id = p_empresa)
  ),
  caixa as (
    select coalesce(sum(valor) filter (where tipo = 'pagamento_entregador'), 0) entregadores,
           coalesce(sum(valor) filter (where tipo = 'despesa' and compra_id is null), 0) despesas_caixa
      from public.movimentos_caixa where data between v_ini and v_fim
       and (p_empresa is null or empresa_id = p_empresa)
  ),
  manuais as (
    select grupo, sum(valor) valor,
           jsonb_agg(jsonb_build_object('id', l.id, 'descricao', descricao, 'valor', valor, 'empresa', e.nome) order by l.id) itens
      from public.dre_lancamentos l join public.empresas e on e.id = l.empresa_id
     where mes = v_ini and (p_empresa is null or l.empresa_id = p_empresa) group by grupo
  ),
  -- pendências (só fazem sentido para quem tem comandas)
  dias_venda as (
    select distinct data from public.comandas
     where data between v_ini and v_fim and (p_empresa is null or empresa_id = p_empresa)
  ),
  sem_fechamento as (
    select d.data from dias_venda d
      left join public.fechamentos f on f.data = d.data
     where coalesce(f.fechado, false) = false
  ),
  pend as (
    select (select coalesce(jsonb_agg(to_char(data, 'YYYY-MM-DD') order by data), '[]') from sem_fechamento) dias_abertos,
           (select count(*) from public.comandas where data between v_ini and v_fim and status <> 'cancelado' and not conferido
              and (p_empresa is null or empresa_id = p_empresa)) nao_conferidas,
           (select count(*) from public.comandas where data between v_ini and v_fim and status = 'pendente'
              and (p_empresa is null or empresa_id = p_empresa)) pendentes,
           (select count(*) from dias_venda) dias_com_venda,
           (select coalesce(sum(n), 0) from rep) repasses
  )
  select jsonb_build_object(
    'mes', to_char(v_ini, 'YYYY-MM-DD'),
    'empresa', (select jsonb_build_object('id', id, 'nome', nome, 'cnpj', cnpj, 'controla_comandas', controla_comandas)
                  from public.empresas where id = p_empresa),
    'calculado_em', now(),
    'vendas', (select to_jsonb(v) from vendas v),
    'repasses', coalesce((select jsonb_agg(jsonb_build_object('origem', origem, 'valor', valor) order by valor desc) from rep), '[]'),
    'compras', coalesce((select jsonb_agg(jsonb_build_object('grupo', grupo, 'categoria', categoria, 'insumo', insumo, 'valor', valor) order by grupo, valor desc) from compras), '[]'),
    'regra_cmv', 'insumos_cadastrados',
    'ajuste_compras', (select valor from ajustes_compra),
    'caixa', (select to_jsonb(x) from caixa x),
    'manuais', coalesce((select jsonb_object_agg(grupo, jsonb_build_object('valor', valor, 'itens', itens)) from manuais), '{}'),
    'pendencias', (select jsonb_build_object(
        'mes_em_andamento', v_fim >= v_hoje,
        'dias_abertos', dias_abertos,
        'nao_conferidas', nao_conferidas,
        'pendentes', pendentes,
        'dias_com_venda', dias_com_venda,
        'sem_movimento', dias_com_venda = 0 and repasses = 0) from pend),
    'gerado', (select jsonb_build_object('gerado_em', d.gerado_em, 'gerado_por', p.nome)
                 from public.dre_mensal d left join public.perfis p on p.id = d.gerado_por
                where d.mes = v_ini and d.empresa_id = p_empresa)
  ) into r;
  return r;
end;
$$;

grant execute on function public.dre_grupo_item(text, boolean) to authenticated;
