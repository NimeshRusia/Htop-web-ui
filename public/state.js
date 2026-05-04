(() => {
	const listeners = new Set();
	const state = {
		metrics: null,
		status: 'idle',
		error: null,
		lastUpdated: null,
	};

	const getState = () => ({
		metrics: state.metrics,
		status: state.status,
		error: state.error,
		lastUpdated: state.lastUpdated,
	});

	// Throttle/coalesce notifications to avoid UI thrashing on rapid updates.
	const MIN_NOTIFY_INTERVAL = 100; // ms
	let lastNotify = 0;
	let notifyScheduled = false;

	const notifyNow = () => {
		notifyScheduled = false;
		lastNotify = Date.now();
		const snapshot = getState();
		try {
			requestAnimationFrame(() => {
				listeners.forEach((listener) => {
					try {
						listener(snapshot);
					} catch (err) {
						// swallow listener errors to avoid breaking state
						console.error('State listener error:', err);
					}
				});
			});
		} catch (err) {
			listeners.forEach((listener) => {
				try {
					listener(snapshot);
				} catch (e) {
					console.error('State listener error:', e);
				}
			});
		}
	};

	const scheduleNotify = () => {
		if (notifyScheduled) return;
		const now = Date.now();
		const elapsed = now - lastNotify;
		if (elapsed >= MIN_NOTIFY_INTERVAL) {
			notifyNow();
			return;
		}

		notifyScheduled = true;
		setTimeout(() => {
			notifyNow();
		}, MIN_NOTIFY_INTERVAL - elapsed);
	};

	window.appState = {
		getState,
		subscribe(listener) {
			listeners.add(listener);
			try {
				listener(getState());
			} catch (err) {
				console.error('Subscriber initialize error:', err);
			}

			return () => {
				listeners.delete(listener);
			};
		},
		setState(partialState) {
			if (!partialState || typeof partialState !== 'object') return;
			Object.assign(state, partialState);
			scheduleNotify();
		},
	};
})();