#!/bin/bash

# --- Configuración ---
PUN_DIR="/var/run/atrox-puns"
INACTIVITY_TIMEOUT_MINUTES=30 # Tiempo en minutos para considerar un PUN inactivo
NGINX_PUNS_ENABLED_DIR="/etc/nginx/puns-enabled"
NGINX_USER_MAP_PATH="/etc/nginx/user_map.conf"
# Convertir minutos a segundos
INACTIVITY_TIMEOUT_SECONDS=$((INACTIVITY_TIMEOUT_MINUTES * 60))

echo "$(date): Iniciando revisión de PUNs inactivos..."

# --- 1. Verificar si el directorio de PUNs existe ---
if [ ! -d "$PUN_DIR" ]; then
    echo "Directorio de PUNs $PUN_DIR no encontrado. Saliendo."
    exit 1
fi

# --- 2. Iterar sobre cada archivo de socket en el directorio ---
find "$PUN_DIR" -maxdepth 1 -type s -name "*.socket" | while read -r socket_path; do
    echo "Revisando socket: $socket_path"

    # --- 3. Obtener la hora actual y la última hora de acceso del socket ---
    current_time=$(date +%s)
    # Usamos 'stat -c %X' para obtener el 'atime' (último acceso) en segundos desde epoch
    last_access_time=$(stat -c %X "$socket_path")
    
    # Calcular el tiempo de inactividad
    inactive_duration=$((current_time - last_access_time))

    echo "  Último acceso: $(date -d @$last_access_time)"
    echo "  Tiempo inactivo: $inactive_duration segundos"

    # --- 4. Comparar con el umbral de inactividad ---
    if [ "$inactive_duration" -gt "$INACTIVITY_TIMEOUT_SECONDS" ]; then
        echo "  INACTIVO - Excede el umbral de $INACTIVITY_TIMEOUT_SECONDS segundos."

        # Extraer el nombre de usuario del nombre del socket
        username=$(basename "$socket_path" .socket)
        
        # --- 5. Intentar terminar el proceso PUN asociado ---
        # Asumimos que el proceso PUN se llama como user-server.js y es propiedad del usuario
        # Usamos 'pgrep' para encontrar el PID
        pun_pid=$(pgrep -u "$username" -f "node .*user-server.js.*${username}.socket")

        if [ -n "$pun_pid" ]; then
            echo "  Terminando proceso PUN (PID: $pun_pid) para el usuario '$username'..."
            # Intentar terminarlo de forma ordenada primero
            sudo kill -SIGTERM "$pun_pid"
            sleep 2 # Darle tiempo para terminar
            # Si sigue vivo, forzar la terminación
            if ps -p "$pun_pid" > /dev/null; then
                echo "  Proceso no terminó con SIGTERM, forzando con SIGKILL..."
                sudo kill -SIGKILL "$pun_pid"
            fi
            echo "  Proceso PUN terminado."
        else
            echo "  WARN: No se encontró un proceso PUN activo para el usuario '$username', pero el socket existe."
            # Igualmente procederemos a limpiar el socket y la config de Nginx
        fi

        # --- 6. Limpiar el archivo de socket ---
        echo "  Limpiando archivo de socket $socket_path..."
        sudo rm -f "$socket_path"

        # --- 7. Limpiar la configuración de NGINX (Opcional pero recomendado) ---
        nginx_conf_file="$NGINX_PUNS_ENABLED_DIR/${username}.conf"
        if [ -f "$nginx_conf_file" ]; then
            echo "  Eliminando configuración de NGINX: $nginx_conf_file"
            sudo rm -f "$nginx_conf_file"
            # Reconstruir el archivo user_map.conf sin este usuario
            # (Esto requiere una lógica más compleja o simplemente eliminar la línea)
            echo "  Eliminando entrada del mapa NGINX para '$username'..."
            sudo sed -i "/\"${username}\"/d" "$NGINX_USER_MAP_PATH"
            # Recargar NGINX después de todos los cambios (mejor hacerlo fuera del bucle)
            NEED_NGINX_RELOAD=1
        fi
        
    else
        echo "  ACTIVO - Dentro del umbral de inactividad."
    fi
    echo "---"
done

# --- 8. Recargar NGINX si se hicieron cambios ---
if [ "$NEED_NGINX_RELOAD" == "1" ]; then
    echo "Recargando NGINX..."
    sudo nginx -t && sudo nginx -s reload || echo "ERROR al recargar NGINX"
fi

echo "$(date): Revisión completada."
exit 0