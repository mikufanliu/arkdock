let lateNightNagCount = 0;
let lastNagTime = 0;

function getCurrentTimeSlot() {
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 12) return "morning";
    if (hour >= 12 && hour < 18) return "daytime";
    if (hour >= 18 && hour < 21) return "evening";
    if (hour >= 21) return "night";
    return "lateNight";
}

function pickLine(linesOrString) {
    if (!linesOrString) return null;
    if (typeof linesOrString === "string") return linesOrString;
    if (Array.isArray(linesOrString) && linesOrString.length > 0) {
        return linesOrString[Math.floor(Math.random() * linesOrString.length)];
    }
    return null;
}

function getLaunchGreeting() {
    const tg = state.persona?.timeGreetings;

    const lastSeen = state.globalPrefs?.lastSeenTs;
    if (lastSeen) {
        const gapHours = (Date.now() - lastSeen) / (1000 * 60 * 60);
        if (gapHours >= 2 && tg?.returnLong) {
            return tg.returnLong;
        }
        if (gapHours >= 0.1 && tg?.returnShort) {
            return tg.returnShort;
        }
    }

    const slot = getCurrentTimeSlot();
    if (tg) {
        const slotKey = slot === "daytime" ? (tg.daytime ? "daytime" : "afternoon") : slot;
        const line = pickLine(tg[slotKey]);
        if (line) return line;
    }

    return state.persona?.greeting || null;
}

function getIdleLine() {
    const slot = getCurrentTimeSlot();

    if (slot === "lateNight") {
        const nag = getLateNightNag();
        if (nag) return nag;
    }

    const tg = state.persona?.timeGreetings;
    if (tg && Math.random() < 0.4) {
        const slotKey = slot === "daytime" ? (tg.daytime ? "daytime" : "afternoon") : slot;
        const line = pickLine(tg[slotKey]);
        if (line) return line;
    }

    return scriptedReply();
}

function getLateNightNag() {
    const tg = state.persona?.timeGreetings;
    const nagLines = tg?.lateNight;
    if (!nagLines || (Array.isArray(nagLines) && nagLines.length === 0)) return null;

    const now = Date.now();
    if (lateNightNagCount > 0 && now - lastNagTime < 5 * 60 * 1000) {
        return null;
    }

    let line;
    if (Array.isArray(nagLines)) {
        const index = Math.min(lateNightNagCount, nagLines.length - 1);
        line = nagLines[index];
    } else {
        line = nagLines;
    }

    lateNightNagCount++;
    lastNagTime = now;
    return line;
}

function resetNagCount() {
    lateNightNagCount = 0;
    lastNagTime = 0;
}

function startHeartbeat() {
    saveLastSeen();
    setInterval(saveLastSeen, 60000);
    window.addEventListener("beforeunload", saveLastSeen);
}

function saveLastSeen() {
    invoke("save_char_prefs", {
        charId: "_global",
        prefs: { lastChar: state.currentChar, lastSeenTs: Date.now() },
    });
}
