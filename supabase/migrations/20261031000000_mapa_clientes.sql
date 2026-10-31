-- =====================================================================
-- Mapa de clientes
--  - clientes ganham CEP, cidade/UF e posição no mapa (latitude/longitude)
--  - endereço da loja (centro do mapa e cidade padrão das buscas)
-- =====================================================================

alter table public.clientes
  add column if not exists cep           text,
  add column if not exists cidade        text,
  add column if not exists uf            text,
  add column if not exists latitude      double precision,
  add column if not exists longitude     double precision,
  -- 'endereco' = achado pela rua; 'bairro' = aproximado (centro do bairro); 'manual' = pin arrastado
  add column if not exists geo_precisao  text,
  -- endereço que foi usado para achar a posição (para saber quando buscar de novo)
  add column if not exists geo_endereco  text;

alter table public.clientes drop constraint if exists clientes_geo_precisao_ck;
alter table public.clientes add constraint clientes_geo_precisao_ck
  check (geo_precisao is null or geo_precisao in ('endereco', 'bairro', 'manual'));

-- a visão é recriada para incluir as colunas novas
drop view if exists public.clientes_resumo;
create view public.clientes_resumo with (security_invoker = true) as
select cl.*,
       count(c.id) filter (where c.status <> 'cancelado')                         as pedidos,
       coalesce(sum(c.valor_pago) filter (where c.status <> 'cancelado'), 0)      as total_gasto,
       max(c.data) filter (where c.status <> 'cancelado')                         as ultima_compra
  from public.clientes cl
  left join public.comandas c on c.cliente_id = cl.id
 group by cl.id;
grant select on public.clientes_resumo to authenticated;

-- Endereço da loja (uma linha só)
create table if not exists public.loja (
  id         int primary key default 1 check (id = 1),
  nome       text not null default 'Top Burguer',
  endereco   text,
  bairro     text,
  cidade     text,
  uf         text,
  cep        text,
  latitude   double precision,
  longitude  double precision,
  atualizado_em timestamptz not null default now()
);
insert into public.loja (id) values (1) on conflict (id) do nothing;

alter table public.loja enable row level security;
drop policy if exists loja_select on public.loja;
create policy loja_select on public.loja for select to authenticated using (true);
drop policy if exists loja_update on public.loja;
create policy loja_update on public.loja for update to authenticated
  using (public.tem_papel('admin', 'gerente')) with check (public.tem_papel('admin', 'gerente'));
grant select, update on public.loja to authenticated;

drop trigger if exists auditoria_loja on public.loja;
create trigger auditoria_loja after update on public.loja
  for each row execute function public.tg_auditoria();
