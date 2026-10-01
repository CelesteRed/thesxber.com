import { forwardRef } from "react";
import base from "./assets/verity/base.png";
import normal from "./assets/verity/faces/normal.png";
import neutral from "./assets/verity/faces/neutral.png";
import displeased from "./assets/verity/faces/displeased.png";
import angry from "./assets/verity/faces/displeased-eyes.png";
import abandoned from "./assets/verity/faces/displeased-eyes-open.png";
import { getFaceBlend } from "./sxberty-appearance.js";

const faces = { normal, neutral, displeased, angry, abandoned };

// All layers share a registered 1000×1000 canvas. Rotate/scale the wrapper,
// never the face separately, so the hair and facial features stay aligned.
export default forwardRef(function SxbertySprite({ happiness, face = null, size = 76, className = "" }, ref) {
  const { to } = getFaceBlend(happiness, face);
  return <span ref={ref} className={`sxberty-sprite ${className}`} style={{ width: size, height: size }} aria-hidden="true" data-face={to}>
    <img className="sxberty-base" src={base} width="1000" height="1000" alt="" draggable="false" />
    <span className="sxberty-face-layers">
      <img src={faces[to]} width="1000" height="1000" alt="" draggable="false" />
    </span>
  </span>;
});
