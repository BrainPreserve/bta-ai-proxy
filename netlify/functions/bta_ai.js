import OpenAI from "openai";

const ALLOWED_ORIGINS = [
  "https://countercognitivedecline.com"
];

function buildCorsHeaders(origin) {
  if (ALLOWED_ORIGINS.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
  }
  // If origin is not allowed, do NOT allow browser access
  return {
    "Access-Control-Allow-Origin": "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

// IMPORTANT: This is a Netlify Function handler (event-based)
export const handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin || "";
  const cors = buildCorsHeaders(origin);

  // Always return CORS headers, even on errors
  const json = (statusCode, obj) => ({
    statusCode,
    headers: { "Content-Type": "application/json", ...cors },
    body: JSON.stringify(obj)
  });

  // Preflight CORS request
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  // Only POST is allowed
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  // Block non-allowed origins
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return json(403, { error: "Forbidden origin", origin_received: origin });
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return json(400, { error: "Invalid JSON body" });
  }

  const { mode, section_id, bta_payload } = body || {};

  if (!mode || !bta_payload) {
    return json(400, { error: "Missing mode or bta_payload" });
  }
  if (mode === "section_deep_dive" && !section_id) {
    return json(400, { error: "Missing section_id for section_deep_dive" });
  }

  if (!process.env.OPENAI_API_KEY) {
    return json(500, { error: "Missing OPENAI_API_KEY in Netlify environment variables" });
  }

  const instructions = `
You are a physician-guided, evidence-based brain health coach.
You MUST:
- Anchor your analysis to the user's BTA results in bta_payload (treat them as ground truth).
- Use web search tool for up-to-date evidence, guidelines, risk associations, and intervention evidence when relevant.
- Keep output clinically professional, structured, and actionable.
- Add an "Evidence Notes" section describing what you searched and what sources informed the answer.
- Do NOT invent user data; if something is not in bta_payload, say it is not provided.

Output rules:
- If mode = section_deep_dive: focus deeply on that one section, then briefly note interactions with the other highest-risk sections.
- If mode = full_report: provide an executive summary + section-by-section + phased plan (2w / 4w / 12w).
  `.trim();

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const resp = await client.responses.create({
      model: "gpt-5",
      instructions,
      input: JSON.stringify({ mode, section_id: section_id || null, bta_payload }),
      tools: [{ type: "web_search" }]
    });

    const text = resp.output_text || "";
    return json(200, { ok: true, text });
  } catch (err) {
    return json(500, {
      error: "OpenAI request failed",
      detail: String(err?.message || err)
    });
  }
};
