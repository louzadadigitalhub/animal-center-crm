import { describe, expect, it, vi } from 'vitest'
import { translateWahaEvent, toMetaMessageContent, isIndividualChat, type WahaEvent } from './waha-inbound'
import { parseWahaMessageId, toChatId, wahaMediaIdFromUrl, wahaUrlFromMediaId } from './waha-api'

process.env.WAHA_INTERNAL_URL = 'http://waha-interno:3000'

const noLid = async () => null

function ev(event: string, payload: WahaEvent['payload']): WahaEvent {
  return { event, session: 'default', me: { id: '5551988887777@c.us', pushName: 'Animal Center' }, payload }
}

function value(body: Awaited<ReturnType<typeof translateWahaEvent>>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- formato livre do teste
  return body!.entry[0].changes[0].value as Record<string, any>
}

describe('translateWahaEvent', () => {
  it('mensagem de texto recebida vira messages + contacts da Meta', async () => {
    const out = await translateWahaEvent(
      ev('message.any', {
        id: 'false_5551999990000@c.us_ABC123',
        from: '5551999990000@c.us',
        fromMe: false,
        body: 'Oi, meu cachorro está vomitando',
        timestamp: 1794400000,
        _data: { Info: { PushName: 'Maria' } },
      }),
      noLid,
    )
    const v = value(out)
    expect(v.metadata.phone_number_id).toBe('waha:default')
    expect(v.contacts[0]).toEqual({ profile: { name: 'Maria' }, wa_id: '5551999990000' })
    expect(v.messages[0]).toMatchObject({
      from: '5551999990000',
      id: 'false_5551999990000@c.us_ABC123',
      timestamp: '1794400000',
      type: 'text',
      text: { body: 'Oi, meu cachorro está vomitando' },
    })
  })

  it('ignora grupos, status e mensagens vazias', async () => {
    expect(await translateWahaEvent(ev('message.any', { id: 'x', from: '123@g.us', body: 'oi' }), noLid)).toBeNull()
    expect(await translateWahaEvent(ev('message.any', { id: 'x', from: 'status@broadcast', body: 'oi' }), noLid)).toBeNull()
    expect(await translateWahaEvent(ev('message.any', { id: 'x', from: '5551@c.us', body: '' }), noLid)).toBeNull()
  })

  it('não duplica o que o próprio CRM enviou (source api)', async () => {
    const out = await translateWahaEvent(
      ev('message.any', { id: 'true_5551999990000@c.us_X', from: '5551999990000@c.us', fromMe: true, source: 'api', body: 'oi' }),
      noLid,
    )
    expect(out).toBeNull()
  })

  it('resposta pelo celular vira message_echoes, sem nome do contato', async () => {
    const v = value(
      await translateWahaEvent(
        ev('message.any', { id: 'true_5551999990000@c.us_Y', from: '5551999990000@c.us', fromMe: true, source: 'app', body: 'Pode trazer às 14h' }),
        noLid,
      ),
    )
    expect(v.messages).toBeUndefined()
    expect(v.contacts[0].profile.name).toBe('')
    expect(v.message_echoes[0]).toMatchObject({ from: '5551999990000', to: '5551999990000', type: 'text' })
  })

  it('contato @lid usa o número de SenderAlt, ou pergunta ao WAHA', async () => {
    const withAlt = value(
      await translateWahaEvent(
        ev('message.any', {
          id: 'false_999@lid_Z', from: '999@lid', fromMe: false, body: 'oi',
          _data: { Info: { SenderAlt: '5551977776666@s.whatsapp.net' } },
        }),
        noLid,
      ),
    )
    expect(withAlt.contacts[0].wa_id).toBe('5551977776666')

    const resolver = vi.fn(async () => '5551955554444@c.us')
    const viaApi = value(await translateWahaEvent(ev('message.any', { id: 'false_888@lid_W', from: '888@lid', body: 'oi' }), resolver))
    expect(resolver).toHaveBeenCalledWith('888@lid')
    expect(viaApi.contacts[0].wa_id).toBe('5551955554444')

    expect(await translateWahaEvent(ev('message.any', { id: 'false_777@lid_V', from: '777@lid', body: 'oi' }), noLid)).toBeNull()
  })

  it('confirmação de leitura vira statuses', async () => {
    const v = value(
      await translateWahaEvent(
        ev('message.ack', { id: 'true_5551999990000@c.us_Q', from: '5551999990000@c.us', fromMe: true, ack: 3 }),
        noLid,
      ),
    )
    expect(v.statuses[0]).toMatchObject({ id: 'true_5551999990000@c.us_Q', status: 'read', recipient_id: '5551999990000' })
  })

  it('reação do cliente vira mensagem do tipo reaction', async () => {
    const v = value(
      await translateWahaEvent(
        ev('message.reaction', {
          id: 'false_5551999990000@c.us_R', from: '5551999990000@c.us', fromMe: false,
          reaction: { text: '❤️', messageId: 'true_5551999990000@c.us_Q' },
        }),
        noLid,
      ),
    )
    expect(v.messages[0]).toMatchObject({ type: 'reaction', reaction: { message_id: 'true_5551999990000@c.us_Q', emoji: '❤️' } })
  })
})

describe('toMetaMessageContent', () => {
  it('foto com legenda vira image com id waha:', () => {
    const c = toMetaMessageContent({
      hasMedia: true, body: 'olha a pata',
      media: { url: 'https://waha.portalanimal.center/api/files/default/abc.jpeg', mimetype: 'image/jpeg' },
    })!
    expect(c.type).toBe('image')
    const img = c.image as { id: string; caption: string }
    expect(img.caption).toBe('olha a pata')
    expect(wahaUrlFromMediaId(img.id).endsWith('/api/files/default/abc.jpeg')).toBe(true)
  })

  it('áudio, documento e figurinha', () => {
    expect(toMetaMessageContent({ hasMedia: true, media: { url: 'https://w/api/files/default/a.oga', mimetype: 'audio/ogg; codecs=opus' } })!.type).toBe('audio')
    const doc = toMetaMessageContent({ hasMedia: true, media: { url: 'https://w/api/files/default/e.pdf', mimetype: 'application/pdf', filename: 'exame.pdf' } })!
    expect(doc).toMatchObject({ type: 'document', document: { filename: 'exame.pdf' } })
    expect(toMetaMessageContent({ hasMedia: true, media: { url: 'https://w/api/files/default/s.webp', mimetype: 'image/webp' } })!.type).toBe('sticker')
  })

  it('mídia que não baixou vira texto avisando', () => {
    expect(toMetaMessageContent({ hasMedia: true, media: null, body: '' })).toEqual({ type: 'text', text: { body: '[mídia não disponível]' } })
  })

  it('resposta citando guarda o id cru em context', () => {
    expect(toMetaMessageContent({ body: 'sim', replyTo: { id: '3EB0ABC' } })).toMatchObject({ context: { id: '3EB0ABC' } })
  })
})

describe('waha-api helpers', () => {
  it('toChatId e parseWahaMessageId', () => {
    expect(toChatId('55 51 99999-0000')).toBe('5551999990000@c.us')
    expect(toChatId('888@lid')).toBe('888@lid')
    expect(parseWahaMessageId('false_5551999990000@c.us_ABC')).toEqual({ fromMe: false, chatId: '5551999990000@c.us', rawId: 'ABC' })
  })

  it('id de mídia ida e volta', () => {
    const id = wahaMediaIdFromUrl('https://waha.portalanimal.center/api/files/default/x.jpg')
    expect(id.startsWith('waha:')).toBe(true)
    expect(wahaUrlFromMediaId(id)).toBe('http://waha-interno:3000/api/files/default/x.jpg')
  })

  it('isIndividualChat', () => {
    expect(isIndividualChat('5551@c.us')).toBe(true)
    expect(isIndividualChat('5551@lid')).toBe(true)
    expect(isIndividualChat('1203@g.us')).toBe(false)
    expect(isIndividualChat('1203@newsletter')).toBe(false)
  })
})
