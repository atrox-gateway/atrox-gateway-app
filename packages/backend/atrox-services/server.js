// /opt/atrox-gateway/packages/backend/atrox-services/server.js

const express = require('express');
const { exec } = require('child_process');
const pam = require('authenticate-pam');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const sharedLibsPath = path.join(__dirname, '..', 'shared-libraries');

const { PunManager } = require(path.join(sharedLibsPath, 'punManager.js'));
const RedisClient = require(path.join(sharedLibsPath, 'redisClient.js'));

const punDir = '/var/run/atrox-puns'; 
const NGINX_PUNS_ENABLED_DIR = '/etc/nginx/puns-enabled';
const NGINX_USER_MAP_PATH = '/etc/nginx/user_map.conf';

const app = express();
app.use(express.json());
app.use(cookieParser());

const JWT_SECRET = process.env.JWT_SECRET_KEY || 'insecure_default_secret';
const LISTEN_PORT = process.env.PORT || 3000;

const punManager = new PunManager(punDir, JWT_SECRET, RedisClient);
punManager.recoverState().then(() => {
    console.log('✅ Recuperación de estado completada. Portero listo para aceptar logins.');
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body || {};

    if (!username || !password) {
        return res.status(400).json({ message: 'username and password are required.' });
    }

    pam.authenticate(username, password, async (err) => {
        if (err) {
            console.error(`PAM authentication failed for user '${username}':`, err);
            return res.status(401).json({ message: 'Authentication failed.' });
        }
        console.log(`PAM authentication succeeded for user '${username}'.`);

        const userCodePath = path.join(__dirname, '..', 'atrox-user-pun', 'user-server.js');
        const socketPath = path.join(punDir, `${username}.socket`);
        
        let role = (username === 'atroxgateway') ? 'admin' : 'user';

        try {
            await punManager.checkOrCreatePUN(username, userCodePath);

            const nginxUpstreamConfig = `upstream ${username}_pun_backend { server unix:${socketPath}; }`;

            const activePuns = punManager.getActivePuns(); 
            let mapFileContent = '';
            for (const user of activePuns.keys()) {
                mapFileContent += `${user} "${user}_pun_backend";\n`;
            }

            const tempUpstreamPath = `/tmp/${username}.conf`;
            const tempMapPath = '/tmp/user_map.conf';
            fs.writeFileSync(tempUpstreamPath, nginxUpstreamConfig);
            fs.writeFileSync(tempMapPath, mapFileContent);

            const bashCommands = `
            mv ${tempUpstreamPath} ${NGINX_PUNS_ENABLED_DIR}/${username}.conf &&
            mv ${tempMapPath} ${NGINX_USER_MAP_PATH} &&
            nginx -t
            nginx -s reload`;

            const command = `sudo /bin/bash -c "${bashCommands}"`;

            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.error('CRITICAL NGINX RELOAD FAIL:', stderr);
                } else {
                    console.log(`✅ NGINX reconfigurado exitosamente para ${username}.`);
                }
            });

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

app.listen(LISTEN_PORT, () => {
    console.log(`🚀 Portero service listening on port ${LISTEN_PORT}`);
});