# PRD: CRM de WhatsApp da Animal Center

## O que é

Cópia adaptada do WACRM (github.com/ArnasDon/wacrm, MIT) para a clínica veterinária Animal Center, de Lajeado-RS. Uma caixa de entrada compartilhada onde várias atendentes respondem o mesmo número de WhatsApp, cada conversa com um responsável, situação (aberta, pendente, fechada) e etiquetas.

## O problema

Hoje o número principal da clínica fica no app WhatsApp Business de um celular, com 6 de 6 aparelhos conectados pelo WhatsApp Web (recepção, Amanda, internação, internação 2, Ju recepção, Thai). Todo mundo vê tudo, ninguém sabe quem está atendendo quem, conversas ficam sem resposta ou recebem duas respostas, e não cabe mais nenhum aparelho. São cerca de 3.500 tutores por mês, todos atendidos por pessoas, sem disparo automático.

## Para quem

As atendentes da recepção e da internação, os veterinários que tiram dúvidas e quem administra a clínica.

## O que precisa existir

A clínica quer continuar usando o celular, inclusive para ligações. Por isso a primeira versão liga o WACRM ao WhatsApp por QR Code, através do WAHA (WhatsApp HTTP API, motor GOWS), e não pela API oficial da Meta. O celular continua funcionando, o que for respondido por ele aparece no CRM, e não há tarifa por mensagem. A API oficial (com coexistência) fica para depois, sem trocar de sistema.

Nesse modo ficam desligados os disparos em massa e os modelos da Meta, que aumentam o risco de bloqueio do número, e a trava de 24 horas, que só existe na API oficial.

As gavetas da clínica viram etiquetas: Internamento, Dúvidas veterinárias, Orçamentos enviados, Follow-up, Pós-venda. A distribuição automática precisa de um rodízio de verdade (o do WACRM original sempre escolhe a mesma pessoa).

## O que não é

Não é robô de atendimento e não manda mensagem sozinho. Toda mensagem é escrita por uma pessoa.
