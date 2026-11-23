# Pagamento de Agregados

App estático (um único `index.html`) publicado na Vercel, com dados no Supabase.
Cada envio ao ramo `main` deste repositório publica o site automaticamente em
https://pagamento-agregados.vercel.app

- Login: e-mail e senha (Supabase Auth). Só quem está cadastrado e ativo na tabela `membros` entra.
- Perfis: MASTER (acesso total), Operacional (ver, criar e editar nos módulos liberados) e Consultor (só ver).
  As permissões por módulo ficam na tabela `permissoes` e são aplicadas no banco por políticas RLS.
- Dados: tabela `docs` (coleções agregados, locacoes, feriados, fech, custos, config, faltas, freqconf, nfs), com atualização em tempo real.
- Abas Frequência (faltas diárias marcadas pelo operador) e Notas fiscais (importação de NFS em PDF dos agregados) ficam em `extras.js`, separadas do fechamento.
- Auditoria: tabela `auditoria` guarda quem alterou o quê, com o antes e o depois.
- Usuários e permissões são administrados pelo MASTER na aba "Usuários e acessos" do próprio site.
- `rbac.js` é a camada de permissões da tela, já incluída no `index.html` (mantida aqui como referência).
