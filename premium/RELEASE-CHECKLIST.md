# Escudo Fit — checkout Premium Pix, revisão sem publicação

## Escopo
- Página **`premium/index.html`** isolada do aplicativo Android e da Web existente.
- Identificação pelo e-mail da Conta Google **antes** de exibir o Pix.
- Planos com valores fixos e pagamento único: R$ 4,99 = 30 dias; R$ 49,90 = 12 meses.
- QR Code gerado localmente, sem serviço externo, a partir das duas cobranças fornecidas pelo titular.
- Copiar e-mail para o campo facultativo Mensagem/Descrição do Pix e copiar Pix Copia e Cola.
- Avisar pagamento pelo WhatsApp 11 98523-7017, com plano e e-mail pré-preenchidos.
- Sem banco de dados, geração de pedido, webhook, confirmação de pagamento, ativação automática, renovação ou envio de e-mail.
- Sem botão no app Wellness para iniciar checkout externo.
- Inclusão de `qrcode.min.js` com licença MIT preservada; sem dependência de CDN.

## Bloqueios de publicação
1. **Revalidar na conta PicPay os dois códigos:** embora os payloads tenham CRC correto, isso não prova que a cobrança permaneça ativa ou permita *reutilização*. Pix com TXID de cobrança deve ser tratado como potencialmente de uso único; não divulgar múltiplas vendas com um mesmo QR sem confirmação do recebedor/provedor.
2. Conferir valores e favorecido mostrado **pelo aplicativo bancário real**, não apenas por decodificação do QR.
3. Executar teste físico Pix no navegador móvel, copiar texto e abrir QR para os planos mensal e anual.
4. Validar o processo administrativo de conciliação por valor, horário, remetente e e-mail no atendimento. **Mensagem do Pix não é comprovante suficiente**.
5. Definir SLA de conferência e procedimento de estorno/erro, registrando a autorização efetiva no controle de acesso e sem alterar VIP/Vitalício.
6. Revisar privacidade e informações comerciais, comprovantes fiscais, nome do titular e termos antes de promover a página.
7. Para registro confiável de ID de pedido, criar endpoint autenticado que persista pedido/e-mail antes de emitir cobrança dinâmica. A presente página **não cria pedido exclusivo**.
8. D-3: PR Android/API `tonysacramento/escudo-fit-app#56` ainda draft; integração do link na comunicação só depois de publicação e QA. Não ativar disparo sem prévia e opt-out.
9. Não vincular o botão de checkout externo ao app Android distribuído na Play sem base política/programa aplicável.

## Reversão
Não mesclar este PR até fechar a validação Pix. Nenhuma URL `/premium/` da produção é alterada antes do merge.