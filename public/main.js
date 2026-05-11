/* ─────────────────────────────────────────────
   SysMon — main.js  (UI controller)
   ───────────────────────────────────────────── */

// ── DOM refs ──────────────────────────────────
const connectionStatus = document.getElementById('connection-status');
const statusLabel      = connectionStatus && connectionStatus.querySelector('.status-label');
const statusDot        = connectionStatus && connectionStatus.querySelector('.status-dot');
const lastUpdated      = document.getElementById('last-updated');
const cpuLoad          = document.getElementById('cpu-load');
const memoryLoad       = document.getElementById('memory-load');
const processCount     = document.getElementById('process-count');
const uptimeValue      = document.getElementById('uptime-value');
const cpuBrand         = document.getElementById('cpu-brand');
const cpuCoreList      = document.getElementById('cpu-core-list');
const memoryDetails    = document.getElementById('memory-details');
const memoryBarFill    = document.getElementById('memory-bar-fill');
const memoryBarPct     = document.getElementById('memory-bar-pct');
const memoryUsed       = document.getElementById('memory-used');
const memoryFree       = document.getElementById('memory-free');
const memoryTotal      = document.getElementById('memory-total');
const processTableBody = document.getElementById('process-table-body');
const processSearch    = document.getElementById('process-search');
const cpuRingFill      = document.getElementById('cpu-ring-fill');
const memRingFill      = document.getElementById('mem-ring-fill');
const thPid            = document.getElementById('th-pid');
const thName           = document.getElementById('th-name');
const thCpu            = document.getElementById('th-cpu');
const thMem            = document.getElementById('th-mem');
const thState          = document.getElementById('th-state');

// Guard
if (!connectionStatus || !processTableBody) {
	throw new Error('Critical dashboard elements are missing from the page.');
}
if (!window.appState) {
	throw new Error('Global state store is missing from the page.');
}

// ── Sort state ────────────────────────────────
let processSort = { key: 'cpu', dir: 'desc' };

// PIDs the user is actively targeting — keep them visible even if they
// drop out of the server list during a refresh cycle.
const lockedPids   = new Set();
const processCache = new Map();   // pid → last-known process data

// ── Helpers ───────────────────────────────────
const formatBytes = (bytes) => {
	if (!Number.isFinite(bytes)) return '--';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let value = bytes, ui = 0;
	while (value >= 1024 && ui < units.length - 1) { value /= 1024; ui++; }
	return `${value.toFixed(value >= 10 || ui === 0 ? 0 : 1)} ${units[ui]}`;
};

const formatUptime = (seconds) => {
	const total = Math.max(0, Math.floor(seconds));
	return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60]
		.map(p => String(p).padStart(2, '0'))
		.join(':');
};

/** Update the SVG ring chart (0–100 value). */
const setRing = (el, pct) => {
	if (!el) return;
	const v = Math.min(100, Math.max(0, pct));
	el.setAttribute('stroke-dasharray', `${v} ${100 - v}`);
};

/** Apply live/error/idle class to the status pill. */
const setStatus = (state, text) => {
	if (!connectionStatus) return;
	connectionStatus.classList.remove('is-live', 'is-error');
	if (state === 'live')  connectionStatus.classList.add('is-live');
	if (state === 'error') connectionStatus.classList.add('is-error');
	if (statusLabel) statusLabel.textContent = text;
};

/** Build a state badge <span>. */
const stateBadge = (state) => {
	const cls = state === 'running'  ? 'state-running'
	           : state === 'sleeping' ? 'state-sleeping'
	           : '';
	return `<span class="state-badge ${cls}">${state || '?'}</span>`;
};

/** Return a CSS class based on CPU % value. */
const cpuClass = (cpu) => {
	if (cpu >= 20) return 'cpu-hi';
	if (cpu >= 5)  return 'cpu-mid';
	return 'cpu-low';
};

// ── Sort helpers ──────────────────────────────
const sortHeaders = [thPid, thName, thCpu, thMem, thState];

const updateSortIndicators = () => {
	sortHeaders.forEach(th => {
		if (!th) return;
		th.classList.remove('sort-asc', 'sort-desc');
		const arrow = th.querySelector('.sort-arrow');
		if (th.id === `th-${processSort.key}`) {
			th.classList.add(processSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
			if (arrow) arrow.textContent = processSort.dir === 'asc' ? '↑' : '↓';
		} else {
			if (arrow) arrow.textContent = '↕';
		}
	});
};

const toggleSort = (key) => {
	processSort.dir = processSort.key === key
		? (processSort.dir === 'asc' ? 'desc' : 'asc')
		: 'desc';
	processSort.key = key;
	updateSortIndicators();
};

// ── CPU Core list ─────────────────────────────
const renderCpuCores = (loadPerCore) => {
	if (!Array.isArray(loadPerCore) || loadPerCore.length === 0) {
		cpuCoreList.innerHTML = '<div class="core-row"><strong>No core data</strong></div>';
		return;
	}

	const existing = cpuCoreList.children;
	if (existing.length === loadPerCore.length) {
		// Update in-place — avoids full reflow
		for (let i = 0; i < loadPerCore.length; i++) {
			const value = Number(loadPerCore[i]) || 0;
			const row   = existing[i];
			const fill  = row.querySelector('.core-bar > span');
			const pct   = row.querySelector('.core-percent');
			if (fill) fill.style.width = `${Math.min(100, Math.max(0, value))}%`;
			if (pct)  pct.textContent  = `${value.toFixed(0)}%`;
		}
		return;
	}

	cpuCoreList.innerHTML = '';
	loadPerCore.forEach((value, index) => {
		const row   = document.createElement('div');
		row.className = 'core-row';

		const label = document.createElement('strong');
		label.textContent = `Core ${index + 1}`;

		const bar  = document.createElement('div');
		bar.className = 'core-bar';
		const fill = document.createElement('span');
		fill.style.width = `${Math.min(100, Math.max(0, value))}%`;
		bar.appendChild(fill);

		const pct = document.createElement('span');
		pct.className   = 'core-percent';
		pct.textContent = `${value.toFixed(0)}%`;

		row.append(label, bar, pct);
		cpuCoreList.appendChild(row);
	});
};

// ── Process table ─────────────────────────────
const renderProcesses = (processes) => {
	// Refresh the cache with fresh server data
	if (Array.isArray(processes)) {
		processes.forEach(p => processCache.set(p.pid, p));
	}

	// Combine fresh list with any locked (targeted) PIDs that may have
	// dropped out of the current top-N slice.
	const freshPids = new Set((Array.isArray(processes) ? processes : []).map(p => p.pid));
	let combined    = Array.isArray(processes) ? processes.slice() : [];
	lockedPids.forEach(pid => {
		if (!freshPids.has(pid) && processCache.has(pid)) {
			combined.push({ ...processCache.get(pid), _stale: true });
		}
	});

	// Search filter — applied against the FULL combined list
	const query = (processSearch && processSearch.value || '').trim().toLowerCase();
	let filtered = combined.slice();
	if (query) {
		filtered = filtered.filter(p =>
			String(p.pid).includes(query) ||
			(p.name && p.name.toLowerCase().includes(query))
		);
	}

	// Sort — stale rows pinned to bottom so they don't disrupt live ordering
	filtered.sort((a, b) => {
		if (a._stale && !b._stale) return 1;
		if (!a._stale && b._stale) return -1;
		const key = processSort.key;
		const dir = processSort.dir === 'asc' ? 1 : -1;
		const av  = a[key] ?? '';
		const bv  = b[key] ?? '';
		if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
		return String(av).localeCompare(String(bv)) * dir;
	});

	// Cap to 250 rows when not searching to keep the DOM snappy
	if (!query && filtered.length > 250) {
		const locked = filtered.filter(p => lockedPids.has(p.pid));
		filtered = filtered.slice(0, 250);
		locked.forEach(lp => {
			if (!filtered.some(p => p.pid === lp.pid)) filtered.push(lp);
		});
	}

	if (!filtered.length) {
		processTableBody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No matching processes.</td></tr>';
		return;
	}

	// ── Try in-place update (same PID order → avoids full rebuild) ──────
	const existingRows = Array.from(processTableBody.children || []);
	const existingPids = existingRows.map(r => {
		const td = r.querySelector('td');
		return td ? td.textContent.trim() : null;
	});
	const desiredPids = filtered.map(p => String(p.pid));
	const canUpdateInPlace = existingRows.length === filtered.length &&
		existingPids.every((v, i) => v === desiredPids[i]);

	if (canUpdateInPlace) {
		for (let i = 0; i < filtered.length; i++) {
			const row   = existingRows[i];
			const cells = row.children;
			const p     = filtered[i];
			const badge = p.isMain ? ' <span class="main-badge">Main</span>' : '';
			if (cells[1]) cells[1].innerHTML = `${p.name || ''}${badge}`;
			if (cells[2]) {
				cells[2].textContent = Number(p.cpu || 0).toFixed(1);
				cells[2].className   = cpuClass(p.cpu || 0);
			}
			if (cells[3]) cells[3].textContent = Number(p.mem || 0).toFixed(1);
			if (cells[4]) cells[4].innerHTML   = stateBadge(p.state);
			row.classList.toggle('row-stale', Boolean(p._stale));
			if (cells[5]) {
				const protected_ = window.api && window.api.isProtected(p.pid, p.name);
				if (protected_) {
					cells[5].innerHTML = `<button class="kill-btn protected-btn" disabled title="Critical system process — cannot be killed">🛡 Protected</button>`;
				} else {
					// We only re-render the button HTML if it was previously protected to avoid thrashing event listeners
					let btn = cells[5].querySelector('.kill-btn:not(.protected-btn)');
					if (!btn) {
						const killId = `kill-${p.pid}`;
						cells[5].innerHTML = `<button data-pid="${p.pid}" data-name="${(p.name || '').replace(/"/g, '')}" class="kill-btn" id="${killId}">Kill</button>`;
					} else {
						btn.setAttribute('data-pid', String(p.pid));
						btn.setAttribute('data-name', p.name || '');
					}
				}
			}
		}
		return;
	}

	// ── Full rebuild ─────────────────────────────────────────────────────
	processTableBody.innerHTML = '';
	const fragment = document.createDocumentFragment();

	filtered.forEach(proc => {
		const row    = document.createElement('tr');
		if (proc._stale) row.classList.add('row-stale');
		const killId    = `kill-${proc.pid}`;
		const badge     = proc.isMain ? ' <span class="main-badge">Main</span>' : '';
		const cpu       = Number(proc.cpu  || 0);
		const mem       = Number(proc.mem  || 0);
		const protected_ = window.api && window.api.isProtected(proc.pid, proc.name);

		const actionBtn = protected_
			? `<button class="kill-btn protected-btn" disabled title="Critical system process — cannot be killed">🛡 Protected</button>`
			: `<button data-pid="${proc.pid}" data-name="${(proc.name || '').replace(/"/g, '')}" class="kill-btn" id="${killId}">Kill</button>`;

		row.innerHTML = `
			<td>${proc.pid}</td>
			<td>${proc.name || ''}${badge}</td>
			<td class="${cpuClass(cpu)}">${cpu.toFixed(1)}</td>
			<td>${mem.toFixed(1)}</td>
			<td>${stateBadge(proc.state)}</td>
			<td>${actionBtn}</td>
		`;
		fragment.appendChild(row);
	});

	processTableBody.appendChild(fragment);

	// ── Attach event handlers to Kill buttons ─────────────────────────
	processTableBody.querySelectorAll('.kill-btn:not(.protected-btn)').forEach(btn => {
		if (btn._killHandlerAttached) return;
		btn._killHandlerAttached = true;

		// Lock PID on hover so the row doesn't disappear while the user aims
		btn.addEventListener('mouseenter', () => {
			const pid = Number(btn.getAttribute('data-pid'));
			if (Number.isFinite(pid)) lockedPids.add(pid);
		});
		btn.addEventListener('mouseleave', () => {
			if (!btn.disabled) {
				const pid = Number(btn.getAttribute('data-pid'));
				if (Number.isFinite(pid)) lockedPids.delete(pid);
			}
		});

		btn.addEventListener('click', async () => {
			const pid  = Number(btn.getAttribute('data-pid'));
			const name = btn.getAttribute('data-name') || '';
			if (!Number.isFinite(pid)) return;

			// Client-side guard — belt-and-suspenders on top of server block
			if (window.api && window.api.isProtected(pid, name)) {
				alert(`⚠️ "${name || pid}" is a protected system process.\n\nKilling it could cause a BSOD or force a system reboot. This action is blocked.`);
				return;
			}

			if (!confirm(`Kill process ${pid} (${name})?`)) return;

			lockedPids.add(pid);
			btn.disabled    = true;
			btn.textContent = 'Killing…';

			try {
				await window.api.killProcess(pid, name);
				btn.textContent = '✓ Killed';
				btn.style.color = 'var(--accent-grn)';
				// Keep it visible for 3 s so the user sees it was killed
				setTimeout(() => {
					lockedPids.delete(pid);
					processCache.delete(pid);
					btn.disabled    = false;
					btn.textContent = 'Kill';
					btn.style.color = '';
				}, 3000);
			} catch (err) {
				alert('Failed to kill process: ' + (err && err.message ? err.message : err));
				lockedPids.delete(pid);
				btn.disabled    = false;
				btn.textContent = 'Kill';
				btn.style.color = '';
			}
		});
	});
};

// ── Skeleton loader ───────────────────────────
const renderProcessSkeleton = () => {
	processTableBody.innerHTML = '';
	for (let i = 0; i < 10; i++) {
		const row = document.createElement('tr');
		row.className = 'placeholder-row';
		row.innerHTML = `
			<td>--</td>
			<td>Waiting for data...</td>
			<td>--</td>
			<td>--</td>
			<td><span class="state-badge">--</span></td>
			<td></td>
		`;
		processTableBody.appendChild(row);
	}
};

// ── State → DOM ───────────────────────────────
const applyState = (state) => {
	if (state.status === 'polling' || state.status === 'connected') {
		setStatus('idle', 'Connecting…');
		if (lastUpdated) lastUpdated.textContent = 'Waiting for first metrics…';
		return;
	}
	if (state.status === 'disconnected') {
		setStatus('error', 'Disconnected');
		if (lastUpdated) lastUpdated.textContent = 'Lost connection to server';
		return;
	}
	if (state.status === 'error') {
		setStatus('error', 'Error');
		if (lastUpdated) lastUpdated.textContent = state.error || 'Connection error';
		return;
	}
	if (!state.metrics) return;

	const metrics = state.metrics;
	setStatus('live', 'Live');

	// Timestamp
	try {
		const ts = metrics.timestamp ? new Date(metrics.timestamp) : null;
		if (lastUpdated) lastUpdated.textContent = ts ? `Updated ${ts.toLocaleTimeString()}` : 'Updated';
	} catch (_) { /* ignore */ }

	// CPU
	const cpu    = metrics.cpu || {};
	const cpuPct = Number.isFinite(cpu.load) ? cpu.load : 0;
	if (cpuLoad) cpuLoad.textContent = `${cpuPct.toFixed(1)}%`;
	setRing(cpuRingFill, cpuPct);

	// Memory
	const memory  = metrics.memory || {};
	const memPct  = Number.isFinite(memory.percent) ? memory.percent : 0;
	if (memoryLoad) memoryLoad.textContent = `${memPct.toFixed(1)}%`;
	setRing(memRingFill, memPct);
	if (memoryBarFill) memoryBarFill.style.width = `${Math.min(100, Math.max(0, memPct))}%`;
	if (memoryBarPct)  memoryBarPct.textContent  = `${memPct.toFixed(0)}%`;
	if (memoryDetails) memoryDetails.textContent = `${formatBytes(memory.used || 0)} / ${formatBytes(memory.total || 0)}`;
	if (memoryUsed)  memoryUsed.textContent  = formatBytes(memory.used  || 0);
	if (memoryFree)  memoryFree.textContent  = formatBytes(memory.free  || 0);
	if (memoryTotal) memoryTotal.textContent = formatBytes(memory.total || 0);

	// Process count
	const processes = Array.isArray(metrics.processes) ? metrics.processes : [];
	if (processCount) processCount.textContent = processes.length || '--';

	// Uptime
	if (uptimeValue) uptimeValue.textContent = Number.isFinite(metrics.uptime) ? formatUptime(metrics.uptime) : '--:--:--';

	// CPU brand
	if (cpuBrand) cpuBrand.textContent = cpu.label || `${cpu.manufacturer || ''} ${cpu.brand || ''}`.trim() || 'Detecting…';

	// CPU cores
	renderCpuCores(Array.isArray(cpu.loadPerCore) ? cpu.loadPerCore : []);

	// Process table
	try { renderProcesses(processes); } catch (err) { console.error('Process render failed:', err); }
};

// ── Boot ──────────────────────────────────────
window.appState.subscribe(applyState);
renderProcessSkeleton();
updateSortIndicators();

// Search
if (processSearch) {
	processSearch.addEventListener('input', () => {
		const state = window.appState.getState();
		if (state.metrics) renderProcesses(state.metrics.processes);
	});
	// Clear on Escape
	processSearch.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') {
			processSearch.value = '';
			const state = window.appState.getState();
			if (state.metrics) renderProcesses(state.metrics.processes);
		}
	});
}

// Sort headers
const bindSort = (el, key) => {
	if (!el) return;
	el.addEventListener('click', () => {
		toggleSort(key);
		const state = window.appState.getState();
		if (state.metrics) renderProcesses(state.metrics.processes);
	});
};
bindSort(thPid,   'pid');
bindSort(thName,  'name');
bindSort(thCpu,   'cpu');
bindSort(thMem,   'mem');
bindSort(thState, 'state');
