# WhatsApp Cloud API

> Envia texto e template aprovado pela API oficial da Meta, valida o webhook (GET e assinatura X-Hub-Signature-256) e normaliza as mensagens recebidas. Atendimento e notificação no WhatsApp sem intermediário.

**Ver ao vivo, com preview e manual:** https://flowcoresolucoes.com.br/codigos/whatsapp-cloud-api

Criado por **FlowCore Soluções LTDA**.

## Arquivos

- [`src/whatsapp-cloud.ts`](src/whatsapp-cloud.ts)
- [`src/whatsapp-cloud.test.ts`](src/whatsapp-cloud.test.ts)

## Como instalar

1. **Funciona onde você já roda** Node 18+, Cloudflare Workers, Deno, Bun, Vercel e Netlify Functions. Zero dependência: só fetch e Web Crypto, que já vêm no runtime.
2. **Crie src/lib/whatsapp-cloud.ts** Copie o conteúdo de `src/whatsapp-cloud.ts` e `src/whatsapp-cloud.test.ts` deste repositório.
3. **Use**

   ```bash
   const wa = criarClienteWhatsApp({ token: env.WA_TOKEN, phoneNumberId: env.WA_PHONE_ID });
   await wa.enviarTemplate("11987654321", "pedido_confirmado", "pt_BR", [parametrosCorpo("Ana", "#1234")]);
   // webhook POST:
   if (!(await verificarAssinaturaWebhook(corpoBruto, req.headers.get("x-hub-signature-256"), env.WA_APP_SECRET))) return new Response(null, { status: 401 });
   const { mensagens } = parsearWebhook(JSON.parse(corpoBruto));
   ```

4. **Rode o teste junto** O arquivo de teste (`src/whatsapp-cloud.test.ts`) cobre 8 cenários. Copie para src/lib/ ao lado e rode:

   ```bash
   npm install -D vitest
   npx vitest run src/lib
   ```


## Testes

`src/whatsapp-cloud.test.ts` cobre 8 cenários.

```bash
npm install
npm test
```

## Licença

MIT. Pode usar em projeto pessoal ou comercial, de graça. A única condição é manter a linha **“Criado por FlowCore Soluções LTDA”** (ou o crédito de adaptação) onde ela está.

---

Precisa disso integrado no seu sistema? A [FlowCore](https://flowcoresolucoes.com.br) desenvolve sob medida.
