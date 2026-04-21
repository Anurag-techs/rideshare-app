/**
 * routes/ai.js — AI Features
 *
 * Endpoints:
 *   POST /api/ai/chat     → Natural language → ride search filters (OpenAI)
 *   GET  /api/ai/suggest  → Smart ride recommendations based on history
 *   POST /api/ai/sort     → Smart AI-powered ride sorting
 */
const express = require('express');
const { prepare }     = require('../db/init');
const { authOptional, authRequired } = require('../middleware/auth');
const router  = express.Router();

// ── Init OpenAI (gracefully degrade if key not set) ─────────────────────────
let openai = null;
const openaiKey = process.env.OPENAI_API_KEY || '';
if (openaiKey && !openaiKey.includes('YOUR_')) {
  const OpenAI = require('openai');
  openai = new OpenAI({ apiKey: openaiKey });
  console.log('🤖 OpenAI initialized');
} else {
  console.warn('⚠️  OpenAI key not set — AI features in MOCK mode');
}

/**
 * POST /api/ai/chat
 * Converts a natural language query into structured ride search filters.
 * Body: { message: "Find cheap ride from Noida to Delhi tomorrow" }
 * Returns: { filters: { from, to, date, max_price, sort }, reply }
 */
router.post('/chat', authOptional, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    // ── Mock response when OpenAI not configured ───────────────────────────
    if (!openai) {
      // Simple regex-based parsing as fallback
      const filters = parseFiltersLocally(message);
      return res.json({
        filters,
        reply: `🔍 Searching for rides${filters.from ? ` from **${filters.from}**` : ''}${filters.to ? ` to **${filters.to}**` : ''}${filters.date ? ` on **${filters.date}**` : ''}. (AI mock mode — add OpenAI key for full NLP)`,
        mock: true,
      });
    }

    // ── Real OpenAI call ───────────────────────────────────────────────────
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    const systemPrompt = `You are a ride-sharing assistant for an Indian carpooling app (like BlaBlaCar). 
Extract structured search filters from the user's natural language query.
Today's date is ${today}. Tomorrow is ${tomorrow}.
Return ONLY valid JSON matching this schema:
{
  "from": "city or location name or null",
  "to": "city or location name or null", 
  "date": "YYYY-MM-DD or null",
  "max_price": number or null,
  "sort": "price_asc|price_desc|time_asc|time_desc|rating or null",
  "reply": "friendly 1-sentence response to user in their language"
}
For "cheap" → sort: "price_asc". For "tomorrow" → use ${tomorrow}. 
Return only the JSON object, no markdown, no explanation.`;

    const completion = await openai.chat.completions.create({
      model:       'gpt-3.5-turbo',
      messages:    [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }],
      temperature: 0.2,
      max_tokens:  300,
    });

    let filters = {};
    let reply   = 'Here are your ride results!';

    try {
      const parsed = JSON.parse(completion.choices[0].message.content);
      filters = {
        from:      parsed.from      || null,
        to:        parsed.to        || null,
        date:      parsed.date      || null,
        max_price: parsed.max_price || null,
        sort:      parsed.sort      || 'time_asc',
      };
      reply = parsed.reply || reply;
    } catch (parseErr) {
      // If JSON parse fails, use local parser
      filters = parseFiltersLocally(message);
    }

    res.json({ filters, reply, mock: false });
  } catch (err) {
    console.error('AI chat error:', err.message);
    // Fallback gracefully
    res.json({
      filters: parseFiltersLocally(req.body.message || ''),
      reply: 'Searching for your ride...',
      mock: true,
      error: err.message,
    });
  }
});

/**
 * GET /api/ai/suggest
 * Returns AI-powered ride recommendations for the logged-in user.
 * Based on: their booking history, popular routes, price preference.
 */
router.get('/suggest', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's booking history (past destinations)
    const history = prepare(
      `SELECT r.from_location, r.to_location, b.total_amount, b.seats_booked
       FROM bookings b JOIN rides r ON b.ride_id = r.id
       WHERE b.passenger_id = ? AND b.status != 'cancelled'
       ORDER BY b.created_at DESC LIMIT 5`
    ).all(userId);

    // Get popular active rides (by booking count)
    const popular = prepare(
      `SELECT r.*, u.name AS driver_name, u.avg_rating AS driver_rating,
              u.profile_photo AS driver_photo,
              COUNT(b.id) AS booking_count
       FROM rides r
       JOIN users u ON r.driver_id = u.id
       LEFT JOIN bookings b ON b.ride_id = r.id AND b.status != 'cancelled'
       WHERE r.status = 'active' AND r.available_seats > 0
         AND r.departure_time > datetime('now')
         AND r.driver_id != ?
       GROUP BY r.id
       ORDER BY booking_count DESC, u.avg_rating DESC
       LIMIT 6`
    ).all(userId);

    // If user has history, find similar routes
    let recommended = popular;
    if (history.length > 0) {
      const lastTo = history[0].to_location;
      const avgSpend = history.reduce((s, h) => s + (h.total_amount || 0), 0) / history.length;

      // Try to find rides matching past destinations or price range
      const similar = prepare(
        `SELECT r.*, u.name AS driver_name, u.avg_rating AS driver_rating,
                u.profile_photo AS driver_photo, 0 AS booking_count
         FROM rides r JOIN users u ON r.driver_id = u.id
         WHERE r.status = 'active' AND r.available_seats > 0
           AND r.departure_time > datetime('now')
           AND r.driver_id != ?
           AND (LOWER(r.to_location) LIKE LOWER(?) OR r.price_per_seat <= ?)
         ORDER BY u.avg_rating DESC
         LIMIT 4`
      ).all(userId, `%${lastTo}%`, avgSpend * 1.2 || 999999);

      // Merge: similar first, then popular, deduplicate by id
      const seen = new Set();
      recommended = [...similar, ...popular].filter(r => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      }).slice(0, 6);
    }

    res.json({
      rides:   recommended,
      history: history.map(h => ({ from: h.from_location, to: h.to_location })),
    });
  } catch (err) {
    console.error('AI suggest error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

/**
 * POST /api/ai/sort
 * AI-smart sort: ranks rides by "best match" considering price, rating, seats, time.
 * Body: { rides: [...], preference: "cheap|fast|safe|balanced" }
 */
router.post('/sort', authOptional, (req, res) => {
  try {
    const { rides = [], preference = 'balanced' } = req.body;
    if (!Array.isArray(rides)) return res.status(400).json({ error: 'rides must be an array.' });

    const now        = Date.now();
    const maxPrice   = Math.max(...rides.map(r => r.price_per_seat || 0), 1);
    const maxRating  = 5;

    // Score each ride based on preference
    const scored = rides.map(r => {
      const priceScore  = 1 - (r.price_per_seat || 0) / maxPrice;           // 0-1 (lower = better)
      const ratingScore = (r.driver_rating || 0) / maxRating;               // 0-1 (higher = better)
      const timeScore   = Math.max(0, 1 - (new Date(r.departure_time) - now) / (7 * 86400000)); // Sooner = better
      const seatScore   = Math.min(1, (r.available_seats || 0) / 4);        // More seats = better

      let weight;
      switch (preference) {
        case 'cheap':    weight = { p:0.6, r:0.2, t:0.1, s:0.1 }; break;
        case 'fast':     weight = { p:0.1, r:0.2, t:0.6, s:0.1 }; break;
        case 'safe':     weight = { p:0.1, r:0.7, t:0.1, s:0.1 }; break;
        default:         weight = { p:0.3, r:0.3, t:0.2, s:0.2 }; break; // balanced
      }

      const score = (
        priceScore  * weight.p +
        ratingScore * weight.r +
        timeScore   * weight.t +
        seatScore   * weight.s
      );

      return { ...r, _aiScore: Math.round(score * 100) };
    });

    scored.sort((a, b) => b._aiScore - a._aiScore);
    res.json({ rides: scored });
  } catch (err) {
    console.error('AI sort error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Local regex parser (fallback when OpenAI is not available) ───────────────
function parseFiltersLocally(message) {
  const lower = message.toLowerCase();
  const filters = {};

  // Indian cities common mapping
  const cities = [
    'delhi','noida','gurgaon','gurugram','faridabad','ghaziabad',
    'mumbai','pune','bangalore','bengaluru','hyderabad','chennai',
    'kolkata','jaipur','lucknow','chandigarh','ahmedabad','surat',
    'agra','varanasi','indore','bhopal','nagpur','coimbatore',
    'kochi','thiruvananthapuram','mysore','mangalore','hubli',
  ];

  // Extract "from X to Y" or "X to Y"
  const routeMatch = lower.match(/(?:from\s+)?([a-z\s]+?)\s+to\s+([a-z\s]+?)(?:\s+(?:on|tomorrow|today|next)|$)/);
  if (routeMatch) {
    filters.from = routeMatch[1].trim();
    filters.to   = routeMatch[2].trim();
  } else {
    // Try to find two city names
    const found = cities.filter(c => lower.includes(c));
    if (found.length >= 2) { filters.from = found[0]; filters.to = found[1]; }
    else if (found.length === 1) { filters.to = found[0]; }
  }

  // Date
  if (lower.includes('tomorrow')) {
    filters.date = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  } else if (lower.includes('today')) {
    filters.date = new Date().toISOString().split('T')[0];
  }

  // Price clues
  if (lower.includes('cheap') || lower.includes('budget') || lower.includes('affordable')) {
    filters.sort = 'price_asc';
  } else if (lower.includes('best') || lower.includes('top rated')) {
    filters.sort = 'rating';
  } else if (lower.includes('earliest') || lower.includes('soon')) {
    filters.sort = 'time_asc';
  }

  // Max price numbers like "under 500" or "below 200"
  const priceMatch = lower.match(/(?:under|below|max|less than)\s*₹?\s*(\d+)/);
  if (priceMatch) filters.max_price = parseInt(priceMatch[1]);

  return filters;
}

module.exports = router;
