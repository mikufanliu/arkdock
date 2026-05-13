async function sendMessage(text) {
    if (!text.trim()) return null;

    state.chatHistory.push({ role: "user", content: text });

    let reply;
    if (state.config && state.config.api_key) {
        reply = await callLLM(text);
    } else {
        reply = scriptedReply();
    }

    if (reply) {
        state.chatHistory.push({ role: "assistant", content: reply });
        saveChatHistory();
    }
    return reply;
}

function scriptedReply() {
    const lines = state.voiceLines;
    if (!lines || lines.length === 0) return "……";
    const line = lines[Math.floor(Math.random() * lines.length)];
    return line.content || line.title || "……";
}

async function callLLM(userText) {
    const config = state.config;
    if (!config || !config.api_key || !config.endpoint) return scriptedReply();

    const systemPrompt = buildSystemPrompt();
    const messages = [
        { role: "system", content: systemPrompt },
        ...state.chatHistory.slice(-20),
    ];

    try {
        if (config.provider === "anthropic") {
            return await callAnthropic(config, messages);
        } else {
            return await callOpenAI(config, messages);
        }
    } catch (e) {
        console.error("LLM call failed:", e);
        return scriptedReply();
    }
}

function buildSystemPrompt() {
    if (state.persona && state.persona.system_prompt) {
        return state.persona.system_prompt;
    }
    const name = state.persona?.name || state.currentChar || "角色";
    return `你是${name}，用简短的中文回复，保持角色性格。`;
}

async function callOpenAI(config, messages) {
    const endpoint = config.endpoint.replace(/\/$/, "");
    const resp = await fetch(endpoint + "/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + config.api_key,
        },
        body: JSON.stringify({
            model: config.model || "gpt-4o-mini",
            messages: messages,
            max_tokens: 200,
        }),
    });

    if (!resp.ok) throw new Error("OpenAI API " + resp.status);
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || null;
}

async function callAnthropic(config, messages) {
    const systemMsg = messages.find(m => m.role === "system");
    const chatMsgs = messages.filter(m => m.role !== "system");

    const endpoint = config.endpoint.replace(/\/$/, "");
    const resp = await fetch(endpoint + "/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": config.api_key,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
            model: config.model || "claude-sonnet-4-20250514",
            max_tokens: 200,
            system: systemMsg?.content || "",
            messages: chatMsgs,
        }),
    });

    if (!resp.ok) throw new Error("Anthropic API " + resp.status);
    const data = await resp.json();
    return data.content?.[0]?.text || null;
}
