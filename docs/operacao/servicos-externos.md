# Serviços externos do LinkAtletas

A aplicação pública usa os serviços abaixo e funciona com o computador e o Docker dos integrantes desligados. Os cenários executados e seus limites estão no [registro de implantação](../evidencias/relatorios/implantacao-2026-10-26.md).

## Serviços em nuvem

| Serviço | Função | Referência |
|---|---|---|
| GitHub | Código, documentos e histórico de contribuições. O repositório atual é independente, administrado por Lucca. | [Repositório atual](https://github.com/luccalck/linkatletas). Registros anteriores conservam sua origem; não representam checks atuais deste repositório. |
| GitHub Actions | Testes, verificações, compilação Android, backup diário e monitor horário independente da recuperação. | [Execuções](https://github.com/luccalck/linkatletas/actions) e [workflows](../../.github/workflows/README.md). Compilação não equivale a publicação em loja; upload de backup não equivale a restauração validada. |
| Vercel | Hospeda a interface React/Vite e executa a API Node/Fastify por HTTPS. | [Site](https://link-atletas.vercel.app/) e [API](https://link-atletas.vercel.app/api/docs/). Vite prepara a interface; Fastify atende às requisições da API. |
| Neon | PostgreSQL remoto: contas, perfis, vínculos, treinos, mensagens e metadados dos arquivos. Ambientes separados e contas runtime limitadas por operação. | [Operação, permissões e recuperação](neon.md), [saúde da aplicação](https://link-atletas.vercel.app/api/health) e [dicionário](../banco/dicionario-dados.md). Neon Auth não é usado; autenticação é feita pela API do projeto. |
| Tigris | Buckets privados compatíveis com S3 para arquivos cifrados; o Neon guarda as referências. Bucket separado recebe dump cifrado e cópias dos arquivos ativos para recuperação. | [Verificação histórica de produção](../evidencias/nuvem/tigris-2026-10-26.json) e [backup independente](neon.md#backup-independente-no-tigris). Credenciais de leitura da origem, escrita do backup e monitor têm finalidades separadas. |
| Brevo | SMTP para envio de e-mails, incluindo recuperação de senha. A aplicação tenta enviar após o commit e mantém a fila para recuperação de falhas. | [SMTP](../evidencias/nuvem/brevo-2026-10-26.json), [recuperação](../evidencias/nuvem/vercel-recuperacao-2026-10-26.json) e [fluxo atual das filas](neon.md#filas-e-mails-e-escala-a-zero). Aceite SMTP não garante chegada à caixa de entrada. |
| cron-job.org | Chama as rotas protegidas de execução de tarefas e de monitoramento da fila de e-mails, em agendas separadas. Processa filas, reconciliações e limpezas sob trava; não hospeda a aplicação nem armazena seu banco. | [Ativação histórica](../evidencias/nuvem/cron-producao-ativo-2026-10-26.png) e [procedimento atual](neon.md#filas-e-mails-e-escala-a-zero). Intervalo de quinze minutos; o monitor sinaliza falhas sem interromper as demais tarefas. Conferir ativação e histórico no painel: o código não altera a agenda remota. |

Produção e Preview têm configurações próprias de banco e armazenamento. Não mostre valores de variáveis, chaves, cabeçalhos de autorização ou senhas ao compartilhar a tela. As senhas das contas de demonstração ficam fora do repositório.

O backup usa leitura direta do Neon e leitura dos arquivos de origem no Tigris. A recuperação é ensaiada em PostgreSQL 18 e S3 locais no runner, com decriptação e API sintética isolada. O monitor consulta apenas o bucket de backup e exige recuperação validada com até 26 horas; não acorda o Neon. Os objetivos acadêmicos são RPO de 24 horas e RTO de 60 minutos, sem SLA. Histórico nativo Free de seis horas, retenção externa de sete dias e requisitos de chaves estão no [procedimento operacional](neon.md).

## Ambiente local

| Componente | Finalidade |
|---|---|
| Docker Compose | Sobe os serviços locais de desenvolvimento e testes do [compose.yaml](../../compose.yaml). Desligá-lo não desliga a implantação pública. |
| PostgreSQL local | Banco de desenvolvimento separado do Neon. Testes usam bases com sufixo `_test`. Não existe sincronização automática entre esses bancos. |
| SeaweedFS | Armazenamento S3 local para testar arquivos; na nuvem essa função é do Tigris. |
| Mailpit | Captura e-mails locais para inspeção, sem entrega na internet; na nuvem o envio é pelo Brevo. |
| Caddy | Proxy HTTPS da [implantação alternativa em contêineres](../../compose.production.yaml). A implantação atual usa HTTPS da Vercel. |

React, Vite, Fastify, React Native e Expo são tecnologias do código, não provedores de banco ou armazenamento. O aplicativo usa a mesma API; consulte os [resultados e limites do Android](https://github.com/DaviSouza78/LinkAtletas/blob/9d62794a8bb84aa77f41de2bab91ebe15b4060d2/docs/evidencias/android/mobile-verificacao.md).

## Integrações sem ativação externa

| Integração | Situação |
|---|---|
| Asaas | Adaptador implementado e [testes HTTP controlados](../../tests/integration/billing.test.ts). A demonstração usa modo acadêmico, sem cobrança real. Credenciais e homologação externas são necessárias antes de ativar pagamentos. |
| Google Calendar/Meet | Integração complementar condicionada a configuração e autorização externas. A agenda própria funciona no banco do projeto; a integração Google não está homologada. |
| CREF | Não há API externa ativa. O requisito atual é conferência manual pelo administrador, com registro da decisão. Aprovação de perfil fictício não comprova habilitação profissional. |
| Play Store e App Store | Sem publicação nas lojas. APK compilado ou bundle gerado não equivale a distribuição homologada. |
