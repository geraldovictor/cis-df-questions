# CIS DF · Sala de estudos

Login por e-mail e senha, simulados de 75 questões e estudo das 205 questões, com retomada, correção e histórico separado por conta e modo. O banco é **SQLite**, salvo em `data/database.sqlite`. Não há mensalidade de banco nem dependências npm. Para usar na própria máquina, não é necessário contratar hospedagem.

## Rodar

Instale Node.js 22.13 ou superior (recomendado: Node 24 LTS). Na pasta do projeto:

```sh
npm start
```

Abra http://localhost:3000. O banco é criado automaticamente. Não use apenas um servidor estático: login e gravação precisam do `server.js`. GitHub Pages não executa esse servidor. Para acesso público é necessário hospedar o processo Node com disco persistente e HTTPS; custo e disponibilidade dependem da hospedagem escolhida. Por padrão o servidor escuta apenas nesta máquina.

Variáveis opcionais: `PORT` (3000), `HOST` (127.0.0.1), `DB_PATH` (arquivo do banco), `COOKIE_SECURE=1` (cookies apenas HTTPS). Em proxy HTTPS, configure `PUBLIC_ORIGIN` com a origem pública exata (por exemplo https://estudo.exemplo.com), preserve Host e habilite COOKIE_SECURE.

## Migrar as contas existentes sem acesso administrativo

A configuração pública antiga fica em `config.js`, usada somente pelo servidor para a migração. Não coloque chaves secretas nesse arquivo.

1. Mantenha o Supabase antigo disponível durante a transição.
2. Abra o site servido pelo Node e use **Entrar** com o mesmo e-mail e senha do site antigo.
3. Se a conta ainda não estiver no SQLite, o servidor autentica no Supabase e copia os simulados e estudos dessa pessoa, incluindo resultados e progresso em andamento. Os IDs são preservados. A cópia respeita as permissões da conta e busca os dados em páginas.
4. Só depois de copiar todos os dados é criada a conta local. Se a cópia falhar, nada é importado: tente novamente. O Supabase não é alterado; a sessão temporária de exportação é encerrada.
5. Nos acessos seguintes, essa conta usa apenas SQLite. A senha fica armazenada como hash scrypt com salt; não é salva em texto. As sessões locais usam cookies HttpOnly e expiram em sete dias.
6. Confira histórico e retomada de cada conta antes de aposentar a origem. Evite continuar estudando no site antigo depois da cópia: a migração ocorre uma única vez por conta e não mantém os dois bancos sincronizados. Respostas ainda não enviadas ao Supabase precisam ser salvas no site antigo antes de migrar.

**Limite:** a chave pública não permite listar nem copiar todas as contas. Sem administrador ou backup, cada pessoa precisa entrar para migrar seus próprios dados. Não há como afirmar que todas as contas foram migradas apenas com os arquivos deste repositório. Se a origem estiver inacessível, será necessário recuperar acesso ou obter um backup.

Durante a migração, novos cadastros são bloqueados para evitar criar outra identidade local para alguém que já tinha conta. Depois de migrar todas as pessoas desejadas, pare o servidor e reinicie com a origem desativada. No PowerShell:

```powershell
$env:DISABLE_SUPABASE_MIGRATION = '1'
npm start
```

Isso libera cadastros locais. Contas ainda não migradas deixam de poder entrar até reativar a migração. Você também pode remover a configuração da origem depois de encerrar a transição.

O envio automático de e-mail para confirmação e recuperação de senha não está incluído nesta versão local. Cadastros locais entram imediatamente. Para contas ainda no Supabase, recupere a senha no site antigo antes da migração, se necessário.

## Backup e testes

Pare o servidor e copie `data/database.sqlite` para um lugar seguro. Restaure com o servidor parado. Esse arquivo contém contas, hashes de senha, sessões e resultados; não publique nem envie ao Git. `data/` e `backups/` estão ignorados, e o servidor só disponibiliza uma lista explícita de arquivos do frontend.

```sh
npm test
```

Os testes cobrem as regras dos simulados e estudos, migração simulada, autenticação, isolamento entre contas, persistência e sessões. Não acessam contas reais do Supabase.

Os scripts SQL em `supabase.sql` e `migrations/` documentam o banco antigo; não são necessários para SQLite. O material é independente da ServiceNow. As questões são arquivos públicos e as notas são calculadas no cliente, para estudo pessoal.
