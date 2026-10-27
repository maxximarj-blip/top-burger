-- Cadastros iniciais (vindos da aba "Listas" da planilha)

insert into public.canais (nome, marketplace, ordem) values
  ('MultiPedidos', false, 1),
  ('99',           true,  2),
  ('iFood',        true,  3)
on conflict (nome) do nothing;

insert into public.formas_pagamento (nome, online, aceita_maquina, ordem) values
  ('Online na plataforma', true,  false, 1),
  ('Pix',                  false, true,  2),
  ('Dinheiro',             false, false, 3),
  ('Débito',               false, true,  4),
  ('Crédito',              false, true,  5),
  ('Voucher',              false, true,  6)
on conflict (nome) do nothing;

insert into public.maquinas (nome) values ('PagBank'), ('Getnet')
on conflict (nome) do nothing;

-- "Pix na máquina" = forma Pix + máquina informada
insert into public.maquina_taxas (maquina_id, forma_pagamento_id, taxa_pct, repasse_dias_uteis)
select m.id, f.id, t.taxa, t.dias
  from (values
    ('Getnet',  'Débito',  0.0179, 3),
    ('Getnet',  'Crédito', 0.0218, 3),
    ('Getnet',  'Pix',     0.0179, 3),
    ('Getnet',  'Voucher', 0.0298, 3),
    ('PagBank', 'Débito',  0.0099, 0),
    ('PagBank', 'Crédito', 0.0299, 0),
    ('PagBank', 'Pix',     0.0050, 0)
  ) as t (maquina, forma, taxa, dias)
  join public.maquinas m on m.nome = t.maquina
  join public.formas_pagamento f on f.nome = t.forma
on conflict do nothing;

insert into public.entregadores (nome) values
  ('Dudu'), ('Erica'), ('Lucas'), ('Matheus'), ('Rony'), ('Thiago')
on conflict (nome) do nothing;
