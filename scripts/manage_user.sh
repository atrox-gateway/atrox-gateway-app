#!/usr/bin/env bash
# /opt/atrox-gateway/scripts/manage_user.sh
# Script para gestionar usuarios de Linux y Slurm en ambas VMs

set -e

# --- Configuración ---
HPC_HOST="hpc-master"
SSH_USER="atroxgateway" # Usuario que tiene las llaves SSH para conectar al HPC
SSH_OPTS="-o StrictHostKeyChecking=no" # Opciones para SSH
UID_MIN=1003 # Empezamos después de vagrant (1000) y atroxgateway (1002)
UID_MAX=60000

# --- Funciones Auxiliares ---

# Encuentra el siguiente UID disponible en ambas máquinas
function get_next_uid() {
    local remote_last_uid local_last_uid highest_uid next_uid
    # --- LÍNEA CORREGIDA ---
    echo "Buscando el siguiente UID disponible en AMBAS máquinas..." >&2
    # --- FIN CORRECCIÓN ---
    remote_last_uid=$(sudo -u $SSH_USER ssh $SSH_OPTS ${SSH_USER}@$HPC_HOST "getent passwd | awk -F: '\$3 >= $UID_MIN && \$3 < $UID_MAX {print \$3}' | sort -n | tail -1")
    local_last_uid=$(getent passwd | awk -F: "\$3 >= $UID_MIN && \$3 < $UID_MAX {print \$3}" | sort -n | tail -1)
    highest_uid=$(echo -e "${remote_last_uid:-$((UID_MIN-1))}\n${local_last_uid:-$((UID_MIN-1))}" | sort -n | tail -1)
    next_uid=$((highest_uid + 1))
    echo "$next_uid" # Esta línea sí debe ir a stdout
}
# Ejecuta un comando remotamente en el HPC como SSH_USER
function remote_exec() {
    sudo -u $SSH_USER ssh $SSH_OPTS ${SSH_USER}@$HPC_HOST "$@"
}

# --- Procesamiento de Argumentos ---
ACTION=$1
USERNAME=$2
# Los argumentos adicionales dependen de la acción
PASSWORD=$3
ACCOUNT=$4
ADMIN_LEVEL=$5

# --- Lógica Principal ---
case "$ACTION" in
    create)
        if [ -z "$USERNAME" ] || [ -z "$PASSWORD" ]; then
            echo "Uso: $0 create <usuario> <contraseña> [cuenta_slurm]" >&2
            exit 1
        fi
        ACCOUNT=${ACCOUNT:-default} # Cuenta por defecto si no se especifica
        NEXT_UID=$(get_next_uid)

        echo "Creando usuario '$USERNAME' con UID '$NEXT_UID'..."
        # Crear en app
        sudo useradd -m -s /bin/bash -u $NEXT_UID $USERNAME && echo "$USERNAME:$PASSWORD" | sudo chpasswd
        sudo usermod -aG www-data $USERNAME # Importante para permisos del socket
        echo "-> Usuario creado en 'app'."
        # Crear en hpc-master
        remote_exec "sudo useradd -m -s /bin/bash -u $NEXT_UID $USERNAME && echo '$USERNAME:$PASSWORD' | sudo chpasswd"
        echo "-> Usuario creado en '$HPC_HOST'."
        # Añadir a Slurm
        remote_exec "sudo sacctmgr -i add user $USERNAME Account=$ACCOUNT"
        echo "-> Usuario añadido a la cuenta Slurm '$ACCOUNT'."
        echo "✅ Usuario '$USERNAME' creado exitosamente."
        ;;

    show)
        if [ -z "$USERNAME" ]; then echo "Uso: $0 show <usuario>" >&2; exit 1; fi
        echo "Detalles del usuario '$USERNAME':"
        echo "--- Usuario Linux (app) ---"
        getent passwd $USERNAME || echo "Usuario '$USERNAME' no encontrado localmente."
        echo "--- Usuario Linux (hpc-master) ---"
        remote_exec "getent passwd $USERNAME" || echo "Usuario '$USERNAME' no encontrado remotamente."
        echo "--- Información de Cuenta Slurm ---"
        remote_exec "sudo sacctmgr show user where name=$USERNAME withassoc format=User,Account,AdminLevel"
        ;;

    list)
        echo "--- Usuarios Registrados en Slurm ---"
        remote_exec "sudo sacctmgr show user format=User,DefaultAccount,AdminLevel --parsable2 --noheader"
        ;;

    modify)
        if [ -z "$USERNAME" ] || [ -z "$3" ] || [ -z "$4" ]; then
            echo "Uso: $0 modify <usuario> <atributo> <valor>" >&2
            echo "Atributos disponibles: password, account, adminlevel" >&2
            exit 1
        fi
        ATTRIBUTE=$3
        VALUE=$4

        case "$ATTRIBUTE" in
            password)
                echo "Actualizando contraseña para '$USERNAME'..."
                echo "$USERNAME:$VALUE" | sudo chpasswd
                echo "-> Contraseña actualizada en 'app'."
                remote_exec "echo '$USERNAME:$VALUE' | sudo chpasswd"
                echo "-> Contraseña actualizada en '$HPC_HOST'."
                echo "✅ Contraseña actualizada."
                ;;
            account)
                echo "Cambiando cuenta Slurm para '$USERNAME' a '$VALUE'..."
                remote_exec "sudo sacctmgr -i modify user where name=$USERNAME set DefaultAccount=$VALUE"
                echo "✅ Cuenta Slurm actualizada."
                ;;
            adminlevel)
                echo "Cambiando nivel de admin Slurm para '$USERNAME' a '$VALUE'..."
                remote_exec "sudo sacctmgr -i modify user where name=$USERNAME set AdminLevel=$VALUE"
                echo "✅ Nivel de Admin Slurm actualizado."
                ;;
            *)
                echo "Error: Atributo '$ATTRIBUTE' no reconocido." >&2
                echo "Atributos disponibles: password, account, adminlevel" >&2
                exit 1
                ;;
        esac
        ;;

    delete)
        if [ -z "$USERNAME" ]; then echo "Uso: $0 delete <usuario>" >&2; exit 1; fi
        echo "Eliminando usuario '$USERNAME'..."

        # --- AÑADIDO: Matar procesos del usuario ANTES de borrar ---
        echo "-> Terminando procesos de '$USERNAME' en '$HPC_HOST'..."
        remote_exec "sudo killall -KILL -u $USERNAME || true" # Mata procesos en hpc
        echo "-> Terminando procesos de '$USERNAME' en 'app'..."
        sudo killall -KILL -u $USERNAME || true # Mata procesos en app
        # '|| true' evita que el script falle si no hay procesos que matar
        # --- FIN DE LA SECCIÓN AÑADIDA ---

        # Eliminar de Slurm PRIMERO
        remote_exec "sudo sacctmgr -i delete user where name=$USERNAME"
        echo "-> Usuario eliminado de Slurm."
        # Eliminar de hpc-master
        remote_exec "sudo userdel -r $USERNAME"
        echo "-> Usuario eliminado de '$HPC_HOST'."
        # Eliminar de app
        sudo userdel -r $USERNAME
        echo "-> Usuario eliminado de 'app'."
        echo "✅ Usuario '$USERNAME' eliminado exitosamente."
        ;;

    *)
        echo "Uso: $0 {create|show|list|modify|delete} ..." >&2
        exit 1
        ;;
esac

exit 0