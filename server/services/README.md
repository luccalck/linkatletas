# Integrações externas

Adaptadores usados pelo servidor para conversar com provedores. As regras e permissões das operações ficam nos [módulos](../modules/README.md).

| Arquivo | Função |
|---|---|
| [mail.ts](mail.ts) | Enfileira e-mails com corpo cifrado e entrega os pendentes por SMTP, com tentativas e intervalo entre falhas. Fecha o transporte ao terminar. |
| [mail-queue-health.ts](mail-queue-health.ts) | Resume pendências, atrasos, tentativas esgotadas e recuperações vencidas após falha de entrega, sem expor destinatários ou conteúdo. |
| [asaas.ts](asaas.ts) | Cria checkout, consulta e solicita cancelamentos financeiros, tratando timeout, respostas inválidas e resultados incertos. |

E-mail usa Brevo na nuvem e Mailpit localmente. O financeiro permanece em modo acadêmico; o adaptador implementado não comprova homologação nem cobrança real. Endpoints alternativos do Asaas são restritos a loopback para testes controlados.

Configuração vem das variáveis do servidor. Não registrar credenciais, tokens ou corpos privados nos logs. Aceite SMTP não garante chegada à caixa de entrada; resposta financeira incerta exige conciliação antes de repetir uma operação.

Mensagens de recuperação ficam vinculadas ao token e à validade. O consumidor descarta mensagens vencidas, utilizadas, legadas sem classificação ou de contas inativas e elimina o corpo cifrado. Uma nova solicitação substitui o token e remove sua mensagem anterior por chave estrangeira. A entrega usa bloqueios para impedir envio simultâneo do mesmo item; SMTP não oferece garantia de entrega exatamente uma vez após uma interrupção entre o envio e o commit.

O monitor protegido `/api/internal/queues` responde 503 para fila degradada. O executor `/api/internal/jobs` continua funcionando mesmo nessa situação, para preservar reconciliações e limpezas; falhas de execução continuam produzindo erro. Ambos exigem `CRON_SECRET` e não fazem parte da API pública documentada.

[Voltar ao servidor](../README.md) · [Serviços utilizados](../../docs/operacao/servicos-externos.md)
