# Operação do PostgreSQL no Neon

O Neon hospeda o PostgreSQL da aplicação publicada. O PostgreSQL do Docker permanece separado, para desenvolvimento e testes; não existe sincronização automática entre os ambientes.

## Ambientes e contas

| Ambiente | Base | Conta de execução |
|---|---|---|
| Production | `neondb` | `linkatletas_production_runtime` |
| Preview | `linkatletas_preview`, em branch separado | `linkatletas_preview_runtime` |

A aplicação não possui o banco nem as tabelas. O navegador acessa a API, que autoriza cada usuário e recurso; a conexão PostgreSQL não é entregue ao cliente. O projeto não usa Neon Auth para autenticação: contas e sessões são gerenciadas pela API do LinkAtletas.

A [allowlist de privilégios](../../server/db/runtime-privileges.ts) define as operações necessárias nas 37 tabelas:

- `schema_migrations` e `metric_types`: somente `SELECT`.
- `administrative_audit`, `billing_audit`, `consent_history`, `consultation_history`, `review_moderation` e `verification_audit`: apenas `SELECT` e `INSERT`, sem edição ou exclusão pela aplicação.
- Registros principais relacionados, como usuários, contratos, consultas e avaliações: sem `DELETE` pela role runtime, impedindo que a aplicação apague o histórico por cascata. Encerramento de conta e remoção de conteúdo usam os fluxos previstos de anonimização e exclusão lógica.
- Sessões, notificações, filas e outras tabelas operacionais: operações específicas previstas no código, incluindo exclusões necessárias.

O configurador remove grants antigos de tabela e coluna, recusa permissões incompatíveis herdadas e retira grants automáticos para tabelas futuras. Uma nova tabela permanece inacessível até sua inclusão consciente na allowlist. Runtime não recebe DDL, `TRUNCATE`, criação de roles/bancos, replicação ou bypass de RLS.

Nas variáveis PostgreSQL do deploy, manter somente `DATABASE_URL`, com a conta limitada do ambiente. Não manter aliases contendo senhas ou URLs proprietárias. A manutenção usa conexão direta e credencial separada, fora do deploy e do Git. Em Preview, a role proprietária legada deve ficar `NOLOGIN`; o acesso administrativo usa elevação explícita por `SET ROLE` a partir da credencial autorizada. Não apagar a role proprietária nem transferir seus objetos sem planejamento.

## Conexões e limites

- A região da função Vercel é definida como São Paulo (`gru1`) em [vercel.json](../../vercel.json), próxima ao PostgreSQL em `sa-east-1`. A configuração do repositório precisa estar presente no deployment publicado; um deployment anterior mantém sua região original.
- Aplicação: endpoint com `-pooler` e `sslmode=verify-full`, validando o certificado do servidor. Manutenção e backup: conexão direta.
- Cada pool da API admite até dez conexões e espera até cinco segundos para conectar.
- Consultas têm limite de 30 segundos; espera por locks, cinco segundos; transações ociosas, um minuto. O cliente limita a espera de consulta a 35 segundos.
- A transação da trava do agendador usa uma exceção local de cinco minutos, correspondente ao máximo da função Vercel. O término da transação restaura o limite normal.
- Configurar os parâmetros na role e na base correspondente e conferir `current_setting`: o pooler pode não preservar parâmetros do startup. Alterações de role afetam novas sessões.
- Desconexões são tratadas sem registrar mensagens originais potencialmente privadas. A consulta continua falhando explicitamente; o tratamento não converte falha em sucesso.

Exemplo de configuração por manutenção, após conferir o ambiente:

```sql
ALTER ROLE linkatletas_production_runtime IN DATABASE neondb SET statement_timeout = '30s';
ALTER ROLE linkatletas_production_runtime IN DATABASE neondb SET lock_timeout = '5s';
ALTER ROLE linkatletas_production_runtime IN DATABASE neondb SET idle_in_transaction_session_timeout = '60s';
```

## Esquema e publicação

As [migrations](../../server/db/migrations) são a fonte de evolução do esquema. O executor usa transação e trava para serializar execuções concorrentes e verifica todas as migrations aplicadas antes de executar qualquer SQL pendente. Arquivo aplicado ausente ou checksum divergente interrompem a operação; alterações já realizadas na transação são desfeitas.

O SHA-256 normaliza CRLF para LF. Outras alterações no conteúdo não são ignoradas. A [baseline 001–007](../../server/db/migration-baseline.ts) foi auditada contra os arquivos do commit `3a09d67`; permite completar checksums legados ausentes, preservando `applied_at`. Essa comparação não prova qual SQL foi executado historicamente no banco. Migration legada desconhecida sem checksum é recusada. Novas migrations recebem checksum ao serem aplicadas; não editar SQL já aplicado.

A migration 007 vincula avaliações aos participantes do contrato, limita comissões e cria índices de apoio às FKs. A 008 reforça papéis de atleta/treinador, remetentes pertencentes ao contrato, valores financeiros não negativos e índices das filas e expiração. Chaves compostas e CHECKs protegem também alterações concorrentes; encerramento de conta e alterações válidas de participantes são preservados.

A migration 009 adiciona finalidade, referência ao token, validade e estado de descarte à fila de e-mails. Deve ser aplicada antes da publicação do novo consumidor. Recuperações substituídas são removidas por FK; o consumidor não envia registros vencidos, utilizados ou legados sem classificação. O esquema gerado passa a ter 37 tabelas, 277 colunas e 48 FKs.

Antes de publicar, aplicar e testar em banco `_test` isolado, conferir os dados existentes e usar manutenção com espera por locks limitada. Uma falha deve ser investigada, sem remover dados automaticamente para forçar a migração. Consultar os testes de [migrations](../../tests/integration/migrations.test.ts) e [integridade](../../tests/integration/database-rules.test.ts). O [dicionário](../banco/dicionario-dados.md), o [DER](../diagramas/der.mmd) e os metadados são gerados do esquema migrado, compatível com PostgreSQL 17 local e 18 do Neon.

## Filas, e-mails e escala a zero

E-mails são gravados cifrados em `mail_outbox`. Depois do commit, a aplicação tenta enviar imediatamente o item específico; na Vercel, `waitUntil` mantém o trabalho associado à execução da função. Uma falha deixa o item na fila para nova tentativa, em vez de depender exclusivamente do agendador para o primeiro envio. Preview mantém envio externo desativado.

A periodicidade operacional recomendada para o cron-job.org é **quinze minutos**. Ele chama `/api/internal/jobs` com o segredo exclusivo no cabeçalho `Authorization`; a rota processa filas, reconciliações e limpezas sob trava, impedindo sobreposição. A mudança da periodicidade precisa ser aplicada e conferida no painel do serviço: o código não altera a agenda remota. A configuração anterior de um minuto mantinha o compute acordado, apesar da escala a zero após cinco minutos.

O intervalo maior reduz despertares sem tirar o envio imediato do fluxo normal. Falhas de SMTP podem adiar a recuperação pelo cron; observar tentativas esgotadas e erros de execução. Aceite SMTP não garante entrega na caixa de entrada.

O monitor separado `/api/internal/queues`, também protegido pelo `CRON_SECRET` e com `Cache-Control: no-store`, retorna apenas contagens e idade da pendência mais antiga. Responde 503 quando há cinco tentativas esgotadas, pendência acima de trinta minutos ou recuperação vencida após falha de entrega. Não retorna destinatários, tokens ou mensagens. O executor `/api/internal/jobs` continua retornando 200 se concluiu seu trabalho, mesmo quando a fila está degradada; erros reais de execução continuam falhando. Separar as duas agendas impede que um alerta de SMTP desative também reconciliações e limpezas.

Configurar uma segunda tarefa no cron-job.org a cada quinze minutos para o monitor, com o mesmo segredo já autorizado ao serviço. Ativar alertas de falha, recuperação e desativação; conferir execução real no histórico. Caso o provedor desative o monitor após falhas consecutivas, corrigir a causa e reativá-lo. A rota criada no código, sozinha, não configura a agenda externa.

Uma nova solicitação de recuperação substitui o token anterior e sua mensagem; redefinição utilizada ou conta encerrada impede o envio pendente. O corpo cifrado é apagado no envio ou descarte. A concorrência é controlada por bloqueios no token e na mensagem; SMTP e PostgreSQL não compartilham transação, portanto interrupção após aceite SMTP e antes do commit pode causar repetição. Não prometer entrega exatamente uma vez.

## Backup independente no Tigris

O [workflow de backup](../../.github/workflows/neon-backup.yml) define execução diária às 06:30 UTC (03:30 em São Paulo), além do disparo manual. O formato **v2** inclui:

1. Snapshot PostgreSQL consistente e somente leitura, compartilhado com `pg_dump` PostgreSQL 18; dump, tabelas, contagens, extensões e checksums das migrations.
2. Política efetiva de privilégios de dados da role runtime, para recriar uma role limitada no teste de recuperação, sem copiar senhas ou contas gerenciadas do provedor.
3. Cópia dos objetos privados ativos referenciados em `media`, preservando a cifra original e registrando tamanho e SHA-256 no manifesto.
4. Dump e manifesto protegidos por AES-256-GCM com chave exclusiva; destino em bucket privado de backup, separado dos buckets da aplicação. A origem PostgreSQL e a origem S3 usam credenciais somente leitura.
5. Leitura de conferência e recusa de acesso anônimo. Upload concluído não significa recuperação validada.

Cada execução deve restaurar o v2 em PostgreSQL 18 temporário e S3 local vazio do runner. O teste compara contagens, migrations, checksums, extensões, restrições, arquivos e decriptação dos seis campos privados previstos com a chave original. Exercita também saúde, cadastro, login, perfil, logout e entrada inválida por uma API isolada com conta fictícia e role limitada, sem SMTP externo ou pagamentos reais.

Somente após a recuperação completa o processo publica um marcador autenticado de validação. Cópias v1 históricas não comprovam essa recuperação completa. A existência do workflow não comprova uma execução recente: conferir **Actions → Backup cifrado do Neon** e os resultados do monitor antes de considerar a cópia utilizável. Dumps e conteúdo privado não são enviados como artifacts ou para os logs.

O ensaio também exercita treinador e administrador, conferência manual de CREF, contratação com aceite, prescrição, execução com feedback cifrado e bloqueios entre perfis. Fixtures e role temporária são removidas inclusive após falha; nenhum desses cenários é executado contra produção.

Restaurações de snapshots com mais de 26 horas são válidas como ensaios históricos e recebem marcador autenticado, mas não executam limpeza de retenção nem satisfazem a exigência de cópia recente. A data de validação não substitui a data de criação do snapshot. Os testes cobrem três e sete dias e a coexistência com um marcador recente.

### Credenciais e chaves

Configurar no repositório conforme os arquivos dos workflows, sem colar valores em documentos ou issues:

| Finalidade | Configuração |
|---|---|
| Leitura do Neon | Secret `NEON_BACKUP_DATABASE_URL`, com conta dedicada somente leitura e conexão direta TLS. |
| Proteção do backup | Secret `NEON_BACKUP_ENCRYPTION_KEY`, 32 bytes em base64, exclusivo do backup. |
| Autenticação da recuperação | Secret `NEON_BACKUP_VALIDATION_KEY`, 32 bytes em base64, exclusivo dos marcadores; diferente das chaves do backup e dos dados. |
| Dados privados originais | Secret `NEON_BACKUP_DATA_ENCRYPTION_KEY`, com a `DATA_ENCRYPTION_KEY` original; variável `NEON_BACKUP_DATA_KEY_FINGERPRINT` para conferir sua identidade. |
| Política de execução | Variável `NEON_BACKUP_RUNTIME_ROLE`, identificando a role cujos privilégios serão registrados. |
| Bucket exclusivo de backup | Variáveis `NEON_BACKUP_S3_ENDPOINT` e `NEON_BACKUP_BUCKET`; secrets `NEON_BACKUP_ACCESS_KEY` e `NEON_BACKUP_SECRET_KEY`. |
| Leitura dos arquivos da aplicação | Variáveis `NEON_BACKUP_SOURCE_S3_ENDPOINT` e `NEON_BACKUP_SOURCE_S3_BUCKET`; secrets `NEON_BACKUP_SOURCE_S3_ACCESS_KEY` e `NEON_BACKUP_SOURCE_S3_SECRET_KEY`, somente leitura. |
| Monitor independente | Secrets `NEON_BACKUP_MONITOR_ACCESS_KEY` e `NEON_BACKUP_MONITOR_SECRET_KEY`, somente leitura no bucket de backup; usa a chave de validação e as variáveis de destino, sem receber chaves de cifra do dump/dados ou conexão PostgreSQL. |

Preservar cópias seguras das três chaves, separadas dos dumps e do Git. O fingerprint não recupera a chave original: sem ela, o banco pode ser restaurado e os campos privados continuarem ilegíveis. Se houver rotação, preservar as versões necessárias para as cópias retidas. A chave do bucket não substitui nenhuma chave de cifra ou de validação.

### Recuperação, monitor e objetivos

Para testar uma cópia autorizada, configurar `NEON_BACKUP_RESTORE_URL` para PostgreSQL 18 **local, vazio e com sufixo `_test`**. O S3 de recuperação usa `NEON_BACKUP_RESTORE_S3_ENDPOINT`, `NEON_BACKUP_RESTORE_S3_BUCKET`, `NEON_BACKUP_RESTORE_S3_ACCESS_KEY` e `NEON_BACKUP_RESTORE_S3_SECRET_KEY`; o endpoint deve ser local e o bucket vazio, exclusivo e terminado em `-test`, conforme o validador.

```powershell
node --import tsx scripts/banco/neon-restore-test.ts <chave-do-objeto>
node --import tsx scripts/banco/neon-backup-check.ts
```

O comando recusa destino ocupado, inclusive funções e tipos, e nunca substitui produção automaticamente. Após uma restauração real planejada, reaplicar eliminações posteriores ao snapshot antes de reabrir o serviço. A transação MVCC cobre o banco, a lista de arquivos ativos e o dump, mas termina antes da cópia dos objetos S3. Banco e S3 não compartilham transação: as chaves finais são imutáveis, e objeto ausente ou inconsistente durante a cópia causa falha. Partes temporárias de uploads não compõem a recuperação.

Os objetivos acadêmicos são **RPO de 24 horas** (perda máxima pretendida entre cópias) e **RTO de 60 minutos** (tempo pretendido de recuperação). São objetivos operacionais, não SLA ou promessa de disponibilidade; registrar e avaliar o tempo medido dos ensaios. O tempo técnico de restauração não inclui detecção de incidente nem provisionamento e decisões de uma recuperação real.

O [monitor independente](../../.github/workflows/neon-backup-monitor.yml) roda a cada hora, no minuto 17, e aceita disparo manual. Consulta somente o Tigris, sem conectar ou acordar o Neon. Exige marcador autenticado de recuperação completa com até **26 horas desde a criação do snapshot** e confere a existência, o tamanho e o hash declarado nos metadados do arquivo correspondente. Não baixa nem restaura o conteúdo novamente; essa verificação completa pertence ao ensaio de recuperação. Falta, atraso, marcador inválido, metadados divergentes ou acesso negado fazem o job falhar. Habilitar notificações de falha das Actions; o GitHub pode atrasar agendas e o monitor não envia alertas por um canal externo próprio.

O arquivo cifrado e cada objeto têm limite de 128 MiB. A retenção é de sete dias, com limpeza restrita aos objetos desse processo após uma recuperação validada e regra de expiração no prefixo exclusivo `neon/` do bucket. A regra do provedor é assíncrona e deve ser conferida no painel. Rever capacidade, custo e retenção conforme o projeto cresce, sem contratar plano automaticamente.

## Limites do plano e do escopo

Arquivos locais com credenciais, chaves de cifra e materiais privados devem ficar ignorados pelo Git e protegidos por ACL NTFS limitada ao usuário responsável, SYSTEM e Administrators. A proteção precisa abranger diretórios e arquivos existentes; ignorar um arquivo no Git não impede outros usuários locais de lê-lo. Revogar credenciais eventualmente expostas e preservar as chaves necessárias aos backups retidos.

No plano Free auditado, o histórico nativo do Neon alcança seis horas; não substitui backup remoto independente. A escala a zero está configurada para cinco minutos e o compute para 0,25 CU. Allowlist de IPs/VPC e proteção de branch não estão disponíveis no plano atual. A aplicação usa rede pública autenticada com TLS validado: não desativar essa rede nem contratar upgrade para encerrar um checklist.

O backup não recria contas do provedor, configurações de Vercel/Neon, segredos ou integrações externas. A recuperação validada cobre banco, arquivos ativos, cifra e ensaio sintético da API; não homologa SMTP, pagamentos, Google ou produção inteira.

Referências: [pooling no Neon](https://neon.com/docs/connect/connection-pooling), [roles e privilégios](https://neon.com/docs/manage/roles), [eventos do pool node-postgres](https://node-postgres.com/apis/pool).
