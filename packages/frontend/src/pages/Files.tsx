import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/use-toast";
import { Textarea } from "@/components/ui/textarea";
import {
  Folder,
  File,
  Upload,
  Download,
  Search,
  MoreHorizontal,
  ArrowLeft,
  Grid,
  List,
  Loader2,
  Edit3,
  Trash
} from "lucide-react";
import { Layout } from "../components/Layout"; // Corregido: Uso de ruta relativa
import { useAuth } from "../contexts/AuthContext"; // Corregido: Uso de ruta relativa

interface FileItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  size: string;
  modified: string;
  extension?: string;
  owner: string;
  group: string;
  permissions: string;
}

interface FileResponse {
    success: boolean;
    path: string;
    files: FileItem[];
}

const getFileTypeColor = (extension?: string) => {
    const ext = extension?.toLowerCase();
    switch (ext) {
      // Scripting / interpreted
      case 'py': return 'bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400';
      case 'sh': return 'bg-green-500/10 text-green-600 dark:bg-green-500/20 dark:text-green-400';
      case 'rb': return 'bg-pink-500/10 text-pink-600 dark:bg-pink-500/20 dark:text-pink-400';

      // JavaScript / TypeScript
      case 'js':
      case 'mjs':
      case 'cjs':
      case 'jsx': return 'bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400';
      case 'ts':
      case 'tsx': return 'bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400';

      // Data / config
      case 'json': return 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400';
      case 'csv': return 'bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400';
      case 'yml':
      case 'yaml': return 'bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400';

      // Markup / text
      case 'md': return 'bg-slate-500/10 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200';
      case 'txt': return 'bg-muted/10 text-muted-foreground dark:bg-muted/20 dark:text-muted-foreground';
      case 'html': return 'bg-rose-500/10 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400';
      case 'css': return 'bg-cyan-500/10 text-cyan-600 dark:bg-cyan-500/20 dark:text-cyan-400';

      // Images
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'svg': return 'bg-pink-500/10 text-pink-600 dark:bg-pink-500/20 dark:text-pink-400';

      // Documents
      case 'pdf': return 'bg-red-500/10 text-red-600 dark:bg-red-500/20 dark:text-red-400';
      case 'doc':
      case 'docx': return 'bg-violet-500/10 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400';

      // Archives / binaries
      case 'zip':
      case 'gz':
      case 'tgz':
      case 'tar':
      case 'rar': return 'bg-gray-500/10 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400';

      // Common compiled / language files
      case 'java': return 'bg-red-500/10 text-red-600 dark:bg-red-500/20 dark:text-red-400';
      case 'go': return 'bg-teal-500/10 text-teal-600 dark:bg-teal-500/20 dark:text-teal-400';
      case 'rs': return 'bg-yellow-600/10 text-yellow-700 dark:bg-yellow-600/20 dark:text-yellow-300';
      case 'c':
      case 'cpp':
      case 'h':
      case 'hpp': return 'bg-sky-500/10 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400';

      // Notebooks / scientific
      case 'ipynb': return 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400';
      case 'r':
      case 'rmd': return 'bg-rose-500/10 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400';

      // Fallback: respects theme tokens
      default: return 'bg-muted/10 text-muted-foreground dark:bg-muted/20 dark:text-muted-foreground';
    }
};

const getFileIcon = (type: string, extension?: string) => {
    if (type === 'folder') {
      return <Folder className="h-5 w-5 text-primary" />;
    }
    return <File className="h-5 w-5 text-muted-foreground" />;
};

const Files = () => {
  const { isAuthenticated, user } = useAuth();

  const username = user?.username || 'unknown';
  const USER_HOME_PATH = `/hpc-home/${username}`;
  const isAdmin = user?.role === 'admin';

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [currentPath, setCurrentPath] = useState(USER_HOME_PATH);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Dialog / modal state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createContent, setCreateContent] = useState('');

  // Folder creation state
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [createFolderName, setCreateFolderName] = useState('');

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editFilePath, setEditFilePath] = useState('');
  const [editFileName, setEditFileName] = useState('');
  const [editContent, setEditContent] = useState('');

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTargetFilePath, setDeleteTargetFilePath] = useState('');
  const [deleteTargetFileName, setDeleteTargetFileName] = useState('');
  const location = useLocation();

  const fetchFiles = useCallback(async (path: string) => {
    if (!isAuthenticated || !user) return;

    let validatedPath = path;

    if (path === "/"){
      validatedPath = "/hpc-home/";
    }

    // Lógica de restricción de Frontend
    if (!isAdmin && !path.startsWith(USER_HOME_PATH)) {
        validatedPath = USER_HOME_PATH;
    }

    setIsLoading(true);
    setError(null);
    try {
  const response = await fetch(`/api/v1/user/files?path=${encodeURIComponent(validatedPath)}`);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Error al cargar archivos (Status: ${response.status})`);
      }

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
         throw new Error("Respuesta inesperada: No es formato JSON.");
      }

      const responseData: FileResponse = await response.json();

      if (responseData.success) {
          setFiles(responseData.files);
          setCurrentPath(responseData.path);
      } else {
          throw new Error(`Fallo del API: ${responseData.path || 'Error desconocido.'}`);
      }

    } catch (err: any) {
      setError(err.message || "Fallo la conexión con el servidor.");
      setFiles([]);
      // Si hay un error, forzamos la ruta visible a la última válida o al home
      if (validatedPath !== currentPath) setCurrentPath(validatedPath);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, user, isAdmin, USER_HOME_PATH]);

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    const params = new URLSearchParams(location.search);
    const p = params.get('path');
    if (p && typeof p === 'string') {
      fetchFiles(p);
    } else {
      fetchFiles(currentPath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchFiles, isAuthenticated, user, location.search]);

  const handleNavigation = (name: string, type: 'file' | 'folder') => {
    if (type === 'folder') {
        let newPath = currentPath.endsWith('/') ? `${currentPath}${name}` : `${currentPath}/${name}`;
        fetchFiles(newPath);
    } else {
        // Open file for viewing/editing
        const filePath = currentPath.endsWith('/') ? `${currentPath}${name}` : `${currentPath}/${name}`;
        openFileForEdit(filePath, name);
    }
  };

  const base64ToUtf8 = (b64: string) => {
    try {
      return decodeURIComponent(escape(atob(b64)));
    } catch (e) {
      // Fallback: return raw atob
      return atob(b64);
    }
  }

  const utf8ToBase64 = (str: string) => {
    try {
      return btoa(unescape(encodeURIComponent(str)));
    } catch (e) {
      return btoa(str);
    }
  }

  const openFileForEdit = async (filePath: string, displayName: string) => {
    setIsLoading(true);
    try {
      const resp = await fetch(`/api/v1/user/file?path=${encodeURIComponent(filePath)}`);
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || `Error: ${resp.status}`);
      }
      const data = await resp.json();
      if (!data.success) throw new Error(data.message || 'Failed to read file');
      if (data.isBinary) {
        // trigger download for binary
        const blob = b64toBlob(data.contentBase64);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = displayName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast({ title: 'Descarga iniciada', description: `${displayName} se está descargando.` });
      } else {
        const text = base64ToUtf8(data.contentBase64);
        setEditFilePath(filePath);
        setEditFileName(displayName);
        setEditContent(text);
        setEditDialogOpen(true);
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Error leyendo archivo' });
    } finally {
      setIsLoading(false);
    }
  }

  const downloadFile = async (filePath: string, displayName: string) => {
    setIsLoading(true);
    try {
      const resp = await fetch(`/api/v1/user/file?path=${encodeURIComponent(filePath)}`);
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || `Error: ${resp.status}`);
      }
      const data = await resp.json();
      if (!data.success) throw new Error(data.message || 'Failed to read file');
      const blob = b64toBlob(data.contentBase64);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = displayName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Error descargando archivo' });
    } finally {
      setIsLoading(false);
    }
  }

  const b64toBlob = (b64Data: string, contentType = 'application/octet-stream', sliceSize = 512) => {
    const byteCharacters = atob(b64Data);
    const byteArrays = [];
    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
      const slice = byteCharacters.slice(offset, offset + sliceSize);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }
    return new Blob(byteArrays, { type: contentType });
  }

  const handleDelete = async (name: string) => {
    const filePath = currentPath.endsWith('/') ? `${currentPath}${name}` : `${currentPath}/${name}`;
    setDeleteTargetFileName(name);
    setDeleteTargetFilePath(filePath);
    setDeleteDialogOpen(true);
  }

  const confirmDelete = async () => {
    setIsLoading(true);
    try {
      const resp = await fetch(`/api/v1/user/file?path=${encodeURIComponent(deleteTargetFilePath)}`, { method: 'DELETE' });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || `Error: ${resp.status}`);
      }
      toast({ title: 'Eliminado', description: `${deleteTargetFileName} eliminado.` });
      setDeleteDialogOpen(false);
      fetchFiles(currentPath);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Error eliminando archivo' });
    } finally {
      setIsLoading(false);
    }
  }

  const handleCreateFile = () => {
    setCreateName('');
    setCreateContent('');
    setCreateDialogOpen(true);
  }

  const handleCreateFolder = () => {
    setCreateFolderName('');
    setCreateFolderDialogOpen(true);
  }

  const confirmCreate = async () => {
    if (!createName) return toast({ title: 'Nombre requerido', description: 'Introduce un nombre para el archivo.' });
    const filePath = currentPath.endsWith('/') ? `${currentPath}${createName}` : `${currentPath}/${createName}`;
    setIsLoading(true);
    try {
      const body = { path: filePath, contentBase64: utf8ToBase64(createContent || '') };
      const resp = await fetch('/api/v1/user/file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || `Error: ${resp.status}`);
      }
      toast({ title: 'Creado', description: `${createName} creado.` });
      setCreateDialogOpen(false);
      fetchFiles(currentPath);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Error creando archivo' });
    } finally {
      setIsLoading(false);
    }
  }

  const confirmCreateFolder = async () => {
    if (!createFolderName) return toast({ title: 'Nombre requerido', description: 'Introduce un nombre para la carpeta.' });
    const folderPath = currentPath.endsWith('/') ? `${currentPath}${createFolderName}` : `${currentPath}/${createFolderName}`;
    setIsLoading(true);
    try {
      // Assumption: backend exposes POST /api/v1/user/folder { path }
      const resp = await fetch('/api/v1/user/folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: folderPath }) });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || `Error: ${resp.status}`);
      }
      const data = await resp.json().catch(() => ({ success: true }));
      // If backend returns a JSON with success flag, respect it; otherwise assume success on 2xx
      if (data && typeof data.success !== 'undefined' && !data.success) {
        throw new Error(data.message || 'Error creando carpeta');
      }
      toast({ title: 'Carpeta creada', description: `${createFolderName} creada.` });
      setCreateFolderDialogOpen(false);
      fetchFiles(currentPath);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Error creando carpeta' });
    } finally {
      setIsLoading(false);
    }
  }

  const handleUploadClick = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  }

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    const toSend: Array<{ name: string; contentBase64: string }> = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      // Read as data URL to easily get base64
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(f);
      });
      const parts = dataUrl.split(',');
      const b64 = parts[1];
      toSend.push({ name: f.name, contentBase64: b64 });
    }
    setIsLoading(true);
    try {
      const resp = await fetch('/api/v1/user/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: currentPath, files: toSend }) });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || `Error: ${resp.status}`);
      }
      const data = await resp.json();
      if (data.success) {
        toast({ title: 'Subida completada', description: 'Archivos subidos correctamente.' });
        fetchFiles(currentPath);
      } else {
        throw new Error(data.message || 'Upload failed');
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Error subiendo archivos' });
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const saveEdit = async () => {
    setIsLoading(true);
    try {
      const body = { path: editFilePath, contentBase64: utf8ToBase64(editContent || '') };
      const resp = await fetch('/api/v1/user/file', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || `Error: ${resp.status}`);
      }
      toast({ title: 'Guardado', description: `${editFileName} actualizado.` });
      setEditDialogOpen(false);
      fetchFiles(currentPath);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Error guardando archivo' });
    } finally {
      setIsLoading(false);
    }
  }

  const handleGoBack = () => {
    const segments = currentPath.split('/').filter(s => s.length > 0);
    segments.pop();
    let parentPath = `/${segments.join('/')}`;

    if (parentPath === '' || (parentPath === '/hpc-home' && !isAdmin)) {
         parentPath = USER_HOME_PATH;
    }

    // Restricción final: si no es admin y retrocede fuera de su home, forzar al home
    if (!isAdmin && !parentPath.startsWith(USER_HOME_PATH)) {
         parentPath = USER_HOME_PATH;
    }

    fetchFiles(parentPath);
  }

  const filteredFiles = files
    .filter(item => item.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => {
      // Desired order: hidden files (name starts with '.' and is a file) -> folders -> regular files
      const aHiddenFile = a.name.startsWith('.') && a.type === 'file' ? 0 : 1;
      const bHiddenFile = b.name.startsWith('.') && b.type === 'file' ? 0 : 1;
      if (aHiddenFile !== bHiddenFile) return aHiddenFile - bHiddenFile;
      // folders next
      const aIsFolder = a.type === 'folder' ? 0 : 1;
      const bIsFolder = b.type === 'folder' ? 0 : 1;
      if (aIsFolder !== bIsFolder) return aIsFolder - bIsFolder;
      // finally by name (case-insensitive)
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center animate-fade-in-up">
          <div>
            <h1 className="text-3xl font-bold text-gradient">Gestión de Archivos</h1>
            <p className="text-muted-foreground mt-2">
              Administra scripts, datasets y resultados
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button className="btn-hero" onClick={handleCreateFile}>
              Nuevo archivo
            </Button>
            <Button className="btn-ghost btn-hero" onClick={handleCreateFolder}>
              Nueva carpeta
            </Button>
            <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileInput} />
            <Button className="btn-hero" onClick={handleUploadClick}>
              <Upload className="w-4 h-4 mr-2" />
              Subir Archivos
            </Button>
          </div>
        </div>

        <Card className="card-professional animate-fade-in-up delay-100">
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="flex items-center gap-2 flex-1">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleGoBack}
                    disabled={!isAdmin && currentPath === USER_HOME_PATH}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground">Ruta:</span>
                <span className="font-mono text-sm bg-muted/10 text-muted-foreground dark:bg-muted/20 dark:text-muted-foreground px-2 py-1 rounded truncate max-w-xs md:max-w-md">
                  {currentPath}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Buscar archivos..."
                        className="pl-8 w-[150px] md:w-[250px]"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <Button variant="outline" size="icon" onClick={() => setViewMode('list')} disabled={viewMode === 'list'}>
                    <List className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" onClick={() => setViewMode('grid')} disabled={viewMode === 'grid'}>
                    <Grid className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
        {/* Create file dialog */}
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Crear nuevo archivo</DialogTitle>
              <DialogDescription>Introduce el nombre (relativo a la ruta actual) y el contenido.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Input placeholder="nombre.txt" value={createName} onChange={(e) => setCreateName(e.target.value)} />
              <Textarea value={createContent} onChange={(e) => setCreateContent(e.target.value)} rows={10} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancelar</Button>
              <Button onClick={confirmCreate}>Crear</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Create folder dialog */}
        <Dialog open={createFolderDialogOpen} onOpenChange={setCreateFolderDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Crear nueva carpeta</DialogTitle>
              <DialogDescription>Introduce el nombre de la carpeta (relativo a la ruta actual).</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Input placeholder="mi_carpeta" value={createFolderName} onChange={(e) => setCreateFolderName(e.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateFolderDialogOpen(false)}>Cancelar</Button>
              <Button onClick={confirmCreateFolder}>Crear carpeta</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit file dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Editar {editFileName}</DialogTitle>
              <DialogDescription>Edita el contenido y guarda los cambios.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={16} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancelar</Button>
              <Button onClick={saveEdit}>Guardar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete confirmation (AlertDialog) */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Eliminar archivo</AlertDialogTitle>
              <AlertDialogDescription>¿Estás seguro que quieres eliminar {deleteTargetFileName}? Esta acción no se puede deshacer.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setDeleteDialogOpen(false)}>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={confirmDelete}>Eliminar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Card className="card-professional animate-fade-in-up delay-200">
          <CardHeader>
            <CardTitle>Contenido del Directorio</CardTitle>
            <CardDescription>
              {filteredFiles.length} elementos en {currentPath}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && <div className="text-red-500 font-medium p-4 border border-red-500 bg-red-500/10 rounded-lg">🚨 Error: {error}</div>}

            {isLoading && (
                <div className="flex justify-center p-8">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            )}

            {!isLoading && filteredFiles.length === 0 && !error && (
                <div className="text-center text-muted-foreground p-8">
                    {searchTerm ? `No hay resultados para "${searchTerm}".` : 'Directorio vacío.'}
                </div>
            )}

            {!isLoading && filteredFiles.length > 0 && viewMode === 'list' && (
              <div className="space-y-2">
                <div className="hidden md:grid grid-cols-[1fr_100px_100px_120px_40px] gap-4 text-sm font-semibold text-muted-foreground border-b pb-2 px-3">
                    <span className="col-span-1">Nombre</span>
                    <span>Propietario</span>
                    <span>Tamaño</span>
                    <span>Modificado</span>
                    <span className="sr-only">Acciones</span>
                </div>
                {filteredFiles.map((item) => (
                  <div
                    key={item.id}
                    className="grid grid-cols-[1fr_100px_100px_120px_40px] md:grid-cols-[1fr_100px_100px_120px_40px] gap-4 items-center p-3 border border-border rounded-lg hover:bg-accent/50 transition-colors cursor-pointer"
                    onClick={() => handleNavigation(item.name, item.type)}
                  >
                    <div className="flex items-center space-x-3 truncate">
                        {getFileIcon(item.type, item.extension)}
                        <span className="font-medium truncate">{item.name}</span>
                        {item.extension && item.type === 'file' && (
                            <Badge className={`text-xs ${getFileTypeColor(item.extension)} hidden sm:inline`}>
                                .{item.extension}
                            </Badge>
                        )}
                    </div>

                    <span className="text-sm text-muted-foreground hidden md:inline">{item.owner}</span>
                    <span className="text-sm text-muted-foreground hidden md:inline">{item.size}</span>
                    <span className="text-sm text-muted-foreground hidden md:inline">{item.modified}</span>

                    {/* Action menu (compact) */}
                    {(() => {
                      const filePath = currentPath.endsWith('/') ? `${currentPath}${item.name}` : `${currentPath}/${item.name}`;
                      return (
                        <div className="ml-auto">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" onClick={(e) => e.stopPropagation()}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              {item.type === 'file' && (
                                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); openFileForEdit(filePath, item.name); }}>Editar</DropdownMenuItem>
                              )}
                              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); downloadFile(filePath, item.name); }}>Descargar</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setDeleteTargetFileName(item.name); setDeleteTargetFilePath(filePath); setDeleteDialogOpen(true); }}>Eliminar</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}

      {!isLoading && filteredFiles.length > 0 && viewMode === 'grid' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filteredFiles.map((item) => {
            const filePath = currentPath.endsWith('/') ? `${currentPath}${item.name}` : `${currentPath}/${item.name}`;
            return (
              <div
                key={item.id}
                onClick={() => handleNavigation(item.name, item.type)}
                className="relative p-4 border border-border rounded-lg hover:shadow-md hover:bg-accent/50 transition-colors cursor-pointer"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3 min-w-0">
                    {getFileIcon(item.type, item.extension)}
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium truncate max-w-[12rem]">{item.name}</span>
                      <span className="text-xs text-muted-foreground hidden sm:block truncate max-w-[12rem]">{item.owner} • {item.size}</span>
                    </div>
                  </div>

                  <div onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {item.type === 'file' && (
                          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); openFileForEdit(filePath, item.name); }}>Editar</DropdownMenuItem>
                        )}
                        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); downloadFile(filePath, item.name); }}>Descargar</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setDeleteTargetFileName(item.name); setDeleteTargetFilePath(filePath); setDeleteDialogOpen(true); }}>Eliminar</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <div>
                    {item.type === 'folder' ? (
                      <Badge className="text-xs">Carpeta</Badge>
                    ) : (
                      item.extension && (
                        <Badge className={`text-xs ${getFileTypeColor(item.extension)}`}>.{item.extension}</Badge>
                      )
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{item.modified}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default Files;
