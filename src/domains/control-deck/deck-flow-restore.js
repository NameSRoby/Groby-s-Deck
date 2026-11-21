/** Temporary changes retain exact prior values and exclude overlapping flow owners. */
module.exports = function restoration(actions, fault) {
  const leases = new Map();
  return (runId) => {
    const scopes = [];
    async function restore() {
      const scope = scopes.pop();
      if (!scope) return;
      const signal = AbortSignal.timeout(8000);
      let failure;
      for (const [, entry] of [...scope].reverse()) {
        try {
          const receipt = await entry.receipt;
          if (signal.aborted) throw fault("control_deck_restore_failed");
          await entry.target.restore(receipt, signal);
        } catch (error) {
          failure ||= error;
        } finally {
          const lease = leases.get(entry.leaseKey);
          if (lease?.runId === runId && --lease.count === 0) leases.delete(entry.leaseKey);
        }
      }
      if (failure) throw fault("control_deck_restore_failed");
    }
    return {
      remember: () => scopes.push(new Map()),
      restore,
      async capture(id, params, signal) {
        const scope = scopes.at(-1),
          target = actions.restorationTarget?.(id, params);
        if (!target) return;
        const leaseKey = target.leaseKey || target.key,
          lease = leases.get(leaseKey);
        if (lease && lease.runId !== runId) throw fault("control_deck_target_busy");
        if (!scope) return;
        if (!scope.has(target.key)) {
          leases.set(leaseKey, { runId, count: (lease?.count || 0) + 1 });
          scope.set(target.key, {
            target,
            leaseKey,
            receipt: Promise.resolve().then(() => target.capture(signal)),
          });
        }
        const entry = scope.get(target.key);
        try {
          await entry.receipt;
        } catch (error) {
          if (scope.get(target.key) === entry) {
            scope.delete(target.key);
            const current = leases.get(leaseKey);
            if (current && --current.count === 0) leases.delete(leaseKey);
          }
          throw error;
        }
      },
      async finish() {
        let error;
        while (scopes.length) {
          try {
            await restore();
          } catch (e) {
            error = e;
          }
        }
        if (error) throw error;
      },
    };
  };
};
