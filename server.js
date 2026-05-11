const path = require('path');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const si = require('systeminformation');

const app = express();
const port = process.env.PORT || 3000;
const publicDirectory = path.join(__dirname, 'public');
const server = http.createServer(app);
const io = socketIo(server);

async function collectMetrics() {
	const [load, memory, network, processes, time, cpuInfo] = await Promise.all([
		si.currentLoad(),
		si.mem(),
		si.networkStats(),
		si.processes(),
		si.time(),
		si.cpu(),
	]);

	const nameMap = new Map();
	processes.list.forEach(p => {
		const n = (p.name || '').toLowerCase();
		if (!nameMap.has(n)) nameMap.set(n, new Set());
		nameMap.get(n).add(p.pid);
	});

	const topProcesses = processes.list
		.slice()
		.sort((firstProcess, secondProcess) => secondProcess.cpu - firstProcess.cpu)
		.map((process) => {
			const n = (process.name || '').toLowerCase();
			const peers = nameMap.get(n);
			const isMain = peers && peers.size > 1 && !peers.has(process.parentPid);

			// Windows doesn't expose Unix-style process states — systeminformation
			// returns 'unknown' for most processes. Derive a useful label instead:
			//   running  → process consumed CPU in this sample
			//   sleeping → process is idle (0 % CPU)
			const rawState = (process.state || '').toLowerCase().trim();
			const knownStates = ['running', 'sleeping', 'stopped', 'zombie', 'idle', 'locked', 'wait'];
			const state = knownStates.includes(rawState)
				? rawState
				: (process.cpu > 0 ? 'running' : 'sleeping');

			return {
				pid: process.pid,
				name: process.name,
				cpu: process.cpu,
				mem: process.mem,
				state,
				isMain,
			};
		});

	return {
		timestamp: new Date().toISOString(),
		uptime: process.uptime(),
		cpu: {
			manufacturer: cpuInfo.manufacturer || '',
			brand: cpuInfo.brand || '',
			vendor: cpuInfo.vendor || '',
			label: [cpuInfo.manufacturer, cpuInfo.brand, cpuInfo.vendor].filter(Boolean).join(' ') || 'CPU information unavailable',
			cores: cpuInfo.cores,
			physicalCores: cpuInfo.physicalCores,
			speed: cpuInfo.speed,
			speedMin: cpuInfo.speedMin,
			speedMax: cpuInfo.speedMax,
			load: Number(load.currentLoad) || 0,
			loadPerCore: Array.isArray(load.cpus) ? load.cpus.map((core) => Number(core.load) || 0) : [],
		},
		memory: {
			total: memory.total,
			used: memory.used,
			free: memory.free,
			percent: memory.used / memory.total * 100,
		},
		network: network.map((entry) => ({
			iface: entry.iface,
			operstate: entry.operstate,
			rx_sec: entry.rx_sec,
			tx_sec: entry.tx_sec,
		})),
		processes: topProcesses,
	};
}

app.use(express.static(publicDirectory));
app.use(express.json());

// ── Protected process definitions ────────────────────────────────────────
// Killing these on Windows causes BSOD, forced reboot, or session crash.
const PROTECTED_PIDS = new Set([0, 4]); // System Idle Process, System

const PROTECTED_NAMES = new Set([
	'system',
	'system idle process',
	'smss.exe',       // Session Manager Subsystem
	'csrss.exe',      // Client/Server Runtime — BSOD if killed
	'wininit.exe',    // Windows Initialization
	'winlogon.exe',   // Logon manager — session crash
	'services.exe',   // Service Control Manager
	'lsass.exe',      // Local Security Authority — BSOD
	'lsm.exe',        // Local Session Manager
	'ntoskrnl.exe',   // NT Kernel & System
]);

/**
 * Returns true when the process must NOT be killed.
 * @param {number} pid
 * @param {string|undefined} name
 */
function isProtected(pid, name) {
	if (PROTECTED_PIDS.has(pid)) return true;
	if (name && PROTECTED_NAMES.has(name.toLowerCase().trim())) return true;
	return false;
}


app.get('/api/health', (request, response) => {
	response.json({
		status: 'ok',
		service: 'htop-web-ui',
		uptime: process.uptime(),
		timestamp: new Date().toISOString(),
	});
});

app.get('/api/metrics', async (request, response) => {
	try {
		const metrics = await collectMetrics();
		response.json(metrics);
	} catch (error) {
		response.status(500).json({
			error: 'Unable to collect metrics',
			message: error instanceof Error ? error.message : String(error),
		});
	}
});

// Kill a process by PID (best-effort). Requires sufficient permissions.
app.post('/api/processes/kill', async (request, response) => {
	const { pid, name } = request.body || {};

	if (!pid || typeof pid !== 'number' || !Number.isInteger(pid) || pid < 0) {
		return response.status(400).json({ error: 'Invalid pid' });
	}

	// Hard block: refuse to kill any protected system process.
	if (isProtected(pid, name)) {
		return response.status(403).json({
			error: 'Protected process',
			message: `Process "${name || pid}" is a protected system process and cannot be killed. Doing so could cause a system crash or BSOD.`,
		});
	}

	try {
		process.kill(pid);
		return response.json({ status: 'killed', pid });
	} catch (err) {
		return response.status(500).json({ error: 'Failed to kill process', message: err instanceof Error ? err.message : String(err) });
	}
});

// Expose the protected list so the frontend can disable Kill buttons proactively.
app.get('/api/protected-processes', (request, response) => {
	response.json({
		pids: Array.from(PROTECTED_PIDS),
		names: Array.from(PROTECTED_NAMES),
	});
});

app.use((request, response) => {
	response.status(404).json({
		error: 'Not Found',
		path: request.path,
	});
});

io.on('connection', async (socket) => {
	try {
		const metrics = await collectMetrics();
		socket.emit('system-metrics', metrics);
	} catch (error) {
		socket.emit('system-metrics-error', {
			message: error instanceof Error ? error.message : String(error),
		});
	}
});

setInterval(async () => {
	try {
		const metrics = await collectMetrics();
		io.emit('system-metrics', metrics);
	} catch (error) {
		io.emit('system-metrics-error', {
			message: error instanceof Error ? error.message : String(error),
		});
	}
}, 1500);

server.listen(port, () => {
	console.log(`Server running at http://localhost:${port}`);
});
