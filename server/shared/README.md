# Recursos internos do servidor

Funções usadas por diferentes módulos do back-end. Esta pasta é diferente de [shared na raiz](../../shared/README.md), que contém contratos compartilhados com site e aplicativo.

| Arquivo | Função |
|---|---|
| [security.ts](security.ts) | Senhas com scrypt, tokens aleatórios, hash de tokens e exigência de sessão/papel. |
| [crypto.ts](crypto.ts) | Cifra e decifra dados privados com AES-256-GCM. |
| [validation.ts](validation.ts) | Schemas Zod de perfil, treino, execução e identificadores; usa os catálogos compartilhados. |
| [external-url.ts](external-url.ts) | Validação comum de referências HTTPS: recusa credenciais, controles, IPs literais, nomes locais e portas alternativas. Não consulta DNS nem baixa conteúdo. |
| [input-guard.ts](input-guard.ts) | Recusa bytes nulos em textos e chaves de corpo JSON, parâmetros e query antes da validação das rotas; preserva bytes de arquivos. |
| [errors.ts](errors.ts) | Converte falhas em respostas HTTP e trata rotas inexistentes/fallback da interface. |
| [openapi.ts](openapi.ts) | Define schemas de respostas e complementa documentação e serialização da API. |

Autorização por recurso também depende do módulo responsável; verificar o papel sozinho não comprova titularidade. Tipos TypeScript não substituem a validação em execução.

Não importar criptografia ou segurança privada no cliente. Preservar a chave dos dados cifrados; perdê-la impede sua recuperação. Alterar schemas de resposta pode mudar os campos efetivamente enviados, por isso exige conferir os consumidores e testes.

[Voltar ao servidor](../README.md)
