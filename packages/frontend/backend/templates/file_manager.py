#!/usr/bin/env python3
"""
AtrozGetaway - File Manager Template
===================================

Template para gestión de archivos de usuarios en LeoAtrox.
Incluye upload, download, navegación y visualización de resultados.

NOTA: Este es un template. En producción requiere:
- Autenticación real
- Permisos de sistema de archivos
- Validación de seguridad
- Integración con almacenamiento distribuido
"""

import os
import shutil
import mimetypes
from pathlib import Path
from typing import Dict, List, Optional, BinaryIO
from dataclasses import dataclass
from datetime import datetime
import hashlib


@dataclass
class FileInfo:
    """Información de un archivo o directorio"""
    name: str
    path: str
    type: str  # 'file' or 'directory'
    size: int
    modified: datetime
    permissions: str
    owner: str
    extension: Optional[str] = None
    mime_type: Optional[str] = None


class UserFileManager:
    """
    Gestor de archivos para usuarios de AtrozGetaway
    """
    
    def __init__(self, base_dir: str = "/home/leoatrox/users"):
        self.base_dir = Path(base_dir)
        self.allowed_extensions = {
            'scripts': {'.py', '.sh', '.r', '.m', '.cpp', '.c', '.f90', '.f'},
            'data': {'.csv', '.tsv', '.json', '.xml', '.xlsx', '.txt', '.dat'},
            'config': {'.yaml', '.yml', '.toml', '.ini', '.conf', '.cfg'},
            'results': {'.png', '.jpg', '.jpeg', '.pdf', '.svg', '.html', '.log'}
        }
        self.max_file_size = 100 * 1024 * 1024  # 100MB por defecto
    
    def get_user_directory(self, user_id: str) -> Path:
        """Obtiene el directorio base del usuario"""
        user_dir = self.base_dir / user_id
        user_dir.mkdir(parents=True, exist_ok=True)
        
        # Crear subdirectorios estándar
        for subdir in ['scripts', 'data', 'results', 'config']:
            (user_dir / subdir).mkdir(exist_ok=True)
        
        return user_dir
    
    def list_directory(self, user_id: str, path: str = "/") -> List[FileInfo]:
        """
        Lista el contenido de un directorio del usuario
        """
        try:
            user_dir = self.get_user_directory(user_id)
            target_path = user_dir / path.lstrip('/')
            
            # Validar que el path esté dentro del directorio del usuario
            if not self._is_safe_path(user_dir, target_path):
                raise ValueError("Acceso denegado: path fuera del directorio del usuario")
            
            files = []
            
            if target_path.exists() and target_path.is_dir():
                for item in target_path.iterdir():
                    try:
                        stat = item.stat()
                        
                        file_info = FileInfo(
                            name=item.name,
                            path=str(item.relative_to(user_dir)),
                            type='directory' if item.is_dir() else 'file',
                            size=stat.st_size if item.is_file() else 0,
                            modified=datetime.fromtimestamp(stat.st_mtime),
                            permissions=oct(stat.st_mode)[-3:],
                            owner=user_id,
                            extension=item.suffix if item.is_file() else None,
                            mime_type=mimetypes.guess_type(str(item))[0] if item.is_file() else None
                        )
                        
                        files.append(file_info)
                        
                    except (OSError, PermissionError):
                        continue  # Saltar archivos inaccesibles
            
            return sorted(files, key=lambda x: (x.type == 'file', x.name.lower()))
            
        except Exception as e:
            raise ValueError(f"Error listando directorio: {str(e)}")
    
    def upload_file(self, user_id: str, file_data: BinaryIO, 
                   filename: str, destination_path: str = "/") -> Dict:
        """
        Sube un archivo al directorio del usuario
        """
        try:
            user_dir = self.get_user_directory(user_id)
            dest_dir = user_dir / destination_path.lstrip('/')
            dest_file = dest_dir / filename
            
            # Validaciones de seguridad
            if not self._is_safe_path(user_dir, dest_file):
                return {"status": "error", "message": "Path de destino inválido"}
            
            if not self._is_allowed_file(filename):
                return {"status": "error", "message": "Tipo de archivo no permitido"}
            
            # Verificar tamaño del archivo
            file_data.seek(0, 2)  # Ir al final
            file_size = file_data.tell()
            file_data.seek(0)  # Volver al inicio
            
            if file_size > self.max_file_size:
                return {"status": "error", "message": "Archivo demasiado grande"}
            
            # Crear directorio de destino si no existe
            dest_dir.mkdir(parents=True, exist_ok=True)
            
            # Guardar archivo
            with open(dest_file, 'wb') as f:
                shutil.copyfileobj(file_data, f)
            
            # Calcular hash para verificación
            file_hash = self._calculate_file_hash(dest_file)
            
            return {
                "status": "success",
                "message": "Archivo subido exitosamente",
                "path": str(dest_file.relative_to(user_dir)),
                "size": file_size,
                "hash": file_hash
            }
            
        except Exception as e:
            return {"status": "error", "message": f"Error subiendo archivo: {str(e)}"}
    
    def download_file(self, user_id: str, file_path: str) -> Dict:
        """
        Prepara un archivo para descarga
        """
        try:
            user_dir = self.get_user_directory(user_id)
            target_file = user_dir / file_path.lstrip('/')
            
            if not self._is_safe_path(user_dir, target_file):
                return {"status": "error", "message": "Acceso denegado"}
            
            if not target_file.exists() or not target_file.is_file():
                return {"status": "error", "message": "Archivo no encontrado"}
            
            return {
                "status": "success",
                "file_path": str(target_file),
                "size": target_file.stat().st_size,
                "mime_type": mimetypes.guess_type(str(target_file))[0],
                "filename": target_file.name
            }
            
        except Exception as e:
            return {"status": "error", "message": f"Error accediendo archivo: {str(e)}"}
    
    def delete_file(self, user_id: str, file_path: str) -> Dict:
        """
        Elimina un archivo o directorio
        """
        try:
            user_dir = self.get_user_directory(user_id)
            target_path = user_dir / file_path.lstrip('/')
            
            if not self._is_safe_path(user_dir, target_path):
                return {"status": "error", "message": "Acceso denegado"}
            
            if not target_path.exists():
                return {"status": "error", "message": "Archivo no encontrado"}
            
            if target_path.is_dir():
                shutil.rmtree(target_path)
            else:
                target_path.unlink()
            
            return {
                "status": "success",
                "message": f"{'Directorio' if target_path.is_dir() else 'Archivo'} eliminado exitosamente"
            }
            
        except Exception as e:
            return {"status": "error", "message": f"Error eliminando: {str(e)}"}
    
    def create_directory(self, user_id: str, dir_path: str) -> Dict:
        """
        Crea un nuevo directorio
        """
        try:
            user_dir = self.get_user_directory(user_id)
            target_dir = user_dir / dir_path.lstrip('/')
            
            if not self._is_safe_path(user_dir, target_dir):
                return {"status": "error", "message": "Path inválido"}
            
            target_dir.mkdir(parents=True, exist_ok=False)
            
            return {
                "status": "success",
                "message": "Directorio creado exitosamente",
                "path": str(target_dir.relative_to(user_dir))
            }
            
        except FileExistsError:
            return {"status": "error", "message": "El directorio ya existe"}
        except Exception as e:
            return {"status": "error", "message": f"Error creando directorio: {str(e)}"}
    
    def preview_file(self, user_id: str, file_path: str, max_lines: int = 100) -> Dict:
        """
        Genera una vista previa del contenido de un archivo
        """
        try:
            user_dir = self.get_user_directory(user_id)
            target_file = user_dir / file_path.lstrip('/')
            
            if not self._is_safe_path(user_dir, target_file):
                return {"status": "error", "message": "Acceso denegado"}
            
            if not target_file.exists() or not target_file.is_file():
                return {"status": "error", "message": "Archivo no encontrado"}
            
            # Detectar tipo de archivo
            mime_type, _ = mimetypes.guess_type(str(target_file))
            file_size = target_file.stat().st_size
            
            preview_data = {
                "status": "success",
                "filename": target_file.name,
                "size": file_size,
                "mime_type": mime_type,
                "type": "unknown"
            }
            
            # Archivos de texto
            if mime_type and mime_type.startswith('text/') or target_file.suffix in {'.py', '.sh', '.r', '.log'}:
                with open(target_file, 'r', encoding='utf-8', errors='ignore') as f:
                    lines = []
                    for i, line in enumerate(f):
                        if i >= max_lines:
                            preview_data["truncated"] = True
                            break
                        lines.append(line.rstrip())
                    
                    preview_data.update({
                        "type": "text",
                        "content": lines,
                        "total_lines": len(lines)
                    })
            
            # Archivos CSV/TSV
            elif target_file.suffix in {'.csv', '.tsv'}:
                import csv
                delimiter = '\\t' if target_file.suffix == '.tsv' else ','
                
                with open(target_file, 'r', encoding='utf-8') as f:
                    reader = csv.reader(f, delimiter=delimiter)
                    rows = []
                    for i, row in enumerate(reader):
                        if i >= max_lines:
                            preview_data["truncated"] = True
                            break
                        rows.append(row)
                    
                    preview_data.update({
                        "type": "csv",
                        "headers": rows[0] if rows else [],
                        "data": rows[1:] if len(rows) > 1 else [],
                        "total_rows": len(rows)
                    })
            
            # Archivos JSON
            elif target_file.suffix == '.json':
                import json
                with open(target_file, 'r', encoding='utf-8') as f:
                    try:
                        data = json.load(f)
                        preview_data.update({
                            "type": "json",
                            "content": json.dumps(data, indent=2, ensure_ascii=False)[:5000]  # Primeros 5KB
                        })
                    except json.JSONDecodeError:
                        preview_data["type"] = "text"
                        preview_data["content"] = f.read(5000)
            
            # Archivos binarios no soportados
            else:
                preview_data.update({
                    "type": "binary",
                    "message": "Vista previa no disponible para archivos binarios"
                })
            
            return preview_data
            
        except Exception as e:
            return {"status": "error", "message": f"Error generando vista previa: {str(e)}"}
    
    def get_disk_usage(self, user_id: str) -> Dict:
        """
        Obtiene el uso de disco del usuario
        """
        try:
            user_dir = self.get_user_directory(user_id)
            total_size = 0
            file_count = 0
            
            for root, dirs, files in os.walk(user_dir):
                for file in files:
                    try:
                        file_path = Path(root) / file
                        total_size += file_path.stat().st_size
                        file_count += 1
                    except (OSError, PermissionError):
                        continue
            
            return {
                "status": "success",
                "total_size": total_size,
                "total_files": file_count,
                "formatted_size": self._format_size(total_size)
            }
            
        except Exception as e:
            return {"status": "error", "message": f"Error calculando uso de disco: {str(e)}"}
    
    def _is_safe_path(self, base_dir: Path, target_path: Path) -> bool:
        """Verifica que el path esté dentro del directorio base"""
        try:
            target_path.resolve().relative_to(base_dir.resolve())
            return True
        except ValueError:
            return False
    
    def _is_allowed_file(self, filename: str) -> bool:
        """Verifica si el tipo de archivo está permitido"""
        extension = Path(filename).suffix.lower()
        
        for category, extensions in self.allowed_extensions.items():
            if extension in extensions:
                return True
        
        return False
    
    def _calculate_file_hash(self, file_path: Path) -> str:
        """Calcula el hash SHA256 de un archivo"""
        sha256_hash = hashlib.sha256()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                sha256_hash.update(chunk)
        return sha256_hash.hexdigest()
    
    def _format_size(self, size_bytes: int) -> str:
        """Formatea el tamaño en bytes a una representación legible"""
        if size_bytes == 0:
            return "0 B"
        
        size_names = ["B", "KB", "MB", "GB", "TB"]
        i = 0
        while size_bytes >= 1024 and i < len(size_names) - 1:
            size_bytes /= 1024.0
            i += 1
        
        return f"{size_bytes:.1f} {size_names[i]}"


# Ejemplo de uso del template
if __name__ == "__main__":
    # Inicializar el gestor de archivos
    file_manager = UserFileManager()
    
    # Ejemplo de listado de directorio
    files = file_manager.list_directory("test_user", "/")
    print(f"Archivos encontrados: {len(files)}")
    
    # Ejemplo de uso de disco
    usage = file_manager.get_disk_usage("test_user")
    print(f"Uso de disco: {usage}")