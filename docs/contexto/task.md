# Tarefas (uma por vez)

1. Subir o WAHA no EasyPanel (feito em 2026-11-11, sem número conectado ainda).
2. (feito 2026-11-11) Cliente do WAHA (`src/lib/whatsapp/waha-api.ts`): enviar texto, mídia, reação, digitando; buscar mídia; status e QR da instância.
3. (feito 2026-11-11) Desvio em `meta-api.ts` pelo prefixo `waha:`.
4. (feito 2026-11-11) Rota de entrada do WAHA traduzindo para o formato da Meta e reaproveitando `processWebhook`, incluindo `fromMe` e status.
5. (feito 2026-11-11) Mídia recebida copiada para o Storage na chegada (o espelho do WACRM baixa pelo WAHA).
6. (feito 2026-11-11) Tela de Configurações → WhatsApp com o modo QR Code (QR, código de 8 letras e situação).
7. Trava de 24 horas desligada no modo QR Code (feito). Falta esconder Disparos e Modelos no menu (hoje eles só dão erro claro ao enviar).
8. Rodízio de verdade na atribuição automática.
9. Etiquetas da clínica e respostas prontas.
10. Supabase: feito em 2026-11-11 (projeto `crm`, us-west-2, 57 migrações, URL do site e cadastro sem confirmação de e-mail). Falta publicar no EasyPanel e conectar o número principal (o cliente dispensou número de teste).
