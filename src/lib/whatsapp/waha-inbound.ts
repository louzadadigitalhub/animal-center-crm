/**
 * Tradutor dos eventos do WAHA para o formato do webhook da Meta.
 *
 * Em vez de reescrever o processamento de entrada (contato, conversa,
 * mídia, automações), a rota `/api/waha/webhook` traduz cada evento do WAHA
 * para o corpo que a Meta mandaria e entrega para `/api/whatsapp/webhook`.
 *
 * Eventos tratados:
 *   message.any       mensagem recebida (cliente) ou enviada fora do CRM
 *                     (celular ou outro aparelho; vira `message_echoes`)
 *   message.ack       entregue / lida, só das mensagens que saíram daqui
 *   message.reaction  reação do cliente
 * Grupos, status, canais e listas de transmissão são ignorados.
 */

import { jidDigits, wahaMediaIdFromUrl, wahaPhoneNumberId } from './waha-api';

export interface WahaEvent {
  event: string;
  session: string;
  me?: { id?: string; pushName?: string } | null;
  payload: Record<string, unknown> & {
    id?: string;
    timestamp?: number;
    from?: string;
    to?: string;
    fromMe?: boolean;
    source?: 'api' | 'app' | string;
    body?: string | null;
    hasMedia?: boolean;
    media?: {
      url?: string | null;
      mimetype?: string | null;
      filename?: string | null;
      error?: unknown;
    } | null;
    ack?: number | null;
    location?: {
      latitude?: number | string;
      longitude?: number | string;
      description?: string;
      name?: string;
      address?: string;
    } | null;
    vCards?: string[] | null;
    replyTo?: { id?: string | null } | null;
    reaction?: { text?: string; messageId?: string } | null;
    _data?: {
      Info?: {
        PushName?: string;
        SenderAlt?: string;
        RecipientAlt?: string;
        ChatAlt?: string;
        MediaType?: string;
        Type?: string;
      };
    } & Record<string, unknown>;
  };
}

/** Corpo no formato do webhook da Meta, como `processWebhook` espera. */
export interface MetaShapedBody {
  object: 'whatsapp_business_account';
  entry: Array<{
    id: string;
    changes: Array<{ field: 'messages'; value: Record<string, unknown> }>;
  }>;
}

export type LidResolver = (lid: string) => Promise<string | null>;

const IGNORED_SUFFIXES = ['@g.us', '@broadcast', '@newsletter', '@call'];

export function isIndividualChat(jid: string | undefined | null): boolean {
  if (!jid) return false;
  if (jid === 'status@broadcast') return false;
  return !IGNORED_SUFFIXES.some((s) => jid.endsWith(s));
}

/**
 * Telefone (só dígitos) da pessoa do outro lado da conversa.
 * Conversas novas do WhatsApp podem chegar com `@lid` em vez do número;
 * o número real vem em `SenderAlt` (recebida) ou `RecipientAlt` (enviada),
 * e, se faltar, perguntamos ao WAHA.
 */
export async function resolvePeerPhone(
  event: WahaEvent,
  resolveLid: LidResolver
): Promise<string | null> {
  const chat = event.payload.from;
  if (!chat || !isIndividualChat(chat)) return null;
  if (!chat.endsWith('@lid')) return jidDigits(chat) || null;
  const info = event.payload._data?.Info;
  const alt = event.payload.fromMe ? info?.RecipientAlt : info?.SenderAlt;
  for (const candidate of [alt, info?.ChatAlt]) {
    if (candidate && !candidate.endsWith('@lid')) {
      const d = jidDigits(candidate);
      if (d) return d;
    }
  }
  const pn = await resolveLid(chat);
  return pn ? jidDigits(pn) || null : null;
}

function kindFromMime(
  mime: string,
  mediaType?: string
): 'image' | 'video' | 'audio' | 'document' | 'sticker' {
  if (mediaType === 'sticker' || mime === 'image/webp') return 'sticker';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

function vcardName(card: string): string {
  const fn = /^FN:(.*)$/m.exec(card)?.[1]?.trim();
  const tel = /TEL[^:]*:(.*)$/m.exec(card)?.[1]?.trim();
  return [fn, tel].filter(Boolean).join(' ');
}

/** Converte o conteúdo de uma mensagem do WAHA em mensagem da Meta (sem `from`). */
export function toMetaMessageContent(
  payload: WahaEvent['payload']
): Record<string, unknown> | null {
  const body = (payload.body ?? '').toString();
  const context = payload.replyTo?.id
    ? { context: { id: String(payload.replyTo.id) } }
    : {};

  if (payload.hasMedia) {
    const url = payload.media?.url;
    if (url) {
      const mime = (
        payload.media?.mimetype || 'application/octet-stream'
      ).toString();
      const kind = kindFromMime(mime, payload._data?.Info?.MediaType);
      const id = wahaMediaIdFromUrl(url);
      if (kind === 'sticker')
        return {
          type: 'sticker',
          sticker: { id, mime_type: mime },
          ...context,
        };
      if (kind === 'audio')
        return { type: 'audio', audio: { id, mime_type: mime }, ...context };
      if (kind === 'document') {
        return {
          type: 'document',
          document: {
            id,
            mime_type: mime,
            filename: payload.media?.filename || undefined,
            caption: body || undefined,
          },
          ...context,
        };
      }
      return {
        type: kind,
        [kind]: { id, mime_type: mime, caption: body || undefined },
        ...context,
      };
    }
    // Mídia que o WAHA não conseguiu baixar (grande demais, expirada).
    return {
      type: 'text',
      text: {
        body: body
          ? `[mídia não disponível] ${body}`
          : '[mídia não disponível]',
      },
      ...context,
    };
  }

  const loc = payload.location;
  if (loc && loc.latitude != null && loc.longitude != null) {
    return {
      type: 'location',
      location: {
        latitude: Number(loc.latitude),
        longitude: Number(loc.longitude),
        name: loc.name || loc.description || undefined,
        address: loc.address || undefined,
      },
      ...context,
    };
  }

  if (payload.vCards && payload.vCards.length > 0) {
    const names = payload.vCards.map(vcardName).filter(Boolean).join(', ');
    return {
      type: 'text',
      text: { body: `[contato] ${names || body}`.trim() },
      ...context,
    };
  }

  if (!body.trim()) return null;
  return { type: 'text', text: { body }, ...context };
}

function wrap(
  session: string,
  me: WahaEvent['me'],
  value: Record<string, unknown>
): MetaShapedBody {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: `waha-${session}`,
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: jidDigits(me?.id),
                phone_number_id: wahaPhoneNumberId(session),
              },
              ...value,
            },
          },
        ],
      },
    ],
  };
}

const ACK_TO_STATUS: Record<number, string> = {
  [-1]: 'failed',
  1: 'sent',
  2: 'delivered',
  3: 'read',
  4: 'read',
};

/**
 * Traduz um evento do WAHA. Devolve null quando não há nada para o CRM
 * (grupo, status, mensagem vazia, evento de sessão).
 */
export async function translateWahaEvent(
  event: WahaEvent,
  resolveLid: LidResolver
): Promise<MetaShapedBody | null> {
  const p = event.payload ?? {};
  const session = event.session || 'default';
  const nowSeconds = String(Math.floor(Date.now() / 1000));

  if (event.event === 'message.ack') {
    if (!p.fromMe || !p.id || p.ack == null) return null;
    const status = ACK_TO_STATUS[Number(p.ack)];
    if (!status) return null;
    if (!isIndividualChat(p.from)) return null;
    const phone = await resolvePeerPhone(event, resolveLid);
    return wrap(session, event.me, {
      statuses: [
        {
          id: p.id,
          status,
          timestamp: nowSeconds,
          recipient_id: phone ?? jidDigits(p.from),
        },
      ],
    });
  }

  if (event.event === 'message.reaction') {
    if (p.fromMe || !p.reaction?.messageId) return null;
    const phone = await resolvePeerPhone(event, resolveLid);
    if (!phone || !p.id) return null;
    return wrap(session, event.me, {
      contacts: [
        { profile: { name: p._data?.Info?.PushName ?? '' }, wa_id: phone },
      ],
      messages: [
        {
          from: phone,
          id: `${p.id}#reaction`,
          timestamp: String(p.timestamp ?? nowSeconds),
          type: 'reaction',
          reaction: {
            message_id: p.reaction.messageId,
            emoji: p.reaction.text ?? '',
          },
        },
      ],
    });
  }

  if (event.event !== 'message.any' && event.event !== 'message') return null;
  if (!p.id || !isIndividualChat(p.from)) return null;
  // Mensagens que o próprio CRM mandou pelo WAHA já foram gravadas no envio.
  if (p.fromMe && p.source === 'api') return null;

  const content = toMetaMessageContent(p);
  if (!content) return null;
  const phone = await resolvePeerPhone(event, resolveLid);
  if (!phone) {
    console.warn(
      '[waha] sem telefone para a conversa, mensagem ignorada:',
      p.from
    );
    return null;
  }
  const message = {
    from: phone,
    id: p.id,
    timestamp: String(p.timestamp ?? nowSeconds),
    ...content,
  };

  if (p.fromMe) {
    // Respondida pelo celular ou por outro aparelho conectado.
    return wrap(session, event.me, {
      contacts: [{ profile: { name: '' }, wa_id: phone }],
      message_echoes: [{ ...message, to: phone }],
    });
  }

  return wrap(session, event.me, {
    contacts: [
      { profile: { name: p._data?.Info?.PushName ?? '' }, wa_id: phone },
    ],
    messages: [message],
  });
}
