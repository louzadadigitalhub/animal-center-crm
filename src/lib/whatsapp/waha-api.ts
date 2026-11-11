/**
 * Cliente do WAHA (WhatsApp HTTP API), o conector por QR Code.
 *
 * No modo QR Code o `whatsapp_config.phone_number_id` vale `waha:<sessao>`.
 * As funções de `meta-api.ts` olham esse prefixo e desviam para cá, então
 * todo o resto do CRM (composer, automações, reações) continua chamando as
 * mesmas funções sem saber qual conector está por trás.
 *
 * Endereço e chave vêm do ambiente, nunca do banco:
 *   WAHA_INTERNAL_URL  http://agrocloss_animal-center-waha:3000 (rede interna)
 *   WAHA_API_KEY       chave da API do WAHA (cabeçalho X-Api-Key)
 *   WAHA_URL           endereço público, que o WAHA usa nos links de mídia
 */

export const WAHA_PREFIX = 'waha:'

export function isWahaPhoneNumberId(phoneNumberId: string | null | undefined): boolean {
  return typeof phoneNumberId === 'string' && phoneNumberId.startsWith(WAHA_PREFIX)
}

export function wahaSessionFrom(phoneNumberId: string): string {
  return phoneNumberId.slice(WAHA_PREFIX.length) || 'default'
}

export function wahaPhoneNumberId(session: string): string {
  return `${WAHA_PREFIX}${session}`
}

function baseUrl(): string {
  const url = process.env.WAHA_INTERNAL_URL || process.env.WAHA_URL
  if (!url) throw new Error('WAHA_INTERNAL_URL não configurado.')
  return url.replace(/\/+$/, '')
}

function apiKey(): string {
  const key = process.env.WAHA_API_KEY
  if (!key) throw new Error('WAHA_API_KEY não configurado.')
  return key
}

export class WahaApiError extends Error {
  readonly httpStatus: number
  constructor(message: string, httpStatus: number) {
    super(message)
    this.name = 'WahaApiError'
    this.httpStatus = httpStatus
  }
}

async function wahaFetch<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'X-Api-Key': apiKey(),
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  const text = await response.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!response.ok) {
    const message =
      (data && typeof data === 'object' && 'message' in data && String((data as { message: unknown }).message)) ||
      (typeof data === 'string' && data) ||
      `WAHA ${response.status}`
    throw new WahaApiError(`WAHA: ${message}`.slice(0, 500), response.status)
  }
  return data as T
}

// ============================================================
// Identificadores
// ============================================================

/** Só dígitos de um telefone ou de um jid (`5551...@c.us` → `5551...`). */
export function jidDigits(jid: string | null | undefined): string {
  return String(jid ?? '').split('@')[0].split(':')[0].replace(/\D/g, '')
}

/** Destino de envio: aceita jid pronto ou telefone. */
export function toChatId(to: string): string {
  const v = to.trim()
  if (v.includes('@')) return v
  return `${v.replace(/\D/g, '')}@c.us`
}

/**
 * O WAHA (motor GOWS) monta o id da mensagem como
 * `<fromMe>_<chat>_<ID>` (grupos têm `_<participante>` no fim).
 */
export function parseWahaMessageId(id: string): { fromMe: boolean; chatId: string; rawId: string } | null {
  const m = /^(true|false)_([^_]+)_([^_]+)/.exec(id)
  if (!m) return null
  return { fromMe: m[1] === 'true', chatId: m[2], rawId: m[3] }
}

/** O id do WAHA às vezes vem como objeto (motor WEBJS). */
function messageIdOf(data: unknown): string {
  const d = data as { id?: unknown; key?: { id?: string } } | null
  const id = d?.id
  if (typeof id === 'string') return id
  if (id && typeof id === 'object' && '_serialized' in id) return String((id as { _serialized: unknown })._serialized)
  if (d?.key?.id) return d.key.id
  throw new Error('WAHA não devolveu o id da mensagem enviada.')
}

// ============================================================
// Envio
// ============================================================

export async function wahaSendText(args: {
  session: string
  to: string
  text: string
  replyTo?: string
}): Promise<{ messageId: string }> {
  const data = await wahaFetch('/api/sendText', {
    method: 'POST',
    body: {
      session: args.session,
      chatId: toChatId(args.to),
      text: args.text,
      ...(args.replyTo ? { reply_to: args.replyTo } : {}),
      linkPreview: false,
    },
  })
  return { messageId: messageIdOf(data) }
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', '3gp': 'video/3gpp', mov: 'video/quicktime',
  ogg: 'audio/ogg; codecs=opus', opus: 'audio/ogg; codecs=opus', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', amr: 'audio/amr', wav: 'audio/wav', webm: 'audio/webm',
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', csv: 'text/csv', zip: 'application/zip',
}

export function guessMimeType(urlOrName: string, kind: 'image' | 'video' | 'document' | 'audio'): string {
  const clean = urlOrName.split('?')[0].split('#')[0]
  const ext = clean.includes('.') ? clean.split('.').pop()!.toLowerCase() : ''
  if (EXT_MIME[ext]) return EXT_MIME[ext]
  if (kind === 'image') return 'image/jpeg'
  if (kind === 'video') return 'video/mp4'
  if (kind === 'audio') return 'audio/ogg; codecs=opus'
  return 'application/octet-stream'
}

function fileNameFrom(url: string): string {
  const last = url.split('?')[0].split('/').pop() || 'arquivo'
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

export async function wahaSendMedia(args: {
  session: string
  to: string
  kind: 'image' | 'video' | 'document' | 'audio'
  link: string
  caption?: string
  filename?: string
  replyTo?: string
}): Promise<{ messageId: string }> {
  const chatId = toChatId(args.to)
  const filename = args.filename || fileNameFrom(args.link)
  const file = { url: args.link, mimetype: guessMimeType(filename || args.link, args.kind), filename }
  const reply = args.replyTo ? { reply_to: args.replyTo } : {}
  let path: string
  let body: Record<string, unknown>
  switch (args.kind) {
    case 'image':
      path = '/api/sendImage'
      body = { session: args.session, chatId, file, caption: args.caption, ...reply }
      break
    case 'video':
      path = '/api/sendVideo'
      body = { session: args.session, chatId, file, caption: args.caption, convert: true, ...reply }
      break
    case 'audio':
      // Nota de voz: o WAHA converte para OGG/Opus quando precisa.
      path = '/api/sendVoice'
      body = { session: args.session, chatId, file: { url: args.link, mimetype: 'audio/ogg; codecs=opus' }, convert: true, ...reply }
      break
    default:
      path = '/api/sendFile'
      body = { session: args.session, chatId, file, caption: args.caption, ...reply }
  }
  const data = await wahaFetch(path, { method: 'POST', body })
  return { messageId: messageIdOf(data) }
}

export async function wahaReact(args: { session: string; messageId: string; emoji: string }): Promise<{ messageId: string }> {
  await wahaFetch('/api/reaction', {
    method: 'PUT',
    body: { session: args.session, messageId: args.messageId, reaction: args.emoji },
  })
  // A reação não ganha id próprio no WAHA; devolvemos o da mensagem alvo
  // com um sufixo para não colidir com nenhuma linha de `messages`.
  return { messageId: `${args.messageId}#reaction` }
}

/** Marca como lida e mostra "digitando…" — o mesmo que o indicador da Meta faz. */
export async function wahaSeenAndTyping(args: { session: string; inboundMessageId: string }): Promise<void> {
  const parsed = parseWahaMessageId(args.inboundMessageId)
  if (!parsed) return
  await wahaFetch('/api/sendSeen', {
    method: 'POST',
    body: { session: args.session, chatId: parsed.chatId, messageIds: [args.inboundMessageId] },
  })
  await wahaFetch('/api/startTyping', { method: 'POST', body: { session: args.session, chatId: parsed.chatId } }).catch(() => {})
}

// ============================================================
// Mídia recebida
// ============================================================

/**
 * O WAHA entrega a mídia como um link no endereço público dele
 * (`https://waha.../api/files/<sessao>/<arquivo>`). Guardamos só o caminho,
 * com o prefixo `waha:`, no lugar do id de mídia da Meta.
 */
export function wahaMediaIdFromUrl(url: string): string {
  let path = url
  try {
    path = new URL(url).pathname
  } catch {
    // já é um caminho
  }
  return `${WAHA_PREFIX}${Buffer.from(path, 'utf8').toString('base64url')}`
}

export function isWahaMediaId(mediaId: string): boolean {
  return mediaId.startsWith(WAHA_PREFIX)
}

export function wahaUrlFromMediaId(mediaId: string): string {
  const path = Buffer.from(mediaId.slice(WAHA_PREFIX.length), 'base64url').toString('utf8')
  if (!path.startsWith('/api/files/')) throw new Error('Id de mídia do WAHA inválido.')
  return `${baseUrl()}${path}`
}

export function isWahaUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const internal = process.env.WAHA_INTERNAL_URL ? new URL(process.env.WAHA_INTERNAL_URL).host : null
    const publicHost = process.env.WAHA_URL ? new URL(process.env.WAHA_URL).host : null
    return u.host === internal || u.host === publicHost
  } catch {
    return false
  }
}

export async function wahaDownload(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  // Qualquer link do WAHA é baixado pela rede interna, com a chave.
  const u = new URL(url)
  const response = await fetch(`${baseUrl()}${u.pathname}${u.search}`, { headers: { 'X-Api-Key': apiKey() } })
  if (!response.ok) throw new Error(`Download de mídia do WAHA falhou: ${response.status}`)
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
  }
}

// ============================================================
// Sessão (conexão do número)
// ============================================================

export interface WahaSession {
  name: string
  status: 'STOPPED' | 'STARTING' | 'SCAN_QR_CODE' | 'WORKING' | 'FAILED' | string
  me?: { id?: string; pushName?: string } | null
}

export async function wahaGetSession(session: string): Promise<WahaSession | null> {
  try {
    return await wahaFetch<WahaSession>(`/api/sessions/${encodeURIComponent(session)}`)
  } catch (e) {
    if (e instanceof WahaApiError && e.httpStatus === 404) return null
    throw e
  }
}

/** Cria (se preciso) e liga a sessão. Os avisos de mensagem já vêm do webhook global do WAHA. */
export async function wahaEnsureSessionStarted(session: string): Promise<WahaSession> {
  const current = await wahaGetSession(session)
  if (!current) {
    return wahaFetch<WahaSession>('/api/sessions', { method: 'POST', body: { name: session, start: true } })
  }
  if (current.status === 'STOPPED' || current.status === 'FAILED') {
    await wahaFetch(`/api/sessions/${encodeURIComponent(session)}/start`, { method: 'POST', body: {} })
    return (await wahaGetSession(session)) ?? current
  }
  return current
}

/** QR Code atual em data URL (PNG), ou null se a sessão não está esperando leitura. */
export async function wahaGetQrDataUrl(session: string): Promise<string | null> {
  try {
    const data = await wahaFetch<{ mimetype?: string; data?: string }>(
      `/api/${encodeURIComponent(session)}/auth/qr?format=image`,
    )
    if (data?.data) return `data:${data.mimetype || 'image/png'};base64,${data.data}`
    return null
  } catch {
    return null
  }
}

/** Código de 8 letras para "Conectar com número de telefone". */
export async function wahaRequestPairingCode(session: string, phoneNumber: string): Promise<string> {
  const data = await wahaFetch<{ code?: string }>(`/api/${encodeURIComponent(session)}/auth/request-code`, {
    method: 'POST',
    body: { phoneNumber: phoneNumber.replace(/\D/g, '') },
  })
  if (!data?.code) throw new Error('WAHA não devolveu o código de pareamento.')
  return data.code
}

/** Telefone (`5551...@c.us`) de um contato que aparece como `...@lid`. */
export async function wahaLidToPhone(session: string, lid: string): Promise<string | null> {
  try {
    const data = await wahaFetch<{ pn?: string }>(
      `/api/${encodeURIComponent(session)}/lids/${encodeURIComponent(lid)}`,
    )
    return data?.pn ?? null
  } catch {
    return null
  }
}
