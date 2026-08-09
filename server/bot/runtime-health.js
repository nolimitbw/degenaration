function buildRuntimeHealth({ build, ready, guilds, approvedChannels, runtime }) {
  const refreshHealthy = Boolean(runtime.approvedRefresh.lastSuccessAt) && !runtime.approvedRefresh.lastError;
  return {
    httpStatus: ready && refreshHealthy ? 200 : 503,
    body: {
      status: ready && refreshHealthy ? "ok" : ready ? "degraded" : "starting",
      version: build,
      discord: {
        ready,
        guilds: ready ? guilds : 0,
        commands: { ...runtime.commands }
      },
      source_bridge: {
        approvedChannels,
        approvedRefresh: { ...runtime.approvedRefresh },
        registration: { ...runtime.registration }
      }
    }
  };
}

module.exports = { buildRuntimeHealth };
