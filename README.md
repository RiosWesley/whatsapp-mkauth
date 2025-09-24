## Cobranca Zap API (whatsapp-web.js)

API em Node.js/Express usando `whatsapp-web.js` para envio de mensagens, imagens e documentos, com autenticação opcional compatível com MK-AUTH e logs JSONL.

### Requisitos
- Node.js 18+ (recomendado 20.x)
- Chromium instalado no sistema
- Dependências do Chromium (Puppeteer) disponíveis

### Instalação no Debian
```bash
apt update && apt -y upgrade
apt -y install chromium ca-certificates fonts-liberation \
libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 \
libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libglib2.0-0 libgtk-3-0 \
libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libx11-6 libx11-xcb1 \
libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 \
libxrender1 libxshmfence1 libxss1 libxtst6 wget xdg-utils git

# Node.js LTS 20.x
bash -c "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -"
apt -y install nodejs

# Clone e instale dependências do projeto
cd /opt
git clone https://SEU_GIT_HOST/SEU_USUARIO/whatsapp-mkauth.git
cd whatsapp-mkauth
npm ci --only=production
```

### Configuração
Crie um arquivo `.env` (opcional, porém recomendado):
```bash
cat > .env << 'EOF'
PORT=3000
AUTH_ACCOUNT=usuario_mkauth
AUTH_PASSWORD=senha_mkauth
EOF
```

Variáveis suportadas:
- `PORT`: porta do servidor (padrão: 3000)
- `AUTH_ACCOUNT` / `AUTH_PASSWORD`: credenciais para Basic Auth (recomendado)
- `MK_AUTH_ACCOUNT` / `MK_AUTH_PASSWORD`: aliases aceitos
- `PUPPETEER_EXECUTABLE_PATH`: caminho do Chromium (ex.: `/usr/bin/chromium`)

Persistência de sessão do WhatsApp: `./.wwebjs_auth` (não apague para evitar novo pareamento).

### Execução
Primeiro start (para ler o QR):
```bash
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium npm start
```
Um QR será exibido no console. Escaneie com o WhatsApp em Aparelhos Conectados.

Modo desenvolvimento:
```bash
npm run dev
```

### Executar como serviço (opções)
PM2 (recomendado):
```bash
npm -g i pm2
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium pm2 start npm --name whatsapp-mkauth -- start
pm2 save
pm2 startup systemd -u $(whoami) --hp $HOME
```

Systemd (alternativa):
```bash
cat > /etc/systemd/system/whatsapp-mkauth.service << 'EOF'
[Unit]
Description=whatsapp-mkauth
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/whatsapp-mkauth
Environment=NODE_ENV=production
Environment=PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
EnvironmentFile=/opt/whatsapp-mkauth/.env
ExecStart=/usr/bin/node /opt/whatsapp-mkauth/server.js
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now whatsapp-mkauth
```

### Endpoints
- `GET /` — saúde do serviço.
- `GET /status` — status do cliente WhatsApp e QR (texto) enquanto `status = qr`.
- `GET /check-number?to=5591999998888` — verifica se número existe no WhatsApp.
- `GET /message-status?id=ID` — consulta ACK/estado de mensagem enviada.
- `POST /mk-capture` — captura payloads para análise de integração (salva em logs).

- `POST /send-message`
  - Body: JSON ou form (`application/json` ou `x-www-form-urlencoded`).
  - Campos aceitos (aliases):
    - número: `to` (preferido), `number`, `numero`, `telefone`, `phone`, `destino`
    - mensagem: `msg` (preferido), `message`, `mensagem`, `text`, `body`, `conteudo`
  - Resposta: `{ success: true, id }` ou erro com `status` quando WhatsApp não estiver pronto.

- `POST /send-image`
  - Aceita `multipart/form-data` com campo `image` ou `file`, ou JSON com `url`.
  - Campos: `to`, `image|url|link`, `caption|legenda|descricao`, `filename|nome|nome_arquivo`, `mimetype|contentType|tipo`.

- `POST /send-document`
  - Aceita `multipart/form-data` com campo `document` ou `file`, ou JSON com `url`.
  - Campos: `to`, `document|url|link`, `filename|nome|nome_arquivo`, `mimetype|contentType|tipo`, `caption|legenda|descricao`.

### Autenticação (compatível com MK-AUTH)
Se `AUTH_ACCOUNT` e `AUTH_PASSWORD` estiverem definidos, a API exige Basic Auth:
- Header: `Authorization: Basic base64(conta:senha)`
- Alternativas aceitas: enviar `conta`/`senha` em header, body ou query.

### Exemplos rápidos (curl)
Status/QR:
```bash
curl http://127.0.0.1:3000/status | jq
```

Enviar texto:
```bash
curl -X POST http://127.0.0.1:3000/send-message \
  -u usuario_mkauth:senha_mkauth \
  -H "Content-Type: application/json" \
  -d '{"to":"5591999998888","msg":"Olá do MK-AUTH!"}'
```

Enviar imagem por URL:
```bash
curl -X POST http://127.0.0.1:3000/send-image \
  -u usuario_mkauth:senha_mkauth \
  -H "Content-Type: application/json" \
  -d '{"to":"5591999998888","url":"https://via.placeholder.com/600x300.png","caption":"Legenda"}'
```

Consultar status de mensagem:
```bash
curl "http://127.0.0.1:3000/message-status?id=ID_DA_MENSAGEM"
```

Verificar número:
```bash
curl "http://127.0.0.1:3000/check-number?to=5591999998888"
```

### Logs
- Envio de mensagens: `logs/outgoing-YYYY-MM-DD.log`
- ACKs/entregas: `logs/outgoing-ack-YYYY-MM-DD.log`
- Capturas MK-AUTH: `logs/mk-auth-YYYY-MM-DD.log`

Formato: JSONL (um JSON por linha) com `timestamp` e payload relacionado.

### Observações e Dicas
- Se o QR não aparecer: confirme `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` e dependências instaladas.
- Não apague `./.wwebjs_auth`; isso mantém a sessão autenticada.
- Para atualizar: `git pull && npm ci --only=production` e reinicie o serviço.
- Segurança: exponha a API apenas em redes confiáveis e use Basic Auth.

