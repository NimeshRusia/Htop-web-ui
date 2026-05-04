(() => {
	const getStore = () => {
		if (!window.appState) {
			throw new Error('Global state is not initialized.');
		}

		return window.appState;
	};

	// Legacy fallback: try fetch once if sockets aren't available.
	const fetchOnceFallback = async () => {
		try {
			const response = await fetch('/api/metrics');
			if (!response.ok) throw new Error(`Metrics request failed with status ${response.status}`);
			const metrics = await response.json();
			console.log('Metrics fetched (fallback):', metrics);
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

			// If socket client is present and connected, socket.js will update the state.
			// If not present (older browsers), perform a single fetch as a fallback.
			if (!window.io) {
				// No socket.io client available
				fetchOnceFallback();
			}
		} catch (error) {
			console.error('Error initializing api client:', error);
		}
	});
})();

// Client-side API helpers
window.api = {
	killProcess: async (pid) => {
		try {
			const response = await fetch('/api/processes/kill', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ pid }),
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