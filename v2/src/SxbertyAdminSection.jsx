import { useEffect, useState } from "react";
import AdminSection from "./AdminSection";
import { SXBERTY_PHASES } from "../shared/sxberty.js";
import { getSxbertyPhraseError, parseSxbertyPhrases } from "./sxberty-drafts.js";
import SxbertyFoodAdmin from "./SxbertyFoodAdmin";
import { getSxbertyFoodCounts } from "./sxberty-food-drafts.js";
import SxbertyVoiceAdmin from "./SxbertyVoiceAdmin";
import { getSxbertyVoiceCounts } from "./sxberty-voice-drafts.js";

function happinessRange({ id, min, max }) {
  if (id === "happy") return `Above ${min}% to ${max}% happiness`;
  if (id === "uneasy") return `${min}% to ${max}% happiness (inclusive)`;
  if (id === "angry") return `Above 0% and below ${max}% happiness`;
  if (id === "abandoned") return "0% happiness";
  return `${min}% to below ${max}% happiness`;
}

export default function SxbertyAdminSection({ settings, draft = {}, error, loadError, loading, busy, onChange, onRetry, foods = {}, voices = {} }) {
  const [text, setText] = useState({});
  // Native details keeps these buffers mounted across collapses. A newly installed
  // server baseline clears only formatting; any remaining draft still wins below.
  useEffect(() => { setText({}); }, [settings]);
  const phrasesFor = id => draft.phrases?.[id] ?? settings?.phrases?.[id] ?? [];
  const invalidPhases = SXBERTY_PHASES.filter(phase => getSxbertyPhraseError(phrasesFor(phase.id))).length;
  const foodCounts = getSxbertyFoodCounts(foods.items || [], foods.drafts || {}, foods.errors || {});
  const voiceCounts = getSxbertyVoiceCounts(voices.items || [], voices.drafts || {}, voices.errors || {});
  return <AdminSection title="Sxberty" count={SXBERTY_PHASES.length + (foods.items?.length || 0) + (voices.items?.length || 0)}
    dirty={(draft.phrases ? 1 : 0) + foodCounts.dirty + voiceCounts.dirty}
    errors={(invalidPhases || (error || loadError ? 1 : 0)) + foodCounts.errors + Number(Boolean(foods.loadError)) + Number(Boolean(foods.actionError))
      + voiceCounts.errors + Number(Boolean(voices.loadError)) + Number(Boolean(voices.actionError))}>
    <p className="admin-copy" id="sxberty-phrase-help">Edit what Sxberty says at each happiness phase, then use Save all to publish. Enter one plain-text phrase per line, up to 20 phrases per phase and 160 characters per phrase. Blank lines are ignored. Leave a phase empty to restore its built-in phrases when Sxberty speaks.</p>
    {loading && <p className="admin-message" role="status">Loading Sxberty phrases…</p>}
    {loadError && <div className="admin-row-error" role="alert"><p>{loadError}</p><button type="button" disabled={busy || loading} onClick={onRetry}>Retry loading Sxberty phrases</button></div>}
    <div className="admin-form sxberty-admin-form">
      <fieldset className="admin-upload-fields" disabled={busy || loading || !settings}>
        <legend>Happiness phases</legend>
        {SXBERTY_PHASES.map(phase => {
          const phrases = phrasesFor(phase.id);
          const phaseError = getSxbertyPhraseError(phrases);
          return <div className="sxberty-phase-field" key={phase.id}>
            <label htmlFor={`sxberty-phrases-${phase.id}`}>{phase.label} — {happinessRange(phase)}
              <textarea id={`sxberty-phrases-${phase.id}`} rows={5}
                value={text[phase.id] ?? phrases.join("\n")}
                placeholder="Leave blank to use built-in phrases"
                aria-describedby={`sxberty-phrase-help sxberty-phrases-${phase.id}-status`}
                aria-invalid={Boolean(phaseError)}
                onChange={event => {
                  const value = event.target.value;
                  setText(current => ({ ...current, [phase.id]: value }));
                  onChange(phase.id, parseSxbertyPhrases(value));
                }} />
            </label>
            <small id={`sxberty-phrases-${phase.id}-status`} className={phaseError ? "admin-row-error" : "admin-character-count"}>
              {phaseError || `${phrases.length}/20 phrases${phrases.length ? "" : " — built-in phrases will be used"}`}
            </small>
          </div>;
        })}
      </fieldset>
      {error && <p className="admin-row-error" role="alert">{error}</p>}
    </div>
    <SxbertyFoodAdmin {...foods} busy={busy || foods.busy} />
    <SxbertyVoiceAdmin {...voices} busy={busy || voices.busy} />
  </AdminSection>;
}
