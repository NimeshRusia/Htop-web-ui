const connectionStatus = document.getElementById('connection-status');
const lastUpdated = document.getElementById('last-updated');
const cpuLoad = document.getElementById('cpu-load');
const memoryLoad = document.getElementById('memory-load');
const processCount = document.getElementById('process-count');
const uptimeValue = document.getElementById('uptime-value');
const cpuBrand = document.getElementById('cpu-brand');
const cpuCoreList = document.getElementById('cpu-core-list');
const memoryDetails = document.getElementById('memory-details');
const memoryBarFill = document.getElementById('memory-bar-fill');
const memoryUsed = document.getElementById('memory-used');
const memoryFree = document.getElementById('memory-free');
const memoryTotal = document.getElementById('memory-total');
const processTableBody = document.getElementById('process-table-body');
const processSearch = document.getElementById('process-search');
const thPid = document.getElementById('th-pid');
const thName = document.getElementById('th-name');
const thCpu = document.getElementById('th-cpu');
const thMem = document.getElementById('th-mem');
const thState = document.getElementById('th-state');

if (
	!connectionStatus ||
	!lastUpdated ||
	!cpuLoad ||
	!memoryLoad ||
	!processCount ||
	!uptimeValue ||
	!cpuBrand ||
	!cpuCoreList ||
	!memoryDetails ||
	!memoryBarFill ||
	!memoryUsed ||
	!memoryFree ||
	!memoryTotal ||
	!processTableBody
) {
	throw new Error('Dashboard elements are missing from the page.');
}

if (!window.appState) {
	throw new Error('Global state store is missing from the page.');
}

let processSort = { key: 'cpu', dir: 'desc' };

const toggleSort = (key) => {
	if (processSort.key === key) {
		processSort.dir = processSort.dir === 'asc' ? 'desc' : 'asc';
	} else {
		processSort.key = key;
		processSort.dir = 'desc';
	}
};

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
	if (!Array.isArray(loadPerCore) || loadPerCore.length === 0) {
		cpuCoreList.innerHTML = '<div class="core-row">No core data</div>';
		return;
	}

	// If the number of existing rows matches, update in-place to avoid full reflow.
	const existing = cpuCoreList.children;
	if (existing.length === loadPerCore.length) {
		for (let i = 0; i < loadPerCore.length; i += 1) {
			const value = Number(loadPerCore[i]) || 0;
			const row = existing[i];
			const fill = row.querySelector('.core-bar > span');
			const percent = row.querySelector('.core-percent');
			if (fill) fill.style.width = `${Math.min(100, Math.max(0, value))}%`;
			if (percent) percent.textContent = `${value.toFixed(0)}%`;
		}
		return;
	}

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
		percent.className = 'core-percent';
		percent.textContent = `${value.toFixed(0)}%`;

		bar.appendChild(fill);
		row.append(label, bar, percent);
		cpuCoreList.appendChild(row);
	});
};

const renderProcesses = (processes) => {
	// apply search filter
	const query = (processSearch && processSearch.value || '').trim().toLowerCase();
	let filtered = Array.isArray(processes) ? processes.slice() : [];
	if (query) {
		filtered = filtered.filter((p) => {
			return String(p.pid).includes(query) || (p.name && p.name.toLowerCase().includes(query));
		});
	}

	// apply sort
	filtered.sort((a, b) => {
		const key = processSort.key;
		const dir = processSort.dir === 'asc' ? 1 : -1;
		const av = a[key] ?? '';
		const bv = b[key] ?? '';
		if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
		return String(av).localeCompare(String(bv)) * dir;
	});

	if (!filtered.length) {
		processTableBody.innerHTML = '<tr><td colspan="6">No processes available.</td></tr>';
		return;
	}

	// Try to update existing rows in-place when possible to avoid full re-render.
	const existingRows = Array.from(processTableBody.children || []);
	const existingPids = existingRows.map((r) => (r.querySelector('td') && r.querySelector('td').textContent ? r.querySelector('td').textContent.trim() : null));
	const desiredPids = filtered.map((p) => String(p.pid));

	const canUpdateInPlace = existingRows.length === filtered.length && existingPids.every((v, i) => v === desiredPids[i]);

	if (canUpdateInPlace) {
		for (let i = 0; i < filtered.length; i += 1) {
			const row = existingRows[i];
			const cells = row.children;
			const p = filtered[i];
			if (cells[1]) cells[1].textContent = p.name || '';
			if (cells[2]) cells[2].textContent = Number(p.cpu || 0).toFixed(1);
			if (cells[3]) cells[3].textContent = Number(p.mem || 0).toFixed(1);
			if (cells[4]) cells[4].textContent = p.state || '';
			// ensure kill button attribute
			const btn = row.querySelector('.kill-btn');
			if (btn) btn.setAttribute('data-pid', String(p.pid));
		}
		return;
	}

	// Otherwise, rebuild the table rows.
	processTableBody.innerHTML = '';
	filtered.forEach((process) => {
		const row = document.createElement('tr');
		const killId = `kill-${process.pid}`;
		row.innerHTML = `
			<td>${process.pid}</td>
			<td>${process.name || ''}</td>
			<td>${Number(process.cpu || 0).toFixed(1)}</td>
			<td>${Number(process.mem || 0).toFixed(1)}</td>
			<td>${process.state || ''}</td>
			<td><button data-pid="${process.pid}" class="kill-btn" id="${killId}">Kill</button></td>
		`;
		processTableBody.appendChild(row);
	});

	// attach kill handlers (only to newly created buttons)
	const buttons = processTableBody.querySelectorAll('.kill-btn');
	buttons.forEach((btn) => {
		if (btn._killHandlerAttached) return;
		btn._killHandlerAttached = true;
		btn.addEventListener('click', async (ev) => {
			const pid = Number(btn.getAttribute('data-pid'));
			if (!Number.isFinite(pid)) return;
			if (!confirm(`Kill process ${pid}?`)) return;
			btn.disabled = true;
			try {
				await window.api.killProcess(pid);
				btn.textContent = 'Killed';
				setTimeout(() => { btn.disabled = false; btn.textContent = 'Kill'; }, 2000);
			} catch (err) {
				alert('Failed to kill process: ' + (err && err.message ? err.message : err));
				btn.disabled = false;
			}
		});
	});
};

	const renderProcessSkeleton = () => {
		processTableBody.innerHTML = '';

		for (let index = 0; index < 5; index += 1) {
			const row = document.createElement('tr');
			row.className = 'placeholder-row';
			row.innerHTML = `
				<td>--</td>
				<td>Waiting for data...</td>
				<td>--</td>
				<td>--</td>
				<td>--</td>
			`;
			processTableBody.appendChild(row);
		}
	};

const applyState = (state) => {
	if (state.status === 'polling') {
		connectionStatus.textContent = 'Polling';
		connectionStatus.style.background = '#fef3c7';
		connectionStatus.style.color = '#92400e';
		lastUpdated.textContent = 'Waiting for the first metrics update...';
		return;
	}

	if (state.status === 'error') {
		connectionStatus.textContent = 'Metrics error';
		connectionStatus.style.background = '#fee2e2';
		connectionStatus.style.color = '#991b1b';
		lastUpdated.textContent = state.error;
		return;
	}

	if (!state.metrics) {
		return;
	}

	const metrics = state.metrics || {};

	connectionStatus.textContent = 'Live';
	connectionStatus.style.background = '#dcfce7';
	connectionStatus.style.color = '#166534';

	// timestamp
	try {
		const ts = metrics.timestamp ? new Date(metrics.timestamp) : null;
		lastUpdated.textContent = ts ? `Updated at ${ts.toLocaleTimeString()}` : 'Updated';
	} catch (err) {
		lastUpdated.textContent = 'Updated';
	}

	// CPU
	const cpu = metrics.cpu || {};
	const cpuLoadVal = Number.isFinite(cpu.load) ? `${cpu.load.toFixed(1)}%` : '--%';
	cpuLoad.textContent = cpuLoadVal;

	// Memory
	const memory = metrics.memory || {};
	memoryLoad.textContent = Number.isFinite(memory.percent) ? `${memory.percent.toFixed(1)}%` : '--%';

	// Processes
	const processes = Array.isArray(metrics.processes) ? metrics.processes : [];
	processCount.textContent = processes.length ? String(processes.length) : '--';

	// Uptime
	uptimeValue.textContent = Number.isFinite(metrics.uptime) ? formatUptime(metrics.uptime) : '--:--:--';

	// CPU brand
	cpuBrand.textContent = cpu.label || `${cpu.manufacturer || ''} ${cpu.brand || ''}`.trim() || 'Waiting for hardware info...';

	// Cores
	renderCpuCores(Array.isArray(cpu.loadPerCore) ? cpu.loadPerCore : []);

	// Memory details
	memoryDetails.textContent = `${formatBytes(memory.used || 0)} used of ${formatBytes(memory.total || 0)}`;
	memoryBarFill.style.width = `${Math.min(100, Math.max(0, Number.isFinite(memory.percent) ? memory.percent : 0))}%`;
	memoryUsed.textContent = formatBytes(memory.used || 0);
	memoryFree.textContent = formatBytes(memory.free || 0);
	memoryTotal.textContent = formatBytes(memory.total || 0);

	// Processes render
	try {
		renderProcesses(processes);
	} catch (err) {
		console.error('Failed to render processes:', err);
	}
};

window.appState.subscribe(applyState);

renderProcessSkeleton();

// wire up search and sorting
if (processSearch) {
	processSearch.addEventListener('input', () => {
		const state = window.appState.getState();
		if (state.metrics) renderProcesses(state.metrics.processes);
	});
}

if (thPid) thPid.addEventListener('click', () => { toggleSort('pid'); const s = window.appState.getState(); if (s.metrics) renderProcesses(s.metrics.processes); });
if (thName) thName.addEventListener('click', () => { toggleSort('name'); const s = window.appState.getState(); if (s.metrics) renderProcesses(s.metrics.processes); });
if (thCpu) thCpu.addEventListener('click', () => { toggleSort('cpu'); const s = window.appState.getState(); if (s.metrics) renderProcesses(s.metrics.processes); });
if (thMem) thMem.addEventListener('click', () => { toggleSort('mem'); const s = window.appState.getState(); if (s.metrics) renderProcesses(s.metrics.processes); });
if (thState) thState.addEventListener('click', () => { toggleSort('state'); const s = window.appState.getState(); if (s.metrics) renderProcesses(s.metrics.processes); });
