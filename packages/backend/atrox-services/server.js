// /opt/atrox-gateway/packages/backend/atrox-services/server.js

const express = require('express');
const { exec } = require('child_process');
const spawn = require('child_process').spawn;
const pam = require('authenticate-pam');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const sharedLibsPath = path.join(__dirname, '..', 'shared-libraries');
const { spawnWithTimeout } = require(path.join(sharedLibsPath, 'processUtils.js'));
const cryptoUtils = require(path.join(sharedLibsPath, 'cryptoUtils.js'));
const cache = require(path.join(sharedLibsPath, 'cache.js'));
const logger = require(path.join(sharedLibsPath, 'logger.js'));

const { PunManager } = require(path.join(sharedLibsPath, 'punManager.js'));
const RedisClient = require(path.join(sharedLibsPath, 'redisClient.js'));

const punDir = '/var/run/atrox-puns';
const NGINX_PUNS_ENABLED_DIR = '/etc/nginx/puns-enabled';
const NGINX_USER_MAP_PATH = '/etc/nginx/user_map.conf';

const app = express();
// Aumentar límite para permitir uploads en base64 (hasta ~250MB total en payload)
app.use(express.json({ limit: '250mb' }));
app.use(cookieParser());

// Middleware: normalizar respuestas JSON en un único formato
app.use((req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
        try {
            const status = res.statusCode || 200;
            // Si ya viene con la forma normalizada, no hacer wrapping
            if (body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'success')) {
                return originalJson(body);
            }
            if (status >= 400) {
                const message = (body && (body.message || body.error)) || 'Error';
                const payload = { success: false, message };
                if (body && typeof body === 'object') payload.detail = body;
                return originalJson(payload);
            }
            // Normal response
            const payload = { success: true, data: body, message: null };
            return originalJson(payload);
        } catch (e) {
            // In case wrapping fails, fall back to original
            return originalJson(body);
        }
    };
    next();
});

const JWT_SECRET = process.env.JWT_SECRET_KEY || 'insecure_default_secret';
const LISTEN_PORT = process.env.PORT || 3000;
const MANAGE_USER_SCRIPT_PATH = path.join(__dirname, '..', '..', '..', 'scripts', 'manage_user.sh');
// Script that updates NGINX upstreams and user map atomically
const UPDATE_NGINX_SCRIPT_PATH = path.join(__dirname, '..', '..', '..', 'scripts', 'update_nginx_config.sh');

const punManager = new PunManager(punDir, JWT_SECRET, RedisClient);
punManager.recoverState().then(() => {
    logger.info('Recuperación de estado completada. Portero listo para aceptar logins.');
}).catch(err => {
    logger.error('Error recuperando estado de PunManager', err);
});

const http = require('http');

const authenticateToken = (req, res, next) => {
    const token = req.cookies.access_token;
    if (!token) {
        // Si no hay token, no podemos saber quién es para hacer logout.
        // Podríamos simplemente limpiar cookies genéricas o devolver error.
        return res.status(401).json({ message: 'No session token found.' });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            // Si el token es inválido, la sesión ya no es válida. Limpiamos cookies y listo.
            console.warn('Logout attempt with invalid token:', err.message);
            res.clearCookie('user_session', { path: '/' });
            res.clearCookie('access_token', { httpOnly: true, path: '/' });
            return res.status(401).json({ message: 'Invalid token, cookies cleared.' });
        }
        // Si el token es válido, adjuntamos la info del usuario y continuamos al logout
        req.user = decoded;
        next();
    });
};

// --- NUEVA FUNCIÓN AUXILIAR ---
// Llama al script manage_user.sh para obtener el nivel de admin de un usuario
function getAdminLevelFromSlurm(username) {
    return new Promise((resolve, reject) => {
        const child = spawn('sudo', [MANAGE_USER_SCRIPT_PATH, 'show', username]);
        let output = '';
        let errorOutput = '';

        child.stdout.on('data', (data) => {
            output += data.toString();
        });
        child.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        child.on('close', (code) => {
            if (code !== 0) {
                console.error(`Script 'show' for '${username}' failed with code ${code}: ${errorOutput}`);
                // Si el script falla (ej. usuario no encontrado), asumimos que no es admin.
                return resolve('None');
            }
            try {
                const adminLine = output.split('\n').find(line => line.startsWith('adminLevel|'));
                const adminLevel = adminLine ? adminLine.split('|')[1] : 'None';
                resolve(adminLevel);
            } catch (e) {
                console.error(`Error parsing script output for '${username}':`, e);
                reject(new Error('Failed to parse user role.'));
            }
        });

        child.on('error', (err) => {
            console.error(`Failed to spawn manage_user.sh for '${username}':`, err);
            reject(err);
        });
    });
}

// Ejecuta un comando de shell y devuelve su salida como una promesa
function executeShellCommand(command, useSudo = false, timeoutMs = 30000) {
    // Avoid running bash as a login shell (-l) because some environments print banners
    // or welcome messages on login shells which pollute stdout and break parsing of
    // tools like sinfo/squeue/free/df. Use plain '-c' so we only execute the command.
    const runner = useSudo ? ['sudo', 'bash', '-c', command] : ['bash', '-c', command];
    const cmd = runner[0];
    const args = runner.slice(1);
    return spawnWithTimeout(cmd, args, { timeoutMs }).then(r => r.stdout).catch(err => {
        logger.error('executeShellCommand failed', { command, err: err.message });
        throw err;
    });
}

// Estadísticas globales: trabajos
async function getSlurmJobStats(username = null) {
    const key = `slurmJobStats:${username || 'all'}`;
    return cache.getOrSet(key, 5000, async () => {
        try {
            const output = await executeShellCommand('squeue -h -o "%T %u"');
            const lines = (output || '').trim().split('\n').filter(l => l.length > 0);
            let totalJobs = 0;
            let runningJobs = 0;
            let queuedJobs = 0;
            let completedToday = 0;
            const activeUsers = new Set();
            lines.forEach(line => {
                // split by whitespace: first token is state, rest is user
                const parts = line.trim().split(/\s+/);
                if (parts.length < 2) return; // ignore banner/garbage lines
                const stateRaw = (parts[0] || '').toString();
                const user = parts.slice(1).join(' ');
                // Normalize state: remove non-alpha chars and uppercase (handles RUNNING+, COMPLETED+, etc.)
                const state = stateRaw.toUpperCase().replace(/[^A-Z]/g, '');

                // Consider this line a valid job only if the state contains a known Slurm state token
                const knownStates = ['RUNNING','PENDING','CONFIGURING','REQUEUED','COMPLETED','CANCELLED','FAILED','TIMEOUT','SUSPENDED','COMPLETING','CONFIGURED'];
                if (!state || !knownStates.some(s => state.includes(s))) return;

                // It's a valid job line
                totalJobs++;
                if (user) activeUsers.add(user);
                if (state.includes('RUNNING')) runningJobs++;
                else if (['PENDING','CONFIGURING','REQUEUED'].some(s => state.includes(s))) queuedJobs++;
            });
            const today = new Date().toISOString().split('T')[0];
            const sacctKey = `sacct_completed_count:${today}`;
            // Cache sacct completed count for 5 seconds to avoid hammering accounting
            const completedOutput = await cache.getOrSet(sacctKey, 5000, async () => {
                const sacctCommand = `sacct -S ${today} -o State --noheader | grep -c COMPLETED`;
                return await executeShellCommand(sacctCommand, true);
            });
            completedToday = parseInt((completedOutput || '').trim()) || 0;
            return { totalJobs, runningJobs, queuedJobs, completedToday, activeUsers: activeUsers.size };
        } catch (e) {
            logger.error('getSlurmJobStats error', e);
            return { totalJobs:0, runningJobs:0, queuedJobs:0, completedToday:0, activeUsers:0 };
        }
    });
}

// Obtener historial de trabajos usando sacct
async function getJobHistory(username = null, days = 30) {
    const key = `jobHistory:${username || 'all'}:${days}`;
    // sacct queries can be expensive; cache sacct job history for a short window (5s)
    return cache.getOrSet(key, 5000, async () => {
        try {
            const since = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
            const fields = 'JobID,JobName,State,Submit,Start,End,Elapsed,AllocCPUS,ReqMem,ExitCode,User';
            const userFilter = username ? `-u ${username}` : '';
            const cmd = `sacct -P -n ${userFilter} -S ${since} -o ${fields}`;
            const out = await executeShellCommand(cmd, true);
            const lines = (out || '').trim().split('\n').filter(l => l.length > 0);
            const jobs = lines.map(line => {
                const parts = line.split('|');
                const [rawJobId, jobName, state, submit, start, end, elapsed, allocCpus, reqMem, exitCode, user] = parts.concat(Array(11).fill(null));
                const jobId = rawJobId ? rawJobId.split('.')[0] : rawJobId;
                return {
                    id: jobId || rawJobId,
                    name: jobName || null,
                    status: state ? state.toLowerCase() : null,
                    submit_time: submit || null,
                    start_time: start || null,
                    end_time: end || null,
                    duration: elapsed || null,
                    cpus: allocCpus ? parseInt(allocCpus, 10) : null,
                    memory: reqMem || null,
                    exit_code: exitCode ? (isNaN(parseInt(exitCode,10)) ? null : parseInt(exitCode,10)) : null,
                    user: user || null
                };
            });
            const seen = new Set();
            const uniq = [];
            for (const j of jobs) {
                if (!j.id) continue;
                if (seen.has(j.id)) continue;
                seen.add(j.id);
                uniq.push(j);
            }
            return uniq;
        } catch (e) {
            logger.error('getJobHistory error', e);
            throw e;
        }
    });
}

// Estadísticas globales: recursos del sistema
async function getSystemResourceUsage() {
    try {
        const memOutput = await executeShellCommand('free -m');
        const memLines = (memOutput || '').split('\n');
        const memParts = memLines[1] ? memLines[1].split(/\s+/) : [];
        const memTotal = parseInt(memParts[1] || '0');
        const memUsed = parseInt(memParts[2] || '0');
        const memoryUsage = memTotal > 0 ? Math.floor((memUsed / memTotal) * 100) : 0;

        const storageOutput = await executeShellCommand('df -h /');
        const storageLine = (storageOutput || '').split('\n')[1] || '';
        const storageUsage = parseInt((storageLine.split(/\s+/)[4] || '0').replace('%','')) || 0;

        const readCpuStat = () => {
            try {
                const stat = fs.readFileSync('/proc/stat', 'utf8');
                const cpuLine = stat.split('\n').find(l => l.startsWith('cpu '));
                if (!cpuLine) return null;
                const parts = cpuLine.trim().split(/\s+/).slice(1).map(p => parseInt(p, 10) || 0);
                const idle = (parts[3] || 0) + (parts[4] || 0);
                const total = parts.reduce((a, b) => a + b, 0);
                return { idle, total };
            } catch (e) {
                logger.warn('readCpuStat failed', e);
                return null;
            }
        };

        const a = readCpuStat();
        await new Promise(r => setTimeout(r, 200));
        const b = readCpuStat();
        let cpuUsage = 0;
        if (a && b) {
            const idleDelta = b.idle - a.idle;
            const totalDelta = b.total - a.total;
            cpuUsage = totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 100) : 0;
        }

        return { cpuUsage, memoryUsage, storageUsage };
    } catch (e) {
        logger.error('getSystemResourceUsage error', e);
        return { cpuUsage:0, memoryUsage:0, storageUsage:0 };
    }
}

// Estadísticas globales: nodos Slurm
async function getSlurmNodeStats() {
    try {
        // Request per-node output from sinfo (-N) so we count nodes individually instead of aggregated partition lines
        // Use "%N %T" so we can robustly parse the node name and its state (state is the last token)
        // Cache the raw sinfo output for a short time (5s) to reduce repeated slurm calls under load
        const output = await cache.getOrSet('sinfo_per_node', 5000, async () => {
            return await executeShellCommand('sinfo -h -N -o "%N %T"');
        });
            const lines = (output || '').trim().split('\n').filter(l => l.length > 0);
            console.log('sinfo per-node output lines (count=' + lines.length + '):', lines.slice(0, 20)); // Log a sample for debugging

            // Build a map nodeName -> most severe state seen for that node (dedupe across partitions/lines)
            const nodeStateMap = new Map();
            const severity = (st) => {
                if (!st) return 0;
                const s = st.toUpperCase();
                if (['DRAINED','DOWN','ERROR','FAIL','UNKNOWN','DRAIN'].includes(s)) return 4;
                if (['MAINT','MAINTENANCE'].includes(s)) return 3;
                if (['ALLOCATED','MIXED','ALLOC'].includes(s)) return 2;
                // IDLE and others are least severe
                return 1;
            };

            lines.forEach(line => {
                const parts = line.trim().split(/\s+/);
                if (parts.length < 2) return;
                const stateRaw = parts[parts.length - 1].toUpperCase();
                const nodeName = parts.slice(0, parts.length - 1).join(' ');

                const existing = nodeStateMap.get(nodeName);
                if (!existing) {
                    nodeStateMap.set(nodeName, stateRaw);
                } else {
                    // keep the most severe state
                    const existingScore = severity(existing);
                    const newScore = severity(stateRaw);
                    if (newScore > existingScore) nodeStateMap.set(nodeName, stateRaw);
                }
            });

            let nodesActive = 0, nodesMaintenance = 0, nodesErrors = 0;
            for (const [n, st] of nodeStateMap.entries()) {
                if (['ALLOCATED', 'MIXED', 'ALLOC'].includes(st)) nodesActive++;
                else if (['MAINT', 'MAINTENANCE'].includes(st)) nodesMaintenance++;
                else if (['DRAINED', 'DOWN', 'ERROR', 'FAIL', 'UNKNOWN', 'DRAIN'].includes(st)) nodesErrors++;
            }

            const nodesTotal = nodeStateMap.size; // distinct nodes
            const nodesAvailable = Math.max(0, nodesTotal - nodesMaintenance - nodesErrors - nodesActive);
        return { nodesActive, nodesMaintenance, nodesAvailable, nodesErrors, nodesTotal };
    } catch (e) {
        console.error('getSlurmNodeStats error', e);
        return { nodesActive:0, nodesMaintenance:0, nodesAvailable:0, nodesErrors:0, nodesTotal:0 };
    }
}

// Return a map of nodeName -> slurmState using sinfo per-node output
async function getSlurmNodeStateMap() {
    try {
            // Use the same cached sinfo_per_node to avoid duplicate calls
            const output = await cache.getOrSet('sinfo_per_node', 5000, async () => {
                return await executeShellCommand('sinfo -h -N -o "%N %T"');
            });
        const lines = (output || '').trim().split('\n').filter(l => l.length > 0);
        const map = {};
        lines.forEach(line => {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 2) {
                const state = parts[parts.length - 1].toUpperCase();
                const nodeName = parts.slice(0, parts.length - 1).join(' ');
                map[nodeName] = state;
            }
        });
        return map;
    } catch (e) {
        console.error('getSlurmNodeStateMap error', e);
        return {};
    }
}

// Estadísticas detalladas para nodos específicos (CPU/Mem asignado vs capacidad)
async function getComputeNodeStats(nodes = []) {
    try {
        const results = [];
        for (const node of nodes) {
            try {
                // scontrol show node <node> -o -> key=value tokens
                const out = await executeShellCommand(`scontrol show node ${node} -o`);
                const tok = out.trim().split(/\s+/);
                const data = {};
                tok.forEach(t => {
                    if (!t.includes('=')) return;
                    const [k, v] = t.split('=');
                    data[k] = v;
                });

                const cpuTot = parseInt(data.CPUTot || '0', 10);
                const cpuAlloc = parseInt(data.CPUAlloc || data.CPUAlloc || '0', 10);
                const cpuLoad = parseFloat(data.CPULoad || '0') || 0;
                const realMem = parseInt(data.RealMemory || '0', 10); // MB
                const allocMem = parseInt(data.AllocMem || '0', 10); // MB

                const cpuAssignedPct = cpuTot > 0 ? Math.round((cpuAlloc / cpuTot) * 100) : 0;
                const memAssignedPct = realMem > 0 ? Math.round((allocMem / realMem) * 100) : 0;

                results.push({
                    node,
                    cpuTot,
                    cpuAlloc,
                    cpuAssignedPct,
                    cpuLoad,
                    realMemMB: realMem,
                    allocMemMB: allocMem,
                    memAssignedPct
                });
            } catch (e) {
                console.error(`Error getting scontrol for node ${node}:`, e);
                results.push({ node, error: String(e) });
            }
        }
        return results;
    } catch (e) {
        console.error('getComputeNodeStats error', e);
        return nodes.map(n => ({ node: n, error: String(e) }));
    }
}

// Intento de obtener uso de disco para el nodo de storage buscando montajes NFS locales
async function getStorageUsageForNode(nodeName) {
    try {
        // Obtener todas las líneas de mount; usar '|| true' para evitar código de salida !=0
        const mountOut = await executeShellCommand('mount || true');
        const mountLines = mountOut.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        // Intentar encontrar una línea que contenga el nombre del nodo
        let chosen = mountLines.find(l => l.includes(nodeName));
        if (!chosen) {
            // Si no encontramos por nombre, elegir el primer montaje NFS disponible (nfs o nfs4)
            chosen = mountLines.find(l => l.includes(' type nfs') || l.includes(' type nfs4'));
        }

        if (!chosen) return { error: 'No NFS mount found locally' };

        // Formato esperado: '<source> on <mountpoint> type nfs...'
        const onIndex = chosen.indexOf(' on ');
        if (onIndex === -1) return { error: 'Unexpected mount line format' };
        const source = chosen.substring(0, onIndex).trim();
        const afterOn = chosen.substring(onIndex + 4);
        const typeIndex = afterOn.indexOf(' type ');
        const mountpoint = typeIndex !== -1 ? afterOn.substring(0, typeIndex).trim() : afterOn.split(/	|\s+/)[0];

        // Ejecutar df de forma robusta
        const dfOut = await executeShellCommand(`df -P ${mountpoint}`);
        const dfLines = dfOut.trim().split('\n');
        if (dfLines.length < 2) return { error: 'df output unexpected' };
        const cols = dfLines[1].split(/\s+/);
        // cols: Filesystem, 1K-blocks, Used, Available, Use%, Mounted on
        const sizeKB = parseInt(cols[1] || '0', 10);
        const usedKB = parseInt(cols[2] || '0', 10);
        const availKB = parseInt(cols[3] || '0', 10);
        const usePercent = parseInt((cols[4] || '0').replace('%',''), 10) || 0;

        return { source, mountpoint, sizeKB, usedKB, availKB, usePercent };
    } catch (e) {
        return { error: String(e) };
    }
}


// Mount auth routes under /api/v1/auth
const authRouter = express.Router();

// Endpoint público para crear una solicitud de registro pendiente de aprobación
authRouter.post('/register', async (req, res) => {
    const { username, email, password, justification } = req.body || {};

    if (!username || !email || !password) {
        return res.status(400).json({ message: 'username, email and password are required.' });
    }

    // Require a short justification so admins have context when approving
    if (!justification || justification.toString().trim().length < 10) {
        return res.status(400).json({ message: 'justification is required (min 10 characters).' });
    }

    try {
        // Si ya existe una cuenta del sistema (mostrar/consultar), rechazamos
        const adminLevel = await getAdminLevelFromSlurm(username);
        if (adminLevel && adminLevel !== 'None') {
            return res.status(409).json({ success:false, message: 'El usuario ya existe en el sistema.' });
        }

        // Verificar si ya hay una solicitud pendiente en Redis
        const pendingKey = `pending:${username}`;
        const existing = await RedisClient.get(pendingKey);
        if (existing) {
            return res.status(409).json({ message: 'A registration request for this username is already pending.' });
        }

        if (!process.env.REGISTRATION_KEY) {
            logger.error('REGISTRATION_KEY not set, refusing to store passwords even encrypted');
            return res.status(500).json({ success:false, message: 'Configuración del servidor incompleta. CONTACT_ADMIN', code: 'CONFIG' });
        }
        const encryptedPassword = cryptoUtils.encrypt(password);
        const payload = JSON.stringify({ username, email, encryptedPassword, justification: justification.toString().trim(), createdAt: new Date().toISOString() });
        await RedisClient.set(pendingKey, payload);
        return res.status(202).json({ success:true, message: 'Solicitud recibida y pendiente de aprobación por admin.' });

    } catch (error) {
        console.error('Error handling registration request:', error);
        return res.status(500).json({ message: 'Internal server error.' });
    }
});

// Endpoint público para checar disponibilidad de username (real-time friendly)
// GET /api/v1/auth/check-username?username=foo
authRouter.get('/check-username', async (req, res) => {
    const username = (req.query.username || '').toString().trim();
    if (!username) return res.status(400).json({ available: false, message: 'username query param required' });

    try {
        const adminLevel = await getAdminLevelFromSlurm(username);
        if (adminLevel && adminLevel !== 'None') return res.json({ available: false, message: 'El usuario ya existe en el sistema' });
        const pendingKey = `pending:${username}`;
        const existing = await RedisClient.get(pendingKey);
        if (existing) {
            try {
                const parsed = JSON.parse(existing);
                if (parsed && parsed.encryptedPassword) return res.json({ available: false, message: 'Ya existe una solicitud pendiente para este usuario' });
            } catch (e) {
                // If parsing fails, treat as pending to be safe
                return res.json({ available: false, message: 'Ya existe una solicitud pendiente para este usuario' });
            }
        }
        return res.json({ available: true, message: 'Usuario disponible' });
    } catch (err) {
        logger.error('Error comprobando disponibilidad de username', { username, err });
        return res.status(500).json({ available: false, message: 'Error interno' });
    }
});

authRouter.post('/login', async (req, res) => {
    const { username, password } = req.body || {};

    if (!username || !password) {
        return res.status(400).json({ message: 'username and password are required.' });
    }

    // Comprobar si existe una solicitud de registro pendiente para este usuario
    try {
        const pending = await RedisClient.get(`pending:${username}`);
        if (pending) {
            return res.status(403).json({ message: 'Registration pending approval.' });
        }
    } catch (err) {
        console.warn('Could not check pending registration for', username, err);
    }

    pam.authenticate(username, password, async (err) => {
        if (err) {
            console.error(`PAM authentication failed for user '${username}':`, err);
            return res.status(401).json({ message: 'Authentication failed.' });
        }
        console.log(`PAM authentication succeeded for user '${username}'.`);

        const userCodePath = path.join(__dirname, '..', 'atrox-user-pun', 'user-server.js');
        const socketPath = path.join(punDir, `${username}.socket`);

        try {
            // --- LÓGICA DE ROL DINÁMICA ---
            const adminLevel = await getAdminLevelFromSlurm(username);
            let role = 'user'; // Rol por defecto
            try {
                const normalized = (adminLevel || '').toString().trim().toLowerCase();
                if (username === 'atroxgateway' || normalized.includes('admin')) {
                    role = 'admin';
                    console.log(`User '${username}' granted ADMIN role (adminLevel='${adminLevel}').`);
                } else {
                    console.log(`User '${username}' granted USER role (adminLevel='${adminLevel}').`);
                }
            } catch (e) {
                console.warn('Could not normalize adminLevel, defaulting to user:', adminLevel, e);
            }
            // --- FIN DE LA LÓGICA ---

            console.log(`Attempting to check or create PUN for user '${username}'...`);
            await punManager.checkOrCreatePUN(username, userCodePath);
            console.log(`PUN check/creation completed for user '${username}'. Socket path: ${socketPath}`);

            // Delegate NGINX config update to external script to avoid complicated
            // shell-injection / quoting issues inside Node and to keep server code small.
            console.log(`Updating NGINX configuration via script for '${username}'...`);
            try {
                const updater = spawn('sudo', ['/bin/bash', UPDATE_NGINX_SCRIPT_PATH, username, socketPath]);
                let upOut = '';
                let upErr = '';
                updater.stdout.on('data', (d) => { upOut += d.toString(); });
                updater.stderr.on('data', (d) => { upErr += d.toString(); });
                updater.on('close', (code) => {
                    if (code !== 0) {
                        console.error(`CRITICAL NGINX CONFIG UPDATE FAIL for '${username}': exit ${code}`, upErr.trim());
                    } else {
                        console.log(`✅ NGINX reconfigured successfully for ${username}.`, upOut.trim());
                    }
                });
            } catch (e) {
                console.error('Failed to spawn nginx update script:', e);
            }

            const token = jwt.sign({ sub: username, role: role }, JWT_SECRET, { expiresIn: '1h' });
            res.cookie('user_session', username, { path: '/', maxAge: 3600000, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
            res.cookie('access_token', token, { httpOnly: true, path: '/', maxAge: 3600000, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
            return res.json({ message: 'Login successful.', role: role });

        } catch (error) {
            console.error("Error during session setup:", error);
            return res.status(500).json({ message: 'Internal error during session setup.' });
        }
    }, { serviceName: 'login' });
});

authRouter.post('/logout', authenticateToken, async (req, res) => {
    // El middleware 'authenticateToken' ya verificó el JWT
    const username = req.user.sub; // Obtenemos el username del token verificado

    console.log(`Logout request received for verified user '${username}'.`);

    try {
        const stopped = await punManager.stopPUN(username);

        if (!stopped) {
            console.warn(`Logout: PUN for ${username} was not found in PunManager.`);
        }

        const nginxPunConfPath = path.join(NGINX_PUNS_ENABLED_DIR, `${username}.conf`);

        const activePuns = punManager.getActivePuns();
        let mapFileContent = '';
         if (activePuns && typeof activePuns.keys === 'function') {
            for (const user of activePuns.keys()) {
                // Corregido: Asegúrate de que la sintaxis sea correcta
                mapFileContent += `"${user}" "${user}_pun_backend";\n`;
            }
        } else {
            console.error("Error: activePuns no es iterable o getActivePuns no devolvió un Map.");
        }


        // Delegate nginx cleanup to update_nginx_config.sh in --remove mode
        try {
            const updater = spawn('sudo', ['/bin/bash', UPDATE_NGINX_SCRIPT_PATH, '--remove', username]);
            let upOut = '';
            let upErr = '';
            updater.stdout.on('data', (d) => { upOut += d.toString(); });
            updater.stderr.on('data', (d) => { upErr += d.toString(); });
            updater.on('close', (code) => {
                if (code !== 0) {
                    console.error(`Error cleaning up NGINX config for ${username}: exit ${code}`, upErr.trim());
                } else {
                    console.log(`✅ NGINX configuration cleaned up for ${username}.`, upOut.trim());
                }
            });
        } catch (e) {
            console.error('Failed to spawn nginx update script for remove:', e);
        }

        res.clearCookie('user_session', { path: '/' });
        res.clearCookie('access_token', { httpOnly: true, path: '/' });

        return res.json({ message: 'Logout successful.' });

    } catch (error) {
        console.error(`Error during logout for ${username}:`, error);
        res.clearCookie('user_session', { path: '/' });
        res.clearCookie('access_token', { httpOnly: true, path: '/' });
        return res.status(500).json({ message: 'Internal error during logout.' });
    }
});

// mount auth router
app.use('/api/v1/auth', authRouter);
// Mount dashboard router
// (mounted later)

// Generic GET proxy for user PUN endpoints (ensures new PUN routes are reachable without extra gateway wiring)
app.get('/api/v1/user/*', async (req, res) => {
    const token = req.cookies.access_token;
    if (!token) return res.status(401).json({ success:false, message: 'No session token' });
    let decoded = null;
    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch (e) {
        return res.status(401).json({ success:false, message: 'Invalid session token' });
    }

    const username = decoded.sub;
    if (!username) return res.status(400).json({ success:false, message: 'Invalid token: missing username' });

    try {
        const activePuns = punManager.getActivePuns();
        const punInfo = activePuns.get(username);
        if (!punInfo || !punInfo.socketPath) {
            return res.status(503).json({ success:false, message: 'User PUN not available' });
        }

        const http = require('http');
        const options = {
            socketPath: punInfo.socketPath,
            path: req.originalUrl,
            method: 'GET',
            headers: {
                'Cookie': `access_token=${token}`
            },
            timeout: 5000
        };

        const udsReq = http.request(options, (udsRes) => {
            let body = '';
            udsRes.on('data', (chunk) => { body += chunk.toString(); });
            udsRes.on('end', () => {
                // Try to forward content-type; fallback to json
                const ctype = udsRes.headers['content-type'] || 'application/json; charset=utf-8';
                res.status(udsRes.statusCode || 200).set('content-type', ctype).send(body);
            });
        });
        udsReq.on('error', (err) => {
            return res.status(502).json({ success:false, message: 'Failed to reach PUN', detail: err.message });
        });
        udsReq.on('timeout', () => {
            udsReq.destroy();
            return res.status(504).json({ success:false, message: 'PUN request timed out' });
        });
        udsReq.end();
    } catch (e) {
        return res.status(500).json({ success:false, message: 'Internal server error' });
    }
});

// Dashboard router: sirve estadísticas globales para admins y proxifica a PUNs para usuarios
const dashboardRouter = express.Router();

dashboardRouter.get('/stats', async (req, res) => {
    const token = req.cookies.access_token;
    if (!token) return res.status(401).json({ success:false, message: 'No session token' });

    let decoded = null;
    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch (e) {
        console.warn('Invalid token in /dashboard/stats request:', e.message);
        return res.status(401).json({ success:false, message: 'Invalid session token' });
    }

    try {
        // Siempre obtener las estadísticas de nodos globales
        const globalNodeStats = await getSlurmNodeStats();

        if (decoded && decoded.role === 'admin') {
            // Servir estadísticas globales (incluyendo las de nodos)
            const adminUsername = decoded.sub; // Obtener el nombre de usuario del token
            const [jobStats, resourceUsage] = await Promise.all([
                getSlurmJobStats(adminUsername), // Pasar el nombre de usuario del admin
                getSystemResourceUsage()
            ]);

            // Obtener estadísticas detalladas para los nodos de cómputo indicados
            // NOTE: usar explícitamente node-01 y node-02 para cómputo y node-storage para almacenamiento
            const nodesToQuery = ['node-01', 'node-02', 'node-storage'];
            let perNodeStats = [];
            try {
                perNodeStats = await getComputeNodeStats(nodesToQuery);
            } catch (e) {
                console.warn('Failed to get per-node compute stats:', e);
                perNodeStats = nodesToQuery.map(n => ({ node: n, error: String(e) }));
            }

            const computeNodes = perNodeStats.filter(p => p.node && (p.node === 'node-01' || p.node === 'node-02'));
            const storageNode = perNodeStats.find(p => p.node === 'node-storage') || null;

            const payload = Object.assign({}, jobStats, resourceUsage, globalNodeStats, {
                computeNodes,
                storageNode
            });
            return res.json({ success: true, data: payload });
        }

        // No es admin => proxificar a PUN del usuario
        const username = decoded.sub;
        if (!username) return res.status(400).json({ success:false, message: 'Invalid token: missing username' });

        const activePuns = punManager.getActivePuns();
        const punInfo = activePuns.get(username);
        if (!punInfo || !punInfo.socketPath) {
            return res.status(503).json({ success:false, message: 'User PUN not available' });
        }

        const options = {
            socketPath: punInfo.socketPath,
            path: '/api/v1/user/dashboard/stats',
            method: 'GET',
            headers: {
                'Cookie': `access_token=${token}`
            },
            timeout: 5000
        };

        // For non-admin users, we still want to include global node summaries (state per node)
        // but we must not expose privileged per-node compute details. Build a lightweight nodes list
        // from sinfo (name + state) and also include lightweight global job/resource summaries
        // fetched locally so the frontend shows consistent totals.
        let nodesSummary = [];
        let jobStats = { totalJobs: 0, runningJobs: 0, queuedJobs: 0, completedToday: 0, activeUsers: 0 };
        let resourceUsage = { cpuUsage: 0, memoryUsage: 0, storageUsage: 0 };
        try {
            const stateMap = await getSlurmNodeStateMap();
            nodesSummary = Object.keys(stateMap).map(n => ({ name: n, state: stateMap[n] }));
        } catch (e) {
            console.warn('Could not build nodes summary for non-admin proxied response:', e);
            nodesSummary = [];
        }
        try {
            // Obtain lightweight globals (non-privileged) to merge into the proxied user response
            jobStats = await getSlurmJobStats();
        } catch (e) {
            console.warn('Could not obtain slurm job stats for non-admin response:', e);
        }
        try {
            resourceUsage = await getSystemResourceUsage();
        } catch (e) {
            console.warn('Could not obtain system resource usage for non-admin response:', e);
        }

        const udsReq = http.request(options, (udsRes) => {
            let body = '';
            udsRes.on('data', (chunk) => { body += chunk.toString(); });
            udsRes.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    if (!parsed.data) parsed.data = {};
                    // Build final data preferring PUN-provided fields but falling back to
                    // reliable global values for counts and resource usage when PUN omits them
                    const final = Object.assign({}, parsed.data);

                    const fillIfMissing = (key, src) => {
                        if (typeof final[key] !== 'number' || isNaN(final[key])) {
                            if (typeof src[key] === 'number') final[key] = src[key];
                        }
                    };

                    // Fill numeric job/resource/node totals from local sources when missing
                    [
                        ['totalJobs', jobStats],
                        ['runningJobs', jobStats],
                        ['queuedJobs', jobStats],
                        ['completedToday', jobStats],
                        ['activeUsers', jobStats],
                        ['cpuUsage', resourceUsage],
                        ['memoryUsage', resourceUsage],
                        ['storageUsage', resourceUsage],
                        ['nodesActive', globalNodeStats],
                        ['nodesMaintenance', globalNodeStats],
                        ['nodesAvailable', globalNodeStats],
                        ['nodesErrors', globalNodeStats]
                    ].forEach(([k, src]) => fillIfMissing(k, src));

                    // Ensure nodes array exists (use nodesSummary if PUN didn't include nodes)
                    if (!Array.isArray(final.nodes) || final.nodes.length === 0) {
                        final.nodes = nodesSummary;
                    }

                    parsed.data = final;
                    return res.status(udsRes.statusCode || 200).json(parsed);
                } catch (e) {
                    console.error('Error parsing PUN response:', e, 'raw:', body);
                    return res.status(502).json({ success:false, message: 'Invalid response from PUN' });
                }
            });
        });

        udsReq.on('error', (err) => {
            console.error('Error connecting to PUN socket:', err.message);
            return res.status(502).json({ success:false, message: 'Failed to reach PUN', detail: err.message });
        });

        udsReq.on('timeout', () => {
            udsReq.destroy();
            return res.status(504).json({ success:false, message: 'PUN request timed out' });
        });

        udsReq.end();

    } catch (e) {
        console.error('Error in /api/v1/dashboard/stats:', e);
        return res.status(500).json({ success:false, message: 'Internal server error' });
    }
});

// Optional helper endpoint returning per-node details (admin-only)
dashboardRouter.get('/nodes', async (req, res) => {
    const token = req.cookies.access_token;
    if (!token) return res.status(401).json({ success:false, message: 'No session token' });
    let decoded = null;
    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch (e) {
        console.warn('Invalid token in /dashboard/nodes request:', e.message);
        return res.status(401).json({ success:false, message: 'Invalid session token' });
    }

    try {
        if (!decoded || decoded.role !== 'admin') return res.status(403).json({ success:false, message: 'Forbidden: admin only' });

        const globalNodeStats = await getSlurmNodeStats();
        const nodesToQuery = ['node-01', 'node-02', 'node-storage'];
        let perNodeStats = [];
        try {
            perNodeStats = await getComputeNodeStats(nodesToQuery);
        } catch (e) {
            console.warn('Failed to get per-node compute stats for /nodes:', e);
            perNodeStats = nodesToQuery.map(n => ({ node: n, error: String(e) }));
        }

        const computeNodes = perNodeStats.filter(p => p.node && (p.node === 'node-01' || p.node === 'node-02'));
        const storageNode = perNodeStats.find(p => p.node === 'node-storage') || null;

        // Try to enrich per-node results with Slurm state from sinfo
        const stateMap = await getSlurmNodeStateMap();
        const enrich = (item) => {
            if (!item) return item;
            const name = item.node || item.nodeName || item.node || item.node;
            const st = stateMap[name];
            if (st) item.state = st;
            return item;
        };

        const enrichedCompute = computeNodes.map(enrich);
        const enrichedStorage = enrich(storageNode);

        const payload = Object.assign({}, globalNodeStats, { computeNodes: enrichedCompute, storageNode: enrichedStorage });
        return res.json({ success: true, data: payload });
    } catch (e) {
        console.error('Error in /api/v1/dashboard/nodes:', e);
        return res.status(500).json({ success:false, message: 'Internal server error' });
    }
});

app.use('/api/v1/dashboard', dashboardRouter);

const jobsRouter = express.Router();

// Return list of known users from sacct (admin-only)
jobsRouter.get('/users', authenticateToken, async (req, res) => {
    try {
        const decoded = req.user || null;
        if (!decoded || decoded.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });
        const days = parseInt(req.query.days || '30', 10) || 30;
        const since = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
        // Request User field from sacct; -P pipe format and -n no header
        const cmd = `sacct -P -n -S ${since} -o User`;
        const usersKey = `sacct_users:${since}`;
        // Cache sacct user list briefly (5s)
        const out = await cache.getOrSet(usersKey, 5000, async () => {
            return await executeShellCommand(cmd, true);
        });
        const lines = out.trim().split('\n').filter(l => l && l.trim().length > 0);
        const users = lines.map(l => (l || '').toString().trim()).filter(u => !!u);
        const uniq = Array.from(new Set(users)).sort();
        return res.json(uniq);
    } catch (e) {
        console.error('/api/v1/jobs/users error', e);
        return res.status(500).json({ success: false, message: 'Failed to list users', detail: String(e) });
    }
});

// History endpoint: devuelve historial de trabajos del usuario (o global para admins)
jobsRouter.get('/history', authenticateToken, async (req, res) => {
    try {
        const days = parseInt(req.query.days || '30', 10) || 30;
        const statusFilter = (req.query.status_filter || '').toString().toLowerCase();
        const decoded = req.user || null; // authenticateToken sets req.user

        // If admin, allow local sacct query. If req.query.user provided, filter by that user,
        // otherwise return global history (all users).
        if (decoded && decoded.role === 'admin') {
            const targetUser = req.query.user ? req.query.user.toString() : null;
            const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit || '50', 10) || 50));
            const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
            const history = await getJobHistory(targetUser, days);
            let filtered = history;
            if (statusFilter && statusFilter !== 'all') {
                const want = statusFilter;
                filtered = history.filter(h => (h.status || '').toString().toLowerCase().includes(want));
            }
            // Ensure ordering by numeric job id descending (highest ID first)
            filtered = (filtered || []).slice().sort((a, b) => {
                const aId = parseInt(String(a?.id || '').replace(/\D/g, ''), 10) || 0;
                const bId = parseInt(String(b?.id || '').replace(/\D/g, ''), 10) || 0;
                return bId - aId;
            });
            // Apply pagination server-side for admin requests
            const sliced = filtered.slice(offset, offset + limit);
            return res.json(sliced);
        }

        // For non-admin users, proxy to their PUN (user-server) over UDS
        if (!decoded) return res.status(401).json({ success:false, message: 'No session' });
        const username = decoded.sub;
        const activePuns = punManager.getActivePuns();
        const punInfo = activePuns.get(username);
        if (!punInfo || !punInfo.socketPath) {
            return res.status(503).json({ success:false, message: 'User PUN not available' });
        }

        const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit || '50', 10) || 50));
        const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
        const options = {
            socketPath: punInfo.socketPath,
            path: `/api/v1/user/history?days=${days}${statusFilter ? `&status_filter=${encodeURIComponent(statusFilter)}` : ''}&limit=${limit}&offset=${offset}`,
            method: 'GET',
            headers: {
                'Cookie': `access_token=${req.cookies.access_token || ''}`
            },
            timeout: 5000
        };

        const udsReq = http.request(options, (udsRes) => {
            let body = '';
            udsRes.on('data', (chunk) => { body += chunk.toString(); });
            udsRes.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    return res.status(udsRes.statusCode || 200).json(parsed);
                } catch (e) {
                    console.error('Error parsing PUN history response:', e, 'raw:', body);
                    return res.status(502).json({ success:false, message: 'Invalid response from PUN' });
                }
            });
        });

        udsReq.on('error', (err) => {
            console.error('Error connecting to PUN socket for history:', err.message);
            return res.status(502).json({ success:false, message: 'Failed to reach PUN', detail: err.message });
        });

        udsReq.on('timeout', () => {
            udsReq.destroy();
            return res.status(504).json({ success:false, message: 'PUN request timed out' });
        });

        udsReq.end();
    } catch (e) {
        console.error('/api/v1/jobs/history error', e);
        return res.status(500).json({ success:false, message: 'Failed to retrieve history', detail: String(e) });
    }
});

app.use('/api/v1/jobs', jobsRouter);

// Compatibility route: keep previous frontend path `/api/history` working
app.get('/api/history', authenticateToken, (req, res) => {
    const qs = new URLSearchParams(req.query).toString();
    // Use 307 to preserve method semantics (GET)
    res.redirect(307, `/api/v1/jobs/history${qs ? `?${qs}` : ''}`);
});

// Global error handler (normalizado)
app.use((err, req, res, next) => {
    logger.error('Unhandled error', { err: (err && (err.stack || err.message)) || String(err) });
    if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Error interno' });
    } else {
        next(err);
    }
});

app.listen(LISTEN_PORT, () => {
    logger.info({ msg: 'Portero service listening', port: LISTEN_PORT });
});
