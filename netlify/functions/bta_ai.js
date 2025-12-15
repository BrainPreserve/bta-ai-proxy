import OpenAI from "openai";

const ALLOWED_ORIGINS = [
  "https://YOUR-WP-DOMAIN-HERE.com",
  "https://www.YOUR-WP-DOMAIN-HERE.com"
];

// Simple helper: return CORS headers only for allowed origins
function corsHeaders(origin) {
  if (ALLOWED_ORIGINS.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
  }
  return {
    // Do not reflect untrusted origins
    "Access-Control-Allow-Origin": "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

export default async (request, context) => {
  const origin = request.headers.get("origin") || "";
  const baseHeaders = {
    "Content-Type": "application/json",
    ...corsHeaders(origin)
  };

  // Handle preflight (browser CORS check)
  if (request.method === "OPTIONS") {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: baseHeaders });
  }

  // Only allow POST
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: baseHeaders });
  }

  // Block requests from non-allowed origins
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return new Response(JSON.stringify({ error: "Forbidden origin" }), { status: 403, headers: baseHeaders });
  }

  // Parse input JSON
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: baseHeaders });
  }

  const { mode, section_id, bta_payload } = body || {};

  if (!mode || !bta_payload) {
    return new Response(JSON.stringify({ error: "Missing mode or bta_payload" }), { status: 400, headers: baseHeaders });
  }

  if (mode === "section_deep_dive" && !section_id) {
    return new Response(JSON.stringify({ error: "Missing section_id for section_deep_dive" }), { status: 400, headers: baseHeaders });
  }

  // Build instructions (system prompt)
  const instructions = `
You are a physician-guided, evidence-based brain health coach.
You MUST:
- Anchor your analysis to the user's BTA results provided in bta_payload (treat them as ground truth).
- Use web search (tool) for up-to-date evidence, guidelines, risk associations, and intervention evidence when relevant.
- Keep output clinically professional, structured, and actionable.
- Provide a short "Evidence Notes" section with citations/attribution to what you found via web search.
- Do NOT invent user data; if something is not in bta_payload, say it is not provided.
Output must start with the user's requested report type:
- If mode = section_deep_dive: focus deeply on that one section, then briefly note interactions with the other highest-risk sections.
- If mode = full_report: provide a comprehensive executive summary plus section-by-section and a phased action plan.
  `.trim();

  const userInput = {
    mode,
    section_id: section_id || null,
    bta_payload
  };

  // Call OpenAI Responses API with web search tool enabled
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const resp = await client.responses.create({
      model: "gpt-5",
      instructions,
      input: JSON.stringify(userInput),
      tools: [{ type: "web_search" }]
      // Note: The model decides when to search; we strongly instruct it above.
    });

    // The SDK returns a structured response; "output_text" is the easiest text extraction
    const text = resp.output_text || "";

    return new Response(JSON.stringify({ ok: true, text }), { status: 200, headers: baseHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "OpenAI request failed", detail: String(err?.message || err) }),
      { status: 500, headers: baseHeaders }
    );
  }
};
