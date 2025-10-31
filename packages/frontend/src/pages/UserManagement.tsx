import { useState } from "react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { MoreHorizontal, PlusCircle, AlertTriangle } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { UserForm } from "@/components/UserForm";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// Interfaz para el objeto de usuario que recibimos de la API
interface User {
  user: string;
  defaultAccount: string;
  adminLevel: string;
}

// Función para obtener los usuarios desde el backend
const fetchUsers = async (): Promise<User[]> => {
  const response = await fetch('/api/v1/admin/users', { credentials: 'include' });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(errorData.message || 'Error al cargar los usuarios.');
  }
  const data = await response.json();
  return data.details;
};

// Función para crear un nuevo usuario
const createUser = async (userData: any) => {
  const response = await fetch('/api/v1/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userData),
    credentials: 'include',
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(errorData.message || 'Error al crear el usuario.');
  }
  return await response.json();
};

// Función para eliminar un usuario
const deleteUser = async (username: string) => {
  const response = await fetch(`/api/v1/admin/users/${username}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(errorData.message || 'Error al eliminar el usuario.');
  }
  return await response.json();
};

// Función para editar un usuario
const editUser = async ({ username, values }: { username: string; values: any }) => {
  const promises: Promise<Response>[] = [];
  // Solo se actualiza la contraseña si se proporciona una nueva
  if (values.password) {
    promises.push(fetch(`/api/v1/admin/users/${username}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attribute: 'password', value: values.password }),
      credentials: 'include',
    }));
  }
  if (values.account) {
    // Enviar el atributo que el script espera: 'account'
    promises.push(fetch(`/api/v1/admin/users/${username}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attribute: 'account', value: values.account }),
      credentials: 'include',
    }));
  }

  const responses = await Promise.all(promises);
  for (const res of responses) {
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(errorData.message || 'Error al actualizar el usuario.');
    }
  }
  return { success: true };
};

const UserManagement = () => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'users' | 'registrations'>('users');

  // Fetch registrations when needed
  const fetchRegistrations = async () => {
    const response = await fetch('/api/v1/admin/registrations', { credentials: 'include' });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(err.message || 'Error al cargar las solicitudes.');
    }
    const data = await response.json();
    return data.details as Array<{ username: string; email: string; createdAt: string }>;
  };

  const { data: registrations, refetch: refetchRegistrations, isLoading: regsLoading } = useQuery({
    queryKey: ['registrations'],
    queryFn: fetchRegistrations,
    enabled: activeTab === 'registrations',
  });

  const { data: users, isLoading, isError, error } = useQuery<User[], Error>({
    queryKey: ['users'],
    queryFn: fetchUsers,
  });

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [userToEdit, setUserToEdit] = useState<User | null>(null);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  // Dialog state for registration approve/deny
  const [regDialogOpen, setRegDialogOpen] = useState(false);
  const [regDialogAction, setRegDialogAction] = useState<'approve' | 'deny' | null>(null);
  const [regDialogUsername, setRegDialogUsername] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      toast.success('Usuario creado con éxito');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      handleFormClose();
    },
    onError: (error: Error) => {
      toast.error('Error al crear el usuario', {
        description: error.message,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      toast.success('Usuario eliminado con éxito');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setUserToDelete(null);
    },
    onError: (error: Error) => {
      toast.error('Error al eliminar el usuario', {
        description: error.message,
      });
      setUserToDelete(null);
    },
  });

  const editMutation = useMutation({
    mutationFn: editUser,
    onSuccess: () => {
      toast.success('Usuario actualizado con éxito');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      handleFormClose();
    },
    onError: (error: Error) => {
      toast.error('Error al actualizar el usuario', {
        description: error.message,
      });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (username: string) => {
      const res = await fetch(`/api/v1/admin/registrations/${username}/approve`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message || 'Error approving registration');
      }
      return await res.json();
    },
    onSuccess: () => {
      toast.success('Solicitud aprobada');
      queryClient.invalidateQueries({ queryKey: ['registrations'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: any) => {
      toast.error('Error aprobando solicitud: ' + (err?.message || ''));
    },
  });

  const denyMutation = useMutation({
    mutationFn: async (username: string) => {
      const res = await fetch(`/api/v1/admin/registrations/${username}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message || 'Error denying registration');
      }
      return await res.json();
    },
    onSuccess: () => {
      toast.success('Solicitud denegada y eliminada');
      queryClient.invalidateQueries({ queryKey: ['registrations'] });
    },
    onError: (err: any) => {
      toast.error('Error denegando solicitud: ' + (err?.message || ''));
    },
  });

  const handleAddUser = () => {
    setUserToEdit(null);
    setIsFormOpen(true);
  };

  const handleEditClick = (user: User) => {
    setUserToEdit(user);
    setIsFormOpen(true);
  };

  const handleFormClose = () => {
    setIsFormOpen(false);
    setUserToEdit(null);
  };

  const handleFormSubmit = (values: any) => {
    if (userToEdit) {
      editMutation.mutate({ username: userToEdit.user, values });
    } else {
      createMutation.mutate(values);
    }
  };

  const handleDeleteClick = (username: string) => {
    setUserToDelete(username);
  };

  const handleConfirmDelete = () => {
    if (userToDelete) {
      deleteMutation.mutate(userToDelete);
    }
  };

  // computed loading state for dialog confirm button
  const regDialogLoading = regDialogAction === 'approve' ? (approveMutation as any).isLoading : (denyMutation as any).isLoading;

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center animate-fade-in-up">
          <div>
            <h1 className="text-3xl font-bold text-gradient">Gestión de Usuarios</h1>
            <p className="text-muted-foreground mt-2">Administra los usuarios del sistema.</p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex rounded-md bg-muted p-1">
              <button
                className={`px-3 py-1 rounded ${activeTab === 'users' ? 'bg-background text-primary font-medium' : 'text-muted-foreground'}`}
                onClick={() => setActiveTab('users')}
              >
                Usuarios
              </button>
              <button
                className={`px-3 py-1 rounded ${activeTab === 'registrations' ? 'bg-background text-primary font-medium' : 'text-muted-foreground'}`}
                onClick={() => {
                  setActiveTab('registrations');
                  refetchRegistrations();
                }}
              >
                Solicitudes
              </button>
            </div>

            {activeTab === 'users' && (
              <Button onClick={handleAddUser}>
                <PlusCircle className="w-4 h-4 mr-2" />
                Añadir Usuario
              </Button>
            )}
          </div>
        </div>

        {activeTab === 'users' && (
          <Card className="card-professional animate-fade-in-up delay-100">
            <CardHeader>
              <CardTitle>Lista de Usuarios</CardTitle>
              <CardDescription>Usuarios registrados en el sistema.</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading && <p>Cargando usuarios...</p>}
              {isError && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>
                    No se pudieron cargar los usuarios. Por favor, inténtalo de nuevo.
                    <p className="text-xs mt-2">{(error as Error).message}</p>
                  </AlertDescription>
                </Alert>
              )}
              {users && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Usuario</TableHead>
                      <TableHead>Cuenta por Defecto</TableHead>
                      <TableHead>Nivel de Admin</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user) => (
                      <TableRow key={user.user}>
                        <TableCell className="font-medium">{user.user}</TableCell>
                        <TableCell>{user.defaultAccount}</TableCell>
                        <TableCell>
                          <Badge variant={user.adminLevel !== 'None' ? 'default' : 'secondary'}>
                            {user.adminLevel}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem onClick={() => handleEditClick(user)}>
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => handleDeleteClick(user.user)}
                              >
                                Eliminar
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === 'registrations' && (
          <Card className="card-professional animate-fade-in-up delay-100">
            <CardHeader>
              <CardTitle>Solicitudes de Registro</CardTitle>
              <CardDescription>Solicitudes pendientes de aprobación por el administrador.</CardDescription>
            </CardHeader>
            <CardContent>
              {regsLoading && <p>Cargando solicitudes...</p>}
              {!regsLoading && registrations && registrations.length === 0 && (
                <p>No hay solicitudes pendientes.</p>
              )}
              {registrations && registrations.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Usuario</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {registrations.map((r: any) => (
                      <TableRow key={r.username}>
                        <TableCell className="font-medium">{r.username}</TableCell>
                        <TableCell>{r.email}</TableCell>
                        <TableCell>{new Date(r.createdAt).toLocaleString()}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" onClick={async () => {
                              // open custom dialog for approve
                              setRegDialogAction('approve');
                              setRegDialogUsername(r.username);
                              setRegDialogOpen(true);
                            }}>Aprobar</Button>
                            <Button size="sm" variant="destructive" onClick={async () => {
                              // open custom dialog for deny
                              setRegDialogAction('deny');
                              setRegDialogUsername(r.username);
                              setRegDialogOpen(true);
                            }}>Denegar</Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <UserForm
        isOpen={isFormOpen}
        onClose={handleFormClose}
        onSubmit={handleFormSubmit}
        defaultValues={userToEdit ? { username: userToEdit.user, password: '', account: userToEdit.defaultAccount } : undefined}
        isEditing={!!userToEdit}
      />

      <AlertDialog open={!!userToDelete} onOpenChange={() => setUserToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Esto eliminará permanentemente al usuario
              <span className="font-bold"> {userToDelete}</span>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete}>
              Sí, eliminar usuario
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AlertDialog para confirmar aprobar/denegar solicitudes de registro */}
      <AlertDialog open={regDialogOpen} onOpenChange={() => setRegDialogOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {regDialogAction === 'approve' ? 'Aprobar solicitud' : 'Denegar solicitud'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {regDialogAction === 'approve' ? (
                <>¿Estás seguro que deseas aprobar la solicitud de <span className="font-bold">{regDialogUsername}</span>? Se creará la cuenta en el sistema.</>
              ) : (
                <>¿Estás seguro que deseas denegar la solicitud de <span className="font-bold">{regDialogUsername}</span>? Esto eliminará la solicitud.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setRegDialogOpen(false)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={regDialogLoading} onClick={async () => {
              if (!regDialogAction || !regDialogUsername) return;
              try {
                if (regDialogAction === 'approve') {
                  await approveMutation.mutateAsync(regDialogUsername);
                } else {
                  await denyMutation.mutateAsync(regDialogUsername);
                }
              } catch (e) {
                // mutations already handle toasts
              } finally {
                setRegDialogOpen(false);
                setRegDialogAction(null);
                setRegDialogUsername(null);
              }
            }}>
              {regDialogLoading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 border-2 border-current rounded-full animate-spin inline-block" />
                  Procesando...
                </span>
              ) : (
                (regDialogAction === 'approve' ? 'Sí, aprobar' : 'Sí, denegar')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
};

export default UserManagement;
