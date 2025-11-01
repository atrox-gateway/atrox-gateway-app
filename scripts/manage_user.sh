#!/usr/bin/env bash
# /opt/atrox-gateway/scripts/manage_user.sh
# Script para gestionar usuarios de Linux y Slurm en ambas VMs

set -e

# --- Configuración ---
HPC_HOST="node-login"
SSH_USER="atroxgateway" # Usuario que tiene las llaves SSH para conectar al HPC
SSH_OPTS="-o StrictHostKeyChecking=no" # Opciones para SSH
NODES_FILE="/opt/atrox-gateway/nodes.conf" # Lista de nodos (una por línea)

# Cargar nodos desde NODES_FILE en el arreglo NODES (ignora líneas vacías y comentarios)
function load_nodes() {
    NODES=()
    if [ -f "$NODES_FILE" ]; then
        while IFS= read -r line || [ -n "$line" ]; do
            # trim whitespace
            node=$(echo "$line" | awk '{gsub(/^ +| +$/,"",$0); print $0}')
            # ignore empty and comment lines
            if [ -n "$node" ] && [[ "$node" != \#* ]]; then
                NODES+=("$node")
            fi
        done < "$NODES_FILE"
    fi
    # Ensure HPC_HOST is known (it may be one of the nodes); if not, keep it as-is
    if [ ${#NODES[@]} -eq 0 ]; then
        # Fallback to HPC_HOST if nodes file missing or empty
        NODES=("$HPC_HOST")
    fi
}
UID_MIN=1003 # Empezamos después de vagrant (1000) y atroxgateway (1002)
UID_MAX=60000

# --- Funciones Auxiliares ---

# Encuentra el siguiente UID disponible en ambas máquinas
function get_next_uid() {
    local remote_last_uid local_last_uid highest_uid next_uid
    # --- LÍNEA CORREGIDA ---
    echo "Buscando el siguiente UID disponible en AMBAS máquinas..." >&2
    # --- FIN CORRECCIÓN ---
    # Query local
    local_last_uid=$(getent passwd | awk -F: "\$3 >= $UID_MIN && \$3 < $UID_MAX {print \$3}" | sort -n | tail -1)
    # Query all remote nodes and pick the highest UID found
    load_nodes
    remote_last_uid=""
    for node in "${NODES[@]}"; do
        # Skip localhost if present in nodes list
        if [ "$node" == "$(hostname)" ] || [ "$node" == "localhost" ]; then
            continue
        fi
        val=$(sudo -u $SSH_USER ssh $SSH_OPTS ${SSH_USER}@${node} "getent passwd | awk -F: '\$3 >= $UID_MIN && \$3 < $UID_MAX {print \$3}' | sort -n | tail -1" 2>/dev/null || true)
        if [ -n "$val" ]; then
            remote_last_uid+="$val\n"
        fi
    done
    # Compose highest between local and remotes
    highest_uid=$(echo -e "${remote_last_uid:-$((UID_MIN-1))}\n${local_last_uid:-$((UID_MIN-1))}" | sort -n | tail -1)
    next_uid=$((highest_uid + 1))
    echo "$next_uid" # Esta línea sí debe ir a stdout
}
# Ejecuta un comando remotamente en un nodo dado como SSH_USER
function remote_exec_node() {
    local node="$1"; shift
    sudo -u $SSH_USER ssh $SSH_OPTS ${SSH_USER}@${node} "$@"
}

# Ejecuta un comando en TODOS los nodos listados en NODES. No falle si algún nodo responde error.
function remote_exec_all() {
    load_nodes
    local cmd="$@"
    for node in "${NODES[@]}"; do
        # Skip local host (we run local operations directly)
        if [ "$node" == "$(hostname)" ] || [ "$node" == "localhost" ]; then
            continue
        fi
        # run on each remote node; capture errors but continue
        sudo -u $SSH_USER ssh $SSH_OPTS ${SSH_USER}@${node} "$cmd" || true
    done
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
    # Crear en app (local)
    sudo useradd -N -m -s /bin/bash -u $NEXT_UID $USERNAME && echo "$USERNAME:$PASSWORD" | sudo chpasswd
    sudo usermod -aG www-data $USERNAME # Importante para permisos del socket
    echo "-> Usuario creado en 'app'."
    # Crear en los nodos remotos (salta el host local)
    remote_exec_all "sudo useradd -N -m -s /bin/bash -u $NEXT_UID $USERNAME && echo '$USERNAME:$PASSWORD' | sudo chpasswd"
    echo "-> Usuario creado en nodos remotos (según ${NODES_FILE})."
        # Añadir asociación en Slurm y establecer DefaultAccount
    # Slurm operations run on the HPC host
    remote_exec_node "$HPC_HOST" "sudo sacctmgr -i add user name=$USERNAME account=$ACCOUNT || true"
    remote_exec_node "$HPC_HOST" "sudo sacctmgr -i modify user where name=$USERNAME set DefaultAccount=$ACCOUNT"
        echo "-> Usuario añadido y DefaultAccount establecido en Slurm a '$ACCOUNT'."
        # Si la cuenta es 'admin', también establecer AdminLevel=Administrator para consistencia
        if [[ "${ACCOUNT,,}" == "admin" ]]; then
            remote_exec_node "$HPC_HOST" "sudo sacctmgr -i modify user where name=$USERNAME set AdminLevel=Administrator"
            echo "-> Nivel de Admin Slurm establecido a 'Administrator' porque la cuenta es 'admin'."
        fi
        echo "✅ Usuario '$USERNAME' creado exitosamente."
        ;;

    show)
        if [ -z "$USERNAME" ]; then echo "Uso: $0 show <usuario>" >&2; exit 1; fi
        
        # Comprobar si el usuario existe para evitar errores
        if ! getent passwd "$USERNAME" > /dev/null; then
            echo "Error: Usuario '$USERNAME' no encontrado." >&2
            exit 2 # Código de error para "Usuario no encontrado"
        fi

    # Obtener información de Slurm en formato parseable (desde HPC host)
    slurm_info=$(remote_exec_node "$HPC_HOST" "sudo sacctmgr show user where name=$USERNAME format=User,DefaultAccount,AdminLevel --parsable2 --noheader")
        
        # Si no hay info de Slurm, puede que el usuario exista en Linux pero no en Slurm
        if [ -z "$slurm_info" ]; then
            echo "user|$USERNAME"
            echo "defaultAccount|N/A"
            echo "adminLevel|None"
        else
            # Parsear la salida y devolverla en formato clave|valor
            IFS='|' read -r user default_account admin_level <<< "$slurm_info"
            echo "user|$user"
            echo "defaultAccount|$default_account"
            echo "adminLevel|$admin_level"
        fi
        ;;

    list)
        echo "--- Usuarios Registrados en Slurm ---"
    remote_exec_node "$HPC_HOST" "sudo sacctmgr show user format=User,DefaultAccount,AdminLevel --parsable2 --noheader"
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
                # Local
                echo "$USERNAME:$VALUE" | sudo chpasswd
                echo "-> Contraseña actualizada en 'app'."
                # Remotos
                remote_exec_all "echo '$USERNAME:$VALUE' | sudo chpasswd"
                echo "-> Contraseña actualizada en nodos remotos (según ${NODES_FILE})."
                echo "✅ Contraseña actualizada."
                ;;
            account)
                echo "Cambiando cuenta Slurm para '$USERNAME' a '$VALUE'..."
                # Asegurarnos de que la asociación usuario->cuenta exista en Slurm
                remote_exec_node "$HPC_HOST" "sudo sacctmgr -i add user name=$USERNAME account=$VALUE || true"
                remote_exec_node "$HPC_HOST" "sudo sacctmgr -i modify user where name=$USERNAME set DefaultAccount=$VALUE"
                echo "✅ Cuenta Slurm actualizada."
                # Si la cuenta es 'admin', también establecer AdminLevel=Administrator para consistencia
                if [[ "${VALUE,,}" == "admin" ]]; then
                    remote_exec_node "$HPC_HOST" "sudo sacctmgr -i modify user where name=$USERNAME set AdminLevel=Administrator"
                    echo "✅ Nivel de Admin Slurm actualizado a 'Administrator' porque la cuenta es 'admin'."
                else
                    # Si cambiamos a una cuenta distinta de 'admin', revocamos posibles privilegios de admin
                    remote_exec_node "$HPC_HOST" "sudo sacctmgr -i modify user where name=$USERNAME set AdminLevel=None" || true
                    echo "-> Si existía AdminLevel, ha sido revocado (None) porque la cuenta no es 'admin'."
                fi
                ;;
            adminlevel)
                echo "Cambiando nivel de admin Slurm para '$USERNAME' a '$VALUE'..."
                # Ajustar AdminLevel primero
                remote_exec_node "$HPC_HOST" "sudo sacctmgr -i modify user where name=$USERNAME set AdminLevel=$VALUE"
                echo "✅ Nivel de Admin Slurm actualizado."
                # Si se otorga privilegio de administrador, asegurarse de que exista la asociación y DefaultAccount sea 'admin'
                if [[ "${VALUE,,}" == "administrator" ]]; then
                    remote_exec_node "$HPC_HOST" "sudo sacctmgr -i add user name=$USERNAME account=admin || true"
                    remote_exec_node "$HPC_HOST" "sudo sacctmgr -i modify user where name=$USERNAME set DefaultAccount=admin"
                    echo "-> DefaultAccount establecido a 'admin' debido a AdminLevel 'Administrator'."
                fi
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
    echo "-> Terminando procesos de '$USERNAME' en nodos remotos..."
    remote_exec_all "sudo killall -KILL -u $USERNAME || true" # Mata procesos en nodos remotos
    echo "-> Terminando procesos de '$USERNAME' en 'app'..."
    sudo killall -KILL -u $USERNAME || true # Mata procesos en app (local)
        # '|| true' evita que el script falle si no hay procesos que matar
        # --- FIN DE LA SECCIÓN AÑADIDA ---

    # Eliminar de Slurm PRIMERO (HPC host)
    remote_exec_node "$HPC_HOST" "sudo sacctmgr -i delete user where name=$USERNAME"
    echo "-> Usuario eliminado de Slurm (en $HPC_HOST)."
    # Eliminar de nodos remotos
    remote_exec_all "sudo userdel -r $USERNAME || true"
    echo "-> Usuario eliminado en nodos remotos (según ${NODES_FILE})."
    # Eliminar local
    sudo userdel -r $USERNAME || true
    echo "-> Usuario eliminado de 'app'."
        echo "✅ Usuario '$USERNAME' eliminado exitosamente."
        ;;

    *)
        echo "Uso: $0 {create|show|list|modify|delete} ..." >&2
        exit 1
        ;;
esac

exit 0