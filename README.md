# Certificações ServiceNow · Sala de estudos

Uma sala de estudos para **CIS-DF**, **CIS-EM** e **CAD** (identificado internamente como `cis-cad`). Use os cartões no topo para trocar de certificação. A última seleção é lembrada neste navegador; os links diretos são `?cert=cis-df`, `?cert=cis-em` e `?cert=cis-cad`.

## Busca diária de fontes

O workflow `Daily CAD and CIS-EM question search` consulta os catálogos públicos do ITExams e pesquisas RSS da ServiceNow Community todos os dias às **07:17 de São Paulo** (10:17 UTC), e também permite execução manual em GitHub Actions. O relatório JSON/Markdown fica no resumo e nos artefatos da execução por 30 dias. A consulta usa uma janela móvel de 12 meses para publicações, compara os enunciados públicos com os bancos existentes e registra links e impressões digitais das possíveis ausências. Imagens ou cenários semelhantes ficam para revisão.

Declarações do publicador sobre questões reais são registradas como declarações da fonte. A atualização geral do catálogo é separada da data individual de publicação, que fica desconhecida quando não é informada. Falhas de acesso aparecem como pesquisa parcial; páginas restritas não são contornadas. A rotina não gera questões, não altera os bancos e não faz deploy de cópias de bancos de terceiros: a republicação automática depende de uma fonte que permita reutilizar o conteúdo. Nenhuma conexão paga, chave de IA ou computador local ligado é necessária para a busca. Agendamentos do GitHub podem sofrer atrasos e ser desativados após inatividade do repositório.

Para executar localmente: `node scripts/question-source-watch.mjs`. A saída fica em `test-results/question-search/`. Um argumento `AAAA-MM-DD` fixa a data de consulta em testes; o padrão usa `America/Sao_Paulo`.

| Certificação | Questões | Macetes | Simulado |
| --- | ---: | ---: | ---: |
| CIS-DF · Data Foundations | 205 | 205 | 75 |
| CIS-EM · Event Management | 116 | 116 | 30 |
| CAD · Application Developer | 151 | 151 | 60 |

As quantidades de CIS-EM e CAD seguem os blueprints oficiais atualizados em janeiro de 2026: [CIS-EM: 30 questões e 60 minutos](https://learning.servicenow.com/kb?id=kb_article_view&sysparm_article=KB0011604) e [CAD: 60 questões e 90 minutos](https://learning.servicenow.com/kb?id=kb_article_view&sysparm_article=KB0011498). O CIS-DF mantém o formato existente de 75 questões. As perguntas são sorteadas do banco selecionado sem reposição na mesma tentativa; o sorteio não aplica pesos por domínio do blueprint.

As três usam os mesmos recursos: login, simulados, estudo com correção imediata, histórico, retomada, flashcards, decoreba, áudio e acesso offline/PWA. Simulados, estudos, gravações pendentes, marcações e posição do áudio são separados por certificação. A troca salva a tentativa aberta antes de navegar. Os IDs, URLs de áudio e chaves locais anteriores do CIS-DF foram preservados.

Os novos bancos e macetes ficam em `data/cis-em/` e `data/cis-cad/`; `certification.js` define as fontes. Os gabaritos enviados foram preservados. Os relatórios `import-report.json` registram a origem, adaptações e inconsistências: faltam explicações nos dois novos bancos, existem alternativas incompletas no CAD e no CIS-EM e há divergências entre gabaritos no CIS-EM. Os itens afetados têm uma observação recolhida junto ao enunciado. As seis imagens do CIS-EM são locais e ficam disponíveis offline; a sequência HOTSPOT usa associação interativa, com a imagem-resposta disponível depois da correção.

O complemento CAD de 15/11/2026 contém 146 registros: uma questão nova foi acrescentada e 145 já existentes foram identificadas por enunciado e cenário, inclusive imagens e listas de itens. A importação preserva os 150 registros anteriores, seus IDs, gabaritos e macetes. O relatório `data/cis-cad/supplemental-import-report.json` registra as decisões de comparação e as diferenças encontradas entre as fontes.

As tabelas armazenam `state.certification`; resultados antigos sem esse campo são tratados como CIS-DF. As políticas RLS por usuário continuam aplicáveis. **Em projetos Supabase já configurados, execute `migrations/002-certification-simulations.sql` no SQL Editor antes de sincronizar simulados CIS-EM e CAD com login.** A migração permite os totais de 30, 60 e 75 questões e limita o score ao total da tentativa; pode ser repetida e preserva os resultados existentes. Ela não é aplicada automaticamente pelo site. O modo offline funciona sem essa migração.

Os números de questões nos recursos abaixo variam conforme a certificação selecionada; o banco original CIS-DF contém 205.

## Modo de estudo

Além do simulado com a quantidade definida para cada certificação, o modo de estudo usa todas as questões da certificação selecionada em ordem aleatória, sem repetição. Ao selecionar e confirmar as alternativas, a correção e as explicações disponíveis aparecem imediatamente. A resposta confirmada fica travada e só é contabilizada uma vez; seleções ainda não confirmadas são rascunhos.

O painel mostra acertos, erros, questões restantes e aproveitamento entre respostas confirmadas. É possível pausar, retomar e encerrar antecipadamente; o resultado distingue questões não respondidas de erros. O histórico dos estudos é separado dos simulados.

**Ativação em projeto existente ou novo:** execute `migrations/001-study-sessions.sql` no SQL Editor do Supabase. O script pode ser repetido e cria uma tabela separada com RLS por usuário; não modifica `attempts` nem resultados antigos. Sem essa tabela, somente o novo modo fica indisponível. As cópias locais de gravações pendentes também são separadas por modo e usuário.

Execute `npm test` para validar os dois modos. O banco de questões e o cálculo no cliente continuam sendo destinados a estudo pessoal.

Site responsivo de preparação para certificações ServiceNow, sem etapa de build. Usa os três JSONs originais do CIS-DF e os bancos normalizados de CIS-EM e CAD, com 75, 30 ou 60 perguntas por simulado, respectivamente, e alternativas embaralhadas. Uma questão pode reaparecer em outro simulado.

Inclui login/cadastro por e-mail e senha, recuperação de senha, progresso sincronizado por conta, retomada, histórico, média, melhor resultado e revisão com explicações. Questões com múltiplas respostas exigem o conjunto exato de alternativas corretas; questões em branco contam como erro. O texto e o gabarito originais foram preservados.

## Ativar login e banco

1. Crie um projeto em https://supabase.com e execute `supabase.sql` no SQL Editor. Para um projeto já configurado com o esquema anterior, execute `migrations/002-certification-simulations.sql` para habilitar simulados CIS-EM e CAD com os novos totais. Execute também `migrations/001-study-sessions.sql` para habilitar o modo de estudo, caso ainda não tenha feito isso.
2. Em **Authentication → URL Configuration**, use `https://geraldovictor.github.io/cis-df-questions/` como Site URL e adicione esse endereço à lista de Redirect URLs. Para desenvolvimento, adicione também seu endereço local.
3. Mantenha o provedor Email habilitado. Configure o envio de e-mail/SMTP para confirmação de cadastro e recuperação de senha conforme a documentação do Supabase.
4. Preencha `supabaseUrl` e `supabaseKey` em `config.js` com a URL e a chave **publishable** (ou legacy anon). A chave pública pode estar no frontend; nunca coloque uma chave secret/service_role no código.
5. Faça commit e push. Sem a configuração, a tela explica que o login ainda não está disponível e bloqueia o formulário.

As políticas RLS restringem leitura e gravação de cada tentativa ao seu dono. O navegador mantém uma cópia da última gravação pendente, separada por usuário, para tentar novamente após falha de rede. Use apenas uma aba por simulado para evitar sobrescrever alterações simultâneas.

## Publicar no GitHub Pages

Em Settings → Pages, selecione **Deploy from a branch**, branch `main`, pasta `/ (root)`. O endereço esperado é https://geraldovictor.github.io/cis-df-questions/ . O repositório precisa ter acesso ao Pages no plano atual. Não altere sua visibilidade apenas para habilitar o Pages sem avaliar o conteúdo.

## Desenvolvimento e testes

Sirva esta pasta por HTTP (por exemplo `npx serve .`). O JavaScript usa módulos nativos e não precisa de compilação. Com Node.js 20 ou superior, execute `node --test tests/quiz.test.mjs`.

As 14 questões de associação (com `->`, `→`, `=>` ou `⇒`) usam cartões de arrastar nos simulados e no modo de estudo. Arraste pela alça ou selecione um cartão e toque/clique na descrição; o teclado também funciona com Enter e Espaço. Alguns cartões sobram. Complete todos os destinos antes de confirmar no estudo; cada questão exige todas as associações corretas para valer um acerto. As respostas antigas continuam compatíveis. Os pares são salvos e retomados também offline.

`npm test` verifica o gabarito, os distratores e a compatibilidade das associações. Para validar arraste com mouse e toque, teclado, troca/remoção, correção, retomada offline e layout móvel, execute `node tests/matching-browser.mjs` com `PLAYWRIGHT_PATH` apontando para o `index.mjs` do `playwright-core` e, opcionalmente, `BROWSER_PATH` para Chrome/Edge.

A questão de identificação de Hardware (`2-50`) inclui contexto estruturado e uma tabela com as prioridades 200, 300 e 400. O contexto também aparece nas revisões, flashcards e transcrição. As alternativas separam os resultados de CI1 e CI2; o gabarito continua com o mesmo índice, preservando respostas salvas. A revisão técnica usa a [documentação de regras de identificação](https://www.servicenow.com/docs/r/servicenow-platform/configuration-management-database-cmdb/t_CreateCIIdentificationRule.html) e os [fundamentos do IRE](https://hi.service-now.com/kb?id=kb_article_view&sysparm_article=KB1064718): os atributos configurados determinam a correspondência; um IP coincidente sozinho não satisfaz os critérios desse exercício.

`node tests/identification-browser.mjs` usa as mesmas variáveis de navegador para verificar a tabela, as alternativas, a correção, a retomada offline e a apresentação móvel. Quando uma gravação for refeita, incremente `audio_version` nessa questão: o download offline reaproveita as demais gravações e busca a versão atualizada.

Checklist após configurar o Supabase: cadastrar e confirmar um e-mail; entrar; responder uma questão simples e uma múltipla; recarregar e retomar; finalizar; revisar; sair; entrar com uma segunda conta e confirmar que o histórico da primeira não aparece; testar recuperação de senha e falha de rede.

O site é uma ferramenta pessoal de estudo, sem vínculo oficial com ServiceNow. Os JSONs e gabaritos são arquivos estáticos acessíveis publicamente se o site for público. O login protege os resultados pessoais no banco, não o banco de questões. A pontuação é calculada no cliente e não deve ser usada para avaliações certificadas.

Documentação: [Supabase Auth](https://supabase.com/docs/guides/auth), [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security), [GitHub Pages](https://docs.github.com/en/pages/quickstart).

## Revisão diária em áudio

O painel inclui Ouvir questões com gravações em inglês de todas as questões do banco selecionado: pergunta e todas as alternativas corretas. Há seleção de questão, reprodução contínua, repetição, velocidade e download. A última questão escolhida é lembrada por certificação neste navegador. Os MP3s usam a voz neural en-US-AndrewMultilingualNeural e só são carregados quando utilizados.

Para regenerar os arquivos, instale `requirements-audio.txt` em um ambiente Python e execute `python generate-audio.py --certification all`, ou escolha `cis-df`, `cis-em` ou `cis-cad`. Sem argumento, o gerador mantém o comportamento original do CIS-DF. A geração usa o serviço online de voz da Microsoft via edge-tts; os arquivos prontos são servidos pelo próprio site. Os novos áudios ficam em `audio/cis-em/` e `audio/cis-cad/`, com IDs estáveis do banco. Regenere os arquivos afetados ao alterar perguntas, contextos ou respostas.

## Flashcards

No painel, abra Flashcards para revisar as perguntas da certificação selecionada. Revele a resposta para ver todas as alternativas corretas, suas explicações e ouvir o áudio neural. Marque Já sei ou Quero revisar; filtre o baralho para revisar apenas os cartões marcados, ou embaralhe todas as questões. As marcações e o último cartão são salvos neste navegador por conta, sem sincronização com outros dispositivos.

## Decoreba

No painel, use **Abrir decoreba**. Todas as questões da certificação selecionada têm dicas individuais em português: uma pista para reconhecer o cenário, um macete e a conexão com os termos do gabarito. As técnicas incluem frases, siglas, imagens mentais, sequências e contrastes. As associações mostram todos os pares corretos, e as questões de múltipla escolha mostram todas as respostas corretas. As letras das alternativas não são usadas para memorizar.

Em **Aprender macetes**, leia a dica e tente falar a resposta antes de conferir. Em **Testar memória**, o macete e a resposta ficam escondidos até você revelar. Marque **Decorei** ou **Ainda confundo** para avançar e montar sua revisão. Há busca por palavras, filtros, escolha de questão e embaralhamento. O enunciado original e os áudios existentes continuam disponíveis.

As marcações, a ordem, o modo e a última questão ficam no navegador, separados por conta e pelo modo sem login. O modo funciona offline depois que o site estiver preparado. O progresso de decoreba é separado dos flashcards, estudos e simulados. Dicas com inconsistências conhecidas no banco exibem uma observação específica junto ao macete.

O conteúdo fica no arquivo `memory-aids.json` de cada banco, com uma entrada por ID estável. Cada entrada inclui os índices corretos e uma assinatura do enunciado/contexto/respostas, calculada por `memorySourceKey` em `memorization.js`. Quando o banco mudar, revise a dica e atualize esses dados; o carregamento recusa dicas incompletas ou incompatíveis. `npm test` valida cobertura e persistência; `node tests/memorization-browser.mjs` verifica os fluxos no navegador com as mesmas variáveis `PLAYWRIGHT_PATH` e `BROWSER_PATH` dos outros testes.

## Modo offline sem login

Na tela inicial, use Estudar offline · Sem login. O site salva automaticamente os arquivos e todas as questões das três certificações no navegador. Aguarde a indicação de que o site está pronto antes de desconectar. Depois, o mesmo endereço abre sem internet e o modo local é retomado, sem depender do login ou do Supabase.

Simulados, estudos, histórico e flashcards funcionam no modo local. O progresso fica no armazenamento persistente deste navegador, separado dos resultados da conta, e não é enviado ao servidor. Limpar os dados do site ou usar outro navegador/dispositivo não preserva esses resultados. O navegador precisa permitir armazenamento local e service workers (HTTPS ou localhost).

Para ouvir sem internet, clique em Salvar áudios para ouvir offline enquanto estiver conectado. O download mostra o progresso e aproveita os arquivos já salvos em uma nova tentativa. Os áudios são opcionais; questões e flashcards não dependem desse download.

Manutenção: ao alterar os arquivos listados em sw.js, incremente SHELL_CACHE para atualizar o conjunto offline de forma consistente. O cache de áudio é separado. Não inclua chamadas de autenticação ou resultados da conta no cache do service worker.

Validação: npm test inclui a persistência local e sua separação dos dados da conta. O teste opcional tests/offline-browser.mjs usa playwright-core (PLAYWRIGHT_PATH aponta para seu index.mjs e BROWSER_PATH opcionalmente para Chrome/Edge). Ele serve o projeto em localhost e verifica recarregamento sem rede, retomada dos modos, download dos 205 áudios, reprodução parcial e separação da conta.

## Instalar como aplicativo (PWA)

O manifesto usa ícones próprios, abre em janela independente e inicia em modo offline sem login. No Chrome/Edge, use Instalar aplicativo quando o botão aparecer ou a opção de instalação no menu do navegador. No iPhone/iPad, abra no Safari e use Compartilhar > Adicionar à Tela de Início. As instruções também ficam no topo do site.

No primeiro acesso, mantenha a internet conectada até o site confirmar que as questões estão prontas. A instalação não baixa os áudios automaticamente: use Salvar áudios para ouvir offline dentro do aplicativo. O progresso fica no armazenamento local do ambiente utilizado e pode não ser compartilhado entre o navegador e o aplicativo instalado. Resultados locais não são sincronizados com a conta.

Os testes de PWA verificam o manifesto, dimensões reais dos PNGs, caminhos dentro do projeto GitHub Pages, critérios de instalação do Chromium, a interface do convite de instalação e o início sem login. O teste de navegador não instala o aplicativo no sistema do usuário.
