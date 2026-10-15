// whatsapp-cloud.ts · Criado por FlowCore Soluções LTDA · flowcoresolucoes.com.br/codigos · licença MIT
// Cliente da WhatsApp Cloud API (Meta Graph) pra atendimento e notificação:
// envia texto e template aprovado (com componentes/variáveis), marca como
// lida, responde a verificação GET do webhook (hub.challenge), confere a
// assinatura X-Hub-Signature-256 do POST e normaliza mensagens e status
// recebidos num formato simples.
// Roda em Node 18+, Cloudflare Workers, Deno e Bun (server-side).
// Zero dependências.
//
// Referências: Meta for Developers, "WhatsApp Cloud API" (Messages,
// Webhooks) e "Graph API Webhooks: verification and payload signing".

export const CRIADO_POR = "Criado por FlowCore Soluções LTDA";
export const USER_AGENT_PADRAO = "FlowCore-Codigos/1.0 (Criado por FlowCore Soluções LTDA)";

export type RespostaHttp = { ok: boolean; status: number; json(): Promise<unknown> };
export type FetchLike = (url: string, init?: RequestInit) => Promise<RespostaHttp>;

export type OpcoesWhatsApp = {
  /** Token permanente do System User (Business Manager). */
  token: string;
  /** ID do número (não é o telefone): Painel > WhatsApp > Configuração da API. */
  phoneNumberId: string;
  /** Versão da Graph API. Padrão "v21.0". */
  versao?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** User-Agent enviado. false não envia. */
  userAgent?: string | false;
};

export type ComponenteTemplate = {
  type: "header" | "body" | "button";
  sub_type?: "quick_reply" | "url" | "copy_code";
  index?: string | number;
  parameters: Array<Record<string, unknown>>;
};

export type RespostaEnvio = { idMensagem: string; waId: string | null };

export class ErroWhatsApp extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly codigo?: number,
    readonly fbtraceId?: string,
  ) {
    super(message);
    this.name = "ErroWhatsApp";
  }
}

/** Deixa só dígitos e põe o DDI 55 quando vier só DDD + número. */
export function normalizarTelefone(telefone: string): string {
  const d = telefone.replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if (d.length < 10 || d.length > 15) throw new Error(`Telefone inválido: "${telefone}"`);
  return d;
}

/** Atalho: variáveis {{1}}, {{2}}... do corpo do template. */
export function parametrosCorpo(...valores: Array<string | number>): ComponenteTemplate {
  return { type: "body", parameters: valores.map((v) => ({ type: "text", text: String(v) })) };
}

export function criarClienteWhatsApp(opcoes: OpcoesWhatsApp) {
  if (!opcoes.token) throw new Error("Token da WhatsApp Cloud API não configurado");
  if (!opcoes.phoneNumberId) throw new Error("phoneNumberId não configurado");
  const f: FetchLike = opcoes.fetch ?? ((u, i) => fetch(u, i));
  const versao = opcoes.versao ?? "v21.0";
  const base = (opcoes.baseUrl ?? "https://graph.facebook.com").replace(/\/$/, "");
  const ua = opcoes.userAgent === undefined ? USER_AGENT_PADRAO : opcoes.userAgent;
  const timeoutMs = opcoes.timeoutMs ?? 15_000;

  async function postar(corpo: Record<string, unknown>): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { Authorization: `Bearer ${opcoes.token}`, "Content-Type": "application/json" };
    if (ua) headers["User-Agent"] = ua;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let resp: RespostaHttp;
    try {
      resp = await f(`${base}/${versao}/${opcoes.phoneNumberId}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ messaging_product: "whatsapp", ...corpo }),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new ErroWhatsApp(ctrl.signal.aborted ? `Tempo esgotado (${timeoutMs} ms) na WhatsApp API` : `Falha de rede: ${(e as Error).message}`, 0);
    } finally {
      clearTimeout(timer);
    }
    const json = ((await resp.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    if (!resp.ok) {
      const err = (json.error ?? {}) as { message?: string; code?: number; fbtrace_id?: string; error_data?: { details?: string } };
      const detalhe = err.error_data?.details ? ` (${err.error_data.details})` : "";
      throw new ErroWhatsApp(`WhatsApp API: ${err.message ?? `HTTP ${resp.status}`}${detalhe}`, resp.status, err.code, err.fbtrace_id);
    }
    return json;
  }

  const lerEnvio = (j: Record<string, unknown>): RespostaEnvio => {
    const msg = (j.messages as Array<{ id: string }> | undefined)?.[0];
    if (!msg?.id) throw new ErroWhatsApp("Resposta da WhatsApp API sem id da mensagem", 200);
    return { idMensagem: msg.id, waId: (j.contacts as Array<{ wa_id: string }> | undefined)?.[0]?.wa_id ?? null };
  };

  return {
    /** Texto livre: só dentro da janela de 24h após a última mensagem do cliente. */
    async enviarTexto(para: string, texto: string, extra: { previewUrl?: boolean; responderA?: string } = {}) {
      if (!texto.trim()) throw new Error("Texto da mensagem vazio");
      if (texto.length > 4096) throw new Error("Texto passa de 4096 caracteres");
      return lerEnvio(
        await postar({
          recipient_type: "individual",
          to: normalizarTelefone(para),
          type: "text",
          text: { body: texto, preview_url: extra.previewUrl ?? false },
          ...(extra.responderA ? { context: { message_id: extra.responderA } } : {}),
        }),
      );
    },
    /** Template aprovado: funciona fora da janela de 24h (marketing, utilidade, autenticação). */
    async enviarTemplate(para: string, nome: string, idioma = "pt_BR", componentes: ComponenteTemplate[] = []) {
      if (!/^[a-z0-9_]+$/.test(nome)) throw new Error("Nome do template inválido (minúsculas, números e _)");
      return lerEnvio(
        await postar({
          to: normalizarTelefone(para),
          type: "template",
          template: { name: nome, language: { code: idioma }, ...(componentes.length ? { components: componentes } : {}) },
        }),
      );
    },
    /** Marca a mensagem recebida como lida (dois tiques azuis). */
    async marcarComoLida(idMensagem: string): Promise<void> {
      await postar({ status: "read", message_id: idMensagem });
    },
  };
}

/**
 * Responde a verificação GET do webhook. Devolva `challenge` em texto puro
 * com status 200 quando ok; senão, 403.
 */
export function verificarWebhookGet(
  url: string | URL | URLSearchParams,
  verifyToken: string,
): { ok: true; challenge: string } | { ok: false } {
  const p = url instanceof URLSearchParams ? url : new URL(String(url)).searchParams;
  const challenge = p.get("hub.challenge");
  if (p.get("hub.mode") === "subscribe" && verifyToken && p.get("hub.verify_token") === verifyToken && challenge) {
    return { ok: true, challenge };
  }
  return { ok: false };
}

/** Confere X-Hub-Signature-256 ("sha256=<hex>") = HMAC-SHA256(corpo bruto, App Secret). */
export async function verificarAssinaturaWebhook(
  corpoBruto: string | Uint8Array,
  header: string | null | undefined,
  appSecret: string,
): Promise<boolean> {
  if (!appSecret) throw new Error("App Secret não configurado");
  const m = /^sha256=([0-9a-f]{64})$/i.exec((header ?? "").trim());
  if (!m) return false;
  const enc = new TextEncoder();
  const chave = await crypto.subtle.importKey("raw", enc.encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const dados = typeof corpoBruto === "string" ? enc.encode(corpoBruto) : corpoBruto;
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", chave, dados));
  const esperado = Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
  const recebido = m[1].toLowerCase();
  let dif = 0;
  for (let i = 0; i < 64; i++) dif |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i);
  return dif === 0;
}

export type MensagemRecebida = {
  id: string;
  /** wa_id do remetente (DDI+DDD+número). */
  de: string;
  nome: string | null;
  /** Epoch em ms. */
  timestamp: number;
  tipo: string;
  texto: string | null;
  midia: { id: string; mimeType: string | null; legenda: string | null; nomeArquivo: string | null } | null;
  localizacao: { latitude: number; longitude: number; nome: string | null; endereco: string | null } | null;
  /** Clique em botão/lista ou quick reply de template. */
  interativo: { id: string | null; titulo: string } | null;
  respostaA: string | null;
  phoneNumberId: string;
};

export type StatusRecebido = {
  idMensagem: string;
  status: "sent" | "delivered" | "read" | "failed" | string;
  destinatario: string;
  timestamp: number;
  erro: { codigo: number; titulo: string } | null;
};

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Normaliza o payload POST do webhook em mensagens e status. Ignora o que não reconhece. */
export function parsearWebhook(payload: unknown): { mensagens: MensagemRecebida[]; status: StatusRecebido[] } {
  const mensagens: MensagemRecebida[] = [];
  const status: StatusRecebido[] = [];
  const p = payload as J;
  if (!p || p.object !== "whatsapp_business_account" || !Array.isArray(p.entry)) return { mensagens, status };

  for (const entry of p.entry as J[]) {
    for (const change of (entry.changes ?? []) as J[]) {
      const v = (change.value ?? {}) as J;
      const phoneNumberId = String(v.metadata?.phone_number_id ?? "");
      const nomes = new Map<string, string>(((v.contacts ?? []) as J[]).map((c) => [String(c.wa_id), c.profile?.name]));

      for (const m of (v.messages ?? []) as J[]) {
        const tipo = String(m.type ?? "unknown");
        const midiaBruta = ["image", "audio", "video", "document", "sticker"].includes(tipo) ? (m[tipo] as J) : null;
        let interativo: MensagemRecebida["interativo"] = null;
        if (tipo === "interactive") {
          const i = (m.interactive?.button_reply ?? m.interactive?.list_reply ?? {}) as J;
          interativo = { id: i.id ?? null, titulo: String(i.title ?? "") };
        } else if (tipo === "button") {
          interativo = { id: m.button?.payload ?? null, titulo: String(m.button?.text ?? "") };
        }
        mensagens.push({
          id: String(m.id),
          de: String(m.from),
          nome: nomes.get(String(m.from)) ?? null,
          timestamp: Number(m.timestamp) * 1000,
          tipo,
          texto: tipo === "text" ? String(m.text?.body ?? "") : (midiaBruta?.caption ?? interativo?.titulo ?? null),
          midia: midiaBruta
            ? { id: String(midiaBruta.id), mimeType: midiaBruta.mime_type ?? null, legenda: midiaBruta.caption ?? null, nomeArquivo: midiaBruta.filename ?? null }
            : null,
          localizacao:
            tipo === "location"
              ? { latitude: Number(m.location.latitude), longitude: Number(m.location.longitude), nome: m.location.name ?? null, endereco: m.location.address ?? null }
              : null,
          interativo,
          respostaA: m.context?.id ?? null,
          phoneNumberId,
        });
      }

      for (const s of (v.statuses ?? []) as J[]) {
        const e = (s.errors?.[0] ?? null) as J | null;
        status.push({
          idMensagem: String(s.id),
          status: String(s.status),
          destinatario: String(s.recipient_id),
          timestamp: Number(s.timestamp) * 1000,
          erro: e ? { codigo: Number(e.code), titulo: String(e.title ?? e.message ?? "") } : null,
        });
      }
    }
  }
  return { mensagens, status };
}
