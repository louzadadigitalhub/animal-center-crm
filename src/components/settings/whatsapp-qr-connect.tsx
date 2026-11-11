'use client';

/**
 * Conexão do WhatsApp por QR Code (WAHA). Aparece no lugar do formulário
 * da Meta quando NEXT_PUBLIC_WHATSAPP_MODE=waha.
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, QrCode, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';

interface QrStatus {
  session: string;
  status: string;
  connected: boolean;
  phone: string | null;
  name: string | null;
  qr: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  WORKING: 'Conectado',
  SCAN_QR_CODE: 'Esperando leitura do QR Code',
  STARTING: 'Iniciando…',
  STOPPED: 'Desligado',
  FAILED: 'Falhou — clique em Conectar de novo',
};

export function WhatsAppQrConnect() {
  const [info, setInfo] = useState<QrStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/waha/connect', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Falha ao consultar a conexão.');
      setInfo(data);
      if (data.connected) setCode(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao consultar a conexão.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Enquanto não conecta, atualiza a cada 3 segundos (o QR Code muda).
  useEffect(() => {
    if (!info || info.connected || info.status === 'STOPPED') return;
    const id = setInterval(() => void load(), 3000);
    return () => clearInterval(id);
  }, [info, load]);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch('/api/waha/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Não foi possível concluir.');
      return data;
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    try {
      setInfo(await post({ action: 'start' }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível ligar a conexão.');
    }
  }

  async function pairCode() {
    try {
      const data = await post({ action: 'pair-code', phoneNumber: phone });
      setCode(data.code);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível gerar o código.');
    }
  }

  return (
    <div className="space-y-6">
      <SettingsPanelHead
        title="WhatsApp"
        description="Conexão por QR Code: o CRM entra como mais um aparelho conectado no WhatsApp da clínica. O celular continua funcionando normalmente."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Situação</CardTitle>
          <CardDescription className="text-muted-foreground">
            O CRM nunca envia mensagem sozinho: só a equipe respondendo quem chamou.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Consultando…
            </p>
          ) : info?.connected ? (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                Conectado ao número <strong>{info.phone}</strong>
                {info.name ? <> ({info.name})</> : null}. As mensagens novas já chegam na caixa de entrada.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {STATUS_LABEL[info?.status ?? 'STOPPED'] ?? info?.status}
              </p>
              {(!info || info.status === 'STOPPED' || info.status === 'FAILED') && (
                <Button onClick={start} disabled={busy}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <QrCode className="mr-2 h-4 w-4" />}
                  Conectar
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {!info?.connected && info && info.status !== 'STOPPED' && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">Ler o QR Code</CardTitle>
              <CardDescription className="text-muted-foreground">
                No celular da clínica: WhatsApp → Dispositivos conectados → Conectar dispositivo.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              {info.qr ? (
                // eslint-disable-next-line @next/next/no-img-element -- QR em data URL, muda a cada poucos segundos
                <img src={info.qr} alt="QR Code do WhatsApp" className="h-64 w-64 rounded bg-white p-2" />
              ) : (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Gerando QR Code…
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">Ou conectar com o número</CardTitle>
              <CardDescription className="text-muted-foreground">
                No celular: Conectar dispositivo → Conectar com número de telefone, e digite o código.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label className="text-muted-foreground">Número da clínica (com 55 e DDD)</Label>
                <Input
                  placeholder="5551999999999"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="bg-muted border-border text-foreground"
                />
              </div>
              <Button variant="outline" onClick={pairCode} disabled={busy || phone.replace(/\D/g, '').length < 12}>
                <Smartphone className="mr-2 h-4 w-4" /> Gerar código
              </Button>
              {code && (
                <p className="text-center font-mono text-3xl tracking-[0.3em] text-foreground">{code}</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
