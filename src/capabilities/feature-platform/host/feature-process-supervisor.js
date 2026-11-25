/**
 * Feature process supervisor.
 * Developer context and change constraints:
 * docs/DEVELOPMENT.md#supervised-workers-contracts-and-packages
 */
const path = require("node:path");
const createProcessSupervisor = require("../../supervised-runtime/host/process-supervisor");
const { buildProcessPermissions } = require("../../supervised-runtime/host/process-permissions");
const { validateFeatureManifestV1 } = require("../contracts/feature-manifest-v1");

module.exports = function createFeatureProcessSupervisor(options = {}) {
  return createProcessSupervisor({
    ...options,
    // Cold Windows starts include file verification and restoring paged state.
    // Keep the deadline bounded without treating ordinary disk latency as a crash.
    startupTimeoutMs: options.startupTimeoutMs ?? 30000,
    workloadKind: "feature",
    displayName: "Feature",
    identityField: "featureId",
    statusIdentityField: "featureId",
    apiMajor: 1,
    validateManifest: validateFeatureManifestV1,
    buildPermissions: (permissionOptions) =>
      buildProcessPermissions({
        ...permissionOptions,
        additionalReadRoots: [path.join(__dirname, "..", "..", "supervised-runtime")],
      }),
    platformRoot: options.platformRoot || path.join(__dirname, "..", "..", "supervised-runtime"),
    bootstrapPath:
      options.bootstrapPath ||
      path.join(__dirname, "..", "..", "supervised-runtime", "runtime", "worker-bootstrap.js"),
  });
};
