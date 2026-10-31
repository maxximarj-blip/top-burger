# 🍔 Top Burguer · Sistema de Gestão

Sistema web para controle de vendas e fechamento de caixa da hamburgueria — substitui a planilha *Top Burguers.xlsx*.

**Stack:** React + TypeScript (Vite) no **GitHub Pages** · **Supabase** (Postgres, login, permissões) · deploy automático pelo GitHub Actions.

## O que tem

| Módulo | O que faz |
|---|---|
| **Login** | E-mail e senha, recuperação de senha por e-mail, troca de senha em *Minha conta* |
| **Painel** | Faturamento, líquido, ticket médio, descontos, comissão das plataformas, vendas por dia, canal, forma, canal × forma, maquininhas, dia da semana, modalidade |
| **Comandas** | Lançamento rápido (atalho **N**), valor pago calculado, taxa da máquina automática, filtros, divergências, pendentes, conferência em lote, exportar CSV |
| **Fechamento de caixa** | Fundo de troco, sangria/suprimento/despesa, dinheiro esperado × contado, fechar o dia (trava edições) |
| **Entregadores** | Acerto por período (entregas × taxas), registrar pagamento direto do caixa |
| **Recebíveis** | Agenda de quando cada venda na maquininha cai na conta (dias úteis) |
| **Produtos** | Cardápio editável como planilha (preço, custo, margem e lucro por item), por categoria |
| **Insumos** | Matéria-prima e embalagens: custo, estoque, mínimo, fornecedor; alerta de reposição |
| **Clientes** | Cadastro nominal, WhatsApp, aniversário, histórico de pedidos e total gasto; vínculo na comanda; **mapa** com pin verde (comprou em até 30 dias), amarelo (31–90) e vermelho (mais de 90), cinza para quem nunca comprou |
| **Fornecedores** | Contatos, CNPJ, Pix, prazo de pagamento, dias de entrega |
| **Compras** | Lançamento com itens (insumos entram no estoque e atualizam o custo), contas a pagar com vencimentos, relatório do mês para imprimir/PDF e CSV |
| **Importar nota** | Lê o **XML** da NF-e/NFC-e (grátis, exato) ou a **foto/PDF** da nota (IA), reconhece o fornecedor pelo CNPJ, liga os itens aos insumos com conversão de unidade (CX 12 → 12 un) e **aprende** para as próximas notas |
| **Configurações** | Canais, formas, máquinas com **taxas versionadas por data**, entregadores |
| **Usuários** | Criar usuário, perfil (admin/gerente/caixa), desativar, redefinir senha |
| **Auditoria** | Tudo que foi criado/alterado/excluído, por quem, com antes × depois |

### Perfis

| | Caixa | Gerente | Admin |
|---|:-:|:-:|:-:|
| Lançar/editar comandas do dia aberto | ✅ | ✅ | ✅ |
| Conferir, excluir comanda | | ✅ | ✅ |
| Fechar o caixa | | ✅ | ✅ |
| Cadastrar/editar clientes; ver produtos | ✅ | ✅ | ✅ |
| Produtos, insumos, fornecedores (editar) | | ✅ | ✅ |
| Compras, contas a pagar, relatório de compras | | ✅ | ✅ |
| Entregadores, recebíveis, configurações | | ✅ | ✅ |
| Usuários, auditoria, reabrir dia fechado | | | ✅ |

As regras ficam **no banco** (Row Level Security + gatilhos), não só na tela — mesmo alguém com a chave pública não consegue burlar.

---

## Instalação (≈ 20 min, uma vez só)

### 1. Supabase
1. Crie uma conta em [supabase.com](https://supabase.com) → **New project** (região *South America (São Paulo)*).
2. **SQL Editor** → cole e rode, nesta ordem:
   1. `supabase/migrations/20261027000000_init.sql` (estrutura e regras)
   2. `supabase/seed.sql` (canais, formas, máquinas e taxas, entregadores)
   3. `supabase/migrations/20261027200000_clientes_fornecedores_produtos.sql` (clientes, fornecedores, insumos, cardápio inicial)
   4. `supabase/migrations/20261029000000_compras.sql` (compras, contas a pagar, relatório)
   5. `supabase/migrations/20261029200000_leitor_notas.sql` (leitor de notas: chave da NF-e e memória de itens)
   6. `supabase/migrations/20261029300000_notas_pendentes.sql` (notas lidas ficam guardadas até a conferência)
   7. `supabase/migrations/20261031000000_mapa_clientes.sql` (mapa de clientes: CEP, cidade, posição e endereço da loja)
3. **Authentication → Sign In / Providers → Email**: **desligue "Allow new users to sign up"**.
   Assim só o admin cria contas. (Pode deixar "Confirm email" ligado.)

### 2. Primeiro usuário (vira admin automaticamente)
**Authentication → Users → Add user → Create new user**, com seu e-mail e senha, marcando *Auto Confirm User*.
O **primeiro** usuário do sistema recebe o perfil **admin**; os próximos você cria pela tela *Usuários*.

### 3. Importar o histórico da planilha (opcional)
```bash
pip install openpyxl
python scripts/importar_planilha.py "Top Burguers.xlsx" dados/importacao.sql
```
Cole o conteúdo de `dados/importacao.sql` no SQL Editor e rode. Pode repetir com a planilha atualizada sempre que quiser: **só entram os dias que ainda não têm nenhuma comanda no sistema**, então nada é duplicado; o resultado mostra, dia a dia, o que foi importado e o que já existia. O script imprime um relatório do que corrigiu (datas com ano errado, "dinheiro"/"Oline", canal digitado como número, números de comanda repetidos) e do que virou **Pendente** para revisar.
> ⚠️ `dados/` está no `.gitignore`: **não suba dados de venda para o GitHub.**

### 4. GitHub Pages
1. Crie o repositório e suba este código (`git push` na branch `main`).
2. **Settings → Secrets and variables → Actions → New repository secret**:
   - `VITE_SUPABASE_URL` → *Project Settings → API → Project URL*
   - `VITE_SUPABASE_ANON_KEY` → *Project Settings → API Keys → anon / publishable* (**nunca** a `service_role`)
3. **Settings → Pages → Source: GitHub Actions**.
4. Cada push na `main` publica em `https://<seu-usuario>.github.io/<repositorio>/`.
5. No Supabase, **Authentication → URL Configuration**: em *Site URL* e *Redirect URLs* coloque essa URL (é para onde o link de "esqueci a senha" volta).

> GitHub Pages grátis exige repositório **público**. Tudo bem: o código não tem segredo — a chave *anon* é pública por design e quem protege os dados é o RLS. Se preferir repositório privado, use Vercel ou Netlify (mesmo build: `npm run build`, pasta `dist`, mesmas variáveis).

### 5. Função de usuários (para criar usuários pela tela)
```bash
npm i -g supabase
supabase login
supabase link --project-ref <ref-do-projeto>
supabase functions deploy admin-usuarios
```
Sem ela, dá para criar usuários pelo painel do Supabase (Authentication → Add user) e ajustar o perfil na tela *Usuários*.

---

### 6. Leitura de notas por foto/PDF (opcional, gratuito)
O **XML funciona sem configurar nada**. Para ler **foto ou PDF** da nota, o sistema usa o **Google Gemini**:
1. Entre em [aistudio.google.com/apikey](https://aistudio.google.com/apikey) com uma conta Google e clique em **Create API key**. Não precisa de cartão.
2. Supabase → **Edge Functions → Secrets** → adicione `GEMINI_API_KEY` = a chave.
3. **Edge Functions → Deploy a new function → Via Editor**, nome `ler-nota`, cole `supabase/functions/ler-nota/index.ts` e publique.

Opcional nos Secrets: `GEMINI_MODEL` (padrão `gemini-3.8-flash`) e `GEMINI_MODEL_RESERVA` (padrão `gemini-3.5-flash-lite`). Quando o limite gratuito do principal acaba, a função usa a reserva sozinha.

> **Nível gratuito:** tem limite de leituras por minuto e por dia (o Google mostra o seu no AI Studio). E, no gratuito, o Google pode usar as imagens enviadas para melhorar os produtos dele e pessoas podem revisá-las. Para notas de compra de fornecedores isso costuma ser aceitável; se preferir privacidade total, ative o faturamento no AI Studio (nível pago, custo baixo) — nada muda no sistema.

## Atualizações
Cada arquivo novo em `supabase/migrations/` precisa ser rodado **uma vez** no SQL Editor, em ordem de nome. Depois é só subir o código (push) — o GitHub publica sozinho.

## Rodar no computador
```bash
cp .env.example .env.local   # preencha URL e chave anon
npm install
npm run dev
```

## Regras de negócio importantes
- **Mapa de clientes:** usa OpenStreetMap (grátis, sem chave). A posição é buscada pelo endereço uma vez e fica gravada no cadastro; o CEP preenche rua, bairro e cidade. Sem rua encontrada, o pin vai para o centro do bairro/CEP (aproximado) e pode ser arrastado no cadastro. Clientes sem cidade usam a cidade da loja (botão 🍔 no mapa).
- **Líquido = valor pago − taxa da maquininha.** O desconto já está dentro do valor pago, então não é subtraído de novo (a planilha antiga descontava duas vezes).
- **Diferença** = comanda + entrega − desconto − pago. Em 99/iFood é a comissão da plataforma; no canal próprio, qualquer diferença aparece como **divergência** para conferência.
- **"Pix na máquina"** = forma *Pix* + máquina informada. Pix na chave da loja = *Pix* sem máquina.
- **Taxa nova da maquininha?** Cadastre uma nova taxa com a data de início — vendas antigas mantêm a taxa da época.
- **Dia fechado** trava comandas e movimentos. Só admin reabre, com motivo registrado.
- Status **Pendente** bloqueia o fechamento do dia.
- **Notas lidas não se perdem:** cada nota lida fica guardada no banco até ser lançada ou descartada, com os ajustes da conferência salvos automaticamente. Pode fechar a janela, trocar de tela, atualizar a página ou continuar em outro aparelho. O menu lateral avisa quando há notas lendo, aguardando conferência ou com erro de leitura.
- **Importar nota:** a mesma nota (chave de acesso) não entra duas vezes. A escolha "item da nota → insumo" e o fator de conversão ficam salvos por fornecedor e são aplicados sozinhos nas próximas notas. Nota com várias parcelas entra com o 1º vencimento; as parcelas vão para a observação.
- **Compras:** item ligado a insumo soma no estoque e o custo do insumo passa a ser o da compra mais recente. Cancelar ou excluir a compra estorna o estoque. Compra paga com dinheiro da gaveta pode gerar a despesa no caixa automaticamente (e ela some se a compra for cancelada).

## Estrutura
```
supabase/migrations/   banco: tabelas, regras, RLS, auditoria, relatórios
supabase/seed.sql      cadastros iniciais
supabase/functions/    função admin-usuarios (criar usuário / trocar senha)
scripts/               importação da planilha
src/pages/             telas
src/lib/               conexão, login, cadastros, formatação
.github/workflows/     deploy no GitHub Pages
```
