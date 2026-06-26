import assert from "node:assert/strict";
import test from "node:test";
import { lookupWeather, searchGNews, searchTavily } from "./external-services.js";

test("searchTavily normalizes search response into citations", async () => {
  const result = await searchTavily("key", "latest ai news", 3, async () => new Response(JSON.stringify({
    answer: "Summary",
    results: [
      {
        title: "Example result",
        url: "https://example.com/result",
        site_name: "Example",
        content: "Snippet"
      }
    ]
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  }));

  assert.equal(result.citations[0]?.title, "Example result");
  assert.match(result.summary, /Summary/);
});

test("lookupWeather formats a geocoded forecast response", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({
        results: [{ name: "Shanghai", country: "China", latitude: 31.23, longitude: 121.47 }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      current: {
        temperature_2m: 30,
        relative_humidity_2m: 70,
        wind_speed_10m: 12,
        weather_code: 1
      },
      daily: {
        temperature_2m_max: [33],
        temperature_2m_min: [26]
      }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const result = await lookupWeather("Shanghai", fetchImpl);
  assert.match(result.summary, /Weather for Shanghai, China/);
  assert.match(result.summary, /30C/);
});

test("searchGNews normalizes news citations", async () => {
  const result = await searchGNews("key", "deepseek", 2, async () => new Response(JSON.stringify({
    articles: [
      {
        title: "DeepSeek launch",
        url: "https://news.example.com/deepseek",
        description: "News summary",
        publishedAt: "2026-06-26T00:00:00Z",
        source: { name: "Example News" }
      }
    ]
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  }));

  assert.equal(result.citations[0]?.source, "Example News");
  assert.match(result.summary, /Top news results/);
});
