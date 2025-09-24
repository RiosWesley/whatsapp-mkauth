## Colbranca Zap API (whatsapp-web.js)

Endpoints principais (POST):

- `/send-message` — body JSON: `{ "number": "5511999999999", "message": "Olá" }`
- `/send-image` — multipart com `file` ou JSON `{ number, url, caption }`
- `/send-document` — multipart com `file` ou JSON `{ number, url, filename, mimetype, caption }`

Utilize `/status` para checar se o cliente está pronto e obter o QR (texto) enquanto o status for `qr`.

Scripts:

```bash
npm run dev
# ou
npm start
```

Ao iniciar pela primeira vez, será mostrado um QR no console. Escaneie com o WhatsApp (Menu > Aparelhos Conectados > Conectar um aparelho).

### Captura do payload do MK-AUTH

- Aponte o MK-AUTH para `POST http://SEU_SERVIDOR:3000/mk-capture`.
- Tudo que chegar (headers, query, body e metadados de arquivo) será salvo em `logs/mk-auth-YYYY-MM-DD.log` no formato JSONL.
- Após capturar alguns exemplos, podemos mapear exatamente os campos e ajustar os endpoints definitivos.

### Autenticação compatível com MK-AUTH

- Configure variáveis de ambiente:
  - `AUTH_ACCOUNT` e `AUTH_PASSWORD` (ou `MK_AUTH_ACCOUNT`/`MK_AUTH_PASSWORD`).
- O servidor aceita:
  - Basic Auth padrão no header `Authorization: Basic base64(conta:senha)`
  - Ou enviar `conta` e `senha` no header, body ou query.

### Campos aceitos (aliases)
- **number**: `number`, `numero`, `telefone`, `phone`, `to`, `destino`
- **message**: `message`, `mensagem`, `text`, `body`, `conteudo`
- **url**: `url`, `link`
- **caption**: `caption`, `legenda`, `descricao`
- **mimetype**: `mimetype`, `contentType`, `tipo`
- **filename**: `filename`, `nome`, `nome_arquivo`

Compatível com os endpoints do MK-AUTH:
- `POST /send-message`
- `POST /send-image`
- `POST /send-document`


