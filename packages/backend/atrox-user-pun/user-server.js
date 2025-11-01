// /opt/atrox-gateway/packages/backend/atrox-user-pun/user-server.js

const express = require('express');
const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
const socketPath = process.argv[2]; 
const JWT_SECRET = process.env.JWT_SECRET_KEY || 'insecure_default_secret';

const WWW_DATA_GID = 33;

app.use(cookieParser());
// Parse JSON bodies (required for file create/update/upload which send base64 payloads)
app.use(express.json({ limit: '250mb' }));

function cleanupAndExit() {
    if (fs.existsSync(socketPath)) {
        fs.unlinkSync(socketPath);
        console.log(`Socket ${socketPath} cleaned up.`);
    }
    process.exit(0);
}
process.on('SIGINT', cleanupAndExit);
process.on('SIGTERM', cleanupAndExit);

if (fs.existsSync(socketPath)) {
    fs.unlinkSync(socketPath);
}

const touchSocketMiddleware = (req, res, next) => {
    // Escucha el evento 'finish' que se dispara cuando la respuesta se ha enviado
    res.on('finish', () => {
        try {
            const now = new Date();
            fs.utimesSync(socketPath, now, now); 
        } catch (err) {
        }
    });
    next(); 
};
app.use(touchSocketMiddleware);


const authenticateToken = (req, res, next) => {
    const token = req.cookies.access_token;
    if (!token) {
        return res.status(401).send('Access Denied: No token provided.');
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).send('Access Forbidden: Invalid token.');
        }

        const processUser = os.userInfo().username;
        if (decoded.sub !== processUser) {
            console.error(`SECURITY ALERT: Process for user '${processUser}' received a token for user '${decoded.sub}'.`);
            return res.status(403).send('Access Forbidden: Token-process mismatch.');
        }

        req.user = decoded;
        next();
    });
};

function parseLsOutput(output, currentPath) {
    // Quita la primera línea ('total X')
    const lines = output.trim().split('\n').slice(1); 
    
    return lines.map(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 8) return null; // Saltar líneas no válidas

        const permissions = parts[0];
        const numLinks = parts[1];
        const owner = parts[2];
        const group = parts[3];
        const size = parts[4];
        const month = parts[5];
        const day = parts[6];
        const timeOrYear = parts[7];
        const name = parts.slice(8).join(' '); // El nombre puede contener espacios

        const isDirectory = permissions.startsWith('d');
        const extensionMatch = name.match(/\.([0-9a-z]+)(?:[?#]|$)/i);
        const extension = isDirectory ? undefined : (extensionMatch ? extensionMatch[1] : undefined);

        return {
            id: `${currentPath}/${name}`, // Usar la ruta completa como ID
            name: name,
            type: isDirectory ? 'folder' : 'file',
            size: isDirectory ? '-' : size,
            modified: `${month} ${day} ${timeOrYear}`,
            owner: owner,
            group: group,
            permissions: permissions,
            extension: extension
        };
    }).filter(item => item !== null && item.name !== '.' && item.name !== '..'); // Excluir . y ..
}

// Ejecuta un comando de shell y devuelve su salida como una promesa
function executeShellCommand(command) {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error ejecutando comando: ${command}\nStderr: ${stderr}`);
                return reject(new Error(`Comando fallido: ${command}`));
            }
            resolve(stdout);
        });
    });
}

// Obtiene estadísticas de trabajos de Slurm para un usuario específico
async function getUserSlurmJobStats(username) {
    try {
        const output = await executeShellCommand(`squeue -h -u ${username} -o "%T"`);
        const lines = output.trim().split('\n').filter(line => line.length > 0);

        let totalJobs = lines.length;
        let runningJobs = 0;
        let queuedJobs = 0;
        let completedToday = 0;

        lines.forEach(state => {
            if (state === 'RUNNING') {
                runningJobs++;
            } else if (['PENDING', 'CONFIGURING', 'REQUEUED'].includes(state)) {
                queuedJobs++;
            }
        });

        // Obtener trabajos completados hoy usando sacct para el usuario específico
        const today = new Date().toISOString().split('T')[0]; // Formato YYYY-MM-DD
        const completedOutput = await executeShellCommand(`sacct -u ${username} -S ${today} -o State --noheader | grep -c COMPLETED`);
        completedToday = parseInt(completedOutput.trim()) || 0;

        return { totalJobs, runningJobs, queuedJobs, completedToday };
    } catch (error) {
        console.error(`Error obteniendo estadísticas de trabajos Slurm para ${username}:`, error);
        return { totalJobs: 0, runningJobs: 0, queuedJobs: 0, completedToday: 0 };
    }
}

// Obtiene el uso de recursos para un usuario específico (simulado por ahora)
async function getUserResourceUsage(username) {
    // Obtener uso por usuario puede requerir contabilidad; devolvemos valores simulados por ahora
    return {
        cpuUsage: Math.floor(Math.random() * 30),
        memoryUsage: Math.floor(Math.random() * 20),
        storageUsage: Math.floor(Math.random() * 50),
    };
}

// Create user router for PUN and mount under /api/v1/user
const userRouter = express.Router();

userRouter.get('/whoami', (req, res) => {
    res.json({ 
        username: req.user.sub, 
        role: req.user.role
    });
});

userRouter.get('/files', (req, res) => {
    const username = req.user.sub; 
    const basePath = `/hpc-home/${username}`;
    const finalPath = req.query.path || basePath;
    
    exec(`ls -l ${finalPath}`, (err, stdout, stderr) => {
        if (err) {
            console.error(`[PUN /api/files] Error:`, stderr);
            return res.status(400).json({ success: false, message: stderr });
        }
        
        const fileList = parseLsOutput(stdout, finalPath); 
        
        return res.json({ success: true, path: finalPath, files: fileList });
    });
});

// Dashboard stats for current PUN user (protected by authenticateToken at mount)
userRouter.get('/dashboard/stats', async (req, res) => {
    try {
        const username = req.user.sub;
        const jobStats = await getUserSlurmJobStats(username);
        const resourceUsage = await getUserResourceUsage(username);

        const stats = {
            totalJobs: jobStats.totalJobs,
            runningJobs: jobStats.runningJobs,
            queuedJobs: jobStats.queuedJobs,
            completedToday: jobStats.completedToday,
            cpuUsage: resourceUsage.cpuUsage,
            memoryUsage: resourceUsage.memoryUsage,
            storageUsage: resourceUsage.storageUsage,
            activeUsers: 1,
            nodesActive: 0,
            nodesMaintenance: 0,
            nodesAvailable: 0,
            nodesErrors: 0,
        };

        return res.json({ success: true, data: stats });
    } catch (err) {
        console.error('Error in PUN /dashboard/stats:', err);
        return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
});

    // Get job history for the current PUN user
    async function getUserJobHistory(username, days = 30) {
        try {
            const since = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
            // Fields: JobID, JobName, State, Submit, Start, End, Elapsed, AllocCPUS, ReqMem, ExitCode
            const fields = 'JobID,JobName,State,Submit,Start,End,Elapsed,AllocCPUS,ReqMem,ExitCode';
            const cmd = `sacct -P -n -u ${username} -S ${since} -o ${fields}`;
            const out = await executeShellCommand(cmd);
            const lines = out.trim().split('\n').filter(l => l.length > 0);
            const jobs = lines.map(line => {
                const parts = line.split('|');
                const [rawJobId, jobName, state, submit, start, end, elapsed, allocCpus, reqMem, exitCode] = parts.concat(Array(10).fill(null));
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
                };
            });
            // dedupe by id
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
            console.error('PUN getUserJobHistory error', e);
            throw e;
        }
    }

    userRouter.get('/history', authenticateToken, async (req, res) => {
        try {
            const days = parseInt(req.query.days || '30', 10) || 30;
            const username = req.user && req.user.sub;
            if (!username) return res.status(400).json({ success:false, message: 'No user in token' });
            const history = await getUserJobHistory(username, days);
            return res.json(history);
        } catch (e) {
            console.error('PUN /history error', e);
            return res.status(500).json({ success:false, message: 'Failed to retrieve history', detail: String(e) });
        }
    });

// --- RUTAS PARA MANEJO DE ARCHIVOS (CRUD + UPLOAD via JSON base64) ---
const filesRouter = express.Router();

// Configuración de root y límites
const USER_ROOT_PREFIX = '/hpc-home';
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB

function normalizeAndVerifyPath(requestingUser, requestedPath, isAdmin) {
    // If no path provided, default to user's home
    let target = requestedPath || path.join(USER_ROOT_PREFIX, requestingUser);
    // Resolve to absolute and normalize
    target = path.resolve(target);

    if (!isAdmin) {
        const userRoot = path.resolve(path.join(USER_ROOT_PREFIX, requestingUser));
        if (!target.startsWith(userRoot + path.sep) && target !== userRoot) {
            throw new Error('Access denied to the requested path.');
        }
    } else {
        const globalRoot = path.resolve(USER_ROOT_PREFIX);
        if (!target.startsWith(globalRoot + path.sep) && target !== globalRoot) {
            throw new Error('Admin access limited to /hpc-home.');
        }
    }
    return target;
}

async function statOwnerGroup(stats) {
    // Try to resolve UID/GID to human-readable names using getent. Fallback to numeric IDs.
    try {
        let ownerName = String(stats.uid);
        let groupName = String(stats.gid);
        try {
            const pw = execSync(`getent passwd ${stats.uid}`, { encoding: 'utf8' }).trim();
            if (pw) {
                ownerName = pw.split(':')[0];
            }
        } catch (e) {
            // ignore, keep numeric
        }
        try {
            const gr = execSync(`getent group ${stats.gid}`, { encoding: 'utf8' }).trim();
            if (gr) {
                groupName = gr.split(':')[0];
            }
        } catch (e) {
            // ignore, keep numeric
        }
        return { owner: ownerName, group: groupName };
    } catch (e) {
        return { owner: String(stats.uid), group: String(stats.gid) };
    }
}

// List directory contents
filesRouter.get('/files', authenticateToken, async (req, res) => {
    const username = req.user.sub;
    const isAdmin = req.user.role === 'admin';
    const requestedPath = req.query.path;
    try {
        const target = normalizeAndVerifyPath(username, String(requestedPath || ''), isAdmin);
        const stats = await fs.promises.stat(target).catch(() => null);
        if (!stats) return res.status(404).json({ success: false, message: 'Path not found.' });
        if (!stats.isDirectory()) return res.status(400).json({ success: false, message: 'Path is not a directory.' });

        const entries = await fs.promises.readdir(target, { withFileTypes: true });
        const files = await Promise.all(entries.map(async (dirent) => {
            const full = path.join(target, dirent.name);
            const s = await fs.promises.stat(full).catch(() => null);
            const { owner, group } = s ? await statOwnerGroup(s) : { owner: '0', group: '0' };
            const extension = dirent.isFile() ? path.extname(dirent.name).replace('.', '') : undefined;
            return {
                id: Buffer.from(full).toString('base64'),
                name: dirent.name,
                type: dirent.isDirectory() ? 'folder' : 'file',
                size: s ? String(s.size) : '0',
                modified: s ? s.mtime.toISOString() : null,
                extension,
                owner,
                group,
                permissions: s ? (s.mode & 0o777).toString(8) : '000'
            };
        }));

        return res.json({ success: true, path: target, files });
    } catch (err) {
        console.error('Error in GET /files:', err.message);
        return res.status(400).json({ success: false, message: err.message });
    }
});

// Read a file (returns base64 content and metadata)
filesRouter.get('/file', authenticateToken, async (req, res) => {
    const username = req.user.sub;
    const isAdmin = req.user.role === 'admin';
    const requestedPath = req.query.path;
    if (!requestedPath) return res.status(400).json({ success: false, message: 'path is required' });
    try {
        const target = normalizeAndVerifyPath(username, String(requestedPath), isAdmin);
        const s = await fs.promises.stat(target).catch(() => null);
        if (!s) return res.status(404).json({ success: false, message: 'File not found.' });
        if (!s.isFile()) return res.status(400).json({ success: false, message: 'Requested path is not a file.' });
        const buffer = await fs.promises.readFile(target);
        // Simple binary detection: presence of null byte
        const isBinary = buffer.includes(0);
        const contentBase64 = buffer.toString('base64');
        return res.json({ success: true, path: target, isBinary, size: buffer.length, contentBase64 });
    } catch (err) {
        console.error('Error in GET /file:', err.message);
        return res.status(400).json({ success: false, message: err.message });
    }
});

// Create a new file (fail if exists)
filesRouter.post('/file', authenticateToken, async (req, res) => {
    const username = req.user.sub;
    const isAdmin = req.user.role === 'admin';
    const { path: requestedPath, contentBase64 } = req.body || {};
    if (!requestedPath || contentBase64 == null) return res.status(400).json({ success: false, message: 'path and contentBase64 required' });
    try {
        const target = normalizeAndVerifyPath(username, String(requestedPath), isAdmin);
        // parent must exist (user asked not to auto-create directories)
        const parent = path.dirname(target);
        const parentStats = await fs.promises.stat(parent).catch(() => null);
        if (!parentStats || !parentStats.isDirectory()) return res.status(400).json({ success: false, message: 'Parent directory does not exist.' });

        const buffer = Buffer.from(contentBase64, 'base64');
        if (buffer.length > MAX_UPLOAD_BYTES) return res.status(413).json({ success: false, message: 'File too large.' });

        // Use flag 'wx' to fail if exists
        await fs.promises.writeFile(target, buffer, { flag: 'wx' });
        return res.json({ success: true, message: 'File created.', path: target });
    } catch (err) {
        console.error('Error in POST /file:', err.message);
        if (err.code === 'EEXIST') return res.status(409).json({ success: false, message: 'File already exists.' });
        return res.status(400).json({ success: false, message: err.message });
    }
});

// Update (overwrite) a file
filesRouter.put('/file', authenticateToken, async (req, res) => {
    const username = req.user.sub;
    const isAdmin = req.user.role === 'admin';
    const { path: requestedPath, contentBase64 } = req.body || {};
    if (!requestedPath || contentBase64 == null) return res.status(400).json({ success: false, message: 'path and contentBase64 required' });
    try {
        const target = normalizeAndVerifyPath(username, String(requestedPath), isAdmin);
        const s = await fs.promises.stat(target).catch(() => null);
        if (!s || !s.isFile()) return res.status(404).json({ success: false, message: 'File not found.' });
        const buffer = Buffer.from(contentBase64, 'base64');
        if (buffer.length > MAX_UPLOAD_BYTES) return res.status(413).json({ success: false, message: 'File too large.' });
        await fs.promises.writeFile(target, buffer, { flag: 'w' });
        return res.json({ success: true, message: 'File updated.', path: target });
    } catch (err) {
        console.error('Error in PUT /file:', err.message);
        return res.status(400).json({ success: false, message: err.message });
    }
});

// Delete a file
filesRouter.delete('/file', authenticateToken, async (req, res) => {
    const username = req.user.sub;
    const isAdmin = req.user.role === 'admin';
    const requestedPath = req.query.path;
    if (!requestedPath) return res.status(400).json({ success: false, message: 'path is required' });
    try {
        const target = normalizeAndVerifyPath(username, String(requestedPath), isAdmin);
        const s = await fs.promises.stat(target).catch(() => null);
        if (!s) return res.status(404).json({ success: false, message: 'File not found.' });
        if (!s.isFile()) return res.status(400).json({ success: false, message: 'Path is not a file.' });
        await fs.promises.unlink(target);
        return res.json({ success: true, message: 'File deleted.' });
    } catch (err) {
        console.error('Error in DELETE /file:', err.message);
        return res.status(400).json({ success: false, message: err.message });
    }
});

// Upload multiple files via JSON (each file must be { name, contentBase64 }) into a target directory
filesRouter.post('/upload', authenticateToken, async (req, res) => {
    const username = req.user.sub;
    const isAdmin = req.user.role === 'admin';
    const { path: requestedDir, files } = req.body || {};
    if (!requestedDir || !Array.isArray(files)) return res.status(400).json({ success: false, message: 'path and files[] required' });
    try {
        const targetDir = normalizeAndVerifyPath(username, String(requestedDir), isAdmin);
        const dirStats = await fs.promises.stat(targetDir).catch(() => null);
        if (!dirStats || !dirStats.isDirectory()) return res.status(400).json({ success: false, message: 'Target directory does not exist.' });

        const results = [];
        for (const f of files) {
            const name = f.name;
            const contentBase64 = f.contentBase64;
            if (!name || contentBase64 == null) {
                results.push({ name: name || null, success: false, message: 'Missing name or content.' });
                continue;
            }
            const filePath = path.join(targetDir, name);
            const buffer = Buffer.from(contentBase64, 'base64');
            if (buffer.length > MAX_UPLOAD_BYTES) {
                results.push({ name, success: false, message: 'File too large.' });
                continue;
            }
            try {
                // Do not create directories automatically per user choice
                await fs.promises.writeFile(filePath, buffer, { flag: 'w' });
                results.push({ name, success: true });
            } catch (e) {
                results.push({ name, success: false, message: e.message });
            }
        }
        return res.json({ success: true, results });
    } catch (err) {
        console.error('Error in POST /upload:', err.message);
        return res.status(400).json({ success: false, message: err.message });
    }
});

// Create a directory
filesRouter.post('/folder', authenticateToken, async (req, res) => {
    const username = req.user.sub;
    const isAdmin = req.user.role === 'admin';
    const { path: requestedPath } = req.body || {};
    if (!requestedPath) return res.status(400).json({ success: false, message: 'path is required' });
    try {
        const target = normalizeAndVerifyPath(username, String(requestedPath), isAdmin);
        // Ensure parent exists and is a directory
        const parent = path.dirname(target);
        const parentStats = await fs.promises.stat(parent).catch(() => null);
        if (!parentStats || !parentStats.isDirectory()) return res.status(400).json({ success: false, message: 'Parent directory does not exist.' });

        const existing = await fs.promises.stat(target).catch(() => null);
        if (existing) return res.status(409).json({ success: false, message: 'Path already exists.' });

        await fs.promises.mkdir(target, { recursive: false, mode: 0o755 });
        return res.json({ success: true, message: 'Directory created.', path: target });
    } catch (err) {
        console.error('Error in POST /folder:', err.message);
        return res.status(400).json({ success: false, message: err.message });
    }
});

// mount files router
app.use('/api/v1/user', filesRouter);

// mount router with authentication at the new prefix
app.use('/api/v1/user', authenticateToken, userRouter);

app.use((err, req, res, next) => {
    console.error('[PUN ERROR GLOBAL]:', err.stack);
    res.status(500).send('Internal Server Error');
});

app.listen(socketPath, () => {
    try {
        fs.chownSync(socketPath, process.getuid(), WWW_DATA_GID); 
        fs.chmodSync(socketPath, '660');
        console.log(`✅ PUN initiated and socket permissions set for Nginx: ${socketPath}`);
    } catch (e) {
        console.error("FATAL: Failed to change socket ownership/permissions:", e);
        cleanupAndExit(); 
    }
});