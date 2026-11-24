import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface Point {
  x: number;
  y: number;
}

interface CalibrationConfig {
  grid_top_left: Point;
  grid_bottom_right: Point;
  btn_big: Point;
  btn_small: Point;
  chip_50: Point;
  chip_250: Point;
  chip_500: Point;
  chip_2500: Point;
}

interface ScanStatus {
  vertical_streak: number;
  vertical_type: string;
  vert3_sets: number;
  horizontal_chop: number;
  alert_triggered: boolean;
  alert_reason: string;
  last_cell: string;
}

const CALIBRATION_STEPS: { key: keyof CalibrationConfig; label: string }[] = [
  { key: "grid_top_left", label: "1. Roadmap Top-Left Circle (Col 1, Row 1)" },
  { key: "grid_bottom_right", label: "2. Roadmap Bottom-Right Circle (Col 19, Row 6)" },
  { key: "btn_small", label: "3. SMALL (4-10) White Box" },
  { key: "btn_big", label: "4. BIG (11-17) White Box" },
  { key: "chip_50", label: "5. Chip [50]" },
  { key: "chip_250", label: "6. Chip [250]" },
  { key: "chip_500", label: "7. Chip [500]" },
  { key: "chip_2500", label: "8. Chip [2.5K]" },
];

export default function App() {
  const [isRunning, setIsRunning] = useState(false);
  const [selectedChip, setSelectedChip] = useState<number>(50);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [calibratingStep, setCalibratingStep] = useState<number | null>(null);
  const [isRinging, setIsRinging] = useState(false);
  const [alertReason, setAlertReason] = useState("");
  const [status, setStatus] = useState<ScanStatus>({
    vertical_streak: 0,
    vertical_type: "-",
    vert3_sets: 0,
    horizontal_chop: 0,
    alert_triggered: false,
    alert_reason: "",
    last_cell: "-",
  });

  const [config, setConfig] = useState<CalibrationConfig>(() => {
    const saved = localStorage.getItem("sicbo_calibration");
    return saved
      ? JSON.parse(saved)
      : {
          grid_top_left: { x: 0, y: 0 },
          grid_bottom_right: { x: 0, y: 0 },
          btn_big: { x: 0, y: 0 },
          btn_small: { x: 0, y: 0 },
          chip_50: { x: 0, y: 0 },
          chip_250: { x: 0, y: 0 },
          chip_500: { x: 0, y: 0 },
          chip_2500: { x: 0, y: 0 },
        };
  });

  const [username, setUsername] = useState(() => localStorage.getItem("1x_user") || "");
  const [password, setPassword] = useState(() => localStorage.getItem("1x_pass") || "");
  const ringIntervalRef = useRef<number | null>(null);

  const chips = [50, 250, 500, 2500];

  // Sync saved calibration to Rust backend
  useEffect(() => {
    invoke("save_calibration", { config }).catch(console.error);
  }, [config]);

  // Sync selected chip with Rust backend
  useEffect(() => {
    invoke("set_selected_chip", { chip: selectedChip }).catch(console.error);
  }, [selectedChip]);

  // Listen to Rust pattern engine updates
  useEffect(() => {
    const unlistenScan = listen<ScanStatus>("scan-update", (event) => {
      setStatus(event.payload);
      if (event.payload.alert_triggered) {
        setAlertReason(event.payload.alert_reason);
        startRinging();
      }
    });

    const unlistenStop = listen("stop-ringing", () => {
      stopRinging();
    });

    const unlistenBet = listen<string>("bet-placed", (event) => {
      stopRinging();
      setAlertReason(`✅ ${event.payload} BET PLACED!`);
      setTimeout(() => setAlertReason(""), 3000);
    });

    return () => {
      unlistenScan.then((f) => f());
      unlistenStop.then((f) => f());
      unlistenBet.then((f) => f());
    };
  }, []);

  // Capture mouse coordinate when pressing 'C' during Calibration Mode
  useEffect(() => {
    if (calibratingStep === null) return;

    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "c") {
        const pt = await invoke<Point>("get_mouse_position");
        const stepKey = CALIBRATION_STEPS[calibratingStep].key;
        const updated = { ...config, [stepKey]: pt };
        setConfig(updated);
        localStorage.setItem("sicbo_calibration", JSON.stringify(updated));

        if (calibratingStep + 1 < CALIBRATION_STEPS.length) {
          setCalibratingStep(calibratingStep + 1);
        } else {
          setCalibratingStep(null);
        }
      } else if (e.key === "Escape") {
        setCalibratingStep(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [calibratingStep, config]);

  const playRingBurst = () => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch (e) {
      console.error(e);
    }
  };

  const startRinging = () => {
    if (ringIntervalRef.current) return;
    setIsRinging(true);
    playRingBurst();
    ringIntervalRef.current = window.setInterval(playRingBurst, 650);
  };

  const stopRinging = () => {
    if (ringIntervalRef.current) {
      clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = null;
    }
    setIsRinging(false);
    setAlertReason("");
    invoke("dismiss_alert").catch(console.error);
  };

  const handleToggleScan = async () => {
    const nextState = !isRunning;
    await invoke("toggle_scanning", { start: nextState }).catch(console.error);
    setIsRunning(nextState);
    if (!nextState) stopRinging();
  };

  const handleNav = async (action: "back" | "forward" | "reload" | "home") => {
    try {
      await invoke("browser_nav", { action });
    } catch (err) {
      console.error("Nav error:", err);
    }
  };

  const handleSaveAndFillLogin = async () => {
    localStorage.setItem("1x_user", username);
    localStorage.setItem("1x_pass", password);
    try {
      await invoke("auto_fill_login", { username, password });
      setShowLoginModal(false);
    } catch (err) {
      console.error("Login fill failed:", err);
    }
  };

  const navBtnStyle: React.CSSProperties = {
    background: "#222226",
    color: "#ddd",
    border: "1px solid #3a3a40",
    borderRadius: "5px",
    padding: "4px 9px",
    fontSize: "12px",
    cursor: "pointer",
    flex: 1,
  };

  return (
    <div
      style={{
        backgroundColor: isRinging ? "rgba(140, 15, 15, 0.96)" : "rgba(26, 26, 29, 0.96)",
        color: "#ffffff",
        borderRadius: "12px",
        padding: "12px",
        border: isRinging ? "2px solid #ff4d4d" : "1px solid #39ff14",
        fontFamily: "monospace",
        height: "100vh",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        userSelect: "none",
      }}
    >
      {/* Draggable Header & Nav */}
      <div>
        <div
          data-tauri-drag-region
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid #333",
            paddingBottom: "8px",
            marginBottom: "8px",
            cursor: "grab",
          }}
        >
          <span style={{ color: "#39ff14", fontWeight: "bold", fontSize: "13px" }}>
            🎲 SICBO TRACKER
          </span>
          <div style={{ display: "flex", gap: "4px" }}>
            <button
              onClick={() => setCalibratingStep(calibratingStep === null ? 0 : null)}
              style={{
                background: "#2a2a2e",
                color: "#39ff14",
                border: "1px solid #39ff14",
                borderRadius: "6px",
                padding: "3px 7px",
                fontSize: "10px",
                cursor: "pointer",
              }}
            >
              ⚙ Setup
            </button>
            <button
              onClick={() => setShowLoginModal(!showLoginModal)}
              style={{
                background: "#2a2a2e",
                color: "#FF8534",
                border: "1px solid #FF8534",
                borderRadius: "6px",
                padding: "3px 7px",
                fontSize: "10px",
                cursor: "pointer",
              }}
            >
              🔑 Login
            </button>
          </div>
        </div>

        {/* Browser Navigation Controls */}
        <div style={{ display: "flex", gap: "5px" }}>
          <button onClick={() => handleNav("back")} title="Back" style={navBtnStyle}>
            ←
          </button>
          <button onClick={() => handleNav("forward")} title="Forward" style={navBtnStyle}>
            →
          </button>
          <button onClick={() => handleNav("reload")} title="Refresh Page" style={navBtnStyle}>
            ↻
          </button>
          <button
            onClick={() => handleNav("home")}
            title="Go to Mega Sic Bo"
            style={{ ...navBtnStyle, color: "#39ff14", borderColor: "#39ff14" }}
          >
            Game
          </button>
        </div>
      </div>

      {/* Alert Banner when Ringing or Bet Placed */}
      {alertReason && (
        <div
          style={{
            background: isRinging ? "#ff0000" : "#15803d",
            padding: "8px",
            borderRadius: "8px",
            textAlign: "center",
            fontWeight: "bold",
            fontSize: "11px",
          }}
        >
          {isRinging ? `🔔 ${alertReason}` : alertReason}
          {isRinging && (
            <button
              onClick={stopRinging}
              style={{
                display: "block",
                width: "100%",
                marginTop: "6px",
                padding: "5px",
                background: "#fff",
                color: "#000",
                border: "none",
                borderRadius: "5px",
                fontWeight: "bold",
                cursor: "pointer",
              }}
            >
              🔇 STOP RINGING (Space)
            </button>
          )}
        </div>
      )}

      {/* Calibration Wizard / Login Drawer / Main Status */}
      {calibratingStep !== null ? (
        <div style={{ background: "#111", padding: "10px", borderRadius: "8px", fontSize: "11px" }}>
          <div style={{ color: "#FF8534", fontWeight: "bold", marginBottom: "6px" }}>
            CALIBRATION ({calibratingStep + 1}/{CALIBRATION_STEPS.length})
          </div>
          <div style={{ marginBottom: "8px", lineHeight: "1.4" }}>
            Point mouse at:<br />
            <strong style={{ color: "#39ff14" }}>{CALIBRATION_STEPS[calibratingStep].label}</strong>
          </div>
          <div style={{ color: "#aaa" }}>
            Keep this box focused & press <strong style={{ color: "#fff" }}>[C]</strong> to capture. (ESC to cancel)
          </div>
        </div>
      ) : showLoginModal ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", margin: "8px 0" }}>
          <input
            type="text"
            placeholder="1xBet ID / Email"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{ padding: "6px", borderRadius: "4px", border: "none", background: "#111", color: "#fff" }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ padding: "6px", borderRadius: "4px", border: "none", background: "#111", color: "#fff" }}
          />
          <button
            onClick={handleSaveAndFillLogin}
            style={{
              background: "#39ff14",
              color: "#000",
              fontWeight: "bold",
              padding: "6px",
              borderRadius: "6px",
              border: "none",
              cursor: "pointer",
            }}
          >
            Save & Auto-Fill
          </button>
        </div>
      ) : (
        <>
          {/* Live Streak Status */}
          <div style={{ background: "#111113", padding: "10px", borderRadius: "8px", fontSize: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
              <span style={{ color: "#aaa" }}>Status:</span>
              <span style={{ color: isRunning ? "#39ff14" : "#ff4d4d", fontWeight: "bold" }}>
                {isRunning ? "● SCANNING" : "■ IDLE"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
              <span style={{ color: "#aaa" }}>Last Drop:</span>
              <strong style={{ color: "#FF8534" }}>{status.last_cell}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
              <span style={{ color: "#aaa" }}>Vertical (4):</span>
              <span>
                {status.vertical_streak} / 4 ({status.vertical_type})
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
              <span style={{ color: "#aaa" }}>Vert-3 Sets (3):</span>
              <span style={{ color: status.vert3_sets > 0 ? "#39ff14" : "#fff", fontWeight: "bold" }}>
                {status.vert3_sets} / 3
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#aaa" }}>Horiz Chop (6):</span>
              <span>{status.horizontal_chop} / 6</span>
            </div>
          </div>

          {/* Chip Amount Selector */}
          <div>
            <div style={{ fontSize: "11px", color: "#aaa", marginBottom: "6px" }}>
              Bet Chip (LKR):
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
              {chips.map((chip) => (
                <button
                  key={chip}
                  onClick={() => setSelectedChip(chip)}
                  style={{
                    padding: "6px 0",
                    borderRadius: "6px",
                    border: selectedChip === chip ? "1px solid #39ff14" : "1px solid #444",
                    background: selectedChip === chip ? "#39ff14" : "#222",
                    color: selectedChip === chip ? "#000" : "#fff",
                    fontWeight: "bold",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                >
                  {chip >= 1000 ? `${chip / 1000}K` : chip}
                </button>
              ))}
            </div>
          </div>

          {/* Hotkey Guide */}
          <div style={{ fontSize: "11px", color: "#888", textAlign: "center" }}>
            Hotkeys: <strong style={{ color: "#FF8534" }}>[+] BIG</strong> |{" "}
            <strong style={{ color: "#fff" }}>[-] SMALL</strong>
          </div>
        </>
      )}

      {/* Start / Stop Main Controls */}
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={handleToggleScan}
          style={{
            flex: 1,
            padding: "10px",
            borderRadius: "8px",
            border: "none",
            background: isRunning ? "#ff4d4d" : "#39ff14",
            color: isRunning ? "#fff" : "#000",
            fontWeight: "bold",
            fontSize: "13px",
            cursor: "pointer",
          }}
        >
          {isRunning ? "⏹ STOP" : "▶ START"}
        </button>
      </div>
    </div>
  );
}