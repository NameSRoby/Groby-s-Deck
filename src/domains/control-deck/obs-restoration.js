/** Receipts bind to the original OBS collection and exact source/item identifiers. */
module.exports =
  ({ targets, cache, connected, request, visibility, filterList, refresh, notify, fault }) =>
  (id) => {
    const target = targets.rows.get(id);
    if (!target) return null;
    const t = structuredClone(target),
      signature = JSON.stringify(t),
      collection = cache.collection,
      kind = t.kind.startsWith("source-")
        ? "source"
        : t.kind.startsWith("filter-")
          ? "filter"
          : ["mute", "unmute", "mute-toggle"].includes(t.kind)
            ? "mute"
            : t.kind === "volume"
              ? "volume"
              : ["scene", "preview"].includes(t.kind)
                ? t.kind
                : "";
    if (!kind) return null;
    const check = (signal) => {
      if (
        signal?.aborted ||
        !connected() ||
        JSON.stringify(targets.rows.get(id)) !== signature ||
        collection !== cache.collection ||
        (t.collectionName && t.collectionName !== cache.collection)
      )
        throw fault("control_deck_restore_target_changed");
    };
    const leaseKey = `obs:${cache.collection}:${kind}:${t.sourceName || kind}`;
    return {
      leaseKey,
      key:
        leaseKey +
        (kind === "source"
          ? `:${t.scope}:${t.sceneName || ""}`
          : kind === "filter"
            ? `:${t.filterName}`
            : ""),
      async capture(signal) {
        check(signal);
        if (kind === "source") {
          const rows = await visibility.read(t, true);
          check(signal);
          if (!rows.length || rows.some((row) => typeof row.sceneItemEnabled !== "boolean"))
            throw fault("obs_source_missing");
          return {
            rows: rows.map((row) => ({
              sceneName: row.sceneName,
              sceneItemId: row.sceneItemId,
              enabled: row.sceneItemEnabled,
            })),
          };
        }
        if (kind === "filter") {
          const row = (await filterList(t.sourceName, true)).find(
            (row) => row.filterName === t.filterName,
          );
          check(signal);
          if (typeof row?.filterEnabled !== "boolean") throw fault("obs_filter_missing");
          return { enabled: row.filterEnabled };
        }
        if (kind === "mute") {
          const row = await request("GetInputMute", { inputName: t.sourceName });
          check(signal);
          if (typeof row.inputMuted !== "boolean") throw fault("obs_audio_unavailable");
          return { muted: row.inputMuted };
        }
        if (kind === "volume") {
          const row = await request("GetInputVolume", { inputName: t.sourceName });
          check(signal);
          if (!Number.isFinite(row.inputVolumeMul) || row.inputVolumeMul < 0)
            throw fault("obs_audio_unavailable");
          return { volume: row.inputVolumeMul };
        }
        await refresh(true);
        return { scene: kind === "scene" ? cache.program : cache.preview };
      },
      async restore(saved, signal) {
        check(signal);
        if (kind === "source") {
          const rows = await visibility.read(t, true);
          for (const row of saved.rows) {
            check(signal);
            if (
              !rows.some(
                (next) => next.sceneName === row.sceneName && next.sceneItemId === row.sceneItemId,
              )
            )
              throw fault("control_deck_restore_target_changed");
            await request("SetSceneItemEnabled", {
              sceneName: row.sceneName,
              sceneItemId: row.sceneItemId,
              sceneItemEnabled: row.enabled,
            });
          }
          const confirmed = await visibility.read(t, true);
          if (
            saved.rows.some(
              (row) =>
                !confirmed.some(
                  (next) =>
                    next.sceneName === row.sceneName &&
                    next.sceneItemId === row.sceneItemId &&
                    next.sceneItemEnabled === row.enabled,
                ),
            )
          )
            throw fault("control_deck_restore_unconfirmed");
        } else if (kind === "filter") {
          check(signal);
          await request("SetSourceFilterEnabled", {
            sourceName: t.sourceName,
            filterName: t.filterName,
            filterEnabled: saved.enabled,
          });
          if (
            (await filterList(t.sourceName, true)).find((row) => row.filterName === t.filterName)
              ?.filterEnabled !== saved.enabled
          )
            throw fault("control_deck_restore_unconfirmed");
        } else if (kind === "mute" || kind === "volume") {
          await request(kind === "mute" ? "SetInputMute" : "SetInputVolume", {
            inputName: t.sourceName,
            ...(kind === "mute" ? { inputMuted: saved.muted } : { inputVolumeMul: saved.volume }),
          });
          const row = await request(kind === "mute" ? "GetInputMute" : "GetInputVolume", {
            inputName: t.sourceName,
          });
          if (
            kind === "mute"
              ? row.inputMuted !== saved.muted
              : !Number.isFinite(row.inputVolumeMul) ||
                Math.abs(row.inputVolumeMul - saved.volume) > 1e-6
          )
            throw fault("control_deck_restore_unconfirmed");
        } else {
          if (!cache.scenes.some((row) => row.sceneName === saved.scene))
            throw fault("control_deck_restore_target_changed");
          await request(kind === "scene" ? "SetCurrentProgramScene" : "SetCurrentPreviewScene", {
            sceneName: saved.scene,
          });
          await refresh(true);
        }
        check(signal);
        notify();
        return { ok: true };
      },
    };
  };
