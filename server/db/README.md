# Banco de dados

Conexão e manutenção do PostgreSQL. Neon hospeda o banco remoto; o PostgreSQL do Docker é um ambiente separado, sem sincronização automática.

| Arquivo/pasta | Função |
|---|---|
| [pool.ts](pool.ts) | Pool de conexões e transações, com descarte de conexão quando o rollback falha. |
| [migrate.ts](migrate.ts) | Verifica todas as migrations aplicadas antes de executar novos SQLs; usa transação, trava concorrente e `schema_migrations`. Também protege conteúdo legado de execuções em cifra. |
| [migration-checksum.ts](migration-checksum.ts) | Calcula SHA-256 com finais de linha LF e recusa divergências ou migrations legadas sem baseline aprovado. |
| [migration-baseline.ts](migration-baseline.ts) | Hashes auditados das migrations 001–007 para completar registros antigos sem checksum. |
| [runtime-privileges.ts](runtime-privileges.ts) | Allowlist das operações permitidas nas 37 tabelas; remove concessões antigas e valida privilégios efetivos, inclusive herdados. |
| [migrations](migrations) | Evolução do esquema: base esportiva, privacidade, comunicação, financeiro e uploads. |
| [seed.ts](seed.ts) | Dados fictícios locais sem sobrescrever contas existentes; recusa `NODE_ENV=production`. |
| [admin.ts](admin.ts) | Cria administrador com os dados fornecidos por variáveis de ambiente. |
| [init-test.sql](init-test.sql) | Cria as bases de teste na primeira inicialização do volume pelo Compose. |

Comandos, executados na raiz: `pnpm db:migrate`, `pnpm db:seed` e `pnpm db:admin`. Conferir o ambiente antes: eles podem modificar dados. Não executar seed na nuvem nem usar produção para testes que limpam tabelas.

Não editar SQL já aplicado para atualizar um banco existente; criar nova migração. O executor compara os arquivos com os checksums persistidos antes de executar qualquer migration pendente. Arquivo aplicado ausente, SQL alterado ou baseline desconhecido interrompem a transação. LF e CRLF produzem o mesmo hash; outras alterações não são ignoradas.

A baseline 001–007 foi auditada contra o conteúdo do commit `3a09d67`. Ela permite completar checksums antigos sem alterar `applied_at`; não constitui prova de qual SQL foi executado historicamente em cada banco. Novas migrations recebem checksum no momento da aplicação. A [suíte de migrations](../../tests/integration/migrations.test.ts) verifica falhas, rollback, concorrência e idempotência em banco `_test`.

As migrations 007 e 008 reforçam avaliações e mensagens vinculadas aos participantes corretos, papéis de atleta/treinador, valores financeiros não negativos e índices de FKs, filas e expiração. As [verificações de integridade](../../tests/integration/database-rules.test.ts) incluem alterações concorrentes e preservação dos fluxos de privacidade.

A [migration 009](migrations/009_mail_delivery.sql) classifica os e-mails, vincula recuperações ao token por FK com exclusão em cascata e registra validade e descarte seguro. Não altera migrations anteriores. Aplicar antes da publicação do consumidor novo; mensagens antigas sem classificação são descartadas por segurança. Os [testes de entrega](../../tests/integration/mail-delivery.test.ts) verificam validade, concorrência, substituição e saúde da fila em PostgreSQL real.

Reiniciar o Docker não reaplica automaticamente `init-test.sql` sobre volume existente. Backups e restauração ficam em [scripts/banco](../../scripts/banco).

Na nuvem, a conta da aplicação opera dados e não modifica o esquema. A allowlist concede operações por finalidade: as seis tabelas de auditoria/histórico recebem apenas `SELECT` e `INSERT`; os registros principais relacionados não recebem `DELETE`, preservando o histórico contra cascatas da aplicação. Exclusões legítimas continuam disponíveis nas tabelas operacionais previstas, como sessões e filas. Tabelas futuras não recebem privilégios automaticamente.

Migrations exigem uma conexão de manutenção, mantida fora das variáveis do deploy. A role proprietária legada de Preview deve permanecer `NOLOGIN`; manutenção usa uma credencial separada e elevação explícita por `SET ROLE`, quando autorizada. O executor aplica a allowlist somente às bases conhecidas de Production/Preview; os testes usam bases próprias.

A aplicação usa TLS com validação do certificado e pooling; manutenção e backup usam conexão direta. Timeouts também são configurados na role do banco. [Configuração e limites do Neon](../../docs/operacao/neon.md).

[Dicionário de dados](../../docs/banco/dicionario-dados.md) · [Guia de testes](../../tests/README.md) · [Voltar ao servidor](../README.md)
