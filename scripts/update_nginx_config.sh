#!/usr/bin/env bash
# /opt/atrox-gateway/scripts/update_nginx_config.sh


USERNAME=$1
SOCKET_PATH=$2
NGINX_DIR="/etc/nginx"
PUN_CONF_DIR="$NGINX_DIR/puns-enabled"
MAP_FILE="$NGINX_DIR/user_map.conf"

if [ -z "$USERNAME" ] || [ -z "$SOCKET_PATH" ]; then
    echo "ERROR: Missing username or socket path." >&2
    exit 1
fi

# --- 1. Crear el bloque upstream (Target UDS) ---
echo "Creando config de upstream para $USERNAME..."
# Este archivo solo contendrá el upstream, no el location
cat <<EOF | sudo tee "$PUN_CONF_DIR/$USERNAME.conf"
upstream ${USERNAME}_pun_backend { 
    server unix:${SOCKET_PATH}; 
}
EOF

# --- 2. Crear/actualizar el archivo user_map.conf (Mapa de Sesión) ---
echo "Actualizando archivo user_map.conf..."

# 1. Crear un archivo temporal para construir el mapa completo.
TEMP_MAP=$(mktemp)

# 2. Iniciar el bloque MAP con el único 'default' permitido
cat <<EOF > "$TEMP_MAP"
map \$cookie_user_session \$user_backend {
    default "";
EOF

# 3. Copiar líneas existentes (mapas de otros usuarios) y EXCLUIR TODAS LAS ETIQUETAS DE CONTROL.
if [ -f "$MAP_FILE" ]; then
    # Usamos grep para excluir las etiquetas del bloque 'map', 'default', y '}' 
    # y la línea del usuario actual.
    sudo grep -v '^map' "$MAP_FILE" | grep -v '}' | grep -v 'default' | grep -v "\"$USERNAME\"" >> "$TEMP_MAP" || true
fi

# 4. Añadir la nueva línea para el usuario actual
echo "\"$USERNAME\" \"${USERNAME}_pun_backend\";" >> "$TEMP_MAP"

# 5. Cerrar el bloque MAP
echo "}" >> "$TEMP_MAP"

# 6. Mover el archivo temporal al archivo de configuración (sobrescribir)
sudo mv "$TEMP_MAP" "$MAP_FILE"

# --- 3. Recargar Nginx ---
echo "Recargando Nginx..."
sudo /usr/sbin/nginx -s reload