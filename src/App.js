import { useState, useRef, useEffect } from "react";

async function storageGet(key) {
  try { const r = await window.storage.get(key); return r ? JSON.parse(r.value) : null; }
  catch { return null; }
}
async function storageSet(key, val) {
  try { await window.storage.set(key, JSON.stringify(val)); } catch {}
}

const TABS = ["Chat", "Plan", "Log", "History"];

const SYSTEM_PROMPT = `You are an expert hypertrophy coach. Your entire focus is muscle building through evidence-based programming (progressive overload, volume landmarks, RIR-based intensity).

ONBOARDING FLOW — ask naturally, one or two questions at a time:
1. Name and quick background (how long they have been training)
2. Current stats: height, weight, age
3. Available equipment (full gym, home gym, dumbbells only, etc.)
4. How many days/week and how long per session
5. Any injuries or weak points to work around
6. Current best lifts if they know them (optional)

Once you have enough info, generate a complete weekly hypertrophy plan. Format it EXACTLY like this:

WEEKLY PLAN:
Day 1 - [Muscle Focus]:
- [Exercise] | [Sets]x[Reps] | Rest: [time]

Day 2 - REST

END PLAN

After the plan, give 3-4 key coaching notes.`;


function parsePlan(text) {
  const start = text.indexOf("WEEKLY PLAN:");
  const end = text.indexOf("END PLAN");
  if (start === -1 || end === -1) return null;
  const block = text.slice(start + 12, end).trim();
  const days = [];
  const dayBlocks = block.split(/\n(?=Day \d)/);
  for (const db of dayBlocks) {
    const lines = db.trim().split("\n");
    const header = lines[0];
    const dayMatch = header.match(/Day (\d+)\s*[-]\s*(.+)/);
    if (!dayMatch) continue;
    const dayNum = parseInt(dayMatch[1]);
    const focus = dayMatch[2].trim();
    if (focus.toUpperCase() === "REST") {
      days.push({ day: dayNum, focus: "REST", exercises: [] });
      continue;
    }
    const exercises = lines.slice(1)
      .filter(l => l.trim().startsWith("-"))
      .map(l => {
        const content = l.replace(/^-\s*/, "").trim();
        const parts = content.split("|").map(p => p.trim());
        return { name: parts[0] || content, setsReps: parts[1] || "", rest: parts[2] || "" };
      });
    days.push({ day: dayNum, focus, exercises });
  }
  return days.length ? days : null;
}

function Avatar() {
  return (
    <div style={{
      width: 30, height: 30, minWidth: 30,
      background: "linear-gradient(135deg, #c8ff00, #8aaf00)",
      borderRadius: 8, display: "flex", alignItems: "center",
      justifyContent: "center", fontSize: 14, marginTop: 2
    }}>💪</div>
  );
}

function Bubble({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", alignItems: "flex-start", gap: 10 }}>
      {!isUser && <Avatar />}
      <div style={{
        maxWidth: "80%",
        background: isUser ? "#c8ff00" : "#161616",
        color: isUser ? "#0c0c0c" : "#f0f0f0",
        padding: "11px 15px",
        borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
        fontSize: 14, lineHeight: 1.65, whiteSpace: "pre-wrap",
        wordBreak: "break-word", fontWeight: isUser ? 500 : 400,
        border: isUser ? "none" : "1px solid #272727"
      }}>
        {msg.content}
      </div>
    </div>
  );
}

export default function HypertrophyTrainer() {
  const [tab, setTab] = useState("Chat");
  const [messages, setMessages] = useState([{
    role: "assistant",
    content: "Hey! I am your hypertrophy coach. Let us build you a program designed specifically for muscle growth.\n\nFirst, how long have you been training seriously, and what does your current setup look like?"
  }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logDay, setLogDay] = useState(null);
  const [logEntries, setLogEntries] = useState({});
  const [toast, setToast] = useState("");
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    (async () => {
      const savedPlan = await storageGet("hyp-plan");
      const savedLogs = await storageGet("hyp-logs");
      const savedMsgs = await storageGet("hyp-messages");
      if (savedPlan) setPlan(savedPlan);
      if (savedLogs) setLogs(savedLogs);
      if (savedMsgs && savedMsgs.length > 1) setMessages(savedMsgs);
    })();
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }

  async function send() {
    if (!input.trim() || loading) return;
    const userMsg = { role: "user", content: input.trim() };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);
    setInput("");
    if (textareaRef.current) { textareaRef.current.style.height = "auto"; }
    setLoading(true);

    try {
     const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.REACT_APP_ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-allow-browser": "true"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: newMsgs.map(m => ({ role: m.role, content: m.content }))
        })
      });
      const data = await res.json();
      const reply = data.content?.[0]?.text || "Something went wrong.";
      const finalMsgs = [...newMsgs, { role: "assistant", content: reply }];
      setMessages(finalMsgs);
      await storageSet("hyp-messages", finalMsgs);
      const parsed = parsePlan(reply);
      if (parsed) {
        setPlan(parsed);
        await storageSet("hyp-plan", parsed);
        showToast("Plan saved! Check the Plan tab.");
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: "Connection error: " + err.message }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  function startLog(day) {
    setLogDay(day);
    const init = {};
    day.exercises.forEach((ex, i) => { init[i] = [{ weight: "", reps: "" }]; });
    setLogEntries(init);
    setTab("Log");
  }

  async function saveLog() {
    const entry = {
      date: new Date().toISOString(),
      focus: logDay.focus,
      day: logDay.day,
      exercises: logDay.exercises.map((ex, i) => ({
        name: ex.name,
        sets: (logEntries[i] || []).filter(s => s.weight || s.reps)
      }))
    };
    const newLogs = [entry, ...logs];
    setLogs(newLogs);
    await storageSet("hyp-logs", newLogs);
    setLogDay(null);
    setLogEntries({});
    showToast("Workout logged!");
    setTab("History");
  }

  function addSet(exIdx) {
    setLogEntries(prev => ({
      ...prev,
      [exIdx]: [...(prev[exIdx] || []), { weight: "", reps: "" }]
    }));
  }

  function updateSet(exIdx, setIdx, field, val) {
    setLogEntries(prev => {
      const sets = [...(prev[exIdx] || [])];
      sets[setIdx] = { ...sets[setIdx], [field]: val };
      return { ...prev, [exIdx]: sets };
    });
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0c0c0c", display: "flex", flexDirection: "column", fontFamily: "'Inter', system-ui, sans-serif", color: "#f0f0f0" }}>
      {toast && (
        <div style={{
          position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
          background: "#c8ff00", color: "#0c0c0c", padding: "10px 20px", borderRadius: 10,
          fontSize: 13, fontWeight: 600, zIndex: 100
        }}>{toast}</div>
      )}

      <div style={{ padding: "16px 20px", borderBottom: "1px solid #272727", display: "flex", alignItems: "center", gap: 12, background: "#0c0c0c", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ width: 38, height: 38, background: "linear-gradient(135deg, #c8ff00, #8aaf00)", borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>💪</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Hypertrophy Coach</div>
          <div style={{ color: "#888", fontSize: 12 }}>AI-powered muscle building</div>
        </div>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid #272727", background: "#0c0c0c", position: "sticky", top: 70, zIndex: 9 }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: "12px 0", background: "transparent", border: "none",
            borderBottom: tab === t ? "2px solid #c8ff00" : "2px solid transparent",
            color: tab === t ? "#c8ff00" : "#888",
            fontSize: 13, fontWeight: tab === t ? 600 : 400, cursor: "pointer", fontFamily: "inherit"
          }}>{t}</button>
        ))}
      </div>

      {tab === "Chat" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 16px", display: "flex", flexDirection: "column", gap: 14, maxWidth: 700, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
            {messages.map((m, i) => <Bubble key={i} msg={m} />)}
            {loading && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <Avatar />
                <div style={{ background: "#161616", border: "1px solid #272727", padding: "12px 16px", borderRadius: "16px 16px 16px 4px", display: "flex", gap: 5 }}>
                  {[0,1,2].map(i => (
                    <div key={i} style={{ width: 6, height: 6, background: "#c8ff00", borderRadius: "50%", animation: "blink 1.2s ease-in-out infinite", animationDelay: i * 0.2 + "s", opacity: 0.5 }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          <div style={{ padding: "14px 16px", borderTop: "1px solid #272727", background: "#0c0c0c" }}>
            <div style={{ maxWidth: 700, margin: "0 auto", display: "flex", gap: 10, alignItems: "flex-end" }}>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                onInput={e => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"; }}
                placeholder="Message your coach..."
                rows={1}
                style={{ flex: 1, background: "#161616", border: "1px solid #272727", borderRadius: 12, color: "#f0f0f0", padding: "11px 14px", fontSize: 14, resize: "none", outline: "none", fontFamily: "inherit", lineHeight: 1.5, maxHeight: 120 }}
              />
              <button onClick={send} disabled={!input.trim() || loading} style={{
                width: 42, height: 42, minWidth: 42,
                background: input.trim() && !loading ? "#c8ff00" : "#1f1f1f",
                border: "none", borderRadius: 11, cursor: "pointer",
                fontSize: 17, color: input.trim() && !loading ? "#0c0c0c" : "#444"
              }}>↑</button>
            </div>
          </div>
        </div>
      )}

      {tab === "Plan" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 16px", maxWidth: 700, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
          {!plan ? (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "#888" }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>📋</div>
              <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8, color: "#f0f0f0" }}>No plan yet</div>
              <div style={{ fontSize: 14 }}>Chat with your coach to generate your program.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>Your Weekly Program</div>
              {plan.map((day, i) => (
                <div key={i} style={{ background: "#161616", border: "1px solid #272727", borderRadius: 14, overflow: "hidden" }}>
                  <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: day.focus !== "REST" ? "1px solid #272727" : "none" }}>
                    <div>
                      <span style={{ color: "#c8ff00", fontWeight: 700, fontSize: 12, marginRight: 8 }}>DAY {day.day}</span>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{day.focus}</span>
                    </div>
                    {day.focus !== "REST" && (
                      <button onClick={() => startLog(day)} style={{ background: "#c8ff00", color: "#0c0c0c", border: "none", borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Log workout</button>
                    )}
                  </div>
                  {day.exercises.length > 0 && (
                    <div style={{ padding: "10px 16px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                      {day.exercises.map((ex, j) => (
                        <div key={j} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                          <div style={{ width: 6, height: 6, minWidth: 6, borderRadius: "50%", background: "#c8ff00", marginTop: 7 }} />
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 500 }}>{ex.name}</div>
                            <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{ex.setsReps}{ex.rest ? " · " + ex.rest : ""}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "Log" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 16px", maxWidth: 700, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
          {!logDay ? (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "#888" }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>🏋️</div>
              <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8, color: "#f0f0f0" }}>Ready to train?</div>
              <div style={{ fontSize: 14, marginBottom: 20 }}>Go to the Plan tab and tap Log workout.</div>
              <button onClick={() => setTab("Plan")} style={{ background: "#c8ff00", color: "#0c0c0c", border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>View plan</button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <div style={{ color: "#c8ff00", fontSize: 12, fontWeight: 700 }}>DAY {logDay.day}</div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>{logDay.focus}</div>
              </div>
              {logDay.exercises.map((ex, i) => (
                <div key={i} style={{ background: "#161616", border: "1px solid #272727", borderRadius: 14, padding: "14px 16px" }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{ex.name}</div>
                  <div style={{ color: "#888", fontSize: 12, marginBottom: 12 }}>{ex.setsReps}</div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    <div style={{ flex: 1, fontSize: 11, color: "#888", fontWeight: 600 }}>WEIGHT</div>
                    <div style={{ flex: 1, fontSize: 11, color: "#888", fontWeight: 600 }}>REPS</div>
                  </div>
                  {(logEntries[i] || []).map((s, j) => (
                    <div key={j} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                      <input value={s.weight} onChange={e => updateSet(i, j, "weight", e.target.value)} placeholder="0" type="number" style={{ flex: 1, background: "#1f1f1f", border: "1px solid #272727", borderRadius: 8, color: "#f0f0f0", padding: "8px 10px", fontSize: 14, outline: "none", fontFamily: "inherit" }} />
                      <input value={s.reps} onChange={e => updateSet(i, j, "reps", e.target.value)} placeholder="0" type="number" style={{ flex: 1, background: "#1f1f1f", border: "1px solid #272727", borderRadius: 8, color: "#f0f0f0", padding: "8px 10px", fontSize: 14, outline: "none", fontFamily: "inherit" }} />
                    </div>
                  ))}
                  <button onClick={() => addSet(i)} style={{ background: "transparent", border: "1px dashed #272727", borderRadius: 8, color: "#888", padding: "6px 12px", fontSize: 12, cursor: "pointer", width: "100%", fontFamily: "inherit", marginTop: 4 }}>+ Add set</button>
                </div>
              ))}
              <button onClick={saveLog} style={{ background: "#c8ff00", color: "#0c0c0c", border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Save workout</button>
            </div>
          )}
        </div>
      )}

      {tab === "History" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 16px", maxWidth: 700, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
          {logs.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "#888" }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>📈</div>
              <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8, color: "#f0f0f0" }}>No workouts logged yet</div>
              <div style={{ fontSize: 14 }}>Your history will appear here after your first session.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>Workout History</div>
              {logs.map((log, i) => (
                <div key={i} style={{ background: "#161616", border: "1px solid #272727", borderRadius: 14, overflow: "hidden" }}>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #272727", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <span style={{ color: "#c8ff00", fontWeight: 700, fontSize: 12, marginRight: 8 }}>DAY {log.day}</span>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{log.focus}</span>
                    </div>
                    <div style={{ color: "#888", fontSize: 12 }}>{new Date(log.date).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}</div>
                  </div>
                  <div style={{ padding: "10px 16px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                    {log.exercises.map((ex, j) => ex.sets.length > 0 && (
                      <div key={j}>
                        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{ex.name}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {ex.sets.map((s, k) => (
                            <div key={k} style={{ background: "#1f1f1f", border: "1px solid #272727", borderRadius: 6, padding: "3px 8px", fontSize: 12, color: "#888" }}>
                              {s.weight ? s.weight + " x " : ""}{s.reps} reps
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes blink { 0%, 100% { opacity: 0.2; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1); } }
        textarea::placeholder { color: #444; }
        input::placeholder { color: #444; }
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
      `}</style>
    </div>
  );
}
