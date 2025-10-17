#!/usr/bin/env bash
# /opt/atrox-gateway/scripts/manage_user.sh

set -e

ACTION=$1
NEW_USERNAME=$2
INITIAL_PASSWORD=$3
HPC_HOST="hpc-master"
SSH_USER="atroxgateway" # Define the user for SSH connections

UID_MIN=1000
UID_MAX=60000

echo "Buscando el siguiente UID disponible en AMBAS máquinas..."

# --- MODIFIED: Run SSH as atroxgateway ---
REMOTE_LAST_UID=$(sudo -u $SSH_USER ssh -o StrictHostKeyChecking=no ${SSH_USER}@$HPC_HOST "getent passwd | awk -F: '\$3 >= $UID_MIN && \$3 < $UID_MAX {print \$3}' | sort -n | tail -1")
# ----------------------------------------

LOCAL_LAST_UID=$(getent passwd | awk -F: "\$3 >= $UID_MIN && \$3 < $UID_MAX {print \$3}" | sort -n | tail -1)

HIGHEST_UID=$(echo -e "$REMOTE_LAST_UID\n$LOCAL_LAST_UID" | sort -n | tail -1)
# Handle case where no users exist in the range yet
if [ -z "$HIGHEST_UID" ]; then
    HIGHEST_UID=$((UID_MIN - 1)) # Start from UID_MIN
fi
# Ensure we skip UID 1002 if it's the next one
NEXT_UID=$((HIGHEST_UID + 1))
if [ "$NEXT_UID" -eq 1002 ]; then
    NEXT_UID=1003
fi

if [ "$ACTION" == "create" ]; then
    echo "Creando usuario '$NEW_USERNAME' con el UID sincronizado '$NEXT_UID'..."

    # Create user locally (already running as root via sudo from service)
    useradd -m -s /bin/bash -u $NEXT_UID $NEW_USERNAME && echo "$NEW_USERNAME:$INITIAL_PASSWORD" | chpasswd
    usermod -aG www-data $NEW_USERNAME # Add to www-data group if needed
    echo "-> Usuario creado en 'app'."

    # --- MODIFIED: Run SSH as atroxgateway ---
    sudo -u $SSH_USER ssh -o StrictHostKeyChecking=no ${SSH_USER}@$HPC_HOST "sudo useradd -m -s /bin/bash -u $NEXT_UID $NEW_USERNAME && echo '$NEW_USERNAME:$INITIAL_PASSWORD' | sudo chpasswd"
    # ----------------------------------------
    echo "-> Usuario creado en '$HPC_HOST'."

    # --- MODIFIED: Run SSH as atroxgateway ---
    sudo -u $SSH_USER ssh -o StrictHostKeyChecking=no ${SSH_USER}@$HPC_HOST "sudo sacctmgr -i add user $NEW_USERNAME Account=default"
    # ----------------------------------------
    echo "-> Usuario registrado en Slurm."

    echo "✅ Proceso de creación de usuario completado."
fi