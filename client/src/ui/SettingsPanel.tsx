// 设置面板：操作方式（WASD / 鼠标点击 二选一）/ 鼠标灵敏度 / 速度 / 视角
import { useState } from "react";
import { useWorld } from "../state/store";

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const settings = useWorld((s) => s.settings);
  const setSettings = useWorld((s) => s.setSettings);
  const viewMode = useWorld((s) => s.viewMode);
  const toggleView = useWorld((s) => s.toggleView);
  const tier = useWorld((s) => s.tier);
  const setTier = useWorld((s) => s.setTier);
  const [open, setOpen] = useState(true);

  return (
    <>
      <div className="setMask" onClick={onClose} />
      <aside className={`setPanel ${open ? "" : "closed"}`}>
        <header className="setHead">
          <b>⚙ 设置</b>
          <button className="setIconBtn" onClick={onClose} title="关闭">
            ✕
          </button>
        </header>

        <div className="setBody">
          <div className="setGroup">
            <div className="setGroupTitle">鼠标视角</div>
            <label className="setSwitch">
              <input
                type="checkbox"
                checked={settings.freeLook}
                onChange={(e) => setSettings({ freeLook: e.target.checked })}
              />
              <span className="setSwitchBox" />
              自由转向（鼠标左右滑动即转视角，无需按住）
            </label>
            <label className="setSwitch">
              <input
                type="checkbox"
                checked={settings.edgeLock}
                onChange={(e) => setSettings({ edgeLock: e.target.checked })}
              />
              <span className="setSwitchBox" />
              边缘持续转向（鼠标滑到屏幕左右边缘时自动转）
            </label>
            <div className="setRow">
              <label>左右转灵敏度</label>
              <input
                type="range"
                min={0.2}
                max={3}
                step={0.05}
                value={settings.mouseSensitivity}
                onChange={(e) => setSettings({ mouseSensitivity: Number(e.target.value) })}
              />
              <b className="setVal">{settings.mouseSensitivity.toFixed(2)}×</b>
            </div>
            <div className="setHint">
              鼠标在画面上左右滑动即可转动视角；滑到屏幕边缘会持续转向（可关掉）。
              <div className="setPreview">
                <button
                  className="setMiniBtn"
                  onClick={() => setSettings({ mouseSensitivity: Math.max(0.2, Number((settings.mouseSensitivity - 0.1).toFixed(2))) })}
                >
                  慢一点
                </button>
                <button
                  className="setMiniBtn"
                  onClick={() => setSettings({ mouseSensitivity: Math.min(3, Number((settings.mouseSensitivity + 0.1).toFixed(2))) })}
                >
                  快一点
                </button>
              </div>
            </div>
          </div>

          <div className="setGroup">
            <div className="setGroupTitle">操作方式</div>
            <div className="setRow">
              <label>移动控制</label>
              <div className="setSeg">
                <button
                  className={`setSegBtn ${settings.controlMode === "keyboard" ? "on" : ""}`}
                  onClick={() => setSettings({ controlMode: "keyboard" })}
                >
                  ⌨️ WASD
                </button>
                <button
                  className={`setSegBtn ${settings.controlMode === "mouse" ? "on" : ""}`}
                  onClick={() => setSettings({ controlMode: "mouse" })}
                >
                  🖱️ 点击
                </button>
              </div>
            </div>
            <div className="setHint">
              {settings.controlMode === "keyboard"
                ? "键盘模式：WASD / 方向键移动，点击地面不会移动（仍可点地放置道具、右键拆除）。"
                : "鼠标模式：点击地面行走、点人物走近对话，键盘 WASD 不生效。"}
            </div>
            {settings.controlMode === "keyboard" && (
              <>
                <div className="setRow">
                  <label>移动速度</label>
                  <input
                    type="range"
                    min={0.5}
                    max={2.5}
                    step={0.05}
                    value={settings.keyboardSpeed}
                    onChange={(e) => setSettings({ keyboardSpeed: Number(e.target.value) })}
                  />
                  <b className="setVal">{settings.keyboardSpeed.toFixed(2)}×</b>
                </div>
                <div className="setKeys">
                  <span><kbd>W</kbd> 前进</span>
                  <span><kbd>A</kbd> 左移</span>
                  <span><kbd>S</kbd> 后退</span>
                  <span><kbd>D</kbd> 右移</span>
                  <span><kbd>↑↓←→</kbd> 同上</span>
                </div>
              </>
            )}
          </div>

          <div className="setGroup">
            <div className="setGroupTitle">画面</div>
            <div className="setRow">
              <label>视角</label>
              <button className="setMiniBtn" onClick={toggleView}>
                {viewMode === "third" ? "🎥 第三人称" : "👁 第一人称"}
              </button>
            </div>
            <div className="setRow">
              <label>画质</label>
              <div className="setSeg">
                {(["low", "mid", "high"] as const).map((t) => (
                  <button key={t} className={`setSegBtn ${tier === t ? "on" : ""}`} onClick={() => setTier(t)}>
                    {t === "low" ? "流畅" : t === "mid" ? "均衡" : "高清"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="setGroup">
            <div className="setGroupTitle">快捷键</div>
            <div className="setKeys">
              <span><kbd>E</kbd> 进门 / 聊天 / 派单</span>
              <span><kbd>V</kbd> 切换视角</span>
              <span><kbd>1-7</kbd> 选道具</span>
              <span><kbd>右键</kbd> 拆除造物</span>
              <span><kbd>滚轮</kbd> 缩放</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
