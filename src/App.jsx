import React, { useState, useEffect, useCallback, useRef } from "react";
import { storageGet, storageSet } from "./api";

const TOURNAMENT_NAMES = [
  "John Brown Trophy",
  "Jubilee Cup",
  "Open Singles",
  "Ladies",
  "Jock Hunter",
  "Pairs",
  "Triples",
  "Fours",
];

const STORAGE_KEY = "whbl-tournaments-v1";
const PW_KEY = "whbl-admin-password-v1";
const DEFAULT_PASSWORD = "bowlsadmin";

function emptyTournament() {
  return { entrants: [], bracket: null, roundMeta: null };
}

function emptyData() {
  const d = {};
  TOURNAMENT_NAMES.forEach((n) => (d[n] = emptyTournament()));
  return d;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function nextPow2(n) {
  let p = 2;
  while (p < n) p *= 2;
  return p;
}

function generateBracket(entrants) {
  const shuffled = shuffle(entrants);
  const size = nextPow2(Math.max(shuffled.length, 2));
  const byes = size - shuffled.length;
  let slots = shuffle([...shuffled, ...Array(byes).fill(null)]);
  const round1Count = size / 2;
  const round1 = [];
  for (let i = 0; i < round1Count; i++) {
    const p1 = slots[2 * i];
    const p2 = slots[2 * i + 1];
    let winner = null;
    if (p1 && !p2) winner = p1;
    else if (!p1 && p2) winner = p2;
    round1.push({ p1, p2, score1: null, score2: null, winner });
  }
  const rounds = [round1];
  let count = round1Count / 2;
  while (count >= 1) {
    const r = [];
    for (let i = 0; i < count; i++)
      r.push({ p1: null, p2: null, score1: null, score2: null, winner: null });
    rounds.push(r);
    count /= 2;
  }
  // propagate round-1 byes into round 2
  if (rounds.length > 1) {
    rounds[0].forEach((m, i) => {
      if (m.winner) {
        const slot = i % 2 === 0 ? "p1" : "p2";
        rounds[1][Math.floor(i / 2)][slot] = m.winner;
      }
    });
  }
  const roundMeta = rounds.map(() => ({ playBy: "", contact: "" }));
  return { rounds, roundMeta };
}

function cascadeClear(rounds, roundIdx, matchIdx) {
  let ri = roundIdx + 1;
  let mi = Math.floor(matchIdx / 2);
  let slot = matchIdx % 2 === 0 ? "p1" : "p2";
  while (ri < rounds.length) {
    const m = rounds[ri][mi];
    m[slot] = null;
    m.score1 = null;
    m.score2 = null;
    m.winner = null;
    const nextMatchIdx = mi;
    ri += 1;
    mi = Math.floor(nextMatchIdx / 2);
    slot = nextMatchIdx % 2 === 0 ? "p1" : "p2";
  }
}

function roundName(roundIdx, totalRounds) {
  const fromEnd = totalRounds - roundIdx;
  if (fromEnd === 1) return "Final";
  if (fromEnd === 2) return "Semi-Final";
  if (fromEnd === 3) return "Quarter-Final";
  return `Round ${roundIdx + 1}`;
}

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState("home"); // home | tournament | admin
  const [isAdmin, setIsAdmin] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState("");
  const [entrantInput, setEntrantInput] = useState("");
  const entrantInputRef = useRef(null);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [showResetBox, setShowResetBox] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [newPw, setNewPw] = useState("");

  useEffect(() => {
    (async () => {
      try {
        let d;
        try {
          const res = await storageGet(STORAGE_KEY);
          d = res ? JSON.parse(res.value) : emptyData();
        } catch {
          d = emptyData();
        }
        // fill in any missing tournaments
        TOURNAMENT_NAMES.forEach((n) => {
          if (!d[n]) d[n] = emptyTournament();
        });
        setData(d);
      } catch (e) {
        setData(emptyData());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const persist = useCallback(async (next) => {
    setData(next);
    try {
      const ok = await storageSet(STORAGE_KEY, JSON.stringify(next));
      if (!ok) setSaveError("Could not save — changes may be lost.");
      else setSaveError("");
    } catch {
      setSaveError("Could not save — changes may be lost.");
    }
  }, []);

  const checkPassword = async () => {
    let storedPw = DEFAULT_PASSWORD;
    try {
      const res = await storageGet(PW_KEY);
      if (res) storedPw = res.value;
    } catch {
      // key not set yet, use default
    }
    if (pwInput === storedPw) {
      setIsAdmin(true);
      setPwError("");
      setPwInput("");
    } else {
      setPwError("Incorrect password.");
    }
  };

  const changePassword = async () => {
    if (!newPw.trim()) return;
    try {
      await storageSet(PW_KEY, newPw.trim());
      setNewPw("");
    } catch {
      setSaveError("Could not change password.");
    }
  };

  const openTournament = (name) => {
    setSelected(name);
    setView("tournament");
    setEntrantInput("");
  };

  const addEntrant = async () => {
    const name = entrantInput.trim();
    if (!name) return;
    const next = { ...data };
    const current = next[selected].entrants || [];
    next[selected] = { ...next[selected], entrants: [...current, name] };
    await persist(next);
    setEntrantInput("");
    entrantInputRef.current && entrantInputRef.current.focus();
  };

  const removeEntrant = async (idx) => {
    const next = { ...data };
    const current = [...(next[selected].entrants || [])];
    current.splice(idx, 1);
    next[selected] = { ...next[selected], entrants: current };
    await persist(next);
  };

  const doDraw = async () => {
    const list = data[selected].entrants || [];
    if (list.length < 2) {
      alert("Need at least 2 entrants to draw a tournament.");
      return;
    }
    if (data[selected].bracket) {
      if (!window.confirm("A draw already exists for this tournament. Redraw and lose all current results?")) return;
    }
    const { rounds, roundMeta } = generateBracket(list);
    const next = { ...data };
    next[selected] = { ...next[selected], bracket: rounds, roundMeta };
    await persist(next);
  };

  const submitScore = async (roundIdx, matchIdx, s1, s2) => {
    const n1 = Number(s1);
    const n2 = Number(s2);
    if (Number.isNaN(n1) || Number.isNaN(n2) || n1 === n2) {
      alert("Enter two different valid scores.");
      return;
    }
    const next = { ...data };
    const bracket = next[selected].bracket.map((r) => r.map((m) => ({ ...m })));
    const match = bracket[roundIdx][matchIdx];
    match.score1 = n1;
    match.score2 = n2;
    match.winner = n1 > n2 ? match.p1 : match.p2;
    if (roundIdx + 1 < bracket.length) {
      cascadeClear(bracket, roundIdx, matchIdx);
      const slot = matchIdx % 2 === 0 ? "p1" : "p2";
      bracket[roundIdx + 1][Math.floor(matchIdx / 2)][slot] = match.winner;
    }
    next[selected] = { ...next[selected], bracket };
    await persist(next);
  };

  const updateRoundMeta = async (roundIdx, field, value) => {
    const next = { ...data };
    const roundMeta = next[selected].roundMeta.map((r) => ({ ...r }));
    roundMeta[roundIdx][field] = value;
    next[selected] = { ...next[selected], roundMeta };
    await persist(next);
  };

  const resetTournament = async () => {
    if (resetConfirmText !== "RESET") return;
    if (!window.confirm(`Really wipe all entrants and results for "${selected}"? This cannot be undone.`)) return;
    const next = { ...data };
    next[selected] = emptyTournament();
    await persist(next);
    setEntrantText("");
    setResetConfirmText("");
    setShowResetBox(false);
  };

  if (loading) {
    return (
      <div style={styles.loadingScreen}>
        <div style={styles.loadingText}>Loading WHBL Comps…</div>
      </div>
    );
  }

  return (
    <div className="whbl-app" style={styles.app}>
      <style>{fontCss}</style>
      <header className="whbl-grass" style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.crest}>WHBL</div>
          <div>
            <div style={styles.title}>Welwyn Hatfield Bowls League</div>
            <div style={styles.subtitle}>Knockout Competitions</div>
          </div>
          <button
            style={styles.adminToggle}
            onClick={() => {
              if (isAdmin) {
                setIsAdmin(false);
                setView("home");
              } else {
                setView("adminlogin");
              }
            }}
          >
            {isAdmin ? "Exit admin" : "Admin"}
          </button>
        </div>
      </header>

      {saveError && <div style={styles.errorBanner}>{saveError}</div>}

      {view === "adminlogin" && !isAdmin && (
        <div style={styles.centerBox}>
          <div style={styles.card}>
            <div style={styles.cardTitle}>Admin sign-in</div>
            <input
              type="password"
              value={pwInput}
              onChange={(e) => setPwInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && checkPassword()}
              placeholder="Password"
              style={styles.input}
            />
            {pwError && <div style={styles.errText}>{pwError}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button style={styles.btnPrimary} onClick={checkPassword}>Sign in</button>
              <button style={styles.btnGhost} onClick={() => setView("home")}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {(view === "home" || (view === "adminlogin" && isAdmin)) && (
        <main style={styles.grid}>
          {TOURNAMENT_NAMES.map((name) => {
            const t = data[name];
            const champ =
              t.bracket && t.bracket.length
                ? t.bracket[t.bracket.length - 1][0].winner
                : null;
            return (
              <button key={name} className="whbl-tcard" style={styles.tCard} onClick={() => openTournament(name)}>
                <div style={styles.tCardName}>{name}</div>
                <div style={styles.tCardMeta}>
                  {t.entrants.length} entrant{t.entrants.length === 1 ? "" : "s"}
                  {t.bracket ? " · draw made" : " · no draw yet"}
                </div>
                {champ && <div style={styles.tCardChamp}>🏆 {champ}</div>}
              </button>
            );
          })}
        </main>
      )}

      {view === "tournament" && selected && (
        <main style={styles.tournamentView}>
          <button style={styles.backLink} onClick={() => setView("home")}>← All competitions</button>
          <h2 style={styles.tHeading}>{selected}</h2>

          {isAdmin && (
            <div style={styles.adminPanel}>
              <div style={styles.cardTitle}>Entrants ({(data[selected].entrants || []).length})</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  ref={entrantInputRef}
                  style={styles.input}
                  value={entrantInput}
                  onChange={(e) => setEntrantInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addEntrant()}
                  placeholder="Player or team name"
                />
                <button style={styles.btnPrimary} onClick={addEntrant}>Add</button>
              </div>
              <div style={styles.hintText}>Press Enter to add and move straight to the next name</div>
              {(data[selected].entrants || []).length > 0 && (
                <ul style={styles.entrantList}>
                  {(data[selected].entrants || []).map((name, idx) => (
                    <li key={idx} style={styles.entrantItem}>
                      <span>{name}</span>
                      <button style={styles.entrantRemove} onClick={() => removeEntrant(idx)}>✕</button>
                    </li>
                  ))}
                </ul>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button style={styles.btnAccent} onClick={doDraw}>
                  {data[selected].bracket ? "Redraw tournament" : "Random draw"}
                </button>
              </div>

              <div style={{ marginTop: 20 }}>
                <button style={styles.btnDanger} onClick={() => setShowResetBox(!showResetBox)}>
                  Remove all data for next year
                </button>
                {showResetBox && (
                  <div style={styles.resetBox}>
                    <div style={{ marginBottom: 8 }}>
                      This permanently deletes entrants and results for <b>{selected}</b>.
                      Type RESET to confirm.
                    </div>
                    <input
                      style={styles.input}
                      value={resetConfirmText}
                      onChange={(e) => setResetConfirmText(e.target.value)}
                      placeholder="Type RESET"
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button
                        style={{ ...styles.btnDanger, opacity: resetConfirmText === "RESET" ? 1 : 0.5 }}
                        disabled={resetConfirmText !== "RESET"}
                        onClick={resetTournament}
                      >
                        Confirm reset
                      </button>
                      <button style={styles.btnGhost} onClick={() => setShowResetBox(false)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ marginTop: 20, borderTop: "1px solid #d8cfb8", paddingTop: 16 }}>
                <div style={styles.cardTitle}>Change admin password</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    style={styles.input}
                    type="password"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    placeholder="New password"
                  />
                  <button style={styles.btnPrimary} onClick={changePassword}>Update</button>
                </div>
              </div>
            </div>
          )}

          {!data[selected].bracket && (
            <div style={styles.emptyState}>
              No draw has been made for this competition yet.
              {isAdmin ? " Add entrants above and click Random draw." : " Check back once the admin has entered players and made the draw."}
            </div>
          )}

          {data[selected].bracket && (
            <Bracket
              rounds={data[selected].bracket}
              roundMeta={data[selected].roundMeta}
              isAdmin={isAdmin}
              onSubmitScore={submitScore}
              onUpdateMeta={updateRoundMeta}
            />
          )}
        </main>
      )}
    </div>
  );
}

function buildSides(rounds) {
  const totalRounds = rounds.length;
  if (totalRounds === 1) {
    return { leftCols: [], rightCols: [], finalMatch: rounds[0][0] };
  }
  const leftCols = [];
  const rightCols = [];
  for (let ri = 0; ri < totalRounds - 1; ri++) {
    const round = rounds[ri];
    const half = round.length / 2;
    const leftItems = round.slice(0, half).map((m, i) => ({ match: m, matchIdx: i }));
    const rightItems = round.slice(half).map((m, i) => ({ match: m, matchIdx: i + half }));
    leftCols.push({ roundIdx: ri, items: leftItems });
    rightCols.unshift({ roundIdx: ri, items: rightItems });
  }
  return { leftCols, rightCols, finalMatch: rounds[totalRounds - 1][0] };
}

function Bracket({ rounds, roundMeta, isAdmin, onSubmitScore, onUpdateMeta }) {
  const totalRounds = rounds.length;
  const { leftCols, rightCols, finalMatch } = buildSides(rounds);

  const RoundColumn = ({ roundIdx, items, editableDates, side }) => (
    <div style={styles.roundCol}>
      <div style={styles.roundLabel}>{roundName(roundIdx, totalRounds)}</div>
      <div style={styles.roundDates}>
        {editableDates && isAdmin ? (
          <>
            <label style={styles.dateLabel}>
              Play by
              <input
                type="date"
                style={styles.dateInput}
                value={roundMeta[roundIdx].playBy}
                onChange={(e) => onUpdateMeta(roundIdx, "playBy", e.target.value)}
              />
            </label>
            <label style={styles.dateLabel}>
              Contact
              <input
                type="text"
                style={styles.dateInput}
                value={roundMeta[roundIdx].contact}
                onChange={(e) => onUpdateMeta(roundIdx, "contact", e.target.value)}
                placeholder="Contact name"
              />
            </label>
          </>
        ) : (
          (roundMeta[roundIdx].playBy || roundMeta[roundIdx].contact) && (
            <div style={styles.dateReadout}>
              {roundMeta[roundIdx].playBy && <div>Play by {roundMeta[roundIdx].playBy}</div>}
              {roundMeta[roundIdx].contact && <div>Contact: {roundMeta[roundIdx].contact}</div>}
            </div>
          )
        )}
      </div>
      <div className={side === "left" ? "whbl-col-left" : "whbl-col-right"} style={{ ...styles.matchesCol, justifyContent: "space-around" }}>
        {items.map(({ match, matchIdx }) => (
          <MatchCard
            key={matchIdx}
            match={match}
            onSubmit={(s1, s2) => onSubmitScore(roundIdx, matchIdx, s1, s2)}
          />
        ))}
      </div>
    </div>
  );

  if (totalRounds === 1) {
    return (
      <div className="whbl-bracket-scroll" style={styles.bracketScroll}>
        <div style={{ ...styles.bracketRow, justifyContent: "center" }}>
          <div style={styles.roundCol}>
            <div style={styles.roundLabel}>Final</div>
            <MatchCard match={finalMatch} onSubmit={(s1, s2) => onSubmitScore(0, 0, s1, s2)} />
            <div style={styles.champBox}>
              {finalMatch.winner ? <>🏆 {finalMatch.winner}</> : "TBD"}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="whbl-bracket-scroll" style={styles.bracketScroll}>
      <div style={{ ...styles.bracketRow, alignItems: "center" }}>
        {leftCols.map((col) => (
          <RoundColumn key={"l" + col.roundIdx} roundIdx={col.roundIdx} items={col.items} editableDates side="left" />
        ))}
        <div className="whbl-final-col" style={styles.finalCol}>
          <div style={styles.roundLabel}>Final</div>
          <MatchCard
            match={finalMatch}
            onSubmit={(s1, s2) => onSubmitScore(totalRounds - 1, 0, s1, s2)}
          />
          <div style={styles.champBox}>
            {finalMatch.winner ? <>🏆 {finalMatch.winner}</> : "TBD"}
          </div>
        </div>
        {rightCols.map((col) => (
          <RoundColumn key={"r" + col.roundIdx} roundIdx={col.roundIdx} items={col.items} editableDates={false} side="right" />
        ))}
      </div>
    </div>
  );
}

function MatchCard({ match, onSubmit }) {
  const [s1, setS1] = useState(match.score1 ?? "");
  const [s2, setS2] = useState(match.score2 ?? "");
  const bye = (match.p1 && !match.p2) || (!match.p1 && match.p2);
  const editable = match.p1 && match.p2 && !bye;

  useEffect(() => {
    setS1(match.score1 ?? "");
    setS2(match.score2 ?? "");
  }, [match.score1, match.score2]);

  return (
    <div className="whbl-match" style={{ ...styles.matchCard, opacity: match.p1 || match.p2 ? 1 : 0.45 }}>
      <span className="whbl-jack" />
      <PlayerRow name={match.p1} won={match.winner && match.winner === match.p1} score={s1} />
      <div style={styles.vsDivider} />
      <PlayerRow name={match.p2} won={match.winner && match.winner === match.p2} score={s2} />
      {bye && <div style={styles.byeTag}>bye</div>}
      {editable && (
        <div style={styles.scoreRow}>
          <input
            style={styles.scoreInput}
            value={s1}
            onChange={(e) => setS1(e.target.value)}
            inputMode="numeric"
            placeholder="0"
          />
          <span style={{ color: "#8a8371" }}>–</span>
          <input
            style={styles.scoreInput}
            value={s2}
            onChange={(e) => setS2(e.target.value)}
            inputMode="numeric"
            placeholder="0"
          />
          <button style={styles.scoreBtn} onClick={() => onSubmit(s1, s2)}>
            {match.winner ? "Update" : "Submit"}
          </button>
        </div>
      )}
    </div>
  );
}

function PlayerRow({ name, won, score }) {
  return (
    <div
      style={{
        ...styles.playerRow,
        fontWeight: won ? 700 : 400,
        color: won ? "#17392A" : "#3a362c",
        borderBottom: won ? "2px solid #AC8347" : "2px solid transparent",
      }}
    >
      <span>{won ? "🏆 " : ""}{name || "—"}</span>
      {name && score !== "" && score != null && <span style={styles.scoreDigit}>{score}</span>}
    </div>
  );
}

const fontCss = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Inter:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap');

  .whbl-bracket-scroll::-webkit-scrollbar { width: 12px; height: 12px; }
  .whbl-bracket-scroll::-webkit-scrollbar-track { background: #F5EFDD; border-radius: 8px; }
  .whbl-bracket-scroll::-webkit-scrollbar-thumb { background: #AC8347; border-radius: 8px; border: 2px solid #F5EFDD; }

  .whbl-grass {
    background-image: repeating-linear-gradient(
      100deg,
      rgba(255,255,255,0.05) 0px,
      rgba(255,255,255,0.05) 22px,
      rgba(0,0,0,0.05) 22px,
      rgba(0,0,0,0.05) 44px
    );
  }

  .whbl-col-left .whbl-match { position: relative; }
  .whbl-col-left .whbl-match::after {
    content: "";
    position: absolute;
    top: 50%;
    right: -17px;
    width: 17px;
    height: 2px;
    background: #AC8347;
  }
  .whbl-col-right .whbl-match { position: relative; }
  .whbl-col-right .whbl-match::before {
    content: "";
    position: absolute;
    top: 50%;
    left: -17px;
    width: 17px;
    height: 2px;
    background: #AC8347;
  }
  .whbl-final-col::before,
  .whbl-final-col::after {
    content: "";
    position: absolute;
    top: 50%;
    width: 17px;
    height: 2px;
    background: #AC8347;
  }
  .whbl-final-col::before { left: -17px; }
  .whbl-final-col::after { right: -17px; }

  .whbl-jack {
    position: absolute;
    top: -6px;
    left: -6px;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: #FDFBF6;
    border: 2px solid #AC8347;
  }

  .whbl-tcard { transition: transform 0.15s ease, box-shadow 0.15s ease; }
  .whbl-tcard:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(23,57,42,0.14); }

  .whbl-app :focus-visible {
    outline: 3px solid #AC8347;
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .whbl-tcard { transition: none; }
  }
`;

const styles = {
  app: {
    minHeight: "100vh",
    background: "#F5EFDD",
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    color: "#2A2A22",
    paddingBottom: 60,
  },
  loadingScreen: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#17392A",
    color: "#F5EFDD",
    fontFamily: "system-ui, sans-serif",
  },
  loadingText: { fontSize: 18, letterSpacing: 1 },
  header: { background: "#17392A", padding: "20px 16px", borderBottom: "4px solid #AC8347" },
  headerInner: { display: "flex", alignItems: "center", gap: 14, maxWidth: 1100, margin: "0 auto" },
  crest: {
    fontFamily: "'Fraunces', Georgia, serif",
    fontWeight: 700,
    fontSize: 13,
    color: "#17392A",
    background: "#AC8347",
    width: 52,
    height: 52,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    letterSpacing: -0.5,
    flexShrink: 0,
    lineHeight: 1,
    textAlign: "center",
    border: "2px solid #D9B87A",
  },
  title: {
    fontFamily: "'Fraunces', Georgia, serif",
    fontWeight: 700,
    fontSize: 20,
    color: "#FFFDF7",
    lineHeight: 1.2,
  },
  subtitle: { color: "#D9B87A", fontSize: 13, letterSpacing: 1.5, textTransform: "uppercase" },
  adminToggle: {
    marginLeft: "auto",
    background: "transparent",
    border: "1px solid #D9B87A",
    color: "#D9B87A",
    padding: "8px 14px",
    borderRadius: 6,
    fontSize: 13,
    cursor: "pointer",
  },
  errorBanner: { background: "#8c2f2f", color: "#fff", textAlign: "center", padding: 8, fontSize: 13 },
  centerBox: { display: "flex", justifyContent: "center", padding: 40 },
  card: {
    background: "#FDFBF6",
    borderRadius: 10,
    padding: 24,
    width: 320,
    boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
    border: "1px solid #e2d9c2",
  },
  cardTitle: { fontFamily: "'Fraunces', Georgia, serif", fontWeight: 700, fontSize: 17, marginBottom: 10, color: "#17392A" },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 6,
    border: "1px solid #cfc4a3",
    fontSize: 14,
    boxSizing: "border-box",
  },
  errText: { color: "#a33", fontSize: 13, marginTop: 6 },
  btnPrimary: {
    background: "#17392A",
    color: "#fff",
    border: "none",
    padding: "10px 16px",
    borderRadius: 6,
    fontSize: 14,
    cursor: "pointer",
    fontWeight: 600,
  },
  btnAccent: {
    background: "#AC8347",
    color: "#fff",
    border: "none",
    padding: "10px 16px",
    borderRadius: 6,
    fontSize: 14,
    cursor: "pointer",
    fontWeight: 600,
  },
  btnGhost: {
    background: "transparent",
    color: "#5a5544",
    border: "1px solid #cfc4a3",
    padding: "10px 16px",
    borderRadius: 6,
    fontSize: 14,
    cursor: "pointer",
  },
  btnDanger: {
    background: "#8c2f2f",
    color: "#fff",
    border: "none",
    padding: "10px 16px",
    borderRadius: 6,
    fontSize: 14,
    cursor: "pointer",
    fontWeight: 600,
  },
  resetBox: { marginTop: 10, background: "#fbeeee", border: "1px solid #e0b8b8", padding: 14, borderRadius: 8, fontSize: 13 },
  grid: {
    maxWidth: 1100,
    margin: "0 auto",
    padding: "24px 16px",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
    gap: 16,
  },
  tCard: {
    background: "#FDFBF6",
    border: "1px solid #e2d9c2",
    borderLeft: "5px solid #AC8347",
    borderRadius: 8,
    padding: 18,
    textAlign: "left",
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
  },
  tCardName: { fontFamily: "'Fraunces', Georgia, serif", fontWeight: 700, fontSize: 17, color: "#17392A" },
  tCardMeta: { fontSize: 13, color: "#7a7462", marginTop: 6 },
  tCardChamp: { fontSize: 13, color: "#8c6d1f", marginTop: 8, fontWeight: 600 },
  tournamentView: { maxWidth: 1200, margin: "0 auto", padding: "20px 16px" },
  backLink: { background: "none", border: "none", color: "#17392A", fontSize: 14, cursor: "pointer", padding: 0, marginBottom: 10 },
  tHeading: { fontFamily: "'Fraunces', Georgia, serif", fontSize: 26, color: "#17392A", margin: "0 0 16px" },
  adminPanel: { background: "#FDFBF6", border: "1px solid #e2d9c2", borderRadius: 10, padding: 18, marginBottom: 24 },
  textarea: {
    width: "100%",
    padding: 10,
    borderRadius: 6,
    border: "1px solid #cfc4a3",
    fontSize: 14,
    boxSizing: "border-box",
    fontFamily: "inherit",
  },
  hintText: { fontSize: 12, color: "#8a8371", marginTop: 4 },
  entrantList: { listStyle: "none", margin: "10px 0 0", padding: 0, maxHeight: 220, overflowY: "auto", border: "1px solid #eee0c0", borderRadius: 6 },
  entrantItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "7px 10px",
    fontSize: 14,
    borderBottom: "1px solid #f2ead4",
  },
  entrantRemove: {
    background: "none",
    border: "none",
    color: "#a33",
    cursor: "pointer",
    fontSize: 13,
    padding: "2px 6px",
  },
  emptyState: { background: "#FDFBF6", border: "1px dashed #cfc4a3", borderRadius: 8, padding: 24, color: "#7a7462", fontSize: 14 },
  bracketScroll: {
    overflow: "auto",
    maxHeight: "72vh",
    paddingBottom: 20,
    border: "1px solid #e2d9c2",
    borderRadius: 10,
    background: "#FDFBF6",
    padding: 16,
    scrollbarWidth: "auto",
    scrollbarColor: "#AC8347 #F5EFDD",
  },
  bracketRow: { display: "flex", gap: 28, minWidth: "fit-content" },
  roundCol: { display: "flex", flexDirection: "column", minWidth: 190 },
  finalCol: {
    display: "flex",
    flexDirection: "column",
    minWidth: 190,
    background: "#F9F5E8",
    border: "1px solid #D9B87A",
    borderRadius: 10,
    padding: "10px 14px 16px",
    alignSelf: "center",
  },
  roundLabel: {
    fontFamily: "'Fraunces', Georgia, serif",
    fontWeight: 700,
    color: "#17392A",
    fontSize: 15,
    textAlign: "center",
    marginBottom: 6,
  },
  roundDates: { textAlign: "center", marginBottom: 10, minHeight: 20 },
  dateLabel: { display: "block", fontSize: 11, color: "#7a7462", marginBottom: 4 },
  dateInput: { fontSize: 12, padding: "4px 6px", borderRadius: 4, border: "1px solid #cfc4a3", width: "100%", boxSizing: "border-box" },
  dateReadout: { fontSize: 11, color: "#7a7462", lineHeight: 1.5 },
  matchesCol: { display: "flex", flexDirection: "column", flex: 1, gap: 14 },
  matchCard: {
    background: "#FDFBF6",
    border: "1px solid #e2d9c2",
    borderRadius: 8,
    padding: "10px 12px",
    position: "relative",
  },
  playerRow: { display: "flex", justifyContent: "space-between", fontSize: 14, padding: "3px 0" },
  scoreDigit: { fontFamily: "'Space Mono', monospace", fontWeight: 700 },
  vsDivider: { height: 1, background: "#eee0c0", margin: "2px 0" },
  byeTag: { fontSize: 10, color: "#AC8347", textTransform: "uppercase", letterSpacing: 1, marginTop: 4 },
  scoreRow: { display: "flex", alignItems: "center", gap: 6, marginTop: 8 },
  scoreInput: { width: 40, padding: "4px 6px", borderRadius: 4, border: "1px solid #cfc4a3", fontSize: 13, textAlign: "center", fontFamily: "'Space Mono', monospace" },
  scoreBtn: {
    marginLeft: "auto",
    background: "#17392A",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    padding: "5px 10px",
    fontSize: 12,
    cursor: "pointer",
  },
  champBox: {
    background: "linear-gradient(160deg, #1E4530 0%, #17392A 100%)",
    color: "#FFFDF7",
    borderRadius: 8,
    padding: "18px 12px",
    textAlign: "center",
    fontWeight: 700,
    fontSize: 16,
    fontFamily: "'Fraunces', Georgia, serif",
    marginTop: 30,
    border: "1px solid #D9B87A",
    boxShadow: "0 4px 14px rgba(23,57,42,0.25)",
  },
};
