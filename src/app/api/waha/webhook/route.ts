import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { parseAppSecrets } from '@/lib/whatsapp/webhook-signature'
import { translateWahaEvent, type WahaEvent } from '@/lib/whatsapp/waha-inbound'
import { wahaLidToPhone } from '@/lib/whatsapp/waha-api'

/**
 * Entrada do WAHA (conexão por QR Code).
 *
 * O WAHA assina cada aviso com HMAC-SHA512 (`X-Webhook-Hmac`, chave
 * WAHA_HOOK_HMAC_KEY). Aqui conferimos a assinatura, traduzimos o evento
 * para o formato da Meta e entregamos para `/api/whatsapp/webhook`, que
 * faz todo o resto (contato, conversa, mídia, automações). A entrega é
 * assinada com META_APP_SECRET, como a Meta faria.
 */

export const maxDuration = 60

const MAX_BODY_BYTES = 2 * 1024 * 1024

function hmacMatches(rawBody: string, header: string | null): boolean {
  const key = process.env.WAHA_HOOK_HMAC_KEY
  if (!key) {
    console.error('[waha-webhook] WAHA_HOOK_HMAC_KEY não configurado — recusando.')
    return false
  }
  if (!header) return false
  const expected = crypto.createHmac('sha512', key).update(rawBody).digest('hex')
  const a = Buffer.from(header.trim().toLowerCase())
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }
  if (!hmacMatches(rawBody, request.headers.get('x-webhook-hmac'))) {
    console.warn('[waha-webhook] assinatura inválida')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: WahaEvent
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (event.event === 'session.status') {
    console.info('[waha-webhook] sessão', event.session, '→', (event.payload as { status?: string })?.status)
    return NextResponse.json({ status: 'ok' })
  }

  const session = event.session || 'default'
  const metaBody = await translateWahaEvent(event, (lid) => wahaLidToPhone(session, lid))
  if (!metaBody) return NextResponse.json({ status: 'ignored' })

  const secret = parseAppSecrets(process.env.META_APP_SECRET)[0]
  if (!secret) {
    console.error('[waha-webhook] META_APP_SECRET não configurado — não dá para entregar ao processador.')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }
  const json = JSON.stringify(metaBody)
  const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(json).digest('hex')
  const port = process.env.PORT || '3000'
  const res = await fetch(`http://127.0.0.1:${port}/api/whatsapp/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
    body: json,
  })
  if (!res.ok) {
    console.error('[waha-webhook] processador recusou:', res.status, (await res.text()).slice(0, 200))
    return NextResponse.json({ error: 'Processing failed' }, { status: 502 })
  }
  return NextResponse.json({ status: 'received' })
}
