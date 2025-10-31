#!/usr/bin/env python3
"""
AtrozGetaway - FastAPI Backend Template
======================================

Template principal del backend FastAPI para AtroxGetaway.
Este template muestra la estructura básica de la API.

NOTA: Este es un template de ejemplo. En producción requiere:
- Configuración real de base de datos
- Autenticación JWT real
- Conexión con Slurm real
- Validación y seguridad completa
- Logging y monitoreo
- Tests unitarios
"""

from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime
import uvicorn

# Importar templates locales (en producción serían módulos reales)
# from .job_manager import SlurmJobManager, JobConfig, IntelligentJobAssistant
# from .file_manager import UserFileManager

app = FastAPI(
    title="AtroxGetaway API",
    description="API para gestión de trabajos en supercomputadora LeoAtrox",
    version="1.0.0"
)

# Configurar CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],  # Frontend URLs
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security
security = HTTPBearer()

# Pydantic Models
class JobSubmissionRequest(BaseModel):
    name: str = Field(..., description="Nombre del trabajo")
    script_content: Optional[str] = Field(None, description="Contenido del script")
    cpus: int = Field(2, ge=1, le=128, description="Número de CPUs")
    memory: str = Field("4GB", description="Cantidad de memoria RAM")
    walltime: str = Field("01:00:00", description="Tiempo máximo (HH:MM:SS)")
    partition: str = Field("general", description="Partición Slurm")
    gpu: int = Field(0, ge=0, le=8, description="Número de GPUs")


class JobStatusResponse(BaseModel):
    job_id: str
    name: str
    status: str
    progress: int
    submit_time: datetime
    user: str
    cpus: int
    memory: str


class UserInfo(BaseModel):
    user_id: str
    email: str
    name: str
    role: str = "user"


class SystemResourcesResponse(BaseModel):
    cpu_usage: float
    memory_usage: float
    gpu_usage: float
    active_jobs: int
    queued_jobs: int
    available_nodes: int


# Mock data for template
MOCK_USER = UserInfo(
    user_id="test_user",
    email="test@leoatrox.com", 
    name="Usuario Test",
    role="user"
)

MOCK_JOBS = [
    JobStatusResponse(
        job_id="job_001",
        name="Análisis RNA-Seq",
        status="running",
        progress=75,
        submit_time=datetime.now(),
        user="Dr. García",
        cpus=8,
        memory="16GB"
    ),
    JobStatusResponse(
        job_id="job_002",
        name="Simulación Molecular",
        status="queued", 
        progress=0,
        submit_time=datetime.now(),
        user="Ana López",
        cpus=16,
        memory="32GB"
    )
]


# Dependency: Get current user
async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> UserInfo:
    """
    Template: Validación de usuario
    En producción validaría el JWT token
    """
    # TEMPLATE: Aquí iría la validación real del JWT
    # try:
    #     payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
    #     user_id: str = payload.get("sub")
    #     if user_id is None:
    #         raise HTTPException(status_code=401, detail="Token inválido")
    #     return get_user_from_db(user_id)
    # except JWTError:
    #     raise HTTPException(status_code=401, detail="Token inválido")
    
    return MOCK_USER


# Routes

@app.get("/", tags=["Health"])
async def root():
    """Health check endpoint"""
    return {
        "message": "AtroxGetaway API - LeoAtrox Supercomputing Platform",
        "status": "running",
        "version": "1.0.0"
    }


@app.get("/api/dashboard/stats", tags=["Dashboard"])
async def get_dashboard_stats(current_user: UserInfo = Depends(get_current_user)):
    """
    Obtiene estadísticas del dashboard
    """
    # TEMPLATE: En producción consultaría la base de datos real
    return {
        "total_jobs": 247,
        "running_jobs": 12,
        "queued_jobs": 8,
        "completed_today": 15,
        "cpu_usage": 78,
        "memory_usage": 65,
        "active_users": 23,
        "success_rate": 94
    }


@app.get("/api/jobs", response_model=List[JobStatusResponse], tags=["Jobs"])
async def get_jobs(
    status_filter: Optional[str] = None,
    current_user: UserInfo = Depends(get_current_user)
):
    """
    Obtiene la lista de trabajos del usuario
    """
    # TEMPLATE: En producción usaría job_manager.get_queue_status()
    jobs = MOCK_JOBS
    
    if status_filter:
        jobs = [job for job in jobs if job.status == status_filter]
    
    return jobs


@app.post("/api/jobs", tags=["Jobs"])
async def submit_job(
    job_request: JobSubmissionRequest,
    current_user: UserInfo = Depends(get_current_user)
):
    """
    Envía un nuevo trabajo a Slurm
    """
    try:
        # TEMPLATE: En producción sería:
        # job_manager = SlurmJobManager()
        # config = JobConfig(
        #     name=job_request.name,
        #     script_path=f"/tmp/{job_request.name}.py",
        #     cpus=job_request.cpus,
        #     memory=job_request.memory,
        #     walltime=job_request.walltime,
        #     partition=job_request.partition,
        #     gpu=job_request.gpu,
        #     user_id=current_user.user_id
        # )
        # result = job_manager.submit_job(config)
        
        # Simulación para template
        job_id = f"job_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        
        return {
            "status": "success",
            "job_id": job_id,
            "message": f"Trabajo '{job_request.name}' enviado exitosamente"
        }
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error enviando trabajo: {str(e)}"
        )


@app.delete("/api/jobs/{job_id}", tags=["Jobs"])
async def cancel_job(
    job_id: str,
    current_user: UserInfo = Depends(get_current_user)
):
    """
    Cancela un trabajo
    """
    # TEMPLATE: job_manager.cancel_job(job_id)
    
    return {
        "status": "success",
        "message": f"Trabajo {job_id} cancelado exitosamente"
    }


@app.get("/api/jobs/{job_id}/logs", tags=["Jobs"]) 
async def get_job_logs(
    job_id: str,
    current_user: UserInfo = Depends(get_current_user)
):
    """
    Obtiene los logs de un trabajo
    """
    # TEMPLATE: Leer archivos .out y .err del trabajo
    
    return {
        "job_id": job_id,
        "stdout": "Log de salida estándar del trabajo...",
        "stderr": "Log de errores (si los hay)...",
        "last_updated": datetime.now()
    }


@app.post("/api/jobs/analyze-script", tags=["Jobs"])
async def analyze_script(
    script_content: str,
    current_user: UserInfo = Depends(get_current_user)
):
    """
    Analiza un script y sugiere configuración óptima
    """
    # TEMPLATE: assistant = IntelligentJobAssistant()
    # suggestions = assistant.analyze_script(script_content)
    
    # Simulación para template
    return {
        "cpus": 8,
        "memory": "16GB",
        "gpu": 1,
        "walltime": "02:00:00",
        "partition": "gpu",
        "confidence": 0.85,
        "reasoning": [
            "Detectado PyTorch - recomendado GPU",
            "Operaciones matriciales intensivas - 8 CPUs",
            "Modelo de deep learning - 16GB RAM"
        ]
    }


@app.get("/api/files", tags=["Files"])
async def list_files(
    path: str = "/",
    current_user: UserInfo = Depends(get_current_user)
):
    """
    Lista archivos en el directorio del usuario
    """
    # TEMPLATE: file_manager = UserFileManager()
    # files = file_manager.list_directory(current_user.user_id, path)
    
    # Datos simulados para template
    return [
        {
            "name": "analysis.py",
            "type": "file",
            "size": 2048,
            "modified": "2024-01-15T14:30:00",
            "extension": "py"
        },
        {
            "name": "data",
            "type": "directory", 
            "size": 0,
            "modified": "2024-01-14T10:00:00",
            "items": 12
        }
    ]


@app.post("/api/files/upload", tags=["Files"])
async def upload_file(
    file: UploadFile = File(...),
    path: str = "/",
    current_user: UserInfo = Depends(get_current_user)
):
    """
    Sube un archivo al directorio del usuario
    """
    try:
        # TEMPLATE: file_manager = UserFileManager()
        # result = file_manager.upload_file(
        #     current_user.user_id, 
        #     file.file, 
        #     file.filename, 
        #     path
        # )
        
        return {
            "status": "success",
            "filename": file.filename,
            "size": file.size,
            "message": "Archivo subido exitosamente"
        }
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error subiendo archivo: {str(e)}"
        )


@app.get("/api/system/resources", response_model=SystemResourcesResponse, tags=["System"])
async def get_system_resources(current_user: UserInfo = Depends(get_current_user)):
    """
    Obtiene el estado de recursos del sistema
    """
    # TEMPLATE: Consultar sinfo, squeue, etc.
    
    return SystemResourcesResponse(
        cpu_usage=78.5,
        memory_usage=65.2,
        gpu_usage=45.0,
        active_jobs=12,
        queued_jobs=8,
        available_nodes=24
    )


@app.get("/api/history", tags=["History"])
async def get_job_history(
    days: int = 30,
    status_filter: Optional[str] = None,
    current_user: UserInfo = Depends(get_current_user)
):
    """
    Obtiene el historial de trabajos del usuario
    """
    # TEMPLATE: job_manager.get_job_history(current_user.user_id, days)
    
    # Datos simulados
    return [
        {
            "id": "job_hist_001",
            "name": "Análisis RNA-Seq completado",
            "status": "completed",
            "submit_time": "2024-01-15T14:30:00",
            "duration": "1h 45m",
            "cpus": 8,
            "memory": "16GB",
            "exit_code": 0
        }
    ]


@app.get("/api/templates", tags=["Templates"])
async def get_job_templates(current_user: UserInfo = Depends(get_current_user)):
    """
    Obtiene las plantillas de trabajo del usuario
    """
    # TEMPLATE: Consultar base de datos de plantillas
    
    return [
        {
            "id": "template_001",
            "name": "Análisis Genómico Estándar",
            "cpus": 8,
            "memory": "16GB",
            "partition": "general",
            "walltime": "04:00:00"
        },
        {
            "id": "template_002", 
            "name": "Deep Learning GPU",
            "cpus": 12,
            "memory": "32GB",
            "partition": "gpu",
            "gpu": 2,
            "walltime": "08:00:00"
        }
    ]


# Error handlers
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    return {
        "error": {
            "code": exc.status_code,
            "message": exc.detail,
            "timestamp": datetime.now().isoformat()
        }
    }


if __name__ == "__main__":
    # Configuración para desarrollo
    uvicorn.run(
        "fastapi_main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
