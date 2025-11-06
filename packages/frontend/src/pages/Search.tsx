import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Folder, File, Loader2, ArrowRight } from "lucide-react";

interface SearchItem {
  id: string;
  path: string;
  name: string;
  type: 'file' | 'folder';
}

const SearchPage = () => {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const initialQ = (params.get('q') || '').trim();
  const [q, setQ] = useState<string>(initialQ);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchItem[]>([]);

  const canSearch = useMemo(() => q.trim().length >= 2, [q]);

  const runSearch = async (query: string) => {
    if (!query || query.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/user/search?q=${encodeURIComponent(query.trim())}`, { credentials: 'include' });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `Error ${res.status}`);
      }
      const body = await res.json();
      if (!body?.success || !Array.isArray(body?.results)) throw new Error(body?.message || 'Respuesta inválida');
      setResults(body.results);
    } catch (e: any) {
      setError(e.message || 'Error realizando la búsqueda');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // If URL has q and local state differs, sync and search
    const urlQ = (params.get('q') || '').trim();
    if (urlQ !== q) {
      setQ(urlQ);
      if (urlQ.length >= 2) runSearch(urlQ);
    } else if (urlQ.length >= 2 && results.length === 0 && !loading) {
      runSearch(urlQ);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const openInFiles = (p: string) => {
    try {
      const folder = p.endsWith('/') ? p.slice(0, -1) : p;
      const segments = folder.split('/');
      segments.pop();
      const dir = segments.join('/') || '/';
      navigate(`/files?path=${encodeURIComponent(dir)}`);
    } catch {
      navigate('/files');
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Búsqueda</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Buscar archivos y carpetas</CardTitle>
            <CardDescription>Escribe al menos 2 caracteres para buscar dentro de tu carpeta de usuario</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Termino a buscar..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setParams({ q: q.trim() });
                    if (canSearch) runSearch(q);
                  }
                }}
                className="max-w-md"
              />
              <Button
                onClick={() => { setParams({ q: q.trim() }); if (canSearch) runSearch(q); }}
                disabled={!canSearch || loading}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Buscar'}
              </Button>
            </div>

            {error && (
              <div className="mt-4 text-red-500 text-sm">{error}</div>
            )}

            <div className="mt-6 space-y-2">
              {loading && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Buscando...
                </div>
              )}

              {!loading && results.length === 0 && q.trim().length >= 2 && !error && (
                <div className="text-sm text-muted-foreground">Sin resultados para “{q}”.</div>
              )}

              {!loading && results.length > 0 && (
                <div className="divide-y divide-border rounded-md border border-border">
                  {results.map((r) => (
                    <div key={r.id} className="p-3 flex items-center justify-between gap-4 hover:bg-accent/50">
                      <div className="min-w-0 flex items-center gap-3">
                        {r.type === 'folder' ? (
                          <Folder className="h-5 w-5 text-primary" />
                        ) : (
                          <File className="h-5 w-5 text-muted-foreground" />
                        )}
                        <div className="min-w-0">
                          <div className="font-medium truncate">{r.name}</div>
                          <div className="text-xs text-muted-foreground truncate">{r.path}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={r.type === 'folder' ? 'secondary' : 'outline'}>{r.type}</Badge>
                        <Button variant="ghost" onClick={() => openInFiles(r.path)} className="gap-1">
                          Abrir carpeta <ArrowRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default SearchPage;
