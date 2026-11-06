# Pagamento de Agregados

App estático (um único `index.html`) publicado na Vercel, com dados no Supabase
(projeto `pagamento-agregados`, região São Paulo).

- Login: e-mail e senha (Supabase Auth). Só e-mails cadastrados na tabela `membros` acessam os dados (RLS).
- Dados: tabela `docs` (coleções agregados, locacoes, feriados, fech, custos, config), com atualização em tempo real.
- Backup: botões "Exportar backup" / "Importar backup" no rodapé.

Para liberar uma pessoa da equipe:

```sql
insert into public.membros(email, nome) values ('pessoa@empresa.com', 'Nome');
```
