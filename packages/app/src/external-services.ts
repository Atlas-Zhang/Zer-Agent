export type CitationRecord = {
  title: string;
  url: string;
  source?: string;
  snippet?: string;
  publishedAt?: string;
};

export type WebSearchResult = {
  summary: string;
  citations: CitationRecord[];
  details: Record<string, unknown>;
};

export type WeatherResult = {
  summary: string;
  details: Record<string, unknown>;
};

export type NewsResult = {
  summary: string;
  citations: CitationRecord[];
  details: Record<string, unknown>;
};

export async function searchTavily(
  apiKey: string,
  query: string,
  maxResults: number,
  fetchImpl: typeof fetch
): Promise<WebSearchResult> {
  const response = await fetchImpl("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query,
      max_results: maxResults,
      include_answer: true,
      include_raw_content: false,
      search_depth: "basic",
      topic: "general"
    })
  });

  const payload = await parseJsonResponse(response, "Tavily search");
  const results = readObjectArray(payload.results).slice(0, maxResults).map((entry) => ({
    title: readString(entry.title, "Untitled result"),
    url: readString(entry.url, ""),
    source: readString(entry.site_name),
    snippet: readString(entry.content),
    publishedAt: readString(entry.published_date)
  })).filter((entry) => entry.url);

  const summaryLines = [
    readString(payload.answer, `Top web results for "${query}":`),
    ...results.map((entry, index) => `${index + 1}. ${entry.title} (${entry.url})`)
  ];

  return {
    summary: summaryLines.join("\n"),
    citations: results,
    details: {
      provider: "tavily",
      query,
      resultCount: results.length
    }
  };
}

export async function lookupWeather(
  location: string,
  fetchImpl: typeof fetch
): Promise<WeatherResult> {
  const geocodeUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geocodeUrl.searchParams.set("name", location);
  geocodeUrl.searchParams.set("count", "1");
  geocodeUrl.searchParams.set("language", "en");
  geocodeUrl.searchParams.set("format", "json");

  const geocodeResponse = await fetchImpl(geocodeUrl);
  const geocodePayload = await parseJsonResponse(geocodeResponse, "Open-Meteo geocoding");
  const firstLocation = readObjectArray(geocodePayload.results)[0];
  if (!firstLocation) {
    throw new Error(`No weather location found for "${location}".`);
  }

  const latitude = readNumber(firstLocation.latitude);
  const longitude = readNumber(firstLocation.longitude);
  const resolvedName = [
    readString(firstLocation.name),
    readString(firstLocation.admin1),
    readString(firstLocation.country)
  ].filter(Boolean).join(", ");

  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
  forecastUrl.searchParams.set("latitude", String(latitude));
  forecastUrl.searchParams.set("longitude", String(longitude));
  forecastUrl.searchParams.set("current", "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code");
  forecastUrl.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min");
  forecastUrl.searchParams.set("forecast_days", "1");
  forecastUrl.searchParams.set("timezone", "auto");

  const forecastResponse = await fetchImpl(forecastUrl);
  const forecastPayload = await parseJsonResponse(forecastResponse, "Open-Meteo forecast");
  const current = isRecord(forecastPayload.current) ? forecastPayload.current : {};
  const daily = isRecord(forecastPayload.daily) ? forecastPayload.daily : {};
  const maxTemp = readUnknownArray(daily.temperature_2m_max)[0];
  const minTemp = readUnknownArray(daily.temperature_2m_min)[0];
  const weatherCode = readNumber(current.weather_code, 0);
  const summary = [
    `Weather for ${resolvedName}: ${readNumber(current.temperature_2m)}C, ${describeWeatherCode(weatherCode)}.`,
    `Humidity ${readNumber(current.relative_humidity_2m)}%, wind ${readNumber(current.wind_speed_10m)} km/h.`,
    `Today's range: ${readNumber(minTemp)}C to ${readNumber(maxTemp)}C.`
  ].join(" ");

  return {
    summary,
    details: {
      provider: "open-meteo",
      location: resolvedName,
      latitude,
      longitude,
      weatherCode
    }
  };
}

export async function searchGNews(
  apiKey: string,
  query: string,
  maxResults: number,
  fetchImpl: typeof fetch
): Promise<NewsResult> {
  const url = new URL("https://gnews.io/api/v4/search");
  url.searchParams.set("q", query);
  url.searchParams.set("max", String(maxResults));
  url.searchParams.set("expand", "content");

  const response = await fetchImpl(url, {
    headers: {
      "X-Api-Key": apiKey
    }
  });

  const payload = await parseJsonResponse(response, "GNews search");
  const articles = readObjectArray(payload.articles).slice(0, maxResults).map((entry) => {
    const source = isRecord(entry.source) ? entry.source : {};
    return {
      title: readString(entry.title, "Untitled article"),
      url: readString(entry.url, ""),
      source: readString(source.name),
      snippet: readString(entry.description) || readString(entry.content),
      publishedAt: readString(entry.publishedAt)
    };
  }).filter((entry) => entry.url);

  const summaryLines = [
    `Top news results for "${query}":`,
    ...articles.map((article, index) => `${index + 1}. ${article.title} (${article.source ?? "unknown source"})`)
  ];

  return {
    summary: summaryLines.join("\n"),
    citations: articles,
    details: {
      provider: "gnews",
      query,
      articleCount: articles.length
    }
  };
}

async function parseJsonResponse(response: Response, operation: string): Promise<Record<string, unknown>> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${operation} failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`);
  }

  const payload = await response.json();
  if (!isRecord(payload)) {
    throw new Error(`${operation} returned an invalid response.`);
  }

  return payload;
}

function readObjectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord);
}

function readUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function describeWeatherCode(code: number): string {
  const weatherCodes: Record<number, string> = {
    0: "clear sky",
    1: "mostly clear",
    2: "partly cloudy",
    3: "overcast",
    45: "fog",
    48: "depositing rime fog",
    51: "light drizzle",
    53: "moderate drizzle",
    55: "dense drizzle",
    61: "slight rain",
    63: "moderate rain",
    65: "heavy rain",
    71: "slight snow",
    73: "moderate snow",
    75: "heavy snow",
    80: "rain showers",
    81: "moderate rain showers",
    82: "violent rain showers",
    95: "thunderstorm"
  };

  return weatherCodes[code] ?? `weather code ${code}`;
}
