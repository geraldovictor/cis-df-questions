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

## Revisão diária em áudio

O painel inclui Ouvir questões com 205 gravações em inglês: pergunta e todas as alternativas corretas. Há seleção de questão, reprodução contínua, repetição, velocidade e download. A última questão escolhida é lembrada neste navegador. Os MP3s usam a voz neural en-US-AndrewMultilingualNeural e só são carregados quando utilizados.

Para regenerar os arquivos, instale requirements-audio.txt em um ambiente Python e execute python generate-audio.py. A geração usa o serviço online de voz da Microsoft via edge-tts; os arquivos prontos são servidos pelo próprio site. Os IDs seguem a ordem dos três JSONs; regenere os áudios se alterar as perguntas ou respostas.

## Flashcards

No painel, abra Flashcards para revisar as 205 perguntas. Revele a resposta para ver todas as alternativas corretas, suas explicações e ouvir o áudio neural. Marque Já sei ou Quero revisar; filtre o baralho para revisar apenas os cartões marcados, ou embaralhe todas as questões. As marcações e o último cartão são salvos neste navegador por conta, sem sincronização com outros dispositivos.

## Modo offline sem login

Na tela inicial, use Estudar offline · Sem login. O site salva automaticamente os arquivos e as 205 questões no navegador. Aguarde a indicação de que o site está pronto antes de desconectar. Depois, o mesmo endereço abre sem internet e o modo local é retomado, sem depender do login ou do Supabase.

Simulados, estudos, histórico e flashcards funcionam no modo local. O progresso fica no armazenamento persistente deste navegador, separado dos resultados da conta, e não é enviado ao servidor. Limpar os dados do site ou usar outro navegador/dispositivo não preserva esses resultados. O navegador precisa permitir armazenamento local e service workers (HTTPS ou localhost).

Para ouvir sem internet, clique em Salvar áudios para ouvir offline enquanto estiver conectado. O download mostra o progresso e aproveita os arquivos já salvos em uma nova tentativa. Os áudios são opcionais; questões e flashcards não dependem desse download.

Manutenção: ao alterar os arquivos listados em sw.js, incremente SHELL_CACHE para atualizar o conjunto offline de forma consistente. O cache de áudio é separado. Não inclua chamadas de autenticação ou resultados da conta no cache do service worker.

Validação: npm test inclui a persistência local e sua separação dos dados da conta. O teste opcional tests/offline-browser.mjs usa playwright-core (PLAYWRIGHT_PATH aponta para seu index.mjs e BROWSER_PATH opcionalmente para Chrome/Edge). Ele serve o projeto em localhost e verifica recarregamento sem rede, retomada dos modos, download dos 205 áudios, reprodução parcial e separação da conta.

## Instalar como aplicativo (PWA)

O manifesto usa ícones próprios, abre em janela independente e inicia em modo offline sem login. No Chrome/Edge, use Instalar aplicativo quando o botão aparecer ou a opção de instalação no menu do navegador. No iPhone/iPad, abra no Safari e use Compartilhar > Adicionar à Tela de Início. As instruções também ficam no topo do site.

No primeiro acesso, mantenha a internet conectada até o site confirmar que as questões estão prontas. A instalação não baixa os áudios automaticamente: use Salvar áudios para ouvir offline dentro do aplicativo. O progresso fica no armazenamento local do ambiente utilizado e pode não ser compartilhado entre o navegador e o aplicativo instalado. Resultados locais não são sincronizados com a conta.

Os testes de PWA verificam o manifesto, dimensões reais dos PNGs, caminhos dentro do projeto GitHub Pages, critérios de instalação do Chromium, a interface do convite de instalação e o início sem login. O teste de navegador não instala o aplicativo no sistema do usuário.
