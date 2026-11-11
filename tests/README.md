# Testes do LinkAtletas

Esta pasta contém verificações automatizadas das regras de negócio, da API interna e das jornadas da interface. Elas ajudam a identificar defeitos e regressões: quando uma alteração faz um comportamento anteriormente válido deixar de funcionar.

Os arquivos não são telas nem funcionalidades acessadas pelo usuário. São executados pelas ferramentas de teste, localmente ou na automação do GitHub. O relatório registra os resultados; manter o código de teste permite repetir as verificações.

## Por onde começar

- **Entender um cenário:** consultar o arquivo correspondente nas tabelas abaixo.
- **Conferir o que passou:** abrir o [relatório de testes por cenário](../docs/evidencias/relatorio-testes.md).
- **Encontrar resultados e capturas:** abrir o [índice das evidências](../docs/evidencias/README.md).
- **Ver a automação:** abrir o [GitHub Actions](https://github.com/luccalck/linkatletas/actions) e selecionar a execução e o commit desejados. Execuções anteriores à migração continuam nos repositórios anteriores.
- **Consultar os casos documentados:** abrir a seção 6 da [ERS final](../docs/requisitos/ERS-LinkAtletas.pdf).

Um caso documentado na ERS, sua implementação automatizada e o resultado de uma execução são artefatos diferentes. Não se presume correspondência de um para um entre todos os casos da ERS e os testes desta pasta.

As verificações de recuperação do Neon incluem [backups históricos](unit/neon-backup-history.test.ts), [fluxo restaurado com três perfis e limpeza](integration/neon-restored-flow.test.ts), [entrega e concorrência de e-mails em PostgreSQL](integration/mail-delivery.test.ts), [saúde agregada da fila](unit/mail-queue-health.test.ts) e [autorização dos endpoints internos](unit/scheduled.test.ts). SMTP é simulado nesses cenários: eles não comprovam entrega real pelo Brevo. A restauração completa do dump e dos arquivos pertence ao workflow de backup, além dos testes de funções isoladas.

## Estrutura e ferramentas

| Pasta | O que verifica | Ferramenta |
|---|---|---|
| [unit](unit) | Regras e componentes específicos, com dependências reduzidas ou controladas. | Vitest |
| [integration](integration) | API, banco e interação entre módulos; alguns cenários usam serviços reais locais e outros simulam dependências. | Vitest |
| [e2e](e2e) | Jornadas completas pela interface, automatizando ações no navegador. | Playwright |
| [mobile/tests](../mobile/tests) | Transporte, sessão e configuração do cliente React Native. Ficam junto ao aplicativo. | Vitest, na configuração própria do mobile |

As terminações `.test.ts` e `.spec.ts` são convenções de identificação dos arquivos. A [configuração do Vitest](../vitest.config.ts) inclui `unit` e `integration`; a [configuração do Playwright](../playwright.config.ts) inclui `e2e` e os motores Chromium, Firefox e WebKit. O comando da raiz não executa automaticamente os testes móveis.

## O que cada arquivo publicado verifica

### Testes unitários

| Arquivo | Responsabilidade e exemplos |
|---|---|
| [web-api.test.ts](unit/web-api.test.ts) | Cancelamento antes da rede, durante a requisição e leitura do corpo, desmontagem no mesmo ciclo, pagehide, limpeza de listeners, payload/sessão, validação HTTP e resposta 204. |
| [react-runtime.test.ts](unit/react-runtime.test.ts) | Renderização real com as versões instaladas de React e React DOM, para detectar incompatibilidades entre os pacotes antes dos testes de navegador. |
| [rate-limit.test.ts](unit/rate-limit.test.ts) | Bloqueio HTTP 429 após excesso de tentativas, isolamento entre IPs e agrupamento da mesma sub-rede IPv6, sem acesso ao banco. |
| [database-pool.test.ts](unit/database-pool.test.ts) | Prazos de consultas/transações e tratamento de desconexão ociosa sem expor dados privados nos logs. |
| [migration-checksum.test.ts](unit/migration-checksum.test.ts) | Hash canônico entre Windows/Linux e rejeição de alteração de SQL já registrado. |
| [neon-backup-objects.test.ts](unit/neon-backup-objects.test.ts) | Cópia de objetos cifrados, limites de leitura, hash e rejeição de conteúdo sem envelope. |
| [neon-backup-recovery.test.ts](unit/neon-backup-recovery.test.ts) | Marcador autenticado, limite de 26 horas e destinos de restauração exclusivamente locais. |
| [neon-backup-private.test.ts](unit/neon-backup-private.test.ts) | Manifesto completo, chaves independentes e descriptografia de envelopes privados sem exibir conteúdo. |
| [mail-delivery-routes.test.ts](unit/mail-delivery-routes.test.ts) | Entrega após commit, resposta sem espera SMTP, ciclo de vida Vercel, falhas e bloqueio em Preview. |
| [matching.test.ts](unit/matching.test.ts) | Elegibilidade e compatibilidade entre atleta e treinador: modalidades, objetivos, nível, disponibilidade, orçamento e atendimento. |
| [crypto.test.ts](unit/crypto.test.ts) | Cifra e decifra dos dados, variação do vetor de inicialização e rejeição de conteúdo adulterado. |
| [neon-backup.test.ts](unit/neon-backup.test.ts) | Cifra autenticada do backup remoto, adulteracao, chave invalida, retencao restrita e bloqueio de restauracao em producao. O teste real de restauracao ocorre no workflow de backup. |
| [backup-key.test.ts](unit/backup-key.test.ts) | Leitura e validação da chave de backup, incluindo variável vazia e preservação da chave original. |
| [static-security.test.ts](unit/static-security.test.ts) | Acesso normal a arquivo público e bloqueio de tentativas de sair da pasta pública. Usa arquivos temporários. |
| [scheduled.test.ts](unit/scheduled.test.ts) | Autorização da rota de tarefas, exclusão mútua, execução e liberação da trava em caso de falha, com dependências controladas. |
| [workout-reference.test.ts](unit/workout-reference.test.ts) | Referência externa do treino: HTTPS, ausência de credenciais, tamanho, tipo de entrada e rejeição de caracteres/protocolos indevidos. |
| [transaction.test.ts](unit/transaction.test.ts) | Confirmação, rollback e descarte de conexão quando a transação não pode ser recuperada. |
| [mail-cleanup.test.ts](unit/mail-cleanup.test.ts) | Fechamento do transporte SMTP inclusive quando o banco falha, sem envio a destinatários reais. |
| [runtime-jobs.test.ts](unit/runtime-jobs.test.ts) | Uso do executor com trava pelo intervalo local e ausência de intervalo no modo Vercel. |
| [scripts.test.ts](unit/scripts.test.ts) | Recusa de argumentos Android antes de acessar aparelho; geração coerente de configuração local, proteção de arquivos existentes e ausência de segredos na saída. |

Esses testes podem ser executados sem iniciar o ambiente completo em Docker. Ainda utilizam recursos locais quando necessário, como arquivos temporários ou um servidor HTTP de teste.

### Testes de integração

| Arquivo | Responsabilidade e exemplos |
|---|---|
| [api.test.ts](integration/api.test.ts) | Fluxo esportivo principal: autenticação, perfil, CREF manual, descoberta, solicitação e aceite do vínculo, publicação de treino, execução e persistência. Inclui entradas inválidas e acesso indevido. |
| [database-integrity.test.ts](integration/database-integrity.test.ts) | Participantes de avaliações vinculados ao contrato, bloqueio de comissão inválida e índices de apoio às FKs. Usa transações revertidas em banco exclusivo de teste. |
| [database-rules.test.ts](integration/database-rules.test.ts) | Papéis dos contratantes, remetentes do chat, valores financeiros e quatro disputas concorrentes entre transações. |
| [database-privileges.test.ts](integration/database-privileges.test.ts) | Operações permitidas nas 37 tabelas, históricos preservados, proibição de DDL e detecção de privilégios herdados. Exige manutenção com `CREATEROLE` no banco exclusivo de teste; roles temporárias são revertidas. |
| [migrations.test.ts](integration/migrations.test.ts) | Baseline, checksums, backfill preservando data, arquivos ausentes/alterados, rollback e execução concorrente única. |
| [neon-backup-private.test.ts](integration/neon-backup-private.test.ts) | Seleção real de dados privados no PostgreSQL, corpos de e-mail eliminados após envio e rejeição de conteúdo pendente vazio ou corrompido. |
| [neon-backup-storage.test.ts](integration/neon-backup-storage.test.ts) | HTTP/S3 real com buckets locais: copia, remove a origem e restaura pelo backup; confere hash e cifra e rejeita ausência ou adulteração. Nenhum acesso ao Tigris de produção. |
| [scheduled-lock.test.ts](integration/scheduled-lock.test.ts) | Trava real do PostgreSQL preservada durante espera externa maior que o limite ocioso geral; outra conexão só adquire a trava depois da finalização. |
| [platform.test.ts](integration/platform.test.ts) | Consentimentos, dados privados, arquivos cifrados, autorização de mídia, recuperação de senha, sessão nativa e encerramento de conta. Usa banco, armazenamento e captura de e-mail locais. |
| [interactions.test.ts](integration/interactions.test.ts) | Mensagens, leitura, eventos, avaliações e consultorias: persistência, isolamento entre usuários e conflito de horários. |
| [billing.test.ts](integration/billing.test.ts) | Adaptador financeiro com servidor HTTP controlado: checkout, eventos, repetição, falhas, cancelamento e conciliação. Não realiza pagamento real. |
| [privacy-races.test.ts](integration/privacy-races.test.ts) | Concorrência durante alteração de perfil, troca de senha e eliminação de dados. Verifica ordenação com bloqueios reais do PostgreSQL. |
| [vercel-runtime.test.ts](integration/vercel-runtime.test.ts) | Entrada HTTP da API destinada à Vercel, inicialização e contrato do handler em processo local. Não equivale a testar uma implantação real na nuvem. |
| [permissions.test.ts](integration/permissions.test.ts) | Matriz de autenticação/papel das operações REST, titularidade de recursos, contas encerradas, validade profissional e jornada nas cinco modalidades. Usa somente fixtures e serviços isolados. |

Grande parte dessas suítes chama as rotas com `app.inject`: a requisição percorre a aplicação Fastify sem precisar abrir o navegador. Isso permite conferir códigos HTTP, respostas e efeitos no banco. Outros testes abrem processos ou servidores locais para reproduzir condições específicas.

**API interna não é API de CREF.** A API interna do LinkAtletas é o back-end Node/Fastify utilizado pelo site e pelo aplicativo, por exemplo para salvar perfil, criar vínculo e publicar treino. Não há API externa de conselho profissional integrada. Os testes de CREF verificam submissão de evidência, decisão manual do administrador, auditoria e permissões; não comprovam consulta automática nem habilitação profissional real.

### Testes de ponta a ponta — E2E

| Arquivo | Responsabilidade e exemplos |
|---|---|
| [training-flow.spec.ts](e2e/training-flow.spec.ts) | Login inválido em tela móvel e jornada de cadastro → aprovação administrativa → contratação → publicação → execução persistida. |
| [expansion.spec.ts](e2e/expansion.spec.ts) | Mensagens, agenda, avaliações, consentimento, mídia, financeiro acadêmico, recuperação pela interface, teclado, responsividade e verificações automáticas com axe. |

O Playwright inicia os serviços da aplicação para a suíte local, usa uma base isolada e abre sessões para os atores do cenário. Por padrão, cada cenário é executado nos três motores configurados. Assim, cinco cenários repetidos em três motores geram quinze execuções; isso não significa quinze funcionalidades independentes.

### Testes do aplicativo móvel

| Arquivo | Responsabilidade |
|---|---|
| [mobile/tests/api.test.ts](../mobile/tests/api.test.ts) | Transporte HTTP, arquivos, sessão, SecureStore, cabeçalhos de autenticação e tratamento de erros, com dependências nativas controladas. |
| [mobile/tests/config.test.ts](../mobile/tests/config.test.ts) | Endereço da API e diferenças entre ambiente local, emulador e produção HTTPS. |

Esses testes não instalam um APK nem demonstram, por si, funcionamento em aparelho físico. Ensaios Android, carga, backup e TLS também possuem scripts em [scripts/android](../scripts/android) e [scripts/verificacao](../scripts/verificacao); seus resultados são apresentados separadamente no relatório.

## Preparar o ambiente local

Executar os comandos a partir da raiz do repositório, onde fica o `package.json`. Pré-requisitos: Node.js 24, pnpm conforme o `packageManager` do projeto e Docker Desktop para as suítes que dependem dos serviços.

```powershell
pnpm install --frozen-lockfile
```

Na primeira configuração, criar o `.env` a partir do [.env.example](../.env.example) somente se ele ainda não existir. Preservar uma configuração existente e conferir se ela aponta para serviços locais, não para produção.

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
docker compose up -d --wait
docker compose ps
```

O [compose.yaml](../compose.yaml) fornece PostgreSQL, SeaweedFS e Mailpit. O [script inicial do banco](../server/db/init-test.sql) cria as bases de teste na primeira inicialização de um volume novo. Se o volume já existia, conferir se essas bases foram criadas; subir o contêiner novamente não reaplica automaticamente o script de inicialização.

| Variável | Uso |
|---|---|
| `TEST_DATABASE_URL` | Base principal de integração e navegador; deve terminar em `_test`. |
| `PLATFORM_TEST_DATABASE_URL` | Base específica da suíte de plataforma, com padrão local `linkatletas_platform_test`. |
| `PRIVACY_TEST_DATABASE_URL` | Base específica de concorrência/privacidade, com padrão local `linkatletas_privacy_test`; essa suíte exige sufixo `_privacy_test`. |
| `S3_ENDPOINT` e variáveis S3 | Armazenamento local dos arquivos usados nos testes. |
| `SMTP_HOST` e `SMTP_PORT` | Mailpit local para recuperação e inspeção de e-mails. |
| `EVIDENCE_DIR` | Destino dos resultados e capturas do Playwright. |

As suítes aplicam migrações e algumas limpam tabelas com `TRUNCATE`. **Nunca apontar essas suítes para o Neon de produção, para contas reais ou para o banco de desenvolvimento que se deseja preservar.** Não executar suítes concorrentes sobre a mesma base. Para os valores locais e o diagnóstico do ambiente, consultar o [manual](../docs/operacao/manual.md).

## Comandos de execução

### Regras isoladas, sem o ambiente completo

```powershell
pnpm exec vitest run tests/unit
pnpm exec vitest run tests/unit/workout-reference.test.ts
```

### Unidade e integração

Com os serviços locais preparados:

```powershell
pnpm test
```

Para executar um arquivo ou selecionar um cenário pelo nome:

```powershell
pnpm exec vitest run tests/integration/api.test.ts
pnpm exec vitest run tests/integration/api.test.ts -t "senha fraca"
```

O filtro `-t` precisa corresponder ao nome de um teste. Conferir o resumo: zero casos executados não comprova sucesso do cenário desejado.

### Navegador

Instalar os motores na primeira utilização. O exemplo usa uma pasta temporária para preservar resultados históricos versionados:

```powershell
pnpm exec playwright install chromium firefox webkit
$env:EVIDENCE_DIR = "tmp/testes-web-local"
pnpm test:e2e
```

Para selecionar o arquivo e o motor:

```powershell
pnpm exec playwright test tests/e2e/training-flow.spec.ts --project=chromium
```

A variável `EVIDENCE_DIR` definida acima vale para a sessão atual do PowerShell. Sem essa variável, o destino padrão é `docs/evidencias/web`. O Playwright usa web em `localhost:5174` e API em `localhost:3002`; não é necessário iniciar `pnpm dev:all` para essa suíte. As portas devem estar livres. Não configurar `E2E_BASE_URL` com o site público: as jornadas criam e alteram dados.

### Aplicativo móvel

```powershell
pnpm --dir mobile install --frozen-lockfile
pnpm --dir mobile test
pnpm --dir mobile typecheck
```

Esses comandos verificam o cliente; não abrem o aplicativo em um aparelho.

### Compilação e documentação

```powershell
pnpm build
pnpm docs:check
```

Compilar verifica tipos e geração da interface; não substitui os testes funcionais. Conferir links e contratos não substitui uma jornada do usuário.

## Como ler um teste e seu resultado

Um teste normalmente organiza três momentos: **preparação** dos dados e dependências, **ação** que exercita a aplicação e **asserção** que compara o resultado observado com o esperado. Em Vitest, `describe` agrupa cenários, `it`/`test` identifica o caso e `expect` expressa verificações. Em Playwright, as ações são realizadas sobre páginas e elementos da interface.

| Resultado | Significado |
|---|---|
| Aprovado / `passed` | As verificações daquele caso passaram naquela execução. |
| Reprovado / `failed` | Uma verificação falhou ou ocorreu erro durante a execução. Ler a mensagem, o esperado e o recebido. |
| Pendente, ignorado ou não executado | O caso não forneceu comprovação de aprovação; conferir filtros, preparação e falhas antes da execução. |
| Instável / `flaky` | O resultado variou entre tentativas; não tratar como aprovação estável. |

Uma falha de preparação, por exemplo banco indisponível, pode impedir todos os casos do arquivo sem produzir falhas de asserção individuais. Portanto, `numFailedTests: 0` sozinho não basta: conferir sucesso geral, quantidade efetivamente executada, pendências e saída do comando.

Nos resultados Vitest, consultar `success`, `numPassedTests`, `numFailedTests` e `assertionResults`. Nos resultados Playwright, consultar os cenários, motores, tentativas e `stats`. O relatório explica a execução usada como referência; não somar reexecuções dos mesmos casos nem interpretar quantidade de testes como percentual de cobertura.

## Onde ficam os resultados

| Tipo | Destino |
|---|---|
| Vitest local padrão | Resumo no terminal. O comando padrão não salva um JSON automaticamente. |
| Vitest com relatório JSON | Caminho escolhido em `--outputFile`; exemplo abaixo. |
| Playwright | `EVIDENCE_DIR`, ou `docs/evidencias/web` por padrão. Gera JSON, relatório HTML e artefatos conforme a configuração. |
| CI | Logs e artefato `test-evidence` da execução no GitHub Actions; sua retenção é limitada. |
| Evidências selecionadas para entrega | [Pasta de evidências](../docs/evidencias/README.md), com referências no relatório. |

Para gerar um novo resultado Vitest sem substituir evidência histórica:

```powershell
pnpm exec vitest run tests/unit --reporter=json --outputFile=tmp/testes-unitarios-local.json
```

Capturas de falha e traces auxiliam a investigação; não equivalem a capturas de todas as ações. Para abrir o HTML de uma execução no destino temporário do exemplo:

```powershell
pnpm exec playwright show-report tmp/testes-web-local/playwright-report
```

Resultados históricos não devem ser sobrescritos e apresentados como se fossem a mesma execução. Ao selecionar evidência nova, registrar ambiente, data, versão do código e limites, sem incluir senhas, tokens ou dados pessoais.

## Automação no GitHub

O [workflow de CI](../.github/workflows/ci.yml) prepara os serviços, compila, executa unidade/integração e navegador, verifica documentação e cliente móvel e testa backup e implantação TLS. Algumas dessas verificações são implementadas fora desta pasta.

Para conferir uma execução, abrir o [Actions](https://github.com/luccalck/linkatletas/actions), confirmar o commit, expandir a etapa desejada e consultar logs/artefatos. O [workflow documental](../.github/workflows/docs.yml) confere documentação separadamente. A CI completa responde a todos os pushes e pull requests, inclusive alterações documentais; o workflow curto de documentação usa seus próprios filtros.

Uma CI aprovada de um commit anterior não comprova aprovação de alterações posteriores ou de arquivos que existem apenas no computador de um integrante.

## Escopo publicado e trabalho em desenvolvimento

As tabelas deste README descrevem os arquivos publicados que compõem a referência atual. Na revisão do servidor de **28/10/2026**, `integration/permissions.test.ts` foi incorporado à regressão da API. O arquivo `e2e/roles.spec.ts` permanece em desenvolvimento local, fora do GitHub, como parte da auditoria ampliada da navegação.

Se arquivos locais ainda não publicados aparecerem no computador, eles podem ser descobertos pelos comandos e alterar a quantidade de casos. Isso não significa que foram aprovados ou incluídos na CI do grupo. Antes de comparar resultados, conferir o commit e as alterações locais com `git status`. O [registro da revisão do servidor](../docs/evidencias/relatorios/auditoria-server-2026-10-28.md) distingue os resultados desta etapa da auditoria ampliada ainda não concluída.

## Limites das verificações

- Os testes usam dados fictícios. Um CREF fictício aprovado em uma fixture não comprova registro profissional real.
- O adaptador financeiro é verificado com respostas controladas; isso não comprova cobrança, repasse ou homologação real do Asaas.
- Mailpit permite conferir o e-mail local; aceite SMTP externo não garante chegada à caixa de entrada.
- As verificações automáticas de acessibilidade não substituem uma avaliação manual integral ou com leitor de tela.
- Testes de transporte móvel não equivalem a homologação do APK em aparelho físico ou iOS.
- Uma suíte aprovada comprova os cenários executados, não ausência de todos os defeitos possíveis.

## Diagnóstico rápido

| Problema | Primeira conferência |
|---|---|
| Conexão recusada ou preparação interrompida | Docker em execução, `docker compose ps`, porta e base local corretas. |
| Banco de teste inexistente | Bases previstas no script de inicialização e histórico do volume; não apagar o volume para tentar corrigir. |
| Navegador não instalado | Executar a instalação dos motores do Playwright. |
| Porta ocupada no E2E | Verificar processos nas portas 5174 e 3002; não encerrar processos desconhecidos. |
| Arquivo ou cenário não encontrado | Executar da raiz, conferir o caminho, o filtro e se o arquivo é publicado ou apenas local. |
| Resultado diferente da CI | Comparar commit, alterações locais, variáveis, dependências, serviços e motor de navegador. |
| Falha funcional | Ler esperado/recebido, reproduzir o cenário isoladamente e corrigir a causa antes de atualizar a evidência. |

Não remover uma asserção nem marcar o cenário como aprovado apenas para obter resultado verde. Ao incluir ou alterar um teste, manter uma verificação observável da regra, executar no ambiente apropriado e registrar o resultado efetivo no relatório quando ele fizer parte da entrega.
