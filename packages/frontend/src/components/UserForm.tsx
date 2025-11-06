import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { useEffect } from "react";

const formSchema = z.object({
  username: z.string().min(3, "El nombre de usuario debe tener al menos 3 caracteres."),
  // Hacemos la contraseña opcional para el modo de edición
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres.").optional().or(z.literal('')),
  account: z.string().optional(),
});

interface UserFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (values: z.infer<typeof formSchema>) => void;
  defaultValues?: Partial<z.infer<typeof formSchema>>;
  isEditing?: boolean;
}

export const UserForm = ({ isOpen, onClose, onSubmit, defaultValues, isEditing }: UserFormProps) => {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { username: "", password: "", account: "default" },
  });

  useEffect(() => {
    if (isOpen) {
      if (defaultValues) {
        form.reset(defaultValues);
      } else {
        form.reset({ username: "", password: "", account: "default" });
      }
    }
  }, [isOpen, defaultValues, form]);

  const handleFormSubmit = (values: z.infer<typeof formSchema>) => {
    // No enviar la contraseña si está vacía en modo de edición
    if (isEditing && !values.password) {
      delete values.password;
    }
    onSubmit(values);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Editar Usuario" : "Añadir Nuevo Usuario"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre de Usuario</FormLabel>
                  <FormControl>
                    <Input placeholder="ej. jsmith" {...field} disabled={isEditing} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contraseña</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder={isEditing ? "Dejar en blanco para no cambiar" : ""} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="account"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cuenta (Opcional)</FormLabel>
                  <FormControl>
                    <Input placeholder="default" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  Cancelar
                </Button>
              </DialogClose>
              <Button type="submit">Guardar</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
