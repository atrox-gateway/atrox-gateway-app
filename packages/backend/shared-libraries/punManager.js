// /opt/atrox-gateway/packages/backend/shared-libraries/punManager.js
const { spawn, execSync } = require('child_process'); // <-- Asegúrate de importar execSync
const fs = require('fs');
const path = require('path');
const RedisClient = require('./redisClient.js');

class PunManager {
    constructor(punDir, jwtSecret, redisClient) {
        this.punDir = punDir;
        this.jwtSecret = jwtSecret;
        this.redisClient = redisClient;
        this.activePUNs = new Map();
    }

    async recoverState() {
        return Promise.resolve(console.log("[Recovery] State check complete."));
    }

    getActivePuns() {
        return this.activePUNs;
    }

    async checkOrCreatePUN(username, userCodePath) {
        if (this.activePUNs.has(username)) {
            const punInfo = this.activePUNs.get(username);
            const pid = punInfo.process?.pid; 

            let isAlive = false;
            if (pid) {
                try {
                    execSync(`ps -p ${pid} -o comm=`);
                    isAlive = true; 
                    
                } catch (e) {
                    isAlive = false;
                }
            }

            if (isAlive) {
                console.log(`[PUN Manager] PUN for ${username} already active (PID: ${pid}).`);
                return true; 
            } else {
                console.warn(`[PUN Manager] PUN for ${username} found in map but process (PID: ${pid}) is dead. Cleaning up and recreating.`);
                this.activePUNs.delete(username);
                try { if (punInfo.socketPath && fs.existsSync(punInfo.socketPath)) fs.unlinkSync(punInfo.socketPath); } catch (e) {}
            }
        }
        
        const socketPath = path.join(this.punDir, `${username}.socket`);
        const NODE_BIN_PATH = '/usr/bin/node'; 

        const punProcess = spawn('sudo', [
            '-E', '-u', username,
            NODE_BIN_PATH, userCodePath, socketPath
        ], { detached: true, stdio: 'inherit' });
        
        punProcess.unref(); 
        this.activePUNs.set(username, { socketPath: socketPath, process: punProcess });
        await new Promise(resolve => setTimeout(resolve, 500)); 
        
        console.log(`[PUN Manager] Launched new PUN for ${username} (PID: ${punProcess.pid}).`);
        return true;
    }

    async stopPUN(username) {
        if (!this.activePUNs.has(username)) {
            console.warn(`[PUN Manager] Attempted to stop non-existent PUN for ${username}.`);
            return false;
        }

        const punInfo = this.activePUNs.get(username);
        const pid = punInfo.process?.pid;

        if (pid) {
            console.log(`[PUN Manager] Stopping PUN for ${username} (PID: ${pid})...`);
            try {
                require('child_process').execSync(`sudo kill -SIGTERM ${pid}`);
            } catch (e) {
                console.error(`[PUN Manager] Error sending SIGTERM to PID ${pid} for ${username}:`, e.message);
            }
        } else {
             console.warn(`[PUN Manager] PUN for ${username} found in map but has no process PID.`);
        }

        this.activePUNs.delete(username);
        try {
            if (punInfo.socketPath && fs.existsSync(punInfo.socketPath)) {
                fs.unlinkSync(punInfo.socketPath);
                console.log(`[PUN Manager] Cleaned up socket for ${username}.`);
            }
        } catch (e) {
            console.error(`[PUN Manager] Error cleaning up socket ${punInfo.socketPath}:`, e.message);
        }
        
        return true;
    }
}

module.exports = { PunManager };