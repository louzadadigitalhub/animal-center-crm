import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import {
  jidDigits,
  wahaEnsureSessionStarted,
  wahaGetQrDataUrl,
  wahaGetSession,
  wahaPhoneNumberId,
  wahaRequestPairingCode,
  type WahaSession,
} from '@/lib/whatsapp/waha-api'

/**
 * Conexão do WhatsApp por QR Code (WAHA). Só administradores.
 *
 *   GET   situação da sessão (+ QR Code, se estiver esperando leitura)
 *   POST  { action: 'start' }                       liga a sessão
 *         { action: 'pair-code', phoneNumber }      código de 8 letras
 *
 * Ao ligar, grava `whatsapp_config` da conta com `phone_number_id =
 * waha:<sessao>`; é isso que faz o envio e a entrada passarem pelo WAHA.
 */

function sessionName(): string {
  return process.env.WAHA_SESSION || 'default'
}

async function describe(session: WahaSession | null) {
  const status = session?.status ?? 'STOPPED'
  return {
    session: sessionName(),
    status,
    connected: status === 'WORKING',
    phone: jidDigits(session?.me?.id) || null,
    name: session?.me?.pushName ?? null,
    qr: status === 'SCAN_QR_CODE' ? await wahaGetQrDataUrl(sessionName()) : null,
  }
}

async function saveConfig(
  ctx: Awaited<ReturnType<typeof requireRole>>,
  connected: boolean,
) {
  const { supabase, accountId, userId } = ctx
  const now = new Date().toISOString()
  const row = {
    phone_number_id: wahaPhoneNumberId(sessionName()),
    waba_id: null,
    // O token não é usado no modo QR Code (a chave do WAHA fica no
    // ambiente), mas a coluna é NOT NULL e o processador a decifra.
    access_token: encrypt('waha-qr'),
    status: connected ? 'connected' : 'disconnected',
    connected_at: connected ? now : null,
    last_registration_error: null,
    updated_at: now,
  }
  const { data: existing } = await supabase
    .from('whatsapp_config')
    .select('id')
    .eq('account_id', accountId)
    .maybeSingle()
  const { error } = existing
    ? await supabase.from('whatsapp_config').update(row).eq('account_id', accountId)
    : await supabase.from('whatsapp_config').insert({ account_id: accountId, user_id: userId, ...row })
  if (error) throw new Error(`Não foi possível salvar a conexão: ${error.message}`)
}

export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const info = await describe(await wahaGetSession(sessionName()))
    // Mantém a situação gravada em dia com a do WAHA.
    await ctx.supabase
      .from('whatsapp_config')
      .update({ status: info.connected ? 'connected' : 'disconnected', updated_at: new Date().toISOString() })
      .eq('account_id', ctx.accountId)
      .eq('phone_number_id', wahaPhoneNumberId(sessionName()))
    return NextResponse.json(info)
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = (await request.json().catch(() => ({}))) as { action?: string; phoneNumber?: string }

    if (body.action === 'pair-code') {
      const digits = String(body.phoneNumber ?? '').replace(/\D/g, '')
      if (digits.length < 12) {
        return NextResponse.json(
          { error: 'Informe o número com DDI e DDD, por exemplo 5551999999999.' },
          { status: 400 },
        )
      }
      await wahaEnsureSessionStarted(sessionName())
      const code = await wahaRequestPairingCode(sessionName(), digits)
      await saveConfig(ctx, false)
      return NextResponse.json({ code })
    }

    const session = await wahaEnsureSessionStarted(sessionName())
    const info = await describe(session)
    await saveConfig(ctx, info.connected)
    return NextResponse.json(info)
  } catch (err) {
    return toErrorResponse(err)
  }
}
