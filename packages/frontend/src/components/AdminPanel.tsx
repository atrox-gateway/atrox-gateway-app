import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { UserPlus, Trash2, Edit, Shield, User as UserIcon } from 'lucide-react';

interface User {
  user: string;
  defaultAccount: string;
  adminLevel: string;
}

export function AdminPanel() {
  const [users, setUsers] = useState<User[]>([]);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isModifyDialogOpen, setIsModifyDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<string>('');
  const [newUser, setNewUser] = useState({ username: '', password: '', account: 'default' });
  const [modifyData, setModifyData] = useState({ attribute: '', value: '' });
  const { toast } = useToast();

  // Simular carga de usuarios
  const fetchUsers = async () => {
    try {
      // En producción, esto sería: const response = await fetch('/admin/users');
      // Para demo, usamos datos mock
      const mockUsers: User[] = [
        { user: 'admin', defaultAccount: 'admin_account', adminLevel: 'Administrator' },
        { user: 'user1', defaultAccount: 'default', adminLevel: 'None' },
        { user: 'researcher1', defaultAccount: 'research', adminLevel: 'None' },
      ];
      setUsers(mockUsers);
      toast({
        title: "Usuarios cargados",
        description: `${mockUsers.length} usuarios encontrados`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudieron cargar los usuarios",
      });
    }
  };

  const createUser = async () => {
    if (!newUser.username || !newUser.password) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Usuario y contraseña son requeridos",
      });
      return;
    }

    try {
      // En producción: await fetch('/admin/users', { method: 'POST', body: JSON.stringify(newUser) });
      toast({
        title: "Usuario creado",
        description: `Usuario ${newUser.username} creado exitosamente`,
      });
      setNewUser({ username: '', password: '', account: 'default' });
      setIsCreateDialogOpen(false);
      fetchUsers();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudo crear el usuario",
      });
    }
  };

  const deleteUser = async (username: string) => {
    if (!confirm(`¿Estás seguro de eliminar al usuario ${username}?`)) return;

    try {
      // En producción: await fetch(`/admin/users/${username}`, { method: 'DELETE' });
      toast({
        title: "Usuario eliminado",
        description: `Usuario ${username} eliminado exitosamente`,
      });
      fetchUsers();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudo eliminar el usuario",
      });
    }
  };

  const modifyUser = async () => {
    if (!modifyData.attribute || !modifyData.value) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Atributo y valor son requeridos",
      });
      return;
    }

    try {
      // En producción: await fetch(`/admin/users/${selectedUser}`, { method: 'PUT', body: JSON.stringify(modifyData) });
      toast({
        title: "Usuario modificado",
        description: `Usuario ${selectedUser} actualizado exitosamente`,
      });
      setModifyData({ attribute: '', value: '' });
      setIsModifyDialogOpen(false);
      fetchUsers();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudo modificar el usuario",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Panel de Administración
            </CardTitle>
            <CardDescription>
              Gestiona usuarios del sistema SLURM
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button onClick={fetchUsers} variant="outline">
              Recargar
            </Button>
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Crear Usuario
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Crear Nuevo Usuario</DialogTitle>
                  <DialogDescription>
                    Añade un nuevo usuario al sistema SLURM
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="username">Nombre de Usuario</Label>
                    <Input
                      id="username"
                      value={newUser.username}
                      onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                      placeholder="usuario123"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Contraseña</Label>
                    <Input
                      id="password"
                      type="password"
                      value={newUser.password}
                      onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                      placeholder="••••••••"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="account">Cuenta SLURM</Label>
                    <Input
                      id="account"
                      value={newUser.account}
                      onChange={(e) => setNewUser({ ...newUser, account: e.target.value })}
                      placeholder="default"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Cancelar
                  </Button>
                  <Button onClick={createUser}>Crear Usuario</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Usuario</TableHead>
              <TableHead>Cuenta</TableHead>
              <TableHead>Nivel Admin</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  No hay usuarios. Click en "Recargar" para cargar la lista.
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.user}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {user.adminLevel === 'Administrator' ? (
                        <Shield className="h-4 w-4 text-primary" />
                      ) : (
                        <UserIcon className="h-4 w-4 text-muted-foreground" />
                      )}
                      {user.user}
                    </div>
                  </TableCell>
                  <TableCell>{user.defaultAccount}</TableCell>
                  <TableCell>
                    <Badge variant={user.adminLevel === 'Administrator' ? 'default' : 'secondary'}>
                      {user.adminLevel}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Dialog open={isModifyDialogOpen && selectedUser === user.user} onOpenChange={(open) => {
                        setIsModifyDialogOpen(open);
                        if (open) setSelectedUser(user.user);
                      }}>
                        <DialogTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <Edit className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Modificar Usuario</DialogTitle>
                            <DialogDescription>
                              Actualiza los atributos de {selectedUser}
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <Label htmlFor="attribute">Atributo</Label>
                              <Select 
                                value={modifyData.attribute}
                                onValueChange={(value) => setModifyData({ ...modifyData, attribute: value })}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Selecciona un atributo" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="AdminLevel">Nivel de Admin</SelectItem>
                                  <SelectItem value="DefaultAccount">Cuenta por Defecto</SelectItem>
                                  <SelectItem value="MaxJobs">Máximo de Trabajos</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="value">Valor</Label>
                              <Input
                                id="value"
                                value={modifyData.value}
                                onChange={(e) => setModifyData({ ...modifyData, value: e.target.value })}
                                placeholder="Nuevo valor"
                              />
                            </div>
                          </div>
                          <DialogFooter>
                            <Button variant="outline" onClick={() => setIsModifyDialogOpen(false)}>
                              Cancelar
                            </Button>
                            <Button onClick={modifyUser}>Modificar</Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => deleteUser(user.user)}
                        disabled={user.adminLevel === 'Administrator'}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
