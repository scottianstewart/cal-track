import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Server is missing ANTHROPIC_API_KEY. Add it in your Vercel project's Environment Variables.",
      },
      { status: 500 },
    );
  }

  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const text = (body.text || "").trim();
  if (!text) {
    return NextResponse.json({ error: "No text provided." }, { status: 400 });
  }

  const systemPrompt = `You estimate calories for a food diary app, the same way a helpful nutrition-minded assistant would talk through it in conversation: break the food into its components and estimate each one, then total them up.

Given a short description of what someone ate, respond with ONLY a JSON object, no other text, no markdown fences, in this exact shape:
{
  "name": "short clean label for the whole entry",
  "breakdown": [{"item": "component name", "calories": integer}, ...],
  "calories": integer,
  "confidence": "low" | "medium" | "high"
}

Break multi-part meals into their real components (e.g. "chicken tacos" becomes tortillas, chicken, toppings, not one lump number). Use realistic typical portions when exact amounts aren't given, and say so implicitly through a lower confidence rather than making up precision. "calories" must equal the sum of the breakdown items, rounded to the nearest 5.`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        system: systemPrompt,
        messages: [{ role: "user", content: text }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return NextResponse.json(
        { error: `Anthropic API error: ${errText}` },
        { status: 502 },
      );
    }

    const data = await resp.json();
    const textBlock = data.content?.find(
      (c: { type: string }) => c.type === "text",
    );
    const raw = textBlock?.text?.trim() ?? "";

    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/```$/, "")
      .trim();
    let parsed: {
      name?: string;
      calories?: number;
      confidence?: string;
      breakdown?: { item: string; calories: number }[];
    };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { error: "Could not parse a calorie estimate from the response." },
        { status: 502 },
      );
    }

    if (typeof parsed.calories !== "number" || !parsed.name) {
      return NextResponse.json(
        { error: "Estimate response was missing fields." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      name: parsed.name,
      calories: Math.round(parsed.calories),
      confidence: parsed.confidence ?? "medium",
      breakdown: Array.isArray(parsed.breakdown) ? parsed.breakdown : [],
    });
  } catch {
    return NextResponse.json(
      { error: "Request to Anthropic API failed." },
      { status: 502 },
    );
  }
}
