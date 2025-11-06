import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Activity,
  TrendingUp,
  Users,
  Server,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Pause,
  Play,
  MoreHorizontal,
  Loader2,
  RefreshCw
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/contexts/AuthContext";
// AdminPanel removed — component deleted

const mockRecentJobs = [
  { id: "job_001", name: "Análisis RNA-Seq", status: "running", progress: 75, user: "Dr. García", time: "2h 15m" },
  { id: "job_002", name: "Simulación Molecular", status: "queued", progress: 0, user: "Ana López", time: "En cola" },
  { id: "job_003", name: "ML Training Model", status: "completed", progress: 100, user: "Carlos Ruiz", time: "Completado" },
  { id: "job_004", name: "Procesamiento Imágenes", status: "failed", progress: 45, user: "María Silva", time: "Error" },
  { id: "job_005", name: "Análisis Estadístico", status: "running", progress: 30, user: "Dr. Martínez", time: "45m" },
];

interface DashboardStats {
  totalJobs: number;
  runningJobs: number;
  queuedJobs: number;
  completedToday: number;
  cpuUsage: number;
  memoryUsage: number;
  storageUsage?: number;
  activeUsers: number;
  nodesActive: number;
  nodesMaintenance: number;
  nodesAvailable: number;
  nodesErrors: number;
}

interface DashboardResponse {
  success: boolean;
  data?: DashboardStats;
  message?: string;
}

interface NodeInfo {
  name: string;
  state?: string; // generalized state (e.g. idle, alloc, down)
  slurmState?: string; // raw Slurm state string
  cpus?: number;
  gres?: string;
  reason?: string;
}

// Local UI job status type (aligned with Jobs.tsx)
type UiJobStatus = 'running' | 'queued' | 'completed' | 'failed' | 'cancelled' | 'unknown';

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState<number>(0); // Nuevo estado para forzar re-render de datos

  // Recent Jobs state loaded from real endpoints
  type RecentJob = { id: string; name: string; status: UiJobStatus; progress: number; user: string; time: string; ts: number };
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);

  const fetchDashboardData = useCallback(async (opts?: { manual?: boolean }) => {
    // If this call was triggered manually by the user, show the button spinner.
    if (opts && opts.manual) setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/dashboard/stats', { credentials: 'same-origin' });
      if (!res.ok) {
        const text = await res.text();
        // Truncar y limpiar HTML si es necesario
        const clean = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        throw new Error(clean ? clean.slice(0, 300) : `HTTP ${res.status}`);
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const text = await res.text();
        const clean = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        throw new Error(clean ? `Server returned non-JSON response: ${clean.slice(0,300)}` : 'Server returned non-JSON response');
      }

      let body: DashboardResponse;
      try {
        body = await res.json();
      } catch (e) {
        const text = await res.text();
        throw new Error(`Failed to parse JSON response from server: ${text.slice(0,300)}`);
      }
      if (!body.success) throw new Error(body.message || 'Error fetching dashboard data');
      if (!body.data) throw new Error('No data in dashboard response');
      setDashboardStats(body.data);
      setDataVersion(prev => prev + 1); // Incrementar la versión para forzar la animación
    } catch (err: any) {
      setError(err.message || 'Error connecting to server');
      setDashboardStats(null);
    } finally {
      if (opts && opts.manual) setIsLoading(false);
    }
  }, []);

  // Map raw Slurm state to UI categories
  const mapSlurmToUi = (s?: string | null): UiJobStatus => {
    const v = (s || '').toString().toUpperCase();
    // use includes to tolerate suffixes like CANCELLED+ or prefixes/suffixes
    if (v.includes('RUNNING')) return 'running';
    if (v.includes('PENDING') || v.includes('CONFIGURING') || v.includes('REQUEUED')) return 'queued';
    if (v.includes('COMPLETED')) return 'completed';
    if (v.includes('CANCELLED')) return 'cancelled';
    if (v.includes('FAILED') || v.includes('TIMEOUT')) return 'failed';
    return 'unknown';
  };

  const parseSlurmDate = (s?: string | null): number => {
    if (!s) return 0;
    // Accept ISO-like from sacct/squeue when available
    const t = Date.parse(s);
    return isNaN(t) ? 0 : t;
  };

  const fetchRecentJobs = useCallback(async () => {
    try {
      // Live jobs (squeue)
      const liveRes = await fetch('/api/v1/user/jobs', { credentials: 'include' });
      let live: RecentJob[] = [];
      if (liveRes.ok) {
        const body = await liveRes.json().catch(() => ({}));
        const jobs = Array.isArray(body?.jobs) ? body.jobs : [];
        live = jobs.map((j: any) => ({
          id: String(j.id ?? ''),
          name: String(j.name ?? '—'),
          status: mapSlurmToUi(j.status),
          progress: typeof j.progress === 'number' ? j.progress : 0,
          user: String(j.user ?? ''),
          time: j.startTime && j.startTime !== '-' ? `Inicio: ${j.startTime}` : 'En ejecución',
          ts: parseSlurmDate(j.startTime) || Date.now()
        }));
      }

      // History (sacct) - latest finished/past jobs
      const histRes = await fetch('/api/v1/user/history?limit=10', { credentials: 'include' });
      let hist: RecentJob[] = [];
      if (histRes.ok) {
        const arr = await histRes.json().catch(() => []);
        if (Array.isArray(arr)) {
          hist = arr.map((h: any) => {
            const ui = mapSlurmToUi(h.status);
            const endTs = parseSlurmDate(h.end_time);
            const startTs = parseSlurmDate(h.start_time);
            const submitTs = parseSlurmDate(h.submit_time);
            const ts = endTs || startTs || submitTs || 0;
            let time = '—';
            if (ui === 'completed') time = h.end_time ? `Fin: ${h.end_time}` : (h.duration ? `Duración: ${h.duration}` : 'Completado');
            else if (ui === 'failed') time = h.end_time ? `Fin: ${h.end_time}` : 'Con errores';
            else time = h.start_time ? `Inicio: ${h.start_time}` : (h.submit_time ? `Submit: ${h.submit_time}` : '—');
            return {
              id: String(h.id ?? ''),
              name: String(h.name ?? '—'),
              status: ui,
              progress: ui === 'completed' ? 100 : 0,
              user: String(h.user ?? ''),
              time,
              ts
            } as RecentJob;
          });
        }
      }

      // Merge live + history, dedupe by id (prefer live), sort by time desc, keep top 5
      const byId = new Map<string, RecentJob>();
      for (const j of hist) if (j.id) byId.set(j.id, j);
      for (const j of live) if (j.id) byId.set(j.id, j); // live overwrites
      const merged = Array.from(byId.values()).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 5);
      setRecentJobs(merged);
    } catch (e) {
      // keep existing recentJobs on error
    }
  }, []);

    // Automatic background polling: run dashboard refresh every 5s in background.
    // We keep this fetch background (manual flag = false) so the header button
    // animation only appears on explicit user clicks.
    useEffect(() => {
      if (!user) return;
      // Fetch immediately when the dashboard mounts or when `user` becomes available
      // so the UI doesn't wait for the first 5s interval tick.
      fetchDashboardData({ manual: false });
      fetchRecentJobs();
      const id = setInterval(() => {
        fetchDashboardData({ manual: false });
        fetchRecentJobs();
      }, 5000);
      return () => clearInterval(id);
    }, [user, fetchDashboardData, fetchRecentJobs]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "running":
        return <Badge className="bg-primary text-primary-foreground"><Play className="w-3 h-3 mr-1" />Ejecutando</Badge>;
      case "queued":
        return <Badge variant="secondary"><Pause className="w-3 h-3 mr-1" />En Cola</Badge>;
      case "cancelled":
        return <Badge className="bg-amber-500/10 text-amber-600"><AlertTriangle className="w-3 h-3 mr-1" />Cancelado</Badge>;
      case "completed":
        return <Badge className="bg-success text-success-foreground"><CheckCircle className="w-3 h-3 mr-1" />Completado</Badge>;
      case "failed":
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Error</Badge>;
      default:
        return <Badge variant="outline">Desconocido</Badge>;
    }
  };

  // Nodes / Slurm modal state and fetch
  const [nodesDialogOpen, setNodesDialogOpen] = useState(false);
  const [nodes, setNodes] = useState<NodeInfo[] | null>(null);
  const [nodesLoading, setNodesLoading] = useState(false);
  const [nodesError, setNodesError] = useState<string | null>(null);

  const getNodeBadge = (node: NodeInfo) => {
    // Normalize: accept many possible property names and trim
    const raw = (node.slurmState || node.state || (node as any).State || (node as any).SLURM_STATE || '').toString().trim();
    const state = raw.toLowerCase();
    if (state.includes('idle')) return <Badge className="bg-success text-success-foreground">Idle</Badge>;
    if (state.includes('alloc') || state.includes('allocated')) return <Badge className="bg-primary text-primary-foreground">Allocated</Badge>;
    if (state.includes('down')) return <Badge variant="destructive">Down</Badge>;
    if (state.includes('drain')) return <Badge className="bg-warning text-warning-foreground">Drained</Badge>;
    if (state.includes('mix')) return <Badge className="bg-amber-500/10 text-amber-600">Mixed</Badge>;
    if (state) return <Badge variant="outline">{raw}</Badge>;
    return <Badge variant="secondary">Desconocido</Badge>;
  };

  const fetchNodes = useCallback(async () => {
    setNodesLoading(true);
    setNodesError(null);
    try {
      // Prefer the explicit admin-only nodes endpoint if available; fall back to stats which may include computeNodes
      let res = await fetch('/api/v1/dashboard/nodes', { credentials: 'same-origin' });
      if (!res.ok) {
        // If /nodes is not available, try /stats as fallback
        res = await fetch('/api/v1/dashboard/stats', { credentials: 'same-origin' });
      }
      if (!res.ok) {
        const text = await res.text();
        const clean = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        throw new Error(clean ? clean.slice(0, 300) : `HTTP ${res.status}`);
      }
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const text = await res.text();
        const clean = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        throw new Error(clean ? `Server returned non-JSON response: ${clean.slice(0,300)}` : 'Server returned non-JSON response');
      }
      const body = await res.json().catch(async () => { const t = await res.text(); throw new Error(`Invalid JSON: ${t.slice(0,300)}`); });
      // body expected: { success: boolean, data: { computeNodes?: [...], storageNode?: {...}, ... } }
      if (!body) throw new Error('Empty response body');
      const data = body.data || body;
      let found: NodeInfo[] = [];

      if (data && Array.isArray(data.computeNodes) && data.computeNodes.length > 0) {
        found = data.computeNodes.map((p: any) => ({
          name: p.node || p.nodeName || p.name || String(p.node || p.nodeName || p.name),
          // normalize multiple possible keys for the slurm state
          slurmState: p.state || p.slurmState || p.State || p.SLURM_STATE || undefined,
          state: p.state || p.State || p.slurmState || undefined,
          cpus: typeof p.cpuTot === 'number' ? p.cpuTot : (typeof p.cpus === 'number' ? p.cpus : undefined),
          gres: p.Gres || p.gres || undefined,
          reason: p.reason || undefined
        }));
      }

      if ((!found || found.length === 0) && data && data.storageNode) {
        const s = data.storageNode;
        found = [{ name: s.node || s.nodeName || 'storage', slurmState: s.state || s.State || undefined, cpus: s.cpuTot || undefined }];
      }

      // Some deployments might include a simple 'nodes' array
      if ((!found || found.length === 0) && data && Array.isArray(data.nodes)) {
        found = data.nodes.map((n: any) => ({ name: n.name || n.node || n.hostname, slurmState: n.state || n.slurmState || n.State || undefined, cpus: n.cpus }));
      }

      if (found && found.length > 0) {
        setNodes(found as NodeInfo[]);
      } else {
        // No per-node details available; surface a friendly message (but keep numeric totals)
        throw new Error('No per-node details in /api/v1/dashboard/stats response (admin-only endpoint may be required)');
      }
    } catch (err: any) {
      const raw = err.message || 'Error fetching nodes';
      // Friendly handling for common dev-server text like "Cannot GET /api/..."
      if (/Cannot GET/i.test(raw)) {
        setNodesError(`El endpoint '/api/v1/dashboard/nodes' no está disponible en el servidor. Respuesta: ${raw}`);
      } else {
        setNodesError(raw);
      }
      setNodes(null);
    } finally {
      setNodesLoading(false);
    }
  }, []);

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="animate-fade-in-up flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gradient flex items-center gap-3">
              {/* Atrox logo (placeholder.png) on brand blue, larger on dashboard */}
              <span className="h-10 w-10 rounded bg-primary text-primary-foreground inline-flex items-center justify-center">
                <img src="/placeholder.png" alt="Atrox" className="h-7 w-7" />
              </span>
              Dashboard de Control
            </h1>
            <p className="text-muted-foreground mt-2">
              Monitoreo en tiempo real de la supercomputadora Leo Atrox
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => fetchDashboardData({ manual: true })} disabled={isLoading} variant="outline" aria-live="polite" className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 mr-2" />
              <span>{isLoading ? 'Actualizando...' : 'Actualizar'}</span>
            </Button>

            <Button variant="outline" onClick={() => { setNodesDialogOpen(true); fetchNodes(); }} title="Ver nodos" className="flex items-center gap-2">
              <Server className="h-4 w-4" />
              <span className="text-sm">Estado Nodos</span>
            </Button>
          </div>
        </div>

        {error && (
          <div className="text-red-500 font-medium p-4 border border-red-500 bg-red-500/10 rounded-lg">🚨 Error: {error}</div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 animate-fade-in-up delay-100">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Trabajos Totales</CardTitle>
              <Activity className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-4">
                <div key={dataVersion} className="text-2xl font-bold animate-data-fade-in whitespace-nowrap">{dashboardStats ? dashboardStats.totalJobs : '—'}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">En Ejecución</CardTitle>
              <TrendingUp className="h-4 w-4 text-success" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-4">
                <div key={dataVersion + 1} className="text-2xl font-bold text-success animate-data-fade-in whitespace-nowrap">{dashboardStats ? dashboardStats.runningJobs : '—'}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">En Espera</CardTitle>
              <Clock className="h-4 w-4 text-warning" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-4">
                <div key={dataVersion + 1} className="text-2xl font-bold animate-data-fade-in whitespace-nowrap text-warning">{dashboardStats ? dashboardStats.queuedJobs : '—'}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Usuarios Activos</CardTitle>
              <Users className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-4">
                <div key={dataVersion + 2} className="text-2xl font-bold animate-data-fade-in whitespace-nowrap text-primary">{dashboardStats ? dashboardStats.activeUsers : '—'}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Completados Hoy</CardTitle>
              <CheckCircle className="h-4 w-4 text-success" />
            </CardHeader>
            <CardContent>
                  <div key={dataVersion + 3} className="text-2xl font-bold animate-data-fade-in">{dashboardStats ? dashboardStats.completedToday : '—'}</div>
            </CardContent>
          </Card>
        </div>

        {/* Resource Usage */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in-up delay-200">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5 text-primary" />
                Uso de Recursos del Sistema
              </CardTitle>
              <CardDescription>
                Monitoreo en tiempo real de CPU, memoria y almacenamiento
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span>CPU</span>
                  <span key={dataVersion + 4} className="animate-data-fade-in">{dashboardStats ? `${dashboardStats.cpuUsage}%` : '—'}</span>
                </div>
                <Progress value={dashboardStats ? dashboardStats.cpuUsage : 0} className="h-2" />
              </div>
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span>Memoria RAM</span>
                  <span key={dataVersion + 5} className="animate-data-fade-in">{dashboardStats ? `${dashboardStats.memoryUsage}%` : '—'}</span>
                </div>
                <Progress value={dashboardStats ? dashboardStats.memoryUsage : 0} className="h-2" />
              </div>
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span>Almacenamiento</span>
                  <span key={dataVersion + 6} className="animate-data-fade-in">{dashboardStats && typeof dashboardStats.storageUsage === 'number' ? `${dashboardStats.storageUsage}%` : '—'}</span>
                </div>
                <Progress value={dashboardStats && typeof dashboardStats.storageUsage === 'number' ? dashboardStats.storageUsage : 0} className="h-2" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Estado de Nodos</CardTitle>
              <CardDescription>
                Disponibilidad y estado de los nodos del cluster
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-4 bg-primary/10 rounded-lg">
                  <div key={dataVersion + 7} className="text-2xl font-bold text-primary animate-data-fade-in">{dashboardStats ? dashboardStats.nodesActive : '—'}</div>
                  <div className="text-sm text-muted-foreground">Nodos Activos</div>
                </div>
                <div className="text-center p-4 bg-warning/10 rounded-lg">
                  <div key={dataVersion + 8} className="text-2xl font-bold text-warning animate-data-fade-in">{dashboardStats ? dashboardStats.nodesMaintenance : '—'}</div>
                  <div className="text-sm text-muted-foreground">En Mantenimiento</div>
                </div>
                <div className="text-center p-4 bg-success/10 rounded-lg">
                  <div key={dataVersion + 9} className="text-2xl font-bold text-success animate-data-fade-in">{dashboardStats ? dashboardStats.nodesAvailable : '—'}</div>
                  <div className="text-sm text-muted-foreground">Disponibles</div>
                </div>
                <div className="text-center p-4 bg-destructive/10 rounded-lg">
                  <div key={dataVersion + 10} className="text-2xl font-bold text-destructive animate-data-fade-in">{dashboardStats ? dashboardStats.nodesErrors : '—'}</div>
                  <div className="text-sm text-muted-foreground">Con Errores</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent Jobs */}
        {/* Nodes modal (Slurm details) */}
        <Dialog open={nodesDialogOpen} onOpenChange={setNodesDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nodos (Slurm)</DialogTitle>
              <DialogDescription>Detalles por nodo y estado reportado por Slurm</DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              {nodesLoading && (
                <div className="flex justify-center p-6">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              )}

              {nodesError && (
                <div className="text-red-500 font-medium p-3 border border-red-300 bg-red-500/10 rounded">Error: {nodesError}</div>
              )}

              {!nodesLoading && !nodesError && nodes && nodes.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto">
                  {nodes.map((n) => (
                    <div key={n.name} className="p-3 border border-border rounded flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{n.name}</span>
                          {getNodeBadge(n)}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 truncate">
                          {((n.slurmState || n.state || (n as any).State || (n as any).SLURM_STATE) ? (
                            <span className="mr-2">Slurm: {(n.slurmState || n.state || (n as any).State || (n as any).SLURM_STATE)}</span>
                          ) : null)}
                          {typeof n.cpus === 'number' && <span className="mr-2">CPUs: {n.cpus}</span>}
                          {n.gres && <span>GRes: {n.gres}</span>}
                        </div>
                        {n.reason && <div className="text-xs text-muted-foreground mt-1">Reason: {n.reason}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!nodesLoading && !nodesError && (!nodes || nodes.length === 0) && (
                <div className="text-sm text-muted-foreground">
                  No hay detalles por nodo disponibles. Puedes comprobar los totales:
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="p-2 bg-success/10 rounded"><div className="font-semibold">Activos</div><div className="text-lg font-bold">{dashboardStats ? dashboardStats.nodesActive : '—'}</div></div>
                    <div className="p-2 bg-warning/10 rounded"><div className="font-semibold">Mantenimiento</div><div className="text-lg font-bold">{dashboardStats ? dashboardStats.nodesMaintenance : '—'}</div></div>
                    <div className="p-2 bg-muted/50 rounded"><div className="font-semibold">Disponibles</div><div className="text-lg font-bold">{dashboardStats ? dashboardStats.nodesAvailable : '—'}</div></div>
                    <div className="p-2 bg-destructive/10 rounded"><div className="font-semibold">Errores</div><div className="text-lg font-bold">{dashboardStats ? dashboardStats.nodesErrors : '—'}</div></div>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => { fetchNodes(); }}>Reintentar</Button>
              <Button variant="outline" onClick={() => setNodesDialogOpen(false)}>Cerrar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Card className="animate-fade-in-up delay-300">
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-primary" />
                  Trabajos Recientes
                </CardTitle>
                <CardDescription>
                  Últimos trabajos enviados al sistema
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => navigate('/history') }>
                Ver Todos
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentJobs.length === 0 ? (
                <div className="text-sm text-muted-foreground">No hay trabajos recientes.</div>
              ) : (
                recentJobs.map((job) => (
                  <div key={job.id} className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-accent/50 transition-colors">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h4 className="font-medium">{job.name}</h4>
                        {getStatusBadge(job.status)}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span>Usuario: {job.user}</span>
                        <span>Tiempo: {job.time}</span>
                        <span>ID: {job.id}</span>
                      </div>
                      {job.status === 'running' && (
                        <div className="mt-2">
                          <div className="flex justify-between text-xs mb-1">
                            <span>Progreso</span>
                            <span>{job.progress}%</span>
                          </div>
                          <Progress value={job.progress} className="h-1" />
                        </div>
                      )}
                    </div>
                    <Button variant="ghost" size="sm">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* AdminPanel removed */}
    </Layout>
  );
};

export default Dashboard;
