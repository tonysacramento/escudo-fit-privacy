# Registro restrito de aprovação assinada — candidata validada de 20/10/2026

Estado: **TECHNICAL_QA_PASS_DRAFT_NOT_PUBLISHED**. PR Web #48 DRAFT, branch feat/pilot-approval-install-20261020. Código `802a8a5306cf29d1169c0440e95d1f3ce88efd9b`, sobre main `2c479403b3c92a8a1da5adbe7e5e8c3ae9f77096`, que permanece publicada e inalterada.

A tela /app/pilot-pix/approval/ recebe o arquivo JSON já assinado pelo operador, verifica escopo/encoding/digest e pede três callbacks Google recentes (auditoria, comprador, auditoria), com nonces próprios de instalação. A assinatura Ed25519 é verificada no backend privado com chave pública/fingerprint fixados antes do challenge e da gravação. A página não declara verificação criptográfica apenas pela leitura do arquivo.

Destino fixo: relay pilot-approval → privado pvapproval com IAM. O backend exige todas as onze flags de emissão/entrega false, verifica as duas contas, relê vínculo/plano e registra apenas a aprovação idempotente. Esta página não assina, não emite Pix e não concede Premium. A política proposta descreve o armazenamento da aprovação pseudônima separadamente da prévia sem gravação. Arquivo/credenciais ficam apenas em memória transitória; não há storage, logging, JWT decoding ou retry automático. O SW existente já exclui /app/pilot-pix/ do cache e não foi alterado.

## QA nativa concluída

| Execução | Resultado |
| --- | --- |
| [Preview/instalação 39449377405](https://github.com/tonysacramento/escudo-fit-privacy/actions/runs/39449377405), job118719778105 | **87/87 Node e 10/10 navegador PASS** |
| [Full Web 39449377307](https://github.com/tonysacramento/escudo-fit-privacy/actions/runs/39449377307), job118719778311 | **27/27 navegador PASS** |
| [Mobile Identity 39449377523](https://github.com/tonysacramento/escudo-fit-privacy/actions/runs/39449377523), job118719778979 | **87/87 Node e 3/3 navegador PASS** |
| [History 39449377517](https://github.com/tonysacramento/escudo-fit-privacy/actions/runs/39449377517), job118719779908 | **SUCCESS**, contratos preservados |

Os dez casos do primeiro workflow são cinco da prévia existente e cinco novos de instalação, incluindo larguras320/375, resposta financeira inesperada, arquivo inválido e cancelamento. Google e API são explicitamente mockados; todo destino externo restante é bloqueado. Não equivalem a login, KMS ou aprovação financeira real. Os nove contratos novos cobrem escopo/idade de arquivo, propósito/nonce, resultado ligado ao digest, repetição de callback, limpeza, expiração e resposta financeira indevida.

A tentativa Playwright local não iniciou por ausência do binário Chromium; a CI nativa instalou a dependência oficial e executou todos os casos sem relaxar as asserções. Nove arquivos de fonte/política/QA foram relidos e coincidem com o preparado.

## Backend e continuação

Autorização monetária específica recebida às12:03 BRT para um único Pix de R$4,99/30dias/sem renovação. Backend fonte5d2d4efcaca338a70620554181c083b963d30b2a, publicador d3b9d7da821b6826e4b057feed8107b245f0d03d, [stage39447863421 SUCCESS](https://github.com/tonysacramento/escudo-fit-app/actions/runs/39447863421), duas tags novas a0%, seis HTTP reais PASS e 429/429 backend. Ambas as flags de instalação/relay e as onze financeiras continuam false; main, tags anteriores, leitor e IAM preservados.

Nenhuma assinatura financeira, aprovação real, ordem LIVE ou Premium criado por esta preparação. Dispositivo Fsa-Sac01 offline e Cloud Console da sessão indisponível; a assinatura exige a autenticação normal do operador. Preparar proposta fresca apenas quando ele puder assinar. Depois, publicar a interface revisada e habilitar somente instalação, confirmar as pessoas e registrar; emissão única, pagamento manual, webhook/COMMITTED/conciliação/entrega continuam etapas seguintes do mesmo escopo autorizado.

**Não publicada:** esta PR permanece DRAFT até a continuação do gate. Checkout geral #44 e os demais fluxos não foram promovidos. Android/iOS sem novo build; QA físico pendente. Metadados/screenshots de loja e privacidade atualmente publicada preservados; nova seção de privacidade proposta neste branch.
