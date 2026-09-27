# CIS DF · Sala de estudos

## Modo de estudo

Além do simulado de 75 questões, o modo de estudo usa todas as questões disponíveis (atualmente 205) em ordem aleatória, sem repetição. Ao selecionar e confirmar as alternativas, a correção e as explicações aparecem imediatamente. A resposta confirmada fica travada e só é contabilizada uma vez; seleções ainda não confirmadas são rascunhos.

O painel mostra acertos, erros, questões restantes e aproveitamento entre respostas confirmadas. É possível pausar, retomar e encerrar antecipadamente; o resultado distingue questões não respondidas de erros. O histórico dos estudos é separado dos simulados.

**Ativação em projeto existente ou novo:** execute `migrations/001-study-sessions.sql` no SQL Editor do Supabase. O script pode ser repetido e cria uma tabela separada com RLS por usuário; não modifica `attempts` nem resultados antigos. Sem essa tabela, somente o novo modo fica indisponível. As cópias locais de gravações pendentes também são separadas por modo e usuário.

Execute `npm test` para validar os dois modos. O banco de questões e o cálculo no cliente continuam sendo destinados a estudo pessoal.

Site responsivo de preparação para CIS Data Foundations, sem etapa de build. Usa os três JSONs originais (205 questões) com 75 perguntas sorteadas sem reposição por tentativa e alternativas embaralhadas. Uma questão pode reaparecer em outro simulado.

Inclui login/cadastro por e-mail e senha, recuperação de senha, progresso sincronizado por conta, retomada, histórico, média, melhor resultado e revisão com explicações. Questões com múltiplas respostas exigem o conjunto exato de alternativas corretas; questões em branco contam como erro. O texto e o gabarito originais foram preservados.

## Ativar login e banco

1. Crie um projeto em https://supabase.com e execute `supabase.sql` no SQL Editor.
2. Em **Authentication → URL Configuration**, use `https://geraldovictor.github.io/cis-df-questions/` como Site URL e adicione esse endereço à lista de Redirect URLs. Para desenvolvimento, adicione também seu endereço local.
3. Mantenha o provedor Email habilitado. Configure o envio de e-mail/SMTP para confirmação de cadastro e recuperação de senha conforme a documentação do Supabase.
4. Preencha `supabaseUrl` e `supabaseKey` em `config.js` com a URL e a chave **publishable** (ou legacy anon). A chave pública pode estar no frontend; nunca coloque uma chave secret/service_role no código.
5. Faça commit e push. Sem a configuração, a tela explica que o login ainda não está disponível e bloqueia o formulário.

As políticas RLS restringem leitura e gravação de cada tentativa ao seu dono. O navegador mantém uma cópia da última gravação pendente, separada por usuário, para tentar novamente após falha de rede. Use apenas uma aba por simulado para evitar sobrescrever alterações simultâneas.

## Publicar no GitHub Pages

Em Settings → Pages, selecione **Deploy from a branch**, branch `main`, pasta `/ (root)`. O endereço esperado é https://geraldovictor.github.io/cis-df-questions/ . O repositório precisa ter acesso ao Pages no plano atual. Não altere sua visibilidade apenas para habilitar o Pages sem avaliar o conteúdo.

## Desenvolvimento e testes

Sirva esta pasta por HTTP (por exemplo `npx serve .`). O JavaScript usa módulos nativos e não precisa de compilação. Com Node.js 20 ou superior, execute `node --test tests/quiz.test.mjs`.

Checklist após configurar o Supabase: cadastrar e confirmar um e-mail; entrar; responder uma questão simples e uma múltipla; recarregar e retomar; finalizar; revisar; sair; entrar com uma segunda conta e confirmar que o histórico da primeira não aparece; testar recuperação de senha e falha de rede.

O site é uma ferramenta pessoal de estudo, sem vínculo oficial com ServiceNow. Os JSONs e gabaritos são arquivos estáticos acessíveis publicamente se o site for público. O login protege os resultados pessoais no banco, não o banco de questões. A pontuação é calculada no cliente e não deve ser usada para avaliações certificadas.

Documentação: [Supabase Auth](https://supabase.com/docs/guides/auth), [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security), [GitHub Pages](https://docs.github.com/en/pages/quickstart).
