/**
 * Vercel Serverless Function - Anthropic API Proxy with Database Access Control
 *
 * This function:
 * 1. Verifies the user's Google OAuth token
 * 2. Checks if their email exists in the database
 * 3. Proxies the request to Anthropic API with corporate key
 */

// Enable/disable debug logging
const DEBUG = process.env.DEBUG === 'true'; // process.env.DEBUG === 'true';

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
 * Check if user exists in database
 */
async function checkUserExists(email, pool) {
  const result = await pool.query(
    'SELECT email FROM user_profiles WHERE email = $1',
    [email.toLowerCase()]
  );
  return result.rows.length > 0;
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

    // --- DB CONNECTION (moved up to check user access) ---
    const { Pool } = await import('@neondatabase/serverless');
    const pool = new Pool({ connectionString: process.env.POSTGRES_URL });

    try {
      // 2. Check if user exists in database
      const userExists = await checkUserExists(userEmail, pool);

      if (!userExists) {
        if (DEBUG) console.log('User not in database:', userEmail);

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


      let planTier = 'free';

      try {
        // Ensure user exists
        const ensureUserQuery = `
            INSERT INTO user_profiles (email)
            VALUES ($1)
            ON CONFLICT (email) DO NOTHING;
        `;
        await pool.query(ensureUserQuery, [userEmail]);

        // Fetch Plan and Usage Stats
        const userRes = await pool.query(`
          SELECT 
            plan_tier, 
            openai_input_tokens, openai_output_tokens,
            anthropic_input_tokens, anthropic_output_tokens
          FROM user_profiles 
          WHERE email = $1
      `, [userEmail]);

        if (userRes.rows.length > 0) {
          const user = userRes.rows[0];
          planTier = user.plan_tier || 'free';

          // PRICING CONSTANTS (Per 1M tokens)
          // Updated with user-provided rates for Sonnet 4.5 and GPT 5.2
          const PRICES = {
            gpt_input: 1.75,    // $1.75/1M
            gpt_output: 14.00,  // $14.00/1M
            claude_input: 3.00, // $3.00/1M
            claude_output: 15.00 // $15.00/1M
          };

          const openaiCost =
            ((parseInt(user.openai_input_tokens || 0) / 1000000) * PRICES.gpt_input) +
            ((parseInt(user.openai_output_tokens || 0) / 1000000) * PRICES.gpt_output);

          const anthropicCost =
            ((parseInt(user.anthropic_input_tokens || 0) / 1000000) * PRICES.claude_input) +
            ((parseInt(user.anthropic_output_tokens || 0) / 1000000) * PRICES.claude_output);

          const totalSpend = openaiCost + anthropicCost;

          if (DEBUG) console.log(`User Spend: $${totalSpend.toFixed(4)} (Tier: ${planTier})`);

          // SPEND LIMITS
          const LIMITS = {
            'free': 2.00,
            'developer': 20.00, // Developer gets higher limit
            'paid': 10.00,
            'tester': 10.00
          };

          const limit = LIMITS[planTier.toLowerCase()] || 20.00;

          if (totalSpend >= limit) {
            return res.status(402).json({
              error: 'Payment Required',
              message: `Usage limit of $${limit} exceeded. Current spend: $${totalSpend.toFixed(2)}. Please upgrade or contact support.`,
              _meta: { plan_tier: planTier, spend: totalSpend }
            });
          }
        }

      } catch (dbError) {
        console.error('Database Error (Profile Check):', dbError);
      }
      // --- DB INTEGRATION END ---

      // 4. Determine Provider & Proxy Request
      const { model, messages, max_tokens, temperature, system } = req.body;

      let responseData = {};
      let inputTokens = 0;
      let outputTokens = 0;

      if (model && model.toLowerCase().startsWith('gpt')) {
        // --- OPENAI PATH ---
        if (DEBUG) console.log('Routing to OpenAI for model:', model);

        const openAiKey = process.env.OPENAI_API_KEY;
        if (!openAiKey) {
          return res.status(500).json({ error: 'Configuration Error', message: 'OPENAI_API_KEY not set' });
        }

        const { OpenAI } = await import('openai');
        const openai = new OpenAI({ apiKey: openAiKey });

        try {
          // Convert Anthropic messages/system to OpenAI format
          const openaiMessages = [];
          if (system) {
            openaiMessages.push({ role: 'system', content: system });
          }
          if (messages) {
            openaiMessages.push(...messages);
          }

          const completion = await openai.chat.completions.create({
            model: model,
            messages: openaiMessages,
            max_tokens: max_tokens || 1024,
            temperature: temperature || 0.7,
          });

          // Normalize to Anthropic format for frontend compatibility
          const choice = completion.choices[0];
          const contentText = choice.message.content;

          inputTokens = completion.usage?.prompt_tokens || 0;
          outputTokens = completion.usage?.completion_tokens || 0;

          responseData = {
            id: completion.id,
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: contentText }],
            model: completion.model,
            stop_reason: choice.finish_reason,
            usage: {
              input_tokens: inputTokens,
              output_tokens: outputTokens
            }
          };

        } catch (openaiError) {
          console.error('OpenAI API Error:', openaiError);
          return res.status(502).json({
            error: 'Upstream API Error',
            message: `OpenAI API error: ${openaiError.message}`
          });
        }

      } else {
        // --- ANTHROPIC PATH (Default) ---
        if (DEBUG) console.log('Routing to Anthropic for model:', model);

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
          return res.status(502).json({
            error: 'Upstream API Error',
            message: `Anthropic API refused the request: ${anthropicData.error?.message || 'Unknown error'}`,
            details: anthropicData
          });
        }

        responseData = anthropicData;

        if (responseData.usage) {
          inputTokens = responseData.usage.input_tokens || 0;
          outputTokens = responseData.usage.output_tokens || 0;
        }
      }

      // --- DB USAGE TRACKING START ---
      try {
        if (inputTokens > 0 || outputTokens > 0) {
          const isOpenAI = model && model.toLowerCase().startsWith('gpt');

          if (isOpenAI) {
            await pool.query(`
                UPDATE user_profiles 
                SET 
                    openai_emails_sent = openai_emails_sent + 1,
                    openai_input_tokens = openai_input_tokens + $2,
                    openai_output_tokens = openai_output_tokens + $3,
                    updated_at = NOW()
                WHERE email = $1
            `, [userEmail, inputTokens, outputTokens]);
          } else {
            await pool.query(`
                UPDATE user_profiles 
                SET 
                    anthropic_emails_sent = anthropic_emails_sent + 1,
                    anthropic_input_tokens = anthropic_input_tokens + $2,
                    anthropic_output_tokens = anthropic_output_tokens + $3,
                    updated_at = NOW()
                WHERE email = $1
            `, [userEmail, inputTokens, outputTokens]);
          }
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
        ...responseData,
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
  } catch (outerError) {
    console.error('Outer handler error:', outerError);
    return res.status(500).json({
      error: 'Internal server error',
      message: outerError.message
    });
  }
}
