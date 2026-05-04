import { useState, useRef, useEffect } from "react";

// ── Supabase 설정 ─────────────────────────────────────────────
const SUPABASE_URL = "https://knxswxwuapivbbkruqxc.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtueHN3eHd1YXBpdmJia3J1cXhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4ODU4NDcsImV4cCI6MjA5MzQ2MTg0N30.gjpEXOOGZBuZn41g-5F6uPExnX-FgC4eET71fq4Jo60";

const sb = {
  from: (table) => ({
    select: async (cols = "*") => {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=${cols}`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
      });
      return r.json();
    },
    insert: async (data) => {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify(data)
      });
      return r.json();
    },
    delete: async (id) => {
      await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
        method: "DELETE",
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
      });
    },
    selectWhere: async (col, val, order = "") => {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&${col}=eq.${val}${order}`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
      });
      return r.json();
    }
  })
};

function genId() { return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36); }
function today() { return new Date().toISOString().slice(0, 10); }
function fmt(n) { return Number(n).toLocaleString("ko-KR"); }
function fmtDate(d) { if (!d) return ""; const [y, m, day] = d.split("-"); return `${y}.${m}.${day}`; }
function fmtDateShort(d) { if (!d) return ""; const [, m, day] = d.split("-"); return `${m}/${day}`; }

export default function App() {
  const [customers, setCustomers] = useState([]);
  const [historyMap, setHistoryMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("list");
  const [selectedId, setSelectedId] = useState(null);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ amount: "", note: "", date: today() });
  const [newName, setNewName] = useState("");
  const [newCharge, setNewCharge] = useState("");
  const [newChargeDate, setNewChargeDate] = useState(today());
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState(null);
  const [chatMessages, setChatMessages] = useState([
    { role: "assistant", content: "안녕하세요! 선결제 장부 AI 도우미예요 🤖\n\n말씀해 주시면 바로 처리해드려요!\n\n예시:\n• \"정혜원님 5만원 충전\"\n• \"정혜원님 오늘 63000원 차감\"\n• \"새 고객 김철수 10만원 등록\"\n• \"전체 잔액 합계 알려줘\"" }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const chatEndRef = useRef(null);

  // ── 데이터 로드 ──────────────────────────────────────────────
  const loadAll = async () => {
    setLoading(true);
    try {
      const custs = await sb.from("customers").select("*");
      const hist = await sb.from("history").select("*");
      const map = {};
      (custs || []).forEach(c => { map[c.id] = []; });
      (hist || []).forEach(h => {
        if (!map[h.customer_id]) map[h.customer_id] = [];
        map[h.customer_id].push(h);
      });
      Object.keys(map).forEach(k => map[k].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));
      setCustomers(custs || []);
      setHistoryMap(map);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);
  useEffect(() => { if (view === "chat") chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages, view]);

  const showToast = (msg, color = "#2d6a3f") => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 2600);
  };

  const getBalance = (customerId) => {
    const hist = historyMap[customerId] || [];
    return hist.length ? hist[hist.length - 1].balance : 0;
  };

  const selected = customers.find(c => c.id === selectedId);

  // ── 트랜잭션 ──────────────────────────────────────────────
  const applyTx = async (customerId, type, amount, note, date) => {
    const prevBal = getBalance(customerId);
    const newBal = type === "charge" ? prevBal + amount : prevBal - amount;
    const entry = { id: genId(), customer_id: customerId, date: date || today(), type, amount, note: note || (type === "charge" ? "충전" : "차감"), balance: newBal };
    await sb.from("history").insert(entry);
    setHistoryMap(prev => {
      const updated = [...(prev[customerId] || []), entry];
      return { ...prev, [customerId]: updated };
    });
    const c = customers.find(x => x.id === customerId);
    return `${c?.name}님 ${type === "charge" ? "+" : "-"}${fmt(amount)}원 → 잔액 ${fmt(newBal)}원`;
  };

  const addCustomerFn = async (name, chargeAmt, chargeDate) => {
    const newC = { id: genId(), name, created_at: new Date().toISOString() };
    await sb.from("customers").insert(newC);
    setCustomers(prev => [...prev, newC]);
    setHistoryMap(prev => ({ ...prev, [newC.id]: [] }));
    if (chargeAmt > 0) {
      await applyTx(newC.id, "charge", chargeAmt, "선결제", chargeDate);
    }
    return `${name}님 등록 완료${chargeAmt > 0 ? ` (${fmt(chargeAmt)}원 충전)` : ""}`;
  };

  const applyModal = async () => {
    const amt = parseInt(form.amount);
    if (!amt || amt <= 0) return;
    await applyTx(selectedId, modal.type, amt, form.note, form.date);
    showToast(modal.type === "charge" ? `${fmt(amt)}원 충전 완료 (${fmtDate(form.date)})` : `${fmt(amt)}원 차감 완료 (${fmtDate(form.date)})`, modal.type === "charge" ? "#1a5f8a" : "#8a3a2a");
    setForm({ amount: "", note: "", date: today() });
    setModal(null);
  };

  // ── AI 채팅 ──────────────────────────────────────────────
  const sendChat = async () => {
    if (!chatInput.trim() || aiLoading) return;
    const userMsg = chatInput.trim();
    setChatInput("");
    setChatMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setAiLoading(true);
    const customerSummary = customers.map(c => ({ id: c.id, name: c.name, balance: getBalance(c.id) }));
    const systemPrompt = `당신은 한식당 선결제 장부 AI입니다. 요청을 분석해 아래 JSON만 반환하세요.\n\n현재 고객:\n${JSON.stringify(customerSummary)}\n\n오늘: ${today()}\n\nJSON:\n{"action":"none"|"charge"|"deduct"|"add_customer"|"query","customerId":ID또는null,"customerName":"이름","amount":금액또는null,"date":"YYYY-MM-DD","note":"메모","newCustomerCharge":0,"message":"한국어응답"}\n\n규칙: 부분이름매칭, 5만원→50000, 어제→어제날짜`;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, system: systemPrompt, messages: [{ role: "user", content: userMsg }] })
      });
      const data = await res.json();
      const raw = data.content?.map(b => b.text || "").join("").trim();
      const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
      let finalMsg = parsed.message;
      let toastMsg = null, toastColor = "#2d6a3f";
      if (parsed.action === "charge" && parsed.customerId && parsed.amount) {
        const result = await applyTx(parsed.customerId, "charge", parsed.amount, parsed.note, parsed.date);
        toastMsg = result; toastColor = "#1a5f8a";
        finalMsg += `\n\n📅 ${fmtDate(parsed.date)}`;
      } else if (parsed.action === "deduct" && parsed.customerId && parsed.amount) {
        const bal = getBalance(parsed.customerId);
        if (bal < parsed.amount) { finalMsg = `❗ 잔액(${fmt(bal)}원)이 부족해요.`; }
        else {
          const result = await applyTx(parsed.customerId, "use", parsed.amount, parsed.note, parsed.date);
          toastMsg = result; toastColor = "#8a3a2a";
          finalMsg += `\n\n📅 ${fmtDate(parsed.date)}`;
        }
      } else if (parsed.action === "add_customer" && parsed.customerName) {
        const result = await addCustomerFn(parsed.customerName, parsed.newCustomerCharge || 0, parsed.date);
        toastMsg = result;
      }
      if (toastMsg) showToast(toastMsg, toastColor);
      setChatMessages(prev => [...prev, { role: "assistant", content: finalMsg }]);
    } catch { setChatMessages(prev => [...prev, { role: "assistant", content: "오류가 생겼어요. 다시 시도해 주세요." }]); }
    finally { setAiLoading(false); }
  };

  const filtered = customers.filter(c => c.name.includes(search));

  const TabBar = () => (
    <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: "#fff", borderTop: "1px solid #e8e0d8", display: "flex", zIndex: 100, boxShadow: "0 -4px 20px rgba(0,0,0,0.08)" }}>
      {[{ id: "list", icon: "📋", label: "장부" }, { id: "chat", icon: "🤖", label: "AI 도우미" }].map(tab => (
        <button key={tab.id} onClick={() => { if (tab.id === "list") { setView("list"); setSelectedId(null); } else setView(tab.id); }}
          style={{ flex: 1, padding: "12px 0 8px", border: "none", background: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, cursor: "pointer" }}>
          <span style={{ fontSize: 22 }}>{tab.icon}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: (view === tab.id || (tab.id === "list" && ["list", "detail", "add"].includes(view))) ? "#8a5a10" : "#b0a090" }}>{tab.label}</span>
          {(view === tab.id || (tab.id === "list" && ["list", "detail", "add"].includes(view))) && <div style={{ width: 20, height: 3, background: "#c8a060", borderRadius: 2 }} />}
        </button>
      ))}
    </div>
  );

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#1e1208", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
      <div style={{ fontSize: 48 }}>📋</div>
      <div style={{ color: "#c8a060", fontSize: 16, fontWeight: 700 }}>장부 불러오는 중...</div>
      <div style={{ display: "flex", gap: 6 }}>
        {[0, 0.2, 0.4].map(d => <div key={d} style={{ width: 8, height: 8, borderRadius: "50%", background: "#c8a060", animation: `pulse 1.2s ${d}s infinite` }} />)}
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#faf8f5", fontFamily: "'Noto Sans KR','Apple SD Gothic Neo',sans-serif", color: "#1e1810", maxWidth: 480, margin: "0 auto", position: "relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input, textarea { outline: none; font-family: inherit; }
        button { cursor: pointer; font-family: inherit; }
        .row:active { background: #f0ece6 !important; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>

      {toast && (
        <div style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", background: toast.color, color: "#fff", padding: "11px 22px", borderRadius: 30, fontWeight: 700, fontSize: 13, zIndex: 9999, boxShadow: "0 4px 20px rgba(0,0,0,0.22)", whiteSpace: "nowrap", animation: "fadeUp 0.3s ease" }}>{toast.msg}</div>
      )}

      {/* ══ LIST ══ */}
      {view === "list" && (
        <>
          <div style={{ background: "linear-gradient(160deg,#1e1208,#3a2010)", padding: "28px 20px 20px" }}>
            <div style={{ color: "#c8a060", fontSize: 11, letterSpacing: 4, marginBottom: 4 }}>선결제 관리</div>
            <div style={{ color: "#fff", fontSize: 26, fontWeight: 900, marginBottom: 14 }}>고객 장부</div>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="고객 이름 검색..." style={{ width: "100%", padding: "11px 16px", borderRadius: 12, border: "none", background: "rgba(255,255,255,0.12)", color: "#fff", fontSize: 14 }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", background: "#2a1a0a", padding: "12px 0" }}>
            {[
              { label: "전체 고객", value: `${customers.length}명` },
              { label: "잔액 있음", value: `${customers.filter(c => getBalance(c.id) > 0).length}명` },
              { label: "총 잔액", value: `${fmt(customers.reduce((s, c) => s + getBalance(c.id), 0))}원` },
            ].map(item => (
              <div key={item.label} style={{ textAlign: "center" }}>
                <div style={{ color: "#c8a060", fontSize: 10 }}>{item.label}</div>
                <div style={{ color: "#fff", fontSize: 13, fontWeight: 700, marginTop: 2 }}>{item.value}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: "16px 16px 120px" }}>
            {filtered.length === 0 && <div style={{ textAlign: "center", color: "#b0a090", marginTop: 60, fontSize: 14 }}><div style={{ fontSize: 40, marginBottom: 10 }}>📖</div>등록된 고객이 없어요</div>}
            {filtered.map(c => {
              const bal = getBalance(c.id);
              const hist = historyMap[c.id] || [];
              const lastUse = [...hist].reverse().find(h => h.type === "use");
              const lastCharge = [...hist].reverse().find(h => h.type === "charge");
              return (
                <div key={c.id} className="row" onClick={() => { setSelectedId(c.id); setView("detail"); }}
                  style={{ background: "#fff", borderRadius: 16, padding: "16px 18px", marginBottom: 10, boxShadow: "0 2px 10px rgba(0,0,0,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ width: 46, height: 46, borderRadius: "50%", background: bal > 0 ? "linear-gradient(135deg,#c8a060,#8a5a10)" : "#d8d0c8", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 18, fontWeight: 700 }}>{c.name[0]}</div>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>{c.name}님</div>
                      <div style={{ fontSize: 11, color: "#9a8a7a", marginTop: 2 }}>
                        {lastCharge ? `충전 ${fmtDateShort(lastCharge.date)}` : ""}{lastCharge && lastUse ? " · " : ""}{lastUse ? `이용 ${fmtDateShort(lastUse.date)}` : ""}{!lastCharge && !lastUse ? "내역 없음" : ""}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 17, fontWeight: 900, color: bal > 0 ? "#2a6a3a" : "#9a8a7a" }}>{fmt(bal)}원</div>
                    <div style={{ fontSize: 10, color: "#9a8a7a", marginTop: 2 }}>잔액</div>
                  </div>
                </div>
              );
            })}
          </div>
          <button onClick={() => setView("add")} style={{ position: "fixed", bottom: 72, right: "calc(50% - 220px)", width: 56, height: 56, borderRadius: "50%", background: "linear-gradient(135deg,#c8a060,#8a5a10)", border: "none", color: "#fff", fontSize: 26, boxShadow: "0 4px 20px rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99 }}>+</button>
        </>
      )}

      {/* ══ ADD ══ */}
      {view === "add" && (
        <>
          <div style={{ background: "linear-gradient(160deg,#1e1208,#3a2010)", padding: "28px 20px 20px", display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={() => setView("list")} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", width: 36, height: 36, borderRadius: "50%", fontSize: 18 }}>←</button>
            <div><div style={{ color: "#c8a060", fontSize: 11, letterSpacing: 3 }}>신규 등록</div><div style={{ color: "#fff", fontSize: 20, fontWeight: 700 }}>고객 추가</div></div>
          </div>
          <div style={{ padding: 20 }}>
            <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }}>
              <label style={{ fontSize: 12, color: "#7a6a5a", fontWeight: 700, display: "block" }}>고객 이름</label>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="예: 정혜원" style={{ width: "100%", marginTop: 8, padding: "13px 16px", border: "2px solid #e8e0d8", borderRadius: 12, fontSize: 16, background: "#faf8f5", display: "block" }} />
              <div style={{ height: 20 }} />
              <label style={{ fontSize: 12, color: "#7a6a5a", fontWeight: 700, display: "block" }}>최초 선결제 금액 <span style={{ fontWeight: 400, color: "#b0a090" }}>(선택)</span></label>
              <div style={{ position: "relative", marginTop: 8 }}>
                <input value={newCharge} onChange={e => setNewCharge(e.target.value.replace(/\D/g, ""))} placeholder="0" type="number" style={{ width: "100%", padding: "13px 48px 13px 16px", border: "2px solid #e8e0d8", borderRadius: 12, fontSize: 16, background: "#faf8f5" }} />
                <span style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", color: "#9a8a7a", fontSize: 14 }}>원</span>
              </div>
              {newCharge && <div style={{ marginTop: 6, color: "#c8a060", fontSize: 13, fontWeight: 700 }}>{fmt(newCharge)}원 충전</div>}
              <div style={{ height: 20 }} />
              <label style={{ fontSize: 12, color: "#7a6a5a", fontWeight: 700, display: "block" }}>선결제 날짜</label>
              <input type="date" value={newChargeDate} onChange={e => setNewChargeDate(e.target.value)} style={{ width: "100%", marginTop: 8, padding: "13px 16px", border: "2px solid #e8e0d8", borderRadius: 12, fontSize: 15, background: "#faf8f5", color: "#1e1810" }} />
              <div style={{ marginTop: 6, color: "#9a8a7a", fontSize: 12 }}>📅 {fmtDate(newChargeDate)}</div>
              <button onClick={async () => { if (!newName.trim()) return; await addCustomerFn(newName.trim(), parseInt(newCharge) || 0, newChargeDate); showToast(`${newName.trim()} 고객 등록 완료`); setNewName(""); setNewCharge(""); setNewChargeDate(today()); setView("list"); }} disabled={!newName.trim()}
                style={{ width: "100%", marginTop: 28, padding: "15px 0", background: newName.trim() ? "linear-gradient(135deg,#c8a060,#8a5a10)" : "#d8d0c8", border: "none", borderRadius: 14, color: "#fff", fontSize: 16, fontWeight: 700 }}>고객 등록하기</button>
            </div>
          </div>
        </>
      )}

      {/* ══ DETAIL ══ */}
      {view === "detail" && selected && (() => {
        const bal = getBalance(selected.id);
        const hist = historyMap[selected.id] || [];
        return (
          <>
            <div style={{ background: "linear-gradient(160deg,#1e1208,#3a2010)", padding: "28px 20px 24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                <button onClick={() => setView("list")} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", width: 36, height: 36, borderRadius: "50%", fontSize: 18 }}>←</button>
                <div style={{ flex: 1 }}><div style={{ color: "#c8a060", fontSize: 11, letterSpacing: 3 }}>선결제 장부</div><div style={{ color: "#fff", fontSize: 22, fontWeight: 900 }}>{selected.name}님</div></div>
                <button onClick={async () => { await sb.from("customers").delete(selected.id); setCustomers(prev => prev.filter(c => c.id !== selected.id)); setView("list"); showToast("고객 삭제 완료", "#8a3a2a"); }}
                  style={{ background: "rgba(255,60,60,0.2)", border: "none", color: "#ff9090", width: 36, height: 36, borderRadius: "50%", fontSize: 16 }}>🗑</button>
              </div>
              <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: 18, padding: "20px 22px" }}>
                <div style={{ color: "#c8a060", fontSize: 12 }}>현재 잔액</div>
                <div style={{ color: "#fff", fontSize: 36, fontWeight: 900, marginTop: 4 }}>{fmt(bal)}<span style={{ fontSize: 18, fontWeight: 400, marginLeft: 4 }}>원</span></div>
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button onClick={() => { setModal({ type: "charge" }); setForm({ amount: "", note: "", date: today() }); }} style={{ flex: 1, padding: "11px 0", borderRadius: 12, border: "none", background: "#c8a060", color: "#fff", fontSize: 14, fontWeight: 700 }}>💰 선결제 충전</button>
                  <button onClick={() => { setModal({ type: "use" }); setForm({ amount: "", note: "", date: today() }); }} disabled={bal <= 0} style={{ flex: 1, padding: "11px 0", borderRadius: 12, border: "none", background: bal > 0 ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.08)", color: bal > 0 ? "#fff" : "rgba(255,255,255,0.3)", fontSize: 14, fontWeight: 700 }}>🍽️ 식사 차감</button>
                </div>
              </div>
            </div>
            <div style={{ padding: "16px 16px 120px" }}>
              <div style={{ fontSize: 13, color: "#7a6a5a", fontWeight: 700, marginBottom: 10, letterSpacing: 1 }}>이용 내역</div>
              {hist.length === 0
                ? <div style={{ textAlign: "center", color: "#b0a090", marginTop: 40 }}>내역이 없어요</div>
                : <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 2px 10px rgba(0,0,0,0.07)" }}>
                    {[...hist].reverse().map((h, i) => (
                      <div key={h.id} style={{ padding: "14px 18px", background: i % 2 === 1 ? "#f7f5f2" : "#fff", borderBottom: i < hist.length - 1 ? "1px solid #f0ece6" : "none", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <div style={{ width: 36, height: 36, borderRadius: "50%", background: h.type === "charge" ? "#e8f4fd" : "#fdf0e8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{h.type === "charge" ? "💰" : "🍽️"}</div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{h.note}</div>
                            <div style={{ fontSize: 11, color: "#9a8a7a", marginTop: 3, display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ background: "#f0ece6", padding: "2px 7px", borderRadius: 8, fontWeight: 600 }}>📅 {fmtDate(h.date)}</span>
                              <span>잔액 {fmt(h.balance)}원</span>
                            </div>
                          </div>
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 900, color: h.type === "charge" ? "#1a5f8a" : "#8a3a2a" }}>{h.type === "charge" ? "+" : "-"}{fmt(h.amount)}</div>
                      </div>
                    ))}
                  </div>
              }
            </div>
          </>
        );
      })()}

      {/* ══ CHAT ══ */}
      {view === "chat" && (
        <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
          <div style={{ background: "linear-gradient(160deg,#1e1208,#3a2010)", padding: "28px 20px 20px", flexShrink: 0 }}>
            <div style={{ color: "#c8a060", fontSize: 11, letterSpacing: 4, marginBottom: 4 }}>AI 어시스턴트</div>
            <div style={{ color: "#fff", fontSize: 22, fontWeight: 900 }}>🤖 AI 도우미</div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, marginTop: 4 }}>충전·차감·조회를 말로 바로 처리해요</div>
          </div>
          <div style={{ background: "#2a1a0a", padding: "10px 14px", display: "flex", gap: 8, overflowX: "auto", flexShrink: 0 }}>
            {["전체 잔액 알려줘", "잔액 있는 고객", ...(customers[0] ? [`${customers[0].name}님 잔액`, `${customers[0].name}님 5만원 차감`] : [])].map(q => (
              <button key={q} onClick={() => setChatInput(q)} style={{ whiteSpace: "nowrap", padding: "6px 14px", borderRadius: 20, border: "1px solid rgba(200,160,96,0.4)", background: "rgba(200,160,96,0.1)", color: "#c8a060", fontSize: 12, fontWeight: 600 }}>{q}</button>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 20px" }}>
            {chatMessages.map((msg, i) => (
              <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start", marginBottom: 12, animation: "fadeUp 0.25s ease" }}>
                {msg.role === "assistant" && <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#c8a060,#8a5a10)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, marginRight: 8, flexShrink: 0, alignSelf: "flex-end" }}>🤖</div>}
                <div style={{ maxWidth: "75%", padding: "12px 16px", borderRadius: msg.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px", background: msg.role === "user" ? "linear-gradient(135deg,#c8a060,#8a5a10)" : "#fff", color: msg.role === "user" ? "#fff" : "#1e1810", fontSize: 14, lineHeight: 1.6, boxShadow: "0 2px 10px rgba(0,0,0,0.08)", whiteSpace: "pre-wrap" }}>{msg.content}</div>
              </div>
            ))}
            {aiLoading && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#c8a060,#8a5a10)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🤖</div>
                <div style={{ background: "#fff", borderRadius: "18px 18px 18px 4px", padding: "14px 18px", boxShadow: "0 2px 10px rgba(0,0,0,0.08)", display: "flex", gap: 5 }}>
                  {[0, 0.2, 0.4].map(d => <div key={d} style={{ width: 7, height: 7, borderRadius: "50%", background: "#c8a060", animation: `pulse 1.2s ${d}s infinite` }} />)}
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <div style={{ padding: "12px 14px 74px", background: "#fff", borderTop: "1px solid #e8e0d8", flexShrink: 0 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendChat()} placeholder="예: 정혜원님 어제 5만원 차감" style={{ flex: 1, padding: "12px 16px", border: "2px solid #e8e0d8", borderRadius: 24, fontSize: 14, background: "#faf8f5" }} />
              <button onClick={sendChat} disabled={!chatInput.trim() || aiLoading} style={{ width: 44, height: 44, borderRadius: "50%", border: "none", background: chatInput.trim() && !aiLoading ? "linear-gradient(135deg,#c8a060,#8a5a10)" : "#d8d0c8", color: "#fff", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>↑</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ 모달 ══ */}
      {modal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1000 }} onClick={() => setModal(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", width: "100%", maxWidth: 480, borderRadius: "24px 24px 0 0", padding: "28px 24px 44px" }}>
            <div style={{ width: 40, height: 4, background: "#d8d0c8", borderRadius: 2, margin: "0 auto 20px" }} />
            <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 6 }}>{modal.type === "charge" ? "💰 선결제 충전" : "🍽️ 식사 차감"}</div>
            <div style={{ color: "#7a6a5a", fontSize: 13, marginBottom: 20 }}>{selected?.name}님 · 현재 잔액 {fmt(getBalance(selected?.id))}원</div>
            <label style={{ fontSize: 12, color: "#7a6a5a", fontWeight: 700 }}>날짜</label>
            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={{ width: "100%", marginTop: 8, padding: "12px 16px", border: "2px solid #e8e0d8", borderRadius: 12, fontSize: 15, background: "#faf8f5", color: "#1e1810", marginBottom: 4 }} />
            <div style={{ color: "#9a8a7a", fontSize: 12, marginBottom: 16 }}>📅 {fmtDate(form.date)}</div>
            <label style={{ fontSize: 12, color: "#7a6a5a", fontWeight: 700 }}>{modal.type === "charge" ? "충전 금액" : "차감 금액"}</label>
            <div style={{ position: "relative", marginTop: 8 }}>
              <input autoFocus value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value.replace(/\D/g, "") }))} placeholder="0" type="number" style={{ width: "100%", padding: "15px 48px 15px 16px", border: "2px solid #e8e0d8", borderRadius: 12, fontSize: 20, fontWeight: 700, background: "#faf8f5" }} />
              <span style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", color: "#9a8a7a", fontSize: 16 }}>원</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              {[10000, 30000, 50000, 100000].map(v => (
                <button key={v} onClick={() => setForm(f => ({ ...f, amount: String((parseInt(f.amount) || 0) + v) }))} style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "1px solid #d8d0c8", background: "#f7f5f2", fontSize: 12, color: "#5a4a3a", fontWeight: 600 }}>+{v / 10000}만</button>
              ))}
            </div>
            {form.amount && <div style={{ marginTop: 10, padding: "10px 14px", background: "#f0f8f0", borderRadius: 10, fontSize: 14, color: "#2a6a3a", fontWeight: 700 }}>{modal.type === "charge" ? `충전 후 잔액: ${fmt((getBalance(selected?.id) || 0) + parseInt(form.amount))}원` : `차감 후 잔액: ${fmt((getBalance(selected?.id) || 0) - parseInt(form.amount))}원`}</div>}
            <div style={{ height: 14 }} />
            <label style={{ fontSize: 12, color: "#7a6a5a", fontWeight: 700 }}>메모 (선택)</label>
            <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder={modal.type === "charge" ? "선결제" : "예: 삼겹살·된장찌개"} style={{ width: "100%", marginTop: 8, padding: "12px 16px", border: "2px solid #e8e0d8", borderRadius: 12, fontSize: 14, background: "#faf8f5" }} />
            <button onClick={applyModal} disabled={!form.amount || parseInt(form.amount) <= 0} style={{ width: "100%", marginTop: 20, padding: "16px 0", background: form.amount && parseInt(form.amount) > 0 ? modal.type === "charge" ? "linear-gradient(135deg,#c8a060,#8a5a10)" : "linear-gradient(135deg,#e06040,#a03020)" : "#d8d0c8", border: "none", borderRadius: 14, color: "#fff", fontSize: 16, fontWeight: 900 }}>{modal.type === "charge" ? "충전하기" : "차감하기"}</button>
          </div>
        </div>
      )}
      <TabBar />
    </div>
  );
}
