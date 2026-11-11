# Tarefas (uma por vez)

1. Subir o WAHA no EasyPanel (feito em 2026-11-11, sem número conectado ainda).
2. Cliente do WAHA (`src/lib/whatsapp/waha-api.ts`): enviar texto, mídia, reação, digitando; buscar mídia; status e QR da instância.
3. Desvio em `meta-api.ts` pelo prefixo `waha:`.
4. Rota de entrada do WAHA traduzindo para o formato da Meta e reaproveitando `processWebhook`, incluindo `fromMe` e status.
5. Mídia recebida copiada para o Storage na chegada.
6. Tela de Configurações → WhatsApp com o modo QR Code (mostrar QR e situação da conexão).
7. Esconder disparos, modelos e a trava de 24 horas no modo QR Code.
8. Rodízio de verdade na atribuição automática.
9. Etiquetas da clínica e respostas prontas.
10. Supabase: feito em 2026-11-11 (projeto `crm`, us-west-2, 57 migrações, URL do site e cadastro sem confirmação de e-mail). Falta publicar no EasyPanel e conectar o número principal (o cliente dispensou número de teste).
