import AdminSection from "./AdminSection";

function mergeConfig(data, draft = {}) {
  const config = data?.config || { twitch: {}, tiktok: {} };
  return {
    twitchLogin: draft.twitchLogin ?? config.twitch?.login ?? "",
    twitchEnabled: draft.twitchEnabled ?? config.twitch?.enabled ?? false,
    twitchClientId: draft.twitchClientId ?? config.twitch?.clientId ?? "",
    twitchClientSecret: draft.twitchClientSecret ?? "",
    twitchClientSecretClear: draft.twitchClientSecretClear ?? false,
    twitchClientSecretConfigured: config.twitch?.clientSecretConfigured === true,
    twitchPollIntervalSeconds: draft.twitchPollIntervalSeconds ?? config.twitch?.pollIntervalSeconds ?? 300,
    tiktokHandle: draft.tiktokHandle ?? config.tiktok?.handle ?? "",
    tiktokEnabled: draft.tiktokEnabled ?? config.tiktok?.enabled ?? false,
    tiktokLive: draft.tiktokLive ?? config.tiktok?.live ?? false,
    tiktokTitle: draft.tiktokTitle ?? config.tiktok?.title ?? ""
  };
}

export function updateLiveDraft(data, draft, changes) {
  const baseline = mergeConfig(data);
  const next = { ...(draft || {}), ...changes };
  for (const key of Object.keys(next)) if (next[key] === baseline[key]) delete next[key];
  return next;
}

export default function LiveAdminSection({ data, draft = {}, error, busy, onChange }) {
  const value = mergeConfig(data, draft);
  const status = data?.status || {};
  return <AdminSection title="Live tracking" dirty={Object.keys(draft).length ? 1 : 0} errors={error ? 1 : 0}>
    <p className="admin-copy">Configure the accounts shown on the public site. Twitch status is checked automatically with the official Helix API. Twitch client credentials stay on the server and can be changed here. TikTok live status is a manual toggle because TikTok does not provide a documented public live-status API.</p>
    <div className="admin-form live-admin-form">
      <fieldset className="admin-upload-fields" disabled={busy}>
        <legend>Twitch</legend>
        <label className="admin-embed-toggle"><input type="checkbox" checked={value.twitchEnabled} onChange={event => onChange({ twitchEnabled: event.target.checked })} /> Enable Twitch tracking</label>
        <label>Login<input type="text" value={value.twitchLogin} onChange={event => onChange({ twitchLogin: event.target.value })} placeholder="thesxber" maxLength={25} autoComplete="off" /></label>
        <label>Client ID<input type="text" value={value.twitchClientId} onChange={event => onChange({ twitchClientId: event.target.value })} maxLength={128} autoComplete="off" /></label>
        <label>Client secret<input type="password" value={value.twitchClientSecret} onChange={event => onChange({ twitchClientSecret: event.target.value, twitchClientSecretClear: false })} placeholder={value.twitchClientSecretConfigured ? "Leave blank to keep the saved secret" : "Enter Twitch client secret"} maxLength={256} autoComplete="new-password" /></label>
        {value.twitchClientSecretConfigured && <label className="admin-embed-toggle"><input type="checkbox" checked={value.twitchClientSecretClear} onChange={event => onChange({ twitchClientSecretClear: event.target.checked, twitchClientSecret: "" })} /> Clear saved client secret</label>}
        <label>Polling interval (seconds)<input type="number" min="60" max="86400" step="1" value={value.twitchPollIntervalSeconds} onChange={event => onChange({ twitchPollIntervalSeconds: Number(event.target.value) })} /></label>
        {status.twitch?.checkedAt && <small>Last check: {new Date(status.twitch.checkedAt).toLocaleString()}{status.twitch.stale ? " (stale; last result retained)" : ""}</small>}
      </fieldset>
      <fieldset className="admin-upload-fields" disabled={busy}>
        <legend>TikTok</legend>
        <label className="admin-embed-toggle"><input type="checkbox" checked={value.tiktokEnabled} onChange={event => onChange({ tiktokEnabled: event.target.checked })} /> Enable TikTok status</label>
        <label>Handle<input type="text" value={value.tiktokHandle} onChange={event => onChange({ tiktokHandle: event.target.value })} placeholder="thesxber" maxLength={24} autoComplete="off" /></label>
        <label className="admin-embed-toggle"><input type="checkbox" checked={value.tiktokLive} onChange={event => onChange({ tiktokLive: event.target.checked })} /> Mark TikTok as live</label>
        <label>Live title<input type="text" value={value.tiktokTitle} onChange={event => onChange({ tiktokTitle: event.target.value })} maxLength={120} placeholder="What is happening right now?" /></label>
      </fieldset>
      {error && <p className="admin-row-error" role="alert">{error}</p>}
    </div>
  </AdminSection>;
}
