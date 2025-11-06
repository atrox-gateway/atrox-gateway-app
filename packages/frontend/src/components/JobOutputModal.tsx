import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';

type Job = { id: string; name?: string } | null;

const base64ToUtf8 = (b64: string) => {
  try { return decodeURIComponent(escape(atob(b64))); } catch { return atob(b64); }
};

const downloadBase64 = (filename: string, b64: string) => {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const MAX_INLINE_BYTES = 512 * 1024; // 512 KB

const JobOutputModal: React.FC<{ job: Job; open: boolean; onOpenChange: (v: boolean) => void }> = ({ job, open, onOpenChange }) => {
  const { user } = useAuth();
  const username = user?.username || '';
  const { toast } = useToast();

  const [loadingOut, setLoadingOut] = useState(false);
  const [loadingErr, setLoadingErr] = useState(false);
  const [outExists, setOutExists] = useState(false);
  const [errExists, setErrExists] = useState(false);
  const [outContent, setOutContent] = useState<string | null>(null);
  const [errContent, setErrContent] = useState<string | null>(null);
  const [outBase64, setOutBase64] = useState<string | null>(null);
  const [errBase64, setErrBase64] = useState<string | null>(null);
  const [outSize, setOutSize] = useState<number | null>(null);
  const [errSize, setErrSize] = useState<number | null>(null);
  const [outBinary, setOutBinary] = useState(false);
  const [errBinary, setErrBinary] = useState(false);

  const resultsDir = useMemo(() => `/hpc-home/${username}/jobs/resultados`, [username]);

  useEffect(() => {
    if (!open || !job) return;
    // Reset
    setOutContent(null); setErrContent(null); setOutBase64(null); setErrBase64(null);
    setOutExists(false); setErrExists(false); setOutSize(null); setErrSize(null);
    setOutBinary(false); setErrBinary(false);

    const fetchFile = async (suffix: string) => {
      const path = `${resultsDir}/${job.id}.${suffix}`;
      try {
        const res = await fetch(`/api/v1/user/file?path=${encodeURIComponent(path)}`, { credentials: 'include' });
        if (!res.ok) {
          // Treat as not found
          return { exists: false } as any;
        }
        const data = await res.json();
        if (!data?.success) return { exists: false };
        return { exists: true, base64: data.contentBase64, size: data.size || null, isBinary: !!data.isBinary };
      } catch (e) {
        return { exists: false } as any;
      }
    };

    (async () => {
      setLoadingOut(true); setLoadingErr(true);
      const [outRes, errRes] = await Promise.all([fetchFile('out'), fetchFile('err')]);

      if (outRes && outRes.exists) {
        setOutExists(true);
        setOutBase64(outRes.base64);
        setOutSize(outRes.size ?? null);
        setOutBinary(!!outRes.isBinary);
        if (!outRes.isBinary) {
          try {
            const txt = base64ToUtf8(outRes.base64);
            setOutContent(txt.length > MAX_INLINE_BYTES ? txt.slice(0, MAX_INLINE_BYTES) : txt);
          } catch (e) {
            setOutContent(null);
          }
        }
      } else {
        setOutExists(false);
      }

      if (errRes && errRes.exists) {
        setErrExists(true);
        setErrBase64(errRes.base64);
        setErrSize(errRes.size ?? null);
        setErrBinary(!!errRes.isBinary);
        if (!errRes.isBinary) {
          try {
            const txt = base64ToUtf8(errRes.base64);
            setErrContent(txt.length > MAX_INLINE_BYTES ? txt.slice(0, MAX_INLINE_BYTES) : txt);
          } catch (e) {
            setErrContent(null);
          }
        }
      } else {
        setErrExists(false);
      }

      setLoadingOut(false); setLoadingErr(false);
    })();

  }, [open, job, resultsDir]);

  const handleDownload = (suffix: 'out' | 'err') => {
    const b64 = suffix === 'out' ? outBase64 : errBase64;
    if (!b64) { toast({ title: 'No disponible', description: `No se encontró .${suffix}` }); return; }
    const filename = `${job?.id}.${suffix}`;
    downloadBase64(filename, b64);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl w-full">
        <DialogHeader>
          <DialogTitle>{job ? `${job.name || 'Trabajo'} — ${job.id}` : 'Salida del trabajo'}</DialogTitle>
          <DialogDescription>Visualiza la salida estándar y el error estándar generados por Slurm.</DialogDescription>
        </DialogHeader>

        <div className="mt-2">
          <Tabs defaultValue="out">
            <TabsList>
              <TabsTrigger value="out">Salida (.out){outSize ? ` • ${outSize} bytes` : ''}</TabsTrigger>
              <TabsTrigger value="err">Error (.err){errSize ? ` • ${errSize} bytes` : ''}</TabsTrigger>
            </TabsList>
            <TabsContent value="out">
              {loadingOut ? <div className="p-4">Cargando salida...</div> : (
                <div className="p-2">
                  {!outExists && <div className="text-sm text-muted-foreground">No se encontró archivo .out para este trabajo.</div>}
                  {outExists && outBinary && <div className="text-sm">Archivo binario — use Descargar para obtener el fichero completo.</div>}
                  {outExists && !outBinary && outContent != null && (
                    <pre className="max-h-96 overflow-auto bg-muted p-3 rounded text-sm whitespace-pre-wrap">{outContent}{(outSize ?? 0) > MAX_INLINE_BYTES ? '\n\n...archivo truncado (usar Descargar para todo)' : ''}</pre>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="err">
              {loadingErr ? <div className="p-4">Cargando error...</div> : (
                <div className="p-2">
                  {!errExists && <div className="text-sm text-muted-foreground">No se encontró archivo .err para este trabajo.</div>}
                  {errExists && errBinary && <div className="text-sm">Archivo binario — use Descargar para obtener el fichero completo.</div>}
                  {errExists && !errBinary && errContent != null && (
                    <pre className="max-h-96 overflow-auto bg-muted p-3 rounded text-sm whitespace-pre-wrap">{errContent}{(errSize ?? 0) > MAX_INLINE_BYTES ? '\n\n...archivo truncado (usar Descargar para todo)' : ''}</pre>
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter>
          <div className="flex gap-2 w-full justify-between">
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => handleDownload('out')} disabled={!outExists}>Descargar .out</Button>
              <Button variant="outline" onClick={() => handleDownload('err')} disabled={!errExists}>Descargar .err</Button>
            </div>
            <div>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default JobOutputModal;
