#!/usr/bin/env bash
# /opt/atrox-gateway/install.sh
set -e

# --- VARIABLES ---
REPO_PATH="/opt/atrox-gateway"
MANAGER_USER="atroxgateway"   
ADMIN_USER="mgmt-service"    
PUN_RUN_DIR="/var/run/atrox-puns"
NGINX_CONF_DIR="/etc/nginx"
PUN_KILLER_SCRIPT_PATH="$REPO_PATH/scripts/pun_killer.sh"
PUN_KILLER_LOG_PATH="/var/log/pun_killer.log"

# --- FUNCIONES DE INSTALACIÓN ---

install_system_deps() {
    echo "2. Instalando dependencias del sistema y Node.js..."  
    # Instalar Node.js LTS de forma segura
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt install -y nodejs
}

setup_users_and_dirs() {
    echo "3. Configurando usuarios y directorios de runtime..."
    
    # Crear usuario MGMT-SERVICE (sin home)
    sudo useradd -r -s /sbin/nologin "$ADMIN_USER" || echo "$ADMIN_USER ya existe."
    
    # Configurar grupo www-data para atroxgateway
    sudo usermod -aG shadow atroxgateway || echo "$MANAGER_USER ya está en el grupo shadow."
    sudo usermod -aG www-data "$MANAGER_USER" || echo "$MANAGER_USER ya está en el grupo www-data."
    sudo usermod -aG www-data vagrant || echo "vagrant ya está en el grupo www-data."
    
    # Crear y configurar directorio UDS
    sudo mkdir -p "$PUN_RUN_DIR"
    sudo chown "$MANAGER_USER":www-data "$PUN_RUN_DIR"
    sudo chmod 777 "$PUN_RUN_DIR"
}

setup_sudoers() {
    echo "4. Configurando sudoers (Permisos NOPASSWD)..."
    SUDOERS_FILE="/etc/sudoers.d/atrox_service_privileges"
    
    # 1. Crear el archivo de política con NOPASSWD
    cat <<EOF | sudo tee "$SUDOERS_FILE"
atroxgateway ALL=(ALL) NOPASSWD: ALL
Defaults:atroxgateway !requiretty
EOF

    # 2. Asignar permisos correctos
    sudo chmod 0440 "$SUDOERS_FILE"
}

# --- FUNCIÓN CRÍTICA: COPIA DE ARCHIVOS A SYSTEMD Y NGINX ---
deploy_configs_and_services() {
    echo "5. Copiando archivos de servicio y configuración de Nginx..."

    # 1. Copiar archivos de SERVICIO (.service)
    # Asumimos que los archivos .service están en $REPO_PATH/etc/
    sudo cp "$REPO_PATH"/etc/*.service /etc/systemd/system/

    # 2. Copiar archivos de CONFIGURACIÓN NGINX (.conf)
    # Asumimos que los archivos .conf están en $REPO_PATH/etc/nginx/
    sudo cp "$REPO_PATH"/etc/nginx/sites-available/*.conf "$NGINX_CONF_DIR"/sites-available/
    
    # 3. Configurar directorios dinámicos de Nginx
    sudo mkdir -p "$NGINX_CONF_DIR"/puns-enabled
    sudo touch "$NGINX_CONF_DIR"/user_map.conf
    sudo chown "$MANAGER_USER":"$MANAGER_USER" "$NGINX_CONF_DIR"/user_map.conf

    # 4. Habilitar la configuración de desarrollo
    sudo rm -f "$NGINX_CONF_DIR"/sites-enabled/default
    sudo ln -sf "$NGINX_CONF_DIR"/sites-available/atrox-dev.conf "$NGINX_CONF_DIR"/sites-enabled/

    # 5. Configuración de permisos de usuario en los servicios
    sudo sed -i "s/User=.*/User=$MANAGER_USER/g" /etc/systemd/system/atrox.service
    sudo sed -i "s/Group=.*/Group=$MANAGER_USER/g" /etc/systemd/system/atrox-admin.service
    
    # 6. Recargar systemd para reconocer los nuevos archivos
    sudo systemctl daemon-reload
}

deploy_code_and_install_npm() {
    echo "6. Asignando propiedad del código e instalando dependencias NPM..."
    
    # 1. Transferir propiedad de TODO el código a atroxgateway
    sudo chown -R "$MANAGER_USER":"$MANAGER_USER" "$REPO_PATH"
    sudo chmod -R a+x "$REPO_PATH"/scripts/
    
    # 2. Instalar dependencias NPM
    cd "$REPO_PATH"
    sudo -E npm install 
    cd "$REPO_PATH"/packages/frontend
    sudo npm install && sudo npm run build
    
    # 3. Asignar propiedad de node_modules al MANAGER_USER
    sudo chown -R "$MANAGER_USER":"$MANAGER_USER" "$REPO_PATH"/node_modules
}

setup_services_start() {
    echo "7. Iniciando servicios finales..."

    # 1. Habilitar y reiniciar Nginx
    sudo nginx -t && sudo systemctl restart nginx
    
    # 2. Iniciar servicios de Node.js
    sudo systemctl enable atrox.service atrox-admin.service
    sudo systemctl start redis-server # Redis debe estar activo antes que el Portero
    sudo systemctl start atrox.service
    sudo systemctl start atrox-admin.service
}

setup_pun_killer_cron() {
    echo "8. Configurando cron job para pun_killer.sh..."

    if [ ! -f "$PUN_KILLER_SCRIPT_PATH" ]; then
        echo "ERROR: El script $PUN_KILLER_SCRIPT_PATH no existe. Saltando configuración del cron." >&2
        return 1 
    fi
    sudo chmod +x "$PUN_KILLER_SCRIPT_PATH"

    CRON_JOB_CONTENT="*/15 * * * * root $PUN_KILLER_SCRIPT_PATH >> tee -a $PUN_KILLER_LOG_PATH 2>&1"
    echo "$CRON_JOB_CONTENT" | sudo tee /etc/cron.d/atrox-pun-killer > /dev/null
    sudo chmod 644 /etc/cron.d/atrox-pun-killer
    echo "Cron job configurado para ejecutarse cada 15 minutos."
}

# --- EJECUCIÓN DEL FLUJO PRINCIPAL ---

main() {
    install_system_deps
    setup_users_and_dirs
    setup_sudoers
    deploy_configs_and_services
    deploy_code_and_install_npm
    setup_services_start
    setup_pun_killer_cron
    
    echo "****************************************************************"
    echo "DESPLIEGUE FINAL DE ATROX GATEWAY COMPLETO."
    echo "****************************************************************"
}

main