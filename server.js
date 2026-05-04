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

	const topProcesses = processes.list
		.slice()
		.sort((firstProcess, secondProcess) => secondProcess.cpu - firstProcess.cpu)
		.slice(0, 8)
		.map((process) => ({
			pid: process.pid,
			name: process.name,
			cpu: process.cpu,
			mem: process.mem,
			state: process.state,
		}));

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
	const { pid } = request.body || {};

	if (!pid || typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
		return response.status(400).json({ error: 'Invalid pid' });
	}

	try {
		process.kill(pid);
		return response.json({ status: 'killed', pid });
	} catch (err) {
		return response.status(500).json({ error: 'Failed to kill process', message: err instanceof Error ? err.message : String(err) });
	}
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
