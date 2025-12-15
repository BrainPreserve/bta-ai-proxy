import OpenAI from "openai";

const ALLOWED_ORIGINS = [
  "https://countercognitivedecline.com",
  "https://www.countercognitivedecline.com"
];

function getCorsHeaders(event) {
  const origin = event.headers?.origin || event.headers?.Origin || "";
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
}

function json(statusCode, event, obj) {
  return {
    statusCode,
    headers: { ...getCorsHeaders(event), "Content-Type": "application/json" },
    body: JSON.stringify(obj)
  };
}

export async function handler(event) {
  try {
    // 1) CORS preflight (THIS is what your screenshot is failing on)
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: getCorsHeaders(event), body: "" };
    }

    // 2) Only allow POST for real requests
    if (event.httpMethod !== "POST") {
      return json(405, event, { error: "Method not allowed" });
    }

    // 3) Parse body
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch (e) {
      return json(400, event, { error: "Invalid JSON body" });
    }

    const mode = body.mode;
    const section_id = body.section_id || null;
    const bta_payload = body.bta_payload;

    if (!mode || !bta_payload) {
      return json(400, event, { error: "Missing mode or bta_payload" });
    }

    // 4) Ensure API key exists
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return json(500, event, { error: "Server missing OPENAI_API_KEY env var" });
    }

    const client = new OpenAI({ apiKey });

    const instructions =
      "You are a physician-guided brain health risk analyst. " +
      "Use the provided Brain Threat Analysis payload as ground truth for this client. " +
      "REQUIRED: Perform at least one web search for up-to-date evidence/guidelines before finalizing. " +
      "Return a detailed, clinically-structured answer with clear headings and actionable steps. " +
      "Do NOT invent user data. If something is missing, say so.";

    const input = JSON.stringify({ mode, section_id, bta_payload });

    const response = await client.responses.create({
      model: "gpt-5.1",
      instructions,
      input,
      tools: [{ type: "web_search" }],  
      tool_choice: "required",
      max_output_tokens: 1200
    });

    // 5) Return text
    return json(200, event, {
      ok: true,
      result: response.output_text || ""
    });
  } catch (err) {
    // Always return CORS headers even on crashes
    return json(500, event, {
      error: "Function crashed",
      details: String(err && err.message ? err.message : err)
    });
  }
}
