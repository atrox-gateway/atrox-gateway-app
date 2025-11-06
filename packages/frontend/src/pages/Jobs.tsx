import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  Play,
  Pause,
  XCircle,
  Upload,
  Settings,
  Search,
  Filter,
  Plus,
  RefreshCw
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";

type UiJobStatus = "running" | "queued" | "completed" | "failed" | "unknown";

type Job = {
  id: string;
  name: string | null;
  status: UiJobStatus;
  progress: number;
  submitTime: string | null;
  startTime: string | null | "-";
  estimatedEnd: string | "-";
  cpus?: number;
  memory?: string;
  user: string;
};

type PartitionInfo = {
  partition: string | null;
  avail: string | null;
  mem: string | null;
  nodes: number | null;
  cpus: number | null;
  gpus: string | null;
};

const Jobs = () => {
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuth();
  const username = user?.username || "";
  const USER_HOME_PATH = username ? `/hpc-home/${username}` : "/hpc-home";
  const [tabValue, setTabValue] = useState<string>("list");
  const [filter, setFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Submit form state
  const [jobName, setJobName] = useState("");
  const [cpus, setCpus] = useState<string>("");
  const [memory, setMemory] = useState<string>("1G"); // e.g., "512M", "1G". Default 1G para entornos con poca RAM
  const [walltime, setWalltime] = useState(""); // HH:MM:SS
  const [partition, setPartition] = useState<string>("");
  const [account, setAccount] = useState<string>("");
  const [qos, setQos] = useState<string>("");
  const [description, setDescription] = useState("");
  const [scriptFileName, setScriptFileName] = useState<string>("");
  const [scriptBase64, setScriptBase64] = useState<string>("");
  const [scriptSource, setScriptSource] = useState<"local" | "files" | null>(null);
  const [scriptPath, setScriptPath] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Partitions
  const [partitions, setPartitions] = useState<PartitionInfo[]>([]);
  const [loadingPartitions, setLoadingPartitions] = useState<boolean>(false);
  const [partitionError, setPartitionError] = useState<string | null>(null);

  // Helpers para validar recursos vs partición
  const normalizePartitionName = (p?: string | null) => (p || "").replace(/\*/g, "");
  const parsePartitionMemMB = (memStr?: string | null): number | null => {
    // Acepta valores como "1024", "1G", "512M", etc. Devuelve MB enteros
    if (!memStr) return null;
    const s = String(memStr).trim().toUpperCase();
    // Extrae número (posible decimal) y unidad opcional K/M/G/T/P
    const m = s.match(/^(\d+(?:\.\d+)?)([KMGTP])?B?$/);
    if (!m) return null;
    const val = parseFloat(m[1]);
    if (isNaN(val) || val <= 0) return null;
    const unit = m[2] || 'M'; // por defecto MB si no hay unidad
    let mb = val;
    switch (unit) {
      case 'K':
        mb = val / 1024;
        break;
      case 'M':
        mb = val;
        break;
      case 'G':
        mb = val * 1024;
        break;
      case 'T':
        mb = val * 1024 * 1024;
        break;
      case 'P':
        mb = val * 1024 * 1024 * 1024;
        break;
      default:
        mb = val; // fallback MB
    }
    return Math.floor(mb);
  };
  const parseUserMemToMB = (m?: string): number | null => {
    if (!m) return null;
    const s = m.trim().toUpperCase();
    const mMatch = s.match(/^(\d+)([GM])?B?$/);
    if (!mMatch) return null;
    const val = parseInt(mMatch[1], 10);
    if (isNaN(val)) return null;
    const unit = mMatch[2] || 'G';
    if (unit === 'G') return val * 1024;
    if (unit === 'M') return val;
    return val * 1024; // por defecto G
  };

  const selectedPartition = useMemo(() => {
    const name = normalizePartitionName(partition);
    return partitions.find(p => normalizePartitionName(p.partition) === name) || null;
  }, [partition, partitions]);

  const maxPartitionMemMB = useMemo(() => parsePartitionMemMB(selectedPartition?.mem), [selectedPartition]);
  const maxPartitionCpus = useMemo(() => (selectedPartition?.cpus ?? null), [selectedPartition]);
  const requestedMemMB = useMemo(() => parseUserMemToMB(memory), [memory]);
  const requestedCpus = useMemo(() => (cpus ? parseInt(cpus, 10) : null), [cpus]);
  const isSuspiciousMemLimit = useMemo(() => {
    // Si sinfo reporta <128 MB por nodo, es probablemente un error de configuración; no bloqueamos envío
    return maxPartitionMemMB != null && maxPartitionMemMB > 0 && maxPartitionMemMB < 128;
  }, [maxPartitionMemMB]);

  const formatMB = (mb?: number | null) => {
    if (mb == null) return "?";
    if (mb >= 1024) {
      const gb = mb / 1024;
      // Si es múltiplo exacto, sin decimales; si no, 1 decimal
      return gb % 1 === 0 ? `${gb.toFixed(0)} GB` : `${gb.toFixed(1)} GB`;
    }
    return `${mb} MB`;
  };

  const memWithinLimits = useMemo(() => {
    if (!requestedMemMB) return true;
    if (maxPartitionMemMB == null) return true; // si no sabemos, no bloqueamos
    return requestedMemMB <= maxPartitionMemMB;
  }, [requestedMemMB, maxPartitionMemMB]);

  const cpusWithinLimits = useMemo(() => {
    if (!requestedCpus) return true;
    if (maxPartitionCpus == null) return true;
    return requestedCpus <= maxPartitionCpus;
  }, [requestedCpus, maxPartitionCpus]);

  // Workaround: si el clúster reporta un límite absurdo (<128MB), evita solicitar memoria explícita
  useEffect(() => {
    if (isSuspiciousMemLimit && memory === '1G') {
      setMemory(''); // no enviar --mem para dejar que Slurm use el valor por defecto
    }
  }, [isSuspiciousMemLimit]);

  const fetchJobs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/user/jobs", { credentials: "include" });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      setJobs(Array.isArray(data?.jobs) ? data.jobs : []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "No se pudieron cargar los trabajos.");
    } finally {
      setLoading(false);
    }
  };

  const fetchPartitions = async () => {
    setLoadingPartitions(true);
    setPartitionError(null);
    try {
      const res = await fetch("/api/v1/user/partitions", { credentials: "include" });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      const parts: PartitionInfo[] = Array.isArray(data?.partitions) ? data.partitions : [];
      setPartitions(parts);
      // Set default partition (first available without trailing *)
      if (!partition && parts.length > 0) {
        const first = (parts[0].partition || "").replace(/\*/g, "");
        setPartition(first);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setPartitionError(msg || "No se pudieron cargar las particiones.");
    } finally {
      setLoadingPartitions(false);
    }
  };

  useEffect(() => {
    fetchJobs();
    fetchPartitions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredJobs = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return jobs.filter((j) => {
      const okStatus = filter === "all" ? true : j.status === (filter as UiJobStatus);
      const text = `${j.name || ""} ${j.id} ${j.user}`.toLowerCase();
      const okSearch = term ? text.includes(term) : true;
      return okStatus && okSearch;
    });
  }, [jobs, filter, searchTerm]);

  const onClickCancel = async (jobId: string) => {
    try {
      const res = await fetch(`/api/v1/user/jobs/${jobId}/cancel`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      toast({ title: "Trabajo cancelado", description: `El trabajo ${jobId} fue cancelado.` });
      await fetchJobs();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "No se pudo cancelar", description: msg || "Intente de nuevo.", variant: "destructive" });
    }
  };

  const triggerFilePicker = () => fileInputRef.current?.click();

  const onFileSelected = async (file?: File) => {
    if (!file) return;
    try {
      // Convert to base64
      const buf = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buf);
      setScriptBase64(base64);
      setScriptFileName(file.name);
      setScriptSource("local");
      setScriptPath("");
    } catch (e) {
      toast({ title: "Error leyendo archivo", description: "No fue posible leer el script.", variant: "destructive" });
    }
  };

  const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk) as number[]);
    }
    return btoa(binary);
  };

  // --- File Browser (Mis Archivos) ---
  type FileItem = { id: string; name: string; type: 'file' | 'folder' };
  const [fileDialogOpen, setFileDialogOpen] = useState(false);
  const [fbPath, setFbPath] = useState<string>(USER_HOME_PATH);
  const [fbFiles, setFbFiles] = useState<FileItem[]>([]);
  const [fbLoading, setFbLoading] = useState<boolean>(false);
  const [fbError, setFbError] = useState<string | null>(null);

  const fetchFbFiles = async (path: string) => {
    setFbLoading(true);
    setFbError(null);
    try {
      const safePath = path && path.startsWith(USER_HOME_PATH) ? path : USER_HOME_PATH;
      const res = await fetch(`/api/v1/user/files?path=${encodeURIComponent(safePath)}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      const list: FileItem[] = Array.isArray(data?.files)
        ? data.files.map((f: any) => ({ id: f.id, name: f.name, type: f.type }))
        : [];
      setFbFiles(list);
      setFbPath(data?.path || safePath);
    } catch (e: any) {
      setFbError(e?.message || 'No se pudieron cargar archivos.');
    } finally {
      setFbLoading(false);
    }
  };

  useEffect(() => {
    if (fileDialogOpen && isAuthenticated) {
      fetchFbFiles(fbPath || USER_HOME_PATH);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileDialogOpen]);

  const goUpPath = (path: string) => {
    const segs = path.split('/').filter(Boolean);
    segs.pop();
    const parent = `/${segs.join('/')}` || '/';
    // No permitir salir del home del usuario
    if (!parent.startsWith(USER_HOME_PATH)) return USER_HOME_PATH;
    return parent;
  };

  const pickFileFromPath = async (path: string, displayName: string) => {
    try {
      const res = await fetch(`/api/v1/user/file?path=${encodeURIComponent(path)}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      if (!data?.success) throw new Error('No se pudo leer el archivo.');
      setScriptBase64(data.contentBase64);
      setScriptFileName(displayName);
      setScriptSource('files');
      setScriptPath(path);
      setFileDialogOpen(false);
      toast({ title: 'Script seleccionado', description: displayName });
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message || 'No se pudo abrir el archivo', variant: 'destructive' });
    }
  };

  // Helper para enviar el trabajo, con opción de omitir memoria (--mem)
  const postJob = async (omitMem: boolean) => {
    const body = {
      name: jobName.trim(),
      cpus: cpus ? parseInt(cpus, 10) : undefined,
      memory: omitMem ? undefined : (memory || undefined), // ej: "16G"
      partition: partition || undefined,
      account: account || undefined,
      qos: qos || undefined,
      walltime: walltime || undefined,
      scriptBase64,
      scriptFileName: scriptFileName || undefined,
    };
    const res = await fetch("/api/v1/user/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      try {
        const j = JSON.parse(txt);
        throw new Error(j?.detail || j?.error || `Error ${res.status}`);
      } catch (_) {
        throw new Error(txt || `Error ${res.status}`);
      }
    }
    return res.json();
  };

  // ======= Templates (Plantillas) =======
  const TEMPLATES_DIR = `${USER_HOME_PATH}/.atrox/job-templates`;
  const [templates, setTemplates] = useState<Array<{ id: string; name: string }>>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");

  const utf8ToBase64 = (str: string) => {
    try { return btoa(unescape(encodeURIComponent(str))); } catch { return btoa(str); }
  };
  const base64ToUtf8 = (b64: string) => {
    try { return decodeURIComponent(escape(atob(b64))); } catch { return atob(b64); }
  };

  // IDs que vienen del backend en listados de archivos son base64(path absoluto)
  const decodePathId = (idOrPath: string): string => {
    try {
      const decoded = base64ToUtf8(idOrPath);
      return decoded.startsWith('/') ? decoded : idOrPath;
    } catch {
      return idOrPath;
    }
  };

  const createFolder = async (p: string) => {
    const res = await fetch('/api/v1/user/folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ path: p })
    });
    // Ignore non-2xx; caller will best-effort
    return res.ok;
  };

  const ensureTemplatesDir = async () => {
    try {
      // Crear ~/.atrox si no existe y luego ~/.atrox/job-templates
      const base = `${USER_HOME_PATH}/.atrox`;
      await createFolder(base);
      await createFolder(TEMPLATES_DIR);
    } catch {
      // no-op
    }
  };

  const listTemplates = async () => {
    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      await ensureTemplatesDir();
      const res = await fetch(`/api/v1/user/files?path=${encodeURIComponent(TEMPLATES_DIR)}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      const files = Array.isArray(data?.files) ? data.files : [];
      const list = files
        .filter((f: any) => f.type === 'file' && f.name.endsWith('.json'))
        .map((f: any) => ({ id: f.id, name: f.name.replace(/\.json$/, '') }));
      setTemplates(list);
    } catch (e: any) {
      setTemplatesError(e?.message || 'No se pudieron cargar las plantillas.');
    } finally {
      setTemplatesLoading(false);
    }
  };

  useEffect(() => {
    if (tabValue === 'templates' && isAuthenticated) {
      listTemplates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabValue]);

  const toSlug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'plantilla';

  const buildTemplatePayload = (overrideScriptPath?: string) => ({
    name: jobName.trim(),
    cpus,
    memory,
    walltime,
    partition,
    account,
    qos,
    description,
    script: {
      source: overrideScriptPath ? 'files' : scriptSource,
      path: overrideScriptPath || (scriptSource === 'files' ? scriptPath : undefined),
      fileName: scriptFileName || undefined
    }
  });

  const sanitizeFileName = (s: string) => s.replace(/[\s/\\]+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 120) || 'script';

  const saveTemplateScriptIfAny = async (slug: string): Promise<string | undefined> => {
    try {
      if (scriptBase64 && scriptFileName) {
        // Guardar una copia del script en la carpeta de jobs del usuario para que exista incluso sin ejecutar
        const safeName = `${slug}-${sanitizeFileName(scriptFileName)}`;
        const jobsDir = `${USER_HOME_PATH}/jobs`;
        await createFolder(jobsDir);
        let targetPath = `${jobsDir}/${safeName}`;
        let body = { path: targetPath, contentBase64: scriptBase64 };
        let res = await fetch('/api/v1/user/file', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body)
        });
        if (!res.ok) {
          // Overwrite si ya existe
          res = await fetch('/api/v1/user/file', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body)
          });
        }

        // Si por alguna razón no se pudo escribir en jobs, intentar en la carpeta de plantillas
        if (!res.ok) {
          await ensureTemplatesDir();
          targetPath = `${TEMPLATES_DIR}/${safeName}`;
          body = { path: targetPath, contentBase64: scriptBase64 };
          let res2 = await fetch('/api/v1/user/file', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body)
          });
          if (!res2.ok) {
            res2 = await fetch('/api/v1/user/file', {
              method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body)
            });
          }
          if (!res2.ok) throw new Error(`Error ${res2.status}`);
        }
        return targetPath;
      }
    } catch (e) {
      // Si falla copiar el script, continuamos con la plantilla sin path
    }
    return undefined;
  };

  const saveTemplate = async () => {
    const name = templateName.trim();
    if (!name) return;
    try {
      setTemplatesLoading(true);
      setTemplatesError(null);
      await ensureTemplatesDir();
      const slug = toSlug(name);
      const filePath = `${TEMPLATES_DIR}/${slug}.json`;
      // Si tenemos un script en memoria, guardamos una copia en la carpeta de plantillas y referenciamos ese path
      const savedScriptPath = await saveTemplateScriptIfAny(slug);
      const content = JSON.stringify(buildTemplatePayload(savedScriptPath), null, 2);
      const body = { path: filePath, contentBase64: utf8ToBase64(content) };
      // Try create; if exists, overwrite
      let res = await fetch('/api/v1/user/file', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body)
      });
      if (!res.ok) {
        // Overwrite
        res = await fetch('/api/v1/user/file', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body)
        });
      }
      if (!res.ok) throw new Error(`Error ${res.status}`);
      toast({ title: 'Plantilla guardada', description: name });
      setTemplateDialogOpen(false);
      setTemplateName('');
      listTemplates();
    } catch (e: any) {
      setTemplatesError(e?.message || 'No se pudo guardar la plantilla.');
      toast({ title: 'Error', description: e?.message || 'No se pudo guardar la plantilla', variant: 'destructive' });
    } finally {
      setTemplatesLoading(false);
    }
  };

  const loadTemplate = async (fileId: string) => {
    try {
      setTemplatesLoading(true);
      const pathParam = decodePathId(fileId);
      const res = await fetch(`/api/v1/user/file?path=${encodeURIComponent(pathParam)}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      const json = JSON.parse(base64ToUtf8(data.contentBase64 || 'e30='));
      setTabValue('submit');
      setJobName(json.name || '');
      setCpus(json.cpus != null ? String(json.cpus) : '');
      setMemory(json.memory != null ? String(json.memory) : '');
      setWalltime(json.walltime != null ? String(json.walltime) : '');
      setPartition(json.partition != null && String(json.partition) ? String(json.partition) : partition);
      setAccount(json.account != null ? String(json.account) : '');
      setQos(json.qos != null ? String(json.qos) : '');
      setDescription(json.description || '');
      const sc = json.script || {};
      // Helper para intentar cargar un script desde un path dado
      const tryPick = async (p?: string, displayName?: string) => {
        if (!p) return false;
        try {
          const check = await fetch(`/api/v1/user/file?path=${encodeURIComponent(p)}`, { credentials: 'include' });
          if (!check.ok) return false;
          const name = displayName || p.split('/').pop() || 'script';
          // Reutiliza pickFileFromPath para setear correctamente todos los estados
          await pickFileFromPath(p, name);
          return true;
        } catch {
          return false;
        }
      };

      let scriptLoaded = false;
      // 1) Caso ideal: ya viene path de archivos
      if (sc.source === 'files' && sc.path) {
        scriptLoaded = await tryPick(sc.path, sc.fileName);
      }
      // 2) Compat: si no hay path pero hay fileName, intenta buscar copia guardada por nombre
      if (!scriptLoaded && sc.fileName) {
        const slug = toSlug(json.name || 'plantilla');
        const candidate1 = `${TEMPLATES_DIR}/${slug}-${sanitizeFileName(sc.fileName)}`;
        const candidate2 = `${TEMPLATES_DIR}/${sanitizeFileName(sc.fileName)}`;
        scriptLoaded = await tryPick(candidate1, sc.fileName) || await tryPick(candidate2, sc.fileName);
      }

      if (!scriptLoaded) {
        // No se pudo resolver un script automáticamente: limpiar y avisar
        setScriptBase64('');
        setScriptFileName(sc.fileName || '');
        setScriptSource(null);
        setScriptPath('');
        toast({ title: 'Plantilla cargada parcialmente', description: 'Seleccione el script manualmente (no se encontró el archivo guardado).', variant: 'destructive' });
      }
      toast({ title: 'Plantilla cargada', description: json.name || '' });
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message || 'No se pudo cargar la plantilla', variant: 'destructive' });
    } finally {
      setTemplatesLoading(false);
    }
  };

  const deleteTemplate = async (fileId: string) => {
    try {
      setTemplatesLoading(true);
      const pathParam = decodePathId(fileId);
      const res = await fetch(`/api/v1/user/file?path=${encodeURIComponent(pathParam)}`, {
        method: 'DELETE', credentials: 'include'
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      toast({ title: 'Plantilla eliminada' });
      listTemplates();
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message || 'No se pudo eliminar', variant: 'destructive' });
    } finally {
      setTemplatesLoading(false);
    }
  };

  const onSubmitJob = async () => {
    if (!jobName.trim()) {
      toast({ title: "Nombre requerido", description: "Asigna un nombre al trabajo.", variant: "destructive" });
      return;
    }
    if (!scriptBase64) {
      toast({ title: "Script requerido", description: "Selecciona un script a ejecutar.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      // Primer intento: con memoria si el usuario la especificó
      const data = await postJob(false);
      toast({ title: "Trabajo enviado", description: `ID: ${data?.jobId || "desconocido"}` });
    // Reset form minimal
      setJobName("");
      setCpus("");
      setMemory("");
      setWalltime("");
      setPartition(partition || "");
    setAccount("");
    setQos("");
      setDescription("");
      setScriptBase64("");
      setScriptFileName("");
    setScriptSource(null);
    setScriptPath("");
      // Refresh jobs list
      await fetchJobs();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const looksLikeMemError = /mem|memory|--mem|cannot\s+satisfy|exceed|mem(ory)? per/i.test(msg);
      const userSpecifiedMem = Boolean(memory);
      if (looksLikeMemError && userSpecifiedMem) {
        // Reintentar una sola vez sin --mem
        try {
          toast({ title: "Memoria rechazada", description: "Reintentando sin --mem (dejar que Slurm asigne por defecto)..." });
          const data2 = await postJob(true);
          toast({ title: "Trabajo enviado", description: `ID: ${data2?.jobId || "desconocido"}` });
          // Reset form minimal (conserva selección de partición)
          setJobName("");
          setCpus("");
          setMemory("");
          setWalltime("");
          setPartition(partition || "");
          setAccount("");
          setQos("");
          setDescription("");
          setScriptBase64("");
          setScriptFileName("");
          setScriptSource(null);
          setScriptPath("");
          await fetchJobs();
        } catch (e2: unknown) {
          const m2 = e2 instanceof Error ? e2.message : String(e2);
          toast({ title: "Error al enviar trabajo", description: m2 || "Intente de nuevo.", variant: "destructive" });
        }
      } else {
        toast({ title: "Error al enviar trabajo", description: msg || "Intente de nuevo.", variant: "destructive" });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "running":
        return <Badge className="bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400"><Play className="w-3 h-3 mr-1" />Ejecutando</Badge>;
      case "queued":
        return <Badge className="bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400"><Pause className="w-3 h-3 mr-1" />En Cola</Badge>;
      case "completed":
        return <Badge className="bg-green-500/10 text-green-600 dark:bg-green-500/20 dark:text-green-400">Completado</Badge>;
      case "failed":
        return <Badge className="bg-red-500/10 text-red-600 dark:bg-red-500/20 dark:text-red-400">Error</Badge>;
      default:
        return <Badge variant="outline">Desconocido</Badge>;
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center animate-fade-in-up">
          <div>
            <h1 className="text-3xl font-bold text-gradient">Gestión de Trabajos</h1>
            <p className="text-muted-foreground mt-2">
              Administra y monitorea trabajos en LeoAtrox
            </p>
          </div>
          <Button className="btn-hero" onClick={() => setTabValue('submit')}>
            <Plus className="w-4 h-4 mr-2" />
            Nuevo Trabajo
          </Button>
        </div>

        <Tabs value={tabValue} onValueChange={setTabValue} className="animate-fade-in-up delay-100">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="list">Trabajos en Ejecución</TabsTrigger>
            <TabsTrigger value="submit">Enviar Trabajo</TabsTrigger>
            <TabsTrigger value="templates">Plantillas</TabsTrigger>
          </TabsList>

          <TabsContent value="list" className="space-y-6">
            {/* Filters */}
            <Card className="card-professional">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Filter className="h-5 w-5" />
                  Filtros y Búsqueda
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col md:flex-row gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar trabajos..."
                      className="pl-10"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                  <Select value={filter} onValueChange={setFilter}>
                    <SelectTrigger className="w-full md:w-48">
                      <SelectValue placeholder="Estado" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="running">Ejecutando</SelectItem>
                      <SelectItem value="queued">En Cola</SelectItem>
                      <SelectItem value="completed">Completados</SelectItem>
                      <SelectItem value="failed">Con Errores</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={fetchJobs} disabled={loading}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    {loading ? "Actualizando..." : "Actualizar"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Jobs List */}
            <div className="space-y-4">
              {error && (
                <div className="text-sm text-red-500">{error}</div>
              )}
              {!error && filteredJobs.length === 0 && (
                <div className="text-sm text-muted-foreground">{loading ? "Cargando trabajos..." : "No hay trabajos en ejecución."}</div>
              )}
              {filteredJobs.map((job) => (
                <Card key={job.id} className="card-professional">
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="flex items-center gap-3">
                          {job.name}
                          {getStatusBadge(job.status)}
                        </CardTitle>
                        <CardDescription>
                          ID: {job.id} • Usuario: {job.user}
                        </CardDescription>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" title="Detalles (sacct)" onClick={async () => {
                          try {
                            const res = await fetch(`/api/v1/user/jobs/${job.id}`, { credentials: 'include' });
                            if (!res.ok) throw new Error(`Error ${res.status}`);
                            const details = await res.json();
                            toast({ title: details?.name || job.name || 'Detalle de trabajo', description: `Estado: ${details?.status} • CPUs: ${details?.cpus ?? job.cpus ?? '-'} • Mem: ${details?.memory ?? job.memory ?? '-'}` });
                          } catch (e: unknown) {
                            const msg = e instanceof Error ? e.message : String(e);
                            toast({ title: 'No se pudo cargar el detalle', description: msg || '', variant: 'destructive' });
                          }
                        }}>
                          <div className="flex items-center gap-2">
                            <Settings className="h-4 w-4" />
                            <span className="text-sm">Detalles</span>
                          </div>
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => onClickCancel(job.id)} title={`Cancelar ${job.id}`} aria-label={`Cancelar trabajo ${job.id}`}>
                          <div className="flex items-center gap-2">
                            <XCircle className="h-4 w-4 text-destructive" />
                            <span className="text-sm text-destructive">Cancelar</span>
                          </div>
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Enviado:</span>
                        <div>{job.submitTime}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Inicio:</span>
                        <div>{job.startTime}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">CPUs:</span>
                        <div>{job.cpus}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Memoria:</span>
                        <div>{job.memory}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="submit" className="space-y-6">
            <Card className="card-professional">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5" />
                  Enviar Nuevo Trabajo
                </CardTitle>
                <CardDescription>
                  Configure los parámetros y recursos para su trabajo computacional
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="jobName">Nombre del Trabajo</Label>
                      <Input
                        id="jobName"
                        placeholder="Ej: Análisis RNA-Seq Dataset"
                        className="mt-1"
                        value={jobName}
                        onChange={(e) => setJobName(e.target.value)}
                      />
                    </div>

                    <div>
                      <Label htmlFor="script">Script Principal</Label>
                      <div className="mt-1 border-2 border-dashed border-border rounded-lg p-6 text-center">
                        <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                        <p className="text-sm text-muted-foreground">
                          Arrastra tu script aquí o haz clic para seleccionar
                        </p>
                        <div className="text-sm mt-1">
                          {scriptFileName ? `Seleccionado: ${scriptFileName}` : "Ningún archivo seleccionado"}
                          {scriptSource === 'files' && scriptPath && (
                            <div className="text-xs text-muted-foreground">Origen: Mis archivos ({scriptPath})</div>
                          )}
                          {scriptSource === 'local' && (
                            <div className="text-xs text-muted-foreground">Origen: Este equipo</div>
                          )}
                        </div>
                        <input
                          type="file"
                          accept=".sh,.py,.r,.bash,.zsh,.txt,.slurm,.sbatch"
                          ref={fileInputRef}
                          className="hidden"
                          onChange={(e) => onFileSelected(e.target.files?.[0])}
                        />
                        <Button variant="outline" className="mt-2" onClick={triggerFilePicker}>
                          Seleccionar Archivo
                        </Button>
                        <Button variant="outline" className="mt-2 ml-2" onClick={() => setFileDialogOpen(true)}>
                          Desde mis archivos
                        </Button>
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="description">Descripción</Label>
                      <Textarea
                        id="description"
                        placeholder="Descripción opcional del trabajo..."
                        className="mt-1"
                        rows={3}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="cpus">CPUs</Label>
                        <Select value={cpus} onValueChange={setCpus}>
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder="Seleccionar" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">1 CPU</SelectItem>
                            <SelectItem value="2">2 CPUs</SelectItem>
                            <SelectItem value="4">4 CPUs</SelectItem>
                            <SelectItem value="8">8 CPUs</SelectItem>
                            <SelectItem value="16">16 CPUs</SelectItem>
                            <SelectItem value="32">32 CPUs</SelectItem>
                          </SelectContent>
                        </Select>
                        {!cpusWithinLimits && (
                          <div className="text-xs text-red-500 mt-1">
                            La partición {normalizePartitionName(partition) || '(sin nombre)'} permite hasta {maxPartitionCpus ?? '?'} CPUs por nodo.
                          </div>
                        )}
                      </div>

                      <div>
                        <Label htmlFor="memory">Memoria RAM</Label>
                        <Select value={memory} onValueChange={setMemory}>
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder="Seleccionar" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="256M">256 MB</SelectItem>
                            <SelectItem value="512M">512 MB</SelectItem>
                            <SelectItem value="1G">1 GB</SelectItem>
                            <SelectItem value="2G">2 GB</SelectItem>
                            <SelectItem value="3G">3 GB</SelectItem>
                            <SelectItem value="4G">4 GB</SelectItem>
                            <SelectItem value="8G">8 GB</SelectItem>
                            <SelectItem value="16G">16 GB</SelectItem>
                            <SelectItem value="32G">32 GB</SelectItem>
                            <SelectItem value="64G">64 GB</SelectItem>
                            <SelectItem value="128G">128 GB</SelectItem>
                          </SelectContent>
                        </Select>
                        {!memWithinLimits && !isSuspiciousMemLimit && (
                          <div className="text-xs text-red-500 mt-1">
                            La partición {normalizePartitionName(partition) || '(sin nombre)'} permite hasta {formatMB(maxPartitionMemMB)} por nodo.
                          </div>
                        )}
                        {isSuspiciousMemLimit && (
                          <div className="text-xs text-amber-600 mt-1">
                            Aviso: el clúster reporta un límite inusualmente bajo de {formatMB(maxPartitionMemMB)} por nodo. Permitiremos el envío, pero podría fallar si el límite es real.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="walltime">Tiempo Máximo</Label>
                        <Input
                          id="walltime"
                          placeholder="HH:MM:SS"
                          className="mt-1"
                          value={walltime}
                          onChange={(e) => setWalltime(e.target.value)}
                        />
                      </div>

                      <div>
                        <Label htmlFor="partition">Partición</Label>
                        <Select value={partition} onValueChange={setPartition}>
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder={loadingPartitions ? "Cargando..." : "Seleccionar"} />
                          </SelectTrigger>
                          <SelectContent>
                            {partitions.map((p) => {
                              const name = (p.partition || "").replace(/\*/g, "");
                              return (
                                <SelectItem key={name} value={name}>{name || "(sin nombre)"}</SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                        {partitionError && (
                          <div className="text-xs text-red-500 mt-1">{partitionError}</div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="account">Cuenta (account) opcional</Label>
                        <Input
                          id="account"
                          placeholder="p.ej. mylab"
                          className="mt-1"
                          value={account}
                          onChange={(e) => setAccount(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="qos">QoS opcional</Label>
                        <Input
                          id="qos"
                          placeholder="p.ej. normal"
                          className="mt-1"
                          value={qos}
                          onChange={(e) => setQos(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="p-4 bg-muted/50 rounded-lg">
                      <h4 className="font-medium mb-2">Configuración Recomendada</h4>
                      <p className="text-sm text-muted-foreground">
                        Basado en su selección actual: {cpus || "?"} CPUs, {memory || "?"} RAM, partición {partition || "?"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-4">
                  <Button variant="outline" onClick={() => setTemplateDialogOpen(true)}>
                    Guardar como Plantilla
                  </Button>
                  <Button className="btn-hero" onClick={onSubmitJob} disabled={submitting || !cpusWithinLimits || (!memWithinLimits && !isSuspiciousMemLimit)}>
                    <Play className="w-4 h-4 mr-2" />
                    {submitting ? "Enviando..." : "Enviar Trabajo"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="templates">
            <Card className="card-professional">
              <CardHeader>
                <CardTitle>Plantillas de Trabajos</CardTitle>
                <CardDescription>
                  Configuraciones predefinidas para trabajos frecuentes
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Templates List */}
                {templatesError && (
                  <div className="text-sm text-red-500 mb-2">{templatesError}</div>
                )}
                <div className="flex justify-between items-center mb-4">
                  <div className="text-sm text-muted-foreground">Ruta: {TEMPLATES_DIR}</div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={listTemplates} disabled={templatesLoading}>
                      {templatesLoading ? 'Cargando…' : 'Actualizar'}
                    </Button>
                  </div>
                </div>
                {templates.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-muted-foreground">No hay plantillas disponibles.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {templates.map((tpl) => (
                      <div key={tpl.id} className="flex items-center justify-between border rounded-md p-3">
                        <div className="text-sm">{tpl.name}</div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => loadTemplate(tpl.id)}>Usar</Button>
                          <Button size="sm" variant="outline" onClick={() => deleteTemplate(tpl.id)}>Eliminar</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Dialog: Mis Archivos */}
      <Dialog open={fileDialogOpen} onOpenChange={setFileDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Seleccionar script desde mis archivos</DialogTitle>
            <DialogDescription>Navega tu home y elige un archivo de script.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm text-muted-foreground truncate max-w-[75%]" title={fbPath}>{fbPath}</div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => fetchFbFiles(USER_HOME_PATH)}>Home</Button>
              <Button variant="outline" size="sm" onClick={() => fetchFbFiles(goUpPath(fbPath))}>Subir</Button>
            </div>
          </div>
          {fbError && <div className="text-sm text-red-500">{fbError}</div>}
          <div className="border rounded-md max-h-80 overflow-auto">
            {fbLoading ? (
              <div className="p-4 text-sm">Cargando…</div>
            ) : (
              <ul>
                {fbFiles.map(item => {
                  const joinPath = (base: string, name: string) => (base.endsWith('/') ? `${base}${name}` : `${base}/${name}`);
                  const fullPath = joinPath(fbPath, item.name);
                  return (
                    <li
                      key={`${fbPath}::${item.name}`}
                      className="flex items-center justify-between p-2 hover:bg-muted/50 cursor-pointer select-none"
                      onClick={() => {
                        if (item.type === 'folder') {
                          fetchFbFiles(fullPath);
                        }
                      }}
                      onDoubleClick={() => {
                        if (item.type === 'folder') {
                          fetchFbFiles(fullPath);
                        } else {
                          pickFileFromPath(fullPath, item.name);
                        }
                      }}
                    >
                      <span className="text-sm">
                        {item.type === 'folder' ? `📁 ${item.name}` : `📄 ${item.name}`}
                      </span>
                      {item.type === 'file' && (
                        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); pickFileFromPath(fullPath, item.name); }}>
                          Elegir
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFileDialogOpen(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Guardar Plantilla */}
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Guardar como plantilla</DialogTitle>
            <DialogDescription>Asigna un nombre a la plantilla para reutilizar esta configuración.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="tplName">Nombre de la plantilla</Label>
            <Input id="tplName" placeholder="ej. RNAseq pequeño" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
            {templatesError && <div className="text-sm text-red-500">{templatesError}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTemplateDialogOpen(false)}>Cancelar</Button>
            <Button onClick={saveTemplate} disabled={templatesLoading || !templateName.trim()}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
};

export default Jobs;
