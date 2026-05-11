(() => {
	const getStore = () => {
		if (!window.appState) throw new Error('Global state is not initialized.');
		return window.appState;
	};

	// Legacy fallback: try fetch once if sockets aren't available.
	const fetchOnceFallback = async () => {
		try {
			const response = await fetch('/api/metrics');
			if (!response.ok) throw new Error(`Metrics request failed with status ${response.status}`);
			const metrics = await response.json();
			getStore().setState({ metrics, status: 'ready', error: null, lastUpdated: metrics.timestamp });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error('Fallback metrics fetch failed:', message);
			getStore().setState({ status: 'error', error: message });
		}
	};

	window.addEventListener('DOMContentLoaded', () => {
		try {
			getStore().setState({ status: 'initializing', error: null });
			if (!window.io) fetchOnceFallback();
		} catch (error) {
			console.error('Error initializing api client:', error);
		}
	});
})();

// ── Client-side API helpers ───────────────────────────────────────────────

// Protected process data fetched from the server on load.
// Used by the UI to proactively disable Kill buttons.
window.protectedProcesses = { pids: new Set(), names: new Set() };

fetch('/api/protected-processes')
	.then(r => r.json())
	.then(data => {
		window.protectedProcesses.pids  = new Set(data.pids  || []);
		window.protectedProcesses.names = new Set((data.names || []).map(n => n.toLowerCase()));
		console.info('[SysMon] Protected processes loaded:', data);
	})
	.catch(err => console.warn('[SysMon] Could not load protected processes list:', err));

window.api = {
	/**
	 * Returns true if the given process is protected and must not be killed.
	 * @param {number} pid
	 * @param {string} name
	 */
	isProtected(pid, name) {
		if (window.protectedProcesses.pids.has(pid)) return true;
		if (name && window.protectedProcesses.names.has(name.toLowerCase().trim())) return true;
		return false;
	},

	/**
	 * Send a kill signal to the given PID.
	 * Also sends the name so the server can double-check the protected list.
	 * @param {number} pid
	 * @param {string} [name]
	 */
	killProcess: async (pid, name) => {
		try {
			const response = await fetch('/api/processes/kill', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ pid, name }),
			});

			if (!response.ok) {
				const body = await response.json().catch(() => ({}));
				throw new Error(body && body.message ? body.message : `Kill request failed (${response.status})`);
			}

			return response.json();
		} catch (err) {
			console.error('Failed to kill process:', err);
			throw err;
		}
	},
};