import React, { useState, useEffect, useCallback, useRef } from "react";
import { storageGet, storageSet, login, adminInfo, setPassword } from "./api";

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
// The players' password is remembered on each phone or computer under this name.
const PLAYER_PW_KEY = "whbl-player-password";

function rememberedPlayerPw() {
  try {
    return localStorage.getItem(PLAYER_PW_KEY) || "";
  } catch {
    return "";
  }
}

function rememberPlayerPw(pw) {
  try {
    if (pw) localStorage.setItem(PLAYER_PW_KEY, pw);
    else localStorage.removeItem(PLAYER_PW_KEY);
  } catch {
    // private window etc. — they'll just be asked again next time
  }
}

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
  const list = shuffle(entrants);
  const n = list.length;
  const size = nextPow2(Math.max(n, 2));
  const matchCount = size / 2;
  const byes = size - n; // always less than matchCount

  let pairs = [];
  let idx = 0;
  for (let i = 0; i < matchCount; i++) {
    if (i < byes) {
      pairs.push([list[idx++], null]);
    } else {
      const a = list[idx++];
      const b = list[idx++];
      pairs.push([a, b]);
    }
  }
  pairs = shuffle(pairs).map(([a, b]) => (Math.random() < 0.5 ? [b, a] : [a, b]));

  const round1 = pairs.map(([p1, p2]) => ({
    p1,
    p2,
    score1: null,
    score2: null,
    winner: p1 && !p2 ? p1 : !p1 && p2 ? p2 : null,
  }));

  const rounds = [round1];
  let count = matchCount / 2;
  while (count >= 1) {
    const r = [];
    for (let i = 0; i < count; i++) {
      r.push({ p1: null, p2: null, score1: null, score2: null, winner: null });
    }
    rounds.push(r);
    count /= 2;
  }

  if (rounds.length > 1) {
    rounds[0].forEach((m, i) => {
      if (m.winner) {
        const slot = i % 2 === 0 ? "p1" : "p2";
        rounds[1][Math.floor(i / 2)][slot] = m.winner;
      }
    });
  }

  const roundMeta = rounds.map(() => ({ contactBy: "", playBy: "" }));
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
  // The admin's password is kept only while the page is open; the players' password is remembered on the device.
  const [adminAuth, setAdminAuth] = useState(null);
  const isAdmin = !!adminAuth;
  const [playerPw, setPlayerPw] = useState(rememberedPlayerPw);
  const [needPassword, setNeedPassword] = useState(false);
  const [playerInput, setPlayerInput] = useState("");
  const [playerError, setPlayerError] = useState("");
  const [playersPwSet, setPlayersPwSet] = useState(null);
  const [newPlayersPw, setNewPlayersPw] = useState("");
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState("");
  const [entrantInput, setEntrantInput] = useState("");
  const entrantInputRef = useRef(null);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [showResetBox, setShowResetBox] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [newPw, setNewPw] = useState("");

  // Whoever is using the site: the admin, or a player with the players' password.
  const auth = adminAuth || (playerPw ? { role: "player", password: playerPw } : null);
  const authKey = adminAuth ? "admin" : playerPw ? "player:" + playerPw : "none";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await storageGet(STORAGE_KEY, auth);
        const d = res ? JSON.parse(res.value) : emptyData();
        // fill in any missing tournaments
        TOURNAMENT_NAMES.forEach((n) => {
          if (!d[n]) d[n] = emptyTournament();
        });
        if (cancelled) return;
        setNeedPassword(false);
        setData(d);
        setSaveError("");
      } catch (e) {
        if (cancelled) return;
        if (e.needPassword) {
          // A remembered password that no longer works (the admin changed it) is forgotten.
          if (playerPw && !adminAuth) {
            rememberPlayerPw("");
            setPlayerPw("");
          }
          setNeedPassword(true);
          setData(null);
        } else {
          setSaveError("Could not load the competitions — check your connection and refresh the page.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authKey]);

  useEffect(() => {
    if (!adminAuth) return;
    adminInfo(adminAuth).then((r) => setPlayersPwSet(r.ok ? !!r.playersPasswordSet : null));
  }, [adminAuth]);

  const persist = useCallback(
    async (next) => {
      setData(next);
      const r = await storageSet(STORAGE_KEY, JSON.stringify(next), auth);
      if (r.ok) setSaveError("");
      else if (r.status === 401) setSaveError("Your password has changed — refresh the page and sign in again.");
      else if (r.status === 403) setSaveError("Only the admin can change entrants, draws or dates.");
      else setSaveError("Could not save — changes may be lost.");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [authKey]
  );

  const checkPassword = async () => {
    const tryAuth = { role: "admin", password: pwInput };
    if (await login(tryAuth)) {
      setAdminAuth(tryAuth);
      setPwError("");
      setPwInput("");
    } else {
      setPwError("Incorrect password.");
    }
  };

  const playerSignIn = async () => {
    const pw = playerInput.trim();
    if (!pw) return;
    if (await login({ role: "player", password: pw })) {
      rememberPlayerPw(pw);
      setPlayerPw(pw);
      setPlayerInput("");
      setPlayerError("");
    } else {
      setPlayerError("Incorrect password.");
    }
  };

  const playerSignOut = () => {
    if (!window.confirm("Sign out on this device? You'll need the players' password to get back in.")) return;
    rememberPlayerPw("");
    setPlayerPw("");
    setView("home");
  };

  const changePassword = async () => {
    const pw = newPw.trim();
    if (pw.length < 4) {
      alert("The password must be at least 4 characters.");
      return;
    }
    if (await setPassword(adminAuth, "admin", pw)) {
      setAdminAuth({ role: "admin", password: pw });
      setNewPw("");
      alert("Admin password changed.");
    } else {
      alert("Could not change the admin password.");
    }
  };

  const changePlayersPassword = async () => {
    const pw = newPlayersPw.trim();
    if (pw.length < 4) {
      alert("The players' password must be at least 4 characters.");
      return;
    }
    if (await setPassword(adminAuth, "players", pw)) {
      setPlayersPwSet(true);
      setNewPlayersPw("");
      alert("Players' password saved. Give it to the players — everyone will need it to see the draws and enter results.");
    } else {
      alert("Could not save the players' password.");
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
    const prevWinner = match.winner;
    match.winner = n1 > n2 ? match.p1 : match.p2;
    if (roundIdx + 1 < bracket.length && prevWinner !== match.winner) {
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
    setResetConfirmText("");
    setShowResetBox(false);
  };

  if (loading && !data && !needPassword) {
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
          <div style={styles.headerActions}>
            {!isAdmin && playerPw && !needPassword && (
              <button
                style={styles.signOutBtn}
                title="Sign out on this device — the players' password will be asked for next time"
                onClick={playerSignOut}
              >
                ✕ Sign out
              </button>
            )}
            <button
              style={styles.adminToggle}
              onClick={() => {
                if (isAdmin) {
                  setAdminAuth(null);
                  setPlayersPwSet(null);
                  setView("home");
                } else {
                  setView("adminlogin");
                }
              }}
            >
              {isAdmin ? "Exit admin" : "Admin"}
            </button>
          </div>
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

      {needPassword && !isAdmin && view !== "adminlogin" && (
        <div style={styles.centerBox}>
          <div style={styles.card}>
            <div style={styles.cardTitle}>Players' sign-in</div>
            <div style={{ fontSize: 14, color: "#5d584a", marginBottom: 10 }}>
              Enter the players' password to see the draws and enter your results. You'll only need to do this once on this
              phone or computer.
            </div>
            <input
              type="password"
              value={playerInput}
              onChange={(e) => setPlayerInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && playerSignIn()}
              placeholder="Players' password"
              style={styles.input}
              autoFocus
            />
            {playerError && <div style={styles.errText}>{playerError}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button style={styles.btnPrimary} onClick={playerSignIn}>Sign in</button>
            </div>
            <div style={{ fontSize: 13, color: "#7a7462", marginTop: 12 }}>
              Don't know it? Ask your club or the league secretary.
            </div>
          </div>
        </div>
      )}

      {isAdmin && playersPwSet === false && (
        <div style={styles.warnBanner}>
          No players' password is set yet, so anyone with the link can see the draws and enter results. Open any
          competition and set one under <b>Players' password</b>.
        </div>
      )}

      {data && (view === "home" || (view === "adminlogin" && isAdmin)) && (
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

      {data && view === "tournament" && selected && (
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
                <div style={styles.cardTitle}>Players' password</div>
                <div style={{ fontSize: 13, color: "#5d584a", marginBottom: 8 }}>
                  {playersPwSet
                    ? "A players' password is set. Players type it once on each phone or computer. Entering a new one replaces it, and everyone will be asked for the new one."
                    : "Not set yet — anyone with the link can see the draws and enter results. Set one and give it to the players."}
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
                  <input
                    style={styles.input}
                    type="text"
                    autoComplete="off"
                    value={newPlayersPw}
                    onChange={(e) => setNewPlayersPw(e.target.value)}
                    placeholder={playersPwSet ? "New players' password" : "Players' password (4+ characters)"}
                    aria-label="Players' password"
                  />
                  <button style={styles.btnPrimary} onClick={changePlayersPassword}>{playersPwSet ? "Change" : "Set"}</button>
                </div>
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

// "Mon 10 May" from "2027-05-10" (falls back to the text as stored).
function niceDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return iso || "";
  return new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

// A round's "Contact by" and "Play by" dates: date boxes for the admin, plain text for everyone else.
// The Final has just one date: the day it is played (kept as its play-by date).
function renderRoundDates(meta, roundIdx, isAdmin, onUpdateMeta, extraStyle, isFinal = false) {
  const m = meta || {};
  if (isFinal) {
    if (isAdmin) {
      return (
        <div style={{ ...styles.roundDates, ...extraStyle }}>
          <label style={styles.dateLabel}>
            Final date
            <input
              type="date"
              style={styles.dateInput}
              value={m.playBy || ""}
              onChange={(e) => onUpdateMeta(roundIdx, "playBy", e.target.value)}
            />
          </label>
        </div>
      );
    }
    return (
      <div style={{ ...styles.roundDates, ...extraStyle }}>
        {m.playBy && (
          <div style={styles.dateReadout}>
            Final: <b>{niceDate(m.playBy)}</b>
          </div>
        )}
      </div>
    );
  }
  if (isAdmin) {
    return (
      <div style={{ ...styles.roundDates, ...extraStyle }}>
        <label style={styles.dateLabel}>
          Contact by
          <input
            type="date"
            style={styles.dateInput}
            value={m.contactBy || ""}
            onChange={(e) => onUpdateMeta(roundIdx, "contactBy", e.target.value)}
          />
        </label>
        <label style={styles.dateLabel}>
          Play by
          <input
            type="date"
            style={styles.dateInput}
            value={m.playBy || ""}
            onChange={(e) => onUpdateMeta(roundIdx, "playBy", e.target.value)}
          />
        </label>
      </div>
    );
  }
  if (!m.contactBy && !m.playBy) return <div style={{ ...styles.roundDates, ...extraStyle }} />;
  return (
    <div style={{ ...styles.roundDates, ...extraStyle }}>
      <div style={styles.dateReadout}>
        {m.contactBy && <div>Contact by <b>{niceDate(m.contactBy)}</b></div>}
        {m.playBy && <div>Play by <b>{niceDate(m.playBy)}</b></div>}
      </div>
    </div>
  );
}

// ---------- Phone view: one round at a time ----------

// True on a phone-sized screen, where the whole draw is too wide to see.
function useIsPhone() {
  const query = "(max-width: 700px)";
  const [phone, setPhone] = useState(() =>
    typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const onChange = (e) => setPhone(e.matches);
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    setPhone(mq.matches);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, []);
  return phone;
}

// The round being played now: the first one with a match that has both players but no result.
function currentRoundIdx(rounds) {
  for (let ri = 0; ri < rounds.length; ri++) {
    if (rounds[ri].some((m) => m.p1 && m.p2 && !m.winner)) return ri;
  }
  return rounds.length - 1;
}

function PhoneBracket({ rounds, roundMeta, isAdmin, onSubmitScore, onUpdateMeta }) {
  const total = rounds.length;
  const [picked, setPicked] = useState(null);
  const ri = picked === null || picked >= total ? currentRoundIdx(rounds) : picked;
  const tabsRef = useRef(null);

  // Keep the chosen tab in view (the tab row scrolls sideways on narrow phones).
  useEffect(() => {
    const row = tabsRef.current;
    const tab = row && row.querySelector('[data-on="1"]');
    if (tab) row.scrollLeft = tab.offsetLeft - (row.clientWidth - tab.offsetWidth) / 2;
  }, [ri]);

  const isBye = (m) => ri === 0 && !!m.p1 !== !!m.p2;
  const games = rounds[ri].map((m, i) => ({ m, i })).filter(({ m }) => !isBye(m));
  const byes = rounds[ri].filter(isBye).map((m) => m.p1 || m.p2);
  const finalMatch = rounds[total - 1][0];

  return (
    <div style={styles.phoneBox}>
      <div ref={tabsRef} style={styles.phoneTabs} role="tablist" aria-label="Rounds">
        {rounds.map((_, i) => (
          <button
            key={i}
            role="tab"
            aria-selected={i === ri}
            data-on={i === ri ? "1" : "0"}
            style={i === ri ? { ...styles.phoneTab, ...styles.phoneTabOn } : styles.phoneTab}
            onClick={() => setPicked(i)}
          >
            {roundName(i, total)}
          </button>
        ))}
      </div>
      <div style={styles.roundLabel}>{roundName(ri, total)}</div>
      {renderRoundDates(roundMeta[ri], ri, isAdmin, onUpdateMeta, { marginBottom: 12 }, ri === total - 1)}
      <div style={styles.phoneList}>
        {games.length ? (
          games.map(({ m, i }) => (
            <MatchCard
              key={ri + "-" + i}
              match={m}
              firstRound={ri === 0}
              onSubmit={(s1, s2) => onSubmitScore(ri, i, s1, s2)}
            />
          ))
        ) : (
          <div style={styles.phoneNote}>No matches in this round yet.</div>
        )}
      </div>
      {byes.length > 0 && (
        <div style={styles.phoneNote}>
          <b>Byes to the next round:</b> {byes.join(", ")}
        </div>
      )}
      {ri === total - 1 && (
        <div style={{ ...styles.champBox, marginTop: 14 }}>
          {finalMatch.winner ? <>🏆 {finalMatch.winner}</> : "TBD"}
        </div>
      )}
    </div>
  );
}

function Bracket({ rounds, roundMeta, isAdmin, onSubmitScore, onUpdateMeta }) {
  const isPhone = useIsPhone();
  if (isPhone) {
    return (
      <PhoneBracket rounds={rounds} roundMeta={roundMeta} isAdmin={isAdmin} onSubmitScore={onSubmitScore} onUpdateMeta={onUpdateMeta} />
    );
  }
  const totalRounds = rounds.length;
  const { leftCols, rightCols, finalMatch } = buildSides(rounds);

  const RoundColumn = ({ roundIdx, items, editableDates, side }) => (
    <div style={styles.roundCol}>
      <div style={styles.roundLabel}>{roundName(roundIdx, totalRounds)}</div>
      {renderRoundDates(roundMeta[roundIdx], roundIdx, editableDates && isAdmin, onUpdateMeta, null)}
      <div className={side === "left" ? "whbl-col-left" : "whbl-col-right"} style={{ ...styles.matchesCol, justifyContent: "space-around" }}>
        {items.map(({ match, matchIdx }) => (
          <MatchCard
            key={matchIdx}
            match={match}
            firstRound={roundIdx === 0}
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
            {renderRoundDates(roundMeta[0], 0, isAdmin, onUpdateMeta, { marginBottom: 8 }, true)}
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
          {renderRoundDates(roundMeta[totalRounds - 1], totalRounds - 1, isAdmin, onUpdateMeta, { marginBottom: 8 }, true)}
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

function MatchCard({ match, onSubmit, firstRound = false }) {
  const [s1, setS1] = useState(match.score1 ?? "");
  const [s2, setS2] = useState(match.score2 ?? "");
  // Only a first-round gap is a bye; later on it just means the opponent isn't known yet.
  const bye = firstRound && ((match.p1 && !match.p2) || (!match.p1 && match.p2));
  const editable = match.p1 && match.p2 && !bye;

  useEffect(() => {
    setS1(match.score1 ?? "");
    setS2(match.score2 ?? "");
  }, [match.score1, match.score2]);

  return (
    <div className="whbl-match" style={{ ...styles.matchCard, opacity: match.p1 || match.p2 ? 1 : 0.45 }}>
      <span className="whbl-jack" />
      <PlayerRow name={match.p1} won={match.winner && match.winner === match.p1} trophy={!bye} score={s1} />
      <div style={styles.vsDivider} />
      <PlayerRow name={match.p2} won={match.winner && match.winner === match.p2} trophy={!bye} score={s2} />
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

function PlayerRow({ name, won, trophy, score }) {
  return (
    <div
      style={{
        ...styles.playerRow,
        fontWeight: 700, // all names bold; the winner also gets the gold line
        color: won ? "#17392A" : "#3a362c",
        borderBottom: won ? "2px solid #AC8347" : "2px solid transparent",
      }}
    >
      <span>{won && trophy ? "🏆 " : ""}{name || "—"}</span>
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
  headerActions: { marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" },
  signOutBtn: { background: "transparent", color: "#FFFDF7", border: "2px solid #FFFDF7", padding: "7px 13px", borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer" },
  warnBanner: { background: "#FFF4D6", border: "1px solid #E2C46B", color: "#5c4710", padding: "10px 16px", fontSize: 14, maxWidth: 1100, margin: "12px auto 0", borderRadius: 6 },
  phoneBox: { background: "#FFFDF7", border: "1px solid #e2d9c2", borderRadius: 10, padding: "12px 12px 16px" },
  phoneTabs: { display: "flex", gap: 6, overflowX: "auto", margin: "0 -12px 12px", padding: "0 12px 4px", scrollbarWidth: "none" },
  phoneTab: { flex: "0 0 auto", padding: "8px 12px", border: "1px solid #cfc4a3", borderRadius: 999, background: "#fff", color: "#17392A", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" },
  phoneTabOn: { background: "#17392A", borderColor: "#17392A", color: "#FFFDF7" },
  phoneList: { display: "flex", flexDirection: "column", gap: 10 },
  phoneNote: { marginTop: 10, fontSize: 14, color: "#7a7462" },
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
