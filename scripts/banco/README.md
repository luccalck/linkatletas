# Banco: backup, recuperação e metadados

Os utilitários locais e os do Neon têm configurações separadas. Conferir o destino antes de executar; alterar `DATABASE_URL` não redireciona os comandos Docker do backup local.

| Arquivo | Função |
|---|---|
| [backup.ts](backup.ts) | Backup da instalação Docker: cifra o dump, copia objetos S3 já cifrados e registra hashes e contagens. |
| [restore.ts](restore.ts) | Restaura o backup local em banco `_test` e bucket vazios, verificando integridade e resultados. |
| [backup-shared.ts](backup-shared.ts) | Chaves, caminhos, comandos Docker e acesso S3 dos utilitários locais. Não é comando independente. |
| [neon-backup.ts](neon-backup.ts) | Snapshot consistente e somente leitura do Neon; formato v2 com dump, checksums, extensões, política de privilégios e cópia dos arquivos privados ativos. |
| [neon-restore-test.ts](neon-restore-test.ts) | Restaura o formato v2 em PostgreSQL 18 e S3 locais exclusivos; confere banco, objetos, decriptação e operações sintéticas da API antes de publicar validação. |
| [neon-backup-check.ts](neon-backup-check.ts) | Confere no Tigris um marcador autenticado de recuperação completa com no máximo 26 horas. Não conecta ao Neon. |
| [neon-backup-objects.ts](neon-backup-objects.ts) | Acesso aos buckets de origem, backup e restauração; cópia de objetos cifrados com limites e hashes. |
| [neon-backup-recovery.ts](neon-backup-recovery.ts) | Verifica dados privados e arquivos com a chave original; exercita a API restaurada com conta fictícia e role local limitada. |
| [neon-backup-validation.ts](neon-backup-validation.ts) | Publica o marcador autenticado após a recuperação completa e aplica retenção aos objetos pertencentes ao backup. |
| [neon-backup-shared.ts](neon-backup-shared.ts) | Formatos v1/v2, cifra autenticada, destinos permitidos, limites e clientes oficiais PostgreSQL 18 via Docker. |
| [export-schema.ts](export-schema.ts) | Gera metadados JSON, dicionário e DER a partir do esquema migrado, sem exportar registros dos usuários. |

## Instalação local

Executar na raiz:

```powershell
pnpm exec tsx scripts/banco/backup.ts nome-do-backup
pnpm exec tsx scripts/banco/restore.ts nome-do-backup destino_test bucket-vazio-de-teste
pnpm exec tsx scripts/banco/export-schema.ts
```

Backup/restauração locais usam Docker e os parâmetros `BACKUP_DB_CONTAINER`, `BACKUP_DB_USER`, `BACKUP_DB_NAME`, `BACKUP_ROOT` e S3. O diretório do backup deve ficar estritamente dentro de `BACKUP_ROOT`, cujo padrão é `tmp/backups`. A chave vem de `DATA_ENCRYPTION_KEY` ou do arquivo local existente. O manifesto não inclui a chave, mas contém nomes de objetos e contagens e deve permanecer privado.

A restauração recusa banco ocupado ou sem sufixo `_test` e bucket ocupado. Uma falha posterior pode deixar restauração parcial: banco e S3 não compartilham transação. Suspender escritas durante o procedimento local e reaplicar eliminações posteriores quando necessário. O worker privado exige rede, imagem e arquivo de ambiente `BACKUP_DOCKER_*`; não publica a porta do armazenamento.

## Neon e cópia independente

```powershell
node --import tsx scripts/banco/neon-backup.ts
node --import tsx scripts/banco/neon-restore-test.ts <chave-do-objeto>
node --import tsx scripts/banco/neon-backup-check.ts
```

O [procedimento do Neon](../../docs/operacao/neon.md#backup-independente-no-tigris) centraliza variáveis, credenciais, objetivos e recuperação. Os [workflows](../../.github/workflows/README.md#backup-de-producao) executam backup diário e monitor horário independente no runner, sem depender do computador dos integrantes.

O formato v2 preserva o dump e os arquivos ativos referenciados pelo banco. O manifesto cifrado registra hashes dos objetos, extensões, checksums das migrations e privilégios de dados da role runtime. A origem usa conta PostgreSQL e credencial S3 somente leitura; o destino é um bucket privado exclusivo de backup. A restauração exige PostgreSQL 18 local vazio e bucket S3 local vazio; não usa produção como destino.

Também são necessárias a chave exclusiva do backup, a **chave original `DATA_ENCRYPTION_KEY`** e uma terceira chave exclusiva `NEON_BACKUP_VALIDATION_KEY` para autenticar os marcadores. O monitor recebe somente a chave de validação e leitura do bucket, sem chaves de cifra do dump/dados nem credenciais PostgreSQL. O fingerprint identifica a chave original, mas não a substitui. O ensaio verifica a decriptação sem publicar conteúdo privado e usa API, conta e armazenamento isolados, sem SMTP externo ou pagamentos reais. Roles e senhas do provedor não são copiadas: uma role temporária local recebe a política de privilégios registrada.

Uma cópia v1 antiga não comprova recuperação completa de arquivos e aplicação. O marcador de sucesso só é produzido após o ensaio v2 completo; o monitor não confunde upload concluído com recuperação validada e não repete a restauração. O snapshot captura a lista dos arquivos ativos, mas a cópia S3 ocorre após a transação PostgreSQL; partes temporárias de uploads ficam fora do backup, e arquivo final ausente faz a cópia falhar. Os objetivos acadêmicos são RPO de 24 horas e RTO de 60 minutos, sem garantia de SLA; o tempo do ensaio técnico não inclui provisionamento de um incidente real.

O arquivo cifrado e cada objeto têm limite de 128 MiB. A capacidade e a retenção de sete dias precisam ser revistas conforme o volume cresce. Não gravar dumps, manifestos, chaves ou arquivos de usuários no Git nem nos artifacts das Actions.

O ensaio da aplicação restaurada cobre atleta, treinador e administrador: perfis, conferência manual de CREF, solicitação e aceite de contratação, prescrição, execução com feedback cifrado, persistência e permissões. As contas fictícias e a role temporária são removidas após o ensaio, inclusive quando ele falha. A [suíte isolada](../../tests/integration/neon-restored-flow.test.ts) também verifica essa limpeza.

Uma recuperação válida com mais de 26 horas recebe marcador histórico autenticado, sem executar a limpeza de retenção nem se apresentar como cópia recente. O monitor continua exigindo um snapshot recente; restaurar uma cópia antiga não resolve um alerta de atualidade. Os [testes históricos](../../tests/unit/neon-backup-history.test.ts) cobrem três e sete dias, cronologia inválida, adulteração e coexistência com marcador recente.

[Voltar aos scripts](../README.md) · [Procedimento operacional](../../docs/operacao/manual.md)
