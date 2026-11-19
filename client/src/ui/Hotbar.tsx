import { HOTBAR_PROPS } from "@world3d/shared";
import { useWorld } from "../state/store";

export function Hotbar() {
  const hotbarIndex = useWorld((s) => s.hotbarIndex);
  const setHotbar = useWorld((s) => s.setHotbar);
  return (
    <div className="hotbar">
      {HOTBAR_PROPS.map((p, i) => (
        <button
          key={`${p.kind}-${p.variant}`}
          className={`slot ${hotbarIndex === i ? "on" : ""}`}
          onClick={() => setHotbar(i)}
          title={`${p.label}（按 ${i + 1}${p.kind === "hand" ? "，点击地面行走" : "，点地面放置"}）`}
        >
          <span className="slotIcon">{p.icon}</span>
          <span className="slotKey">{i + 1}</span>
        </button>
      ))}
    </div>
  );
}
