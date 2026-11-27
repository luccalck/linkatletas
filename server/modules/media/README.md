# Arquivos privados

| Arquivo | Função |
|---|---|
| [routes.ts](routes.ts) | Cliente S3, autorização, validação de arquivo, cifra, leitura/Range, exclusão e feedback. |
| [object-format.ts](object-format.ts) | Cifra autenticada em blocos de 256 KiB, leitura parcial do S3 e compatibilidade com objetos anteriores. |
| [uploads.ts](uploads.ts) | Sessões de upload em partes, validação de tamanho/índice, conclusão e limpeza de partes expiradas. |
| [limits.ts](limits.ts) | Limita a duas operações intensivas simultâneas por instância da API, devolvendo 429 e Retry-After em vez de acumular processamento. |

Os binários ficam no Tigris em nuvem e no SeaweedFS local. PostgreSQL guarda metadados em `media`, feedback em `media_feedback` e envios temporários em `media_uploads`.

O acesso depende da finalidade: comprovação profissional, orientação do treinador, performance do atleta ou anexo de mensagem. Ser administrador não concede acesso geral aos arquivos esportivos; comprovação profissional possui regra administrativa própria. Performance exige consentimento.

Limites: imagens/PDF até 10 MiB, vídeos até 50 MiB; comprovação não aceita vídeo. Partes têm até 3 MiB. O servidor verifica assinatura, MIME e extensão, cifra os objetos e gera a chave de armazenamento.

Validação de formato não é análise antimalware. Finalização/download ainda usam memória proporcional ao arquivo, e banco/S3 não compartilham transação distribuída. Os [jobs](../../jobs.ts) removem envios expirados.

Upload direto, conclusão e download compartilham o limite de duas operações por instância; endpoints leves permanecem disponíveis. A proteção não é um limite global entre funções Vercel nem uma quota de armazenamento por conta. O processamento transacional de partes reaproveita a conexão para autorização e persistência, evitando esperar por outra conexão do mesmo pool.

[Módulos](../README.md) · [Testes de plataforma](../../../tests/integration/platform.test.ts)
