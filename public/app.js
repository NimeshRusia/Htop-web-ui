document.addEventListener('DOMContentLoaded', async () => {
	const connectionStatus = document.getElementById('connection-status');
	const lastUpdated = document.getElementById('last-updated');
	const cpuLoad = document.getElementById('cpu-load');
	const memoryLoad = document.getElementById('memory-load');
	const processCount = document.getElementById('process-count');
	const uptimeValue = document.getElementById('uptime-value');
	const cpuBrand = document.getElementById('cpu-brand');
	const cpuCoreList = document.getElementById('cpu-core-list');
	const processTableBody = document.getElementById('process-table-body');

	const socket = window.io();

	const formatBytes = (bytes) => {
		if (!Number.isFinite(bytes)) {
			return '--';
		}

		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		let value = bytes;
		let unitIndex = 0;

		while (value >= 1024 && unitIndex < units.length - 1) {
			value /= 1024;
			unitIndex += 1;
		}

		return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
	};

	const formatUptime = (seconds) => {
		const totalSeconds = Math.max(0, Math.floor(seconds));
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const remainingSeconds = totalSeconds % 60;

		return [hours, minutes, remainingSeconds]
			.map((part) => String(part).padStart(2, '0'))
			.join(':');
	};

	const renderCpuCores = (loadPerCore) => {
		cpuCoreList.innerHTML = '';

		loadPerCore.forEach((value, index) => {
			const row = document.createElement('div');
			row.className = 'core-row';

			const label = document.createElement('strong');
			label.textContent = `Core ${index + 1}`;

			const bar = document.createElement('div');
			bar.className = 'core-bar';

			const fill = document.createElement('span');
			fill.style.width = `${Math.min(100, Math.max(0, value))}%`;

			const percent = document.createElement('span');
			percent.textContent = `${value.toFixed(0)}%`;

			bar.appendChild(fill);
			row.append(label, bar, percent);
			cpuCoreList.appendChild(row);
		});
	};

	const renderProcesses = (processes) => {
		processTableBody.innerHTML = '';

		if (!processes.length) {
			const emptyRow = document.createElement('tr');
			emptyRow.innerHTML = '<td colspan="5">No processes available.</td>';
			processTableBody.appendChild(emptyRow);
			return;
		}

		processes.forEach((process) => {
			const row = document.createElement('tr');
			row.innerHTML = `
				<td>${process.pid}</td>
				<td>${process.name}</td>
				<td>${process.cpu.toFixed(1)}</td>
				<td>${process.mem.toFixed(1)}</td>
				<td>${process.state}</td>
			`;
			processTableBody.appendChild(row);
		});
	};

	const applyMetrics = (metrics) => {
		connectionStatus.textContent = 'Live';
		connectionStatus.style.background = '#dcfce7';
		connectionStatus.style.color = '#166534';

		lastUpdated.textContent = `Updated at ${new Date(metrics.timestamp).toLocaleTimeString()}`;
		cpuLoad.textContent = `${metrics.cpu.load.toFixed(1)}%`;
		memoryLoad.textContent = `${metrics.memory.percent.toFixed(1)}%`;
		processCount.textContent = `${metrics.processes.length}`;
		uptimeValue.textContent = formatUptime(metrics.uptime);
		cpuBrand.textContent = `${metrics.cpu.manufacturer} ${metrics.cpu.brand}`.trim();
		renderCpuCores(metrics.cpu.loadPerCore);
		renderProcesses(metrics.processes);
	};

	socket.on('connect', () => {
		connectionStatus.textContent = 'Connecting...';
		connectionStatus.style.background = '#fef3c7';
		connectionStatus.style.color = '#92400e';
	});

	socket.on('system-metrics', applyMetrics);

	socket.on('system-metrics-error', (error) => {
		connectionStatus.textContent = 'Metrics error';
		connectionStatus.style.background = '#fee2e2';
		connectionStatus.style.color = '#991b1b';
		lastUpdated.textContent = error.message;
	});

	try {
		const response = await fetch('/api/metrics');
		if (!response.ok) {
			throw new Error(`Metrics request failed with status ${response.status}`);
		}

		const metrics = await response.json();
		applyMetrics(metrics);
	} catch (error) {
		connectionStatus.textContent = 'Offline';
		connectionStatus.style.background = '#fee2e2';
		connectionStatus.style.color = '#991b1b';
		lastUpdated.textContent = error instanceof Error ? error.message : String(error);
	}
});
