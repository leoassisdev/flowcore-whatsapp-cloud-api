// whatsapp-cloud.test.ts · Criado por FlowCore Soluções LTDA · flowcoresolucoes.com.br/codigos · licença MIT
import { describe, expect, it, vi } from "vitest";
import {
  criarClienteWhatsApp,
  ErroWhatsApp,
  normalizarTelefone,
  parametrosCorpo,
  parsearWebhook,
  verificarAssinaturaWebhook,
  verificarWebhookGet,
  type FetchLike,
} from "./whatsapp-cloud";

const ok = (corpo: unknown, status = 200) => ({ ok: status < 400, status, json: async () => corpo });
const envioOk = ok({ messaging_product: "whatsapp", contacts: [{ input: "5511987654321", wa_id: "5511987654321" }], messages: [{ id: "wamid.ABC" }] });
const corpoDe = (f: { mock: { calls: Parameters<FetchLike>[] } }, i = 0) => JSON.parse(f.mock.calls[i][1]?.body as string);

describe("whatsapp-cloud", () => {
  it("envia texto com URL, headers e corpo corretos", async () => {
    const f = vi.fn<FetchLike>(async () => envioOk);
    const wa = criarClienteWhatsApp({ token: "EAAG", phoneNumberId: "1234567890", fetch: f });
    expect(await wa.enviarTexto("(11) 98765-4321", "Olá!", { responderA: "wamid.X" })).toEqual({ idMensagem: "wamid.ABC", waId: "5511987654321" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v21.0/1234567890/messages");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer EAAG", "Content-Type": "application/json", "User-Agent": expect.stringContaining("FlowCore") });
    expect(corpoDe(f)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "5511987654321",
      type: "text",
      text: { body: "Olá!", preview_url: false },
      context: { message_id: "wamid.X" },
    });
  });

  it("envia template com componentes e versão customizada", async () => {
    const f = vi.fn<FetchLike>(async () => envioOk);
    const wa = criarClienteWhatsApp({ token: "t", phoneNumberId: "99", fetch: f, versao: "v22.0" });
    await wa.enviarTemplate("5511987654321", "pedido_confirmado", "pt_BR", [parametrosCorpo("Ana", "#1234", "R$ 249,90")]);
    expect(f.mock.calls[0][0]).toBe("https://graph.facebook.com/v22.0/99/messages");
    expect(corpoDe(f).template).toEqual({
      name: "pedido_confirmado",
      language: { code: "pt_BR" },
      components: [{ type: "body", parameters: [{ type: "text", text: "Ana" }, { type: "text", text: "#1234" }, { type: "text", text: "R$ 249,90" }] }],
    });
  });

  it("transforma erro da Graph API em ErroWhatsApp com código e fbtrace", async () => {
    const f = vi.fn<FetchLike>(async () =>
      ok({ error: { message: "Re-engagement message", code: 131047, fbtrace_id: "AbC", error_data: { details: "fora da janela de 24h" } } }, 400),
    );
    const wa = criarClienteWhatsApp({ token: "t", phoneNumberId: "1", fetch: f });
    const erro = await wa.enviarTexto("11987654321", "oi").catch((e) => e);
    expect(erro).toBeInstanceOf(ErroWhatsApp);
    expect(erro).toMatchObject({ status: 400, codigo: 131047, fbtraceId: "AbC" });
    expect(erro.message).toContain("fora da janela de 24h");
  });

  it("marca como lida e valida entradas", async () => {
    const f = vi.fn<FetchLike>(async () => ok({ success: true }));
    const wa = criarClienteWhatsApp({ token: "t", phoneNumberId: "1", fetch: f, userAgent: false });
    await wa.marcarComoLida("wamid.Z");
    expect(corpoDe(f)).toEqual({ messaging_product: "whatsapp", status: "read", message_id: "wamid.Z" });
    expect((f.mock.calls[0][1]?.headers as Record<string, string>)["User-Agent"]).toBeUndefined();
    await expect(wa.enviarTexto("1199", "x")).rejects.toThrow("Telefone inválido");
    await expect(wa.enviarTemplate("11987654321", "Nome Errado")).rejects.toThrow("template inválido");
    expect(() => criarClienteWhatsApp({ token: "", phoneNumberId: "1" })).toThrow("Token");
    expect(normalizarTelefone("+55 (21) 3333-4444")).toBe("552133334444");
  });

  it("responde a verificação GET do webhook", () => {
    const url = "https://api.empresa.com/wa?hub.mode=subscribe&hub.verify_token=meu-token&hub.challenge=1158201444";
    expect(verificarWebhookGet(url, "meu-token")).toEqual({ ok: true, challenge: "1158201444" });
    expect(verificarWebhookGet(url, "outro")).toEqual({ ok: false });
    expect(verificarWebhookGet(new URLSearchParams("hub.mode=unsubscribe&hub.verify_token=meu-token&hub.challenge=1"), "meu-token")).toEqual({ ok: false });
  });

  it("confere X-Hub-Signature-256 com HMAC calculado de forma independente", async () => {
    const corpo = '{"object":"whatsapp_business_account","entry":[]}';
    const enc = new TextEncoder();
    const k = await crypto.subtle.importKey("raw", enc.encode("app-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const hex = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(corpo))), (b) => b.toString(16).padStart(2, "0")).join("");
    expect(await verificarAssinaturaWebhook(corpo, `sha256=${hex}`, "app-secret")).toBe(true);
    expect(await verificarAssinaturaWebhook(corpo + " ", `sha256=${hex}`, "app-secret")).toBe(false);
    expect(await verificarAssinaturaWebhook(corpo, `sha256=${hex}`, "outro")).toBe(false);
    expect(await verificarAssinaturaWebhook(corpo, null, "app-secret")).toBe(false);
  });

  it("normaliza mensagens de texto, mídia, botão e localização", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "551140000000", phone_number_id: "1234567890" },
                contacts: [{ profile: { name: "Ana" }, wa_id: "5511987654321" }],
                messages: [
                  { from: "5511987654321", id: "wamid.1", timestamp: "1760000000", type: "text", text: { body: "Quero orçamento" } },
                  { from: "5511987654321", id: "wamid.2", timestamp: "1760000001", type: "image", image: { id: "MID", mime_type: "image/jpeg", caption: "nota fiscal" }, context: { id: "wamid.0" } },
                  { from: "5511987654321", id: "wamid.3", timestamp: "1760000002", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "sim", title: "Sim, quero" } } },
                  { from: "5511987654321", id: "wamid.4", timestamp: "1760000003", type: "location", location: { latitude: -23.55, longitude: -46.63, name: "Escritório" } },
                ],
              },
            },
          ],
        },
      ],
    };
    const { mensagens, status } = parsearWebhook(payload);
    expect(status).toEqual([]);
    expect(mensagens[0]).toMatchObject({ id: "wamid.1", de: "5511987654321", nome: "Ana", timestamp: 1760000000000, tipo: "text", texto: "Quero orçamento", phoneNumberId: "1234567890" });
    expect(mensagens[1]).toMatchObject({ tipo: "image", texto: "nota fiscal", midia: { id: "MID", mimeType: "image/jpeg", legenda: "nota fiscal" }, respostaA: "wamid.0" });
    expect(mensagens[2].interativo).toEqual({ id: "sim", titulo: "Sim, quero" });
    expect(mensagens[3].localizacao).toEqual({ latitude: -23.55, longitude: -46.63, nome: "Escritório", endereco: null });
  });

  it("normaliza status de entrega com erro e ignora payload estranho", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [{ changes: [{ value: { metadata: { phone_number_id: "1" }, statuses: [
        { id: "wamid.9", status: "failed", timestamp: "1760000100", recipient_id: "5511987654321", errors: [{ code: 131026, title: "Message undeliverable" }] },
        { id: "wamid.8", status: "read", timestamp: "1760000050", recipient_id: "5511987654321" },
      ] } }] }],
    };
    expect(parsearWebhook(payload).status).toEqual([
      { idMensagem: "wamid.9", status: "failed", destinatario: "5511987654321", timestamp: 1760000100000, erro: { codigo: 131026, titulo: "Message undeliverable" } },
      { idMensagem: "wamid.8", status: "read", destinatario: "5511987654321", timestamp: 1760000050000, erro: null },
    ]);
    expect(parsearWebhook({ object: "page" })).toEqual({ mensagens: [], status: [] });
    expect(parsearWebhook(null)).toEqual({ mensagens: [], status: [] });
  });
});
