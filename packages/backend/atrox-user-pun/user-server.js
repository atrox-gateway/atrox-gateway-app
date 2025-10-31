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

app.use('/api', authenticateToken);

app.get('/api/whoami', (req, res) => {
    res.json({ 
        username: req.user.sub, 
        role: req.user.role
    });
});

app.get('/api/files', authenticateToken, (req, res) => {
    const username = req.user.sub; 
    const basePath = `/hpc_home/${username}`;
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