const { spawn } = require('child_process');

function spawnWithTimeout(cmd, args = [], opts = {}) {
    const timeoutMs = opts.timeoutMs || 30000;
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        let stdout = '';
        let stderr = '';
        let finished = false;

        const kill = () => {
            try { child.kill('SIGKILL'); } catch (e) {}
        };

        const timer = setTimeout(() => {
            if (finished) return;
            finished = true;
            kill();
            reject(new Error(`Process timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        child.stdout.on('data', (d) => { stdout += d.toString(); });
        child.stderr.on('data', (d) => { stderr += d.toString(); });

        child.on('error', (err) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            reject(err);
        });

        child.on('close', (code) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            resolve({ code, stdout, stderr });
        });
    });
}

module.exports = { spawnWithTimeout };
