/** Widget intake setup and generated-code controls. */
globalThis.initWidgetSetup = ({
  byId,
  request,
  setStatus,
  setUnavailable,
  hasFixtures,
  hasSongRequest,
}) => {
  const rewardFields = ["colorRewardId", "teachRewardId", "songRewardId", "playlistRewardId"];
  const rewardIds = () => Object.fromEntries(rewardFields.map((id) => [id, byId(id).value.trim()]));
  let widgetSecurityStatus = {};
  byId("baseUrl").value = location.origin;
  function applyWidgetSensitiveVisibility() {
    const reveal = byId("showWidgetSensitive").checked;
    byId("baseUrl").type = reveal ? "text" : "password";
    byId("intakeToken").type = reveal ? "text" : "password";
    byId("widgetOutput").style.webkitTextSecurity = reveal ? "none" : "disc";
  }
  byId("showWidgetSensitive").onchange = applyWidgetSensitiveVisibility;
  applyWidgetSensitiveVisibility();

  function applyWidgetSecurity(status = {}) {
    widgetSecurityStatus = status;
    const managed = status.managementAvailable === true;
    const configured = status.configured === true;
    const widgetStatusText =
      status.mode === "environment_read_only"
        ? "ENV TOKEN ACTIVE"
        : configured
          ? status.overlapActive
            ? "TOKEN ROTATING"
            : "HOSTED INTAKE READY"
          : "SERVER TOKEN REQUIRED";
    setStatus(
      "widgetStatus",
      widgetStatusText,
      configured ? (status.overlapActive ? "warn" : "ok") : "warn",
    );
    byId("rotateIntakeToken").disabled = !managed;
    byId("clearIntakeToken").disabled = !managed || !configured;
    byId("rotateIntakeToken").textContent = configured ? "ROTATE TOKEN" : "GENERATE TOKEN";
    byId("rotateIntakeToken").title = managed
      ? "Generate and reveal a server-managed intake token once"
      : "Token is controlled by GROBYS_DECK_WIDGET_INTAKE_TOKEN";
    updateWidgetReadiness();
  }
  function setupProblem() {
    const ids = rewardIds();
    if (!Object.values(ids).some(Boolean)) return "ADD AT LEAST ONE REWARD ID";
    if (ids.colorRewardId && !hasFixtures())
      return "PAIR OR ADD A USABLE FIXTURE FOR THE LIGHT REWARD";
    if ((ids.songRewardId || ids.playlistRewardId) && !hasSongRequest())
      return "INSTALL AND ENABLE SONG REQUEST BEFORE ROUTING ITS REWARD";
    try {
      const url = new URL(byId("baseUrl").value);
      if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
        return "BRIDGE URL MUST BE LOOPBACK HTTP";
    } catch {
      return "BRIDGE URL IS INVALID";
    }
    return "";
  }
  function widgetGenerationProblem(problem = setupProblem()) {
    if (problem) return problem;
    if (!byId("intakeToken").value.trim())
      return widgetSecurityStatus.overlapActive
        ? "TOKEN WAS ROTATED // ROTATE ONCE MORE TO REVEAL A TOKEN, THEN VERIFY, GENERATE, AND REPLACE THE STREAM ELEMENTS CODE"
        : "GENERATE OR ENTER AN INTAKE TOKEN";
    return "";
  }

  function updateWidgetReadiness() {
    const rebuildProblem = setupProblem();
    const problem = widgetGenerationProblem(rebuildProblem);
    byId("generateWidget").disabled = Boolean(problem);
    setUnavailable(
      byId("rebuildWidget"),
      !widgetSecurityStatus.managementAvailable || Boolean(rebuildProblem),
      !widgetSecurityStatus.managementAvailable
        ? "The intake token is managed by the server environment."
        : rebuildProblem,
    );
    byId("widgetNotice").textContent = problem || "READY TO GENERATE";
    byId("widgetNotice").className = `notice${problem ? " bad" : ""}`;
    const hasOutput = Boolean(byId("widgetOutput").value);
    setUnavailable(byId("copyWidget"), !hasOutput, "Generate widget code before copying it.");
    setUnavailable(
      byId("testIntakeToken"),
      !byId("intakeToken").value.trim(),
      "Generate or enter an intake token before verifying it.",
    );
  }
  for (const id of [...rewardFields, "baseUrl", "intakeToken"])
    byId(id).oninput = updateWidgetReadiness;
  byId("rotateIntakeToken").onclick = async () => {
    if (
      byId("rotateIntakeToken").textContent === "ROTATE TOKEN" &&
      !confirm(
        "Rotate the widget token? Existing widgets keep working briefly during the overlap window.",
      )
    )
      return;
    try {
      const result = await request("/system/widget-token/rotate", {
        method: "POST",
        body: "{}",
      });
      byId("intakeToken").value = result.token || "";
      byId("intakeToken").focus();
      byId("intakeToken").select();
      applyWidgetSecurity(result.widgetSecurity);
    } catch (error) {
      byId("widgetOutput").value = error.message;
    }
  };
  byId("clearIntakeToken").onclick = async () => {
    if (
      !confirm(
        "Revoke the current and overlapping widget tokens? Hosted widgets will stop until a new token is generated.",
      )
    )
      return;
    try {
      const result = await request("/system/widget-token/clear", {
        method: "POST",
        body: "{}",
      });
      byId("intakeToken").value = "";
      applyWidgetSecurity(result.widgetSecurity);
    } catch (error) {
      byId("widgetOutput").value = error.message;
    }
  };
  byId("testIntakeToken").onclick = async () => {
    try {
      const token = byId("intakeToken").value.trim();
      const result = await request("/widget/events", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          contract: "widget.events.v2",
          source: "streamelements",
          eventEnvelope: {
            detail: {
              listener: "message",
              event: { text: "groby-intake-health-check" },
            },
          },
          widgetConfig: rewardIds(),
        }),
      });
      byId("widgetNotice").textContent =
        result.disposition === "irrelevant"
          ? "INTAKE TOKEN VERIFIED // GENERATE AND REPLACE THE STREAM ELEMENTS WIDGET CODE"
          : "INTAKE TOKEN VERIFIED";
      byId("widgetNotice").className = "notice";
    } catch (error) {
      byId("widgetNotice").textContent = `INTAKE TOKEN REJECTED // ${error.message}`;
      byId("widgetNotice").className = "notice bad";
    }
  };
  byId("generateWidget").onclick = async () => {
    const problem = widgetGenerationProblem();
    if (problem) return updateWidgetReadiness();
    try {
      const result = await request("/system/widget-template-get", {
        method: "POST",
        body: JSON.stringify({
          ...rewardIds(),
          baseUrl: byId("baseUrl").value,
          widgetIntakeToken: byId("intakeToken").value,
        }),
      });
      byId("widgetOutput").value = result.script || "";
      byId("intakeToken").value = "";
      updateWidgetReadiness();
      applyWidgetSensitiveVisibility();
      byId("widgetNotice").textContent = "WIDGET CODE GENERATED";
      byId("widgetNotice").className = "notice";
    } catch (error) {
      byId("widgetNotice").textContent = error.message;
      byId("widgetNotice").className = "notice bad";
    }
  };
  byId("rebuildWidget").onclick = async () => {
    if (
      !confirm(
        "Create replacement widget code? This rotates the intake token. The currently deployed widget remains valid for ten minutes while you replace its JavaScript.",
      )
    )
      return;
    try {
      const result = await request("/system/widget-template-rebuild", {
        method: "POST",
        body: JSON.stringify({
          ...rewardIds(),
          baseUrl: byId("baseUrl").value,
        }),
      });
      byId("widgetOutput").value = result.script || "";
      byId("intakeToken").value = "";
      applyWidgetSecurity(result.widgetSecurity);
      applyWidgetSensitiveVisibility();
      byId("widgetNotice").textContent =
        "REPLACEMENT READY // COPY IT INTO THE STREAM ELEMENTS CUSTOM WIDGET JS AND SAVE";
      byId("widgetNotice").className = "notice";
    } catch (error) {
      byId("widgetNotice").textContent = `REBUILD FAILED // ${error.message}`;
      byId("widgetNotice").className = "notice bad";
    }
  };
  async function refreshWidgetConnection() {
    try {
      const diagnostics = await request("/system/diagnostics");
      const counters = diagnostics.domains?.widget?.counters || {};
      const received = Number(counters.received || 0),
        ready = Number(counters.ready || 0),
        handled = Number(counters.handled || 0),
        rejected = Number(counters.rejected || 0);
      const message =
        handled > 0
          ? `DEPLOYMENT ACTIVE // ${handled} REDEMPTION${handled === 1 ? "" : "S"} HANDLED`
          : ready > 0
            ? `DEPLOYMENT CONNECTED // ${ready} AUTHENTICATED WIDGET LOAD${ready === 1 ? "" : "S"}; NO MATCHING REDEMPTION YET`
            : rejected > 0
              ? `DEPLOYED WIDGET TOKEN REJECTED ${rejected} TIME${rejected === 1 ? "" : "S"} // REBUILD AND REPLACE THE STREAM ELEMENTS JS`
              : "NO WIDGET CONTACT YET // REBUILD, PASTE THE JS INTO STREAM ELEMENTS, SAVE, THEN REFRESH ITS OBS SOURCE";
      byId("widgetConnectionNotice").textContent = message;
      byId("widgetConnectionNotice").className =
        `notice${handled > 0 || received > 0 ? "" : " bad"}`;
    } catch (error) {
      byId("widgetConnectionNotice").textContent = `DEPLOYMENT CHECK FAILED // ${error.message}`;
      byId("widgetConnectionNotice").className = "notice bad";
    }
  }
  byId("refreshWidgetConnection").onclick = refreshWidgetConnection;
  byId("copyWidget").onclick = async () => {
    if (!byId("widgetOutput").value) return;
    try {
      await navigator.clipboard.writeText(byId("widgetOutput").value);
      byId("widgetNotice").textContent = "WIDGET CODE COPIED";
      byId("widgetNotice").className = "notice";
    } catch {
      byId("widgetNotice").textContent =
        "COPY BLOCKED BY BROWSER // SELECT THE GENERATED OUTPUT MANUALLY";
      byId("widgetNotice").className = "notice bad";
    }
  };
  return { applySecurity: applyWidgetSecurity, updateReadiness: updateWidgetReadiness };
};
