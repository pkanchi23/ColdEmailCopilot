/**
 * Vercel Serverless Function - Anthropic API Proxy with Whitelist
 *
 * This function:
 * 1. Verifies the user's Google OAuth token
 * 2. Checks if their email is whitelisted
 * 3. Proxies the request to Anthropic API with corporate key
 */

// WHITELIST CONFIGURATION
// Add authorized email addresses here
const WHITELIST = [
  'example@gmail.com',
  'pranavkanchi23@gmail.com',
  'ethanchoi88@gmail.com',
  'govind25kanchi@gmail.com'
  // Add more emails here as needed
];

// Enable/disable debug logging
const DEBUG = true; // process.env.DEBUG === 'true';

/**
 * Verify Google OAuth token and extract email
 */
async function verifyGoogleToken(accessToken) {
  try {
    const response = await fetch(
      `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${accessToken}`
    );

    if (!response.ok) {
      throw new Error('Invalid token');
    }

    const data = await response.json();

    // Check if token is valid and has email
    if (!data.email || !data.verified_email) {
      throw new Error('Token does not contain verified email');
    }

    return {
      email: data.email,
      isValid: true
    };
  } catch (error) {
    if (DEBUG) console.error('Token verification error:', error);
    return {
      email: null,
      isValid: false,
      error: error.message
    };
  }
}

/**
 * Check if email is whitelisted
 */
function isWhitelisted(email) {
  return WHITELIST.includes(email.toLowerCase());
}

/**
 * Main handler function
 */
export default async function handler(req, res) {
  // Enable CORS for Chrome extension
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed',
      message: 'Only POST requests are supported'
    });
  }

  try {
    // 1. Extract and verify Google OAuth token
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization header. Expected: Bearer <token>'
      });
    }

    const accessToken = authHeader.substring(7); // Remove 'Bearer ' prefix

    if (DEBUG) console.log('Verifying token...');

    const tokenInfo = await verifyGoogleToken(accessToken);

    if (!tokenInfo.isValid) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid Google OAuth token',
        details: tokenInfo.error
      });
    }

    const userEmail = tokenInfo.email;
    if (DEBUG) console.log('Authenticated user:', userEmail);

    // 2. Check whitelist
    if (!isWhitelisted(userEmail)) {
      if (DEBUG) console.log('User not whitelisted:', userEmail);

      return res.status(403).json({
        error: 'Forbidden',
        message: 'Your email address is not authorized to use this service',
        email: userEmail,
        hint: 'Contact your administrator to request access'
      });
    }

    if (DEBUG) console.log('User authorized:', userEmail);

    // 3. Verify corporate API key is configured
    const corporateApiKey = process.env.ANTHROPIC_API_KEY;

    if (!corporateApiKey) {
      console.error('ANTHROPIC_API_KEY environment variable not set');
      return res.status(500).json({
        error: 'Configuration error',
        message: 'Server is not properly configured. Contact administrator.'
      });
    }

    // --- DB INTEGRATION START ---
    // Extract settings from request to save/update profile
    const {
      userContext: aboutMe,
      exampleEmail,
      tone: preferredTone,
      model: preferredModel
    } = req.body; // Assuming these are sent in the body along with 'messages'

    // We use the Pool from @neondatabase/serverless
    const { Pool } = await import('@neondatabase/serverless');
    const pool = new Pool({ connectionString: process.env.POSTGRES_URL });

    let planTier = 'free';

    try {
      // Upsert User Profile & Get Plan
      // We update settings if provided, otherwise keep existing.
      // We always return the plan_tier.
      const profileQuery = `
            INSERT INTO user_profiles (email, about_me, example_email, preferred_tone, preferred_model)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (email) DO UPDATE SET
                about_me = COALESCE(EXCLUDED.about_me, user_profiles.about_me),
                example_email = COALESCE(EXCLUDED.example_email, user_profiles.example_email),
                preferred_tone = COALESCE(EXCLUDED.preferred_tone, user_profiles.preferred_tone),
                preferred_model = COALESCE(EXCLUDED.preferred_model, user_profiles.preferred_model),
                updated_at = NOW()
            RETURNING plan_tier;
        `;

      const profileRes = await pool.query(profileQuery, [
        userEmail,
        aboutMe || null,
        exampleEmail || null,
        preferredTone || null,
        preferredModel || null
      ]);

      if (profileRes.rows.length > 0) {
        planTier = profileRes.rows[0].plan_tier;
      }

    } catch (dbError) {
      console.error('Database Error (Profile Upsert):', dbError);
      // We generally default to 'free' and proceed if DB fails, to avoid blocking generation
    }
    // --- DB INTEGRATION END ---

    // 4. Proxy request to Anthropic API
    if (DEBUG) console.log('Proxying request to Anthropic...');

    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': corporateApiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(req.body)
    });

    const anthropicData = await anthropicResponse.json();

    if (!anthropicResponse.ok) {
      console.error('Anthropic API error:', anthropicData);
      // Return 502 Bad Gateway for upstream errors so client doesn't clear its own auth token
      return res.status(502).json({
        error: 'Upstream API Error',
        message: `Anthropic API refused the request: ${anthropicData.error?.message || 'Unknown error'}`,
        details: anthropicData
      });
    }

    // --- DB USAGE TRACKING START ---
    try {
      if (anthropicData.usage) {
        const inputTokens = anthropicData.usage.input_tokens || 0;
        const outputTokens = anthropicData.usage.output_tokens || 0;

        await pool.query(`
                UPDATE user_profiles 
                SET 
                    total_emails_sent = total_emails_sent + 1,
                    total_input_tokens = total_input_tokens + $2,
                    total_output_tokens = total_output_tokens + $3,
                    updated_at = NOW()
                WHERE email = $1
            `, [userEmail, inputTokens, outputTokens]);
      }
    } catch (dbError) {
      console.error('Database Error (Usage Tracking):', dbError);
    } finally {
      await pool.end(); // Close DB connection
    }
    // --- DB USAGE TRACKING END ---

    if (DEBUG) console.log('Request successful for:', userEmail);

    // 5. Return response (include plan tier metadata for client if needed)
    return res.status(200).json({
      ...anthropicData,
      _meta: { plan_tier: planTier }
    });

  } catch (error) {
    console.error('Handler error:', error);

    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      stack: DEBUG ? error.stack : undefined
    });
  }
}
