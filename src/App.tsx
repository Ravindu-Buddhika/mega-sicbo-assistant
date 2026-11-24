import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function App() {
  const [isRunning, setIsRunning] = useState(false);
  const [selectedChip, setSelectedChip] = useState<number>(50);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [username, setUsername] = useState(() => localStorage.getItem("1x_user") || "");
  const [password, setPassword] = useState(() => localStorage.getItem("1x_pass") || "");

  const chips = [50, 250, 500, 2500];

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
        backgroundColor: "rgba(26, 26, 29, 0.96)",
        color: "#ffffff",
        borderRadius: "12px",
        padding: "12px",
        border: "1px solid #39ff14",
        fontFamily: "monospace",
        height: "100vh",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        userSelect: "none",
      }}
    >
      {/* Draggable Header */}
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
          <button
            onClick={() => setShowLoginModal(!showLoginModal)}
            style={{
              background: "#2a2a2e",
              color: "#FF8534",
              border: "1px solid #FF8534",
              borderRadius: "6px",
              padding: "3px 8px",
              fontSize: "11px",
              cursor: "pointer",
            }}
          >
            🔑 Login
          </button>
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

      {/* Saved Login Drawer */}
      {showLoginModal ? (
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
              <span style={{ color: "#aaa" }}>Vertical (4):</span>
              <span>0 / 4</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#aaa" }}>Horiz Chop (6):</span>
              <span>0 / 6</span>
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
          onClick={() => setIsRunning(!isRunning)}
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