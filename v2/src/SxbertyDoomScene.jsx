import { useEffect, useRef } from "react";
import { getDoomPresentation } from "./sxberty-doom.js";

const properties = ["--sxberty-doom-filter", "--sxberty-doom-background", "--sxberty-doom-text", "--sxberty-doom-red"];

export default function SxbertyDoomScene({ pet, now }) {
  const scene = getDoomPresentation(pet, now);
  const screenRef = useRef(null);
  useEffect(() => {
    if (!scene.active) return;
    const screen = document.querySelector(".homepage-screen");
    if (!screen) return;
    screenRef.current = screen;
    const previousAttribute = screen.getAttribute("data-sxberty-doom");
    const previousStyles = properties.map(name => [name, screen.style.getPropertyValue(name), screen.style.getPropertyPriority(name)]);
    screen.setAttribute("data-sxberty-doom", "");
    return () => {
      if (previousAttribute === null) screen.removeAttribute("data-sxberty-doom");
      else screen.setAttribute("data-sxberty-doom", previousAttribute);
      for (const [name, value, priority] of previousStyles) {
        if (value) screen.style.setProperty(name, value, priority);
        else screen.style.removeProperty(name);
      }
      screenRef.current = null;
    };
  }, [scene.active]);
  useEffect(() => {
    const screen = screenRef.current;
    if (!scene.active || !screen) return;
    screen.style.setProperty("--sxberty-doom-filter", scene.filter);
    screen.style.setProperty("--sxberty-doom-background", scene.background);
    screen.style.setProperty("--sxberty-doom-text", scene.text);
    screen.style.setProperty("--sxberty-doom-red", String(scene.red * 0.22));
  }, [scene.active, scene.filter, scene.background, scene.text, scene.red]);
  return null;
}
