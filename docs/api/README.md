# API do LinkAtletas

Base local: `http://localhost:3001/api`. Swagger: `/api/docs`; especificação runtime: `/api/openapi.json`. Os contratos TypeScript estão em [contracts.ts](../../shared/contracts.ts), [interaction-contracts.ts](../../shared/interaction-contracts.ts) e [billing-contracts.ts](../../shared/billing-contracts.ts). Este guia descreve os módulos; a especificação runtime contém schemas e códigos atualizados.

## Sessão, origem e erros

Web: cookie opaco `la_session`, HttpOnly, SameSite=Lax e Secure no ambiente HTTPS. Mutações exigem `Origin` autorizado; o frontend chama a mesma origem `/api`. Nativo: `Authorization: Bearer <token-opaco>` emitido pelos endpoints nativos, armazenado em SecureStore; o servidor guarda somente o hash. Nunca colocar token em URL, logs ou chave pública de ambiente.

Entrada JSON validada no servidor; upload usa multipart ou partes binárias autenticadas. Falhas devolvem `code`, `message` e eventualmente `fields`. Códigos comuns: 400 inválido, 401 sem sessão/credencial, 403 papel/estado, 404 recurso privado alheio, 409 conflito, 413 arquivo, 429 limite e 503 integração não configurada. Não repetir criação financeira após timeout supondo falha; consultar estado/conciliar.

## Conta e perfil

| Método e rota | Entrada | Retorno/comportamento |
|---|---|---|
| POST `/auth/register` | `{name,email,password,role:'athlete'|'coach'}` | 201 `{user}`, cookie; cadastro não cria admin |
| POST `/auth/login` | `{email,password}` | `{user}`, cookie |
| POST `/auth/native/register` | Mesmo cadastro | 201 `{user,token,expiresAt}`, sem cookie |
| POST `/auth/native/login` | `{email,password}` | `{user,token,expiresAt}`, sem cookie |
| GET `/auth/session` | Sessão opcional | `{user:null|AppUser}` |
| POST `/auth/logout` | `{}` | Invalida sessão cookie/Bearer |
| POST `/auth/forgot-password` | `{email}` | Resposta genérica, outbox SMTP se conta ativa |
| POST `/auth/reset-password` | `{token,password}` | Token de uso único, 30 min; invalida sessões |
| POST `/auth/native/forgot-password` | `{email}` | Mesma recuperação por SMTP para o cliente nativo; resposta genérica |
| POST `/auth/native/reset-password` | `{token,password}` | Mesma validação de uso único; não inicia sessão automaticamente |
| GET/PUT `/profiles/me` | PUT: perfil esportivo `ProfileInput` | `{profile}`; campos/limites em contracts/runtime |
| GET `/coaches` | `sport`, `query`, `maxPrice`, `mode` opcionais | `{coaches}` aprovados, elegíveis e com motivos da nota |

Reset enviado para `/redefinir-senha#token=...`; o fragmento não integra a requisição HTTP. Senha não é enviada por e-mail. SMTP local Mailpit captura a mensagem sem encaminhamento externo.

## Validação profissional, vínculo e treino

| Método e rota | Entrada/retorno |
|---|---|
| GET `/verifications` | Histórico do treinador autenticado |
| POST `/verifications` | `{cref,evidence,documentId?}`; documento privado opcional do próprio treinador |
| GET `/admin/verifications` | Admin: pendências/histórico, documento e prazo |
| PATCH `/admin/verifications/:id` | `{status:'approved'|'rejected',reason,expiresAt?}`; justificativa min. 5 e prazo futuro |
| PATCH `/admin/coaches/:id/verification` | `{status:'suspended'|'rejected',reason}`; auditoria e bloqueio profissional |
| GET/POST `/contracts` | GET próprios; POST `{coachId}` cria ciclo pendente |
| PATCH `/contracts/:id` | Treinador decide `{status:'active'|'rejected'}` |
| POST `/contracts/:id/cancel` | Participante `{reason}`; idempotente, respeita financeiro e vigência |
| GET/POST `/workouts` | Lista autorizada; POST `WorkoutInput` cria ficha/blocos |
| GET/PUT `/workouts/:id` | Conteúdo autorizado; PUT edita sem alterar ciclo nem ficha já executada |
| PUT `/workouts/:id/execution` | `{completedBlocks,effort,notes,metrics}`; uma execução por ficha, valores validados |
| GET `/metrics?sport=Corrida` | Catálogo de chave/label/unidade/limite |
| GET `/dashboard` | `{contracts,workouts}` autorizados |

## Arquivos privados

Textos e chaves com byte nulo são recusados com 400 antes de alcançar o PostgreSQL. Texto semelhante a SQL ou HTML continua sendo dado: consultas parametrizadas e apresentação escapada são as proteções, não remover palavras do conteúdo do usuário.

Referências externas de treinos e agenda exigem HTTPS sem credenciais, controles, IP literal, nome local ou porta alternativa. O servidor não visita esses endereços. Isso não verifica reputação, redirecionamento ou resolução DNS do domínio. Não transformar a referência em prévia ou download automático sem uma nova proteção de saída de rede.

Para arquivos maiores que 3 MiB, web e aplicativo usam sessões de envio:

| Método e rota | Entrada e comportamento |
|---|---|
| POST `/media/uploads` | JSON `{purpose,resourceId,name,mimeType,size}`; retorna 201 `{upload:{id,partSize,parts,expiresAt}}` |
| PUT `/media/uploads/:id/parts/:part` | `Content-Type: application/octet-stream`, parte binária do tamanho esperado; índices começam em zero; máximo 3 MiB por requisição |
| POST `/media/uploads/:id/complete` | Recompõe, valida assinatura/tipo/extensão/limite, revalida autorização e consentimento, salva cifrado e retorna 201 `{media}`; repetição retorna o mesmo arquivo |
| DELETE `/media/uploads/:id` | Titular cancela a sessão e elimina as partes temporárias; não exclui uma mídia já concluída |

Sessões expiram em uma hora, com no máximo três envios incompletos por usuário. As partes também ficam cifradas. O job elimina sessões expiradas e seus objetos temporários; revogação de performance e encerramento da conta eliminam partes correspondentes. Downloads usam resposta em stream e aceitam `Range: bytes=inicio-fim`, retornando 206/`Content-Range`; faixa inválida retorna 416. O suporte efetivo a arquivos grandes na Vercel exige o teste da implantação, além do teste local.

Upload direto, conclusão de partes e download admitem no máximo duas operações simultâneas por instância da API; excesso retorna 429 `MEDIA_BUSY`, com `Retry-After: 1`. O cliente pode tentar novamente após a resposta, sem presumir limite global entre instâncias. A checagem de formato não é antivírus. PDF é entregue como anexo; respostas de conteúdo têm sandbox CSP, nosniff e no-store.

`POST /media?purpose=verification|instruction|performance|message&resourceId=UUID`: multipart com um campo `file`; retorna 201 `{media}`. `resourceId`: usuário treinador para verification, ficha para instruction/performance, contrato para message. API confere propriedade e finalidade; performance exige consentimento.

`GET /media?resourceId=UUID` retorna `{media:[...com feedback]}`. `GET /media/:id/content` autoriza e recupera bytes originais de conteúdo cifrado S3. `DELETE /media/:id` exige titular. `POST /media/:id/feedback {text}` exige treinador do vínculo e arquivo de performance. Formatos JPEG/PNG/WebP/PDF até 10 MiB e MP4/WebM até 50 MiB; documento profissional não aceita vídeo. Assinatura real, MIME e extensão precisam coincidir. Não há bucket público nem chave fornecida pelo cliente.

## Comunicação, notificações, avaliações e agenda

| Método e rota | Entrada/retorno |
|---|---|
| GET `/contracts/:id/messages` | `before=UUID&limit=1..100`; `{messages,nextCursor}` em ordem cronológica |
| POST `/contracts/:id/messages` | `{text,mediaId?}`; texto ou anexo do remetente/recurso; vínculo ativo |
| PUT `/contracts/:id/messages/read` | `{throughId?}`; leitura até snapshot/cursor, sem marcar futuras |
| GET `/notifications` | `{notifications,unread}` somente do destinatário |
| PUT `/notifications` | `{ids?:UUID[],all?:boolean}` marca próprias |
| GET `/reviews?coachId=UUID` | Filtro opcional; `{reviews,average,count}` sem ocultos |
| POST `/reviews` | `{contractId,rating:1..5,text}`; elegibilidade e unicidade por ciclo |
| PUT `/reviews/:id` | Autor `{rating,text}` |
| POST `/reviews/:id/reply` | Treinador avaliado `{text}` |
| POST `/reviews/:id/report` | `{reason}`; denúncia registrada |
| GET `/admin/reviews` | Admin `{reviews,reports}` |
| PATCH `/admin/reviews/:id` | Admin `{hidden,reason}`; histórico de moderação |
| GET/POST `/consultations` | GET próprias; POST `{contractId,title,description,startsAt,durationMinutes,meetingUrl?}` |
| PATCH `/consultations/:id` | `{startsAt?,durationMinutes?,status?,meetingUrl?,reason}`; motivo obrigatório; conflito/papel/horário conferidos |
| POST `/consultations/:id/google-event` | `{eventId,meetingUrl:'https://meet.google.com/...'}` referência depois da ação Google autorizada |

WebSocket `/api/events` autentica cookie/Bearer antes do upgrade e valida origem browser. Eventos definidos em `InteractionEvent`: `ready`, `message`, `notification`, `read`, `consultation`. Escritas usam REST validado; eventos só são publicados após persistência. Reconexão consulta histórico REST. Nenhum token vai na URL. Implementação atual tem publicação em uma instância; escala distribuída exige broker.

## Financeiro

| Método e rota | Entrada/retorno |
|---|---|
| GET `/billing/config` | `BillingConfig` direto: mode/environment/available/commissionBps/graceDays |
| GET/PUT `/billing/wallet` | Treinador: `{wallet}`; PUT `{walletId:UUID}` elegível no provedor |
| GET/PUT `/billing/plan` | Treinador: `{plan}`; PUT `{name,amountCents:int,active}` |
| GET `/billing/plans?coachId=UUID` | Planos ativos de treinadores com conta ativa e aprovação vigente; aprovação vencida ou conta encerrada não aparece |
| PATCH `/admin/billing/settings` | Admin `{commissionBps:0..5000,graceDays:0..30}`; auditado |
| POST `/billing/checkout` | Atleta `{contractId}`; `{subscription}` com checkout hospedado; academic retorna indisponibilidade |
| GET `/billing/summary` | `BillingSummary` direto: assinaturas, pagamentos e totais |
| POST `/billing/subscriptions/:id/cancel` | `{reason}`; intenção/confirmado/periodo pago preservados |
| POST `/billing/webhook` | Evento Asaas, cabeçalho `asaas-access-token`; autenticação antes de persistir |

API key Asaas somente no servidor. Webhook é protegido por token configurado distinto da API key, com comparação em tempo constante; não há alegação de assinatura HMAC fornecida pelo Asaas. Evento tem ID único, payload minimizado e processamento persistido. Partes calculadas sobre valor líquido são estimativas de participação; eventos de split são registros próprios e não certificam liquidação bancária. Teste HTTP controlado não equivale a sandbox real.

## Privacidade

GET `/privacy/policy` é público e retorna `{policy:{version,text,retention}}`. GET `/privacy/consents` retorna consentimentos do titular; PUT `{purpose:'performance'|'health'|'communications',granted:boolean}` registra versão/histórico e revogação. GET/PUT `/privacy/health` usa `{notes,heightCm?,weightKg?}`, exige consentimento para gravar e cifra payload. GET `/privacy/export` retorna JSON só do titular, sem hashes/tokens. POST `/privacy/delete {password}` reautentica, confere financeiro, elimina/anonimiza e invalida sessões. GET `/admin/privacy/requests` mostra pedidos/resultado a administrador; DTO usa os nomes SQL `user_id`, `requested_at`, `completed_at`.

## Fontes dos provedores

[Asaas Checkout](https://docs.asaas.com/docs/introdu%C3%A7%C3%A3o-1), [webhooks](https://docs.asaas.com/docs/about-webhooks), [Google Calendar Events insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), [Mailpit](https://mailpit.axllent.org/docs/), [SeaweedFS S3](https://github.com/seaweedfs/seaweedfs/blob/master/weed/command/s3.go). Configuração externa permanece responsabilidade do proprietário; testes não enviam convites nem cobram terceiros.

## Elegibilidade profissional nas operações

Novo vínculo exige treinador com conta ativa e aprovação vigente. Aceitar pedido antigo revalida a validade profissional. Checkout revalida essas condições antes de retornar ou criar uma assinatura; caso contrário responde `409 UNAVAILABLE_COACH` sem iniciar cobrança. O catálogo de planos também exclui contas desativadas e aprovações vencidas.
