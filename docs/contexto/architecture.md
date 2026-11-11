# Arquitetura

## Stack

Next.js 16 (App Router) com React 19 e Tailwind 4, banco e login no Supabase (Postgres, Auth, Realtime, Storage, RLS em todas as tabelas). Roda em Docker no EasyPanel do VPS Pórtico, serviço `agrocloss/animal-center-crm`, endereço `crm.portalanimal.center`, porta 3000. As variáveis `NEXT_PUBLIC_*` entram no build. Os segredos ficam só nas variáveis do EasyPanel e, na máquina do consultor, em `~/orca/projects/animal-center-crm/.env` (nunca no repositório, que é público).

## Fluxo do WhatsApp no WACRM original

Saída: tudo que envia mensagem (`src/lib/whatsapp/send-message.ts`, `src/lib/ai/auto-reply.ts`, `src/lib/automations/meta-send.ts`, `src/lib/flows/meta-send.ts`, reações, broadcast) chama as funções de `src/lib/whatsapp/meta-api.ts`, que falam com `graph.facebook.com` usando `phone_number_id` e o token guardado (cifrado) em `whatsapp_config`.

Entrada: a Meta chama `src/app/api/whatsapp/webhook/route.ts`, que confere a assinatura HMAC e passa o corpo (`entry[].changes[].value.messages[]` e `statuses[]`) para `processWebhook`, que cria contato, conversa e mensagem e dispara automações. Mídia recebida guarda só o id da Meta e é servida por `src/app/api/whatsapp/media/[mediaId]/route.ts`, com cópia opcional para o Storage (`mirror-inbound-media.ts`).

## Como entra o WAHA (modo QR Code)

O WAHA (imagem `devlikeapro/waha:gows-2026.10.1`, motor GOWS, baseado no whatsmeow) roda como o serviço `agrocloss/animal-center-waha`, endereço `waha.portalanimal.center`, porta 3000, com volumes em `/app/.sessions` e `/app/.media`. Ele se conecta ao número como um aparelho a mais, com o nome "Animal Center CRM". Dentro do servidor o CRM fala com ele em `http://agrocloss_animal-center-waha:3000` (cabeçalho `X-Api-Key`), e ele avisa o CRM em `http://agrocloss_animal-center-crm:3000/api/waha/webhook` com os eventos `message.any`, `message.ack`, `message.reaction` e `session.status`, assinados por HMAC (`WHATSAPP_HOOK_HMAC_KEY`). A ideia é mexer o mínimo no WACRM:

1. Em `whatsapp_config`, o modo QR Code é marcado por `phone_number_id = "waha:<sessao>"` e o token guardado é a chave da API do WAHA. Assim nenhuma tabela muda.
2. Em `meta-api.ts`, as funções de envio (texto, mídia, reação, digitando) olham o prefixo `waha:` e mandam para o cliente do WAHA em vez da Meta. Todo o resto do sistema continua chamando as mesmas funções.
3. Uma rota nova (`/api/waha/webhook`) recebe os eventos do WAHA, traduz para o formato da Meta (mensagens, status de entrega e leitura) e chama a mesma lógica de `processWebhook`. Mídia recebe um id com prefixo `waha:` e os bytes são copiados na hora para o Storage, porque o arquivo do WAHA é local do servidor dele.
4. Mensagens enviadas pelo celular ou por outro aparelho chegam como `fromMe` e entram como mensagens de saída, sem duplicar as que o próprio CRM enviou (mesmo id).
5. Grupos, status e canais são ignorados. Contatos com identificador `@lid` usam o número real quando o WAHA o informar.
