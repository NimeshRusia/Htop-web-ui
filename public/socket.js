(() => {
    if (!window.appState) {
        console.warn('Global state not ready for socket connections.');
        return;
    }

    const socket = io();

    socket.on('connect', () => {
        try {
            window.appState.setState({ status: 'connected', error: null });
        } catch (err) {
            console.warn('appState not ready on connect');
        }
        console.log('Socket connected:', socket.id);
    });

    socket.on('disconnect', (reason) => {
        try {
            window.appState.setState({ status: 'disconnected' });
        } catch (err) {
            /* ignore */
        }
        console.warn('Socket disconnected:', reason);
    });

    socket.on('system-metrics', (metrics) => {
        try {
            if (!metrics || typeof metrics !== 'object') {
                console.warn('Ignoring invalid metrics payload');
                return;
            }

            // Defensive: ensure minimal fields exist
            const safeMetrics = Object.assign({ timestamp: new Date().toISOString(), uptime: 0, cpu: { load: 0, loadPerCore: [] }, memory: { percent: 0, total: 0, used: 0, free: 0 }, processes: [] }, metrics);

            window.appState.setState({
                metrics: safeMetrics,
                status: 'ready',
                error: null,
                lastUpdated: safeMetrics.timestamp,
            });
        } catch (err) {
            console.error('Error handling metrics:', err);
        }
    });

    socket.on('system-metrics-error', (payload) => {
        const message = payload && payload.message ? payload.message : 'Unknown metrics error';
        console.error('Metrics error from server:', message);
        try {
            window.appState.setState({ status: 'error', error: message });
        } catch (err) {
            /* ignore */
        }
    });

    // Expose socket for debugging
    window.appSocket = socket;
})();
