import SxbertySprite from "./SxbertySprite";
import { getEscalationPose } from "./sxberty-escalation.js";

export default function SxbertyEscalation({ pet, now, origin, reduced }) {
  const pose = getEscalationPose(pet.stageStartedAt, now);
  const target = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const from = origin || { x: target.x, y: window.innerHeight - 60 };
  const mix = reduced ? 1 : pose.centerMix;
  return <div className="sxberty-escalation" aria-hidden="true" data-step={pose.step}>
    <div className="sxberty-escalation-position" style={{ left: from.x + (target.x - from.x) * mix, top: from.y + (target.y - from.y) * mix }}>
      <div className="sxberty-escalation-size" style={{ transform: `scale(${reduced ? 1 : pose.scale})` }}>
        <SxbertySprite happiness={0} size={84} />
      </div>
    </div>
  </div>;
}
